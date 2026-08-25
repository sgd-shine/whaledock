'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  context-poc-layout: ${name}`);
  } catch (error) {
    console.error(`FAIL  context-poc-layout: ${name}`);
    throw error;
  }
}

function sameDeps(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => Object.is(value, right[index]));
}

function makeRenderer(React, jsxRuntime, options = {}) {
  const fibers = new Map();
  const unmounts = [];
  let active = null;

  function cellAt(kind) {
    assert(active, `${kind} called outside a component`);
    const index = active.cursor++;
    return { index, cell: active.fiber.cells[index] };
  }

  const renderer = {
    dirty: false,
    pendingEffects: [],
    visited: new Set(),
    current: null,
    unmounts,
    useState(initial) {
      const { index, cell } = cellAt('useState');
      if (cell === undefined) {
        let value = typeof initial === 'function' ? initial() : initial;
        if (typeof options.creatorTab === 'string' && value === 'overview') {
          value = options.creatorTab;
        }
        active.fiber.cells[index] = { kind: 'state', value };
      }
      const state = active.fiber.cells[index];
      return [state.value, (next) => {
        const value = typeof next === 'function' ? next(state.value) : next;
        if (!Object.is(value, state.value)) {
          state.value = value;
          renderer.dirty = true;
        }
      }];
    },
    useRef(initial) {
      const { index, cell } = cellAt('useRef');
      if (cell === undefined) active.fiber.cells[index] = { kind: 'ref', value: { current: initial } };
      return active.fiber.cells[index].value;
    },
    useMemo(factory, deps) {
      const { index, cell } = cellAt('useMemo');
      if (cell === undefined || !sameDeps(cell.deps, deps)) {
        active.fiber.cells[index] = { kind: 'memo', deps, value: factory() };
      }
      return active.fiber.cells[index].value;
    },
    useCallback(callback, deps) { return renderer.useMemo(() => callback, deps); },
    useEffect(effect, deps) {
      const { index, cell } = cellAt('useEffect');
      if (cell === undefined || !sameDeps(cell.deps, deps)) {
        renderer.pendingEffects.push({ fiber: active.fiber, index, effect, deps });
      }
    },
    visit(value, route) {
      if (value === null || value === undefined || typeof value === 'boolean') return value;
      if (typeof value === 'string' || typeof value === 'number') return value;
      if (Array.isArray(value)) {
        return value.map((child, index) => renderer.visit(
          child,
          `${route}.${child && child.key !== undefined ? `$${String(child.key)}` : index}`
        ));
      }
      if (!value || value.$$element !== true) return value;
      if (value.type === jsxRuntime.Fragment) return renderer.visit(value.props.children, `${route}.fragment`);
      if (typeof value.type === 'function') {
        const name = value.type.name || 'Anonymous';
        const id = `${route}:${name}`;
        let fiber = fibers.get(id);
        if (fiber === undefined) {
          fiber = { id, name, cells: [] };
          fibers.set(id, fiber);
        }
        renderer.visited.add(id);
        const previous = active;
        active = { fiber, cursor: 0 };
        const output = value.type(value.props);
        active = previous;
        return renderer.visit(output, `${route}.output`);
      }
      const props = { ...value.props };
      if (Object.prototype.hasOwnProperty.call(props, 'children')) {
        props.children = renderer.visit(props.children, `${route}.children`);
      }
      return { type: value.type, key: value.key, props };
    },
    render(Component, props) {
      let tree;
      for (let pass = 0; pass < 12; pass += 1) {
        renderer.dirty = false;
        renderer.pendingEffects = [];
        renderer.visited = new Set();
        renderer.current = renderer;
        tree = renderer.visit(jsxRuntime.jsx(Component, props), 'root');
        renderer.current = null;
        for (const [id, fiber] of fibers) {
          if (renderer.visited.has(id)) continue;
          for (const cell of fiber.cells) if (cell?.kind === 'effect') cell.cleanup?.();
          fibers.delete(id);
          unmounts.push(fiber.name);
        }
        for (const item of renderer.pendingEffects) {
          const old = item.fiber.cells[item.index];
          if (old?.kind === 'effect') old.cleanup?.();
          const cleanup = item.effect();
          item.fiber.cells[item.index] = {
            kind: 'effect', deps: item.deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined
          };
        }
        if (!renderer.dirty) return tree;
      }
      throw new Error('micro renderer exceeded rerender limit');
    },
    fiberIds(name) {
      return [...fibers.values()].filter((fiber) => fiber.name === name).map((fiber) => fiber.id);
    }
  };

  Object.assign(React, {
    useState: (...args) => renderer.useState(...args),
    useRef: (...args) => renderer.useRef(...args),
    useMemo: (...args) => renderer.useMemo(...args),
    useCallback: (...args) => renderer.useCallback(...args),
    useEffect: (...args) => renderer.useEffect(...args),
    useLayoutEffect: (...args) => renderer.useEffect(...args)
  });
  return renderer;
}

function loadBundle(services = {}, options = {}) {
  const layoutSource = fs.readFileSync(path.join(
    __dirname, '..', 'context-poc', 'forks', 'ui-layout', 'lib', 'client.js'
  ), 'utf8');
  const pluginSource = fs.readFileSync(path.join(
    __dirname, '..', 'context-poc', 'plugin', 'lib', 'client.js'
  ), 'utf8');
  const definitions = new Map();
  const Fragment = Symbol('Fragment');
  const makeElement = (type, props, key) => ({ $$element: true, type, key, props: props || {} });
  const jsxRuntime = { Fragment, jsx: makeElement, jsxs: makeElement };
  const React = {};
  const timerLog = [];
  const timers = new Map();
  let timerSequence = 0;
  const sandbox = {
    AbortController,
    window: { innerWidth: options.width || 1400, __ModuleLoader__: {
      load(value) { definitions.set(value.id, value); }
    } },
    setTimeout(fn, delay) {
      timerLog.push(delay);
      options.onTimer?.(delay);
      const id = ++timerSequence;
      timers.set(id, { fn, delay });
      if (delay === 50) {
        timers.delete(id);
        fn();
      }
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    console
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(pluginSource, sandbox, { filename: 'context-poc/client.js' });
  vm.runInNewContext(layoutSource, sandbox, { filename: 'ui-layout/client.js' });
  const requireModule = (specifier) => {
    if (specifier === 'react') return React;
    if (specifier === 'react/jsx-runtime') return jsxRuntime;
    if (specifier === '@deepseek-ai/dsh-client-runtime/client') {
      return { defineStore: (value) => value };
    }
    throw new Error(`unexpected import: ${specifier}`);
  };
  const contextDefinition = definitions.get('@whaledock/context-bridge-poc');
  const layoutDefinition = definitions.get('@deepseek-ai/dsh-client-ui-layout');
  assert(contextDefinition, 'context module definition was not registered');
  assert(layoutDefinition, 'layout module definition was not registered');
  const contextPlugin = contextDefinition.factory(requireModule);
  const integration = options.noShell ? undefined : contextPlugin.createContentShell({
    get: (name) => services[name]
  }, services.whaledockShellPreferences, services.whaledockWorkspaceFiles);
  const plugin = layoutDefinition.factory(requireModule);
  let registration;
  plugin.apply({
    get: (name) => (name === 'whaledockContentShell' ? integration : services[name]),
    effect(factory, label) {
      if (label === 'ui-layout: service + root registration') return factory();
      return undefined;
    },
    reflect: { provide: () => () => {} },
    slots: {
      register(spec, component) {
        registration = { spec, component };
        return () => {};
      }
    }
  });
  assert(registration, 'root slot was not registered');
  const layoutActions = {
    setSidebar() {}, setDetails() {}, toggleSidebar() {}, setNarrow() {}, openDetails() {}, closeDetails() {}
  };
  const injected = registration.spec.inject(layoutActions);
  assert.equal(injected.getWhaleDockShell(), integration);
  return {
    AppFrame: registration.component,
    integration,
    projectActions: integration?.projectActions,
    renderer: makeRenderer(React, jsxRuntime, options),
    timerLog,
    timers,
    jsxRuntime
  };
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return node.props ? textOf(node.props.children) : '';
}

function findAll(node, predicate, output = []) {
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, output);
    return output;
  }
  if (!node || typeof node !== 'object') return output;
  if (predicate(node)) output.push(node);
  if (node.props) findAll(node.props.children, predicate, output);
  return output;
}

function button(tree, label) {
  const found = findAll(tree, (node) => node.type === 'button' && textOf(node) === label);
  assert.equal(found.length, 1, `expected one button named ${label}, got ${found.length}`);
  return found[0];
}

function classNode(tree, className) {
  const found = findAll(tree, (node) => String(node.props?.className || '').split(/\s+/u).includes(className));
  assert.equal(found.length, 1, `expected one .${className}, got ${found.length}`);
  return found[0];
}

function preference(initial) {
  let snapshot = { ...initial };
  const listeners = new Set();
  const writes = [];
  return {
    writes,
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async write(patch) {
      writes.push({ ...patch });
      snapshot = { ...snapshot, ...patch };
      for (const listener of listeners) listener(snapshot);
      return { ok: true };
    }
  };
}

function session(id, cwd, extra = {}) {
  return {
    id, cwd, displayTitle: id, blank: false, running: false, origin: 'root', ...extra
  };
}

function uiProps(state, integration, slotCalls) {
  return {
    useStore: (selector) => selector(state.panels),
    useSessions: (selector) => selector(state.sessions),
    useWorkspaces: (selector) => selector(state.workspaces),
    actions: {
      setSidebar() {}, setDetails() {}, toggleSidebar() {}, setNarrow() {}, openDetails() {}, closeDetails() {}
    },
    renderSlot(name, props) {
      slotCalls.push({ name, props });
      return { $$element: true, type: 'slot', props: { name, ...props } };
    },
    getWhaleDockShell: () => integration
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function fulfilled(result) {
  const neutral = (value) => {
    if (Array.isArray(value)) return value.map(neutral);
    if (value && typeof value === 'object') {
      const copy = Object.create(null);
      for (const [key, child] of Object.entries(value)) copy[key] = neutral(child);
      return copy;
    }
    return value;
  };
  return neutral({ state: 'fulfilled', code: null, result });
}

async function settle(harness, props) {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  return harness.renderer.render(harness.AppFrame, props);
}

function catalog(projects, nextCursor = null, projectCount = projects.length) {
  return fulfilled({ kind: 'catalog', projects, nextCursor, projectCount });
}

function contentProject(hex, title, workflowLabel = '进行中', extra = {}) {
  return {
    contentRef: `content-${hex.repeat(24).slice(0, 24)}`,
    projectToken: `project-${hex.repeat(24).slice(0, 24)}`,
    title, workflowLabel, updated: '2026-08-25 12:00', actions: [], ...extra
  };
}

async function main() {
  await test('cwd 归一化、路径尾段与代表会话选择确定', async () => {
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: {
        ids: ['z', 'a', 'b'],
        current: 'b',
        byId: {
          z: session('z', 'C:\\work\\demo\\'),
          a: session('a', 'C:/work/demo'),
          b: session('b', '/projects/current', { updatedAt: 10 })
        }
      },
      workspaces: { items: [] }
    };
    const opened = [];
    let failOpen = true;
    const services = {
      whaledockShellPreferences: pref,
      sessions: {
        open(id) {
          opened.push(id);
          if (failOpen) throw new Error('stale target');
          state.sessions = { ...state.sessions, current: id };
        }
      }
    };
    const harness = loadBundle(services);
    const slots = [];
    const props = uiProps(state, harness.integration, slots);
    let tree = harness.renderer.render(harness.AppFrame, props);
    const projects = findAll(tree, (node) => node.type === 'button' && node.props.className === 'wd10-workspaceChoice');
    assert.equal(projects.length, 2);
    const demo = projects.find((node) => textOf(node).includes('demo'));
    assert(demo);
    assert.match(textOf(demo), /…\/work\/demo/u);
    assert.doesNotMatch(textOf(demo), /个会话/u);
    demo.props.onClick();
    assert.deepEqual(opened, ['a']);
    tree = harness.renderer.render(harness.AppFrame, props);
    let alerts = findAll(tree, (node) => node.props?.role === 'alert');
    assert.equal(alerts.length, 1);
    assert.match(textOf(alerts[0]), /右栏当前在《current》，不是你选的《demo》/u);
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.equal(findAll(tree, (node) => node.props?.role === 'alert').length, 1);
    failOpen = false;
    button(tree, '一键对齐').props.onClick();
    assert.deepEqual(opened, ['a', 'a']);
    tree = harness.renderer.render(harness.AppFrame, props);
    alerts = findAll(tree, (node) => node.props?.role === 'alert');
    assert.equal(alerts.length, 0);
    assert.equal(state.sessions.current, 'a');
  });

  await test('WorkspaceListState archivedSessionIds 同时过滤工作区与孤立项目卡', async () => {
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: {
        ids: ['active', 'archived'],
        current: 'active',
        byId: {
          active: session('active', '/projects/live'),
          archived: session('archived', '/projects/archived')
        }
      },
      workspaces: {
        items: [{
          workspaceId: 'workspace-live', title: '现用项目', path: '/projects/live',
          sessionIds: ['active', 'archived']
        }],
        archivedSessionIds: ['archived']
      }
    };
    const harness = loadBundle({ whaledockShellPreferences: pref, sessions: { open() {} } });
    const tree = harness.renderer.render(
      harness.AppFrame, uiProps(state, harness.integration, [])
    );
    const projects = findAll(tree, (node) => (
      node.type === 'button' && node.props.className === 'wd10-workspaceChoice'
    ));
    assert.equal(projects.length, 1, '归档会话不得再形成第二张 cwd 项目卡');
    assert.match(textOf(projects[0]), /现用项目/u);
    assert.doesNotMatch(textOf(projects[0]), /个会话/u);
    assert.doesNotMatch(textOf(tree), /projects\/archived/u);
  });

  await test('零会话项目仅显式对齐时 connect，迟到结果不覆盖新选择', async () => {
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const pending = deferred();
    const opened = [];
    const connected = [];
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['b'], current: 'b', byId: { b: session('b', '/projects/current', { updatedAt: 8 }) } },
      workspaces: { items: [{ workspaceId: 'empty', title: '空项目', path: '/projects/empty', sessionIds: [] }] }
    };
    const services = {
      whaledockShellPreferences: pref,
      sessions: { open(id) { opened.push(id); state.sessions = { ...state.sessions, current: id }; } },
      workspaces: { connectWorkspace(id) { connected.push(id); return pending.promise; } }
    };
    const harness = loadBundle(services);
    const props = uiProps(state, harness.integration, []);
    let tree = harness.renderer.render(harness.AppFrame, props);
    const empty = findAll(tree, (node) => node.type === 'button' && node.props.className === 'wd10-workspaceChoice')
      .find((node) => textOf(node).includes('空项目'));
    assert(empty);
    empty.props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.deepEqual(connected, []);
    assert.deepEqual(opened, []);
    button(tree, '一键对齐').props.onClick();
    assert.deepEqual(connected, ['empty']);
    tree = harness.renderer.render(harness.AppFrame, props);
    const current = findAll(tree, (node) => node.type === 'button' && node.props.className === 'wd10-workspaceChoice')
      .find((node) => textOf(node).includes('current'));
    assert(current);
    current.props.onClick();
    assert.deepEqual(opened, ['b']);
    pending.resolve('late-session');
    await pending.promise;
    await Promise.resolve();
    assert.deepEqual(opened, ['b']);
  });

  await test('原生右栏 B 切到 C 后，迟到的空项目 A 不再拉回会话', async () => {
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const pending = deferred();
    const opened = [];
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: {
        ids: ['b', 'c'],
        current: 'b',
        byId: {
          b: session('b', '/projects/native-b', { updatedAt: 8 }),
          c: session('c', '/projects/native-c', { updatedAt: 7 })
        }
      },
      workspaces: { items: [{ workspaceId: 'empty-a', title: '空项目 A', path: '/projects/empty-a', sessionIds: [] }] }
    };
    const services = {
      whaledockShellPreferences: pref,
      sessions: { open(id) { opened.push(id); state.sessions = { ...state.sessions, current: id }; } },
      workspaces: { connectWorkspace() { return pending.promise; } }
    };
    const harness = loadBundle(services);
    const props = uiProps(state, harness.integration, []);
    let tree = harness.renderer.render(harness.AppFrame, props);
    const empty = findAll(tree, (node) => node.type === 'button' && node.props.className === 'wd10-workspaceChoice')
      .find((node) => textOf(node).includes('空项目 A'));
    assert(empty);
    empty.props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    button(tree, '一键对齐').props.onClick();

    state.sessions = { ...state.sessions, current: 'c' };
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.equal(state.sessions.current, 'c');
    assert.equal(button(tree, '一键对齐').props.disabled, false);

    pending.resolve('late-a');
    await pending.promise;
    await Promise.resolve();
    assert.deepEqual(opened, []);
    assert.equal(state.sessions.current, 'c');
  });

  await test('内容态保留完整 sidebar，左视图常驻且 details 只收起不卸载', async () => {
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: false });
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const harness = loadBundle({ whaledockShellPreferences: pref, sessions: { open() {} } });
    const slots = [];
    const props = uiProps(state, harness.integration, slots);
    let tree = harness.renderer.render(harness.AppFrame, props);
    assert(slots.some((call) => call.name === 'sidebar'));
    assert(slots.some((call) => call.name === 'details'));
    assert.equal(classNode(tree, 'wd10-leftView').props.hidden, false);
    assert.equal(classNode(tree, 'wd10-nativeSidebar').props.hidden, true);
    assert.match(textOf(tree), /这里是内容库/u);
    button(tree, '知道了').props.onClick();
    await Promise.resolve();
    assert(pref.writes.some((patch) => patch.contentViewHintSeen === true));
    button(tree, '会话与设置').props.onClick();
    harness.renderer.unmounts.length = 0;
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.equal(classNode(tree, 'wd10-leftView').props.hidden, true);
    assert.equal(classNode(tree, 'wd10-nativeSidebar').props.hidden, false);
    assert(findAll(tree, (node) => node.type === 'button' && node.props.className === 'wd10-workspaceChoice').length > 0);
    assert.equal(harness.renderer.unmounts.includes('CreatorSidebar'), false);
    const closed = classNode(tree, 'wd10-contentDetails');
    assert.equal(closed.props['aria-hidden'], true);
    assert(findAll(closed, (node) => node.type === 'slot' && node.props.name === 'details').length === 1);
    const detailsIds = harness.renderer.fiberIds('DetailsColumn');
    harness.renderer.unmounts.length = 0;
    state.panels = { ...state.panels, details: 360 };
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.deepEqual(harness.renderer.fiberIds('DetailsColumn'), detailsIds);
    assert.equal(harness.renderer.unmounts.includes('DetailsColumn'), false);
    assert.equal(classNode(tree, 'wd10-contentDetails').props['aria-hidden'], false);
    slots.length = 0;
    button(tree, '会话').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    await Promise.resolve();
    assert(slots.some((call) => call.name === 'sidebar'));
    assert(pref.writes.some((patch) => patch.contentViewMode === 'sessions'));

    const noPreference = loadBundle({ sessions: { open() {} } });
    const defaultTree = noPreference.renderer.render(
      noPreference.AppFrame,
      uiProps(state, noPreference.integration, [])
    );
    const frame = findAll(defaultTree, (node) => node.props?.['data-whaledock-layout'] === 'v0.10-p1')[0];
    assert(frame);
    assert.equal(frame.props['data-whaledock-mode'], undefined);
  });

  await test('content-shell 缺失时回退 rc.2 官方三栏且 SidebarRoot 仍由原 slot 渲染', async () => {
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [], archivedSessionIds: [] }
    };
    const harness = loadBundle({}, { noShell: true });
    const slots = [];
    const tree = harness.renderer.render(
      harness.AppFrame, uiProps(state, undefined, slots)
    );
    assert.equal(findAll(tree, (node) => node.props?.['data-whaledock-layout']).length, 0);
    assert.equal(findAll(tree, (node) => node.type === 'button' && textOf(node) === '内容').length, 0);
    assert.equal(slots.filter((call) => call.name === 'sidebar').length, 1);
    assert.equal(slots.filter((call) => call.name === 'conversation').length, 1);
    assert.equal(slots.filter((call) => call.name === 'details').length, 1);
  });

  await test('fillDraft 严格 connect→input→setDraft→open，且轮询有界', async () => {
    const events = [];
    let scopeCount = 0;
    const input = {
      state: { getSnapshot() { events.push('snapshot'); return { draft: '' }; } },
      setDraft(value) { events.push(`setDraft:${value}`); }
    };
    const services = {
      workspaces: { async connectWorkspace(id) { events.push(`connect:${id}`); return 'new-session'; } },
      sessions: {
        list: { getSnapshot: () => ({ current: 'original' }) },
        scope(id) {
          events.push(`scope:${id}`);
          scopeCount += 1;
          return scopeCount < 3 ? undefined : { id };
        },
        open(id) { events.push(`open:${id}`); }
      },
      conversation: { input: { for(actx) { events.push(`input:${actx.id}`); return input; } } }
    };
    const harness = loadBundle(services, { onTimer: (delay) => events.push(`wait:${delay}`) });
    const result = await harness.projectActions.fillDraft(undefined, 'payload', 'workspace-a');
    assert.equal(result.ok, true);
    assert.deepEqual(events, [
      'connect:workspace-a',
      'scope:new-session', 'wait:50',
      'scope:new-session', 'wait:50',
      'scope:new-session', 'input:new-session',
      'snapshot', 'setDraft:payload', 'open:new-session'
    ]);
    assert.deepEqual(harness.timerLog, [50, 50]);
  });

  await test('fillDraft 错误分类精确且不覆盖空白草稿', async () => {
    const services = {};
    const harness = loadBundle(services);
    let result = await harness.projectActions.fillDraft('a', 'x');
    assert.equal(result.reason, 'service');
    services.sessions = {
      list: { getSnapshot: () => ({ current: 'original' }) },
      scope: () => ({ id: 'a' }),
      open() { throw new Error('bad target'); }
    };
    result = await harness.projectActions.fillDraft(undefined, 'x');
    assert.equal(result.reason, 'target');
    result = await harness.projectActions.fillDraft(undefined, 'x', 'missing-workspace');
    assert.equal(result.code, 'workspace-unavailable');
    services.workspaces = { async connectWorkspace() { return undefined; } };
    result = await harness.projectActions.connect('empty-workspace');
    assert.equal(result.code, 'workspace-unavailable');
    result = await harness.projectActions.fillDraft(undefined, 'x', 'empty-workspace');
    assert.equal(result.code, 'workspace-unavailable');
    services.conversation = undefined;
    result = await harness.projectActions.fillDraft('a', 'x');
    assert.equal(result.reason, 'input');
    const opened = [];
    services.sessions = {
      list: { getSnapshot: () => ({ current: 'original' }) },
      scope: () => ({ id: 'a' }),
      open: (id) => opened.push(id)
    };
    services.conversation = {
      input: { for: () => ({ state: { getSnapshot: () => ({ draft: ' ' }) }, setDraft() { throw new Error('must not write'); } }) }
    };
    result = await harness.projectActions.fillDraft('a', 'x');
    assert.equal(result.code, 'draft-not-empty');
    assert.deepEqual(opened, []);

    let draft = '';
    services.conversation = {
      input: { for: () => ({ state: { getSnapshot: () => ({ draft }) }, setDraft(value) { draft = value; } }) }
    };
    services.sessions = {
      list: { getSnapshot: () => ({ current: 'original' }) },
      scope: () => ({ id: 'a' }),
      open() { throw new Error('stale target'); }
    };
    result = await harness.projectActions.fillDraft('a', 'owned');
    assert.equal(result.reason, 'target');
    assert.equal(draft, '', 'open 失败必须清回仍由本次持有的草稿');
    services.sessions.open = () => { draft = '用户并发改稿'; throw new Error('stale target'); };
    result = await harness.projectActions.fillDraft('a', 'owned');
    assert.equal(result.reason, 'target');
    assert.equal(draft, '用户并发改稿', 'CAS 回滚不得清除并发改动');
  });

  await test('fillDraft 过期操作在 connect 后停止，不写草稿也不拉回旧会话', async () => {
    const pending = deferred();
    const events = [];
    const controller = new AbortController();
    const services = {
      workspaces: { connectWorkspace() { events.push('connect'); return pending.promise; } },
      sessions: {
        list: { getSnapshot: () => ({ current: 'original' }) },
        scope() { events.push('scope'); return { id: 'late' }; },
        open() { events.push('open'); }
      },
      conversation: { input: { for: () => ({
        state: { getSnapshot: () => ({ draft: '' }) },
        setDraft() { events.push('setDraft'); }
      }) } }
    };
    const harness = loadBundle(services);
    const operation = harness.projectActions.fillDraft(undefined, 'late', 'workspace-a', controller.signal);
    controller.abort();
    pending.resolve('late');
    const result = await operation;
    assert.equal(result.code, 'operation-stale');
    assert.deepEqual(events, ['connect']);
  });

  await test('fillDraft 期间原生右栏 B→C，迟到的空项目 A 不写草稿也不拉回会话', async () => {
    const pending = deferred();
    const events = [];
    let current = 'b';
    const services = {
      workspaces: { connectWorkspace() { events.push('connect:a'); return pending.promise; } },
      sessions: {
        list: { getSnapshot: () => ({ current }) },
        scope() { events.push('scope:a'); return { id: 'late-a' }; },
        open() { events.push('open:a'); current = 'late-a'; }
      },
      conversation: { input: { for: () => ({
        state: { getSnapshot: () => ({ draft: '' }) },
        setDraft() { events.push('setDraft:a'); }
      }) } }
    };
    const harness = loadBundle(services);
    const operation = harness.projectActions.fillDraft(undefined, 'late-a', 'workspace-a');
    current = 'c';
    pending.resolve('late-a');
    const result = await operation;
    assert.equal(result.code, 'operation-stale');
    assert.deepEqual(events, ['connect:a']);
    assert.equal(current, 'c');
  });

  await test('workspace/session identity 变化立即清旧卡且迟到 catalog 不覆盖', async () => {
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const firstRead = deferred();
    const projectA = contentProject('a', '旧工作区卡');
    const projectB = contentProject('b', '新工作区卡');
    let catalogCalls = 0;
    const workspaceFiles = { execute(operation, input) {
      if (operation === 'receipts.read') return Promise.resolve(fulfilled({
        kind: 'receipts', projectToken: input.projectToken, receipts: []
      }));
      catalogCalls += 1;
      return catalogCalls === 1 ? firstRead.promise : Promise.resolve(catalog([projectB]));
    } };
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/a') } },
      workspaces: { items: [] }
    };
    const harness = loadBundle({ whaledockShellPreferences: pref,
      whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } });
    const props = uiProps(state, harness.integration, []);
    let tree = harness.renderer.render(harness.AppFrame, props);
    assert.match(textOf(tree), /正在读取/u);
    state.sessions = { ids: ['b'], current: 'b', byId: { b: session('b', '/projects/b') } };
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.doesNotMatch(textOf(tree), /旧工作区卡/u);
    firstRead.resolve(catalog([projectA]));
    tree = await settle(harness, props);
    assert.doesNotMatch(textOf(tree), /旧工作区卡/u);
    assert.match(textOf(tree), /新工作区卡/u);
  });

  await test('真实内容卡分页、无会话计数且 contentRef 在 token 轮换后保持选择', async () => {
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const calls = [];
    const first = [
      contentProject('1', '真实卡一'), contentProject('2', '真实卡二'),
      contentProject('3', '真实卡三'), contentProject('4', '真实卡四')
    ];
    const second = [contentProject('5', '真实卡五'), contentProject('6', '真实卡六'),
      contentProject('7', '真实卡七')];
    for (const [index, project] of [...first, ...second].entries()) {
      project.contentRef = `content-${String(index + 1).repeat(24).slice(0, 24)}`;
    }
    let tokenRotated = false;
    const workspaceFiles = {
      async execute(operation, input) {
        calls.push({ operation, input: { ...input } });
        if (operation === 'receipts.read') {
          return fulfilled({ kind: 'receipts', projectToken: input.projectToken, receipts: [] });
        }
        assert.equal(operation, 'catalog.read');
        if (input.cursor === 4) return catalog(second, null, 7);
        const page = first.map((project, index) => index === 2 && tokenRotated
          ? { ...project, projectToken: `project-${'a'.repeat(24)}` } : project);
        return catalog(page, 4, 7);
      }
    };
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const harness = loadBundle({ whaledockShellPreferences: pref,
      whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } });
    const props = uiProps(state, harness.integration, []);
    let tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    assert.equal(findAll(tree, (node) => node.props?.className === 'wd10-project').length, 4,
      textOf(tree));
    assert.doesNotMatch(textOf(tree), /个会话/u);
    button(tree, '加载更多').props.onClick();
    tree = await settle(harness, props);
    assert.equal(findAll(tree, (node) => node.props?.className === 'wd10-project').length, 7);
    const third = findAll(tree, (node) => node.props?.className === 'wd10-project')
      .find((node) => textOf(node).includes('真实卡三'));
    third.props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.equal(third.props['aria-current'], false);
    tokenRotated = true;
    button(tree, '刷新内容').props.onClick();
    tree = await settle(harness, props);
    const selected = findAll(tree, (node) => node.props?.className === 'wd10-project')
      .find((node) => node.props['aria-current'] === true);
    assert.match(textOf(selected), /真实卡三/u);
    assert(calls.some((call) => call.operation === 'catalog.read' && call.input.cursor === 4));
  });

  await test('五个阶段都诚实标未完成且 TaskReceiptStrip 切 tab 不卸载', async () => {
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const project = contentProject('8', '回执项目', '拍摄中');
    project.contentRef = `content-${'8'.repeat(24)}`;
    const workspaceFiles = { async execute(operation, input) {
      if (operation === 'catalog.read') return catalog([project]);
      if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
        projectToken: input.projectToken, receipts: [{
          receiptId: 'receipt-opaque-01', targetLabel: '右栏会话', tracking: 'ready',
          trackingText: '正在等待目标事件', expectedStage: '脚本', status: 'running',
          statusText: '投递中', elapsedMs: 3200, resultCount: 0,
          pulseId: 'pulse-opaque-01'
        }] });
      if (operation === 'receipts.ack') return fulfilled({ kind: 'ok' });
      throw new Error(operation);
    } };
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const harness = loadBundle({ whaledockShellPreferences: pref,
      whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } });
    const props = uiProps(state, harness.integration, []);
    let tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    const receiptFiber = harness.renderer.fiberIds('TaskReceiptStrip')[0];
    for (const label of ['概览', '脚本', '拍摄', '发布', '复盘']) {
      button(tree, label).props.onClick();
      tree = harness.renderer.render(harness.AppFrame, props);
      assert.match(textOf(tree), /这一格还没做/u);
      assert.match(textOf(tree), /投递中/u);
      assert.equal(harness.renderer.fiberIds('TaskReceiptStrip')[0], receiptFiber);
    }
    assert.match(textOf(tree), /已用 3 秒/u);
    button(tree, '刚更新').props.onClick();
    tree = await settle(harness, props);
    assert.doesNotMatch(textOf(tree), /刚更新/u);
  });

  await test('动作先预检再明确确认，双击只提交一次并刷新 catalog', async () => {
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const project = contentProject('9', '动作项目', '待写', {
      contentRef: `content-${'9'.repeat(24)}`,
      actions: [{ id: 'write-script', label: '写脚本', hint: '发送给当前会话' }]
    });
    let catalogReads = 0;
    let submits = 0;
    let mismatch = false;
    const overrides = [];
    const workspaceFiles = { async execute(operation, input) {
      if (operation === 'catalog.read') { catalogReads += 1; return catalog([project]); }
      if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
        projectToken: input.projectToken, receipts: [] });
      if (operation === 'project.action.prepare') return fulfilled({ kind: 'preflight',
        preflightToken: 'preflight-opaque-01', targetLabel: '目标 A', workspaceLabel: 'alpha',
        workspaceMatch: mismatch ? 'mismatch' : 'match', targetRunning: true, eventTracking: 'ready',
        expiresAt: new Date(Date.now() + 60_000).toISOString() });
      if (operation === 'project.action.submit') {
        submits += 1;
        overrides.push(input.override);
        return fulfilled({ state: 'accepted', reason: 'accepted', target: '目标 A',
          receiptId: 'receipt-opaque-01' });
      }
      throw new Error(operation);
    } };
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const harness = loadBundle({ whaledockShellPreferences: pref,
      whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } });
    const props = uiProps(state, harness.integration, []);
    let tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    button(tree, '写脚本').props.onClick();
    tree = await settle(harness, props);
    assert.match(textOf(tree), /将发往 目标 A/u);
    assert.match(textOf(tree), /工作区匹配/u);
    assert.match(textOf(tree), /秒后过期/u);
    button(tree, '确认发送').props.onClick();
    button(tree, '确认发送').props.onClick();
    tree = await settle(harness, props);
    assert.equal(submits, 1);
    assert.deepEqual(overrides, [false]);
    assert(catalogReads >= 2, '成功 submit 必须触发 catalog refresh');
    assert.match(textOf(tree), /已提交/u);
    mismatch = true;
    button(tree, '写脚本').props.onClick();
    tree = await settle(harness, props);
    assert.match(textOf(tree), /工作区不匹配/u);
    button(tree, '仍然发').props.onClick();
    button(tree, '仍然发').props.onClick();
    tree = await settle(harness, props);
    assert.equal(submits, 2);
    assert.deepEqual(overrides, [false, true]);
  });

  console.log(`ALL PASS  context-poc-layout (${passed} checks)`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
