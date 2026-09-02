'use strict';

// v0.11：Host ↔ main 高层 workspace operation 的纯 Node 合同与投影。
// 本模块不依赖 Electron 或 fs；真实视频 runtime、窗口与 receipt IO 由 main 一次性注入。
const contextBridgeModel = require('./context-bridge');
const contextFileRpc = require('./context-file-rpc');
const deliveryReceipts = require('./delivery-receipts');
const videoShooting = require('./video-shooting');
const { PROJECT_OPERATION_NAMES } = require('./project-ops');

const CONTEXT_POC_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const CONTEXT_POC_TOKEN_RE = /^[a-f0-9]{64}$/;
const CONTEXT_POC_DELIVERY_TARGET_REF_RE = /^delivery-target-[a-f0-9]{64}$/;
const CONTEXT_POC_SESSION_ROOT_REF_RE = /^session-root-[a-f0-9]{64}$/;
const CONTEXT_POC_PROJECT_ID_RE = /^wdp1_[a-f0-9]{32}$/;
const CONTEXT_POC_PROJECT_REVISION_RE = /^[a-f0-9]{64}$/;
const CONTEXT_POC_WORKSPACE_FILE_PENDING_MS = 10000;
const CONTEXT_POC_MAX_WORKSPACE_FILE_READ_BATCH = 4;
const CONTEXT_POC_WORKSPACE_FILE_OPERATIONS = new Set([
  'catalog.read', 'document.read', 'overview.read', 'topic.choose',
  'block.action.prepare', 'block.action.submit',
  'proposal.read', 'proposal.decide', 'proposal.undo',
  'publish.read', 'publish.create', 'publish.update',
  'review.tactics.read', 'review.solidify',
  'shoot.open', 'shoot.history.read',
  'project.action.prepare', 'project.action.submit',
  'receipts.read', 'receipts.ack', 'receipts.open'
]);
const CONTEXT_POC_WORKSPACE_FILE_DELIVERY_OPERATIONS = new Set([
  'block.action.prepare', 'block.action.submit',
  'project.action.prepare', 'project.action.submit'
]);
const CONTEXT_POC_PROPOSAL_STATUSES = new Set([
  'queued', 'unchanged', 'ready', 'stale', 'invalid', 'adopted', 'conflict'
]);
const CONTEXT_POC_PROPOSAL_REASONS = new Set([
  'target-unchanged', 'original-changed', 'outside-target-changed',
  'proposal-too-large', 'read-failed', 'adopted-file-changed'
]);
const CONTEXT_POC_PROPOSAL_SUBMISSIONS = new Set([
  'sending', 'accepted', 'rejected', 'unknown', 'error'
]);
const VIDEO_STAGE_LABELS = Object.freeze({
  inspiration: '灵感', topic: '选题', script: '写稿', shoot: '拍摄', edit: '剪辑',
  publish: '发布', data: '数据', review: '复盘', asset: '打法库'
});
const VIDEO_BLOCK_INTENTS = Object.freeze({
  revise: true, spoken: true, shorten: true, ask: true
});
const VIDEO_PUBLISH_LIGHTS = Object.freeze({
  cover: '封面', title: '标题', topics: '标签话题', timing: '发布时间',
  'pinned-comment': '置顶评论', 'ai-label': 'AI 内容标识', published: '已由本人发布'
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function safeText(value, fallback, maximum = 120) {
  if (typeof value !== 'string') return fallback;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, maximum) : fallback;
}

function deliveryToken(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 256
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) ? value : null;
}

function shootingOpenMessage(state) {
  return Object.freeze({
    opened: '已请求打开本地拍摄现场；窗口可见与交互仍需在本机确认。',
    focused: '已请求聚焦这份口播稿现有的本地拍摄现场。',
    busy: '已有另一场本地拍摄尚未收工；已请求聚焦原窗口，本次没有切换稿件。',
    unavailable: '这份内容当前不能进入本地拍摄现场；没有创建拍摄会话。'
  })[state] || '本地拍摄现场当前不可用。';
}

const DEFAULT_DEPENDENCIES = Object.freeze([
  'catalog', 'document', 'overview', 'chooseTopic', 'projectAction', 'blockAction',
  'proposalSurface', 'proposalDecision', 'proposalUndo', 'publishSurface', 'publishAction',
  'tacticsCollection', 'solidifyAction', 'tacticSurface', 'shootSource', 'shootOpenAction',
  'shootHistoryCollection', 'verifyProject', 'receiptSnapshot', 'receiptProjectBinding',
  'ackReceipt', 'openReceipt', 'videoProjectActionRequest', 'videoProjectDispatchRequest',
  'videoDocumentRequest', 'videoBlockActionRequest', 'videoBlockDispatchRequest',
  'videoProposalDecisionRequest', 'videoUndoRequest', 'deliveryPulseRequest',
  'deliveryResultRequest', 'videoContentRef', 'videoProjectToken', 'safeRelativePath'
]);
let operationDefaults = Object.freeze({});

function configureContextPocWorkspaceOperationDefaults(value) {
  if (!isPlainObject(value)
      || DEFAULT_DEPENDENCIES.some((name) => typeof value[name] !== 'function')) {
    throw new TypeError('context workspace operation defaults invalid');
  }
  operationDefaults = Object.freeze(Object.fromEntries(
    DEFAULT_DEPENDENCIES.map((name) => [name, value[name]])
  ));
  return operationDefaults;
}

function operationDependency(name, source = operationDefaults) {
  const dependency = source && source[name];
  if (typeof dependency !== 'function') {
    throw new TypeError(`context workspace operation dependency missing: ${name}`);
  }
  return dependency;
}

function videoProjectActionRequest(value) {
  return operationDependency('videoProjectActionRequest')(value);
}
function videoProjectDispatchRequest(value) {
  return operationDependency('videoProjectDispatchRequest')(value);
}
function videoDocumentRequest(value) {
  return operationDependency('videoDocumentRequest')(value);
}
function videoBlockActionRequest(value) {
  return operationDependency('videoBlockActionRequest')(value);
}
function videoBlockDispatchRequest(value) {
  return operationDependency('videoBlockDispatchRequest')(value);
}
function videoProposalDecisionRequest(value) {
  return operationDependency('videoProposalDecisionRequest')(value);
}
function videoUndoRequest(value) {
  return operationDependency('videoUndoRequest')(value);
}
function deliveryPulseRequest(value) {
  return operationDependency('deliveryPulseRequest')(value);
}
function deliveryResultRequest(value) {
  return operationDependency('deliveryResultRequest')(value);
}

function contextPocExact(value, required, optional = []) {
  if (!isPlainObject(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function contextPocValidId(value) {
  return typeof value === 'string' && CONTEXT_POC_ID_RE.test(value);
}

function contextPocWorkspaceFileInputValue(value, maximumBytes = contextFileRpc.DEFAULT_LIMITS.maxInputBytes) {
  if (!isPlainObject(value)) return null;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1
      || maximumBytes > contextFileRpc.OPERATION_LIMIT_CEILINGS.maxInputBytes) return null;
  try {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') > maximumBytes) {
      return null;
    }
    const cloned = JSON.parse(serialized);
    return isPlainObject(cloned) ? Object.freeze(cloned) : null;
  } catch (_error) { return null; }
}

function contextPocWorkspaceFileRequestValue(value) {
  const commonValid = isPlainObject(value)
      && CONTEXT_POC_TOKEN_RE.test(String(value.requestToken || ''))
      && Number.isSafeInteger(value.requestSeq) && value.requestSeq >= 1
      && contextPocValidId(value.controllerId) && contextPocValidId(value.pageInstanceId)
      && Number.isSafeInteger(value.selectionRevision) && value.selectionRevision >= 1
      && Number.isSafeInteger(value.issuedAtMs) && value.issuedAtMs >= 0
      && Number.isSafeInteger(value.deadlineMs)
      && value.deadlineMs === value.issuedAtMs + CONTEXT_POC_WORKSPACE_FILE_PENDING_MS;
  if (!commonValid) return null;

  // v0.11 项目/控制室操作只绑定受信 Host/controller/page 与最新
  // selection revision，不借用当前视频项目或 context root。
  if (PROJECT_OPERATION_NAMES.has(value.operation)) {
    if (!contextPocExact(value, [
      'requestToken', 'requestSeq', 'controllerId', 'pageInstanceId',
      'selectionRevision', 'operation', 'input', 'issuedAtMs', 'deadlineMs'
    ], ['currentBindingRef', 'sessionRootRef'])) return null;
    const input = contextPocWorkspaceFileInputValue(
      value.input,
      value.operation === 'console.read' ? 48 * 1024 : 24 * 1024
    );
    const hasCurrentBinding = Object.prototype.hasOwnProperty.call(
      value, 'currentBindingRef'
    );
    const openCommit = value.operation === 'projects.open'
      && input && input.phase === 'commit';
    const rootBoundOperation = value.operation === 'projects.bind' || openCommit;
    const hasSessionRoot = Object.prototype.hasOwnProperty.call(value, 'sessionRootRef');
    if (openCommit !== hasCurrentBinding
        || (hasCurrentBinding && !/^session-binding-[a-f0-9]{64}$/
          .test(String(value.currentBindingRef || '')))
        || rootBoundOperation !== hasSessionRoot
        || (hasSessionRoot && !CONTEXT_POC_SESSION_ROOT_REF_RE
          .test(String(value.sessionRootRef || '')))) return null;
    return input ? Object.freeze({ ...value, input }) : null;
  }

  if (!contextPocExact(value, [
    'requestToken', 'requestSeq', 'controllerId', 'pageInstanceId',
    'selectionRevision', 'projectId', 'projectRevision', 'contextRevision',
    'operation', 'input', 'issuedAtMs', 'deadlineMs'
  ], ['deliveryTargetRef']) || !CONTEXT_POC_PROJECT_ID_RE.test(String(value.projectId || ''))
      || !(value.projectRevision === null
        || CONTEXT_POC_PROJECT_REVISION_RE.test(String(value.projectRevision || '')))
      || !Number.isSafeInteger(value.contextRevision) || value.contextRevision < 1
      || !CONTEXT_POC_WORKSPACE_FILE_OPERATIONS.has(value.operation)) return null;
  const deliveryOperation = CONTEXT_POC_WORKSPACE_FILE_DELIVERY_OPERATIONS.has(value.operation);
  if (deliveryOperation
    ? !CONTEXT_POC_DELIVERY_TARGET_REF_RE.test(String(value.deliveryTargetRef || ''))
    : Object.prototype.hasOwnProperty.call(value, 'deliveryTargetRef')) return null;
  const input = contextPocWorkspaceFileInputValue(value.input);
  return input ? Object.freeze({ ...value, input }) : null;
}

function contextPocWorkspaceFileReadResponseValue(value, runtime) {
  if (!contextPocExact(value, ['contract', 'hostInstanceId', 'requests'])
      || value.contract !== contextBridgeModel.CONTRACT_VERSION
      || !runtime || !runtime.handshake
      || value.hostInstanceId !== runtime.handshake.hostInstanceId
      || !Array.isArray(value.requests)
      || value.requests.length > CONTEXT_POC_MAX_WORKSPACE_FILE_READ_BATCH) return null;
  const requests = value.requests.map(contextPocWorkspaceFileRequestValue);
  if (requests.some((request) => request === null)
      || new Set(requests.map((request) => request.requestToken)).size !== requests.length
      || new Set(requests.map((request) => request.requestSeq)).size !== requests.length) return null;
  return Object.freeze({
    contract: value.contract,
    hostInstanceId: value.hostInstanceId,
    requests: Object.freeze(requests)
  });
}

function contextPocWorkspaceFileClaimValue(value) {
  if (contextPocExact(value, ['claimed', 'code']) && value.claimed === false
      && ['operation-stale', 'already-running', 'already-settled'].includes(value.code)) {
    return Object.freeze({ claimed: false, code: value.code });
  }
  if (!contextPocExact(value, [
    'claimed', 'code', 'claimToken', 'runningDeadlineMs'
  ]) || value.claimed !== true || value.code !== null
      || !CONTEXT_POC_TOKEN_RE.test(String(value.claimToken || ''))
      || !Number.isSafeInteger(value.runningDeadlineMs) || value.runningDeadlineMs < 0) return null;
  return Object.freeze({ ...value });
}

function contextPocWorkspaceFileSettleValue(value) {
  if (!contextPocExact(value, ['settled', 'code']) || typeof value.settled !== 'boolean'
      || (value.settled ? value.code !== null
        : !['operation-stale', 'outcome-unknown'].includes(value.code))) return null;
  return Object.freeze({ settled: value.settled, code: value.code });
}

function contextPocWorkspaceFileRootAuthorizationValue(value) {
  if (contextPocExact(value, ['authorized', 'code']) && value.authorized === false
      && ['operation-stale', 'workspace-mismatch'].includes(value.code)) {
    return Object.freeze({ authorized: false, code: value.code });
  }
  if (!contextPocExact(value, ['authorized', 'code', 'authorizationToken'])
      || value.authorized !== true || value.code !== null
      || !CONTEXT_POC_TOKEN_RE.test(String(value.authorizationToken || ''))) return null;
  return Object.freeze({ ...value });
}

function contextPocWorkspaceFilePageInput(value, maximumLimit) {
  if (!isPlainObject(value)
      || Object.keys(value).some((key) => key !== 'cursor' && key !== 'limit')) {
    throw new Error('文件页请求字段无效');
  }
  const cursor = value.cursor === undefined ? 0 : value.cursor;
  const limit = value.limit === undefined ? maximumLimit : value.limit;
  if (!Number.isSafeInteger(cursor) || cursor < 0
      || !Number.isSafeInteger(limit) || limit < 1 || limit > maximumLimit) {
    throw new Error('文件页游标或上限无效');
  }
  return Object.freeze({ cursor, limit });
}

function contextPocWorkspaceFileProjectInput(value) {
  if (!isPlainObject(value)
      || Object.keys(value).some((key) => !['projectToken', 'cursor', 'limit'].includes(key))
      || typeof value.projectToken !== 'string'
      || !/^project-[a-f0-9]{24}$/.test(value.projectToken)) {
    throw new Error('项目文档请求无效');
  }
  return Object.freeze({
    projectToken: value.projectToken,
    ...contextPocWorkspaceFilePageInput({ cursor: value.cursor, limit: value.limit }, 2)
  });
}

function contextPocWorkspaceFileOverviewInput(value) {
  if (!contextPocExact(value, ['projectToken', 'cursor', 'limit'])
      || typeof value.projectToken !== 'string'
      || !/^project-[a-f0-9]{24}$/.test(value.projectToken)) {
    throw new Error('项目概览请求无效');
  }
  const page = contextPocWorkspaceFilePageInput({
    cursor: value.cursor,
    limit: value.limit
  }, 4);
  if (page.cursor > 64) throw new Error('项目概览游标无效');
  return Object.freeze({ projectToken: value.projectToken, ...page });
}

function contextPocWorkspaceFileTopicInput(value) {
  if (!contextPocExact(value, ['projectToken', 'field', 'value'])
      || typeof value.projectToken !== 'string'
      || !/^project-[a-f0-9]{24}$/.test(value.projectToken)
      || !['angle', 'hook'].includes(value.field)
      || typeof value.value !== 'string' || !value.value
      || value.value.length > 240
      || /[\u0000-\u001f\u007f]/.test(value.value)) {
    throw new Error('选题拍板请求无效');
  }
  return Object.freeze({
    projectToken: value.projectToken,
    field: value.field,
    value: value.value
  });
}

function contextPocWorkspaceFileActionPrepareInput(value) {
  return Object.freeze(videoProjectActionRequest(value));
}

function contextPocWorkspaceFileActionSubmitInput(value) {
  if (!contextPocExact(value, [
    'projectToken', 'actionId', 'preflightToken', 'override'
  ])) throw new Error('项目动作提交请求无效');
  const dispatch = videoProjectDispatchRequest(value);
  if (!dispatch.confirmation) throw new Error('项目动作提交缺少预检');
  return Object.freeze({
    ...dispatch.request,
    preflightToken: dispatch.confirmation.preflightToken,
    override: dispatch.confirmation.override
  });
}

function contextPocWorkspaceFileBlockPrepareInput(value) {
  return Object.freeze(videoBlockActionRequest(value));
}

function contextPocWorkspaceFileBlockSubmitInput(value) {
  if (!contextPocExact(value, [
    'projectToken', 'blockToken', 'action', 'preflightToken', 'override'
  ])) throw new Error('内容块动作提交请求无效');
  const dispatch = videoBlockDispatchRequest(value);
  if (!dispatch.confirmation) throw new Error('内容块动作提交缺少预检');
  return Object.freeze({
    ...dispatch.request,
    preflightToken: dispatch.confirmation.preflightToken,
    override: dispatch.confirmation.override
  });
}

function contextPocWorkspaceFileProposalReadInput(value) {
  if (!contextPocExact(value, ['contentRef'])
      || typeof value.contentRef !== 'string'
      || !/^content-[a-f0-9]{24}$/.test(value.contentRef)) {
    throw new Error('建议卡读取请求无效');
  }
  return Object.freeze({ contentRef: value.contentRef });
}

function contextPocWorkspaceFileProposalDecisionInput(value) {
  if (!isPlainObject(value) || !['adopt', 'reject'].includes(value.decision)
      || !contextPocExact(value, value.decision === 'adopt'
        ? ['contentRef', 'proposalToken', 'decision', 'proposalRevisionToken']
        : ['contentRef', 'proposalToken', 'decision'])
      || typeof value.contentRef !== 'string'
      || !/^content-[a-f0-9]{24}$/.test(value.contentRef)) {
    throw new Error('建议卡决策请求无效');
  }
  const decision = videoProposalDecisionRequest({
    proposalToken: value.proposalToken,
    decision: value.decision,
    ...(value.decision === 'adopt'
      ? { proposalRevisionToken: value.proposalRevisionToken } : {})
  });
  return Object.freeze({
    contentRef: value.contentRef,
    proposalToken: decision.proposalToken,
    decision: decision.decision,
    ...(decision.decision === 'adopt'
      ? { proposalRevisionToken: decision.proposalRevisionToken } : {})
  });
}

function contextPocWorkspaceFileProposalUndoInput(value) {
  if (!contextPocExact(value, ['contentRef', 'revisionToken'])
      || typeof value.contentRef !== 'string'
      || !/^content-[a-f0-9]{24}$/.test(value.contentRef)) {
    throw new Error('建议撤销请求无效');
  }
  const undo = videoUndoRequest({ revisionToken: value.revisionToken });
  return Object.freeze({ contentRef: value.contentRef, revisionToken: undo.revisionToken });
}

function contextPocWorkspaceFilePublishInput(value) {
  if (!contextPocExact(value, ['contentRef', 'projectToken'])
      || typeof value.contentRef !== 'string'
      || !/^content-[a-f0-9]{24}$/.test(value.contentRef)
      || typeof value.projectToken !== 'string'
      || !/^project-[a-f0-9]{24}$/.test(value.projectToken)) {
    throw new Error('发布页内容身份无效');
  }
  return Object.freeze({
    contentRef: value.contentRef,
    projectToken: value.projectToken
  });
}

function contextPocWorkspaceFilePublishUpdateInput(value) {
  if (!isPlainObject(value) || !['light', 'ai-disclosure'].includes(value.type)) {
    throw new Error('发布页写回请求无效');
  }
  contextPocWorkspaceFilePublishInput({
    contentRef: value.contentRef,
    projectToken: value.projectToken
  });
  if (value.type === 'light') {
    if (!contextPocExact(value, [
      'contentRef', 'projectToken', 'type', 'lightId', 'checked'
    ]) || !Object.prototype.hasOwnProperty.call(VIDEO_PUBLISH_LIGHTS, value.lightId)
        || typeof value.checked !== 'boolean') {
      throw new Error('发布灯写回请求无效');
    }
    return Object.freeze({
      contentRef: value.contentRef,
      projectToken: value.projectToken,
      type: 'light', lightId: value.lightId, checked: value.checked
    });
  }
  if (!contextPocExact(value, [
    'contentRef', 'projectToken', 'type', 'value'
  ]) || !['unknown', 'ai', 'not-ai'].includes(value.value)) {
    throw new Error('AI 内容状态写回请求无效');
  }
  return Object.freeze({
    contentRef: value.contentRef,
    projectToken: value.projectToken,
    type: 'ai-disclosure', value: value.value
  });
}

function contextPocWorkspaceFileReviewIdentityInput(value) {
  if (!contextPocExact(value, ['contentRef', 'projectToken'])
      || typeof value.contentRef !== 'string'
      || !/^content-[a-f0-9]{24}$/.test(value.contentRef)
      || typeof value.projectToken !== 'string'
      || !/^project-[a-f0-9]{24}$/.test(value.projectToken)) {
    throw new Error('复盘页内容身份无效');
  }
  return Object.freeze({
    contentRef: value.contentRef,
    projectToken: value.projectToken
  });
}

function contextPocWorkspaceFileTacticsInput(value) {
  if (!contextPocExact(value, [
    'contentRef', 'projectToken', 'cursor', 'limit', 'collectionToken'
  ])) throw new Error('打法库分页请求无效');
  contextPocWorkspaceFileReviewIdentityInput({
    contentRef: value.contentRef,
    projectToken: value.projectToken
  });
  if (!Number.isSafeInteger(value.cursor) || value.cursor < 0 || value.cursor > 512
      || !Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 4
      || (value.cursor === 0 && value.collectionToken !== null)
      || (value.cursor > 0 && !/^collection-[a-f0-9]{24}$/.test(
        String(value.collectionToken || '')
      ))) {
    throw new Error('打法库分页身份无效');
  }
  return Object.freeze({ ...value });
}

function contextPocWorkspaceFileShootIdentityInput(value) {
  if (!contextPocExact(value, ['contentRef', 'projectToken'])
      || typeof value.contentRef !== 'string'
      || !/^content-[a-f0-9]{24}$/.test(value.contentRef)
      || typeof value.projectToken !== 'string'
      || !/^project-[a-f0-9]{24}$/.test(value.projectToken)) {
    throw new Error('拍摄页内容身份无效');
  }
  return Object.freeze({
    contentRef: value.contentRef,
    projectToken: value.projectToken
  });
}

function contextPocWorkspaceFileShootHistoryInput(value) {
  if (!contextPocExact(value, [
    'contentRef', 'projectToken', 'cursor', 'limit', 'collectionToken'
  ])) throw new Error('拍摄历史分页请求无效');
  contextPocWorkspaceFileShootIdentityInput({
    contentRef: value.contentRef,
    projectToken: value.projectToken
  });
  if (!Number.isSafeInteger(value.cursor) || value.cursor < 0 || value.cursor > 512
      || !Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 4
      || (value.cursor === 0 && value.collectionToken !== null)
      || (value.cursor > 0 && !/^collection-[a-f0-9]{24}$/.test(
        String(value.collectionToken || '')
      ))) {
    throw new Error('拍摄历史分页身份无效');
  }
  return Object.freeze({ ...value });
}

function contextPocWorkspaceFileReceiptsInput(value) {
  if (!contextPocExact(value, ['projectToken', 'limit'])) {
    throw new Error('投递回执请求无效');
  }
  videoDocumentRequest({ projectToken: value.projectToken });
  if (!Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 6) {
    throw new Error('投递回执上限无效');
  }
  return Object.freeze({ projectToken: value.projectToken, limit: value.limit });
}

function contextPocWorkspaceWorkflow(value) {
  if (value && value.publish && value.publish.published === true) {
    return Object.freeze({ status: 'published', label: '已发布' });
  }
  const stage = value && value.stage;
  if (stage === 'inspiration') return Object.freeze({ status: 'inspiration', label: '灵感' });
  if (stage === 'topic') return Object.freeze({ status: 'topic', label: '选题' });
  if (stage === 'script') return Object.freeze({ status: 'script', label: '写稿' });
  if (stage === 'shoot' || stage === 'edit') {
    return Object.freeze({ status: 'shoot', label: '拍摄' });
  }
  if (stage === 'publish') return Object.freeze({ status: 'unpublished', label: '待发布' });
  return Object.freeze({ status: 'uncategorized', label: '未分类' });
}

function contextPocWorkspaceCatalogCard(value) {
  if (!isPlainObject(value) || typeof value.projectToken !== 'string'
      || !/^project-[a-f0-9]{24}$/.test(value.projectToken)
      || typeof value.contentRef !== 'string'
      || !/^content-[a-f0-9]{24}$/.test(value.contentRef)) {
    throw new Error('内容卡投影无效');
  }
  const cleanList = (items) => (Array.isArray(items) ? items : [])
    .map((item) => safeText(item, '', 64)).filter(Boolean).slice(0, 3);
  const publish = isPlainObject(value.publish) ? Object.freeze({
    ready: value.publish.ready === true,
    published: value.publish.published === true,
    aiDisclosure: ['unknown', 'ai', 'not-ai'].includes(value.publish.aiDisclosure)
      ? value.publish.aiDisclosure : 'unknown'
  }) : null;
  const workflow = contextPocWorkspaceWorkflow({ stage: value.stage, publish });
  const actions = (Array.isArray(value.actions) ? value.actions : []).slice(0, 4).map((action) => {
    if (!isPlainObject(action)
        || typeof action.id !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(action.id)) {
      throw new Error('内容卡动作投影无效');
    }
    return Object.freeze({
      id: action.id,
      label: safeText(action.label, '继续', 32),
      hint: safeText(action.hint, '', 100)
    });
  });
  return Object.freeze({
    projectToken: value.projectToken,
    contentRef: value.contentRef,
    title: safeText(value.title, '未命名项目', 120),
    stage: Object.prototype.hasOwnProperty.call(VIDEO_STAGE_LABELS, value.stage)
      ? value.stage : null,
    stageLabel: safeText(value.stageLabel, '未分类', 24),
    status: safeText(value.status, '', 48) || null,
    updated: safeText(value.updated, '', 64) || null,
    decision: safeText(value.decision, '', 160) || null,
    angle: safeText(value.angle, '', 240) || null,
    hook: safeText(value.hook, '', 240) || null,
    angleOptions: cleanList(value.angles),
    hookOptions: cleanList(value.hooks),
    canShoot: value.canShoot === true,
    publish,
    workflowStatus: workflow.status,
    workflowLabel: workflow.label,
    actions: Object.freeze(actions)
  });
}

function contextPocWorkspaceCatalogResult(value) {
  if (!contextPocExact(value, [
    'kind', 'generation', 'projectCount', 'cursor', 'nextCursor', 'projects'
  ]) || value.kind !== 'catalog'
      || !Number.isSafeInteger(value.generation) || value.generation < 0
      || !Number.isSafeInteger(value.projectCount) || value.projectCount < 0
      || !Number.isSafeInteger(value.cursor) || value.cursor < 0
      || !(value.nextCursor === null
        || (Number.isSafeInteger(value.nextCursor) && value.nextCursor > value.cursor))
      || !Array.isArray(value.projects) || value.projects.length > 4) {
    throw new Error('内容库投影无效');
  }
  return Object.freeze({
    kind: 'catalog', generation: value.generation,
    projectCount: value.projectCount, cursor: value.cursor,
    nextCursor: value.nextCursor,
    projects: Object.freeze(value.projects.map(contextPocWorkspaceCatalogCard))
  });
}

function contextPocWorkspaceDocumentResult(value) {
  if (!contextPocExact(value, [
    'kind', 'projectToken', 'title', 'stage', 'stageLabel', 'blockCount',
    'cursor', 'nextCursor', 'truncated', 'blocks'
  ]) || value.kind !== 'document'
      || typeof value.projectToken !== 'string'
      || !/^project-[a-f0-9]{24}$/.test(value.projectToken)
      || !Number.isSafeInteger(value.blockCount) || value.blockCount < 0
      || !Number.isSafeInteger(value.cursor) || value.cursor < 0
      || !(value.nextCursor === null
        || (Number.isSafeInteger(value.nextCursor) && value.nextCursor > value.cursor))
      || typeof value.truncated !== 'boolean'
      || !Array.isArray(value.blocks) || value.blocks.length > 2) {
    throw new Error('文档投影无效');
  }
  const blocks = value.blocks.map((block) => {
    if (!contextPocExact(block, [
      'blockToken', 'kind', 'text', 'textTruncated', 'startLine', 'endLine'
    ]) || typeof block.blockToken !== 'string'
        || !/^block-[a-f0-9]{24}$/.test(block.blockToken)
        || typeof block.kind !== 'string' || !/^[a-z][a-z-]{0,31}$/.test(block.kind)
        || typeof block.text !== 'string' || Buffer.byteLength(block.text, 'utf8') > 2048
        || typeof block.textTruncated !== 'boolean'
        || !Number.isSafeInteger(block.startLine) || block.startLine < 1
        || !Number.isSafeInteger(block.endLine) || block.endLine < block.startLine) {
      throw new Error('文档块投影无效');
    }
    return Object.freeze({ ...block });
  });
  return Object.freeze({
    kind: 'document', projectToken: value.projectToken,
    title: safeText(value.title, '未命名文档', 120),
    stage: Object.prototype.hasOwnProperty.call(VIDEO_STAGE_LABELS, value.stage)
      ? value.stage : null,
    stageLabel: safeText(value.stageLabel, '未分类', 24),
    blockCount: value.blockCount,
    cursor: value.cursor,
    nextCursor: value.nextCursor,
    truncated: value.truncated,
    blocks: Object.freeze(blocks)
  });
}

function contextPocWorkspaceOverviewResult(value) {
  if (!contextPocExact(value, [
    'kind', 'contentRef', 'projectToken', 'title', 'stage', 'stageLabel',
    'status', 'updated', 'decision', 'angle', 'hook', 'candidateCount',
    'cursor', 'nextCursor', 'candidates'
  ]) || value.kind !== 'overview'
      || typeof value.contentRef !== 'string'
      || !/^content-[a-f0-9]{24}$/.test(value.contentRef)
      || typeof value.projectToken !== 'string'
      || !/^project-[a-f0-9]{24}$/.test(value.projectToken)
      || !Number.isSafeInteger(value.candidateCount)
      || value.candidateCount < 0 || value.candidateCount > 64
      || !Number.isSafeInteger(value.cursor) || value.cursor < 0 || value.cursor > 64
      || !Array.isArray(value.candidates) || value.candidates.length > 4
      || value.cursor + value.candidates.length > value.candidateCount) {
    throw new Error('项目概览投影无效');
  }
  const expectedNext = value.cursor + value.candidates.length < value.candidateCount
    ? value.cursor + value.candidates.length : null;
  if (value.nextCursor !== expectedNext) throw new Error('项目概览分页投影无效');
  const candidates = value.candidates.map((candidate) => {
    if (!contextPocExact(candidate, ['field', 'value', 'selected'])
        || !['angle', 'hook'].includes(candidate.field)
        || typeof candidate.value !== 'string' || !candidate.value.trim()
        || candidate.value.length > 240
        || /[\u0000-\u001f\u007f]/.test(candidate.value)
        || typeof candidate.selected !== 'boolean') {
      throw new Error('项目概览候选投影无效');
    }
    return Object.freeze({
      field: candidate.field,
      value: candidate.value,
      selected: candidate.selected
    });
  });
  const nullableText = (input, maximum) => (
    input === null ? null : safeText(input, '', maximum) || null
  );
  return Object.freeze({
    kind: 'overview',
    contentRef: value.contentRef,
    projectToken: value.projectToken,
    title: safeText(value.title, '未命名项目', 120),
    stage: Object.prototype.hasOwnProperty.call(VIDEO_STAGE_LABELS, value.stage)
      ? value.stage : null,
    stageLabel: safeText(value.stageLabel, '未分类', 24),
    status: nullableText(value.status, 48),
    updated: nullableText(value.updated, 64),
    decision: nullableText(value.decision, 160),
    angle: nullableText(value.angle, 240),
    hook: nullableText(value.hook, 240),
    candidateCount: value.candidateCount,
    cursor: value.cursor,
    nextCursor: value.nextCursor,
    candidates: Object.freeze(candidates)
  });
}

function contextPocWorkspaceMutationResult(value) {
  if (!contextPocExact(value, [
    'kind', 'changed', 'contentRef', 'projectToken', 'field', 'value',
    'updated', 'message'
  ])
      || value.kind !== 'mutation' || value.changed !== true
      || typeof value.contentRef !== 'string'
      || !/^content-[a-f0-9]{24}$/.test(value.contentRef)
      || typeof value.projectToken !== 'string'
      || !/^project-[a-f0-9]{24}$/.test(value.projectToken)
      || !['angle', 'hook'].includes(value.field)
      || typeof value.value !== 'string' || !value.value.trim()
      || value.value.length > 240 || /[\u0000-\u001f\u007f]/.test(value.value)
      || typeof value.updated !== 'string' || !value.updated
      || value.updated.length > 64 || /[\u0000-\u001f\u007f]/.test(value.updated)
      || typeof value.message !== 'string' || !value.message
      || [...value.message].length > 160) throw new Error('写回结果投影无效');
  return Object.freeze({ ...value });
}

function contextPocWorkspaceSafeMessage(value, fallback) {
  return safeText(value, fallback, 160);
}

function contextPocWorkspaceIsoTime(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function contextPocWorkspaceActionPrepareResult(value) {
  if (contextPocExact(value, ['state', 'text']) && value.state === 'error') {
    return Object.freeze({
      state: 'error',
      message: contextPocWorkspaceSafeMessage(value.text, '无法完成投递预检。')
    });
  }
  if (!contextPocExact(value, [
    'kind', 'preflightToken', 'targetLabel', 'workspaceLabel', 'workspaceMatch',
    'targetRunning', 'eventTracking', 'expiresAt'
  ]) || value.kind !== 'preflight' || !deliveryToken(value.preflightToken)
      || !['match', 'mismatch', 'unknown'].includes(value.workspaceMatch)
      || typeof value.targetRunning !== 'boolean'
      || !['ready', 'unavailable'].includes(value.eventTracking)
      || !contextPocWorkspaceIsoTime(value.expiresAt)) {
    throw new Error('项目动作预检投影无效');
  }
  return Object.freeze({
    kind: 'preflight',
    preflightToken: value.preflightToken,
    targetLabel: safeText(value.targetLabel, '目标会话', 96),
    workspaceLabel: safeText(value.workspaceLabel, '当前工作区', 96),
    workspaceMatch: value.workspaceMatch,
    targetRunning: value.targetRunning,
    eventTracking: value.eventTracking,
    expiresAt: value.expiresAt
  });
}

function contextPocWorkspaceActionSubmitResult(value) {
  if (contextPocExact(value, ['state', 'text']) && value.state === 'error') {
    return Object.freeze({
      state: 'error',
      message: contextPocWorkspaceSafeMessage(value.text, '投递没有完成。')
    });
  }
  const hasReceipt = isPlainObject(value)
    && Object.prototype.hasOwnProperty.call(value, 'receiptId');
  if (!contextPocExact(value, hasReceipt
    ? ['state', 'reason', 'target', 'receiptId']
    : ['state', 'reason', 'target'])
      || !['accepted', 'rejected', 'unknown'].includes(value.state)
      || typeof value.reason !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value.reason)
      || typeof value.target !== 'string'
      || (hasReceipt && !deliveryToken(value.receiptId))) {
    throw new Error('项目动作提交投影无效');
  }
  return Object.freeze({
    state: value.state,
    reason: value.reason,
    target: safeText(value.target, '目标会话', 96),
    ...(hasReceipt ? { receiptId: value.receiptId } : {})
  });
}

function contextPocWorkspaceBlockIdentity(value) {
  return Boolean(isPlainObject(value)
    && typeof value.contentRef === 'string'
    && /^content-[a-f0-9]{24}$/.test(value.contentRef)
    && typeof value.projectToken === 'string'
    && /^project-[a-f0-9]{24}$/.test(value.projectToken)
    && typeof value.blockToken === 'string'
    && /^block-[a-f0-9]{24}$/.test(value.blockToken)
    && Object.prototype.hasOwnProperty.call(VIDEO_BLOCK_INTENTS, value.action));
}

function contextPocWorkspaceBlockPrepareResult(value) {
  if (!contextPocExact(value, [
    'kind', 'contentRef', 'projectToken', 'blockToken', 'action', 'state',
    'preflightToken', 'targetLabel', 'workspaceLabel', 'workspaceMatch',
    'targetRunning', 'eventTracking', 'expiresAt', 'message'
  ]) || value.kind !== 'preflight' || !contextPocWorkspaceBlockIdentity(value)
      || !['ready', 'error'].includes(value.state)) {
    throw new Error('内容块动作预检投影无效');
  }
  if (value.state === 'error') {
    if (![value.preflightToken, value.targetLabel, value.workspaceLabel,
      value.workspaceMatch, value.targetRunning, value.eventTracking,
      value.expiresAt].every((item) => item === null)
        || typeof value.message !== 'string' || !value.message) {
      throw new Error('内容块动作失败投影无效');
    }
    return Object.freeze({
      ...value,
      message: contextPocWorkspaceSafeMessage(value.message, '无法完成内容块动作预检。')
    });
  }
  if (!deliveryToken(value.preflightToken)
      || typeof value.targetLabel !== 'string'
      || typeof value.workspaceLabel !== 'string'
      || !['match', 'mismatch', 'unknown'].includes(value.workspaceMatch)
      || typeof value.targetRunning !== 'boolean'
      || !['ready', 'unavailable'].includes(value.eventTracking)
      || !contextPocWorkspaceIsoTime(value.expiresAt)
      || value.message !== null) {
    throw new Error('内容块动作预检投影无效');
  }
  return Object.freeze({
    ...value,
    targetLabel: safeText(value.targetLabel, '目标会话', 96),
    workspaceLabel: safeText(value.workspaceLabel, '当前工作区', 96)
  });
}

function contextPocWorkspaceBlockSubmitResult(value) {
  if (!contextPocExact(value, [
    'kind', 'contentRef', 'projectToken', 'blockToken', 'action', 'state',
    'reason', 'target', 'receiptId', 'message'
  ]) || value.kind !== 'submission' || !contextPocWorkspaceBlockIdentity(value)
      || !['accepted', 'rejected', 'unknown', 'error'].includes(value.state)) {
    throw new Error('内容块动作提交投影无效');
  }
  if (value.state === 'error') {
    if (![value.reason, value.target, value.receiptId].every((item) => item === null)
        || typeof value.message !== 'string' || !value.message) {
      throw new Error('内容块动作失败投影无效');
    }
    return Object.freeze({
      ...value,
      message: contextPocWorkspaceSafeMessage(value.message, '内容块动作没有发送。')
    });
  }
  if (typeof value.reason !== 'string'
      || !/^[a-z][a-z0-9-]{0,63}$/.test(value.reason)
      || typeof value.target !== 'string'
      || !(value.receiptId === null || deliveryToken(value.receiptId))
      || value.message !== null) {
    throw new Error('内容块动作提交投影无效');
  }
  return Object.freeze({
    ...value,
    target: safeText(value.target, '目标会话', 96)
  });
}

function contextPocWorkspaceProposalResult(value) {
  if (!contextPocExact(value, [
    'kind', 'contentRef', 'projectToken', 'status', 'reason', 'proposalToken',
    'proposalRevisionToken', 'revisionToken', 'title', 'intentLabel',
    'before', 'beforeTruncated', 'after', 'afterTruncated', 'canAdopt',
    'canReject', 'canUndo', 'submitted', 'target'
  ]) || value.kind !== 'proposal'
      || typeof value.contentRef !== 'string'
      || !/^content-[a-f0-9]{24}$/.test(value.contentRef)
      || typeof value.projectToken !== 'string'
      || !/^project-[a-f0-9]{24}$/.test(value.projectToken)
      || !(value.status === null || CONTEXT_POC_PROPOSAL_STATUSES.has(value.status))
      || !(value.reason === null || CONTEXT_POC_PROPOSAL_REASONS.has(value.reason))
      || !(value.proposalToken === null
        || (typeof value.proposalToken === 'string'
          && /^proposal-[A-Za-z0-9_-]{1,80}$/.test(value.proposalToken)))
      || !(value.proposalRevisionToken === null
        || (typeof value.proposalRevisionToken === 'string'
          && /^proposal-revision-[a-f0-9]{24}$/.test(value.proposalRevisionToken)))
      || !(value.revisionToken === null
        || (typeof value.revisionToken === 'string'
          && /^revision-[a-f0-9]{24}$/.test(value.revisionToken)))
      || !(value.title === null || typeof value.title === 'string')
      || !(value.intentLabel === null || typeof value.intentLabel === 'string')
      || !(value.before === null || (typeof value.before === 'string'
        && Buffer.byteLength(value.before, 'utf8') <= 1600))
      || typeof value.beforeTruncated !== 'boolean'
      || !(value.after === null || (typeof value.after === 'string'
        && Buffer.byteLength(value.after, 'utf8') <= 1600))
      || typeof value.afterTruncated !== 'boolean'
      || ![value.canAdopt, value.canReject, value.canUndo]
        .every((item) => typeof item === 'boolean')
      || !(value.submitted === null
        || CONTEXT_POC_PROPOSAL_SUBMISSIONS.has(value.submitted))
      || !(value.target === null || typeof value.target === 'string')) {
    throw new Error('建议卡投影无效');
  }
  if ((value.before === null && value.beforeTruncated)
      || (value.after === null && value.afterTruncated)) {
    throw new Error('建议卡截断标记无效');
  }
  if (value.status === null) {
    if (![value.reason, value.proposalToken, value.proposalRevisionToken,
      value.revisionToken, value.title, value.intentLabel, value.before,
      value.after, value.submitted, value.target].every((item) => item === null)
        || value.beforeTruncated || value.afterTruncated
        || value.canAdopt || value.canReject || value.canUndo) {
      throw new Error('空建议卡投影无效');
    }
  } else if (['adopted', 'conflict'].includes(value.status)) {
    if (value.proposalToken !== null || value.proposalRevisionToken !== null
        || !value.revisionToken || value.canAdopt || value.canReject
        || value.canUndo !== (value.status === 'adopted')) {
      throw new Error('撤销建议卡投影无效');
    }
  } else if (!value.proposalToken || value.revisionToken !== null
      || value.canUndo || !value.canReject) {
    throw new Error('待决建议卡投影无效');
  } else if (value.status === 'ready') {
    const comparisonTruncated = value.beforeTruncated || value.afterTruncated;
    if (comparisonTruncated
      ? (value.canAdopt || value.proposalRevisionToken !== null)
      : (!value.canAdopt || !value.proposalRevisionToken)) {
      throw new Error('可采用建议的完整可见性与 revision 不一致');
    }
  } else if (value.canAdopt || value.proposalRevisionToken !== null) {
    throw new Error('非 ready 建议不得下发采用能力');
  }
  return Object.freeze({
    ...value,
    title: value.title === null ? null : safeText(value.title, '未命名文档', 120),
    intentLabel: value.intentLabel === null ? null : safeText(value.intentLabel, '', 64) || null,
    target: value.target === null ? null : safeText(value.target, '目标会话', 96)
  });
}

function contextPocWorkspaceProposalDecisionResult(value) {
  if (!contextPocExact(value, [
    'kind', 'contentRef', 'projectToken', 'decision', 'changed',
    'revisionToken', 'message'
  ]) || value.kind !== 'decision'
      || typeof value.contentRef !== 'string'
      || !/^content-[a-f0-9]{24}$/.test(value.contentRef)
      || typeof value.projectToken !== 'string'
      || !/^project-[a-f0-9]{24}$/.test(value.projectToken)
      || !['adopt', 'reject'].includes(value.decision)
      || value.changed !== (value.decision === 'adopt')
      || !(value.revisionToken === null
        || (typeof value.revisionToken === 'string'
          && /^revision-[a-f0-9]{24}$/.test(value.revisionToken)))
      || (value.decision === 'adopt') !== (value.revisionToken !== null)
      || typeof value.message !== 'string' || !value.message) {
    throw new Error('建议决策结果投影无效');
  }
  return Object.freeze({
    ...value,
    message: contextPocWorkspaceSafeMessage(value.message, '建议决策已完成。')
  });
}

function contextPocWorkspaceProposalUndoResult(value) {
  if (!contextPocExact(value, [
    'kind', 'contentRef', 'projectToken', 'changed', 'message'
  ]) || value.kind !== 'undo' || value.changed !== true
      || typeof value.contentRef !== 'string'
      || !/^content-[a-f0-9]{24}$/.test(value.contentRef)
      || typeof value.projectToken !== 'string'
      || !/^project-[a-f0-9]{24}$/.test(value.projectToken)
      || typeof value.message !== 'string' || !value.message) {
    throw new Error('建议撤销结果投影无效');
  }
  return Object.freeze({
    ...value,
    message: contextPocWorkspaceSafeMessage(value.message, '已撤销上一次采用。')
  });
}

function contextPocWorkspacePublishChecklist(value) {
  if (!contextPocExact(value, [
    'structureValid', 'ready', 'published', 'aiDisclosure', 'lights'
  ]) || ![value.structureValid, value.ready, value.published]
    .every((item) => typeof item === 'boolean')
      || !['unknown', 'ai', 'not-ai'].includes(value.aiDisclosure)
      || !Array.isArray(value.lights)
      || value.lights.length !== Object.keys(VIDEO_PUBLISH_LIGHTS).length) {
    throw new Error('发布检查单投影无效');
  }
  const expected = Object.entries(VIDEO_PUBLISH_LIGHTS);
  const lights = value.lights.map((light, index) => {
    if (!contextPocExact(light, ['id', 'label', 'available', 'checked', 'satisfied'])
        || light.id !== expected[index][0]
        || light.label !== expected[index][1]
        || ![light.available, light.checked, light.satisfied]
          .every((item) => typeof item === 'boolean')) {
      throw new Error('发布检查灯顺序或投影无效');
    }
    return Object.freeze({ ...light });
  });
  const byId = new Map(lights.map((light) => [light.id, light]));
  const allKnownMarkersAvailable = lights.every((light) => light.available);
  const basicReady = ['cover', 'title', 'topics', 'timing', 'pinned-comment']
    .every((id) => byId.get(id).available && byId.get(id).checked);
  const disclosureReady = value.aiDisclosure === 'not-ai'
    || (value.aiDisclosure === 'ai'
      && byId.get('ai-label').available && byId.get('ai-label').checked);
  const ready = value.structureValid && basicReady && disclosureReady;
  const published = ready
    && byId.get('published').available && byId.get('published').checked;
  for (const id of ['cover', 'title', 'topics', 'timing', 'pinned-comment']) {
    if (byId.get(id).satisfied !== (byId.get(id).available && byId.get(id).checked)) {
      throw new Error('发布前置灯满足态无效');
    }
  }
  if ((value.structureValid && !allKnownMarkersAvailable) || value.ready !== ready
      || value.published !== published
      || byId.get('ai-label').satisfied !== disclosureReady
      || byId.get('published').satisfied !== published) {
    throw new Error('发布检查单状态机投影无效');
  }
  return Object.freeze({
    structureValid: value.structureValid,
    ready: value.ready,
    published: value.published,
    aiDisclosure: value.aiDisclosure,
    lights: Object.freeze(lights)
  });
}

function contextPocWorkspacePublishSurface(value) {
  if (!contextPocExact(value, [
    'kind', 'contentRef', 'projectToken', 'title', 'stage', 'stageLabel',
    'updated', 'canCreate', 'checklist'
  ]) || value.kind !== 'publish'
      || typeof value.contentRef !== 'string'
      || !/^content-[a-f0-9]{24}$/.test(value.contentRef)
      || typeof value.projectToken !== 'string'
      || !/^project-[a-f0-9]{24}$/.test(value.projectToken)
      || !(value.stage === null
        || Object.prototype.hasOwnProperty.call(VIDEO_STAGE_LABELS, value.stage))
      || typeof value.canCreate !== 'boolean'
      || value.canCreate !== ['script', 'shoot', 'edit'].includes(value.stage)
      || !(value.updated === null || (typeof value.updated === 'string'
        && value.updated.length <= 64
        && !/[\u0000-\u001f\u007f]/.test(value.updated)))
      || (value.stage === 'publish') !== isPlainObject(value.checklist)) {
    throw new Error('发布页投影无效');
  }
  const surface = Object.freeze({
    kind: 'publish',
    contentRef: value.contentRef,
    projectToken: value.projectToken,
    title: safeText(value.title, '未命名项目', 120),
    stage: value.stage,
    stageLabel: safeText(value.stageLabel, '未分类', 24),
    updated: value.updated,
    canCreate: value.canCreate,
    checklist: value.checklist === null
      ? null : contextPocWorkspacePublishChecklist(value.checklist)
  });
  if (Buffer.byteLength(JSON.stringify(surface), 'utf8') > 5600) {
    throw new Error('发布页投影超过安全上限');
  }
  return surface;
}

function contextPocWorkspacePublishCreateResult(value) {
  if (!contextPocExact(value, [
    'kind', 'created', 'sourceContentRef', 'sourceProjectToken', 'surface', 'message'
  ]) || value.kind !== 'publish-create' || typeof value.created !== 'boolean'
      || typeof value.sourceContentRef !== 'string'
      || !/^content-[a-f0-9]{24}$/.test(value.sourceContentRef)
      || typeof value.sourceProjectToken !== 'string'
      || !/^project-[a-f0-9]{24}$/.test(value.sourceProjectToken)
      || typeof value.message !== 'string' || !value.message) {
    throw new Error('发布检查单创建结果无效');
  }
  const surface = contextPocWorkspacePublishSurface(value.surface);
  if (surface.stage !== 'publish' || !surface.checklist
      || surface.contentRef === value.sourceContentRef) {
    throw new Error('发布检查单创建身份无效');
  }
  const result = Object.freeze({
    kind: 'publish-create',
    created: value.created,
    sourceContentRef: value.sourceContentRef,
    sourceProjectToken: value.sourceProjectToken,
    surface,
    message: contextPocWorkspaceSafeMessage(value.message, '发布检查单已准备。')
  });
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 5600) {
    throw new Error('发布检查单创建结果超过安全上限');
  }
  return result;
}

function contextPocWorkspacePublishMutationResult(value) {
  if (!contextPocExact(value, ['kind', 'changed', 'surface', 'message'])
      || value.kind !== 'publish-mutation' || value.changed !== true
      || typeof value.message !== 'string' || !value.message) {
    throw new Error('发布页写回结果无效');
  }
  const surface = contextPocWorkspacePublishSurface(value.surface);
  if (surface.stage !== 'publish' || !surface.checklist) {
    throw new Error('发布页写回身份无效');
  }
  const result = Object.freeze({
    kind: 'publish-mutation', changed: true, surface,
    message: contextPocWorkspaceSafeMessage(value.message, '发布检查单已写回。')
  });
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 5600) {
    throw new Error('发布页写回结果超过安全上限');
  }
  return result;
}

function contextPocWorkspaceTactic(value) {
  if (!contextPocExact(value, [
    'contentRef', 'projectToken', 'title', 'summary', 'summaryTruncated',
    'sourceTitle', 'updated'
  ]) || typeof value.contentRef !== 'string'
      || !/^content-[a-f0-9]{24}$/.test(value.contentRef)
      || typeof value.projectToken !== 'string'
      || !/^project-[a-f0-9]{24}$/.test(value.projectToken)
      || typeof value.title !== 'string' || !value.title
      || Array.from(value.title).length > 120
      || /[\u0000-\u001f\u007f]/.test(value.title)
      || !(value.summary === null || (typeof value.summary === 'string'
        && value.summary
        && Buffer.byteLength(value.summary, 'utf8') <= 240
        && !/[\u0000-\u001f\u007f]/.test(value.summary)))
      || typeof value.summaryTruncated !== 'boolean'
      || (value.summary === null && value.summaryTruncated)
      || !(value.sourceTitle === null || (typeof value.sourceTitle === 'string'
        && value.sourceTitle && Array.from(value.sourceTitle).length <= 120
        && !/[\u0000-\u001f\u007f]/.test(value.sourceTitle)))
      || !(value.updated === null || (typeof value.updated === 'string'
        && value.updated && value.updated.length <= 64
        && !/[\u0000-\u001f\u007f]/.test(value.updated)))) {
    throw new Error('打法卡投影无效');
  }
  return Object.freeze({ ...value });
}

function contextPocWorkspaceTacticsResult(value) {
  if (!contextPocExact(value, [
    'kind', 'contentRef', 'projectToken', 'collectionToken', 'itemCount',
    'complete', 'cursor', 'nextCursor', 'tactics'
  ]) || value.kind !== 'tactics'
      || typeof value.contentRef !== 'string'
      || !/^content-[a-f0-9]{24}$/.test(value.contentRef)
      || typeof value.projectToken !== 'string'
      || !/^project-[a-f0-9]{24}$/.test(value.projectToken)
      || typeof value.collectionToken !== 'string'
      || !/^collection-[a-f0-9]{24}$/.test(value.collectionToken)
      || !Number.isSafeInteger(value.itemCount)
      || value.itemCount < 0 || value.itemCount > 512
      || typeof value.complete !== 'boolean'
      || !Number.isSafeInteger(value.cursor)
      || value.cursor < 0 || value.cursor > value.itemCount
      || !Array.isArray(value.tactics) || value.tactics.length > 4) {
    throw new Error('打法库分页投影无效');
  }
  const tactics = value.tactics.map(contextPocWorkspaceTactic);
  const next = value.cursor + tactics.length;
  const expectedNextCursor = next < value.itemCount ? next : null;
  if (value.nextCursor !== expectedNextCursor
      || (expectedNextCursor !== null && tactics.length === 0)
      || new Set(tactics.map((item) => item.contentRef)).size !== tactics.length
      || new Set(tactics.map((item) => item.projectToken)).size !== tactics.length) {
    throw new Error('打法库分页边界无效');
  }
  const result = Object.freeze({
    kind: 'tactics', contentRef: value.contentRef,
    projectToken: value.projectToken,
    collectionToken: value.collectionToken,
    itemCount: value.itemCount,
    complete: value.complete,
    cursor: value.cursor,
    nextCursor: value.nextCursor,
    tactics: Object.freeze(tactics)
  });
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 5600) {
    throw new Error('打法库分页投影超过安全上限');
  }
  return result;
}

function contextPocWorkspaceReviewSolidifyResult(value) {
  if (!contextPocExact(value, [
    'kind', 'created', 'sourceContentRef', 'sourceProjectToken', 'tactic', 'message'
  ]) || value.kind !== 'review-solidify' || typeof value.created !== 'boolean'
      || typeof value.sourceContentRef !== 'string'
      || !/^content-[a-f0-9]{24}$/.test(value.sourceContentRef)
      || typeof value.sourceProjectToken !== 'string'
      || !/^project-[a-f0-9]{24}$/.test(value.sourceProjectToken)
      || typeof value.message !== 'string' || !value.message
      || Buffer.byteLength(value.message, 'utf8') > 240
      || /[\u0000-\u001f\u007f]/.test(value.message)) {
    throw new Error('复盘固化结果投影无效');
  }
  const tactic = contextPocWorkspaceTactic(value.tactic);
  if (tactic.contentRef === value.sourceContentRef
      || tactic.projectToken === value.sourceProjectToken) {
    throw new Error('复盘固化结果身份无效');
  }
  const result = Object.freeze({
    kind: 'review-solidify', created: value.created,
    sourceContentRef: value.sourceContentRef,
    sourceProjectToken: value.sourceProjectToken,
    tactic,
    message: value.message
  });
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 5600) {
    throw new Error('复盘固化结果超过安全上限');
  }
  return result;
}

function contextPocWorkspaceShootOpenResult(value) {
  if (!contextPocExact(value, [
    'kind', 'contentRef', 'projectToken', 'state', 'message'
  ]) || value.kind !== 'shoot-open'
      || typeof value.contentRef !== 'string'
      || !/^content-[a-f0-9]{24}$/.test(value.contentRef)
      || typeof value.projectToken !== 'string'
      || !/^project-[a-f0-9]{24}$/.test(value.projectToken)
      || !['opened', 'focused', 'busy', 'unavailable'].includes(value.state)
      || value.message !== shootingOpenMessage(value.state)
      || Buffer.byteLength(value.message, 'utf8') > 240
      || /[\u0000-\u001f\u007f]/.test(value.message)) {
    throw new Error('拍摄现场打开结果无效');
  }
  const result = Object.freeze({ ...value });
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 5600) {
    throw new Error('拍摄现场打开结果超过安全上限');
  }
  return result;
}

function contextPocWorkspaceShootHistoryRecord(value) {
  if (!contextPocExact(value, [
    'recordRef', 'title', 'confirmedCount', 'totalShots',
    'missingCount', 'retakeCount', 'allConfirmed'
  ]) || typeof value.recordRef !== 'string'
      || !/^[a-f0-9]{24}$/.test(value.recordRef)
      || typeof value.title !== 'string' || !value.title
      || Buffer.byteLength(value.title, 'utf8') > 120
      || /[\u0000-\u001f\u007f]/.test(value.title)
      || !Number.isSafeInteger(value.confirmedCount)
      || !Number.isSafeInteger(value.totalShots)
      || !Number.isSafeInteger(value.missingCount)
      || !Number.isSafeInteger(value.retakeCount)
      || value.totalShots < 1 || value.totalShots > videoShooting.LIMITS.shots
      || value.confirmedCount < 0 || value.confirmedCount > value.totalShots
      || value.missingCount < 0 || value.missingCount > value.totalShots
      || value.confirmedCount + value.missingCount !== value.totalShots
      || value.retakeCount < 0 || value.retakeCount > 1_000_000_000
      || typeof value.allConfirmed !== 'boolean'
      || value.allConfirmed !== (value.missingCount === 0)) {
    throw new Error('拍摄历史记录投影无效');
  }
  return Object.freeze({ ...value });
}

function contextPocWorkspaceShootHistoryResult(value) {
  if (!contextPocExact(value, [
    'kind', 'contentRef', 'projectToken', 'collectionToken', 'itemCount',
    'complete', 'cursor', 'nextCursor', 'records'
  ]) || value.kind !== 'shoot-history'
      || typeof value.contentRef !== 'string'
      || !/^content-[a-f0-9]{24}$/.test(value.contentRef)
      || typeof value.projectToken !== 'string'
      || !/^project-[a-f0-9]{24}$/.test(value.projectToken)
      || typeof value.collectionToken !== 'string'
      || !/^collection-[a-f0-9]{24}$/.test(value.collectionToken)
      || !Number.isSafeInteger(value.itemCount)
      || value.itemCount < 0 || value.itemCount > 512
      || typeof value.complete !== 'boolean'
      || !Number.isSafeInteger(value.cursor)
      || value.cursor < 0 || value.cursor > value.itemCount
      || !Array.isArray(value.records) || value.records.length > 4) {
    throw new Error('拍摄历史分页投影无效');
  }
  const records = value.records.map(contextPocWorkspaceShootHistoryRecord);
  const next = value.cursor + records.length;
  const expectedNextCursor = next < value.itemCount ? next : null;
  if (value.nextCursor !== expectedNextCursor
      || (expectedNextCursor !== null && records.length === 0)
      || new Set(records.map((record) => record.recordRef)).size !== records.length) {
    throw new Error('拍摄历史分页边界无效');
  }
  const result = Object.freeze({
    kind: 'shoot-history', contentRef: value.contentRef,
    projectToken: value.projectToken,
    collectionToken: value.collectionToken,
    itemCount: value.itemCount,
    complete: value.complete,
    cursor: value.cursor,
    nextCursor: value.nextCursor,
    records: Object.freeze(records)
  });
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 5600) {
    throw new Error('拍摄历史分页投影超过安全上限');
  }
  return result;
}

function contextPocWorkspaceReceipt(value) {
  if (!isPlainObject(value) || !deliveryToken(value.receiptId)
      || typeof value.targetLabel !== 'string'
      || !['ready', 'unavailable'].includes(value.tracking)
      || typeof value.trackingText !== 'string'
      || typeof value.expectedStage !== 'string'
      || !deliveryReceipts.DELIVERY_STATES.includes(value.status)
      || typeof value.statusText !== 'string'
      || !contextPocWorkspaceIsoTime(value.createdAt)
      || !contextPocWorkspaceIsoTime(value.updatedAt)
      || !(value.terminalAt === null
        || contextPocWorkspaceIsoTime(value.terminalAt))
      || !Number.isSafeInteger(value.elapsedMs) || value.elapsedMs < 0
      || !(value.durationMs === null
        || (Number.isSafeInteger(value.durationMs) && value.durationMs >= 0))
      || !Number.isSafeInteger(value.resultCount) || value.resultCount < 0
      || value.resultCount > 100
      || (value.resultToken !== undefined && !deliveryToken(value.resultToken))
      || (value.pulseAt !== undefined
        && !contextPocWorkspaceIsoTime(value.pulseAt))
      || (value.pulseId !== undefined && !deliveryToken(value.pulseId))
      || ((value.resultCount === 1) !== (value.resultToken !== undefined))
      || ((value.pulseAt !== undefined) !== (value.pulseId !== undefined))) {
    throw new Error('投递回执投影无效');
  }
  return Object.freeze({
    receiptId: value.receiptId,
    targetLabel: safeText(value.targetLabel, '目标会话', 96),
    tracking: value.tracking,
    trackingText: safeText(value.trackingText, '', 96),
    expectedStage: safeText(value.expectedStage, '', 96),
    status: value.status,
    statusText: safeText(value.statusText, '', 160),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    terminalAt: value.terminalAt,
    elapsedMs: value.elapsedMs,
    durationMs: value.durationMs,
    resultCount: value.resultCount,
    ...(value.resultToken === undefined ? {} : { resultToken: value.resultToken }),
    ...(value.pulseAt === undefined ? {} : { pulseAt: value.pulseAt }),
    ...(value.pulseId === undefined ? {} : { pulseId: value.pulseId })
  });
}

function contextPocWorkspaceReceiptsResult(value) {
  if (!contextPocExact(value, ['kind', 'projectToken', 'receipts'])
      || value.kind !== 'receipts'
      || typeof value.projectToken !== 'string'
      || !/^project-[a-f0-9]{24}$/.test(value.projectToken)
      || !Array.isArray(value.receipts) || value.receipts.length > 6) {
    throw new Error('投递回执列表投影无效');
  }
  return Object.freeze({
    kind: 'receipts',
    projectToken: value.projectToken,
    receipts: Object.freeze(value.receipts.map(contextPocWorkspaceReceipt))
  });
}

function contextPocWorkspaceReceiptAckResult(value) {
  if (!contextPocExact(value, ['kind']) || !['ok', 'stale'].includes(value.kind)) {
    throw new Error('投递回执确认投影无效');
  }
  return Object.freeze({ kind: value.kind });
}

function contextPocWorkspaceReceiptOpenResult(value) {
  if (contextPocExact(value, ['kind']) && value.kind === 'ok') {
    return Object.freeze({ kind: 'ok' });
  }
  if (contextPocExact(value, ['kind', 'text']) && value.kind === 'error') {
    return Object.freeze({
      kind: 'error',
      message: contextPocWorkspaceSafeMessage(value.text, '无法打开这份结果。')
    });
  }
  throw new Error('投递结果打开投影无效');
}

function contextPocWorkspaceOperationErrorCode(error) {
  const code = error && error.code;
  if (code === 'ERR_WORKSPACE_UNAVAILABLE') return 'workspace-unavailable';
  if (['ERR_OPERATION_OUTCOME_UNKNOWN',
    'ERR_VIDEO_RECOVERY_REQUIRED'].includes(code)) return 'outcome-unknown';
  if (['ERR_WORKSPACE_BINDING_STALE', 'ERR_VIDEO_RUNTIME_STALE',
    'ERR_VIDEO_ROOT_CHANGED', 'ERR_ROOT_CHANGED', 'ERR_ROOT_INVALID',
    'ERR_ROOT_UNREADABLE', 'ERR_CAS_MISMATCH',
    'ERR_PATH_CHANGED', 'ERR_PATH_NOT_FOUND', 'ERR_PATH_SYMLINK',
    'ERR_PATH_OUTSIDE', 'ERR_PATH_NOT_FILE',
    'ERR_CONTEXT_PROJECT_STALE'].includes(code)) return 'operation-stale';
  return 'operation-failed';
}

function contextPocUtf8Clip(value, maximumBytes) {
  const source = String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '�');
  let bytes = 0;
  let text = '';
  for (const symbol of source) {
    const size = Buffer.byteLength(symbol, 'utf8');
    if (bytes + size > maximumBytes) break;
    text += symbol;
    bytes += size;
  }
  return Object.freeze({ text, truncated: text.length !== source.length });
}

function contextPocAssertWorkspaceOperationCurrent(context) {
  if (!context || typeof context.assertCurrent !== 'function'
      || context.assertCurrent() !== true) {
    const error = new Error('文件 operation 工作区绑定已变化');
    error.code = 'ERR_WORKSPACE_BINDING_STALE';
    throw error;
  }
}

function contextPocWorkspaceOperationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function contextPocWorkspaceProjectIdentity(snapshot, selector) {
  const projects = Array.isArray(snapshot && snapshot.projects) ? snapshot.projects : [];
  const matches = projects.filter((project) => isPlainObject(project)
    && (selector.projectToken === undefined
      || project.projectToken === selector.projectToken)
    && (selector.contentRef === undefined || project.contentRef === selector.contentRef));
  if (matches.length !== 1
      || typeof matches[0].projectToken !== 'string'
      || !/^project-[a-f0-9]{24}$/.test(matches[0].projectToken)
      || typeof matches[0].contentRef !== 'string'
      || !/^content-[a-f0-9]{24}$/.test(matches[0].contentRef)) {
    throw contextPocWorkspaceOperationError(
      'ERR_CONTEXT_PROJECT_STALE', '内容身份已变化，请重新选择'
    );
  }
  return Object.freeze({
    projectToken: matches[0].projectToken,
    contentRef: matches[0].contentRef
  });
}

function contextPocWorkspaceProposalProjection(identity, surface) {
  if (!surface) {
    return {
      kind: 'proposal', ...identity,
      status: null, reason: null,
      proposalToken: null, proposalRevisionToken: null, revisionToken: null,
      title: null, intentLabel: null,
      before: null, beforeTruncated: false,
      after: null, afterTruncated: false,
      canAdopt: false, canReject: false, canUndo: false,
      submitted: null, target: null
    };
  }
  const status = CONTEXT_POC_PROPOSAL_STATUSES.has(surface.status)
    ? surface.status : 'invalid';
  const reason = CONTEXT_POC_PROPOSAL_REASONS.has(surface.reason)
    ? surface.reason : (status === 'invalid' ? 'read-failed' : null);
  const before = surface.before === null || surface.before === undefined
    ? null : contextPocUtf8Clip(surface.before, 1600);
  const after = surface.after === null || surface.after === undefined
    ? null : contextPocUtf8Clip(surface.after, 1600);
  const comparisonTruncated = Boolean(
    (before && before.truncated) || (after && after.truncated)
  );
  return {
    kind: 'proposal', ...identity,
    status,
    reason,
    proposalToken: surface.proposalToken || null,
    proposalRevisionToken: comparisonTruncated
      ? null : (surface.proposalRevisionToken || null),
    revisionToken: surface.revisionToken || null,
    title: typeof surface.title === 'string' ? surface.title : null,
    intentLabel: typeof surface.intentLabel === 'string' ? surface.intentLabel : null,
    before: before ? before.text : null,
    beforeTruncated: before ? before.truncated : false,
    after: after ? after.text : null,
    afterTruncated: after ? after.truncated : false,
    canAdopt: surface.canAdopt === true && !comparisonTruncated,
    canReject: surface.canReject === true,
    canUndo: surface.canUndo === true,
    submitted: surface.submitted === null || surface.submitted === undefined
      ? null : surface.submitted,
    target: typeof surface.target === 'string' ? surface.target : null
  };
}

function contextPocWorkspaceFileOperations(options = {}) {
  const dependencies = Object.freeze(Object.fromEntries(
    DEFAULT_DEPENDENCIES.map((name) => [name, options[name] || operationDefaults[name]])
  ));
  const catalog = operationDependency('catalog', dependencies);
  const document = operationDependency('document', dependencies);
  const overview = operationDependency('overview', dependencies);
  const chooseTopic = operationDependency('chooseTopic', dependencies);
  const projectAction = operationDependency('projectAction', dependencies);
  const blockAction = operationDependency('blockAction', dependencies);
  const proposalSurface = operationDependency('proposalSurface', dependencies);
  const proposalDecision = operationDependency('proposalDecision', dependencies);
  const proposalUndo = operationDependency('proposalUndo', dependencies);
  const publishSurface = operationDependency('publishSurface', dependencies);
  const publishAction = operationDependency('publishAction', dependencies);
  const tacticsCollection = operationDependency('tacticsCollection', dependencies);
  const solidifyAction = operationDependency('solidifyAction', dependencies);
  const tacticSurface = operationDependency('tacticSurface', dependencies);
  const shootSource = operationDependency('shootSource', dependencies);
  const shootOpenAction = operationDependency('shootOpenAction', dependencies);
  const shootHistoryCollection = operationDependency('shootHistoryCollection', dependencies);
  const verifyProject = operationDependency('verifyProject', dependencies);
  const receiptSnapshot = operationDependency('receiptSnapshot', dependencies);
  const receiptProjectBinding = operationDependency('receiptProjectBinding', dependencies);
  const ackReceipt = operationDependency('ackReceipt', dependencies);
  const openReceipt = operationDependency('openReceipt', dependencies);
  const contentRefFor = operationDependency('videoContentRef', dependencies);
  const projectTokenFor = operationDependency('videoProjectToken', dependencies);
  const safeRelativePath = operationDependency('safeRelativePath', dependencies);
  const readBoundPublishSurface = async (identity) => {
    const candidate = await publishSurface(identity.contentRef, identity.projectToken);
    const surface = contextPocWorkspacePublishSurface(candidate);
    if (surface.contentRef !== identity.contentRef
        || surface.projectToken !== identity.projectToken) {
      throw contextPocWorkspaceOperationError(
        'ERR_CONTEXT_PROJECT_STALE', '发布页内容身份已变化'
      );
    }
    return surface;
  };
  const reviewIdentity = (snapshot, selector) => {
    const identity = contextPocWorkspaceProjectIdentity(snapshot, selector);
    const projects = Array.isArray(snapshot && snapshot.projects) ? snapshot.projects : [];
    const card = projects.find((project) => isPlainObject(project)
      && project.contentRef === identity.contentRef
      && project.projectToken === identity.projectToken);
    if (!card || card.stage !== 'review') {
      throw new Error('只能在复盘项目中读取或固化打法');
    }
    return identity;
  };
  const shootIdentity = (snapshot, selector) => {
    const identity = contextPocWorkspaceProjectIdentity(snapshot, selector);
    const projects = Array.isArray(snapshot && snapshot.projects) ? snapshot.projects : [];
    const card = projects.find((project) => isPlainObject(project)
      && project.contentRef === identity.contentRef
      && project.projectToken === identity.projectToken);
    if (!card || card.stage !== 'shoot') {
      throw new Error('只能从真实口播稿打开拍摄现场或历史');
    }
    return identity;
  };
  const readBoundShootSource = async (identity) => {
    const current = await shootSource(identity.projectToken);
    const runtime = current && current.runtime;
    const record = current && current.record;
    const documentValue = current && current.document;
    if (!runtime || !Number.isSafeInteger(runtime.epoch) || runtime.epoch < 0
        || !record || !documentValue
        || typeof record.relativePath !== 'string'
        || typeof record.hash !== 'string'
        || typeof documentValue.relativePath !== 'string'
        || typeof documentValue.hash !== 'string'
        || record.relativePath !== documentValue.relativePath
        || record.hash !== documentValue.hash
        || contentRefFor(runtime.epoch, record.relativePath) !== identity.contentRef
        || projectTokenFor(runtime.epoch, record.relativePath, record.hash)
          !== identity.projectToken) {
      throw contextPocWorkspaceOperationError(
        'ERR_CONTEXT_PROJECT_STALE', '拍摄来源身份已变化'
      );
    }
    if (record.stage !== 'shoot' || documentValue.stage !== 'shoot'
        || !record.relativePath.startsWith('03_口播稿/')) {
      throw new Error('拍摄现场只接受 03_口播稿 中的真实口播稿');
    }
    return current;
  };
  return Object.freeze({
    'catalog.read': Object.freeze({
      validate: (input) => contextPocWorkspaceFilePageInput(input, 4),
      async handle({ input, context }) {
        contextPocAssertWorkspaceOperationCurrent(context);
        const snapshot = catalog();
        const projects = Array.isArray(snapshot.projects) ? snapshot.projects : [];
        const page = [];
        for (let cursor = input.cursor;
          cursor < projects.length && page.length < input.limit; cursor += 1) {
          const candidate = [...page, projects[cursor]];
          const projected = contextPocWorkspaceCatalogResult({
            kind: 'catalog', generation: snapshot.generation,
            projectCount: projects.length, cursor: input.cursor,
            nextCursor: input.cursor + candidate.length < projects.length
              ? input.cursor + candidate.length : null,
            projects: candidate
          });
          if (Buffer.byteLength(JSON.stringify(projected), 'utf8') > 5600 && page.length) break;
          page.push(projects[cursor]);
        }
        const next = input.cursor + page.length;
        return {
          kind: 'catalog', generation: snapshot.generation,
          projectCount: projects.length, cursor: input.cursor,
          nextCursor: next < projects.length ? next : null,
          projects: page
        };
      },
      redact: contextPocWorkspaceCatalogResult,
      errorCode: contextPocWorkspaceOperationErrorCode
    }),
    'document.read': Object.freeze({
      validate: contextPocWorkspaceFileProjectInput,
      async handle({ input, context }) {
        contextPocAssertWorkspaceOperationCurrent(context);
        const surface = document(input.projectToken);
        const page = surface.blocks.slice(input.cursor, input.cursor + input.limit).map((block) => {
          const clipped = contextPocUtf8Clip(block.text, 1800);
          return {
            blockToken: block.blockToken,
            kind: block.kind,
            text: clipped.text,
            textTruncated: clipped.truncated,
            startLine: block.startLine,
            endLine: block.endLine
          };
        });
        const next = input.cursor + page.length;
        return {
          kind: 'document', projectToken: surface.projectToken,
          title: surface.title, stage: surface.stage, stageLabel: surface.stageLabel,
          blockCount: surface.blockCount, cursor: input.cursor,
          nextCursor: next < surface.blocks.length ? next : null,
          truncated: surface.truncated === true || next < surface.blockCount
            || page.some((block) => block.textTruncated),
          blocks: page
        };
      },
      redact: contextPocWorkspaceDocumentResult,
      errorCode: contextPocWorkspaceOperationErrorCode
    }),
    'block.action.prepare': Object.freeze({
      validate: contextPocWorkspaceFileBlockPrepareInput,
      async handle({ input, context }) {
        contextPocAssertWorkspaceOperationCurrent(context);
        const identity = contextPocWorkspaceProjectIdentity(catalog(), {
          projectToken: input.projectToken
        });
        const prepared = contextPocWorkspaceActionPrepareResult(
          await blockAction(input, {
            deliveryTargetRef: context.deliveryTargetRef || null
          })
        );
        const latest = contextPocWorkspaceProjectIdentity(catalog(), {
          contentRef: identity.contentRef
        });
        if (latest.projectToken !== identity.projectToken) {
          throw contextPocWorkspaceOperationError(
            'ERR_CONTEXT_PROJECT_STALE', '内容块在预检期间已变化，请重新打开'
          );
        }
        if (prepared.state === 'error') {
          return {
            kind: 'preflight', ...identity,
            blockToken: input.blockToken, action: input.action, state: 'error',
            preflightToken: null, targetLabel: null, workspaceLabel: null,
            workspaceMatch: null, targetRunning: null, eventTracking: null,
            expiresAt: null, message: prepared.message
          };
        }
        return {
          kind: 'preflight', ...identity,
          blockToken: input.blockToken, action: input.action, state: 'ready',
          preflightToken: prepared.preflightToken,
          targetLabel: prepared.targetLabel,
          workspaceLabel: prepared.workspaceLabel,
          workspaceMatch: prepared.workspaceMatch,
          targetRunning: prepared.targetRunning,
          eventTracking: prepared.eventTracking,
          expiresAt: prepared.expiresAt,
          message: null
        };
      },
      redact: contextPocWorkspaceBlockPrepareResult,
      errorCode: contextPocWorkspaceOperationErrorCode
    }),
    'block.action.submit': Object.freeze({
      validate: contextPocWorkspaceFileBlockSubmitInput,
      async handle({ input, context }) {
        contextPocAssertWorkspaceOperationCurrent(context);
        const identity = contextPocWorkspaceProjectIdentity(catalog(), {
          projectToken: input.projectToken
        });
        const submitted = contextPocWorkspaceActionSubmitResult(
          await blockAction(input, {
            deliveryTargetRef: context.deliveryTargetRef || null
          })
        );
        if (submitted.state === 'error') {
          return {
            kind: 'submission', ...identity,
            blockToken: input.blockToken, action: input.action,
            state: 'error', reason: null, target: null, receiptId: null,
            message: submitted.message
          };
        }
        let latest;
        try {
          latest = contextPocWorkspaceProjectIdentity(catalog(), {
            contentRef: identity.contentRef
          });
        } catch (_error) {
          throw contextPocWorkspaceOperationError(
            'ERR_OPERATION_OUTCOME_UNKNOWN',
            '动作已提交，但当前内容身份无法确认'
          );
        }
        return {
          kind: 'submission', ...latest,
          blockToken: input.blockToken, action: input.action,
          state: submitted.state, reason: submitted.reason,
          target: submitted.target,
          receiptId: submitted.receiptId || null,
          message: null
        };
      },
      redact: contextPocWorkspaceBlockSubmitResult,
      errorCode: contextPocWorkspaceOperationErrorCode
    }),
    'overview.read': Object.freeze({
      validate: contextPocWorkspaceFileOverviewInput,
      async handle({ input, context }) {
        contextPocAssertWorkspaceOperationCurrent(context);
        const surface = overview(input.projectToken);
        if (!isPlainObject(surface) || surface.projectToken !== input.projectToken
            || typeof surface.contentRef !== 'string'
            || !/^content-[a-f0-9]{24}$/.test(surface.contentRef)) {
          const error = new Error('项目概览身份已变化');
          error.code = 'ERR_CONTEXT_PROJECT_STALE';
          throw error;
        }
        const angles = Array.isArray(surface && surface.angles) ? surface.angles : [];
        const hooks = Array.isArray(surface && surface.hooks) ? surface.hooks : [];
        const candidates = [
          ...angles.map((value) => ({
            field: 'angle', value, selected: value === surface.angle
          })),
          ...hooks.map((value) => ({
            field: 'hook', value, selected: value === surface.hook
          }))
        ];
        if (candidates.length > 64 || input.cursor > candidates.length) {
          const error = new Error('项目概览候选页已变化');
          error.code = 'ERR_CONTEXT_PROJECT_STALE';
          throw error;
        }
        const page = [];
        for (let cursor = input.cursor;
          cursor < candidates.length && page.length < input.limit; cursor += 1) {
          const candidate = [...page, candidates[cursor]];
          const projected = contextPocWorkspaceOverviewResult({
            kind: 'overview',
            contentRef: surface.contentRef,
            projectToken: surface.projectToken,
            title: surface.title,
            stage: surface.stage,
            stageLabel: surface.stageLabel,
            status: surface.status,
            updated: surface.updated,
            decision: surface.decision,
            angle: surface.angle,
            hook: surface.hook,
            candidateCount: candidates.length,
            cursor: input.cursor,
            nextCursor: input.cursor + candidate.length < candidates.length
              ? input.cursor + candidate.length : null,
            candidates: candidate
          });
          if (Buffer.byteLength(JSON.stringify(projected), 'utf8') > 5600 && page.length) break;
          page.push(candidates[cursor]);
        }
        const next = input.cursor + page.length;
        return {
          kind: 'overview',
          contentRef: surface.contentRef,
          projectToken: surface.projectToken,
          title: surface.title,
          stage: surface.stage,
          stageLabel: surface.stageLabel,
          status: surface.status,
          updated: surface.updated,
          decision: surface.decision,
          angle: surface.angle,
          hook: surface.hook,
          candidateCount: candidates.length,
          cursor: input.cursor,
          nextCursor: next < candidates.length ? next : null,
          candidates: page
        };
      },
      redact: contextPocWorkspaceOverviewResult,
      errorCode: contextPocWorkspaceOperationErrorCode
    }),
    'topic.choose': Object.freeze({
      validate: contextPocWorkspaceFileTopicInput,
      async handle({ input, context }) {
        contextPocAssertWorkspaceOperationCurrent(context);
        const before = catalog();
        const current = Array.isArray(before && before.projects)
          ? before.projects.find((project) => project.projectToken === input.projectToken)
          : null;
        if (!current || typeof current.contentRef !== 'string'
            || !/^content-[a-f0-9]{24}$/.test(current.contentRef)) {
          const error = new Error('这张项目卡已过期，请重新选择');
          error.code = 'ERR_CONTEXT_PROJECT_STALE';
          throw error;
        }
        const result = await chooseTopic(input);
        let after;
        try { after = catalog(); }
        catch (_error) {
          const error = new Error('写回已执行，但刷新后的项目身份无法确认');
          error.code = 'ERR_OPERATION_OUTCOME_UNKNOWN';
          throw error;
        }
        const replacement = Array.isArray(after && after.projects)
          ? after.projects.find((project) => project.contentRef === current.contentRef)
          : null;
        if (!replacement || typeof replacement.projectToken !== 'string'
            || !/^project-[a-f0-9]{24}$/.test(replacement.projectToken)
            || replacement.projectToken === input.projectToken
            || replacement[input.field] !== input.value
            || typeof replacement.updated !== 'string' || !replacement.updated) {
          const error = new Error('写回已执行，但刷新后的项目身份无法确认');
          error.code = 'ERR_OPERATION_OUTCOME_UNKNOWN';
          throw error;
        }
        return {
          kind: 'mutation', changed: true,
          contentRef: current.contentRef,
          projectToken: replacement.projectToken,
          field: input.field,
          value: input.value,
          updated: safeText(replacement.updated, '', 64),
          message: safeText(result && result.text, '已写回项目文件。', 160)
        };
      },
      redact: contextPocWorkspaceMutationResult,
      errorCode: contextPocWorkspaceOperationErrorCode
    }),
    'proposal.read': Object.freeze({
      validate: contextPocWorkspaceFileProposalReadInput,
      async handle({ input, context }) {
        contextPocAssertWorkspaceOperationCurrent(context);
        const identity = contextPocWorkspaceProjectIdentity(catalog(), {
          contentRef: input.contentRef
        });
        const candidate = await proposalSurface(input.contentRef);
        const bound = candidate && candidate.contentRef === input.contentRef
          ? candidate : null;
        const latest = contextPocWorkspaceProjectIdentity(catalog(), {
          contentRef: input.contentRef
        });
        const result = contextPocWorkspaceProposalResult(
          contextPocWorkspaceProposalProjection(
            latest, bound
          )
        );
        if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 5600) {
          throw new Error('建议卡投影超过安全上限');
        }
        return result;
      },
      redact: contextPocWorkspaceProposalResult,
      errorCode: contextPocWorkspaceOperationErrorCode
    }),
    'proposal.decide': Object.freeze({
      validate: contextPocWorkspaceFileProposalDecisionInput,
      async handle({ input, context }) {
        contextPocAssertWorkspaceOperationCurrent(context);
        const identity = contextPocWorkspaceProjectIdentity(catalog(), {
          contentRef: input.contentRef
        });
        const candidate = await proposalSurface(input.contentRef);
        const surface = candidate && candidate.contentRef === input.contentRef
          ? candidate : null;
        const visible = surface ? contextPocWorkspaceProposalResult(
          contextPocWorkspaceProposalProjection(identity, surface)
        ) : null;
        if (!visible || visible.proposalToken !== input.proposalToken
            || (input.decision === 'adopt'
              && (visible.status !== 'ready' || visible.canAdopt !== true
                || visible.proposalRevisionToken !== input.proposalRevisionToken))) {
          throw contextPocWorkspaceOperationError(
            'ERR_CONTEXT_PROJECT_STALE', '这张建议卡已变化，请重新查看'
          );
        }
        const result = await proposalDecision({
          proposalToken: input.proposalToken,
          decision: input.decision,
          ...(input.decision === 'adopt'
            ? { proposalRevisionToken: input.proposalRevisionToken } : {})
        });
        if (!contextPocExact(result, ['kind', 'text'])
            || result.kind !== 'ok' || typeof result.text !== 'string'
            || !result.text) {
          throw contextPocWorkspaceOperationError(
            'ERR_OPERATION_OUTCOME_UNKNOWN',
            '建议决策已执行，但结果无法确认'
          );
        }
        let latest;
        try {
          latest = contextPocWorkspaceProjectIdentity(catalog(), {
            contentRef: input.contentRef
          });
        } catch (_error) {
          throw contextPocWorkspaceOperationError(
            'ERR_OPERATION_OUTCOME_UNKNOWN',
            '建议决策已执行，但当前内容身份无法确认'
          );
        }
        let revisionToken = null;
        if (input.decision === 'adopt') {
          let adoptedSurface;
          try {
            const candidateAfter = await proposalSurface(input.contentRef);
            adoptedSurface = candidateAfter
              && candidateAfter.contentRef === input.contentRef ? candidateAfter : null;
          }
          catch (_error) { adoptedSurface = null; }
          if (latest.projectToken === identity.projectToken
              || !adoptedSurface || adoptedSurface.status !== 'adopted'
              || typeof adoptedSurface.revisionToken !== 'string'
              || !/^revision-[a-f0-9]{24}$/.test(adoptedSurface.revisionToken)) {
            throw contextPocWorkspaceOperationError(
              'ERR_OPERATION_OUTCOME_UNKNOWN',
              '原稿采用已执行，但新版本与撤销快照无法确认'
            );
          }
          revisionToken = adoptedSurface.revisionToken;
        }
        return {
          kind: 'decision', ...latest,
          decision: input.decision,
          changed: input.decision === 'adopt',
          revisionToken,
          message: safeText(result && result.text,
            input.decision === 'adopt' ? '已采用这一块。' : '已退回建议。', 160)
        };
      },
      redact: contextPocWorkspaceProposalDecisionResult,
      errorCode: contextPocWorkspaceOperationErrorCode
    }),
    'proposal.undo': Object.freeze({
      validate: contextPocWorkspaceFileProposalUndoInput,
      async handle({ input, context }) {
        contextPocAssertWorkspaceOperationCurrent(context);
        const identity = contextPocWorkspaceProjectIdentity(catalog(), {
          contentRef: input.contentRef
        });
        const candidate = await proposalSurface(input.contentRef);
        const surface = candidate && candidate.contentRef === input.contentRef
          ? candidate : null;
        if (!surface || surface.status !== 'adopted'
            || surface.canUndo !== true
            || surface.revisionToken !== input.revisionToken) {
          throw contextPocWorkspaceOperationError(
            'ERR_CONTEXT_PROJECT_STALE', '这份撤销快照已变化，请重新查看'
          );
        }
        const result = await proposalUndo({ revisionToken: input.revisionToken });
        if (!contextPocExact(result, ['kind', 'text'])
            || result.kind !== 'ok' || typeof result.text !== 'string'
            || !result.text) {
          throw contextPocWorkspaceOperationError(
            'ERR_OPERATION_OUTCOME_UNKNOWN',
            '撤销已执行，但结果无法确认'
          );
        }
        let latest;
        try {
          latest = contextPocWorkspaceProjectIdentity(catalog(), {
            contentRef: input.contentRef
          });
        } catch (_error) {
          throw contextPocWorkspaceOperationError(
            'ERR_OPERATION_OUTCOME_UNKNOWN',
            '撤销已执行，但当前内容身份无法确认'
          );
        }
        if (latest.projectToken === identity.projectToken) {
          throw contextPocWorkspaceOperationError(
            'ERR_OPERATION_OUTCOME_UNKNOWN',
            '撤销已执行，但最新文件版本无法确认'
          );
        }
        return {
          kind: 'undo', ...latest, changed: true,
          message: safeText(result && result.text, '已撤销上一次块级采用。', 160)
        };
      },
      redact: contextPocWorkspaceProposalUndoResult,
      errorCode: contextPocWorkspaceOperationErrorCode
    }),
    'publish.read': Object.freeze({
      validate: contextPocWorkspaceFilePublishInput,
      async handle({ input, context }) {
        contextPocAssertWorkspaceOperationCurrent(context);
        const identity = contextPocWorkspaceProjectIdentity(catalog(), {
          contentRef: input.contentRef,
          projectToken: input.projectToken
        });
        const surface = await readBoundPublishSurface(identity);
        const latest = contextPocWorkspaceProjectIdentity(catalog(), {
          contentRef: input.contentRef,
          projectToken: input.projectToken
        });
        if (latest.contentRef !== surface.contentRef
            || latest.projectToken !== surface.projectToken) {
          throw contextPocWorkspaceOperationError(
            'ERR_CONTEXT_PROJECT_STALE', '发布页读取期间内容已变化'
          );
        }
        return surface;
      },
      redact: contextPocWorkspacePublishSurface,
      errorCode: contextPocWorkspaceOperationErrorCode
    }),
    'publish.create': Object.freeze({
      validate: contextPocWorkspaceFilePublishInput,
      async handle({ input, context }) {
        contextPocAssertWorkspaceOperationCurrent(context);
        const sourceIdentity = contextPocWorkspaceProjectIdentity(catalog(), {
          contentRef: input.contentRef,
          projectToken: input.projectToken
        });
        const sourceSurface = await readBoundPublishSurface(sourceIdentity);
        if (!sourceSurface.canCreate
            || !['script', 'shoot', 'edit'].includes(sourceSurface.stage)) {
          throw new Error('只能从脚本、拍摄或剪辑文档创建发布检查单');
        }
        const actionResult = await publishAction({
          type: 'create',
          contentRef: sourceIdentity.contentRef,
          projectToken: sourceIdentity.projectToken
        });
        if (!contextPocExact(actionResult, [
          'kind', 'created', 'contentRef', 'projectToken', 'text'
        ]) || actionResult.kind !== 'ok' || typeof actionResult.created !== 'boolean'
            || typeof actionResult.contentRef !== 'string'
            || !/^content-[a-f0-9]{24}$/.test(actionResult.contentRef)
            || typeof actionResult.projectToken !== 'string'
            || !/^project-[a-f0-9]{24}$/.test(actionResult.projectToken)
            || typeof actionResult.text !== 'string' || !actionResult.text) {
          throw contextPocWorkspaceOperationError(
            'ERR_OPERATION_OUTCOME_UNKNOWN', '发布检查单创建后结果无法确认'
          );
        }
        let latestSource;
        let checklistIdentity;
        let surface;
        try {
          const after = catalog();
          latestSource = contextPocWorkspaceProjectIdentity(after, {
            contentRef: sourceIdentity.contentRef
          });
          checklistIdentity = contextPocWorkspaceProjectIdentity(after, {
            contentRef: actionResult.contentRef,
            projectToken: actionResult.projectToken
          });
          surface = await readBoundPublishSurface(checklistIdentity);
        } catch (_error) {
          throw contextPocWorkspaceOperationError(
            'ERR_OPERATION_OUTCOME_UNKNOWN', '发布检查单创建后身份无法确认'
          );
        }
        if (latestSource.projectToken !== sourceIdentity.projectToken
            || checklistIdentity.contentRef === sourceIdentity.contentRef
            || surface.stage !== 'publish' || !surface.checklist
            || (actionResult.created && !surface.checklist.structureValid)) {
          throw contextPocWorkspaceOperationError(
            'ERR_OPERATION_OUTCOME_UNKNOWN', '发布检查单创建后状态无法确认'
          );
        }
        return {
          kind: 'publish-create',
          created: actionResult.created,
          sourceContentRef: sourceIdentity.contentRef,
          sourceProjectToken: latestSource.projectToken,
          surface,
          message: safeText(actionResult.text, '发布检查单已准备。', 160)
        };
      },
      redact: contextPocWorkspacePublishCreateResult,
      errorCode: contextPocWorkspaceOperationErrorCode
    }),
    'publish.update': Object.freeze({
      validate: contextPocWorkspaceFilePublishUpdateInput,
      async handle({ input, context }) {
        contextPocAssertWorkspaceOperationCurrent(context);
        const identity = contextPocWorkspaceProjectIdentity(catalog(), {
          contentRef: input.contentRef,
          projectToken: input.projectToken
        });
        const before = await readBoundPublishSurface(identity);
        if (before.stage !== 'publish' || !before.checklist
            || before.checklist.structureValid !== true) {
          throw new Error('发布检查单结构不完整，已停止写入');
        }
        if (input.type === 'light' && input.lightId === 'published'
            && input.checked && !before.checklist.ready) {
          throw new Error('发布前置灯与 AI 内容状态还没齐');
        }
        if (input.type === 'light' && input.lightId === 'ai-label'
            && input.checked && before.checklist.aiDisclosure !== 'ai') {
          throw new Error('只有确认含 AI 生成内容后才能点亮 AI 标识灯');
        }
        const actionResult = await publishAction(input);
        if (!contextPocExact(actionResult, ['kind', 'text'])
            || actionResult.kind !== 'ok'
            || typeof actionResult.text !== 'string' || !actionResult.text) {
          throw contextPocWorkspaceOperationError(
            'ERR_OPERATION_OUTCOME_UNKNOWN', '发布页写回后结果无法确认'
          );
        }
        let latest;
        let surface;
        try {
          latest = contextPocWorkspaceProjectIdentity(catalog(), {
            contentRef: identity.contentRef
          });
          surface = await readBoundPublishSurface(latest);
        } catch (_error) {
          throw contextPocWorkspaceOperationError(
            'ERR_OPERATION_OUTCOME_UNKNOWN', '发布页写回后身份无法确认'
          );
        }
        const beforePublishedLight = before.checklist.lights
          .find((light) => light.id === 'published');
        const afterPublishedLight = surface.checklist && surface.checklist.lights
          .find((light) => light.id === 'published');
        let reflected = latest.projectToken !== identity.projectToken
          && surface.stage === 'publish' && surface.checklist
          && typeof surface.updated === 'string' && surface.updated
          && surface.updated !== before.updated;
        if (input.type === 'light') {
          const beforeLight = before.checklist.lights.find((light) => light.id === input.lightId);
          const afterLight = surface.checklist
            && surface.checklist.lights.find((light) => light.id === input.lightId);
          reflected = reflected && Boolean(afterLight && afterLight.checked === input.checked);
          if (input.lightId === 'published') {
            reflected = reflected && surface.checklist.published === input.checked;
          } else if (beforeLight && beforeLight.checked !== input.checked
              && beforePublishedLight && beforePublishedLight.checked) {
            reflected = reflected && Boolean(afterPublishedLight
              && !afterPublishedLight.checked && !surface.checklist.published);
          }
        } else {
          reflected = reflected && surface.checklist.aiDisclosure === input.value;
          const beforeAiLight = before.checklist.lights
            .find((light) => light.id === 'ai-label');
          const aiPrerequisiteChanged = before.checklist.aiDisclosure !== input.value
            || (input.value !== 'ai' && beforeAiLight && beforeAiLight.checked);
          if (input.value !== 'ai') {
            const aiLight = surface.checklist.lights.find((light) => light.id === 'ai-label');
            reflected = reflected && Boolean(aiLight && !aiLight.checked);
          }
          if (aiPrerequisiteChanged
              && beforePublishedLight && beforePublishedLight.checked) {
            reflected = reflected && Boolean(afterPublishedLight
              && !afterPublishedLight.checked && !surface.checklist.published);
          }
        }
        if (!reflected) {
          throw contextPocWorkspaceOperationError(
            'ERR_OPERATION_OUTCOME_UNKNOWN', '发布页写回已执行，但新版本无法确认'
          );
        }
        return {
          kind: 'publish-mutation', changed: true, surface,
          message: safeText(actionResult.text, '发布检查单已写回。', 160)
        };
      },
      redact: contextPocWorkspacePublishMutationResult,
      errorCode: contextPocWorkspaceOperationErrorCode
    }),
    'review.tactics.read': Object.freeze({
      validate: contextPocWorkspaceFileTacticsInput,
      async handle({ input, context }) {
        contextPocAssertWorkspaceOperationCurrent(context);
        const identity = reviewIdentity(catalog(), {
          contentRef: input.contentRef,
          projectToken: input.projectToken
        });
        const rawCollection = await tacticsCollection();
        if (!contextPocExact(rawCollection, [
          'collectionToken', 'complete', 'tactics'
        ]) || typeof rawCollection.collectionToken !== 'string'
            || !/^collection-[a-f0-9]{24}$/.test(rawCollection.collectionToken)
            || typeof rawCollection.complete !== 'boolean'
            || !Array.isArray(rawCollection.tactics)
            || rawCollection.tactics.length > 512) {
          throw new Error('打法库目录结果无效');
        }
        const tactics = rawCollection.tactics.map(contextPocWorkspaceTactic);
        if (new Set(tactics.map((item) => item.contentRef)).size !== tactics.length
            || new Set(tactics.map((item) => item.projectToken)).size !== tactics.length) {
          throw new Error('打法库跨页内容身份重复');
        }
        if (input.cursor > tactics.length
            || (input.cursor > 0
              && input.collectionToken !== rawCollection.collectionToken)) {
          throw contextPocWorkspaceOperationError(
            'ERR_CONTEXT_PROJECT_STALE', '打法库分页期间已变化'
          );
        }
        const page = [];
        for (let cursor = input.cursor;
          cursor < tactics.length && page.length < input.limit; cursor += 1) {
          const candidate = [...page, tactics[cursor]];
          const next = input.cursor + candidate.length;
          const projected = {
            kind: 'tactics', ...identity,
            collectionToken: rawCollection.collectionToken,
            itemCount: tactics.length,
            complete: rawCollection.complete,
            cursor: input.cursor,
            nextCursor: next < tactics.length ? next : null,
            tactics: candidate
          };
          if (Buffer.byteLength(JSON.stringify(projected), 'utf8') > 5600
              && page.length) break;
          page.push(tactics[cursor]);
        }
        const latest = reviewIdentity(catalog(), {
          contentRef: identity.contentRef,
          projectToken: identity.projectToken
        });
        const next = input.cursor + page.length;
        return {
          kind: 'tactics', ...latest,
          collectionToken: rawCollection.collectionToken,
          itemCount: tactics.length,
          complete: rawCollection.complete,
          cursor: input.cursor,
          nextCursor: next < tactics.length ? next : null,
          tactics: page
        };
      },
      redact: contextPocWorkspaceTacticsResult,
      errorCode: contextPocWorkspaceOperationErrorCode
    }),
    'review.solidify': Object.freeze({
      validate: contextPocWorkspaceFileReviewIdentityInput,
      async handle({ input, context }) {
        contextPocAssertWorkspaceOperationCurrent(context);
        const sourceIdentity = reviewIdentity(catalog(), {
          contentRef: input.contentRef,
          projectToken: input.projectToken
        });
        const actionResult = await solidifyAction(sourceIdentity);
        if (!contextPocExact(actionResult, [
          'kind', 'created', 'contentRef', 'projectToken', 'text'
        ]) || actionResult.kind !== 'ok' || typeof actionResult.created !== 'boolean'
            || typeof actionResult.contentRef !== 'string'
            || !/^content-[a-f0-9]{24}$/.test(actionResult.contentRef)
            || typeof actionResult.projectToken !== 'string'
            || !/^project-[a-f0-9]{24}$/.test(actionResult.projectToken)
            || typeof actionResult.text !== 'string' || !actionResult.text) {
          throw contextPocWorkspaceOperationError(
            'ERR_OPERATION_OUTCOME_UNKNOWN', '打法固化后结果无法确认'
          );
        }
        let latestSource;
        let tacticIdentity;
        let tactic;
        try {
          const after = catalog();
          latestSource = reviewIdentity(after, {
            contentRef: sourceIdentity.contentRef
          });
          tacticIdentity = contextPocWorkspaceProjectIdentity(after, {
            contentRef: actionResult.contentRef,
            projectToken: actionResult.projectToken
          });
          tactic = contextPocWorkspaceTactic(await tacticSurface(
            tacticIdentity, sourceIdentity
          ));
        } catch (_error) {
          throw contextPocWorkspaceOperationError(
            'ERR_OPERATION_OUTCOME_UNKNOWN', '打法固化后身份无法确认'
          );
        }
        if (latestSource.projectToken !== sourceIdentity.projectToken
            || tacticIdentity.contentRef === sourceIdentity.contentRef
            || tacticIdentity.projectToken === sourceIdentity.projectToken
            || tactic.contentRef !== tacticIdentity.contentRef
            || tactic.projectToken !== tacticIdentity.projectToken) {
          throw contextPocWorkspaceOperationError(
            'ERR_OPERATION_OUTCOME_UNKNOWN', '打法固化后来源绑定无法确认'
          );
        }
        return {
          kind: 'review-solidify', created: actionResult.created,
          sourceContentRef: sourceIdentity.contentRef,
          sourceProjectToken: latestSource.projectToken,
          tactic,
          message: actionResult.created
            ? '已固化进打法库；没有伪造使用次数或胜率。'
            : '已复用这一复盘版本的唯一打法。'
        };
      },
      redact: contextPocWorkspaceReviewSolidifyResult,
      errorCode: contextPocWorkspaceOperationErrorCode
    }),
    'shoot.open': Object.freeze({
      validate: contextPocWorkspaceFileShootIdentityInput,
      async handle({ input, context }) {
        contextPocAssertWorkspaceOperationCurrent(context);
        const identity = shootIdentity(catalog(), {
          contentRef: input.contentRef,
          projectToken: input.projectToken
        });
        await readBoundShootSource(identity);
        let disposition;
        try {
          disposition = await shootOpenAction(identity);
        } catch (error) {
          if (error && ['ERR_CONTEXT_PROJECT_STALE', 'ERR_VIDEO_RUNTIME_STALE',
            'ERR_VIDEO_ROOT_CHANGED', 'ERR_ROOT_CHANGED', 'ERR_ROOT_INVALID',
            'ERR_ROOT_UNREADABLE', 'ERR_PATH_CHANGED', 'ERR_PATH_NOT_FOUND',
            'ERR_PATH_SYMLINK', 'ERR_PATH_OUTSIDE', 'ERR_PATH_NOT_FILE',
            'ERR_OPERATION_OUTCOME_UNKNOWN'].includes(error.code)) throw error;
          throw contextPocWorkspaceOperationError(
            'ERR_OPERATION_OUTCOME_UNKNOWN', '本地拍摄窗已可能收到打开请求'
          );
        }
        if (!contextPocExact(disposition, ['kind', 'state'])
            || disposition.kind !== 'shoot-open'
            || !['opened', 'focused', 'busy', 'unavailable'].includes(disposition.state)) {
          throw contextPocWorkspaceOperationError(
            'ERR_OPERATION_OUTCOME_UNKNOWN', '本地拍摄窗打开结果无法确认'
          );
        }
        let latest;
        try {
          await readBoundShootSource(identity);
          latest = shootIdentity(catalog(), {
            contentRef: identity.contentRef,
            projectToken: identity.projectToken
          });
        } catch (error) {
          if (disposition.state === 'unavailable') throw error;
          throw contextPocWorkspaceOperationError(
            'ERR_OPERATION_OUTCOME_UNKNOWN', '打开请求后口播稿身份无法确认'
          );
        }
        return {
          kind: 'shoot-open', ...latest,
          state: disposition.state,
          message: shootingOpenMessage(disposition.state)
        };
      },
      redact: contextPocWorkspaceShootOpenResult,
      errorCode: contextPocWorkspaceOperationErrorCode
    }),
    'shoot.history.read': Object.freeze({
      validate: contextPocWorkspaceFileShootHistoryInput,
      async handle({ input, context }) {
        contextPocAssertWorkspaceOperationCurrent(context);
        const identity = shootIdentity(catalog(), {
          contentRef: input.contentRef,
          projectToken: input.projectToken
        });
        await readBoundShootSource(identity);
        const rawCollection = await shootHistoryCollection();
        if (!contextPocExact(rawCollection, [
          'collectionToken', 'complete', 'records'
        ]) || typeof rawCollection.collectionToken !== 'string'
            || !/^collection-[a-f0-9]{24}$/.test(rawCollection.collectionToken)
            || typeof rawCollection.complete !== 'boolean'
            || !Array.isArray(rawCollection.records)
            || rawCollection.records.length > 512) {
          throw new Error('拍摄历史目录结果无效');
        }
        const records = rawCollection.records.map(contextPocWorkspaceShootHistoryRecord);
        if (new Set(records.map((record) => record.recordRef)).size !== records.length) {
          throw new Error('拍摄历史跨页身份重复');
        }
        if (input.cursor > records.length
            || (input.cursor > 0
              && input.collectionToken !== rawCollection.collectionToken)) {
          throw contextPocWorkspaceOperationError(
            'ERR_CONTEXT_PROJECT_STALE', '拍摄历史分页期间已变化'
          );
        }
        const page = [];
        for (let cursor = input.cursor;
          cursor < records.length && page.length < input.limit; cursor += 1) {
          const candidate = [...page, records[cursor]];
          const next = input.cursor + candidate.length;
          const projected = {
            kind: 'shoot-history', ...identity,
            collectionToken: rawCollection.collectionToken,
            itemCount: records.length,
            complete: rawCollection.complete,
            cursor: input.cursor,
            nextCursor: next < records.length ? next : null,
            records: candidate
          };
          if (Buffer.byteLength(JSON.stringify(projected), 'utf8') > 5600
              && page.length) break;
          page.push(records[cursor]);
        }
        await readBoundShootSource(identity);
        const latest = shootIdentity(catalog(), {
          contentRef: identity.contentRef,
          projectToken: identity.projectToken
        });
        const next = input.cursor + page.length;
        return {
          kind: 'shoot-history', ...latest,
          collectionToken: rawCollection.collectionToken,
          itemCount: records.length,
          complete: rawCollection.complete,
          cursor: input.cursor,
          nextCursor: next < records.length ? next : null,
          records: page
        };
      },
      redact: contextPocWorkspaceShootHistoryResult,
      errorCode: contextPocWorkspaceOperationErrorCode
    }),
    'project.action.prepare': Object.freeze({
      validate: contextPocWorkspaceFileActionPrepareInput,
      async handle({ input, context }) {
        contextPocAssertWorkspaceOperationCurrent(context);
        return projectAction(input, {
          deliveryTargetRef: context.deliveryTargetRef || null
        });
      },
      redact: contextPocWorkspaceActionPrepareResult,
      errorCode: contextPocWorkspaceOperationErrorCode
    }),
    'project.action.submit': Object.freeze({
      validate: contextPocWorkspaceFileActionSubmitInput,
      async handle({ input, context }) {
        contextPocAssertWorkspaceOperationCurrent(context);
        return projectAction(input, {
          deliveryTargetRef: context.deliveryTargetRef || null
        });
      },
      redact: contextPocWorkspaceActionSubmitResult,
      errorCode: contextPocWorkspaceOperationErrorCode
    }),
    'receipts.read': Object.freeze({
      validate: contextPocWorkspaceFileReceiptsInput,
      async handle({ input, context }) {
        contextPocAssertWorkspaceOperationCurrent(context);
        const verified = verifyProject(input.projectToken);
        if (!verified || !verified.runtime
            || typeof verified.runtime.rootIdentityKey !== 'string'
            || !verified.record || typeof verified.record.relativePath !== 'string') {
          throw new Error('投递回执项目绑定无效');
        }
        const projectRelativePath = safeRelativePath(
          verified.record.relativePath
        );
        const snapshot = receiptSnapshot();
        if (!contextPocExact(snapshot, ['receipts']) || !Array.isArray(snapshot.receipts)) {
          throw new Error('投递回执快照无效');
        }
        const receipts = [];
        const related = snapshot.receipts.filter((receipt) => {
          if (!isPlainObject(receipt)) return false;
          if (receipt.anchorRef === input.projectToken) return true;
          const binding = receiptProjectBinding(receipt.receiptId);
          return isPlainObject(binding)
            && binding.relativePath === projectRelativePath
            && binding.rootIdentityKey === verified.runtime.rootIdentityKey;
        });
        for (const receipt of related.slice(0, input.limit)) {
          const candidate = [...receipts, receipt];
          const projected = contextPocWorkspaceReceiptsResult({
            kind: 'receipts', projectToken: input.projectToken, receipts: candidate
          });
          if (Buffer.byteLength(JSON.stringify(projected), 'utf8') > 5600 && receipts.length) break;
          receipts.push(receipt);
        }
        return {
          kind: 'receipts',
          projectToken: input.projectToken,
          receipts
        };
      },
      redact: contextPocWorkspaceReceiptsResult,
      errorCode: contextPocWorkspaceOperationErrorCode
    }),
    'receipts.ack': Object.freeze({
      validate: (input) => Object.freeze(deliveryPulseRequest(input)),
      async handle({ input, context }) {
        contextPocAssertWorkspaceOperationCurrent(context);
        return { kind: ackReceipt(input) ? 'ok' : 'stale' };
      },
      redact: contextPocWorkspaceReceiptAckResult,
      errorCode: contextPocWorkspaceOperationErrorCode
    }),
    'receipts.open': Object.freeze({
      validate: (input) => Object.freeze(deliveryResultRequest(input)),
      async handle({ input, context }) {
        contextPocAssertWorkspaceOperationCurrent(context);
        return openReceipt(input);
      },
      redact: contextPocWorkspaceReceiptOpenResult,
      errorCode: contextPocWorkspaceOperationErrorCode
    })
  });
}

module.exports = Object.freeze({
  CONTEXT_POC_WORKSPACE_FILE_OPERATIONS,
  configureContextPocWorkspaceOperationDefaults,
  contextPocExact,
  contextPocValidId,
  contextPocWorkspaceFileInputValue,
  contextPocWorkspaceFileRequestValue,
  contextPocWorkspaceFileReadResponseValue,
  contextPocWorkspaceFileClaimValue,
  contextPocWorkspaceFileRootAuthorizationValue,
  contextPocWorkspaceFileSettleValue,
  contextPocUtf8Clip,
  contextPocWorkspaceOperationError,
  contextPocWorkspaceFileOperations
});
