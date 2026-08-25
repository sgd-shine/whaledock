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
    const inject = ['connection', 'sessions'];

    function randomId(prefix) {
      return `${prefix}-${globalThis.crypto.randomUUID()}`;
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
        const cleanUrl = `${globalThis.location?.pathname || '/'}${globalThis.location?.search || ''}`;
        globalThis.history?.replaceState(globalThis.history.state, '', cleanUrl);
      } catch (_error) { /* fragment 仍不进入 HTTP；清历史失败不影响原生 dsh */ }

      const pageInstanceId = randomId('page');
      const revisionKey = `whaledock.context.selection.${controllerId}`;
      let selectionRevision = 0;
      try {
        const stored = Number(globalThis.sessionStorage.getItem(revisionKey));
        if (Number.isSafeInteger(stored) && stored > 0) selectionRevision = stored;
      } catch (_error) { /* 从零开始 */ }

      let lastCurrent = Symbol('unpublished');
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
            selectionToken
          }, abort.signal);
          recoverRevision(reply);
          return reply;
        } catch (_error) {
          return null;
        }
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

      publish();
      const unsubscribeSessions = sessions.list.subscribe(() => publish());
      const unsubscribeHost = connection.hostDescription.subscribe(() => publish(true));
      const heartbeat = globalThis.setInterval(() => publish(true), 5000);
      const disposeGate = ctx.reflect.provide('whaledockContextGate', gate);
      ctx.effect(() => () => {
        disposeGate();
        unsubscribeSessions();
        unsubscribeHost();
        globalThis.clearInterval(heartbeat);
        abort.abort();
      }, 'whaledock-context-bridge: current-session reporter');
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
