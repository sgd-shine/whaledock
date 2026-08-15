'use strict';

const api = window.whaleCapture;
const elements = Object.fromEntries([
  'workspace', 'instruction', 'clipboard', 'empty', 'preview', 'dimensions',
  'status', 'cancel', 'confirm-save', 'delivery', 'saved', 'route', 'review', 'target',
  'show-file', 'save-only', 'copy', 'send', 'step-input', 'step-save', 'step-deliver',
  'dropzone'
].map((id) => [id, document.getElementById(id)]));

let current = { stage: 'idle', captureId: null };
let busy = false;

function setText(element, value) {
  element.textContent = typeof value === 'string' ? value : '';
}

function stageStep(stage) {
  if (['delivery-ready', 'submitting', 'copied', 'done'].includes(stage)) return 3;
  if (['preview', 'saving', 'recognizing'].includes(stage)) return 2;
  return 1;
}

function statusText(value) {
  if (value.notice) return value.notice;
  const byStage = {
    idle: '等待图片。', acquiring: '等待图片。', preview: '请检查预览后完成第一次确认。',
    saving: '正在保存到当前工作区…', recognizing: '正在本地识别文字…',
    'delivery-ready': '请检查完整文本与目标会话。', submitting: '正在提交；请勿重复点击…',
    copied: '已复制。', done: '本次图片处理已完成。', failed: '图片处理失败。', cancelled: '已取消。'
  };
  return byStage[value.stage] || '等待图片。';
}

function renderTargets(targets) {
  const previous = elements.target.value;
  elements.target.replaceChildren();
  const rows = Array.isArray(targets) ? targets : [];
  if (!rows.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '自动提交不可用';
    elements.target.append(option);
  } else {
    for (const row of rows) {
      const option = document.createElement('option');
      option.value = row.targetToken;
      option.textContent = `${row.label}${row.running ? ' · 运行中' : ''}`;
      elements.target.append(option);
    }
    if (rows.some((row) => row.targetToken === previous)) elements.target.value = previous;
  }
}

function render(value) {
  current = value && typeof value === 'object' ? value : { stage: 'idle' };
  const stage = typeof current.stage === 'string' ? current.stage : 'idle';
  const step = stageStep(stage);
  setText(elements.workspace, current.workspaceLabel || '当前工作区');
  setText(elements.instruction, current.instruction || '可拖入或粘贴一张 PNG / JPEG；剪贴板只在你明确操作时读取。');
  setText(elements.status, statusText(current));
  elements.status.classList.toggle('error', stage === 'failed');
  for (let index = 1; index <= 3; index += 1) {
    elements[`step-${['input', 'save', 'deliver'][index - 1]}`].classList.toggle('active', index === step);
  }

  const hasPreview = typeof current.thumbnail === 'string';
  elements.empty.hidden = hasPreview;
  elements.preview.style.display = hasPreview ? 'block' : 'none';
  if (hasPreview) elements.preview.src = current.thumbnail;
  else elements.preview.removeAttribute('src');
  elements.dimensions.style.display = hasPreview ? 'block' : 'none';
  const sourceLabels = {
    'mac-capture': 'macOS 系统框选', 'windows-clipboard': 'Windows 剪贴板',
    paste: '用户粘贴', drop: '本地拖入'
  };
  setText(elements.dimensions, Number.isInteger(current.width) && Number.isInteger(current.height)
    ? `${sourceLabels[current.source] || '本地图片'} · ${current.width} × ${current.height} px · 确认后保存到当前工作区/鲸坞截图/`
    : '');

  const previewReady = stage === 'preview';
  const hasCaptureId = typeof current.captureId === 'string' && current.captureId.length > 0;
  elements.cancel.disabled = busy || !hasCaptureId;
  elements['confirm-save'].disabled = busy || !previewReady;
  elements.clipboard.disabled = busy || !['idle', 'acquiring'].includes(stage);
  const deliveryReady = ['delivery-ready', 'submitting', 'copied', 'done'].includes(stage);
  elements.delivery.style.display = deliveryReady ? 'block' : 'none';
  if (deliveryReady) {
    setText(elements.saved, current.savedPath ? `保存位置：${current.savedPath}` : '');
    const routeLabels = {
      official: '官方图片通道', plugin: '本地插件',
      'local-ocr': '本地 OCR 文本', 'path-only': '未证明 OCR 可用，仅交付保存路径'
    };
    setText(elements.route, `识别路由：${routeLabels[current.route] || '不可用'}`);
    setText(elements.review, current.deliveryText || '');
    renderTargets(current.targets);
  }
  const canDeliver = stage === 'delivery-ready' && !busy;
  elements.target.disabled = !canDeliver;
  elements.send.disabled = !canDeliver || !elements.target.value;
  elements.copy.disabled = !canDeliver;
  elements['save-only'].disabled = !canDeliver;
  elements['show-file'].disabled = !current.savedPath || busy;
}

async function perform(operation) {
  if (busy) return;
  busy = true;
  render(current);
  try {
    const result = await operation();
    if (result && typeof result === 'object' && result.stage) render(result);
  } catch (error) {
    setText(elements.status, error && error.message ? error.message : '操作失败');
    elements.status.classList.add('error');
  } finally {
    busy = false;
    render(current);
  }
}

elements.clipboard.addEventListener('click', () => perform(() => api.readClipboard()));
elements['confirm-save'].addEventListener('click', () => perform(() => api.confirmSave(current.captureId)));
elements.copy.addEventListener('click', () => perform(() => api.deliver({ captureId: current.captureId, action: 'copy' })));
elements['save-only'].addEventListener('click', () => perform(() => api.deliver({ captureId: current.captureId, action: 'save-only' })));
elements.send.addEventListener('click', () => perform(() => api.deliver({
  captureId: current.captureId, action: 'send', targetToken: elements.target.value
})));
elements['show-file'].addEventListener('click', () => perform(() => api.showInFolder(current.captureId)));
elements.cancel.addEventListener('click', () => perform(() => api.cancel(current.captureId)));
elements.target.addEventListener('change', () => { elements.send.disabled = busy || !elements.target.value; });
elements.dropzone.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && !elements.clipboard.disabled) {
    event.preventDefault();
    elements.clipboard.click();
  }
});

let pushedStateVersion = 0;
api.onState((value) => {
  pushedStateVersion += 1;
  render(value);
});
api.onInputError((message) => {
  setText(elements.status, message);
  elements.status.classList.add('error');
});
const stateVersionAtRequest = pushedStateVersion;
void api.getState().then((value) => {
  // did-finish-load 的早期 push 可能在 renderer 订阅前丢失，getState
  // 负责补首帧；若请求期间已有更新 push，则不得用旧回包覆盖新状态。
  if (pushedStateVersion === stateVersionAtRequest) render(value);
}).catch((error) => {
  setText(elements.status, error && error.message ? error.message : '无法读取图片状态');
  elements.status.classList.add('error');
});
