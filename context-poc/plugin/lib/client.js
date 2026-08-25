window.__ModuleLoader__.load({
  id: '@whaledock/context-bridge-poc',
  factory: (_require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const CONTRACT = 'whaledock.context-bridge/v1';
    const CHANNEL = '/whaledock.context';
    const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
    const TOKEN_RE = /^[a-f0-9]{64}$/;
    const PREFLIGHT_TIMEOUT_MS = 2500;
    const PREFLIGHT_RETRY_MS = 120;
    const MAX_PREFERENCE_REVISION = 1_000_000_000;
    const MAX_PREFERENCE_LISTENERS = 64;
    const PREFERENCE_BOOTSTRAP_RETRY_MS = Object.freeze([50, 100, 200, 400, 800]);
    const inject = ['connection', 'sessions'];

    function randomId(prefix) {
      return `${prefix}-${globalThis.crypto.randomUUID()}`;
    }

    function randomHex(length) {
      let value = '';
      while (value.length < length) {
        value += globalThis.crypto.randomUUID().replaceAll('-', '').toLowerCase();
      }
      return value.slice(0, length);
    }

    function plain(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const prototype = Object.getPrototypeOf(value);
      return prototype === Object.prototype || prototype === null;
    }

    function exact(value, required) {
      return plain(value) && required.every((key) => (
        Object.prototype.hasOwnProperty.call(value, key)
      )) && Object.keys(value).every((key) => required.includes(key));
    }

    function preferencePatch(value) {
      if (!plain(value)) return null;
      const keys = Object.keys(value);
      if (keys.length < 1 || keys.length > 2
          || keys.some((key) => key !== 'contentViewMode' && key !== 'contentViewHintSeen')
          || (Object.prototype.hasOwnProperty.call(value, 'contentViewMode')
            && value.contentViewMode !== 'content' && value.contentViewMode !== 'sessions')
          || (Object.prototype.hasOwnProperty.call(value, 'contentViewHintSeen')
            && typeof value.contentViewHintSeen !== 'boolean')) return null;
      return Object.freeze({ ...value });
    }

    function preferenceSnapshot(value) {
      if (!exact(value, ['revision', 'contentViewMode', 'contentViewHintSeen'])
          || !Number.isSafeInteger(value.revision) || value.revision < 0
          || value.revision > MAX_PREFERENCE_REVISION
          || (value.contentViewMode !== 'content' && value.contentViewMode !== 'sessions')
          || typeof value.contentViewHintSeen !== 'boolean') return null;
      return Object.freeze({
        revision: value.revision,
        contentViewMode: value.contentViewMode,
        contentViewHintSeen: value.contentViewHintSeen
      });
    }

    function apply(ctx) {
      const connection = ctx.get('connection');
      const sessions = ctx.get('sessions');
      if (!connection || !sessions || connection.isLoopback !== true) return;

      const rawFragment = globalThis.location?.hash || '';
      const parameters = new URLSearchParams(
        rawFragment.startsWith('#') ? rawFragment.slice(1) : rawFragment
      );
      const controllerId = parameters.get('whaledockController');
      const selectionToken = parameters.get('whaledockSelectionToken');
      const managed = typeof controllerId === 'string' && ID_RE.test(controllerId)
        && typeof selectionToken === 'string' && TOKEN_RE.test(selectionToken);
      if (!managed) return;
      try {
        Object.defineProperty(globalThis, '__WHALEDOCK_CONTEXT_MANAGED__', {
          value: true, configurable: false, enumerable: false, writable: false
        });
      } catch (_error) { if (globalThis.__WHALEDOCK_CONTEXT_MANAGED__ !== true) return; }
      try {
        const cleanUrl = `${globalThis.location?.pathname || '/'}${globalThis.location?.search || ''}`;
        globalThis.history?.replaceState(globalThis.history.state, '', cleanUrl);
      } catch (_error) { /* fragment 仍不进入 HTTP；清历史失败不影响原生 dsh */ }

      const pageInstanceId = randomId('page');
      const revisionKey = `whaledock.context.selection.${controllerId}`;
      const proofKey = `whaledock.context.controller-proof.${controllerId}`;
      let selectionRevision = 0;
      let controllerProof = '';
      try {
        const stored = Number(globalThis.sessionStorage.getItem(revisionKey));
        if (Number.isSafeInteger(stored) && stored > 0) selectionRevision = stored;
      } catch (_error) { /* 从零开始 */ }
      try {
        const stored = globalThis.sessionStorage.getItem(proofKey);
        if (typeof stored === 'string' && TOKEN_RE.test(stored)) controllerProof = stored;
      } catch (_error) { /* 生成仅驻本页内存的 proof */ }
      if (!TOKEN_RE.test(controllerProof)) {
        controllerProof = randomHex(64);
        try { globalThis.sessionStorage.setItem(proofKey, controllerProof); }
        catch (_error) { /* proof 仍保留在本页内存 */ }
      }

      let lastCurrent = Symbol('unpublished');
      let preferenceState = Object.freeze({
        revision: 0,
        contentViewMode: 'content',
        contentViewHintSeen: false
      });
      let preferenceRefresh = null;
      let preferenceWriteTail = Promise.resolve();
      let preferenceBootstrapRetryIndex = 0;
      let preferenceBootstrapTimer = null;
      const preferenceListeners = new Set();
      const abort = new AbortController();
      const persistRevision = () => {
        try {
          globalThis.sessionStorage.setItem(revisionKey, String(selectionRevision));
        } catch (_error) { /* revision 仍保留在本页内存 */ }
      };
      const recoverRevision = (reply) => {
        const value = reply && reply.ok === true ? reply.value : reply;
        // 只有同一 page 的本地 revision 落后才可追上 Host。
        // 不同 page 的 revision-conflict 代表另一活跃控制器；
        // 自动加1会让两页 heartbeat 永久互相夺权。
        if (!value || value.state !== 'ignored-stale'
            || value.code !== 'selection-revision-stale'
            || !Number.isSafeInteger(value.selectionRevision)
            || value.selectionRevision < selectionRevision
            || value.selectionRevision >= Number.MAX_SAFE_INTEGER) return;
        selectionRevision = value.selectionRevision + 1;
        persistRevision();
        Promise.resolve().then(() => publish(true));
      };
      const registerSelection = async (force = false, expectedSessionId) => {
        const snapshot = sessions.list.getSnapshot();
        if (!snapshot || snapshot.phase === 'pending') return null;
        const currentSessionId = snapshot.current ?? null;
        if (expectedSessionId !== undefined && currentSessionId !== expectedSessionId) return null;
        if (!force && Object.is(lastCurrent, currentSessionId)) return null;
        if (!Object.is(lastCurrent, currentSessionId)) {
          lastCurrent = currentSessionId;
          selectionRevision += 1;
          persistRevision();
        }
        try {
          const reply = await connection.rpc.call(CHANNEL, 'selection/register', {
            contract: CONTRACT,
            controllerId,
            pageInstanceId,
            selectionRevision,
            currentSessionId,
            managed,
            selectionToken,
            registerNonce: randomHex(32),
            issuedAtMs: Date.now(),
            controllerProof
          }, abort.signal);
          recoverRevision(reply);
          return reply;
        } catch (_error) {
          return null;
        }
      };

      const preferenceAuth = () => ({
        contract: CONTRACT,
        controllerId,
        pageInstanceId,
        selectionRevision,
        selectionToken,
        controllerProof
      });
      const adoptPreferenceSnapshot = (value) => {
        const snapshot = preferenceSnapshot(value);
        if (!snapshot || snapshot.revision < preferenceState.revision) return false;
        if (snapshot.revision === preferenceState.revision) {
          return snapshot.contentViewMode === preferenceState.contentViewMode
            && snapshot.contentViewHintSeen === preferenceState.contentViewHintSeen;
        }
        preferenceState = snapshot;
        for (const listener of [...preferenceListeners]) {
          try { listener(preferenceState); } catch (_error) { /* 单个订阅者不能破坏桥 */ }
        }
        return true;
      };
      const refreshPreferences = async () => {
        if (preferenceRefresh) return preferenceRefresh;
        const operation = (async () => {
          try {
            const reply = await connection.rpc.call(CHANNEL, 'ui/preferences/get', {
              ...preferenceAuth()
            }, abort.signal);
            const value = reply?.ok === true ? reply.value : null;
            if (!exact(value, ['snapshot']) || !adoptPreferenceSnapshot(value.snapshot)) {
              return { ok: false, code: 'preferences-invalid' };
            }
            return { ok: true, code: null };
          } catch (_error) {
            return { ok: false, code: 'preferences-unavailable' };
          }
        })();
        preferenceRefresh = operation;
        try { return await operation; }
        finally { if (preferenceRefresh === operation) preferenceRefresh = null; }
      };
      const stopPreferenceBootstrapRetry = () => {
        if (preferenceBootstrapTimer !== null) {
          globalThis.clearTimeout(preferenceBootstrapTimer);
          preferenceBootstrapTimer = null;
        }
      };
      let schedulePreferenceBootstrapRetry = () => {};
      const preferences = Object.freeze({
        getSnapshot() { return preferenceState; },
        subscribe(listener) {
          if (typeof listener !== 'function' || preferenceListeners.size >= MAX_PREFERENCE_LISTENERS) {
            return () => {};
          }
          preferenceListeners.add(listener);
          return () => { preferenceListeners.delete(listener); };
        },
        async refresh() {
          const registered = await registerSelection(true);
          if (registered?.ok !== true) {
            if (preferenceState.revision === 0) schedulePreferenceBootstrapRetry();
            return { ok: false, code: 'preferences-unavailable' };
          }
          const result = await refreshPreferences();
          if (result.ok === true && preferenceState.revision >= 1) {
            stopPreferenceBootstrapRetry();
          } else if (preferenceState.revision === 0) {
            schedulePreferenceBootstrapRetry();
          }
          return result;
        },
        async write(value) {
          const patch = preferencePatch(value);
          if (!patch) return { ok: false, code: 'preferences-invalid' };
          const previousWrite = preferenceWriteTail;
          let releasePreferenceWrite;
          preferenceWriteTail = new Promise((resolve) => { releasePreferenceWrite = resolve; });
          await previousWrite;
          try {
            const registered = await registerSelection(true);
            if (registered?.ok !== true) return { ok: false, code: 'preferences-unavailable' };
            const refreshed = await refreshPreferences();
            if (refreshed.ok !== true || preferenceState.revision < 1) {
              return { ok: false, code: 'preferences-unavailable' };
            }
            const before = preferenceState;
            try {
              const reply = await connection.rpc.call(CHANNEL, 'ui/preferences/write', {
                ...preferenceAuth(),
                baseRevision: before.revision,
                patch
              }, abort.signal);
              const result = reply?.ok === true ? reply.value : null;
              const snapshot = result && preferenceSnapshot(result.snapshot);
              const codes = new Set([
                'preferences-busy', 'preferences-invalid', 'preferences-stale',
                'preferences-timeout', 'preferences-unavailable', 'preferences-write-failed'
              ]);
              if (!exact(result, ['accepted', 'code', 'snapshot']) || !snapshot
                  || typeof result.accepted !== 'boolean'
                  || (result.accepted ? result.code !== null : !codes.has(result.code))) {
                return { ok: false, code: 'preferences-invalid' };
              }
              if (result.accepted && (snapshot.revision !== before.revision + 1
                  || Object.keys(patch).some((key) => snapshot[key] !== patch[key]))) {
                return { ok: false, code: 'preferences-invalid' };
              }
              if (!adoptPreferenceSnapshot(result.snapshot)) {
                return { ok: false, code: 'preferences-invalid' };
              }
              return { ok: result.accepted, code: result.code };
            } catch (_error) {
              return { ok: false, code: 'preferences-unavailable' };
            }
          } finally {
            releasePreferenceWrite();
          }
        }
      });
      schedulePreferenceBootstrapRetry = () => {
        if (abort.signal.aborted || preferenceState.revision >= 1
            || preferenceBootstrapTimer !== null
            || preferenceBootstrapRetryIndex >= PREFERENCE_BOOTSTRAP_RETRY_MS.length) return;
        const delay = PREFERENCE_BOOTSTRAP_RETRY_MS[preferenceBootstrapRetryIndex];
        preferenceBootstrapRetryIndex += 1;
        preferenceBootstrapTimer = globalThis.setTimeout(() => {
          preferenceBootstrapTimer = null;
          void preferences.refresh();
        }, delay);
      };

      const publish = (force = false) => { void registerSelection(force); };
      const waitForRetry = (signal) => new Promise((resolve) => {
        if (abort.signal.aborted || signal?.aborted) { resolve(false); return; }
        let timer = null;
        const finish = (value) => {
          if (timer !== null) globalThis.clearTimeout(timer);
          abort.signal.removeEventListener('abort', onAbort);
          signal?.removeEventListener('abort', onAbort);
          resolve(value);
        };
        const onAbort = () => finish(false);
        abort.signal.addEventListener('abort', onAbort, { once: true });
        signal?.addEventListener('abort', onAbort, { once: true });
        timer = globalThis.setTimeout(() => finish(true), PREFLIGHT_RETRY_MS);
      });
      const gate = Object.freeze({
        async beforeSend(sessionId, mode, signal) {
          if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256
              || (mode !== 'queue' && mode !== 'steer')) return false;
          const deadline = Date.now() + PREFLIGHT_TIMEOUT_MS;
          while (!abort.signal.aborted && !signal?.aborted && Date.now() <= deadline) {
            const registered = await registerSelection(true, sessionId);
            const value = registered?.ok === true ? registered.value : null;
            if (value?.state === 'selected') {
              try {
                const reply = await connection.rpc.call(CHANNEL, 'context/preflight', {
                  contract: CONTRACT,
                  controllerId,
                  pageInstanceId,
                  selectionRevision,
                  currentSessionId: sessionId,
                  mode,
                  managed,
                  selectionToken
                }, signal || abort.signal);
                const result = reply?.ok === true ? reply.value : null;
                if (result?.ready === true) return true;
              } catch (_error) { /* 在 2.5s 界内继续等待 main 完成 stage */ }
            }
            if (Date.now() >= deadline || !await waitForRetry(signal)) break;
          }
          return false;
        }
      });

      void preferences.refresh();
      const unsubscribeSessions = sessions.list.subscribe(() => publish());
      const unsubscribeHost = connection.hostDescription.subscribe(() => {
        void preferences.refresh();
      });
      const heartbeat = globalThis.setInterval(() => {
        void preferences.refresh();
      }, 5000);
      const disposeGate = ctx.reflect.provide('whaledockContextGate', gate);
      let disposePreferences = () => {};
      try {
        const dispose = ctx.reflect.provide('whaledockShellPreferences', preferences);
        if (typeof dispose === 'function') disposePreferences = dispose;
      } catch (_error) { /* 偏好服务失败不能破坏 context gate */ }
      ctx.effect(() => () => {
        try { disposePreferences(); } catch (_error) { /* context gate 仍继续释放 */ }
        disposeGate();
        unsubscribeSessions();
        unsubscribeHost();
        preferenceListeners.clear();
        stopPreferenceBootstrapRetry();
        globalThis.clearInterval(heartbeat);
        abort.abort();
      }, 'whaledock-context-bridge: current-session reporter');
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
