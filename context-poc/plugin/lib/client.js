window.__ModuleLoader__.load({
  id: '@whaledock/context-bridge-poc',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const react_jsx_runtime = require('react/jsx-runtime');
    const react = require('react');

    const CONTRACT = 'whaledock.context-bridge/v1';
    const CHANNEL = '/whaledock.context';
    const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
    const TOKEN_RE = /^[a-f0-9]{64}$/;
    const CONTROL_RE = /[\u0000-\u001f\u007f]/;
    const WORKSPACE_TEXT_CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
    const PREFLIGHT_TIMEOUT_MS = 2500;
    const PREFLIGHT_RETRY_MS = 120;
    const MAX_PREFERENCE_REVISION = 1_000_000_000;
    const MAX_PREFERENCE_LISTENERS = 64;
    const PREFERENCE_BOOTSTRAP_RETRY_MS = Object.freeze([50, 100, 200, 400, 800]);
    const WORKSPACE_FILE_OPERATIONS = new Set([
      'catalog.read', 'document.read', 'topic.choose',
      'project.action.prepare', 'project.action.submit',
      'receipts.read', 'receipts.ack', 'receipts.open'
    ]);
    const WORKSPACE_FILE_STATES = new Set([
      'queued', 'running', 'fulfilled', 'rejected', 'cancelled', 'expired'
    ]);
    const WORKSPACE_FILE_CODES = new Set([
      'workspace-unavailable', 'workspace-mismatch', 'operation-invalid',
      'operation-timeout', 'operation-failed', 'operation-stale',
      'outcome-unknown', 'busy', 'cancelled'
    ]);
    const WORKSPACE_FILE_FORBIDDEN_KEYS = new Set([
      'absolutepath', 'relativepath', 'effectivepath', 'workspacekey', 'cwd',
      'filepath', 'root', 'rootpath', 'frontmatter', 'patch',
      'sessionref', 'currentsessionid', 'rawsession', 'context', 'envelope',
      'authtoken', 'selectiontoken', 'controllerproof', 'claimtoken', 'requestseq',
      'hash', 'dev', 'ino'
    ]);
    const WORKSPACE_FILE_POLL_MS = 120;
    const MAX_WORKSPACE_FILE_INPUT_BYTES = 4 * 1024;
    const MAX_WORKSPACE_FILE_RESULT_BYTES = 6 * 1024;
    const PROJECT_TOKEN_RE = /^project-[a-f0-9]{24}$/;
    const CONTENT_REF_RE = /^content-[a-f0-9]{24}$/;
    const OPAQUE_VALUE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$/;
    const ACTIVE_RECEIPT_STATES = new Set(['submitting', 'queued', 'running', 'waiting']);
    const SHELL_CONTRACT = 'whaledock.content-shell/v1';
    const inject = ['connection', 'sessions'];

    const SHELL_CSS = `.wd10-left{background:var(--dsw-specific-sidebar-fill);border-right:1px solid var(--dsw-alias-border-l1);min-width:0;height:100%;display:flex;flex-direction:column;overflow:hidden}.wd10-switch{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:12px;padding:4px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}.wd10-switch button{border:0;border-radius:7px;padding:7px 10px;color:var(--dsw-alias-fg-secondary);background:transparent;font:inherit;font-size:13px;cursor:pointer}.wd10-switch button[aria-selected=true]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-primary);box-shadow:0 1px 3px rgba(0,0,0,.08)}.wd10-library{min-height:0;overflow:auto;padding:0 10px 18px}.wd10-libraryHead{padding:8px 6px 10px}.wd10-eyebrow{font-size:11px;letter-spacing:.08em;color:var(--dsw-alias-fg-tertiary);text-transform:uppercase}.wd10-libraryHead h2{font-size:17px;line-height:1.35;margin:4px 0;color:var(--dsw-alias-fg-primary)}.wd10-libraryHead p{font-size:12px;line-height:1.5;margin:0;color:var(--dsw-alias-fg-secondary)}.wd10-refresh,.wd10-loadMore{margin-top:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:5px 8px;background:transparent;color:var(--dsw-alias-fg-secondary);font:inherit;font-size:11px;cursor:pointer}.wd10-refresh:disabled,.wd10-loadMore:disabled{opacity:.55;cursor:default}.wd10-loadMore{width:100%;padding:8px}.wd10-workspaceList{margin:0 0 10px;padding:8px 6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}.wd10-workspaceChoice{width:100%;text-align:left;border:1px solid transparent;border-radius:8px;padding:7px 8px;margin-top:4px;background:transparent;color:inherit;cursor:pointer}.wd10-workspaceChoice:hover,.wd10-workspaceChoice[aria-current=true]{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l1)}.wd10-projectPath{display:block;margin-top:3px;font-size:10px;color:var(--dsw-alias-fg-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wd10-project{width:100%;text-align:left;border:1px solid transparent;border-radius:10px;padding:10px;margin:2px 0 6px;background:transparent;color:inherit;cursor:pointer}.wd10-project:hover{background:var(--dsw-alias-bg-layer-1)}.wd10-project[aria-current=true]{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l2)}.wd10-projectTitle{display:block;font-size:13px;font-weight:600;color:var(--dsw-alias-fg-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wd10-projectMeta{display:flex;align-items:center;gap:7px;margin-top:5px;font-size:11px;color:var(--dsw-alias-fg-tertiary)}.wd10-stageBadge{border-radius:999px;padding:1px 7px;background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary)}.wd10-detail{min-width:0;height:100%;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);border-right:1px solid var(--dsw-alias-border-l2);overflow:hidden}.wd10-detailHead{padding:22px 24px 12px}.wd10-detailHead h1{font-size:22px;line-height:1.25;margin:5px 0 7px;color:var(--dsw-alias-fg-primary)}.wd10-detailHead p{font-size:12px;line-height:1.5;margin:0;color:var(--dsw-alias-fg-secondary)}.wd10-projectActions{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}.wd10-projectActions button,.wd10-receipt button{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-primary);font:inherit;font-size:11px;cursor:pointer}.wd10-projectActions button:disabled,.wd10-receipt button:disabled{opacity:.55;cursor:default}.wd10-tabs{display:flex;gap:3px;padding:0 20px;border-bottom:1px solid var(--dsw-alias-border-l1);overflow:auto}.wd10-tabs button{border:0;border-bottom:2px solid transparent;padding:10px 8px 9px;background:transparent;color:var(--dsw-alias-fg-secondary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}.wd10-tabs button[aria-selected=true]{border-bottom-color:var(--dsw-alias-fg-primary);color:var(--dsw-alias-fg-primary)}.wd10-receipts{flex:none;max-height:188px;overflow:auto;padding:10px 18px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}.wd10-receiptTitle{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--dsw-alias-fg-secondary)}.wd10-receipt{margin-top:7px;padding:8px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);font-size:11px;color:var(--dsw-alias-fg-secondary)}.wd10-receiptHead,.wd10-receiptFoot{display:flex;align-items:center;justify-content:space-between;gap:8px}.wd10-receipt strong{color:var(--dsw-alias-fg-primary)}.wd10-receipt p{margin:5px 0 0;line-height:1.45}.wd10-preflight{border-color:var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-state-warn-tertiary)}.wd10-pulse{color:var(--dsw-alias-state-business-primary);font-weight:600}.wd10-panel{min-height:0;overflow:auto;padding:20px 24px 28px}.wd10-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px;background:var(--dsw-alias-bg-layer-1);margin-bottom:12px}.wd10-card h3{font-size:14px;margin:0 0 7px;color:var(--dsw-alias-fg-primary)}.wd10-card p{font-size:12px;line-height:1.65;margin:0;color:var(--dsw-alias-fg-secondary)}.wd10-unfinished strong{display:block;margin:8px 0;color:var(--dsw-alias-fg-primary)}.wd10-feedback{font-size:12px;line-height:1.5;margin:8px 0 0;color:var(--dsw-alias-fg-secondary)}.wd10-chat{min-width:0;height:100%;display:flex;overflow:hidden}.wd10-chatMain{min-width:0;flex:1;display:flex;flex-direction:column;overflow:hidden}.wd10-empty{padding:24px;color:var(--dsw-alias-fg-secondary);font-size:13px;line-height:1.6}@media(max-width:1120px){.wd10-detailHead{padding:18px 18px 10px}.wd10-panel{padding:16px 18px}.wd10-detailHead h1{font-size:19px}.wd10-tabs{padding:0 14px}.wd10-receipts{padding:9px 14px}}.wd10-leftViews,.wd10-leftView,.wd10-nativeSidebar{min-height:0;flex:1;overflow:hidden}.wd10-leftView[hidden],.wd10-nativeSidebar[hidden]{display:none}.wd10-subSwitch{margin-top:0}.wd10-banner,.wd10-hint{display:flex;align-items:center;gap:8px;margin:10px 18px 0;padding:9px 10px;border:1px solid var(--dsw-alias-state-warn-primary);border-radius:9px;color:var(--dsw-alias-fg-primary);background:var(--dsw-alias-state-warn-tertiary);font-size:12px;line-height:1.45}.wd10-banner span,.wd10-hint span{min-width:0;flex:1}.wd10-banner button,.wd10-hint button{flex:none;border:1px solid currentColor;border-radius:7px;padding:4px 8px;background:transparent;color:inherit;cursor:pointer}.wd10-banner button:disabled{opacity:.55;cursor:default}.wd10-prefStatus{margin:0 14px 8px;color:var(--dsw-alias-state-warn-primary);font-size:11px}.wd10-contentDetails{transition:width var(--ds-transition-duration-slow) var(--ds-ease-in-out);flex-shrink:0}`;
    const CREATOR_TABS = Object.freeze([
      ['overview', '概览'], ['script', '脚本'], ['shoot', '拍摄'],
      ['publish', '发布'], ['review', '复盘']
    ]);

    function installShellStyle() {
      if (typeof document === 'undefined') return () => {};
      const tagId = '@whaledock/context-bridge-poc/content-shell.css';
      if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) !== null) {
        return () => {};
      }
      const tag = document.createElement('style');
      tag.dataset.plugin = '@whaledock/context-bridge-poc';
      tag.dataset.pluginCss = tagId;
      tag.textContent = SHELL_CSS;
      document.head.appendChild(tag);
      return () => { tag.remove(); };
    }

    function normalizeProjectPath(cwd) {
      if (typeof cwd !== 'string' || cwd === '') return '';
      const unified = cwd.replaceAll('\\', '/');
      const withoutTail = unified === '/' ? unified : unified.replace(/\/+$/u, '');
      return /^[A-Za-z]:$/u.test(withoutTail) ? `${withoutTail}/` : withoutTail || '/';
    }

    function projectPathTail(cwd) {
      const normalized = normalizeProjectPath(cwd);
      const parts = normalized.split('/').filter(Boolean);
      return normalized === '' ? '' : parts.length > 2
        ? `…/${parts.slice(-2).join('/')}` : normalized;
    }

    function projectTitle(cwd, fallback) {
      return normalizeProjectPath(cwd).split('/').filter(Boolean).at(-1) || fallback;
    }

    function finalizeProject(project, current) {
      const ordered = [...project.sessions].sort((a, b) => {
        if (a.id === current) return -1;
        if (b.id === current) return 1;
        const aTime = Number.isFinite(a.updatedAt) ? a.updatedAt : -Infinity;
        const bTime = Number.isFinite(b.updatedAt) ? b.updatedAt : -Infinity;
        return bTime - aTime || String(a.id).localeCompare(String(b.id));
      });
      project.representativeId = ordered[0]?.id;
      project.updatedAt = ordered.reduce((latest, session) => (
        Number.isFinite(session.updatedAt) ? Math.max(latest, session.updatedAt) : latest
      ), 0);
      return project;
    }

    function creatorProjects(state, workspaces) {
      const groups = new Map();
      const claimed = new Set();
      const archived = new Set(workspaces.archivedSessionIds || []);
      for (const workspace of workspaces.items) {
        const workspacePath = normalizeProjectPath(workspace.path);
        const project = {
          key: `workspace:${String(workspace.workspaceId)}`,
          workspaceId: workspace.workspaceId,
          title: workspace.title || '未命名项目',
          pathTail: projectPathTail(workspacePath),
          sessions: [],
          sessionIds: [],
          running: false,
          updatedAt: 0,
          representativeId: undefined
        };
        for (const id of workspace.sessionIds) {
          const session = state.byId[id];
          if (archived.has(id) || session === undefined || session.origin === 'subagent') continue;
          claimed.add(id);
          project.sessions.push(session);
          project.sessionIds.push(id);
          project.running ||= session.running === true;
        }
        groups.set(project.key, project);
      }
      for (const id of state.ids) {
        const session = state.byId[id];
        if (archived.has(id) || session === undefined
            || session.origin === 'subagent' || claimed.has(id)) continue;
        const normalizedCwd = normalizeProjectPath(session.cwd);
        const sourceKey = normalizedCwd || `session:${String(id)}`;
        const key = `cwd:${sourceKey}`;
        let project = groups.get(key);
        if (project === undefined) {
          project = {
            key,
            title: projectTitle(normalizedCwd, session.displayTitle),
            pathTail: projectPathTail(normalizedCwd),
            sessions: [],
            sessionIds: [],
            running: false,
            updatedAt: 0,
            representativeId: undefined
          };
          groups.set(key, project);
        }
        project.sessions.push(session);
        project.sessionIds.push(id);
        project.running ||= session.running === true;
      }
      return [...groups.values()]
        .map((project) => finalizeProject(project, state.current))
        .sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key));
    }

    function boundedUiText(value, fallback, maximum = 240) {
      if (typeof value !== 'string' || WORKSPACE_TEXT_CONTROL_RE.test(value)) return fallback;
      const clean = Array.from(value.trim()).slice(0, maximum).join('');
      return clean || fallback;
    }

    function contentCatalogProject(value) {
      if (!plain(value) || !PROJECT_TOKEN_RE.test(String(value.projectToken || ''))
          || !CONTENT_REF_RE.test(String(value.contentRef || ''))) return null;
      const actions = (Array.isArray(value.actions) ? value.actions : []).slice(0, 4).map((action) => {
        if (!plain(action) || typeof action.id !== 'string'
            || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(action.id)) return null;
        return Object.freeze({
          id: action.id,
          label: boundedUiText(action.label, '继续', 32),
          hint: boundedUiText(action.hint, '', 100)
        });
      }).filter(Boolean);
      return Object.freeze({
        contentRef: value.contentRef,
        projectToken: value.projectToken,
        title: boundedUiText(value.title, '未命名内容', 120),
        workflowLabel: boundedUiText(value.workflowLabel,
          boundedUiText(value.stageLabel, '未分类', 24), 24),
        updated: boundedUiText(value.updated, '', 64) || null,
        actions: Object.freeze(actions)
      });
    }

    function contentCatalogResult(snapshot) {
      const value = snapshot?.state === 'fulfilled' ? snapshot.result : null;
      if (!plain(value) || value.kind !== 'catalog' || !Array.isArray(value.projects)
          || value.projects.length > 4) return null;
      const projects = value.projects.map(contentCatalogProject);
      if (projects.some((project) => project === null)) return null;
      return Object.freeze({
        projects: Object.freeze(projects),
        projectCount: Number.isSafeInteger(value.projectCount) && value.projectCount >= projects.length
          ? value.projectCount : projects.length,
        nextCursor: Number.isSafeInteger(value.nextCursor) ? value.nextCursor : null
      });
    }

    function receiptView(value) {
      if (!plain(value) || !OPAQUE_VALUE_RE.test(String(value.receiptId || ''))
          || typeof value.status !== 'string') return null;
      const resultToken = value.resultToken === undefined ? null : value.resultToken;
      if (resultToken !== null && !OPAQUE_VALUE_RE.test(String(resultToken))) return null;
      const pulseId = value.pulseId === undefined ? null : value.pulseId;
      if (pulseId !== null && !OPAQUE_VALUE_RE.test(String(pulseId))) return null;
      return Object.freeze({
        receiptId: value.receiptId,
        targetLabel: boundedUiText(value.targetLabel, '目标会话', 120),
        tracking: value.tracking === 'ready' ? 'ready' : 'unavailable',
        trackingText: boundedUiText(value.trackingText, '任务事件不可用，无法自动跟踪', 180),
        expectedStage: boundedUiText(value.expectedStage, '', 120),
        status: boundedUiText(value.status, 'unknown', 32),
        statusText: boundedUiText(value.statusText, '任务状态未知', 180),
        elapsedMs: Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0 ? value.elapsedMs : 0,
        resultCount: Number.isSafeInteger(value.resultCount) && value.resultCount >= 0
          ? value.resultCount : 0,
        resultToken,
        pulseId
      });
    }

    function receiptsResult(snapshot) {
      const value = snapshot?.state === 'fulfilled' ? snapshot.result : null;
      if (!plain(value) || value.kind !== 'receipts' || !Array.isArray(value.receipts)
          || value.receipts.length > 6) return null;
      const receipts = value.receipts.map(receiptView);
      return receipts.some((receipt) => receipt === null) ? null : Object.freeze(receipts);
    }

    function operationError(snapshot, fallback = '操作没有完成；没有推断结果。') {
      const result = snapshot?.state === 'fulfilled' ? snapshot.result : null;
      if (plain(result) && (result.kind === 'action-error' || result.state === 'error')) {
        return boundedUiText(result.message || result.text, fallback, 180);
      }
      if (snapshot?.code === 'outcome-unknown') return '操作结果未知；请先核对右栏和任务回执，不要重复点击。';
      if (snapshot?.code === 'workspace-mismatch' || snapshot?.code === 'operation-stale') {
        return '工作区或内容已变化，本次没有继续执行。';
      }
      return fallback;
    }

    function formatElapsed(milliseconds) {
      const seconds = Math.max(0, Math.floor(Number(milliseconds) / 1000));
      if (seconds < 60) return `${seconds} 秒`;
      return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`;
    }

    function CreatorSidebar({ workspace, workspaces, activeWorkspaceKey, onWorkspaceSelect,
      catalog, selectedToken, onSelect, onRefresh, onLoadMore }) {
      const copy = catalog.status === 'loading' ? '正在读取当前工作区的 front matter…'
        : catalog.status === 'error' ? '内容文件暂时读不到，没有使用旧数据。'
          : catalog.status === 'ready' && catalog.projects.length === 0
            ? '当前工作区没有受控内容文件。'
            : (catalog.status === 'ready' || catalog.status === 'stale')
              ? `已读取 ${catalog.projects.length} 张真实内容卡。`
              : '请先让当前内容工作区与右栏会话对齐。';
      return react_jsx_runtime.jsxs('div', {
        className: 'wd10-library',
        children: [react_jsx_runtime.jsxs('div', {
          className: 'wd10-libraryHead',
          children: [
            react_jsx_runtime.jsx('div', { className: 'wd10-eyebrow', children: 'WhaleDock' }),
            react_jsx_runtime.jsx('h2', { children: '内容库' }),
            workspace && react_jsx_runtime.jsx('p', { children: `当前工作区：${workspace.title}` }),
            react_jsx_runtime.jsx('p', { role: 'status', children: catalog.status === 'stale'
              ? `${copy} 自动刷新失败，以下是上次成功结果。` : copy }),
            react_jsx_runtime.jsx('button', { type: 'button', className: 'wd10-refresh',
              disabled: catalog.status === 'loading', onClick: onRefresh,
              children: catalog.status === 'loading' ? '正在刷新…' : '刷新内容' })
          ]
        }), workspaces.length > 0 && react_jsx_runtime.jsxs('div', {
          className: 'wd10-workspaceList', children: [
            react_jsx_runtime.jsx('div', { className: 'wd10-eyebrow', children: '会话对齐工作区' }),
            ...workspaces.map((item) => react_jsx_runtime.jsxs('button', {
              type: 'button', className: 'wd10-workspaceChoice',
              'aria-current': item.key === activeWorkspaceKey,
              onClick: () => onWorkspaceSelect(item), children: [
                react_jsx_runtime.jsx('span', { className: 'wd10-projectTitle', children: item.title }),
                react_jsx_runtime.jsx('span', { className: 'wd10-projectPath', children: item.pathTail })
              ]
            }, item.key))
          ]
        }), ...catalog.projects.map((project) => react_jsx_runtime.jsxs('button', {
          className: 'wd10-project',
          type: 'button',
          'aria-current': project.projectToken === selectedToken,
          onClick: () => onSelect(project),
          children: [
            react_jsx_runtime.jsx('span', { className: 'wd10-projectTitle', children: project.title }),
            react_jsx_runtime.jsxs('span', { className: 'wd10-projectMeta', children: [
              react_jsx_runtime.jsx('span', { className: 'wd10-stageBadge', children: project.workflowLabel }),
              react_jsx_runtime.jsx('span', { children: project.updated
                ? `更新 ${project.updated}` : '更新时间未写明' })
            ] })
          ]
        }, project.contentRef)), catalog.nextCursor !== null && catalog.nextCursor !== undefined
          && react_jsx_runtime.jsx('button', { type: 'button', className: 'wd10-loadMore',
            disabled: catalog.loadingMore === true, onClick: onLoadMore,
            children: catalog.loadingMore ? '正在加载…' : '加载更多' }),
        catalog.moreError && react_jsx_runtime.jsx('p', { className: 'wd10-feedback', role: 'status',
          children: '下一页读取失败；已加载的内容卡仍保留。' })]
      });
    }

    function TaskReceiptStrip({ projectToken, workspaceFiles, preflight, pending,
      feedback, onConfirm, onCancel, refreshKey, onCatalogRefresh, preflightRemaining }) {
      const [receiptState, setReceiptState] = react.useState({ status: 'idle', receipts: [] });
      const [operationFeedback, setOperationFeedback] = react.useState('');
      const pollAttempt = react.useRef(0);
      const receiptCatalogSignal = react.useRef(null);
      react.useEffect(() => {
        const attempt = ++pollAttempt.current;
        const controller = new AbortController();
        let timer = null;
        setReceiptState({ status: projectToken ? 'loading' : 'idle', receipts: [] });
        setOperationFeedback('');
        receiptCatalogSignal.current = null;
        if (!projectToken || !workspaceFiles || typeof workspaceFiles.execute !== 'function') {
          return () => controller.abort();
        }
        const poll = async () => {
          let receipts = null;
          try {
            receipts = receiptsResult(await workspaceFiles.execute(
              'receipts.read', { projectToken, limit: 6 }, controller.signal
            ));
          } catch (_error) { receipts = null; }
          if (controller.signal.aborted || pollAttempt.current !== attempt) return;
          if (!receipts) {
            setReceiptState((current) => current.receipts.length > 0
              ? { status: 'stale', receipts: current.receipts }
              : { status: 'error', receipts: [] });
          }
          else {
            setReceiptState({ status: 'ready', receipts });
            const signal = receipts.map((receipt) => [
              receipt.receiptId,
              ACTIVE_RECEIPT_STATES.has(receipt.status) ? 'active' : receipt.status,
              receipt.pulseId || '', receipt.resultCount, receipt.resultToken || ''
            ].join(':')).join('|');
            if (receiptCatalogSignal.current !== null
                && receiptCatalogSignal.current !== signal) onCatalogRefresh?.();
            receiptCatalogSignal.current = signal;
          }
          const active = receipts && receipts.some((receipt) => ACTIVE_RECEIPT_STATES.has(receipt.status));
          timer = globalThis.setTimeout(poll, active ? 1000 : 4000);
        };
        void poll();
        return () => {
          controller.abort();
          if (timer !== null) globalThis.clearTimeout(timer);
        };
      }, [projectToken, workspaceFiles, refreshKey, onCatalogRefresh]);
      const acknowledge = async (receipt) => {
        try {
          const snapshot = await workspaceFiles.execute('receipts.ack', {
            receiptId: receipt.receiptId, pulseId: receipt.pulseId
          });
          if (snapshot?.state !== 'fulfilled' || !['ok', 'stale'].includes(snapshot.result?.kind)) {
            setOperationFeedback('“刚更新”确认未送达；徽标会按上限自行消退。');
            return;
          }
          setReceiptState((current) => ({ ...current, receipts: current.receipts.map((item) => (
            item.receiptId === receipt.receiptId ? Object.freeze({ ...item, pulseId: null }) : item
          )) }));
        } catch (_error) { setOperationFeedback('“刚更新”确认未送达；徽标会按上限自行消退。'); }
      };
      const openResult = async (receipt) => {
        try {
          const snapshot = await workspaceFiles.execute('receipts.open', {
            resultToken: receipt.resultToken
          });
          if (snapshot?.state !== 'fulfilled' || snapshot.result?.kind !== 'ok') {
            setOperationFeedback(boundedUiText(snapshot?.result?.message,
              '结果暂时打不开；请从当前工作区核对。', 160));
          }
        } catch (_error) { setOperationFeedback('结果暂时打不开；请从当前工作区核对。'); }
      };
      const matchText = preflight?.workspaceMatch === 'match' ? '工作区匹配'
        : preflight?.workspaceMatch === 'mismatch' ? '工作区不匹配'
          : '工作区无法确认';
      return react_jsx_runtime.jsxs('section', {
        className: 'wd10-receipts', 'aria-label': '任务回执', children: [
          react_jsx_runtime.jsxs('div', { className: 'wd10-receiptTitle', children: [
            react_jsx_runtime.jsx('strong', { children: '任务回执' }),
            react_jsx_runtime.jsx('span', { children: '预检、进度与结果都留在这里' })
          ] }),
          preflight && react_jsx_runtime.jsxs('div', {
            className: 'wd10-receipt wd10-preflight', children: [
              react_jsx_runtime.jsxs('div', { className: 'wd10-receiptHead', children: [
                react_jsx_runtime.jsx('strong', { children: `将发往 ${preflight.targetLabel}` }),
                react_jsx_runtime.jsx('span', { children: matchText })
              ] }),
              react_jsx_runtime.jsx('p', { children:
                `${preflight.workspaceLabel} · ${preflight.targetRunning ? '会话正在运行' : '会话当前未运行'} · ${preflight.eventTracking === 'ready' ? '事件回执已接通' : '事件回执未接通'} · ${preflightRemaining ?? 0} 秒后过期` }),
              react_jsx_runtime.jsxs('div', { className: 'wd10-receiptFoot', children: [
                react_jsx_runtime.jsx('button', { type: 'button', disabled: pending,
                  onClick: onCancel, children: '取消' }),
                react_jsx_runtime.jsx('button', { type: 'button', disabled: pending,
                  onClick: onConfirm, children: pending ? '正在提交…'
                    : preflight.workspaceMatch === 'match' ? '确认发送' : '仍然发' })
              ] })
            ]
          }),
          receiptState.status === 'loading' && react_jsx_runtime.jsx('p', {
            className: 'wd10-feedback', children: '正在读取任务回执…'
          }),
          receiptState.status === 'error' && react_jsx_runtime.jsx('p', {
            className: 'wd10-feedback', children: '任务回执暂时不可用；没有推断任务状态。'
          }),
          receiptState.status === 'stale' && react_jsx_runtime.jsx('p', {
            className: 'wd10-feedback', children: '回执刷新失败；以下保留上次成功结果，不代表当前状态。'
          }),
          receiptState.status === 'ready' && receiptState.receipts.length === 0
            && react_jsx_runtime.jsx('p', { className: 'wd10-feedback', children: '还没有任务回执。' }),
          ...receiptState.receipts.map((receipt) => react_jsx_runtime.jsxs('div', {
            className: 'wd10-receipt', 'data-status': receipt.status, children: [
              react_jsx_runtime.jsxs('div', { className: 'wd10-receiptHead', children: [
                react_jsx_runtime.jsx('strong', { children: receipt.statusText }),
                react_jsx_runtime.jsx('span', { children: receipt.targetLabel })
              ] }),
              react_jsx_runtime.jsx('p', { children: `${receipt.trackingText} · 已用 ${formatElapsed(receipt.elapsedMs)}` }),
              react_jsx_runtime.jsxs('div', { className: 'wd10-receiptFoot', children: [
                receipt.pulseId && react_jsx_runtime.jsx('button', { type: 'button', className: 'wd10-pulse',
                  onClick: () => { void acknowledge(receipt); }, children: '刚更新' }),
                receipt.resultCount === 1 && receipt.resultToken && react_jsx_runtime.jsx('button', {
                  type: 'button', onClick: () => { void openResult(receipt); }, children: '打开 1 个结果'
                }),
                receipt.resultCount > 1 && react_jsx_runtime.jsx('span', { children: `${receipt.resultCount} 个结果` })
              ] })
            ]
          }, receipt.receiptId)),
          feedback && react_jsx_runtime.jsx('p', { className: 'wd10-feedback', role: 'status', children: feedback }),
          operationFeedback && react_jsx_runtime.jsx('p', { className: 'wd10-feedback', role: 'status', children: operationFeedback })
        ]
      });
    }

    function CreatorDetail({ routingProject, project, tab, onTab, workspaceFiles,
      alignment, onAlign, onCatalogRefresh }) {
      const [preflight, setPreflight] = react.useState(null);
      const [feedback, setFeedback] = react.useState('');
      const [pending, setPending] = react.useState(false);
      const [receiptRefresh, setReceiptRefresh] = react.useState(0);
      const [preflightRemaining, setPreflightRemaining] = react.useState(null);
      const pendingRef = react.useRef(false);
      const actionAttempt = react.useRef(0);
      const actionAbort = react.useRef(null);
      react.useEffect(() => {
        actionAttempt.current += 1;
        actionAbort.current?.abort();
        actionAbort.current = null;
        pendingRef.current = false;
        setPending(false);
        setPreflight(null);
        setPreflightRemaining(null);
        setFeedback('');
        return () => {
          actionAttempt.current += 1;
          actionAbort.current?.abort();
          actionAbort.current = null;
          pendingRef.current = false;
        };
      }, [project?.projectToken, workspaceFiles]);
      react.useEffect(() => {
        if (!preflight) {
          setPreflightRemaining(null);
          return undefined;
        }
        let timer = null;
        const tick = () => {
          const remaining = new Date(preflight.expiresAt).getTime() - Date.now();
          if (!Number.isFinite(remaining) || remaining <= 0) {
            setPreflight(null);
            setPreflightRemaining(null);
            setFeedback('预检已过期，请重新确认。');
            return;
          }
          setPreflightRemaining(Math.ceil(remaining / 1000));
          timer = globalThis.setTimeout(tick, Math.min(1000, remaining));
        };
        tick();
        return () => { if (timer !== null) globalThis.clearTimeout(timer); };
      }, [preflight]);
      const runPrepare = async (action) => {
        if (!project || pendingRef.current) return;
        pendingRef.current = true;
        setPending(true);
        setPreflight(null);
        setFeedback('正在确认投递去向…');
        const controller = new AbortController();
        actionAbort.current = controller;
        const attempt = ++actionAttempt.current;
        try {
          const snapshot = await workspaceFiles.execute('project.action.prepare', {
            projectToken: project.projectToken, actionId: action.id
          }, controller.signal);
          if (actionAttempt.current !== attempt) return;
          const value = snapshot?.state === 'fulfilled' ? snapshot.result : null;
          const expiresMs = Date.parse(value?.expiresAt);
          if (!plain(value) || value.kind !== 'preflight'
              || !OPAQUE_VALUE_RE.test(String(value.preflightToken || ''))
              || !Number.isFinite(expiresMs)) {
            setFeedback(operationError(snapshot, '无法确认投递去向；没有发送。'));
            return;
          }
          if (expiresMs <= Date.now()) {
            setFeedback('预检已过期，请重新确认。');
            return;
          }
          setPreflight(Object.freeze({
            preflightToken: value.preflightToken,
            projectToken: project.projectToken,
            actionId: action.id,
            targetLabel: boundedUiText(value.targetLabel, '目标会话', 120),
            workspaceLabel: boundedUiText(value.workspaceLabel, '当前工作区', 120),
            workspaceMatch: ['match', 'mismatch', 'unknown'].includes(value.workspaceMatch)
              ? value.workspaceMatch : 'unknown',
            targetRunning: value.targetRunning === true,
            eventTracking: value.eventTracking === 'ready' ? 'ready' : 'unavailable',
            expiresAt: value.expiresAt
          }));
          setFeedback('');
        } catch (_error) { if (actionAttempt.current === attempt) setFeedback('无法确认投递去向；没有发送。'); }
        finally {
          if (actionAbort.current === controller) actionAbort.current = null;
          if (actionAttempt.current === attempt) { pendingRef.current = false; setPending(false); }
        }
      };
      const cancelPreflight = () => {
        if (pendingRef.current) return;
        setPreflight(null);
        setFeedback('已取消，没有发送。');
      };
      const confirmPreflight = async () => {
        if (!preflight || pendingRef.current) return;
        if (Date.parse(preflight.expiresAt) <= Date.now()) {
          setPreflight(null);
          setPreflightRemaining(null);
          setFeedback('预检已过期，请重新确认。');
          return;
        }
        const frozen = preflight;
        pendingRef.current = true;
        setPending(true);
        setFeedback('正在提交到已确认的目标会话…');
        const controller = new AbortController();
        actionAbort.current = controller;
        const attempt = ++actionAttempt.current;
        try {
          const snapshot = await workspaceFiles.execute('project.action.submit', {
            projectToken: frozen.projectToken,
            actionId: frozen.actionId,
            preflightToken: frozen.preflightToken,
            override: frozen.workspaceMatch !== 'match'
          }, controller.signal);
          if (actionAttempt.current !== attempt) return;
          const value = snapshot?.state === 'fulfilled' ? snapshot.result : null;
          setPreflight(null);
          if (!plain(value) || !['accepted', 'rejected', 'unknown'].includes(value.state)) {
            setFeedback(operationError(snapshot));
            return;
          }
          setFeedback(value.state === 'accepted'
            ? `已提交到 ${boundedUiText(value.target, '目标会话', 96)}；任务回执会继续更新。`
            : value.state === 'rejected'
              ? `目标拒绝投递（${boundedUiText(value.reason, '原因未说明', 64)}）；没有重复发送。`
              : '提交结果未知；请核对任务回执，不要重复点击。');
          setReceiptRefresh((current) => current + 1);
          onCatalogRefresh?.();
        } catch (_error) {
          if (actionAttempt.current === attempt) {
            setPreflight(null);
            setFeedback('提交结果未知；请核对右栏和任务回执，不要重复点击。');
          }
        } finally {
          if (actionAbort.current === controller) actionAbort.current = null;
          if (actionAttempt.current === attempt) { pendingRef.current = false; setPending(false); }
        }
      };
      const title = project?.title || routingProject?.title || '未选择内容';
      return react_jsx_runtime.jsxs('div', { className: 'wd10-detail', children: [
        alignment && react_jsx_runtime.jsxs('div', { className: 'wd10-banner', role: 'alert', children: [
          react_jsx_runtime.jsxs('span', { children: [
            '右栏当前在《', alignment.currentTitle, '》，不是你选的《', routingProject?.title || title, '》。',
            alignment.error || ''
          ] }),
          react_jsx_runtime.jsx('button', { type: 'button', disabled: alignment.pending,
            onClick: onAlign, children: alignment.pending ? '正在对齐…' : '一键对齐' })
        ] }),
        react_jsx_runtime.jsxs('header', { className: 'wd10-detailHead', children: [
          react_jsx_runtime.jsx('div', { className: 'wd10-eyebrow', children: '当前内容' }),
          react_jsx_runtime.jsx('h1', { children: title }),
          react_jsx_runtime.jsx('p', { children: project
            ? `${project.workflowLabel} · ${project.updated ? `更新 ${project.updated}` : '更新时间未写明'}`
            : '请从左侧选择一张真实内容卡。' }),
          project && project.actions.length > 0 && react_jsx_runtime.jsx('div', {
            className: 'wd10-projectActions', children: project.actions.map((action) => (
              react_jsx_runtime.jsx('button', { type: 'button', disabled: pending,
                title: action.hint || undefined, onClick: () => { void runPrepare(action); },
                children: action.label }, action.id)
            ))
          })
        ] }),
        react_jsx_runtime.jsx('nav', { className: 'wd10-tabs', 'aria-label': '项目阶段', children:
          CREATOR_TABS.map(([id, label]) => react_jsx_runtime.jsx('button', {
            type: 'button', 'aria-selected': tab === id, onClick: () => onTab(id), children: label
          }, id)) }),
        react_jsx_runtime.jsx(TaskReceiptStrip, {
          projectToken: project?.projectToken || null,
          workspaceFiles, preflight, pending, feedback,
          onConfirm: () => { void confirmPreflight(); }, onCancel: cancelPreflight,
          refreshKey: receiptRefresh, onCatalogRefresh, preflightRemaining
        }),
        react_jsx_runtime.jsx('main', { className: 'wd10-panel', children:
          react_jsx_runtime.jsxs('section', {
            className: 'wd10-card wd10-unfinished', 'data-whaledock-unfinished': true, children: [
              react_jsx_runtime.jsx('h3', { children:
                CREATOR_TABS.find(([id]) => id === tab)?.[1] || '概览' }),
              react_jsx_runtime.jsx('strong', { children: '这一格还没做' }),
              react_jsx_runtime.jsx('p', { children: '这一批只接通真实内容卡与任务回执；这里不会用静态卡冒充已实现。' })
            ]
          })
        })
      ] });
    }

    function createProjectActions(ctx) {
      return Object.freeze({
        open(sessionId) {
          const sessions = ctx.get('sessions');
          if (sessions === undefined) return { ok: false, code: 'session-unavailable', reason: 'service' };
          if (sessionId === undefined) return { ok: false, code: 'session-unavailable', reason: 'target' };
          try {
            sessions.open(sessionId);
            return { ok: true, sessionId };
          } catch (_error) {
            return { ok: false, code: 'session-unavailable', reason: 'target' };
          }
        },
        async connect(workspaceId) {
          const workspaces = ctx.get('workspaces');
          if (workspaces === undefined || workspaceId === undefined) {
            return { ok: false, code: 'workspace-unavailable' };
          }
          try {
            const sessionId = await workspaces.connectWorkspace(workspaceId);
            return sessionId === undefined ? { ok: false, code: 'workspace-unavailable' }
              : { ok: true, sessionId };
          } catch (_error) {
            return { ok: false, code: 'workspace-unavailable' };
          }
        },
        async fillDraft(sessionId, text, workspaceId, signal) {
          const sessions = ctx.get('sessions');
          if (sessions === undefined) return { ok: false, code: 'session-unavailable', reason: 'service' };
          let currentAtStart;
          try {
            currentAtStart = sessions.list.getSnapshot().current;
          } catch (_error) {
            return { ok: false, code: 'session-unavailable', reason: 'service' };
          }
          const currentUnchanged = () => {
            try { return Object.is(sessions.list.getSnapshot().current, currentAtStart); }
            catch (_error) { return false; }
          };
          const operationStale = () => signal?.aborted === true || !currentUnchanged();
          if (operationStale()) return { ok: false, code: 'operation-stale' };
          let targetId = sessionId;
          if (targetId === undefined && workspaceId !== undefined) {
            const workspaces = ctx.get('workspaces');
            if (workspaces === undefined) return { ok: false, code: 'workspace-unavailable' };
            try { targetId = await workspaces.connectWorkspace(workspaceId); }
            catch (_error) { return { ok: false, code: 'workspace-unavailable' }; }
            if (operationStale()) return { ok: false, code: 'operation-stale' };
            if (targetId === undefined) return { ok: false, code: 'workspace-unavailable' };
          }
          if (targetId === undefined) return { ok: false, code: 'session-unavailable', reason: 'target' };
          let input;
          for (let attempt = 0; attempt < 3 && input === undefined; attempt += 1) {
            try {
              const actx = sessions.scope(targetId);
              input = actx === undefined ? undefined : ctx.get('conversation')?.input.for(actx);
            } catch (_error) { /* rc.2 binding 契约失守时才走下面的短兜底 */ }
            if (operationStale()) return { ok: false, code: 'operation-stale' };
            if (input === undefined && attempt < 2) {
              await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
              if (operationStale()) return { ok: false, code: 'operation-stale' };
            }
          }
          if (input === undefined) return { ok: false, code: 'session-unavailable', reason: 'input' };
          if (operationStale()) return { ok: false, code: 'operation-stale' };
          try {
            if (String(input.state.getSnapshot().draft ?? '') !== '') {
              return { ok: false, code: 'draft-not-empty' };
            }
            if (operationStale()) return { ok: false, code: 'operation-stale' };
            input.setDraft(text);
          } catch (_error) {
            return { ok: false, code: 'session-unavailable', reason: 'input' };
          }
          const rollback = () => {
            try { if (input.state.getSnapshot().draft === text) input.setDraft(''); }
            catch (_error) { /* 仅回滚本次仍持有的草稿 */ }
          };
          if (operationStale()) {
            rollback();
            return { ok: false, code: 'operation-stale' };
          }
          try { sessions.open(targetId); }
          catch (_error) {
            rollback();
            return { ok: false, code: 'session-unavailable', reason: 'target' };
          }
          return { ok: true };
        }
      });
    }

    function WhaleDockContentShell({ useSessions, useWorkspaces, mount, integration }) {
      const sessionState = useSessions((state) => state);
      const workspaceState = useWorkspaces((state) => state);
      const projects = react.useMemo(
        () => creatorProjects(sessionState, workspaceState), [sessionState, workspaceState]
      );
      const { preferences, projectActions, workspaceFiles } = integration;
      const [mode, setMode] = react.useState('sessions');
      const [hintSeen, setHintSeen] = react.useState(false);
      const [preferenceError, setPreferenceError] = react.useState('');
      const [contentLeftView, setContentLeftView] = react.useState('library');
      const [activeProjectKey, setActiveProjectKey] = react.useState(null);
      const [creatorTab, setCreatorTab] = react.useState('overview');
      const [alignmentPending, setAlignmentPending] = react.useState(false);
      const [alignmentError, setAlignmentError] = react.useState('');
      const [catalog, setCatalog] = react.useState({ status: 'idle', projects: [] });
      const [selectedContentToken, setSelectedContentToken] = react.useState(null);
      const [catalogRefreshKey, setCatalogRefreshKey] = react.useState(0);
      const alignmentAttempt = react.useRef(0);
      const catalogAttempt = react.useRef(0);
      const catalogIdentity = react.useRef(null);
      const catalogPages = react.useRef(1);
      const catalogBusy = react.useRef(false);
      const catalogLoadMoreAttempt = react.useRef(0);
      const catalogLoadMoreAbort = react.useRef(null);
      const selectedContentRef = react.useRef(null);
      const alignmentCurrent = react.useRef(sessionState.current);
      const currentProject = sessionState.current === undefined ? undefined
        : projects.find((project) => project.sessionIds.includes(sessionState.current));
      const currentProjectKey = currentProject?.key || null;
      const activeRoutingProject = projects.find((project) => project.key === activeProjectKey)
        || projects[0];
      const routingMismatch = activeRoutingProject !== undefined
        && activeRoutingProject.key !== currentProjectKey;
      const currentCatalogIdentity = mode === 'content' && !routingMismatch && activeRoutingProject
        && sessionState.current !== undefined
        ? `${activeRoutingProject.key}\u0000${activeRoutingProject.pathTail}\u0000${sessionState.current}`
        : null;

      react.useLayoutEffect(() => {
        if (Object.is(alignmentCurrent.current, sessionState.current)) return;
        alignmentCurrent.current = sessionState.current;
        alignmentAttempt.current += 1;
        setAlignmentPending(false);
        setAlignmentError('');
      }, [sessionState.current]);
      react.useEffect(() => {
        if (preferences === undefined) return;
        const sync = (value) => {
          let snapshot = value;
          try {
            snapshot = snapshot && typeof snapshot === 'object'
              ? snapshot : preferences.getSnapshot();
          } catch (_error) {
            setPreferenceError('视图偏好暂时不可用。');
            return;
          }
          if (snapshot?.contentViewMode === 'content' || snapshot?.contentViewMode === 'sessions') {
            setMode(snapshot.contentViewMode);
          }
          if (typeof snapshot?.contentViewHintSeen === 'boolean') {
            setHintSeen(snapshot.contentViewHintSeen);
          }
        };
        sync();
        try {
          const unsubscribe = preferences.subscribe(sync);
          return typeof unsubscribe === 'function' ? unsubscribe : undefined;
        } catch (_error) {
          setPreferenceError('视图偏好暂时不可用。');
        }
      }, [preferences]);
      react.useEffect(() => {
        if (projects.some((project) => project.key === activeProjectKey)) return;
        alignmentAttempt.current += 1;
        setAlignmentPending(false);
        setAlignmentError('');
        setActiveProjectKey(
          projects.find((project) => project.key === currentProjectKey)?.key
            || projects[0]?.key || null
        );
      }, [projects, activeProjectKey, currentProjectKey]);
      const refreshCatalog = react.useCallback(() => {
        setCatalogRefreshKey((current) => current + 1);
      }, []);
      react.useLayoutEffect(() => {
        const identity = currentCatalogIdentity;
        const identityChanged = catalogIdentity.current !== identity;
        catalogIdentity.current = identity;
        const attempt = ++catalogAttempt.current;
        catalogLoadMoreAttempt.current += 1;
        catalogLoadMoreAbort.current?.abort();
        catalogLoadMoreAbort.current = null;
        catalogBusy.current = false;
        const controller = new AbortController();
        let timer = null;
        if (identityChanged) {
          catalogPages.current = 1;
          selectedContentRef.current = null;
          setSelectedContentToken(null);
          setCatalog({ status: identity ? 'loading' : 'idle', projects: [], nextCursor: null });
        }
        if (!identity || !workspaceFiles || typeof workspaceFiles.execute !== 'function') {
          if (identity && (!workspaceFiles || typeof workspaceFiles.execute !== 'function')) {
            setCatalog({ status: 'error', projects: [], nextCursor: null });
          }
          return () => controller.abort();
        }
        const readPages = async () => {
          if (catalogBusy.current || controller.signal.aborted) return;
          catalogBusy.current = true;
          const pageTarget = Math.max(1, catalogPages.current);
          let cursor = 0;
          let result = null;
          const merged = [];
          try {
            for (let page = 0; page < pageTarget && cursor !== null; page += 1) {
              const snapshot = await workspaceFiles.execute(
                'catalog.read', { cursor, limit: 4 }, controller.signal
              );
              result = contentCatalogResult(snapshot);
              if (!result) throw new Error('catalog-invalid');
              for (const project of result.projects) {
                if (!merged.some((item) => item.contentRef === project.contentRef)) merged.push(project);
              }
              cursor = result.nextCursor;
            }
          } catch (_error) { result = null; }
          catalogBusy.current = false;
          if (controller.signal.aborted || catalogAttempt.current !== attempt) return;
          if (!result) {
            setCatalog((current) => current.projects.length > 0
              ? { ...current, status: 'stale', loadingMore: false }
              : { status: 'error', projects: [], nextCursor: null });
          } else {
            const prior = selectedContentRef.current;
            const selected = merged.find((project) => project.contentRef === prior?.contentRef)
              || merged[0] || null;
            selectedContentRef.current = selected ? {
              contentRef: selected.contentRef, token: selected.projectToken
            } : null;
            setSelectedContentToken(selected?.projectToken || null);
            setCatalog({ status: 'ready', projects: merged,
              projectCount: result.projectCount, nextCursor: cursor,
              loadingMore: false, moreError: false });
          }
          timer = globalThis.setTimeout(readPages, 4000);
        };
        void readPages();
        return () => {
          controller.abort();
          catalogBusy.current = false;
          catalogLoadMoreAttempt.current += 1;
          catalogLoadMoreAbort.current?.abort();
          catalogLoadMoreAbort.current = null;
          if (timer !== null) globalThis.clearTimeout(timer);
        };
      }, [currentCatalogIdentity, workspaceFiles, catalogRefreshKey]);

      const selectContent = (project) => {
        selectedContentRef.current = {
          contentRef: project.contentRef, token: project.projectToken
        };
        setSelectedContentToken(project.projectToken);
      };
      const loadMoreCatalog = async () => {
        if (!catalogIdentity.current || catalog.loadingMore || catalogLoadMoreAbort.current
            || catalog.nextCursor === null
            || catalog.nextCursor === undefined || !workspaceFiles
            || typeof workspaceFiles.execute !== 'function') return;
        const identity = catalogIdentity.current;
        const attempt = ++catalogLoadMoreAttempt.current;
        const controller = new AbortController();
        catalogLoadMoreAbort.current?.abort();
        catalogLoadMoreAbort.current = controller;
        setCatalog((current) => ({ ...current, loadingMore: true, moreError: false }));
        try {
          const snapshot = await workspaceFiles.execute('catalog.read', {
            cursor: catalog.nextCursor, limit: 4
          }, controller.signal);
          const result = contentCatalogResult(snapshot);
          if (controller.signal.aborted || catalogLoadMoreAttempt.current !== attempt
              || catalogIdentity.current !== identity) return;
          if (!result) {
            setCatalog((current) => ({ ...current, loadingMore: false, moreError: true }));
            return;
          }
          catalogPages.current += 1;
          setCatalog((current) => {
            const projects = [...current.projects];
            for (const project of result.projects) {
              if (!projects.some((item) => item.contentRef === project.contentRef)) projects.push(project);
            }
            return { status: 'ready', projects, projectCount: result.projectCount,
              nextCursor: result.nextCursor, loadingMore: false, moreError: false };
          });
        } catch (_error) {
          if (!controller.signal.aborted && catalogLoadMoreAttempt.current === attempt
              && catalogIdentity.current === identity) {
            setCatalog((current) => ({ ...current, loadingMore: false, moreError: true }));
          }
        } finally {
          if (catalogLoadMoreAbort.current === controller) catalogLoadMoreAbort.current = null;
        }
      };

      const writePreference = async (patch) => {
        if (preferences === undefined || typeof preferences.write !== 'function') {
          setPreferenceError('当前视图已切换，但偏好未保存。');
          return;
        }
        try {
          const result = await preferences.write(patch);
          setPreferenceError(result?.ok === false ? '当前视图已切换，但偏好未保存。' : '');
        } catch (_error) {
          setPreferenceError('当前视图已切换，但偏好未保存。');
        }
      };
      const selectMode = (next) => {
        setMode(next);
        void writePreference({ contentViewMode: next });
      };
      const alignProject = async (project, connectMissing) => {
        if (project === undefined) return;
        const attempt = ++alignmentAttempt.current;
        const currentAtStart = alignmentCurrent.current;
        setActiveProjectKey(project.key);
        setAlignmentPending(true);
        setAlignmentError('');
        try {
          let targetId = project.representativeId;
          if (targetId === undefined && connectMissing) {
            const connected = await projectActions.connect(project.workspaceId);
            if (alignmentAttempt.current !== attempt
                || !Object.is(alignmentCurrent.current, currentAtStart)) return;
            if (connected?.ok !== true) {
              setAlignmentError(' 无法建立项目会话。');
              return;
            }
            targetId = connected.sessionId;
          }
          const result = projectActions.open(targetId);
          if (alignmentAttempt.current === attempt && result?.ok !== true) {
            setAlignmentError(result?.reason === 'service'
              ? ' 会话服务不可用。' : ' 代表会话不可用。');
          }
        } catch (_error) {
          if (alignmentAttempt.current === attempt) setAlignmentError(' 对齐意外中断。');
        } finally {
          if (alignmentAttempt.current === attempt) setAlignmentPending(false);
        }
      };

      const modeSwitch = react_jsx_runtime.jsxs('div', {
        className: 'wd10-switch', role: 'tablist', 'aria-label': '左侧视图', children: [
          react_jsx_runtime.jsx('button', { type: 'button', role: 'tab',
            'aria-selected': mode === 'sessions', onClick: () => selectMode('sessions'), children: '会话' }),
          react_jsx_runtime.jsx('button', { type: 'button', role: 'tab',
            'aria-selected': mode === 'content', onClick: () => selectMode('content'), children: '内容' })
        ]
      });
      if (mode === 'content') {
        const left = mount.viewport < 1120 ? 232 : 272;
        const detail = Math.min(440, Math.max(mount.viewport < 1120 ? 300 : 340,
          Math.round(mount.viewport * 0.31)));
        const activeProject = activeRoutingProject;
        const mismatch = routingMismatch;
        const visibleCatalog = catalogIdentity.current === currentCatalogIdentity ? catalog : {
          status: currentCatalogIdentity ? 'loading' : 'idle', projects: [], nextCursor: null
        };
        const selectedContent = visibleCatalog.projects.find((project) => (
          project.projectToken === selectedContentToken
        )) || visibleCatalog.projects[0];
        const contentSwitch = react_jsx_runtime.jsxs('div', {
          className: 'wd10-switch wd10-subSwitch', role: 'tablist',
          'aria-label': '内容态左栏', children: [
            react_jsx_runtime.jsx('button', { type: 'button', role: 'tab',
              'aria-selected': contentLeftView === 'library',
              onClick: () => setContentLeftView('library'), children: '内容库' }),
            react_jsx_runtime.jsx('button', { type: 'button', role: 'tab',
              'aria-selected': contentLeftView === 'native',
              onClick: () => setContentLeftView('native'), children: '会话与设置' })
          ]
        });
        return react_jsx_runtime.jsxs('div', {
          ref: mount.frameRef,
          className: mount.frameClassName,
          style: { gridTemplateColumns: `${left}px ${detail}px minmax(0, 1fr)` },
          'data-whaledock-layout': 'v0.10-p1',
          'data-whaledock-mode': 'content',
          'data-details-collapsed': mount.columns.details === 0 || undefined,
          children: [
            react_jsx_runtime.jsxs('aside', { className: 'wd10-left', children: [
              modeSwitch,
              preferenceError && react_jsx_runtime.jsx('p', {
                className: 'wd10-prefStatus', role: 'status', children: preferenceError
              }),
              !hintSeen && react_jsx_runtime.jsxs('div', {
                className: 'wd10-hint', role: 'status', children: [
                  react_jsx_runtime.jsx('span', { children: '这里是内容库，点「会话」回到原生列表' }),
                  react_jsx_runtime.jsx('button', { type: 'button', onClick: () => {
                    setHintSeen(true);
                    void writePreference({ contentViewHintSeen: true });
                  }, children: '知道了' })
                ]
              }),
              contentSwitch,
              react_jsx_runtime.jsx('div', { className: 'wd10-leftView',
                hidden: contentLeftView !== 'library', children:
                  react_jsx_runtime.jsx(CreatorSidebar, {
                    workspace: activeProject,
                    workspaces: projects,
                    activeWorkspaceKey: activeProject?.key || null,
                    onWorkspaceSelect: (project) => { void alignProject(project, false); },
                    catalog: visibleCatalog,
                    selectedToken: selectedContent?.projectToken || null,
                    onSelect: selectContent,
                    onRefresh: refreshCatalog,
                    onLoadMore: () => { void loadMoreCatalog(); }
                  }) }),
              react_jsx_runtime.jsx('div', { className: 'wd10-nativeSidebar',
                hidden: contentLeftView !== 'native', children: mount.renderSidebar(left) })
            ] }),
            react_jsx_runtime.jsx(CreatorDetail, {
              routingProject: activeProject,
              project: selectedContent,
              tab: creatorTab,
              onTab: setCreatorTab,
              workspaceFiles,
              alignment: mismatch ? {
                currentTitle: currentProject?.title
                  || sessionState.byId[sessionState.current]?.displayTitle || '未选择会话',
                pending: alignmentPending,
                error: alignmentError
              } : null,
              onAlign: () => { void alignProject(activeProject, true); },
              onCatalogRefresh: refreshCatalog
            }),
            react_jsx_runtime.jsxs('section', { className: 'wd10-chat',
              'aria-label': '原生对话', children: [
                react_jsx_runtime.jsx('div', { className: 'wd10-chatMain',
                  children: mount.renderConversation(true) }),
                mount.renderDetails({
                  className: 'wd10-contentDetails',
                  style: { width: mount.columns.details, flexBasis: mount.columns.details },
                  'aria-hidden': mount.columns.details === 0
                })
              ] }),
            mount.renderOverlay()
          ]
        });
      }
      return react_jsx_runtime.jsxs('div', {
        ref: mount.frameRef,
        className: mount.frameClassName,
        style: { gridTemplateColumns:
          `${mount.columns.sidebar}px minmax(0, 1fr) ${mount.columns.details}px` },
        'data-whaledock-layout': 'v0.10-p1',
        'data-sidebar-collapsed': mount.sidebarCollapsed || undefined,
        'data-details-collapsed': mount.columns.details === 0 || undefined,
        'data-dragging': mount.dragging || undefined,
        children: [
          react_jsx_runtime.jsxs('div', { className: 'wd10-left', children: [
            modeSwitch,
            preferenceError && react_jsx_runtime.jsx('p', {
              className: 'wd10-prefStatus', role: 'status', children: preferenceError
            }),
            mount.renderSidebar()
          ] }),
          react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
            children: [mount.renderConversation(), mount.renderDetails()]
          }),
          mount.renderOverlay(),
          mount.renderSidebarHandle(),
          mount.renderDetailsHandle()
        ]
      });
    }

    function createContentShell(ctx, preferences, workspaceFiles) {
      return Object.freeze({
        contract: SHELL_CONTRACT,
        Component: WhaleDockContentShell,
        preferences,
        workspaceFiles,
        projectActions: createProjectActions(ctx)
      });
    }

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

    function utf8Bytes(value) {
      let bytes = 0;
      for (const symbol of String(value)) {
        const code = symbol.codePointAt(0);
        bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
      }
      return bytes;
    }

    function safeWorkspaceValue(value, maximumBytes) {
      const canonicalKey = (key) => key.toLowerCase().replace(/[-_]/g, '');
      const visit = (item, depth) => {
        if (depth > 5) return null;
        if (item === null || typeof item === 'boolean') return item;
        if (Number.isSafeInteger(item) && Math.abs(item) <= 1_000_000_000_000) return item;
        if (typeof item === 'string') {
          return utf8Bytes(item) <= 2048 && !WORKSPACE_TEXT_CONTROL_RE.test(item) ? item : null;
        }
        if (Array.isArray(item)) {
          if (item.length > 64) return null;
          const result = [];
          for (const child of item) {
            const clean = visit(child, depth + 1);
            if (clean === null && child !== null) return null;
            result.push(clean);
          }
          return result;
        }
        if (!plain(item) || Object.keys(item).length > 64) return null;
        const result = {};
        for (const [key, child] of Object.entries(item)) {
          if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)
              || WORKSPACE_FILE_FORBIDDEN_KEYS.has(canonicalKey(key))) return null;
          const clean = visit(child, depth + 1);
          if (clean === null && child !== null) return null;
          result[key] = clean;
        }
        return result;
      };
      const clean = visit(value, 0);
      if (!plain(clean)) return null;
      return utf8Bytes(JSON.stringify(clean)) <= maximumBytes
        ? Object.freeze(clean) : null;
    }

    function workspaceFileSnapshot(value) {
      if (!exact(value, ['requestToken', 'state', 'code', 'result'])
          || typeof value.requestToken !== 'string' || !TOKEN_RE.test(value.requestToken)
          || !WORKSPACE_FILE_STATES.has(value.state)) return null;
      if (value.state === 'fulfilled') {
        const result = safeWorkspaceValue(value.result, MAX_WORKSPACE_FILE_RESULT_BYTES);
        return value.code === null && result
          ? Object.freeze({ ...value, result }) : null;
      }
      const codeValid = (value.state === 'queued' || value.state === 'running')
        ? value.code === null
        : WORKSPACE_FILE_CODES.has(value.code);
      return codeValid && value.result === null
        ? Object.freeze({ ...value, result: null }) : null;
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
      const workspaceWait = (signal) => new Promise((resolve) => {
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
        timer = globalThis.setTimeout(() => finish(true), WORKSPACE_FILE_POLL_MS);
      });
      const workspaceFiles = Object.freeze({
        async request(operation, value = {}, signal) {
          const input = safeWorkspaceValue(value, MAX_WORKSPACE_FILE_INPUT_BYTES);
          if (!WORKSPACE_FILE_OPERATIONS.has(operation) || !input) {
            return Object.freeze({
              accepted: false, requestToken: null, state: 'rejected',
              code: 'operation-invalid', deadlineMs: null
            });
          }
          const registered = await registerSelection(true);
          if (registered?.ok !== true || registered.value?.state !== 'selected') {
            return Object.freeze({
              accepted: false, requestToken: null, state: 'rejected',
              code: 'workspace-unavailable', deadlineMs: null
            });
          }
          try {
            const reply = await connection.rpc.call(CHANNEL, 'workspace/files/request', {
              ...preferenceAuth(), operation, input
            }, signal || abort.signal);
            const result = reply?.ok === true ? reply.value : null;
            if (!exact(result, [
              'accepted', 'requestToken', 'state', 'code', 'deadlineMs'
            ]) || typeof result.accepted !== 'boolean' || result.state !== 'rejected'
              && result.state !== 'queued') throw new Error('workspace request invalid');
            if (result.accepted) {
              if (!TOKEN_RE.test(result.requestToken) || result.state !== 'queued'
                  || result.code !== null || !Number.isSafeInteger(result.deadlineMs)
                  || result.deadlineMs <= Date.now()
                  || result.deadlineMs > Date.now() + 20000) {
                throw new Error('workspace request invalid');
              }
            } else if (result.requestToken !== null || result.deadlineMs !== null
                || result.state !== 'rejected' || !WORKSPACE_FILE_CODES.has(result.code)) {
              throw new Error('workspace request invalid');
            }
            return Object.freeze({ ...result });
          } catch (_error) {
            return Object.freeze({
              accepted: false, requestToken: null, state: 'rejected',
              code: 'outcome-unknown', deadlineMs: null
            });
          }
        },
        async status(requestToken, signal) {
          if (typeof requestToken !== 'string' || !TOKEN_RE.test(requestToken)) return null;
          try {
            const reply = await connection.rpc.call(CHANNEL, 'workspace/files/status', {
              ...preferenceAuth(), requestToken
            }, signal || abort.signal);
            return reply?.ok === true ? workspaceFileSnapshot(reply.value) : null;
          } catch (_error) { return null; }
        },
        async cancel(requestToken) {
          if (typeof requestToken !== 'string' || !TOKEN_RE.test(requestToken)) {
            return Object.freeze({ cancelled: false, code: 'already-settled', snapshot: null });
          }
          try {
            const reply = await connection.rpc.call(CHANNEL, 'workspace/files/cancel', {
              ...preferenceAuth(), requestToken
            }, abort.signal);
            const result = reply?.ok === true ? reply.value : null;
            const snapshot = result && workspaceFileSnapshot(result.snapshot);
            if (!exact(result, ['cancelled', 'code', 'snapshot']) || !snapshot
                || typeof result.cancelled !== 'boolean'
                || !['cancelled', 'already-running', 'already-settled'].includes(result.code)
                || (result.cancelled !== (result.code === 'cancelled'))) return null;
            return Object.freeze({ ...result, snapshot });
          } catch (_error) { return null; }
        },
        async execute(operation, value = {}, signal) {
          const queued = await workspaceFiles.request(operation, value, signal);
          if (!queued.accepted) return Object.freeze({
            requestToken: null, state: 'rejected', code: queued.code, result: null
          });
          while (!abort.signal.aborted && !signal?.aborted
              && Date.now() <= queued.deadlineMs) {
            const snapshot = await workspaceFiles.status(queued.requestToken, signal);
            if (!snapshot) return Object.freeze({
              requestToken: queued.requestToken, state: 'rejected',
              code: 'outcome-unknown', result: null
            });
            if (snapshot.state !== 'queued' && snapshot.state !== 'running') return snapshot;
            if (!await workspaceWait(signal)) break;
          }
          const cancelled = await workspaceFiles.cancel(queued.requestToken);
          if (cancelled?.snapshot
              && cancelled.snapshot.state !== 'queued'
              && cancelled.snapshot.state !== 'running') return cancelled.snapshot;
          return Object.freeze({
            requestToken: queued.requestToken, state: 'rejected',
            code: 'outcome-unknown', result: null
          });
        }
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
      let disposeWorkspaceFiles = () => {};
      try {
        const dispose = ctx.reflect.provide('whaledockWorkspaceFiles', workspaceFiles);
        if (typeof dispose === 'function') disposeWorkspaceFiles = dispose;
      } catch (_error) { /* 文件服务失败不能破坏 context gate */ }
      let disposeContentShell = () => {};
      let disposeShellStyle = () => {};
      try {
        const shell = createContentShell(ctx, preferences, workspaceFiles);
        const dispose = ctx.reflect.provide('whaledockContentShell', shell);
        if (typeof dispose === 'function') disposeContentShell = dispose;
        disposeShellStyle = installShellStyle();
      } catch (_error) { /* 内容挂载失败时 layout 保持官方三栏，context gate 继续生效 */ }
      ctx.effect(() => () => {
        try { disposeShellStyle(); } catch (_error) { /* 样式清理失败不阻断协议释放 */ }
        try { disposeContentShell(); } catch (_error) { /* 官方三栏仍可接管回退 */ }
        try { disposeWorkspaceFiles(); } catch (_error) { /* context gate 仍继续释放 */ }
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

    exports.createContentShell = createContentShell;
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
