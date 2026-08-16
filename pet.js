'use strict';

// 宠物窗渲染层：只播放主进程给的 data: URL 帧，不解析 manifest、不碰文件系统。
// 单图宠物与多帧宠物走同一条路径：帧列表长度为 1 时就是一张静态图 + 壳动效。
(function () {
  const STATES = ['idle', 'busy', 'waiting', 'celebrate', 'error'];
  const sprite = document.getElementById('sprite');
  const stage = document.getElementById('stage');

  let pack = null;
  let state = 'idle';
  let frames = [];
  let frameIndex = 0;
  let timer = null;

  function framesFor(name) {
    if (!pack || !pack.states) return [];
    const list = pack.states[name];
    if (Array.isArray(list) && list.length) return list;
    const fallback = pack.states.idle;
    return Array.isArray(fallback) ? fallback : [];
  }

  function stopTimer() {
    if (timer !== null) { clearInterval(timer); timer = null; }
  }

  function render() {
    if (!frames.length) { sprite.removeAttribute('src'); return; }
    const value = frames[frameIndex % frames.length];
    if (typeof value === 'string' && sprite.getAttribute('src') !== value) {
      sprite.setAttribute('src', value);
    }
  }

  function apply(nextState) {
    state = STATES.includes(nextState) ? nextState : 'idle';
    frames = framesFor(state);
    frameIndex = 0;
    stopTimer();
    render();
    for (const name of STATES) sprite.classList.toggle(name, name === state);
    // 重启一次性动画（庆祝/出错），否则同一状态连续触发不会重播。
    if (state === 'celebrate' || state === 'error') {
      sprite.style.animation = 'none';
      void sprite.offsetWidth;
      sprite.style.animation = '';
    }
    const rate = pack && Number.isFinite(pack.frameRate) ? pack.frameRate : 6;
    if (frames.length > 1) {
      timer = setInterval(() => {
        frameIndex = (frameIndex + 1) % frames.length;
        render();
      }, Math.max(40, Math.round(1000 / Math.min(24, Math.max(1, rate)))));
    }
  }

  function setPackage(value) {
    pack = value && typeof value === 'object' ? value : null;
    apply(state);
  }

  stage.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (window.whalePet) void window.whalePet.contextMenu();
  });

  if (window.whalePet) {
    window.whalePet.onPackage(setPackage);
    window.whalePet.onState((value) => apply(value && value.state));
    void window.whalePet.ready().then((value) => {
      if (!value) return;
      if (value.package) setPackage(value.package);
      apply(value.state);
    }).catch(() => { /* 主进程未就绪时保持空窗，不打断 */ });
  }
}());
