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
        if (options.creatorTab === 'toString' && value === 'overview') value = 'toString';
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
  const source = fs.readFileSync(path.join(
    __dirname, '..', 'context-poc', 'forks', 'ui-layout', 'lib', 'client.js'
  ), 'utf8');
  let definition;
  const Fragment = Symbol('Fragment');
  const makeElement = (type, props, key) => ({ $$element: true, type, key, props: props || {} });
  const jsxRuntime = { Fragment, jsx: makeElement, jsxs: makeElement };
  const React = {};
  const timerLog = [];
  const sandbox = {
    AbortController,
    window: { innerWidth: options.width || 1400, __ModuleLoader__: { load(value) { definition = value; } } },
    setTimeout(fn, delay) {
      timerLog.push(delay);
      options.onTimer?.(delay);
      fn();
      return timerLog.length;
    },
    clearTimeout() {},
    console
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: 'ui-layout/client.js' });
  assert(definition, 'layout module definition was not registered');
  const plugin = definition.factory((specifier) => {
    if (specifier === 'react') return React;
    if (specifier === 'react/jsx-runtime') return jsxRuntime;
    if (specifier === '@deepseek-ai/dsh-client-runtime/client') {
      return { defineStore: (value) => value };
    }
    throw new Error(`unexpected import: ${specifier}`);
  });
  let registration;
  plugin.apply({
    get: (name) => services[name],
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
  return {
    AppFrame: registration.component,
    projectActions: injected.projectActions,
    renderer: makeRenderer(React, jsxRuntime, options),
    timerLog,
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

function uiProps(state, projectActions, slotCalls) {
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
    projectActions
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
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
    const props = uiProps(state, harness.projectActions, slots);
    let tree = harness.renderer.render(harness.AppFrame, props);
    const projects = findAll(tree, (node) => node.type === 'button' && node.props.className === 'wd10-project');
    assert.equal(projects.length, 2);
    const demo = projects.find((node) => textOf(node).includes('demo'));
    assert(demo);
    assert.match(textOf(demo), /2 个会话/u);
    assert.match(textOf(demo), /…\/work\/demo/u);
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
    const props = uiProps(state, harness.projectActions, []);
    let tree = harness.renderer.render(harness.AppFrame, props);
    const empty = findAll(tree, (node) => node.type === 'button' && node.props.className === 'wd10-project')
      .find((node) => textOf(node).includes('空项目'));
    assert(empty);
    empty.props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.deepEqual(connected, []);
    assert.deepEqual(opened, []);
    button(tree, '一键对齐').props.onClick();
    assert.deepEqual(connected, ['empty']);
    tree = harness.renderer.render(harness.AppFrame, props);
    const current = findAll(tree, (node) => node.type === 'button' && node.props.className === 'wd10-project')
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
    const props = uiProps(state, harness.projectActions, []);
    let tree = harness.renderer.render(harness.AppFrame, props);
    const empty = findAll(tree, (node) => node.type === 'button' && node.props.className === 'wd10-project')
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
    const props = uiProps(state, harness.projectActions, slots);
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
    assert(findAll(tree, (node) => node.type === 'button' && node.props.className === 'wd10-project').length > 0);
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
      uiProps(state, noPreference.projectActions, [])
    );
    const frame = findAll(defaultTree, (node) => node.props?.['data-whaledock-layout'] === 'v0.10-p1')[0];
    assert(frame);
    assert.equal(frame.props['data-whaledock-mode'], undefined);
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

  await test('填草稿 UI 同 tick 单飞、切回会话卸载时中止旧操作且 finally 不串扰', async () => {
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const pending = deferred();
    const calls = [];
    const projectActions = {
      preferences: pref,
      open: () => ({ ok: true }),
      connect: async () => ({ ok: false }),
      fillDraft(_sessionId, copy, _workspaceId, signal) { calls.push({ copy, signal }); return pending.promise; }
    };
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const harness = loadBundle({}, { creatorTab: 'toString' });
    const props = uiProps(state, projectActions, []);
    let tree = harness.renderer.render(harness.AppFrame, props);
    const fill = classNode(tree, 'wd10-action');
    assert.match(textOf(fill), /^填入右侧草稿/u);
    const first = fill.props.onClick();
    const second = fill.props.onClick();
    assert.equal(calls.length, 1);
    assert.equal(typeof calls[0].copy, 'string');
    assert.match(calls[0].copy, /当前进展/u);
    await second;
    tree = harness.renderer.render(harness.AppFrame, props);
    const busy = classNode(tree, 'wd10-action');
    assert.match(textOf(busy), /^正在填入…/u);
    assert.equal(busy.props.disabled, true);
    assert.equal(busy.props['aria-busy'], true);
    button(tree, '会话').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(findAll(tree, (node) => node.props?.className === 'wd10-action').length, 0);
    pending.reject(new Error('test rejection'));
    await first;
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.equal(findAll(tree, (node) => node.props?.className === 'wd10-action').length, 0);
    assert.doesNotMatch(textOf(tree), /操作意外中断/u, '旧操作失败不得覆盖新阶段反馈');
  });

  console.log(`ALL PASS  context-poc-layout (${passed} checks)`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
