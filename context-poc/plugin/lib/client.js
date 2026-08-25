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
    const PREFLIGHT_TIMEOUT_MS = 2500;
    const PREFLIGHT_RETRY_MS = 120;
    const MAX_PREFERENCE_REVISION = 1_000_000_000;
    const MAX_PREFERENCE_LISTENERS = 64;
    const PREFERENCE_BOOTSTRAP_RETRY_MS = Object.freeze([50, 100, 200, 400, 800]);
    const SHELL_CONTRACT = 'whaledock.content-shell/v1';
    const inject = ['connection', 'sessions'];

    const SHELL_CSS = `.wd10-left{background:var(--dsw-specific-sidebar-fill);border-right:1px solid var(--dsw-alias-border-l1);min-width:0;height:100%;display:flex;flex-direction:column;overflow:hidden}.wd10-switch{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:12px;padding:4px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}.wd10-switch button{border:0;border-radius:7px;padding:7px 10px;color:var(--dsw-alias-fg-secondary);background:transparent;font:inherit;font-size:13px;cursor:pointer}.wd10-switch button[aria-selected=true]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-primary);box-shadow:0 1px 3px rgba(0,0,0,.08)}.wd10-library{min-height:0;overflow:auto;padding:0 10px 18px}.wd10-libraryHead{padding:8px 6px 10px}.wd10-eyebrow{font-size:11px;letter-spacing:.08em;color:var(--dsw-alias-fg-tertiary);text-transform:uppercase}.wd10-libraryHead h2{font-size:17px;line-height:1.35;margin:4px 0;color:var(--dsw-alias-fg-primary)}.wd10-libraryHead p{font-size:12px;line-height:1.5;margin:0;color:var(--dsw-alias-fg-secondary)}.wd10-project{width:100%;text-align:left;border:1px solid transparent;border-radius:10px;padding:10px;margin:2px 0 6px;background:transparent;color:inherit;cursor:pointer}.wd10-project:hover{background:var(--dsw-alias-bg-layer-1)}.wd10-project[aria-current=true]{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l2)}.wd10-projectTitle{display:block;font-size:13px;font-weight:600;color:var(--dsw-alias-fg-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wd10-projectMeta{display:flex;align-items:center;gap:7px;margin-top:5px;font-size:11px;color:var(--dsw-alias-fg-tertiary)}.wd10-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-fg-tertiary)}.wd10-dot[data-running=true]{background:#22a06b}.wd10-detail{min-width:0;height:100%;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);border-right:1px solid var(--dsw-alias-border-l2);overflow:hidden}.wd10-detailHead{padding:26px 24px 14px}.wd10-detailHead h1{font-size:22px;line-height:1.25;margin:5px 0 7px;color:var(--dsw-alias-fg-primary)}.wd10-detailHead p{font-size:12px;line-height:1.5;margin:0;color:var(--dsw-alias-fg-secondary)}.wd10-tabs{display:flex;gap:3px;padding:0 20px;border-bottom:1px solid var(--dsw-alias-border-l1);overflow:auto}.wd10-tabs button{border:0;border-bottom:2px solid transparent;padding:10px 8px 9px;background:transparent;color:var(--dsw-alias-fg-secondary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}.wd10-tabs button[aria-selected=true]{border-bottom-color:var(--dsw-alias-fg-primary);color:var(--dsw-alias-fg-primary)}.wd10-panel{min-height:0;overflow:auto;padding:20px 24px 28px}.wd10-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px;background:var(--dsw-alias-bg-layer-1);margin-bottom:12px}.wd10-card h3{font-size:14px;margin:0 0 7px;color:var(--dsw-alias-fg-primary)}.wd10-card p{font-size:12px;line-height:1.65;margin:0;color:var(--dsw-alias-fg-secondary)}.wd10-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:13px}.wd10-stat{padding:10px;border-radius:9px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1)}.wd10-stat strong{display:block;font-size:18px;color:var(--dsw-alias-fg-primary)}.wd10-stat span{font-size:11px;color:var(--dsw-alias-fg-tertiary)}.wd10-action{width:100%;border:1px solid var(--dsw-alias-interactive-bg-hover);border-radius:9px;padding:10px 12px;margin-top:9px;background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary);font:inherit;font-size:12px;text-align:left;cursor:pointer}.wd10-action:hover{background:var(--dsw-alias-interactive-bg-hover)}.wd10-action small{display:block;margin-top:3px;color:var(--dsw-alias-fg-secondary)}.wd10-feedback{font-size:12px;line-height:1.5;margin:12px 1px 0;color:var(--dsw-alias-fg-secondary)}.wd10-chat{min-width:0;height:100%;display:flex;overflow:hidden}.wd10-chatMain{min-width:0;flex:1;display:flex;flex-direction:column;overflow:hidden}.wd10-empty{padding:24px;color:var(--dsw-alias-fg-secondary);font-size:13px;line-height:1.6}@media(max-width:1120px){.wd10-detailHead{padding:20px 18px 12px}.wd10-panel{padding:16px 18px}.wd10-detailHead h1{font-size:19px}.wd10-tabs{padding:0 14px}}.wd10-leftViews,.wd10-leftView,.wd10-nativeSidebar{min-height:0;flex:1;overflow:hidden}.wd10-leftView[hidden],.wd10-nativeSidebar[hidden]{display:none}.wd10-subSwitch{margin-top:0}.wd10-projectPath{display:block;margin-top:3px;font-size:10px;color:var(--dsw-alias-fg-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wd10-banner,.wd10-hint{display:flex;align-items:center;gap:8px;margin:10px 18px 0;padding:9px 10px;border:1px solid var(--dsw-alias-state-warn-primary);border-radius:9px;color:var(--dsw-alias-fg-primary);background:var(--dsw-alias-state-warn-tertiary);font-size:12px;line-height:1.45}.wd10-banner span,.wd10-hint span{min-width:0;flex:1}.wd10-banner button,.wd10-hint button{flex:none;border:1px solid currentColor;border-radius:7px;padding:4px 8px;background:transparent;color:inherit;cursor:pointer}.wd10-banner button:disabled,.wd10-action:disabled{opacity:.55;cursor:default}.wd10-prefStatus{margin:0 14px 8px;color:var(--dsw-alias-state-warn-primary);font-size:11px}.wd10-contentDetails{transition:width var(--ds-transition-duration-slow) var(--ds-ease-in-out);flex-shrink:0}`;
    const CREATOR_TABS = Object.freeze([
      ['overview', '概览'], ['script', '脚本'], ['shoot', '拍摄'],
      ['publish', '发布'], ['review', '复盘']
    ]);
    const STAGE_COPY = new Map([
      ['overview', (title) => `请帮我梳理「${title}」当前进展，只列出下一个最值得推进的决策。`],
      ['script', (title) => `请继续打磨「${title}」的脚本，先核对当前稿件，再给出可直接拍摄的改稿建议。`],
      ['shoot', (title) => `请为「${title}」生成本次拍摄的最小清单：镜头、口播、素材和收工检查。`],
      ['publish', (title) => `请检查「${title}」发布前还缺什么，区分本地准备、平台操作和人工确认。`],
      ['review', (title) => `请带我复盘「${title}」，先问我一个最关键的结果问题，等我回答后再继续。`]
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

    function CreatorSidebar({ projects, activeKey, onSelect }) {
      return react_jsx_runtime.jsxs('div', {
        className: 'wd10-library',
        children: [react_jsx_runtime.jsxs('div', {
          className: 'wd10-libraryHead',
          children: [
            react_jsx_runtime.jsx('div', { className: 'wd10-eyebrow', children: 'WhaleDock' }),
            react_jsx_runtime.jsx('h2', { children: '内容库' }),
            react_jsx_runtime.jsx('p', { children: projects.length === 0
              ? '建立或打开一个会话后，项目会出现在这里。'
              : `已聚合 ${projects.length} 个项目，可以跨项目切换。` })
          ]
        }), ...projects.map((project) => react_jsx_runtime.jsxs('button', {
          className: 'wd10-project',
          type: 'button',
          'aria-current': project.key === activeKey,
          onClick: () => onSelect(project),
          children: [
            react_jsx_runtime.jsx('span', { className: 'wd10-projectTitle', children: project.title }),
            react_jsx_runtime.jsxs('span', { className: 'wd10-projectMeta', children: [
              react_jsx_runtime.jsx('span', { className: 'wd10-dot', 'data-running': project.running || undefined }),
              react_jsx_runtime.jsx('span', { children: `${project.sessions.length} 个会话` }),
              project.running && react_jsx_runtime.jsx('span', { children: '进行中' })
            ] }),
            project.pathTail && react_jsx_runtime.jsx('span', { className: 'wd10-projectPath', children: project.pathTail })
          ]
        }, project.key))]
      });
    }

    function stageCopy(tab, title) {
      return (STAGE_COPY.get(tab) || STAGE_COPY.get('overview'))(title);
    }

    function draftFeedback(result) {
      if (result?.ok === true) return '已填入右侧输入框；确认后直接发送。';
      if (result?.code === 'draft-not-empty') return '右侧已有未发送内容，为避免覆盖，本次没有填入。';
      if (result?.code === 'workspace-unavailable') return '项目工作区暂时不可用，没有创建或切换会话。';
      if (result?.code === 'session-unavailable' && result.reason === 'service') return '会话服务尚未就绪，请稍后重试。';
      if (result?.code === 'session-unavailable' && result.reason === 'input') return '会话已建立，但输入框尚未挂载；本次没有写入或切换。';
      if (result?.code === 'session-unavailable') return '这个项目没有可用的代表会话，或目标会话已经失效。';
      return '操作没有完成，请稍后重试。';
    }

    function CreatorDetail({ project, tab, onTab, projectActions, alignment, onAlign }) {
      const [feedback, setFeedback] = react.useState('');
      const [pending, setPending] = react.useState(false);
      const pendingRef = react.useRef(false);
      const feedbackAttempt = react.useRef(0);
      const pendingAbort = react.useRef(null);
      react.useEffect(() => {
        feedbackAttempt.current += 1;
        pendingAbort.current?.abort();
        pendingAbort.current = null;
        pendingRef.current = false;
        setPending(false);
        setFeedback('');
        return () => {
          feedbackAttempt.current += 1;
          pendingAbort.current?.abort();
          pendingAbort.current = null;
          pendingRef.current = false;
        };
      }, [project?.key, tab]);
      if (project === undefined) {
        return react_jsx_runtime.jsx('div', { className: 'wd10-detail', children:
          react_jsx_runtime.jsx('div', { className: 'wd10-empty', children:
            '还没有可展示的项目。先在右侧建立一个会话，鲸坞会自动把它归入内容库。' }) });
      }
      const fillDraft = async () => {
        if (pendingRef.current) return;
        pendingRef.current = true;
        setPending(true);
        const operation = new AbortController();
        pendingAbort.current = operation;
        const attempt = ++feedbackAttempt.current;
        setFeedback('正在对账项目与右侧会话…');
        try {
          const result = await projectActions.fillDraft(
            project.representativeId, stageCopy(tab, project.title),
            project.workspaceId, operation.signal
          );
          if (feedbackAttempt.current === attempt) setFeedback(draftFeedback(result));
        } catch (_error) {
          if (feedbackAttempt.current === attempt) {
            setFeedback('操作意外中断，请重试；本次没有自动发送。');
          }
        } finally {
          if (pendingAbort.current === operation) {
            pendingAbort.current = null;
            pendingRef.current = false;
            setPending(false);
          }
        }
      };
      return react_jsx_runtime.jsxs('div', { className: 'wd10-detail', children: [
        alignment && react_jsx_runtime.jsxs('div', { className: 'wd10-banner', role: 'alert', children: [
          react_jsx_runtime.jsxs('span', { children: [
            '右栏当前在《', alignment.currentTitle, '》，不是你选的《', project.title, '》。',
            alignment.error || ''
          ] }),
          react_jsx_runtime.jsx('button', { type: 'button', disabled: alignment.pending,
            onClick: onAlign, children: alignment.pending ? '正在对齐…' : '一键对齐' })
        ] }),
        react_jsx_runtime.jsxs('header', { className: 'wd10-detailHead', children: [
          react_jsx_runtime.jsx('div', { className: 'wd10-eyebrow', children: '当前项目' }),
          react_jsx_runtime.jsx('h1', { children: project.title }),
          react_jsx_runtime.jsx('p', { children:
            `${project.sessions.length} 个会话已聚合 · ${project.running ? '有任务正在进行' : '可继续推进'}` })
        ] }),
        react_jsx_runtime.jsx('nav', { className: 'wd10-tabs', 'aria-label': '项目阶段', children:
          CREATOR_TABS.map(([id, label]) => react_jsx_runtime.jsx('button', {
            type: 'button', 'aria-selected': tab === id, onClick: () => onTab(id), children: label
          }, id)) }),
        react_jsx_runtime.jsxs('main', { className: 'wd10-panel', children: [
          react_jsx_runtime.jsxs('section', { className: 'wd10-card', children: [
            react_jsx_runtime.jsx('h3', { children:
              CREATOR_TABS.find(([id]) => id === tab)?.[1] || '概览' }),
            react_jsx_runtime.jsx('p', { children:
              '工作台和原生对话同屏。点击下方操作会先对账项目会话，再把任务放入右侧草稿，不覆盖已有草稿。' }),
            react_jsx_runtime.jsxs('div', { className: 'wd10-stats', children: [
              react_jsx_runtime.jsxs('div', { className: 'wd10-stat', children: [
                react_jsx_runtime.jsx('strong', { children: project.sessions.length }),
                react_jsx_runtime.jsx('span', { children: '项目会话' })
              ] }),
              react_jsx_runtime.jsxs('div', { className: 'wd10-stat', children: [
                react_jsx_runtime.jsx('strong', { children: project.running ? '1' : '0' }),
                react_jsx_runtime.jsx('span', { children: '进行中' })
              ] })
            ] })
          ] }),
          react_jsx_runtime.jsxs('section', { className: 'wd10-card', children: [
            react_jsx_runtime.jsx('h3', { children: '与 AI 继续' }),
            react_jsx_runtime.jsxs('button', { className: 'wd10-action', type: 'button',
              disabled: pending, 'aria-busy': pending || undefined, onClick: fillDraft, children: [
                pending ? '正在填入…' : '填入右侧草稿',
                react_jsx_runtime.jsx('small', { children: '你确认后才会发送，不会自动投递' })
              ] }),
            feedback && react_jsx_runtime.jsx('p', { className: 'wd10-feedback', role: 'status', children: feedback })
          ] })
        ] })
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
      const { preferences, projectActions } = integration;
      const [mode, setMode] = react.useState('sessions');
      const [hintSeen, setHintSeen] = react.useState(false);
      const [preferenceError, setPreferenceError] = react.useState('');
      const [contentLeftView, setContentLeftView] = react.useState('library');
      const [activeProjectKey, setActiveProjectKey] = react.useState(null);
      const [creatorTab, setCreatorTab] = react.useState('overview');
      const [alignmentPending, setAlignmentPending] = react.useState(false);
      const [alignmentError, setAlignmentError] = react.useState('');
      const alignmentAttempt = react.useRef(0);
      const alignmentCurrent = react.useRef(sessionState.current);
      const currentProject = sessionState.current === undefined ? undefined
        : projects.find((project) => project.sessionIds.includes(sessionState.current));
      const currentProjectKey = currentProject?.key || null;

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
        const activeProject = projects.find((project) => project.key === activeProjectKey)
          || projects[0];
        const mismatch = activeProject !== undefined && activeProject.key !== currentProjectKey;
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
                    projects, activeKey: activeProject?.key,
                    onSelect: (project) => { void alignProject(project, false); }
                  }) }),
              react_jsx_runtime.jsx('div', { className: 'wd10-nativeSidebar',
                hidden: contentLeftView !== 'native', children: mount.renderSidebar(left) })
            ] }),
            react_jsx_runtime.jsx(CreatorDetail, {
              project: activeProject,
              tab: creatorTab,
              onTab: setCreatorTab,
              projectActions,
              alignment: mismatch ? {
                currentTitle: currentProject?.title
                  || sessionState.byId[sessionState.current]?.displayTitle || '未选择会话',
                pending: alignmentPending,
                error: alignmentError
              } : null,
              onAlign: () => { void alignProject(activeProject, true); }
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

    function createContentShell(ctx, preferences) {
      return Object.freeze({
        contract: SHELL_CONTRACT,
        Component: WhaleDockContentShell,
        preferences,
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
      let disposeContentShell = () => {};
      let disposeShellStyle = () => {};
      try {
        const shell = createContentShell(ctx, preferences);
        const dispose = ctx.reflect.provide('whaledockContentShell', shell);
        if (typeof dispose === 'function') disposeContentShell = dispose;
        disposeShellStyle = installShellStyle();
      } catch (_error) { /* 内容挂载失败时 layout 保持官方三栏，context gate 继续生效 */ }
      ctx.effect(() => () => {
        try { disposeShellStyle(); } catch (_error) { /* 样式清理失败不阻断协议释放 */ }
        try { disposeContentShell(); } catch (_error) { /* 官方三栏仍可接管回退 */ }
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
