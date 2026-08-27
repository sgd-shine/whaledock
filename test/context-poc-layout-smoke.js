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
  if (options.document) sandbox.document = options.document;
  if (typeof options.requestAnimationFrame === 'function') {
    sandbox.requestAnimationFrame = options.requestAnimationFrame;
  }
  if (typeof options.cancelAnimationFrame === 'function') {
    sandbox.cancelAnimationFrame = options.cancelAnimationFrame;
  }
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
  }, services.whaledockShellPreferences, services.whaledockWorkspaceFiles, {
    browserOnly: options.browserOnly === true
  });
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

async function fireTimers(harness, delay, props) {
  const pending = [...harness.timers.entries()]
    .filter(([, timer]) => timer.delay === delay);
  assert(pending.length > 0, `expected at least one ${delay}ms timer`);
  for (const [id, timer] of pending) {
    harness.timers.delete(id);
    await timer.fn();
  }
  return settle(harness, props);
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

function overview(project, candidates = [], extra = {}) {
  return fulfilled({
    kind: 'overview', contentRef: project.contentRef, projectToken: project.projectToken,
    title: project.title, stage: 'topic', stageLabel: '选题', status: 'needs-decision',
    updated: '2026-08-25 12:00', decision: '请选择角度和钩子',
    angle: null, hook: null, candidateCount: candidates.length,
    cursor: 0, nextCursor: null, candidates, ...extra
  });
}

function documentPage(project, blocks = [], extra = {}) {
  return fulfilled({
    kind: 'document', projectToken: project.projectToken, title: project.title,
    stage: 'script', stageLabel: '写稿', blockCount: blocks.length,
    cursor: 0, nextCursor: null, truncated: blocks.some((block) => block.textTruncated),
    blocks, ...extra
  });
}

function proposal(project, status = null, extra = {}) {
  return fulfilled({
    kind: 'proposal', contentRef: project.contentRef, projectToken: project.projectToken,
    status, reason: null, proposalToken: null, proposalRevisionToken: null,
    revisionToken: null, title: null, intentLabel: null, before: null,
    beforeTruncated: false, after: null, afterTruncated: false,
    canAdopt: false, canReject: false, canUndo: false, submitted: null,
    target: null, ...extra
  });
}

const PUBLISH_LIGHT_DEFINITIONS = [
  ['cover', '封面'], ['title', '标题'], ['topics', '标签话题'],
  ['timing', '发布时间'], ['pinned-comment', '置顶评论'],
  ['ai-label', 'AI 内容标识'], ['published', '已由本人发布']
];

function publishChecklist(extra = {}) {
  const structureValid = extra.structureValid ?? true;
  const aiDisclosure = extra.aiDisclosure || 'unknown';
  const checked = { ...(extra.checked || {}) };
  const unavailable = new Set(extra.unavailable || []);
  const lights = PUBLISH_LIGHT_DEFINITIONS.map(([id, label]) => {
    const available = !unavailable.has(id);
    const rawChecked = checked[id] === true;
    let satisfied = available && rawChecked;
    if (id === 'ai-label') {
      satisfied = aiDisclosure === 'not-ai'
        || aiDisclosure === 'ai' && available && rawChecked;
    }
    return { id, label, available, checked: rawChecked, satisfied };
  });
  const ready = structureValid && lights.slice(0, 6).every((light) => light.satisfied);
  lights[6].satisfied = structureValid && ready && lights[6].checked;
  return {
    structureValid, ready, published: lights[6].satisfied,
    aiDisclosure, lights
  };
}

function publishSurface(project, extra = {}) {
  const stage = extra.stage || 'publish';
  const checklist = Object.prototype.hasOwnProperty.call(extra, 'checklist')
    ? extra.checklist : stage === 'publish' ? publishChecklist() : null;
  return {
    kind: 'publish', contentRef: project.contentRef,
    projectToken: project.projectToken, title: project.title,
    stage, stageLabel: extra.stageLabel || ({
      script: '写稿', shoot: '拍摄', edit: '剪辑', publish: '发布',
      topic: '选题', review: '复盘'
    }[stage] || '未分类'),
    updated: Object.prototype.hasOwnProperty.call(extra, 'updated')
      ? extra.updated : '2026-08-25 12:00',
    canCreate: ['script', 'shoot', 'edit'].includes(stage), checklist
  };
}

function tactic(hex, title, extra = {}) {
  return {
    contentRef: `content-${hex.repeat(24).slice(0, 24)}`,
    projectToken: `project-${hex.repeat(24).slice(0, 24)}`,
    title, summary: `${title} 的本地摘要`, summaryTruncated: false,
    sourceTitle: '真实本地复盘', updated: '2026-08-25 12:00', ...extra
  };
}

function tacticsPage(project, tactics = [], extra = {}) {
  const cursor = extra.cursor || 0;
  const itemCount = Object.prototype.hasOwnProperty.call(extra, 'itemCount')
    ? extra.itemCount : cursor + tactics.length;
  return fulfilled({
    kind: 'tactics', contentRef: project.contentRef, projectToken: project.projectToken,
    collectionToken: extra.collectionToken || `collection-${'a'.repeat(24)}`,
    itemCount, complete: extra.complete ?? true, cursor,
    nextCursor: Object.prototype.hasOwnProperty.call(extra, 'nextCursor')
      ? extra.nextCursor : null,
    tactics
  });
}

function shootRecord(hex, title, extra = {}) {
  return {
    recordRef: hex.repeat(24).slice(0, 24),
    title, confirmedCount: 2, totalShots: 3,
    missingCount: 1, retakeCount: 0, allConfirmed: false,
    ...extra
  };
}

function shootHistory(project, records = [], extra = {}) {
  const cursor = extra.cursor || 0;
  const itemCount = Object.prototype.hasOwnProperty.call(extra, 'itemCount')
    ? extra.itemCount : cursor + records.length;
  return fulfilled({
    kind: 'shoot-history', contentRef: project.contentRef,
    projectToken: project.projectToken,
    collectionToken: extra.collectionToken || `collection-${'b'.repeat(24)}`,
    itemCount, complete: extra.complete ?? true, cursor,
    nextCursor: Object.prototype.hasOwnProperty.call(extra, 'nextCursor')
      ? extra.nextCursor : null,
    records
  });
}

function shootOpen(project, state = 'opened', message = '全屏拍摄现场已打开。') {
  return fulfilled({
    kind: 'shoot-open', contentRef: project.contentRef,
    projectToken: project.projectToken, state, message
  });
}

function scriptBlock(hex, text, extra = {}) {
  return {
    blockToken: `block-${hex.repeat(24).slice(0, 24)}`,
    kind: 'paragraph', text, textTruncated: false, startLine: 5, endLine: 5,
    ...extra
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

  await test('browserOnly 默认原生会话三栏，手动页内提词 64KiB 精确有界且离开即取消 RAF', async () => {
    let workspaceCalls = 0;
    let visibilityListener = null;
    let rafSequence = 0;
    const pendingRaf = new Map();
    const cancelledRaf = [];
    const requestAnimationFrame = (callback) => {
      const id = ++rafSequence;
      pendingRaf.set(id, callback);
      return id;
    };
    const cancelAnimationFrame = (id) => {
      cancelledRaf.push(id);
      pendingRaf.delete(id);
    };
    const advanceRaf = (id, now) => {
      const callback = pendingRaf.get(id);
      assert.equal(typeof callback, 'function', `RAF ${id} 必须仍在等待`);
      pendingRaf.delete(id);
      callback(now);
    };
    const page = {
      hidden: false,
      querySelector() { return {}; },
      addEventListener(name, listener) {
        if (name === 'visibilitychange') visibilityListener = listener;
      },
      removeEventListener(name, listener) {
        if (name === 'visibilitychange' && visibilityListener === listener) {
          visibilityListener = null;
        }
      }
    };
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/browser') } },
      workspaces: { items: [] }
    };
    const harness = loadBundle({
      whaledockWorkspaceFiles: { execute() { workspaceCalls += 1; throw new Error('forbidden'); } },
      sessions: { open() {} }
    }, {
      browserOnly: true,
      document: page,
      requestAnimationFrame,
      cancelAnimationFrame
    });
    assert.equal(harness.integration.browserOnly, true);
    assert.equal(harness.integration.workspaceFiles, undefined);
    assert.equal(harness.integration.projectActions, null);
    const slots = [];
    const props = uiProps(state, harness.integration, slots);
    let tree = harness.renderer.render(harness.AppFrame, props);
    assert.match(textOf(tree), /会话页内提词/u);
    assert.doesNotMatch(textOf(tree), /手动页内提词|WhaleDock内容库/u);
    assert(slots.some((call) => call.name === 'sidebar'));
    assert(slots.some((call) => call.name === 'conversation'));
    assert(slots.some((call) => call.name === 'details'));
    assert.equal(workspaceCalls, 0);

    slots.length = 0;
    button(tree, '页内提词').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.match(textOf(tree), /手动页内提词/u);
    assert.match(textOf(tree), /不读取工作区、不创建内容身份/u);
    assert.equal(findAll(tree, (node) => node.props?.['data-browser-only-prompter']).length, 1);
    assert(slots.some((call) => call.name === 'sidebar'));
    assert(slots.some((call) => call.name === 'conversation'));
    assert(slots.some((call) => call.name === 'details'));
    const textarea = findAll(tree, (node) => node.type === 'textarea'
      && node.props?.['aria-label'] === '手动粘贴提词文本')[0];
    const asciiBoundary = 'a'.repeat(65536);
    textarea.props.onChange({ target: { value: asciiBoundary } });
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.equal(findAll(tree, (node) => node.type === 'textarea')[0].props.value, asciiBoundary,
      '精确 65536 个 ASCII 字节必须接受');
    assert.match(textOf(tree), /65536\/65536 字节/u);

    findAll(tree, (node) => node.type === 'textarea')[0]
      .props.onChange({ target: { value: `${asciiBoundary}b` } });
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.match(textOf(tree), /手动提词文本最多 64 KiB；超出部分没有载入/u);
    assert.equal(findAll(tree, (node) => node.type === 'textarea')[0].props.value, asciiBoundary,
      '65537 个 ASCII 字节必须拒绝且保留上次合法文本');

    const chineseBoundary = `${'中'.repeat(21845)}a`;
    assert.equal(Buffer.byteLength(chineseBoundary, 'utf8'), 65536);
    findAll(tree, (node) => node.type === 'textarea')[0]
      .props.onChange({ target: { value: chineseBoundary } });
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.equal(findAll(tree, (node) => node.type === 'textarea')[0].props.value, chineseBoundary,
      '含中文的精确 65536 UTF-8 字节必须接受');
    findAll(tree, (node) => node.type === 'textarea')[0]
      .props.onChange({ target: { value: `${chineseBoundary}b` } });
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.equal(findAll(tree, (node) => node.type === 'textarea')[0].props.value, chineseBoundary,
      '含中文的 65537 UTF-8 字节必须拒绝且保留上次合法文本');
    assert.match(textOf(tree), /手动提词文本最多 64 KiB；超出部分没有载入/u);

    const valid = '浏览器手动提词\n第二行';
    findAll(tree, (node) => node.type === 'textarea')[0]
      .props.onChange({ target: { value: valid } });
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.match(textOf(tree), /浏览器手动提词\s*第二行/u);
    assert.match(textOf(tree), /不保存 · 不上传/u);
    const operationCount = workspaceCalls;
    button(tree, '开始').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.equal(button(tree, '暂停').props.disabled, false);
    const hiddenInitialRaf = rafSequence;
    assert(pendingRaf.has(hiddenInitialRaf), '开始后必须存在未完成 RAF');
    advanceRaf(hiddenInitialRaf, 100);
    const hiddenPendingRaf = rafSequence;
    assert(pendingRaf.has(hiddenPendingRaf), 'RAF 回调后必须排入下一帧');
    button(tree, '0.8 倍').props.onClick();
    button(tree, '1.2 倍').props.onClick();
    button(tree, '大字').props.onClick();
    button(tree, '中字').props.onClick();
    assert(visibilityListener, 'browserOnly 页内提词必须监听页面隐藏');
    page.hidden = true;
    visibilityListener();
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.equal(button(tree, '暂停').props.disabled, true);
    assert(cancelledRaf.includes(hiddenPendingRaf), '页面隐藏必须取消未完成 RAF');
    assert.equal(pendingRaf.has(hiddenPendingRaf), false);
    button(tree, '重置').props.onClick();
    assert.equal(workspaceCalls, operationCount,
      'browserOnly 手动文本和全部控制都不得访问 workspace RPC');

    page.hidden = false;
    button(tree, '开始').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    const sessionsInitialRaf = rafSequence;
    advanceRaf(sessionsInitialRaf, 200);
    const sessionsPendingRaf = rafSequence;
    button(tree, '会话').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    assert(cancelledRaf.includes(sessionsPendingRaf), '切回会话必须取消未完成 RAF');
    assert.equal(pendingRaf.has(sessionsPendingRaf), false);

    button(tree, '页内提词').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    findAll(tree, (node) => node.type === 'textarea')[0]
      .props.onChange({ target: { value: valid } });
    tree = harness.renderer.render(harness.AppFrame, props);
    button(tree, '开始').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    const unmountInitialRaf = rafSequence;
    advanceRaf(unmountInitialRaf, 300);
    const unmountPendingRaf = rafSequence;
    function UnmountedRoot() { return null; }
    harness.renderer.render(UnmountedRoot, {});
    assert(cancelledRaf.includes(unmountPendingRaf), '组件卸载必须取消未完成 RAF');
    assert.equal(pendingRaf.has(unmountPendingRaf), false);
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

  await test('概览、脚本、拍摄、发布与复盘都接通真实能力，TaskReceiptStrip 不卸载', async () => {
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const project = contentProject('8', '回执项目', '拍摄中', { canShoot: true });
    project.contentRef = `content-${'8'.repeat(24)}`;
    const workspaceFiles = { async execute(operation, input) {
      if (operation === 'catalog.read') return catalog([project]);
      if (operation === 'overview.read') return overview(project, [{
        field: 'angle', value: '先看完成结果', selected: false
      }]);
      if (operation === 'document.read') return documentPage(project, [
        scriptBlock('1', '真实脚本文本')
      ]);
      if (operation === 'proposal.read') return proposal(project);
      if (operation === 'publish.read') return fulfilled(publishSurface(project, {
        stage: 'shoot', stageLabel: '拍摄', checklist: null
      }));
      if (operation === 'shoot.history.read') return shootHistory(project, [
        shootRecord('2', '第一次真实收工')
      ]);
      if (operation === 'shoot.open') return shootOpen(project);
      if (operation === 'review.tactics.read') return tacticsPage(project);
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
    assert.match(textOf(tree), /选题拍板/u);
    assert.match(textOf(tree), /先看完成结果/u);
    assert.doesNotMatch(textOf(tree), /这一格还没做/u);
    button(tree, '脚本').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    assert.match(textOf(tree), /真实脚本文本/u);
    assert.doesNotMatch(textOf(tree), /这一格还没做/u);
    assert.equal(harness.renderer.fiberIds('TaskReceiptStrip')[0], receiptFiber);
    button(tree, '拍摄').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.doesNotMatch(textOf(tree), /这一格还没做/u);
    assert.match(textOf(tree), /打开全屏拍摄现场/u);
    assert.match(textOf(tree), /第一次真实收工/u);
    assert.match(textOf(tree), /记录中写着：确认 2\/3、缺拍 1、重来 0/u);
    assert.match(textOf(tree), /页内简版只在当前页面滚动，不记录镜头完成状态，也不会写入拍摄记录/u);
    assert.match(textOf(tree), /投递中/u);
    assert.equal(harness.renderer.fiberIds('TaskReceiptStrip')[0], receiptFiber);
    button(tree, '复盘').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.doesNotMatch(textOf(tree), /这一格还没做/u);
    assert.match(textOf(tree), /当前“写稿”阶段不能固化/u);
    assert.match(textOf(tree), /打法只能由你从真实复盘显式固化/u);
    assert.equal(button(tree, '显式固化进打法库').props.disabled, true);
    assert.match(textOf(tree), /投递中/u);
    assert.equal(harness.renderer.fiberIds('TaskReceiptStrip')[0], receiptFiber);
    button(tree, '发布').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    assert.doesNotMatch(textOf(tree), /这一格还没做/u);
    assert.match(textOf(tree), /创建发布检查单/u);
    assert.match(textOf(tree), /鲸坞不会访问平台、代发或宣称已合规/u);
    assert.equal(harness.renderer.fiberIds('TaskReceiptStrip')[0], receiptFiber);
    assert.match(textOf(tree), /已用 3 秒/u);
    button(tree, '刚更新').props.onClick();
    tree = await settle(harness, props);
    assert.doesNotMatch(textOf(tree), /刚更新/u);
  });

  await test('拍摄页完整分页、全屏单飞与页内隐藏暂停，页内控件保持零写入', async () => {
    const project = contentProject('1', '完整口播稿', '拍摄', { canShoot: true });
    const blocks = [
      scriptBlock('1', '第一段完整台词'),
      scriptBlock('2', '第二段完整台词'),
      scriptBlock('3', '第三段完整台词')
    ];
    const records = [
      shootRecord('1', '收工一'), shootRecord('2', '收工二'),
      shootRecord('3', '收工三'), shootRecord('4', '收工四'),
      shootRecord('5', '收工五', {
        confirmedCount: 3, totalShots: 3, missingCount: 0,
        retakeCount: 2, allConfirmed: true
      })
    ];
    const opening = deferred();
    const calls = [];
    let openCalls = 0;
    const workspaceFiles = { async execute(operation, input) {
      calls.push({ operation, input: { ...input } });
      if (operation === 'catalog.read') return catalog([project]);
      if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
        projectToken: input.projectToken, receipts: [] });
      if (operation === 'document.read' && input.cursor === 0) {
        return documentPage(project, blocks.slice(0, 2), {
          blockCount: 3, nextCursor: 2, truncated: true
        });
      }
      if (operation === 'document.read' && input.cursor === 2) {
        return documentPage(project, blocks.slice(2), {
          blockCount: 3, cursor: 2, truncated: false
        });
      }
      if (operation === 'shoot.history.read' && input.cursor === 0) {
        return shootHistory(project, records.slice(0, 4), {
          itemCount: 5, nextCursor: 4,
          collectionToken: `collection-${'4'.repeat(24)}`
        });
      }
      if (operation === 'shoot.history.read' && input.cursor === 4) {
        return shootHistory(project, records.slice(4), {
          itemCount: 5, cursor: 4,
          collectionToken: `collection-${'4'.repeat(24)}`
        });
      }
      if (operation === 'shoot.open') {
        openCalls += 1;
        return opening.promise;
      }
      throw new Error(operation);
    } };
    let visibilityListener = null;
    const page = {
      hidden: false,
      querySelector() { return {}; },
      addEventListener(name, listener) {
        if (name === 'visibilitychange') visibilityListener = listener;
      },
      removeEventListener(name, listener) {
        if (name === 'visibilitychange' && visibilityListener === listener) {
          visibilityListener = null;
        }
      }
    };
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const harness = loadBundle({ whaledockShellPreferences: pref,
      whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } }, {
      creatorTab: 'shoot', document: page
    });
    const props = uiProps(state, harness.integration, []);
    let tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.match(textOf(tree), /完整口播稿 · 3\/3 块/u);
    assert.match(textOf(tree), /收工五/u);
    assert.match(textOf(tree), /记录中写着：确认 3\/3、缺拍 0、重来 2/u);
    assert.equal(button(tree, '打开页内简版').props.disabled, false);
    assert.deepEqual(calls.filter((call) => call.operation === 'document.read')
      .map((call) => call.input), [
      { projectToken: project.projectToken, cursor: 0, limit: 2 },
      { projectToken: project.projectToken, cursor: 2, limit: 2 }
    ]);
    assert.deepEqual(calls.filter((call) => call.operation === 'shoot.history.read')
      .map((call) => call.input), [
      { contentRef: project.contentRef, projectToken: project.projectToken,
        cursor: 0, limit: 4, collectionToken: null },
      { contentRef: project.contentRef, projectToken: project.projectToken,
        cursor: 4, limit: 4, collectionToken: `collection-${'4'.repeat(24)}` }
    ]);

    const native = button(tree, '打开全屏拍摄现场');
    native.props.onClick();
    native.props.onClick();
    assert.equal(openCalls, 1, 'pendingRef 必须在首个 await 前锁住全屏打开');
    opening.resolve(shootOpen(project, 'unavailable',
      '这份内容当前不能进入本地拍摄现场；没有创建拍摄会话。'));
    tree = await settle(harness, props);
    assert.match(textOf(tree), /没有创建拍摄会话。 可改用下方页内简版/u);
    assert.match(textOf(tree), /收起页内简版/u,
      'native unavailable 且全文完整时必须自动开放页内简版');
    assert.match(textOf(tree), /第一段完整台词/u);
    assert.match(textOf(tree), /第三段完整台词/u);
    const operationCount = calls.length;
    button(tree, '开始').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.equal(button(tree, '暂停').props.disabled, false);
    button(tree, '0.8 倍').props.onClick();
    button(tree, '1.2 倍').props.onClick();
    button(tree, '大字').props.onClick();
    button(tree, '中字').props.onClick();
    button(tree, '重置').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    button(tree, '开始').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    assert(visibilityListener, '拍摄页必须监听页面隐藏');
    page.hidden = true;
    visibilityListener();
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.equal(button(tree, '暂停').props.disabled, true,
      '页面隐藏必须自动暂停页内滚动');
    assert.equal(calls.length, operationCount,
      '页内开始/暂停/重置/速度/字号都不得触发 workspace 写入或任何 RPC');
  });

  await test('拍摄页只信 canShoot，其他内容在 document/history/native RPC 前停止', async () => {
    const project = contentProject('2', '不是口播稿', '写稿', { canShoot: false });
    const calls = [];
    const workspaceFiles = { async execute(operation, input) {
      calls.push({ operation, input: { ...input } });
      if (operation === 'catalog.read') return catalog([project]);
      if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
        projectToken: input.projectToken, receipts: [] });
      throw new Error(operation);
    } };
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const harness = loadBundle({ whaledockShellPreferences: pref,
      whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } }, {
      creatorTab: 'shoot'
    });
    const props = uiProps(state, harness.integration, []);
    let tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    assert.match(textOf(tree), /拍摄现场只接受 WhaleDock 明确标记的 03_口播稿/u);
    assert.doesNotMatch(textOf(tree), /打开全屏拍摄现场|页内简版提词器/u);
    assert.equal(calls.some((call) => [
      'document.read', 'shoot.history.read', 'shoot.open'
    ].includes(call.operation)), false);
  });

  await test('拍摄记录 parser 拒绝路径额外字段，正文/历史 partial 与截断都明示', async () => {
    const project = contentProject('3', '严格口播稿', '拍摄', { canShoot: true });
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const makeHarness = (mode) => {
      const workspaceFiles = { async execute(operation, input) {
        if (operation === 'catalog.read') return catalog([project]);
        if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
          projectToken: input.projectToken, receipts: [] });
        if (operation === 'document.read' && mode === 'partial' && input.cursor === 0) {
          return documentPage(project, [
            scriptBlock('3', 'partial 第一段'), scriptBlock('4', 'partial 第二段')
          ], { blockCount: 3, nextCursor: 2, truncated: true });
        }
        if (operation === 'document.read' && mode === 'partial') {
          return { state: 'rejected', code: 'operation-failed', result: null };
        }
        if (operation === 'document.read') return documentPage(project, [
          scriptBlock('5', '完整严格正文')
        ]);
        if (operation === 'shoot.history.read' && mode === 'path') {
          return shootHistory(project, [{
            ...shootRecord('6', '不得显示的路径记录'),
            relativePath: '05_拍摄记录/private-secret.md'
          }]);
        }
        if (operation === 'shoot.history.read') return shootHistory(project, [
          shootRecord('7', '只读回一条')
        ], { complete: false });
        throw new Error(operation);
      } };
      const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
      return loadBundle({ whaledockShellPreferences: pref,
        whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } }, {
        creatorTab: 'shoot'
      });
    };

    const pathHarness = makeHarness('path');
    const pathProps = uiProps(state, pathHarness.integration, []);
    let tree = pathHarness.renderer.render(pathHarness.AppFrame, pathProps);
    tree = await settle(pathHarness, pathProps);
    tree = await settle(pathHarness, pathProps);
    assert.match(textOf(tree), /本地收工记录暂时读不到/u);
    assert.doesNotMatch(textOf(tree), /private-secret|不得显示的路径记录/u);
    assert.match(textOf(tree), /严格口播稿 · 1\/1 块/u);
    assert.equal(button(tree, '打开页内简版').props.disabled, false);

    const partialHarness = makeHarness('partial');
    const partialProps = uiProps(state, partialHarness.integration, []);
    tree = partialHarness.renderer.render(partialHarness.AppFrame, partialProps);
    tree = await settle(partialHarness, partialProps);
    tree = await settle(partialHarness, partialProps);
    assert.match(textOf(tree), /严格口播稿 · 2\/3 块/u);
    assert.match(textOf(tree), /口播稿读取不完整或含截断内容；只显示已成功读取的 2\/3 块/u);
    assert.match(textOf(tree), /拍摄记录读取不完整；只显示已成功读取的 1 条 WhaleDock 本地记录/u);
    assert.equal(button(tree, '打开页内简版').props.disabled, true,
      'partial/truncated 正文不得开放页内提词器');
    assert.equal(button(tree, '打开全屏拍摄现场').props.disabled, false,
      '完整正文只约束页内降级，不应伪造 native 不可用');
  });

  await test('拍摄页 A→B→A 与 workspace 变化立即清旧视图并丢弃迟到响应', async () => {
    const projectA = contentProject('4', '口播稿 A', '拍摄', { canShoot: true });
    const projectB = contentProject('5', '口播稿 B', '拍摄', { canShoot: true });
    const delayedHistoryA = deferred();
    let documentAReads = 0;
    let historyAReads = 0;
    const workspaceFiles = { async execute(operation, input) {
      if (operation === 'catalog.read') return catalog([projectA, projectB]);
      if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
        projectToken: input.projectToken, receipts: [] });
      if (operation === 'document.read' && input.projectToken === projectA.projectToken) {
        documentAReads += 1;
        return documentPage(projectA, [scriptBlock('8', documentAReads === 1
          ? 'A 初始口播正文' : 'A 最新口播正文')]);
      }
      if (operation === 'document.read') return documentPage(projectB, [
        scriptBlock('9', 'B 当前口播正文')
      ]);
      if (operation === 'shoot.history.read' && input.contentRef === projectA.contentRef) {
        historyAReads += 1;
        return historyAReads === 1 ? delayedHistoryA.promise
          : shootHistory(projectA, [shootRecord('a', 'A 最新收工记录')], {
            collectionToken: `collection-${'a'.repeat(24)}`
          });
      }
      if (operation === 'shoot.history.read') return shootHistory(projectB, [
        shootRecord('b', 'B 当前收工记录')
      ], { collectionToken: `collection-${'b'.repeat(24)}` });
      throw new Error(operation);
    } };
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const harness = loadBundle({ whaledockShellPreferences: pref,
      whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } }, {
      creatorTab: 'shoot'
    });
    const props = uiProps(state, harness.integration, []);
    let tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    button(tree, '打开页内简版').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.match(textOf(tree), /A 初始口播正文/u);
    const card = (title) => findAll(tree, (node) => node.props?.className === 'wd10-project'
      && textOf(node).includes(title))[0];

    card('口播稿 B').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.doesNotMatch(textOf(tree), /A 初始口播正文|A 最新收工记录/u);
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.match(textOf(tree), /B 当前收工记录/u);
    button(tree, '打开页内简版').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.match(textOf(tree), /B 当前口播正文/u);

    card('口播稿 A').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.doesNotMatch(textOf(tree), /B 当前口播正文|B 当前收工记录/u);
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.equal(documentAReads, 2);
    assert.equal(historyAReads, 2);
    assert.match(textOf(tree), /A 最新收工记录/u);
    button(tree, '打开页内简版').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.match(textOf(tree), /A 最新口播正文/u);
    delayedHistoryA.resolve(shootHistory(projectA, [
      shootRecord('c', 'A 迟到收工记录')
    ], { collectionToken: `collection-${'c'.repeat(24)}` }));
    tree = await settle(harness, props);
    assert.match(textOf(tree), /A 最新口播正文|A 最新收工记录/u);
    assert.doesNotMatch(textOf(tree), /A 迟到收工记录/u);

    state.sessions = {
      ids: ['a', 'z'], current: 'z', byId: {
        ...state.sessions.byId, z: session('z', '/projects/other-workspace')
      }
    };
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.doesNotMatch(textOf(tree), /A 最新口播正文|A 最新收工记录/u,
      'workspace identity 变化必须在新读取前清空旧口播稿和记录');
  });

  await test('拍摄 native outcome-unknown 锁重试，operation-stale 清空并刷新内容库', async () => {
    const project = contentProject('6', '不确定口播稿', '拍摄', { canShoot: true });
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const makeHarness = (mode) => {
      let openCalls = 0;
      let catalogReads = 0;
      const workspaceFiles = { async execute(operation, input) {
        if (operation === 'catalog.read') {
          catalogReads += 1;
          return catalog([project]);
        }
        if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
          projectToken: input.projectToken, receipts: [] });
        if (operation === 'document.read') return documentPage(project, [
          scriptBlock('d', '必须清理的旧口播正文')
        ]);
        if (operation === 'shoot.history.read') return shootHistory(project, [
          shootRecord('e', '必须清理的旧收工记录')
        ]);
        if (operation === 'shoot.open') {
          openCalls += 1;
          return { state: 'rejected', code: mode === 'unknown'
            ? 'outcome-unknown' : 'operation-stale', result: null };
        }
        throw new Error(operation);
      } };
      const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
      return {
        get openCalls() { return openCalls; },
        get catalogReads() { return catalogReads; },
        harness: loadBundle({ whaledockShellPreferences: pref,
          whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } }, {
          creatorTab: 'shoot'
        })
      };
    };

    const unknown = makeHarness('unknown');
    const unknownProps = uiProps(state, unknown.harness.integration, []);
    let tree = unknown.harness.renderer.render(unknown.harness.AppFrame, unknownProps);
    tree = await settle(unknown.harness, unknownProps);
    tree = await settle(unknown.harness, unknownProps);
    button(tree, '打开全屏拍摄现场').props.onClick();
    tree = await settle(unknown.harness, unknownProps);
    assert.match(textOf(tree), /全屏拍摄现场可能已经打开；请先检查桌面，不要重复点击/u);
    assert.equal(button(tree, '打开全屏拍摄现场').props.disabled, true);
    button(tree, '打开全屏拍摄现场').props.onClick();
    assert.equal(unknown.openCalls, 1, 'outcome-unknown 后当前 identity 不得重试');
    button(tree, '刷新拍摄记录').props.onClick();
    tree = await settle(unknown.harness, unknownProps);
    tree = await settle(unknown.harness, unknownProps);
    assert.equal(button(tree, '打开全屏拍摄现场').props.disabled, true,
      '只读刷新不得解除 native outcome-unknown 锁');
    assert.equal(unknown.openCalls, 1);

    const stale = makeHarness('stale');
    const staleProps = uiProps(state, stale.harness.integration, []);
    tree = stale.harness.renderer.render(stale.harness.AppFrame, staleProps);
    tree = await settle(stale.harness, staleProps);
    tree = await settle(stale.harness, staleProps);
    button(tree, '打开页内简版').props.onClick();
    tree = stale.harness.renderer.render(stale.harness.AppFrame, staleProps);
    assert.match(textOf(tree), /必须清理的旧口播正文/u);
    assert.match(textOf(tree), /必须清理的旧收工记录/u);
    button(tree, '打开全屏拍摄现场').props.onClick();
    tree = await settle(stale.harness, staleProps);
    tree = await settle(stale.harness, staleProps);
    assert.match(textOf(tree), /口播稿已变化；已清空旧拍摄视图并刷新内容库/u);
    assert.doesNotMatch(textOf(tree), /必须清理的旧口播正文|必须清理的旧收工记录/u);
    assert(stale.catalogReads >= 2, 'operation-stale 必须触发 catalog refresh');
    assert.equal(button(tree, '打开全屏拍摄现场').props.disabled, true);
  });

  await test('复盘正文与打法墙自动分页，后页失败保留真实 partial 且不开放固化', async () => {
    const project = contentProject('9', '真实复盘项目', '复盘');
    const blocks = [
      scriptBlock('1', '复盘结论第一块', { kind: 'heading', startLine: 5, endLine: 5 }),
      scriptBlock('2', '复盘结论第二块', { startLine: 6, endLine: 7 }),
      scriptBlock('3', '复盘结论第三块', { startLine: 8, endLine: 9 })
    ];
    const tactics = [
      tactic('a', '打法一'), tactic('b', '打法二'), tactic('c', '打法三'),
      tactic('d', '打法四'), tactic('e', '打法五', { summary: null })
    ];
    const makeHarness = (failTail) => {
      const calls = [];
      const workspaceFiles = { async execute(operation, input) {
        calls.push({ operation, input: { ...input } });
        if (operation === 'catalog.read') return catalog([project]);
        if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
          projectToken: input.projectToken, receipts: [] });
        if (operation === 'document.read' && input.cursor === 0) {
          return documentPage(project, blocks.slice(0, 2), {
            stage: 'review', stageLabel: '复盘', blockCount: 3, nextCursor: 2
          });
        }
        if (operation === 'document.read' && input.cursor === 2) {
          return documentPage(project, blocks.slice(2), {
            stage: 'review', stageLabel: '复盘', blockCount: 3, cursor: 2
          });
        }
        if (operation === 'review.tactics.read' && input.cursor === 0) {
          return tacticsPage(project, tactics.slice(0, 4), {
            itemCount: 5, nextCursor: 4, complete: !failTail,
            collectionToken: `collection-${'b'.repeat(24)}`
          });
        }
        if (operation === 'review.tactics.read' && input.cursor === 4) {
          if (failTail) throw new Error('tactic tail unavailable');
          return tacticsPage(project, tactics.slice(4), {
            itemCount: 5, cursor: 4, collectionToken: `collection-${'b'.repeat(24)}`
          });
        }
        throw new Error(operation);
      } };
      const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
      return { calls, harness: loadBundle({ whaledockShellPreferences: pref,
        whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } }, {
        creatorTab: 'review'
      }) };
    };
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const full = makeHarness(false);
    const props = uiProps(state, full.harness.integration, []);
    let tree = full.harness.renderer.render(full.harness.AppFrame, props);
    tree = await settle(full.harness, props);
    tree = await settle(full.harness, props);
    tree = await settle(full.harness, props);
    assert.match(textOf(tree), /复盘结论第一块/u);
    assert.match(textOf(tree), /复盘结论第三块/u);
    assert.match(textOf(tree), /打法一/u);
    assert.match(textOf(tree), /打法五/u);
    assert.match(textOf(tree), /这条本地打法没有可显示的摘要/u);
    assert.match(textOf(tree), /打法只能由你从真实复盘显式固化。/u);
    assert.match(textOf(tree), /一期没有平台数据通道；以下都是本地文件，不显示播放量、评论聚类、使用次数或胜率。/u);
    assert.equal(button(tree, '显式固化进打法库').props.disabled, false);
    assert.deepEqual(full.calls.filter((call) => call.operation === 'document.read')
      .map((call) => call.input), [
      { projectToken: project.projectToken, cursor: 0, limit: 2 },
      { projectToken: project.projectToken, cursor: 2, limit: 2 }
    ]);
    assert.deepEqual(full.calls.filter((call) => call.operation === 'review.tactics.read')
      .map((call) => call.input), [
      { contentRef: project.contentRef, projectToken: project.projectToken,
        cursor: 0, limit: 4, collectionToken: null },
      { contentRef: project.contentRef, projectToken: project.projectToken,
        cursor: 4, limit: 4, collectionToken: `collection-${'b'.repeat(24)}` }
    ]);

    const partial = makeHarness(true);
    const partialProps = uiProps(state, partial.harness.integration, []);
    tree = partial.harness.renderer.render(partial.harness.AppFrame, partialProps);
    tree = await settle(partial.harness, partialProps);
    tree = await settle(partial.harness, partialProps);
    tree = await settle(partial.harness, partialProps);
    assert.match(textOf(tree), /打法一/u);
    assert.doesNotMatch(textOf(tree), /打法五/u);
    assert.match(textOf(tree), /打法库读取不完整；只显示已成功读取的 4 条本地条目/u);
    assert.equal(button(tree, '显式固化进打法库').props.disabled, true);
  });

  await test('复盘固化双击单飞，返回打法立即 upsert 高亮且 created:false 不伪造新增', async () => {
    const project = contentProject('1', '待固化复盘', '复盘');
    const existing = tactic('2', '既有打法');
    const returned = tactic('3', '刚固化的打法');
    const creation = deferred();
    const freshWall = deferred();
    let wallReads = 0;
    let solidifyCalls = 0;
    const calls = [];
    const workspaceFiles = { async execute(operation, input) {
      calls.push({ operation, input: { ...input } });
      if (operation === 'catalog.read') return catalog([project]);
      if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
        projectToken: input.projectToken, receipts: [] });
      if (operation === 'document.read') return documentPage(project, [
        scriptBlock('4', '这是真实复盘正文')
      ], { stage: 'review', stageLabel: '复盘' });
      if (operation === 'review.tactics.read') {
        wallReads += 1;
        if (wallReads === 1) return tacticsPage(project, [existing], {
          collectionToken: `collection-${'a'.repeat(24)}`
        });
        if (wallReads === 2) return freshWall.promise;
        return tacticsPage(project, [returned, existing], {
          collectionToken: `collection-${'c'.repeat(24)}`
        });
      }
      if (operation === 'review.solidify') {
        solidifyCalls += 1;
        if (solidifyCalls === 1) return creation.promise;
        return fulfilled({
          kind: 'review-solidify', created: false,
          sourceContentRef: project.contentRef, sourceProjectToken: project.projectToken,
          tactic: returned, message: '已找到同一复盘修订对应的本地打法。'
        });
      }
      throw new Error(operation);
    } };
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const harness = loadBundle({ whaledockShellPreferences: pref,
      whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } }, {
      creatorTab: 'review'
    });
    const props = uiProps(state, harness.integration, []);
    let tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    const solidify = button(tree, '显式固化进打法库');
    solidify.props.onClick();
    solidify.props.onClick();
    assert.equal(solidifyCalls, 1, 'pendingRef 必须在首个 await 前锁住复盘固化');
    creation.resolve(fulfilled({
      kind: 'review-solidify', created: true,
      sourceContentRef: project.contentRef, sourceProjectToken: project.projectToken,
      tactic: returned, message: '已显式固化进本地打法库。'
    }));
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.match(textOf(tree), /刚固化的打法/u,
      '必须使用 mutation 返回 tactic 立即 upsert，不能等待分页刷新');
    let returnedCard = findAll(tree, (node) => node.props?.['data-tactic-ref']
      === returned.contentRef)[0];
    assert(returnedCard);
    assert.equal(returnedCard.props['data-highlight'], true);
    assert.equal(button(tree, '显式固化进打法库').props.disabled, true,
      'fresh page0 对账完成前不得再次写入');
    const selected = findAll(tree, (node) => node.props?.className === 'wd10-project'
      && node.props['aria-current'] === true)[0];
    assert.match(textOf(selected), /待固化复盘/u, '固化后必须保持 review 源卡选中');
    freshWall.resolve(tacticsPage(project, [returned, existing], {
      collectionToken: `collection-${'c'.repeat(24)}`
    }));
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.equal(button(tree, '显式固化进打法库').props.disabled, false);
    returnedCard = findAll(tree, (node) => node.props?.['data-tactic-ref']
      === returned.contentRef)[0];
    assert.equal(returnedCard.props['data-highlight'], true);

    button(tree, '显式固化进打法库').props.onClick();
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.equal(solidifyCalls, 2);
    assert.match(textOf(tree), /已定位既有打法；没有重复创建/u);
    assert.equal(findAll(tree, (node) => node.props?.className === 'wd10-tactic').length, 2,
      'created:false 只能定位并 upsert 既有打法，不能伪造第三张卡');
    assert.deepEqual(calls.filter((call) => call.operation === 'review.solidify')
      .map((call) => call.input), [
      { contentRef: project.contentRef, projectToken: project.projectToken },
      { contentRef: project.contentRef, projectToken: project.projectToken }
    ]);
    assert.equal(calls.some((call) => call.operation === 'receipts.ack'), false,
      '本地固化不得伪造 agent receipt');
  });

  await test('复盘页 A→B→A 与 workspace 变化立即清旧视图并丢弃迟到响应', async () => {
    const projectA = contentProject('4', '复盘 A', '复盘');
    const projectB = contentProject('5', '复盘 B', '复盘');
    const delayedTacticsA = deferred();
    let documentAReads = 0;
    let tacticsAReads = 0;
    const workspaceFiles = { async execute(operation, input) {
      if (operation === 'catalog.read') return catalog([projectA, projectB]);
      if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
        projectToken: input.projectToken, receipts: [] });
      if (operation === 'document.read' && input.projectToken === projectA.projectToken) {
        documentAReads += 1;
        return documentPage(projectA, [scriptBlock('6', documentAReads === 1
          ? 'A 初始复盘正文' : 'A 最新复盘正文')], {
          stage: 'review', stageLabel: '复盘'
        });
      }
      if (operation === 'document.read') return documentPage(projectB, [
        scriptBlock('7', 'B 当前复盘正文')
      ], { stage: 'review', stageLabel: '复盘' });
      if (operation === 'review.tactics.read' && input.contentRef === projectA.contentRef) {
        tacticsAReads += 1;
        return tacticsAReads === 1 ? delayedTacticsA.promise
          : tacticsPage(projectA, [tactic('8', 'A 最新打法')], {
            collectionToken: `collection-${'d'.repeat(24)}`
          });
      }
      if (operation === 'review.tactics.read') return tacticsPage(projectB, [
        tactic('9', 'B 当前打法')
      ], { collectionToken: `collection-${'e'.repeat(24)}` });
      throw new Error(operation);
    } };
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const harness = loadBundle({ whaledockShellPreferences: pref,
      whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } }, {
      creatorTab: 'review'
    });
    const props = uiProps(state, harness.integration, []);
    let tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    const card = (title) => findAll(tree, (node) => node.props?.className === 'wd10-project'
      && textOf(node).includes(title))[0];
    card('复盘 B').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.doesNotMatch(textOf(tree), /A 最新|A 迟到/u);
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.match(textOf(tree), /B 当前复盘正文/u);
    assert.match(textOf(tree), /B 当前打法/u);
    card('复盘 A').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.doesNotMatch(textOf(tree), /B 当前复盘正文|B 当前打法/u,
      '切回同一 contentRef 前缀的 A 也必须立即清 B');
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.equal(documentAReads, 2);
    assert.equal(tacticsAReads, 2);
    assert.match(textOf(tree), /A 最新复盘正文/u);
    assert.match(textOf(tree), /A 最新打法/u);
    delayedTacticsA.resolve(tacticsPage(projectA, [tactic('b', 'A 迟到打法')], {
      collectionToken: `collection-${'f'.repeat(24)}`
    }));
    tree = await settle(harness, props);
    assert.match(textOf(tree), /A 最新复盘正文/u);
    assert.match(textOf(tree), /A 最新打法/u);
    assert.doesNotMatch(textOf(tree), /A 迟到打法/u);

    state.sessions = {
      ids: ['a', 'z'], current: 'z', byId: {
        ...state.sessions.byId, z: session('z', '/projects/other-workspace')
      }
    };
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.doesNotMatch(textOf(tree), /A 最新复盘正文|A 最新打法/u,
      'workspace identity 变化必须在新读取前清空旧复盘与打法墙');
  });

  await test('复盘 solidify outcome-unknown 保留旧视图并锁写，stale 清空且刷新', async () => {
    const project = contentProject('6', '不确定复盘', '复盘');
    const oldTactic = tactic('7', '已验证旧打法');
    const makeHarness = (mode) => {
      let solidifyCalls = 0;
      let catalogReads = 0;
      const workspaceFiles = { async execute(operation, input) {
        if (operation === 'catalog.read') {
          catalogReads += 1;
          return catalog([project]);
        }
        if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
          projectToken: input.projectToken, receipts: [] });
        if (operation === 'document.read') return documentPage(project, [
          scriptBlock('8', '保留的真实复盘正文')
        ], { stage: 'review', stageLabel: '复盘' });
        if (operation === 'review.tactics.read') return tacticsPage(project, [oldTactic], {
          collectionToken: `collection-${'8'.repeat(24)}`
        });
        if (operation === 'review.solidify') {
          solidifyCalls += 1;
          return { state: 'rejected', code: mode === 'unknown'
            ? 'outcome-unknown' : 'operation-stale', result: null };
        }
        throw new Error(operation);
      } };
      const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
      return {
        get solidifyCalls() { return solidifyCalls; },
        get catalogReads() { return catalogReads; },
        harness: loadBundle({ whaledockShellPreferences: pref,
          whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } }, {
          creatorTab: 'review'
        })
      };
    };
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const unknown = makeHarness('unknown');
    const props = uiProps(state, unknown.harness.integration, []);
    let tree = unknown.harness.renderer.render(unknown.harness.AppFrame, props);
    tree = await settle(unknown.harness, props);
    tree = await settle(unknown.harness, props);
    button(tree, '显式固化进打法库').props.onClick();
    tree = await settle(unknown.harness, props);
    assert.match(textOf(tree), /固化结果未知/u);
    assert.match(textOf(tree), /核对 07_打法库 文件，不要重复点击/u);
    assert.match(textOf(tree), /保留的真实复盘正文/u);
    assert.match(textOf(tree), /已验证旧打法/u);
    assert.equal(button(tree, '显式固化进打法库').props.disabled, true);
    button(tree, '显式固化进打法库').props.onClick();
    assert.equal(unknown.solidifyCalls, 1, 'outcome-unknown 后不得允许重复写');
    button(tree, '重新读取复盘与打法库').props.onClick();
    tree = unknown.harness.renderer.render(unknown.harness.AppFrame, props);
    assert.equal(button(tree, '显式固化进打法库').props.disabled, true,
      'fresh read 完成前仍须锁写');
    tree = await settle(unknown.harness, props);
    tree = await settle(unknown.harness, props);
    assert.equal(button(tree, '显式固化进打法库').props.disabled, false,
      '只读 fresh read 成功后才恢复写入');
    assert.equal(unknown.solidifyCalls, 1, '重新读取不得伪装成 solidify 重试');

    const stale = makeHarness('stale');
    const staleProps = uiProps(state, stale.harness.integration, []);
    tree = stale.harness.renderer.render(stale.harness.AppFrame, staleProps);
    tree = await settle(stale.harness, staleProps);
    tree = await settle(stale.harness, staleProps);
    button(tree, '显式固化进打法库').props.onClick();
    tree = await settle(stale.harness, staleProps);
    tree = await settle(stale.harness, staleProps);
    assert.match(textOf(tree), /已清空旧视图并刷新内容库/u);
    assert.doesNotMatch(textOf(tree), /保留的真实复盘正文|已验证旧打法/u);
    assert(stale.catalogReads >= 2, 'operation-stale 必须触发 catalog refresh');
  });

  await test('复盘 tactics parser 拒绝路径字段、token 漂移与跨页身份重复，不泄漏假墙数据', async () => {
    const project = contentProject('a', '严格复盘', '复盘');
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const makeHarness = (mode) => {
      const workspaceFiles = { async execute(operation, input) {
        if (operation === 'catalog.read') return catalog([project]);
        if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
          projectToken: input.projectToken, receipts: [] });
        if (operation === 'document.read') return documentPage(project, [
          scriptBlock('b', '严格复盘正文')
        ], { stage: 'review', stageLabel: '复盘' });
        if (operation === 'review.tactics.read' && mode === 'path') {
          return tacticsPage(project, [{
            ...tactic('c', '不得显示的路径打法'), relativePath: '07_打法库/private-secret.md'
          }], { collectionToken: `collection-${'1'.repeat(24)}` });
        }
        if (operation === 'review.tactics.read' && input.cursor === 0) {
          return tacticsPage(project, [
            tactic('1', '安全打法一'), tactic('2', '安全打法二'),
            tactic('3', '安全打法三'), tactic('4', '安全打法四')
          ], { itemCount: 5, nextCursor: 4,
            collectionToken: `collection-${'2'.repeat(24)}` });
        }
        if (operation === 'review.tactics.read' && mode === 'duplicate-project-token') {
          return tacticsPage(project, [
            tactic('5', '重复身份不得显示', { projectToken: tactic('1', '').projectToken })
          ], { itemCount: 5, cursor: 4,
            collectionToken: `collection-${'2'.repeat(24)}` });
        }
        if (operation === 'review.tactics.read') return tacticsPage(project, [
          tactic('5', '漂移后不得显示')
        ], { itemCount: 5, cursor: 4,
          collectionToken: `collection-${'3'.repeat(24)}` });
        throw new Error(operation);
      } };
      const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
      return loadBundle({ whaledockShellPreferences: pref,
        whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } }, {
        creatorTab: 'review'
      });
    };
    const pathHarness = makeHarness('path');
    const pathProps = uiProps(state, pathHarness.integration, []);
    let tree = pathHarness.renderer.render(pathHarness.AppFrame, pathProps);
    tree = await settle(pathHarness, pathProps);
    tree = await settle(pathHarness, pathProps);
    tree = await settle(pathHarness, pathProps);
    assert.match(textOf(tree), /打法库暂时读不到/u);
    assert.doesNotMatch(textOf(tree), /private-secret|不得显示的路径打法/u);
    assert.equal(button(tree, '显式固化进打法库').props.disabled, true);

    const driftHarness = makeHarness('drift');
    const driftProps = uiProps(state, driftHarness.integration, []);
    tree = driftHarness.renderer.render(driftHarness.AppFrame, driftProps);
    tree = await settle(driftHarness, driftProps);
    tree = await settle(driftHarness, driftProps);
    tree = await settle(driftHarness, driftProps);
    assert.match(textOf(tree), /安全打法一/u);
    assert.doesNotMatch(textOf(tree), /漂移后不得显示/u);
    assert.match(textOf(tree), /打法库读取不完整；只显示已成功读取的 4 条本地条目/u);
    assert.equal(button(tree, '显式固化进打法库').props.disabled, true);

    const duplicateHarness = makeHarness('duplicate-project-token');
    const duplicateProps = uiProps(state, duplicateHarness.integration, []);
    tree = duplicateHarness.renderer.render(duplicateHarness.AppFrame, duplicateProps);
    tree = await settle(duplicateHarness, duplicateProps);
    tree = await settle(duplicateHarness, duplicateProps);
    tree = await settle(duplicateHarness, duplicateProps);
    assert.match(textOf(tree), /安全打法一/u);
    assert.doesNotMatch(textOf(tree), /重复身份不得显示/u);
    assert.match(textOf(tree), /打法库读取不完整；只显示已成功读取的 4 条本地条目/u);
    assert.equal(button(tree, '显式固化进打法库').props.disabled, true);
  });

  await test('概览自动读完全部候选，后页失败时保留已读项并明确不完整', async () => {
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const project = contentProject('a', '分页选题', '选题');
    const firstCandidates = [
      { field: 'angle', value: '角度一', selected: true },
      { field: 'angle', value: '角度二', selected: false },
      { field: 'angle', value: '角度三', selected: false },
      { field: 'hook', value: '钩子一', selected: false }
    ];
    const tailCandidates = [
      { field: 'hook', value: '钩子二', selected: true },
      { field: 'hook', value: '钩子三', selected: false }
    ];
    let failTail = false;
    const workspaceFiles = { async execute(operation, input) {
      if (operation === 'catalog.read') return catalog([project]);
      if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
        projectToken: input.projectToken, receipts: [] });
      if (operation === 'overview.read' && input.cursor === 0) return overview(project,
        firstCandidates, { angle: '角度一', hook: '钩子二', candidateCount: 6, nextCursor: 4 });
      if (operation === 'overview.read' && input.cursor === 4) {
        if (failTail) {
          const invalid = overview(project, tailCandidates, {
            angle: '角度一', hook: '钩子二', candidateCount: 6, cursor: 4
          });
          return fulfilled({ ...invalid.result, unexpected: 'must-reject' });
        }
        return overview(project, tailCandidates, {
          angle: '角度一', hook: '钩子二', candidateCount: 6, cursor: 4
        });
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
    tree = await settle(harness, props);
    assert.match(textOf(tree), /当前状态needs-decision/u);
    assert.match(textOf(tree), /当前角度角度一/u);
    assert.match(textOf(tree), /当前钩子钩子二/u);
    assert.match(textOf(tree), /角度三/u);
    assert.match(textOf(tree), /钩子三/u);
    assert.doesNotMatch(textOf(tree), /读取不完整/u);

    failTail = true;
    const secondHarness = loadBundle({ whaledockShellPreferences: pref,
      whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } });
    const secondProps = uiProps(state, secondHarness.integration, []);
    tree = secondHarness.renderer.render(secondHarness.AppFrame, secondProps);
    tree = await settle(secondHarness, secondProps);
    tree = await settle(secondHarness, secondProps);
    assert.match(textOf(tree), /角度三/u);
    assert.doesNotMatch(textOf(tree), /钩子三/u);
    assert.match(textOf(tree), /候选读取不完整；只显示已成功读取的 4\/6 项/u);
  });

  await test('概览 A→B→A 后丢弃迟到的旧 A 响应并立即清空旧内容', async () => {
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    let projectA = contentProject('1', '项目 A', '选题');
    const projectB = contentProject('2', '项目 B', '选题');
    const delayedA = deferred();
    let refreshedAReads = 0;
    const workspaceFiles = { async execute(operation, input) {
      if (operation === 'catalog.read') return catalog([projectA, projectB]);
      if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
        projectToken: input.projectToken, receipts: [] });
      if (operation !== 'overview.read') throw new Error(operation);
      if (input.projectToken === `project-${'1'.repeat(24)}`) return overview(projectA, [{
        field: 'angle', value: 'A 初始角度', selected: true
      }], { angle: 'A 初始角度' });
      if (input.projectToken === projectB.projectToken) return overview(projectB, [{
        field: 'angle', value: 'B 当前角度', selected: true
      }], { angle: 'B 当前角度' });
      refreshedAReads += 1;
      return refreshedAReads === 1 ? delayedA.promise : overview(projectA, [{
        field: 'angle', value: 'A 最新角度', selected: true
      }], { angle: 'A 最新角度' });
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
    assert.match(textOf(tree), /A 初始角度/u);

    projectA = { ...projectA, projectToken: `project-${'3'.repeat(24)}` };
    button(tree, '刷新内容').props.onClick();
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.match(textOf(tree), /正在读取选题与状态/u);
    assert.doesNotMatch(textOf(tree), /A 初始角度/u, 'token 更新后旧概览必须立即清空');

    const card = (title) => findAll(tree, (node) => node.props?.className === 'wd10-project'
      && textOf(node).includes(title))[0];
    card('项目 B').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.match(textOf(tree), /B 当前角度/u);
    assert.doesNotMatch(textOf(tree), /A 初始角度/u);

    card('项目 A').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.match(textOf(tree), /A 最新角度/u);
    delayedA.resolve(overview(projectA, [{
      field: 'angle', value: 'A 迟到角度', selected: true
    }], { angle: 'A 迟到角度' }));
    tree = await settle(harness, props);
    assert.match(textOf(tree), /A 最新角度/u);
    assert.doesNotMatch(textOf(tree), /A 迟到角度/u,
      '旧 attempt 的迟到响应不得覆盖 A 返回后的新概览');
  });

  await test('选题拍板单飞且连续角度到钩子使用服务端返回的新 token', async () => {
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    let project = contentProject('b', '连续拍板', '选题');
    const contentRef = project.contentRef;
    let selectedAngle = null;
    let selectedHook = null;
    const calls = [];
    const firstWrite = deferred();
    const tokenB = `project-${'c'.repeat(24)}`;
    const tokenC = `project-${'d'.repeat(24)}`;
    const candidates = () => [
      { field: 'angle', value: '正面结果', selected: selectedAngle === '正面结果' },
      { field: 'angle', value: '失败复盘', selected: selectedAngle === '失败复盘' },
      { field: 'hook', value: '别再空想', selected: selectedHook === '别再空想' }
    ];
    const workspaceFiles = { async execute(operation, input) {
      if (operation === 'catalog.read') return catalog([project]);
      if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
        projectToken: input.projectToken, receipts: [] });
      if (operation === 'overview.read') return overview(project, candidates(), {
        angle: selectedAngle, hook: selectedHook, updated: project.updated
      });
      if (operation === 'topic.choose') {
        calls.push({ ...input });
        if (calls.length === 1) return firstWrite.promise;
        assert.equal(input.projectToken, tokenB);
        selectedHook = input.value;
        project = { ...project, projectToken: tokenC, updated: '2026-08-25 12:02' };
        return fulfilled({ kind: 'mutation', changed: true, contentRef,
          projectToken: tokenC, field: input.field, value: input.value,
          updated: project.updated, message: '钩子已写回。' });
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
    tree = await settle(harness, props);
    button(tree, '正面结果').props.onClick();
    button(tree, '正面结果').props.onClick();
    assert.equal(calls.length, 1, '同一写回未完成时双击必须只发一次');
    selectedAngle = '正面结果';
    project = { ...project, projectToken: tokenB, updated: '2026-08-25 12:01' };
    firstWrite.resolve(fulfilled({ kind: 'mutation', changed: true, contentRef,
      projectToken: tokenB, field: 'angle', value: '正面结果',
      updated: project.updated, message: '角度已写回。' }));
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.match(textOf(tree), /当前角度正面结果/u);
    assert.equal(findAll(tree, (node) => node.props?.className === 'wd10-project'
      && node.props['aria-current'] === true).length, 1, 'token 轮换后仍应选中同一 contentRef');
    button(tree, '别再空想').props.onClick();
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((call) => call.projectToken), [
      `project-${'b'.repeat(24)}`, tokenB
    ]);
    assert.match(textOf(tree), /当前钩子别再空想/u);
  });

  await test('脚本自动分页、后页失败保留已读块，截断块禁用四动作', async () => {
    const project = contentProject('4', '分页脚本', '写稿');
    const first = [
      scriptBlock('1', '第一块完整文本'),
      scriptBlock('2', '第二块截断文本', { textTruncated: true, startLine: 6, endLine: 8 })
    ];
    const tail = [scriptBlock('3', '第三块完整文本', { startLine: 9, endLine: 10 })];
    const makeHarness = (failTail) => {
      const calls = [];
      const workspaceFiles = { async execute(operation, input) {
        calls.push({ operation, input: { ...input } });
        if (operation === 'catalog.read') return catalog([project]);
        if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
          projectToken: input.projectToken, receipts: [] });
        if (operation === 'proposal.read') return proposal(project);
        if (operation === 'document.read' && input.cursor === 0) return documentPage(project, first, {
          blockCount: 3, nextCursor: 2, truncated: true
        });
        if (operation === 'document.read' && input.cursor === 2) {
          if (failTail) throw new Error('tail unavailable');
          return documentPage(project, tail, { blockCount: 3, cursor: 2, truncated: false });
        }
        throw new Error(operation);
      } };
      const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
      return { calls, harness: loadBundle({ whaledockShellPreferences: pref,
        whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } }, {
        creatorTab: 'script'
      }) };
    };
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const full = makeHarness(false);
    const props = uiProps(state, full.harness.integration, []);
    let tree = full.harness.renderer.render(full.harness.AppFrame, props);
    tree = await settle(full.harness, props);
    tree = await settle(full.harness, props);
    assert.match(textOf(tree), /第一块完整文本/u);
    assert.match(textOf(tree), /第三块完整文本/u);
    assert.match(textOf(tree), /文档投影含截断内容/u);
    assert(full.calls.some((call) => call.operation === 'document.read' && call.input.cursor === 2));
    const articles = findAll(tree, (node) => node.type === 'article' && node.props?.className === 'wd10-block');
    assert.equal(articles.length, 3);
    for (const label of ['改这段', '更口语', '压时长', '问一句']) {
      assert.equal(findAll(articles[0], (node) => node.type === 'button' && textOf(node) === label)[0]
        .props.disabled, false);
      assert.equal(findAll(articles[1], (node) => node.type === 'button' && textOf(node) === label)[0]
        .props.disabled, true);
    }

    const partial = makeHarness(true);
    const partialProps = uiProps(state, partial.harness.integration, []);
    tree = partial.harness.renderer.render(partial.harness.AppFrame, partialProps);
    tree = await settle(partial.harness, partialProps);
    tree = await settle(partial.harness, partialProps);
    assert.match(textOf(tree), /第一块完整文本/u);
    assert.doesNotMatch(textOf(tree), /第三块完整文本/u);
    assert.match(textOf(tree), /脚本读取不完整；只显示已成功读取的 2\/3 块/u);
  });

  await test('脚本 A→B→A 后清空旧块并丢弃迟到的旧 A 响应', async () => {
    let projectA = contentProject('5', '脚本 A', '写稿');
    const projectB = contentProject('6', '脚本 B', '写稿');
    const delayedA = deferred();
    let refreshedAReads = 0;
    const workspaceFiles = { async execute(operation, input) {
      if (operation === 'catalog.read') return catalog([projectA, projectB]);
      if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
        projectToken: input.projectToken, receipts: [] });
      if (operation === 'proposal.read') {
        return proposal(input.contentRef === projectB.contentRef ? projectB : projectA);
      }
      if (operation !== 'document.read') throw new Error(operation);
      if (input.projectToken === `project-${'5'.repeat(24)}`) {
        return documentPage(projectA, [scriptBlock('5', 'A 初始脚本')]);
      }
      if (input.projectToken === projectB.projectToken) {
        return documentPage(projectB, [scriptBlock('6', 'B 当前脚本')]);
      }
      refreshedAReads += 1;
      return refreshedAReads === 1 ? delayedA.promise
        : documentPage(projectA, [scriptBlock('7', 'A 最新脚本')]);
    } };
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const harness = loadBundle({ whaledockShellPreferences: pref,
      whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } }, {
      creatorTab: 'script'
    });
    const props = uiProps(state, harness.integration, []);
    let tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.match(textOf(tree), /A 初始脚本/u);
    projectA = { ...projectA, projectToken: `project-${'7'.repeat(24)}` };
    button(tree, '刷新内容').props.onClick();
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.match(textOf(tree), /正在读取脚本块/u);
    assert.doesNotMatch(textOf(tree), /A 初始脚本/u);
    const card = (title) => findAll(tree, (node) => node.props?.className === 'wd10-project'
      && textOf(node).includes(title))[0];
    card('脚本 B').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.match(textOf(tree), /B 当前脚本/u);
    card('脚本 A').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.match(textOf(tree), /A 最新脚本/u);
    delayedA.resolve(documentPage(projectA, [scriptBlock('8', 'A 迟到脚本')]));
    tree = await settle(harness, props);
    assert.match(textOf(tree), /A 最新脚本/u);
    assert.doesNotMatch(textOf(tree), /A 迟到脚本/u);
  });

  await test('四个块动作共用预检取消链，最终确认双击只提交一次', async () => {
    const project = contentProject('8', '动作脚本', '写稿');
    const block = scriptBlock('8', '需要加工的完整块');
    const prepares = [];
    const submits = [];
    const workspaceFiles = { async execute(operation, input) {
      if (operation === 'catalog.read') return catalog([project]);
      if (operation === 'document.read') return documentPage(project, [block]);
      if (operation === 'proposal.read') return proposal(project);
      if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
        projectToken: input.projectToken, receipts: [] });
      if (operation === 'block.action.prepare') {
        prepares.push({ ...input });
        return fulfilled({
          kind: 'preflight', contentRef: project.contentRef,
          projectToken: project.projectToken, blockToken: block.blockToken,
          action: input.action, state: 'ready', preflightToken: `preflight-${input.action}-01`,
          targetLabel: '脚本会话', workspaceLabel: 'alpha', workspaceMatch: 'match',
          targetRunning: true, eventTracking: 'ready',
          expiresAt: new Date(Date.now() + 60_000).toISOString(), message: null
        });
      }
      if (operation === 'block.action.submit') {
        submits.push({ ...input });
        return fulfilled({
          kind: 'submission', contentRef: project.contentRef,
          projectToken: project.projectToken, blockToken: block.blockToken,
          action: input.action, state: 'accepted', reason: 'accepted', target: '脚本会话',
          receiptId: 'receipt-block-action-01', message: null
        });
      }
      throw new Error(operation);
    } };
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const harness = loadBundle({ whaledockShellPreferences: pref,
      whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } }, {
      creatorTab: 'script'
    });
    const props = uiProps(state, harness.integration, []);
    let tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    for (const label of ['改这段', '更口语', '压时长']) {
      button(tree, label).props.onClick();
      tree = await settle(harness, props);
      assert.match(textOf(tree), /将发往 脚本会话/u);
      button(tree, '取消').props.onClick();
      tree = harness.renderer.render(harness.AppFrame, props);
      assert.match(textOf(tree), /已取消，没有发送/u);
    }
    button(tree, '问一句').props.onClick();
    tree = await settle(harness, props);
    button(tree, '确认发送').props.onClick();
    button(tree, '确认发送').props.onClick();
    tree = await settle(harness, props);
    assert.deepEqual(prepares.map((item) => item.action), ['revise', 'spoken', 'shorten', 'ask']);
    assert.equal(submits.length, 1);
    assert.deepEqual(Object.keys(submits[0]).sort(), [
      'action', 'blockToken', 'override', 'preflightToken', 'projectToken'
    ]);
    assert.equal(submits[0].action, 'ask');
    assert.equal(submits[0].override, false);
    assert.match(textOf(tree), /已提交到 脚本会话/u);
  });

  await test('黄牌建议逐一诚实呈现 queued/unchanged/ready/stale/invalid/adopted/conflict', async () => {
    const project = contentProject('a', '建议状态脚本', '写稿');
    const block = scriptBlock('a', '建议状态原稿');
    const active = {
      proposalToken: 'proposal-video_fixture_01', title: '建议状态卡',
      intentLabel: '改这段', before: '原来的表达', submitted: 'accepted',
      target: '脚本会话', canReject: true
    };
    const cases = [
      ['queued', { ...active, submitted: 'sending' }, /建议副本已排队/u, false, true, false],
      ['unchanged', { ...active, reason: 'target-unchanged' }, /目标块还没有变化/u, false, true, false],
      ['ready', { ...active, after: '新的表达', proposalRevisionToken:
        `proposal-revision-${'a'.repeat(24)}`, canAdopt: true }, /建议已就绪/u, true, true, false],
      ['stale', { ...active, reason: 'original-changed' }, /原稿已变化/u, false, true, false],
      ['invalid', { ...active, reason: 'read-failed' }, /建议文件无效/u, false, true, false],
      ['adopted', { title: '建议状态卡', intentLabel: '已采用，可撤销一次',
        before: '原来的表达', after: '新的表达', revisionToken: `revision-${'b'.repeat(24)}`,
        canUndo: true }, /可撤销一次/u, false, false, true],
      ['conflict', { title: '建议状态卡', intentLabel: '已采用，可撤销一次',
        before: '原来的表达', after: '新的表达', revisionToken: `revision-${'c'.repeat(24)}`,
        reason: 'adopted-file-changed' }, /撤销不可用/u, false, false, false]
    ];
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    for (const [status, fields, copy, adoptVisible, rejectVisible, undoVisible] of cases) {
      const workspaceFiles = { async execute(operation, input) {
        if (operation === 'catalog.read') return catalog([project]);
        if (operation === 'document.read') return documentPage(project, [block]);
        if (operation === 'proposal.read') return proposal(project, status, fields);
        if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
          projectToken: input.projectToken, receipts: [] });
        throw new Error(operation);
      } };
      const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
      const harness = loadBundle({ whaledockShellPreferences: pref,
        whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } }, {
        creatorTab: 'script'
      });
      const props = uiProps(state, harness.integration, []);
      let tree = harness.renderer.render(harness.AppFrame, props);
      tree = await settle(harness, props);
      tree = await settle(harness, props);
      assert.match(textOf(tree), /鲸坞建议 · 黄牌，不会自动生效/u);
      assert.match(textOf(tree), copy);
      assert.equal(findAll(tree, (node) => node.type === 'button'
        && textOf(node) === '采用这一块').length > 0, adoptVisible, status);
      const rejectButtons = findAll(tree, (node) => node.type === 'button'
        && textOf(node) === '退回建议');
      assert.equal(rejectButtons.length > 0, rejectVisible, status);
      if (rejectVisible) assert.equal(rejectButtons[0].props.disabled, false, `${status} 应允许退回`);
      assert.equal(findAll(tree, (node) => node.type === 'button'
        && textOf(node) === '撤销这一次采用').length > 0, undoVisible, status);
    }
  });

  await test('建议原文或新稿截断时不可采用，但仍可真实退回', async () => {
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    for (const [hex, truncatedField] of [['d', 'beforeTruncated'], ['e', 'afterTruncated']]) {
      const project = contentProject(hex, `${truncatedField} 建议`, '写稿');
      const block = scriptBlock(hex, '截断门禁原稿');
      let decisions = 0;
      const workspaceFiles = { async execute(operation, input) {
        if (operation === 'catalog.read') return catalog([project]);
        if (operation === 'document.read') return documentPage(project, [block]);
        if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
          projectToken: input.projectToken, receipts: [] });
        if (operation === 'proposal.read') return proposal(project, 'ready', {
          proposalToken: `proposal-video_truncated_${hex}`, title: '截断建议',
          intentLabel: '改这段', before: '原来文本', after: '建议文本',
          proposalRevisionToken: null,
          canAdopt: false, canReject: true, submitted: 'accepted', target: '脚本会话',
          [truncatedField]: true
        });
        if (operation === 'proposal.decide') {
          decisions += 1;
          assert.equal(input.decision, 'reject');
          return fulfilled({ kind: 'decision', contentRef: project.contentRef,
            projectToken: project.projectToken, decision: 'reject', changed: false,
            revisionToken: null, message: '已退回截断建议。' });
        }
        throw new Error(operation);
      } };
      const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
      const harness = loadBundle({ whaledockShellPreferences: pref,
        whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } }, {
        creatorTab: 'script'
      });
      const props = uiProps(state, harness.integration, []);
      let tree = harness.renderer.render(harness.AppFrame, props);
      tree = await settle(harness, props);
      tree = await settle(harness, props);
      const adoptButtons = findAll(tree, (node) => node.type === 'button'
        && textOf(node) === '采用这一块');
      assert.equal(adoptButtons.length, 0, `${truncatedField} 不得渲染采用入口`);
      const reject = button(tree, '退回建议');
      assert.equal(reject.props.disabled, false);
      reject.props.onClick();
      tree = await settle(harness, props);
      assert.equal(decisions, 1);
      assert.match(textOf(tree), /已退回截断建议/u);
    }
  });

  await test('块提交 error/unknown 后建议轮询仍继续并保留诚实反馈', async () => {
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    for (const [hex, submitState, feedback] of [
      ['d', 'error', /目标会话暂不可用/u],
      ['e', 'unknown', /提交结果未知/u]
    ]) {
      const project = contentProject(hex, `${submitState} 提交脚本`, '写稿');
      const block = scriptBlock(hex, '块动作后仍需轮询');
      let proposalReads = 0;
      const workspaceFiles = { async execute(operation, input) {
        if (operation === 'catalog.read') return catalog([project]);
        if (operation === 'document.read') return documentPage(project, [block]);
        if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
          projectToken: input.projectToken, receipts: [] });
        if (operation === 'proposal.read') {
          proposalReads += 1;
          const fields = {
            proposalToken: `proposal-video_submit_${hex}`, title: '提交后建议',
            intentLabel: '问一句', before: '原稿未改', canReject: true,
            submitted: submitState, target: '脚本会话'
          };
          return proposal(project, proposalReads === 1 ? 'queued' : 'unchanged', {
            ...fields, ...(proposalReads === 1 ? {} : { reason: 'target-unchanged' })
          });
        }
        if (operation === 'block.action.prepare') return fulfilled({
          kind: 'preflight', contentRef: project.contentRef, projectToken: project.projectToken,
          blockToken: block.blockToken, action: input.action, state: 'ready',
          preflightToken: `preflight-${submitState}-01`, targetLabel: '脚本会话',
          workspaceLabel: 'alpha', workspaceMatch: 'match', targetRunning: true,
          eventTracking: 'ready', expiresAt: new Date(Date.now() + 60_000).toISOString(),
          message: null
        });
        if (operation === 'block.action.submit') return fulfilled(submitState === 'error' ? {
          kind: 'submission', contentRef: project.contentRef, projectToken: project.projectToken,
          blockToken: block.blockToken, action: input.action, state: 'error',
          reason: null, target: null, receiptId: null, message: '目标会话暂不可用。'
        } : {
          kind: 'submission', contentRef: project.contentRef, projectToken: project.projectToken,
          blockToken: block.blockToken, action: input.action, state: 'unknown',
          reason: 'outcome-unknown', target: '脚本会话', receiptId: null, message: null
        });
        throw new Error(operation);
      } };
      const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
      const harness = loadBundle({ whaledockShellPreferences: pref,
        whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } }, {
        creatorTab: 'script'
      });
      const props = uiProps(state, harness.integration, []);
      let tree = harness.renderer.render(harness.AppFrame, props);
      tree = await settle(harness, props);
      tree = await settle(harness, props);
      button(tree, '问一句').props.onClick();
      tree = await settle(harness, props);
      button(tree, '确认发送').props.onClick();
      tree = await settle(harness, props);
      assert.match(textOf(tree), feedback);
      const beforePoll = proposalReads;
      tree = await fireTimers(harness, 1000, props);
      assert.equal(proposalReads, beforePoll + 1, `${submitState} 后必须继续 proposal.read`);
      assert.match(textOf(tree), /目标块还没有变化/u);
      assert.match(textOf(tree), feedback);
    }
  });

  await test('adopt outcome-unknown 后仍轮询到 adopted 并显示一次撤销', async () => {
    const project = contentProject('f', '采用结果未知脚本', '写稿');
    const adoptedIdentity = { ...project, projectToken: `project-${'1'.repeat(24)}` };
    const block = scriptBlock('f', '采用结果未知原稿');
    const proposalToken = 'proposal-video_outcome_unknown';
    const proposalRevisionToken = `proposal-revision-${'2'.repeat(24)}`;
    const revisionToken = `revision-${'3'.repeat(24)}`;
    let status = 'ready';
    let proposalReads = 0;
    const workspaceFiles = { async execute(operation, input) {
      if (operation === 'catalog.read') return catalog([project]);
      if (operation === 'document.read') return documentPage(project, [block]);
      if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
        projectToken: input.projectToken, receipts: [] });
      if (operation === 'proposal.read') {
        proposalReads += 1;
        return status === 'ready' ? proposal(project, 'ready', {
          proposalToken, proposalRevisionToken, title: '结果未知建议',
          intentLabel: '改这段', before: '原来文本', after: '建议文本',
          canAdopt: true, canReject: true, submitted: 'accepted', target: '脚本会话'
        }) : proposal(adoptedIdentity, 'adopted', {
          revisionToken, title: '结果未知建议', intentLabel: '已采用，可撤销一次',
          before: '原来文本', after: '建议文本', canUndo: true
        });
      }
      if (operation === 'proposal.decide') {
        status = 'adopted';
        return { requestToken: 'request-outcome-unknown', state: 'rejected',
          code: 'outcome-unknown', result: null };
      }
      throw new Error(operation);
    } };
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const harness = loadBundle({ whaledockShellPreferences: pref,
      whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } }, {
      creatorTab: 'script'
    });
    const props = uiProps(state, harness.integration, []);
    let tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    button(tree, '采用这一块').props.onClick();
    tree = await settle(harness, props);
    assert.match(textOf(tree), /操作结果未知/u);
    const beforePoll = proposalReads;
    tree = await fireTimers(harness, 4000, props);
    assert(proposalReads > beforePoll, 'outcome-unknown 后必须继续 proposal.read');
    assert.match(textOf(tree), /这一块已采用/u);
    assert.equal(button(tree, '撤销这一次采用').props.disabled, false);
  });

  await test('queued 黄牌可退回且 reject 精确省略 proposalRevisionToken', async () => {
    const project = contentProject('b', '退回脚本', '写稿');
    const block = scriptBlock('b', '等待中的建议原稿');
    let status = 'queued';
    const decisions = [];
    const workspaceFiles = { async execute(operation, input) {
      if (operation === 'catalog.read') return catalog([project]);
      if (operation === 'document.read') return documentPage(project, [block]);
      if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
        projectToken: input.projectToken, receipts: [] });
      if (operation === 'proposal.read') return status === null ? proposal(project) : proposal(project,
        status, { proposalToken: 'proposal-video_reject_01', title: '待退回建议',
          intentLabel: '压时长', before: '原稿未改', canReject: true,
          submitted: 'sending', target: '脚本会话' });
      if (operation === 'proposal.decide') {
        decisions.push({ ...input });
        status = null;
        return fulfilled({ kind: 'decision', contentRef: project.contentRef,
          projectToken: project.projectToken, decision: 'reject', changed: false,
          revisionToken: null, message: '已退回建议，原稿从未改动。' });
      }
      throw new Error(operation);
    } };
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const harness = loadBundle({ whaledockShellPreferences: pref,
      whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } }, {
      creatorTab: 'script'
    });
    const props = uiProps(state, harness.integration, []);
    let tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    button(tree, '退回建议').props.onClick();
    button(tree, '退回建议').props.onClick();
    tree = await settle(harness, props);
    assert.equal(decisions.length, 1);
    assert.deepEqual(Object.keys(decisions[0]).sort(), [
      'contentRef', 'decision', 'proposalToken'
    ]);
    assert.equal(Object.prototype.hasOwnProperty.call(decisions[0], 'proposalRevisionToken'), false);
    assert.match(textOf(tree), /原稿从未改动/u);
  });

  await test('ready 采用携带精确 revision、更新 projectToken，且 adopted 只撤销一次', async () => {
    let project = contentProject('c', '采用脚本', '写稿');
    const block = scriptBlock('c', '采用前原稿');
    const proposalToken = 'proposal-video_adopt_01';
    const proposalRevisionToken = `proposal-revision-${'d'.repeat(24)}`;
    const undoToken = `revision-${'e'.repeat(24)}`;
    const adoptedProjectToken = `project-${'d'.repeat(24)}`;
    const undoneProjectToken = `project-${'e'.repeat(24)}`;
    let proposalStatus = 'ready';
    let decideCalls = 0;
    let undoCalls = 0;
    let prepareCalls = 0;
    const decideInputs = [];
    const undoInputs = [];
    const workspaceFiles = { async execute(operation, input) {
      if (operation === 'catalog.read') return catalog([project]);
      if (operation === 'document.read') return documentPage(project, [block]);
      if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
        projectToken: input.projectToken, receipts: [] });
      if (operation === 'proposal.read') {
        if (proposalStatus === null) return proposal(project);
        if (proposalStatus === 'ready') return proposal(project, 'ready', {
          proposalToken, proposalRevisionToken, title: '采用建议', intentLabel: '更口语',
          before: '采用前原稿', after: '采用后建议', canAdopt: true, canReject: true,
          submitted: 'accepted', target: '脚本会话'
        });
        return proposal(project, 'adopted', {
          revisionToken: undoToken, title: '采用建议', intentLabel: '已采用，可撤销一次',
          before: '采用前原稿', after: '采用后建议', canUndo: true
        });
      }
      if (operation === 'proposal.decide') {
        decideCalls += 1;
        decideInputs.push({ ...input });
        proposalStatus = 'adopted';
        project = { ...project, projectToken: adoptedProjectToken };
        return fulfilled({ kind: 'decision', contentRef: project.contentRef,
          projectToken: adoptedProjectToken, decision: 'adopt', changed: true,
          revisionToken: undoToken, message: '已采用这一块；仍可撤销一次。' });
      }
      if (operation === 'block.action.prepare') {
        prepareCalls += 1;
        return fulfilled({ kind: 'preflight', contentRef: project.contentRef,
          projectToken: project.projectToken, blockToken: block.blockToken, action: input.action,
          state: 'ready', preflightToken: 'preflight-adopted-check-01',
          targetLabel: '脚本会话', workspaceLabel: 'alpha', workspaceMatch: 'match',
          targetRunning: false, eventTracking: 'ready',
          expiresAt: new Date(Date.now() + 60_000).toISOString(), message: null });
      }
      if (operation === 'proposal.undo') {
        undoCalls += 1;
        undoInputs.push({ ...input });
        proposalStatus = null;
        project = { ...project, projectToken: undoneProjectToken };
        return fulfilled({ kind: 'undo', contentRef: project.contentRef,
          projectToken: undoneProjectToken, changed: true,
          message: '已撤销上一次块级采用。' });
      }
      throw new Error(operation);
    } };
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const harness = loadBundle({ whaledockShellPreferences: pref,
      whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } }, {
      creatorTab: 'script'
    });
    const props = uiProps(state, harness.integration, []);
    let tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.match(textOf(tree), /原来采用前原稿/u);
    assert.match(textOf(tree), /鲸坞建议采用后建议/u);
    button(tree, '采用这一块').props.onClick();
    button(tree, '采用这一块').props.onClick();
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.equal(decideCalls, 1);
    assert.deepEqual(decideInputs, [{ contentRef: project.contentRef, proposalToken,
      decision: 'adopt', proposalRevisionToken }]);
    assert.match(textOf(tree), /撤销这一次采用/u);
    assert.equal(findAll(tree, (node) => node.props?.className === 'wd10-project'
      && node.props['aria-current'] === true).length, 1,
    '采用后必须按稳定 contentRef 保持选中');

    button(tree, '问一句').props.onClick();
    tree = await settle(harness, props);
    assert.equal(prepareCalls, 1);
    button(tree, '取消').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    assert.match(textOf(tree), /撤销这一次采用/u,
      '只有真实新 proposal 才能清掉旧 undo，预检取消不能清');

    button(tree, '撤销这一次采用').props.onClick();
    button(tree, '撤销这一次采用').props.onClick();
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.equal(undoCalls, 1);
    assert.deepEqual(undoInputs, [{ contentRef: project.contentRef, revisionToken: undoToken }]);
    assert.doesNotMatch(textOf(tree), /撤销这一次采用/u);
  });

  await test('发布七灯遵守 AI 三态硬门、脏发布勾选不冒充通过且更新轮换 token', async () => {
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const contentRef = `content-${'d'.repeat(24)}`;
    let currentProject = contentProject('d', '发布项目', '发布', { contentRef });
    const firstFive = {
      cover: true, title: true, topics: true, timing: true, 'pinned-comment': true
    };
    let currentSurface = publishSurface(currentProject, { checklist: publishChecklist({
      aiDisclosure: 'unknown', checked: { ...firstFive, published: true }
    }) });
    const updates = [];
    const nextTokens = ['e', 'f', '1', '2', '3', '4'];
    const workspaceFiles = { async execute(operation, input) {
      if (operation === 'catalog.read') return catalog([currentProject]);
      if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
        projectToken: input.projectToken, receipts: [] });
      if (operation === 'publish.read') {
        assert.deepEqual({ ...input }, {
          contentRef: currentProject.contentRef, projectToken: currentProject.projectToken
        });
        return fulfilled(currentSurface);
      }
      if (operation === 'publish.update') {
        updates.push({ ...input });
        const nextHex = nextTokens.shift();
        currentProject = { ...currentProject, projectToken: `project-${nextHex.repeat(24)}` };
        const prior = currentSurface.checklist;
        const checked = Object.fromEntries(prior.lights.map((light) => [light.id, light.checked]));
        let aiDisclosure = prior.aiDisclosure;
        if (input.type === 'ai-disclosure') {
          aiDisclosure = input.value;
          checked.published = false;
        } else checked[input.lightId] = input.checked;
        currentSurface = publishSurface(currentProject, { checklist: publishChecklist({
          aiDisclosure, checked
        }) });
        return fulfilled({ kind: 'publish-mutation', changed: true,
          surface: currentSurface, message: '本地检查单已更新。' });
      }
      throw new Error(operation);
    } };
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const harness = loadBundle({ whaledockShellPreferences: pref,
      whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } },
    { creatorTab: 'publish' });
    const props = uiProps(state, harness.integration, []);
    let tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.match(textOf(tree), /发布检查单 · 7 灯/u);
    for (const [, label] of PUBLISH_LIGHT_DEFINITIONS) assert.match(textOf(tree), new RegExp(label));
    assert.match(textOf(tree), /本人已发布不是平台回读/u);
    assert.match(textOf(tree), /只写入本地检查单；鲸坞不会访问平台、代发或宣称已合规/u);
    assert.match(textOf(tree), /必须先选择是否包含 AI 内容/u);
    assert.match(textOf(tree), /文件里的“已由本人发布”勾选已失效/u);
    let publishedRow = findAll(tree, (node) => node.props?.['data-light-id'] === 'published')[0];
    let publishedInput = findAll(publishedRow, (node) => node.type === 'input')[0];
    assert.equal(publishedInput.props.checked, true, '保留文件原始脏勾选供核对');
    assert.equal(publishedInput.props.disabled, false,
      '未 ready 时必须允许取消原始 published 脏勾选');
    publishedInput.props.onChange();
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    publishedRow = findAll(tree, (node) => node.props?.['data-light-id'] === 'published')[0];
    publishedInput = findAll(publishedRow, (node) => node.type === 'input')[0];
    assert.equal(publishedInput.props.checked, false);
    assert.equal(publishedInput.props.disabled, true,
      '未 ready 且 raw unchecked 时绝不能点亮 published');
    assert.equal(button(tree, '未选择').props.disabled, true, '当前 AI 选择不可重复写');

    button(tree, '包含 AI 内容').props.onClick();
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.match(textOf(tree), /还必须勾选“AI 内容标识”/u);
    let aiRow = findAll(tree, (node) => node.props?.['data-light-id'] === 'ai-label')[0];
    let aiInput = findAll(aiRow, (node) => node.type === 'input')[0];
    assert.equal(aiInput.props.disabled, false);
    aiInput.props.onChange();
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.match(textOf(tree), /发布前检查已就绪/u);

    button(tree, '不包含 AI 内容').props.onClick();
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.match(textOf(tree), /文件仍勾选了“AI 内容标识”，可以取消/u);
    assert.equal(button(tree, '不包含 AI 内容').props.disabled, true);
    aiRow = findAll(tree, (node) => node.props?.['data-light-id'] === 'ai-label')[0];
    aiInput = findAll(aiRow, (node) => node.type === 'input')[0];
    assert.equal(aiInput.props.checked, true, '保留 not-ai 文件中的原始 AI 标识脏勾选');
    assert.equal(aiInput.props.disabled, false,
      'not-ai 时必须允许取消原始 AI 标识脏勾选');
    aiInput.props.onChange();
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.match(textOf(tree), /无需勾选 AI 内容标识/u);
    aiRow = findAll(tree, (node) => node.props?.['data-light-id'] === 'ai-label')[0];
    aiInput = findAll(aiRow, (node) => node.type === 'input')[0];
    assert.equal(aiInput.props.checked, false);
    assert.equal(aiInput.props.disabled, true,
      'not-ai 且 raw unchecked 时绝不能点亮 AI 标识');
    publishedRow = findAll(tree, (node) => node.props?.['data-light-id'] === 'published')[0];
    publishedInput = findAll(publishedRow, (node) => node.type === 'input')[0];
    assert.equal(publishedInput.props.disabled, false);
    assert.equal(publishedInput.props.checked, false);
    publishedInput.props.onChange();
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.match(textOf(tree), /本地已标记为本人发布/u);
    assert.equal(updates.length, 6);
    assert.deepEqual(updates.map(({ type, lightId, checked, value }) => (
      type === 'light' ? { type, lightId, checked } : { type, value }
    )), [
      { type: 'light', lightId: 'published', checked: false },
      { type: 'ai-disclosure', value: 'ai' },
      { type: 'light', lightId: 'ai-label', checked: true },
      { type: 'ai-disclosure', value: 'not-ai' },
      { type: 'light', lightId: 'ai-label', checked: false },
      { type: 'light', lightId: 'published', checked: true }
    ]);
    assert(updates.every((input) => input.contentRef === contentRef));
    for (const input of updates) assert.deepEqual(Object.keys(input).sort(),
      (input.type === 'light'
        ? ['checked', 'contentRef', 'lightId', 'projectToken', 'type']
        : ['contentRef', 'projectToken', 'type', 'value']).sort(),
    'publish.update outbound input 必须 exact');
    assert.equal(findAll(tree, (node) => node.props?.className === 'wd10-project'
      && node.props['aria-current'] === true).length, 1,
    'publish.update 后必须按稳定 contentRef 保持选中');
  });

  await test('创建发布检查单双击单飞，created:false 直接 upsert 并选中既有发布卡', async () => {
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const source = contentProject('3', '源脚本', '写稿');
    const existing = contentProject('4', '既有发布单', '发布');
    const sourceSurface = publishSurface(source, {
      stage: 'script', stageLabel: '写稿', checklist: null
    });
    const existingSurface = publishSurface(existing, { checklist: publishChecklist({
      aiDisclosure: 'not-ai', checked: {
        cover: true, title: true, topics: true, timing: true, 'pinned-comment': true
      }
    }) });
    const creation = deferred();
    const calls = [];
    let createdResolved = false;
    const deepCatalog = [source, ...Array.from({ length: 259 }, (_, index) => {
      const hex = index.toString(16).padStart(24, '0');
      return {
        contentRef: `content-${hex}`, projectToken: `project-${hex}`,
        title: `分页占位 ${index + 1}`, workflowLabel: '写稿',
        updated: '2026-08-25 12:00', actions: []
      };
    }), existing];
    const workspaceFiles = { async execute(operation, input) {
      calls.push({ operation, input: { ...input } });
      if (operation === 'catalog.read') {
        if (!createdResolved) return catalog([source]);
        const projects = deepCatalog.slice(input.cursor, input.cursor + 4);
        const nextCursor = input.cursor + projects.length < deepCatalog.length
          ? input.cursor + projects.length : null;
        return catalog(projects, nextCursor, deepCatalog.length);
      }
      if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
        projectToken: input.projectToken, receipts: [] });
      if (operation === 'publish.read') return fulfilled(
        input.contentRef === source.contentRef ? sourceSurface : existingSurface
      );
      if (operation === 'publish.create') return creation.promise;
      throw new Error(operation);
    } };
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const harness = loadBundle({ whaledockShellPreferences: pref,
      whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } },
    { creatorTab: 'publish' });
    const props = uiProps(state, harness.integration, []);
    let tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    const create = button(tree, '创建发布检查单');
    create.props.onClick();
    create.props.onClick();
    assert.equal(calls.filter((call) => call.operation === 'publish.create').length, 1,
      'pendingRef 必须在首个 await 前上锁');
    createdResolved = true;
    creation.resolve(fulfilled({
      kind: 'publish-create', created: false,
      sourceContentRef: source.contentRef, sourceProjectToken: source.projectToken,
      surface: existingSurface, message: '已找到同源检查单。'
    }));
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.match(textOf(tree), /已打开既有检查单/u);
    const cards = findAll(tree, (node) => node.props?.className === 'wd10-project');
    assert.equal(cards.length, 2, '返回 surface 必须直接 upsert，不能等待 catalog 分页');
    const selected = cards.find((node) => node.props['aria-current'] === true);
    assert.match(textOf(selected), /既有发布单/u);
    assert.match(textOf(tree), /发布检查单 · 7 灯/u);
    const createCall = calls.find((call) => call.operation === 'publish.create');
    assert.deepEqual(createCall.input, {
      contentRef: source.contentRef, projectToken: source.projectToken
    });
    tree = await fireTimers(harness, 4000, props);
    const selectedAfterPoll = findAll(tree, (node) => node.props?.className === 'wd10-project')
      .find((node) => node.props['aria-current'] === true);
    assert.match(textOf(selectedAfterPoll), /既有发布单/u,
      '后续 catalog 轮询必须扩页读回新检查单并保持选择');
    assert(calls.some((call) => call.operation === 'catalog.read' && call.input.cursor >= 256),
      'catalog readback 必须覆盖 backend 的 512 项上限，而不是停在前 256 项');
  });

  await test('发布页 A→B→A 的迟到 read 不覆盖最新同卡结果', async () => {
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const projectA = contentProject('5', '发布 A', '发布');
    const projectB = contentProject('6', '发布 B', '发布');
    const firstA = deferred();
    const secondA = deferred();
    let aReads = 0;
    const workspaceFiles = { async execute(operation, input) {
      if (operation === 'catalog.read') return catalog([projectA, projectB]);
      if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
        projectToken: input.projectToken, receipts: [] });
      if (operation === 'publish.read' && input.contentRef === projectA.contentRef) {
        aReads += 1;
        return aReads === 1 ? firstA.promise : secondA.promise;
      }
      if (operation === 'publish.read') return fulfilled({
        ...publishSurface(projectB), title: 'B 当前结果'
      });
      throw new Error(operation);
    } };
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const harness = loadBundle({ whaledockShellPreferences: pref,
      whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } },
    { creatorTab: 'publish' });
    const props = uiProps(state, harness.integration, []);
    let tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    let cards = findAll(tree, (node) => node.props?.className === 'wd10-project');
    cards.find((node) => textOf(node).includes('发布 B')).props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    assert.match(textOf(tree), /B 当前结果/u);
    cards = findAll(tree, (node) => node.props?.className === 'wd10-project');
    cards.find((node) => textOf(node).includes('发布 A')).props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    assert.equal(aReads, 2);
    secondA.resolve(fulfilled({ ...publishSurface(projectA), title: 'A 最新结果' }));
    tree = await settle(harness, props);
    assert.match(textOf(tree), /A 最新结果/u);
    firstA.resolve(fulfilled({ ...publishSurface(projectA), title: 'A 迟到旧结果' }));
    tree = await settle(harness, props);
    assert.match(textOf(tree), /A 最新结果/u);
    assert.doesNotMatch(textOf(tree), /A 迟到旧结果/u);
  });

  await test('发布检查单结构无效禁用全部写控件且非可创建阶段明确拒绝', async () => {
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const project = contentProject('7', '坏检查单', '发布');
    const invalidSurface = publishSurface(project, { checklist: publishChecklist({
      structureValid: false, unavailable: ['cover'], aiDisclosure: 'not-ai',
      checked: { 'ai-label': true, published: true }
    }) });
    let surface = invalidSurface;
    const workspaceFiles = { async execute(operation, input) {
      if (operation === 'catalog.read') return catalog([project]);
      if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
        projectToken: input.projectToken, receipts: [] });
      if (operation === 'publish.read') return fulfilled(surface);
      throw new Error(operation);
    } };
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const harness = loadBundle({ whaledockShellPreferences: pref,
      whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } },
    { creatorTab: 'publish' });
    const props = uiProps(state, harness.integration, []);
    let tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.match(textOf(tree), /发布检查单结构无效/u);
    assert.match(textOf(tree), /标记缺失、重复或存在歧义/u);
    assert.match(textOf(tree), /未开放取消操作/u);
    assert.doesNotMatch(textOf(tree), /可直接取消|可以取消/u,
      '结构无效时不得承诺 dirty 勾选可取消');
    const controls = findAll(tree, (node) => node.type === 'input'
      || node.type === 'button' && ['未选择', '包含 AI 内容', '不包含 AI 内容'].includes(textOf(node)));
    assert(controls.length >= 10);
    assert(controls.every((node) => node.props.disabled === true));

    surface = publishSurface(project, {
      stage: 'topic', stageLabel: '选题', checklist: null
    });
    const fresh = loadBundle({ whaledockShellPreferences: pref,
      whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } },
    { creatorTab: 'publish' });
    const freshProps = uiProps(state, fresh.integration, []);
    tree = fresh.renderer.render(fresh.AppFrame, freshProps);
    tree = await settle(fresh, freshProps);
    tree = await settle(fresh, freshProps);
    assert.match(textOf(tree), /当前“选题”阶段不能创建发布检查单/u);
    assert.equal(findAll(tree, (node) => node.type === 'button'
      && textOf(node) === '创建发布检查单').length, 0);
  });

  await test('发布 parser 拒绝多余字段且不把路径值显示到界面', async () => {
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const project = contentProject('a', '严格发布单', '发布');
    const workspaceFiles = { async execute(operation, input) {
      if (operation === 'catalog.read') return catalog([project]);
      if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
        projectToken: input.projectToken, receipts: [] });
      if (operation === 'publish.read') return fulfilled({
        ...publishSurface(project), absolutePath: '/private/should-not-render.md'
      });
      throw new Error(operation);
    } };
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const harness = loadBundle({ whaledockShellPreferences: pref,
      whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } },
    { creatorTab: 'publish' });
    const props = uiProps(state, harness.integration, []);
    let tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    assert.match(textOf(tree), /发布状态暂时读不到/u);
    assert.doesNotMatch(textOf(tree), /private|should-not-render/u);
    assert.equal(findAll(tree, (node) => node.props?.['data-light-id']).length, 0);
  });

  await test('发布 update 的 outcome-unknown 保留旧面并禁重试，stale 清空并刷新', async () => {
    const pref = preference({ contentViewMode: 'content', contentViewHintSeen: true });
    const project = contentProject('8', '不确定发布单', '发布');
    const original = publishSurface(project, { checklist: publishChecklist({
      aiDisclosure: 'not-ai', checked: { 'ai-label': true, published: true }
    }) });
    let mode = 'unknown';
    let catalogReads = 0;
    let updates = 0;
    const workspaceFiles = { async execute(operation, input) {
      if (operation === 'catalog.read') {
        catalogReads += 1;
        if (mode === 'stale' && catalogReads > 1) throw new Error('refresh failed');
        return catalog([project]);
      }
      if (operation === 'receipts.read') return fulfilled({ kind: 'receipts',
        projectToken: input.projectToken, receipts: [] });
      if (operation === 'publish.read') return fulfilled(original);
      if (operation === 'publish.update') {
        updates += 1;
        return { state: 'rejected', code: mode === 'unknown'
          ? 'outcome-unknown' : 'operation-stale', result: null };
      }
      throw new Error(operation);
    } };
    const state = {
      panels: { sidebar: 280, details: 0, narrow: false, narrowExpanded: false },
      sessions: { ids: ['a'], current: 'a', byId: { a: session('a', '/projects/alpha') } },
      workspaces: { items: [] }
    };
    const harness = loadBundle({ whaledockShellPreferences: pref,
      whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } },
    { creatorTab: 'publish' });
    const props = uiProps(state, harness.integration, []);
    let tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    let coverRow = findAll(tree, (node) => node.props?.['data-light-id'] === 'cover')[0];
    findAll(coverRow, (node) => node.type === 'input')[0].props.onChange();
    tree = await settle(harness, props);
    assert.match(textOf(tree), /写入结果未知/u);
    assert.match(textOf(tree), /核对项目文件，不要重复点击/u);
    assert.match(textOf(tree), /以下是写入前的检查单/u);
    assert.match(textOf(tree), /未开放取消操作/u);
    assert.doesNotMatch(textOf(tree), /可直接取消|可以取消/u,
      'stale-write 时不得承诺 dirty 勾选可取消');
    assert(findAll(tree, (node) => node.type === 'input').every((node) => node.props.disabled));
    assert.equal(updates, 1);
    button(tree, '重新读取检查单').props.onClick();
    tree = harness.renderer.render(harness.AppFrame, props);
    tree = await settle(harness, props);
    tree = await settle(harness, props);
    coverRow = findAll(tree, (node) => node.props?.['data-light-id'] === 'cover')[0];
    assert.equal(findAll(coverRow, (node) => node.type === 'input')[0].props.disabled, false,
      'fresh read 后才重新开放本地写控件');
    assert.equal(updates, 1, '重新读取不能伪装成 publish.update 重试');

    mode = 'stale';
    catalogReads = 0;
    const staleHarness = loadBundle({ whaledockShellPreferences: pref,
      whaledockWorkspaceFiles: workspaceFiles, sessions: { open() {} } },
    { creatorTab: 'publish' });
    const staleProps = uiProps(state, staleHarness.integration, []);
    tree = staleHarness.renderer.render(staleHarness.AppFrame, staleProps);
    tree = await settle(staleHarness, staleProps);
    tree = await settle(staleHarness, staleProps);
    coverRow = findAll(tree, (node) => node.props?.['data-light-id'] === 'cover')[0];
    findAll(coverRow, (node) => node.type === 'input')[0].props.onChange();
    tree = await settle(staleHarness, staleProps);
    tree = await settle(staleHarness, staleProps);
    assert.match(textOf(tree), /已清空旧检查单并刷新内容库/u);
    assert.match(textOf(tree), /发布状态暂时读不到/u);
    assert.equal(findAll(tree, (node) => node.props?.['data-light-id']).length, 0);
    assert(catalogReads >= 2, 'stale 必须触发 catalog refresh');
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
      if (operation === 'overview.read') return overview(project, [{
        field: 'angle', value: '动作角度', selected: false
      }]);
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
