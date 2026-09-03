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
    const SESSION_BINDING_REF_RE = /^session-binding-[a-f0-9]{64}$/;
    const PROJECT_OPEN_TOKEN_RE = /^project-open-[a-f0-9]{64}$/;
    const PROJECT_BOOTSTRAP_TICKET_RE = /^project-bootstrap-v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{16,10923}\.[A-Za-z0-9_-]{22}$/;
    const APP_PROJECT_ID_RE = /^proj_[a-f0-9]{32}$/;
    const PROJECT_TERMINAL_REF_RE = /^terminal-[a-f0-9]{32}$/;
    const CONTROL_RE = /[\u0000-\u001f\u007f]/;
    const WORKSPACE_TEXT_CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
    const PREFLIGHT_TIMEOUT_MS = 2500;
    const PREFLIGHT_RETRY_MS = 120;
    const ALIGNMENT_SETTLE_MS = 1500;
    const ALIGNMENT_STORAGE_PREFIX = 'whaledock.content-alignment.v1.';
    const MAX_PREFERENCE_REVISION = 1_000_000_000;
    const MAX_PREFERENCE_LISTENERS = 64;
    const PREFERENCE_BOOTSTRAP_RETRY_MS = Object.freeze([50, 100, 200, 400, 800]);
    const WORKSPACE_FILE_OPERATIONS = new Set([
      'catalog.read', 'overview.read', 'document.read', 'topic.choose',
      'project.action.prepare', 'project.action.submit',
      'block.action.prepare', 'block.action.submit',
      'proposal.read', 'proposal.decide', 'proposal.undo',
      'publish.read', 'publish.create', 'publish.update',
      'review.tactics.read', 'review.solidify',
      'shoot.open', 'shoot.history.read',
      'receipts.read', 'receipts.ack', 'receipts.open',
      'projects.list', 'projects.create', 'projects.update', 'projects.remove',
      'projects.bind', 'projects.reorder', 'projects.open', 'projects.adopt',
      'projects.sidecar', 'projects.detach', 'console.read'
    ]);
    const PROJECT_OPERATIONS = new Set([
      'projects.list', 'projects.create', 'projects.update', 'projects.remove',
      'projects.bind', 'projects.reorder', 'projects.open', 'projects.adopt',
      'projects.sidecar', 'projects.detach', 'console.read'
    ]);
    const WORKSPACE_FILE_STATES = new Set([
      'queued', 'running', 'fulfilled', 'rejected', 'cancelled', 'expired'
    ]);
    const WORKSPACE_FILE_CODES = new Set([
      'workspace-unavailable', 'workspace-mismatch', 'operation-invalid',
      'operation-timeout', 'operation-failed', 'operation-stale',
      'outcome-unknown', 'busy', 'cancelled', 'project-not-found',
      'project-folder-invalid', 'project-protected', 'project-duplicate-folder',
      'project-identity-conflict', 'project-limit'
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
    const MAX_PROJECT_DETAIL_BYTES = 24 * 1024;
    const MAX_PROJECT_LIST_BYTES = 32 * 1024;
    const MAX_PROJECT_CONSOLE_BYTES = 48 * 1024;
    const MAX_PROJECT_RESULT_BYTES = 64 * 1024;
    const MAX_PROJECT_BOOTSTRAP_TICKET_BYTES = 8 * 1024;
    const MAX_PROJECT_CONSOLE_SESSIONS = 512;
    const MAX_CONTENT_CATALOG_PAGES = 128;
    const MAX_TACTIC_PAGES = 512;
    const MAX_SHOOT_HISTORY_PAGES = 128;
    const MAX_BROWSER_PROMPTER_BYTES = 64 * 1024;
    const PROJECT_TOKEN_RE = /^project-[a-f0-9]{24}$/;
    const CONTENT_REF_RE = /^content-[a-f0-9]{24}$/;
    const BLOCK_TOKEN_RE = /^block-[a-f0-9]{24}$/;
    const PROPOSAL_TOKEN_RE = /^proposal-[A-Za-z0-9_-]{1,80}$/;
    const PROPOSAL_REVISION_TOKEN_RE = /^proposal-revision-[a-f0-9]{24}$/;
    const REVISION_TOKEN_RE = /^revision-[a-f0-9]{24}$/;
    const COLLECTION_TOKEN_RE = /^collection-[a-f0-9]{24}$/;
    const RECORD_REF_RE = /^[a-f0-9]{24}$/;
    const BLOCK_ACTIONS = Object.freeze([
      ['revise', '改这段'], ['spoken', '更口语'],
      ['shorten', '压时长'], ['ask', '问一句']
    ]);
    const PUBLISH_LIGHTS = Object.freeze([
      ['cover', '封面'], ['title', '标题'], ['topics', '标签话题'],
      ['timing', '发布时间'], ['pinned-comment', '置顶评论'],
      ['ai-label', 'AI 内容标识'], ['published', '已由本人发布']
    ]);
    const PUBLISH_CREATABLE_STAGES = new Set(['script', 'shoot', 'edit']);
    const AI_DISCLOSURES = Object.freeze([
      ['unknown', '未选择'], ['ai', '包含 AI 内容'], ['not-ai', '不包含 AI 内容']
    ]);
    const OVERVIEW_STAGES = new Set([
      'inspiration', 'topic', 'script', 'shoot', 'edit',
      'publish', 'data', 'review', 'asset'
    ]);
    const OPAQUE_VALUE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$/;
    const ACTIVE_RECEIPT_STATES = new Set(['submitting', 'queued', 'running', 'waiting']);
    const SHELL_CONTRACT = 'whaledock.content-shell/v1';
    const CONTROL_PROJECT_ID = `proj_${'0'.repeat(31)}1`;
    const PROJECT_POLL_MS = 2000;
    const PROJECT_SLOW_MS = 600;
    const PROJECT_CONTEXT_RETRY_MS = Object.freeze([120, 240, 480, 960, 1600]);
    const PROJECT_THEMES = new Set(['dark', 'light', 'system']);
    const PROJECT_PANE_PRESETS = Object.freeze(['split-two', 'left-stack', 'grid-four']);
    const PROJECT_PANE_SLOTS = Object.freeze({
      'split-two': Object.freeze(['left', 'right']),
      'left-stack': Object.freeze(['left-top', 'left-bottom', 'right']),
      'grid-four': Object.freeze(['left-top', 'left-bottom', 'right-top', 'right-bottom'])
    });
    const PROJECT_PANE_TYPES = new Set([
      'markdown', 'text', 'image', 'browser', 'video-template', 'terminal', 'artifact'
    ]);
    const PROJECT_ARTIFACT_KINDS = new Set(['markdown', 'text', 'image', 'html']);
    const PROJECT_SHA256_RE = /^[a-f0-9]{64}$/;
    const PROJECT_TERMINAL_CODE_RE = /^[a-z][a-z0-9-]{0,47}$/;
    const MAX_PROJECT_PREVIEWS = 8;
    const MAX_PROJECT_PREVIEW_BYTES = 8 * 1024;
    const MAX_PROJECT_PREVIEW_TEXT_BYTES = 6 * 1024;
    const MAX_PROJECT_PREVIEW_IMAGE_BYTES = 6 * 1024;
    const MAX_PROJECT_TEMPLATE_CATALOG_BYTES = 4 * 1024;
    const PROJECT_SWITCH_STORAGE_KEY = 'whaledock.project-switch.v1';
    const inject = ['connection', 'sessions', 'workspaces'];

    const SHELL_CSS = `.wd10-left{background:var(--dsw-specific-sidebar-fill);border-right:1px solid var(--dsw-alias-border-l1);min-width:0;height:100%;display:flex;flex-direction:column;overflow:hidden}.wd10-switch{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:12px;padding:4px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}.wd10-switch button{border:0;border-radius:7px;padding:7px 10px;color:var(--dsw-alias-fg-secondary);background:transparent;font:inherit;font-size:13px;cursor:pointer}.wd10-switch button[aria-selected=true]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-primary);box-shadow:0 1px 3px rgba(0,0,0,.08)}.wd10-library{min-height:0;overflow:auto;padding:0 10px 18px}.wd10-libraryHead{padding:8px 6px 10px}.wd10-eyebrow{font-size:11px;letter-spacing:.08em;color:var(--dsw-alias-fg-tertiary);text-transform:uppercase}.wd10-libraryHead h2{font-size:17px;line-height:1.35;margin:4px 0;color:var(--dsw-alias-fg-primary)}.wd10-libraryHead p{font-size:12px;line-height:1.5;margin:0;color:var(--dsw-alias-fg-secondary)}.wd10-refresh,.wd10-loadMore{margin-top:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:5px 8px;background:transparent;color:var(--dsw-alias-fg-secondary);font:inherit;font-size:11px;cursor:pointer}.wd10-refresh:disabled,.wd10-loadMore:disabled{opacity:.55;cursor:default}.wd10-loadMore{width:100%;padding:8px}.wd10-workspaceList{margin:0 0 10px;padding:8px 6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}.wd10-workspaceChoice{width:100%;text-align:left;border:1px solid transparent;border-radius:8px;padding:7px 8px;margin-top:4px;background:transparent;color:inherit;cursor:pointer}.wd10-workspaceChoice:hover,.wd10-workspaceChoice[aria-current=true]{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l1)}.wd10-projectPath{display:block;margin-top:3px;font-size:10px;color:var(--dsw-alias-fg-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wd10-project{width:100%;text-align:left;border:1px solid transparent;border-radius:10px;padding:10px;margin:2px 0 6px;background:transparent;color:inherit;cursor:pointer}.wd10-project:hover{background:var(--dsw-alias-bg-layer-1)}.wd10-project[aria-current=true]{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l2)}.wd10-projectTitle{display:block;font-size:13px;font-weight:600;color:var(--dsw-alias-fg-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wd10-projectMeta{display:flex;align-items:center;gap:7px;margin-top:5px;font-size:11px;color:var(--dsw-alias-fg-tertiary)}.wd10-stageBadge{border-radius:999px;padding:1px 7px;background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary)}.wd10-detailFrame{min-width:0;height:100%;overflow:hidden}.wd10-detailFrame[hidden],.wd10-detailRail[hidden]{display:none}.wd10-detailRail{min-width:0;height:100%;display:flex;background:var(--dsw-alias-bg-layer-1);border-right:1px solid var(--dsw-alias-border-l2);overflow:hidden}.wd10-detailRail button{width:36px;height:100%;border:0;padding:12px 0;background:transparent;color:var(--dsw-alias-fg-secondary);font:inherit;font-size:11px;letter-spacing:.12em;writing-mode:vertical-rl;text-orientation:upright;cursor:pointer}.wd10-detailRail button:hover{color:var(--dsw-alias-fg-primary);background:var(--dsw-alias-bg-base)}.wd10-detail{min-width:0;height:100%;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);border-right:1px solid var(--dsw-alias-border-l2);overflow:hidden}.wd10-detailHead{position:relative;padding:22px 118px 12px 24px}.wd10-collapseButton{position:absolute;top:18px;right:18px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-secondary);font:inherit;font-size:11px;cursor:pointer}.wd10-collapseButton:hover{color:var(--dsw-alias-fg-primary);border-color:var(--dsw-alias-fg-tertiary)}.wd10-detailHead h1{font-size:22px;line-height:1.25;margin:5px 0 7px;color:var(--dsw-alias-fg-primary)}.wd10-detailHead p{font-size:12px;line-height:1.5;margin:0;color:var(--dsw-alias-fg-secondary)}.wd10-projectActions{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}.wd10-projectActions button,.wd10-receipt button,.wd10-choice,.wd10-nextAction{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-primary);font:inherit;font-size:11px;cursor:pointer}.wd10-projectActions button:disabled,.wd10-receipt button:disabled,.wd10-choice:disabled,.wd10-nextAction:disabled{opacity:.55;cursor:default}.wd10-tabs{display:flex;gap:3px;padding:0 20px;border-bottom:1px solid var(--dsw-alias-border-l1);overflow:auto}.wd10-tabs button{border:0;border-bottom:2px solid transparent;padding:10px 8px 9px;background:transparent;color:var(--dsw-alias-fg-secondary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}.wd10-tabs button[aria-selected=true]{border-bottom-color:var(--dsw-alias-fg-primary);color:var(--dsw-alias-fg-primary)}.wd10-receipts{flex:none;max-height:188px;overflow:auto;padding:10px 18px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}.wd10-receiptTitle{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--dsw-alias-fg-secondary)}.wd10-receipt{margin-top:7px;padding:8px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);font-size:11px;color:var(--dsw-alias-fg-secondary)}.wd10-receiptHead,.wd10-receiptFoot{display:flex;align-items:center;justify-content:space-between;gap:8px}.wd10-receipt strong{color:var(--dsw-alias-fg-primary)}.wd10-receipt p{margin:5px 0 0;line-height:1.45}.wd10-preflight{border-color:var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-state-warn-tertiary)}.wd10-pulse{color:var(--dsw-alias-state-business-primary);font-weight:600}.wd10-panel{min-height:0;overflow:auto;padding:20px 24px 28px}.wd10-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px;background:var(--dsw-alias-bg-layer-1);margin-bottom:12px}.wd10-card h3{font-size:14px;margin:0 0 7px;color:var(--dsw-alias-fg-primary)}.wd10-card p{font-size:12px;line-height:1.65;margin:0;color:var(--dsw-alias-fg-secondary)}.wd10-overviewMeta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}.wd10-overviewMeta div{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:9px;background:var(--dsw-alias-bg-base)}.wd10-overviewMeta span,.wd10-currentChoice span{display:block;font-size:10px;color:var(--dsw-alias-fg-tertiary);margin-bottom:3px}.wd10-overviewMeta strong,.wd10-currentChoice strong{font-size:12px;color:var(--dsw-alias-fg-primary)}.wd10-currentChoices{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}.wd10-currentChoice{border-left:3px solid var(--dsw-alias-state-business-primary);padding:7px 9px;background:var(--dsw-alias-bg-base);border-radius:0 8px 8px 0}.wd10-choiceGroup{margin-top:14px}.wd10-choiceGroup h4{font-size:11px;margin:0 0 7px;color:var(--dsw-alias-fg-secondary)}.wd10-choiceList{display:flex;flex-wrap:wrap;gap:6px}.wd10-choice[aria-pressed=true]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-tertiary);font-weight:600}.wd10-incomplete{color:var(--dsw-alias-state-warn-primary)!important;margin-top:10px!important}.wd10-next{margin-top:16px;padding-top:14px;border-top:1px solid var(--dsw-alias-border-l1)}.wd10-nextAction{margin-top:8px;border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-bg-base);font-weight:600}.wd10-unfinished strong{display:block;margin:8px 0;color:var(--dsw-alias-fg-primary)}.wd10-feedback{font-size:12px;line-height:1.5;margin:8px 0 0;color:var(--dsw-alias-fg-secondary)}.wd10-chat{min-width:0;height:100%;display:flex;overflow:hidden}.wd10-chatMain{min-width:0;flex:1;display:flex;flex-direction:column;overflow:hidden}.wd10-empty{padding:24px;color:var(--dsw-alias-fg-secondary);font-size:13px;line-height:1.6}@media(max-width:1120px){.wd10-detailHead{padding:18px 112px 10px 18px}.wd10-collapseButton{top:14px;right:14px}.wd10-panel{padding:16px 18px}.wd10-detailHead h1{font-size:19px}.wd10-tabs{padding:0 14px}.wd10-receipts{padding:9px 14px}.wd10-overviewMeta,.wd10-currentChoices{grid-template-columns:1fr}}.wd10-leftViews,.wd10-leftView,.wd10-nativeSidebar{min-height:0;flex:1;overflow:hidden}.wd10-leftView[hidden],.wd10-nativeSidebar[hidden]{display:none}.wd10-banner,.wd10-hint{display:flex;align-items:center;gap:8px;margin:10px 18px 0;padding:9px 10px;border:1px solid var(--dsw-alias-state-warn-primary);border-radius:9px;color:var(--dsw-alias-fg-primary);background:var(--dsw-alias-state-warn-tertiary);font-size:12px;line-height:1.45}.wd10-banner span,.wd10-hint span{min-width:0;flex:1}.wd10-banner button,.wd10-hint button{flex:none;border:1px solid currentColor;border-radius:7px;padding:4px 8px;background:transparent;color:inherit;cursor:pointer}.wd10-banner button:disabled{opacity:.55;cursor:default}.wd10-prefStatus{margin:0 14px 8px;color:var(--dsw-alias-state-warn-primary);font-size:11px}.wd10-contentDetails{transition:width var(--ds-transition-duration-slow) var(--ds-ease-in-out);flex-shrink:0}`;
    const SCRIPT_CSS = `.wd10-script{display:flex;flex-direction:column;gap:10px}.wd10-scriptHead,.wd10-blockMeta{display:flex;align-items:center;justify-content:space-between;gap:8px}.wd10-scriptHead h3{margin:0;color:var(--dsw-alias-fg-primary);font-size:14px}.wd10-scriptHead span,.wd10-blockMeta span{font-size:10px;color:var(--dsw-alias-fg-tertiary)}.wd10-block{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:13px;background:var(--dsw-alias-bg-layer-1)}.wd10-blockMeta strong{font-size:11px;color:var(--dsw-alias-fg-secondary)}.wd10-block pre,.wd10-compare pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:9px 0 0;font:inherit;font-size:12px;line-height:1.6;color:var(--dsw-alias-fg-primary)}.wd10-blockActions,.wd10-proposalActions{display:flex;flex-wrap:wrap;gap:6px;margin-top:11px}.wd10-blockActions button,.wd10-proposalActions button,.wd10-undo{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-primary);font:inherit;font-size:11px;cursor:pointer}.wd10-blockActions button:disabled,.wd10-proposalActions button:disabled,.wd10-undo:disabled{opacity:.5;cursor:default}.wd10-proposal{border-color:var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-state-warn-tertiary)}.wd10-compare{margin-top:10px;border-radius:9px;padding:10px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1)}.wd10-compare h4{margin:0;font-size:11px;color:var(--dsw-alias-fg-secondary)}.wd10-proposalActions button:first-child,.wd10-undo{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);font-weight:600}.wd10-undo{margin-top:11px}`;
    const PUBLISH_CSS = `.wd10-publish{display:flex;flex-direction:column;gap:12px}.wd10-publishHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.wd10-publishHead h3{margin:0 0 5px;font-size:14px;color:var(--dsw-alias-fg-primary)}.wd10-publishState{flex:none;border-radius:999px;padding:3px 8px;font-size:10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-secondary);border:1px solid var(--dsw-alias-border-l1)}.wd10-publishState[data-ready=true]{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}.wd10-publishLights{display:grid;gap:7px;margin-top:12px}.wd10-publishLight{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:9px 10px;background:var(--dsw-alias-bg-base)}.wd10-publishLight span{font-size:12px;color:var(--dsw-alias-fg-primary)}.wd10-publishLight input{margin:0}.wd10-publishLight[data-satisfied=true]{border-color:var(--dsw-alias-state-business-primary)}.wd10-aiChoices{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}.wd10-aiChoices button,.wd10-createPublish{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-primary);font:inherit;font-size:11px;cursor:pointer}.wd10-aiChoices button[aria-pressed=true]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-tertiary);font-weight:600}.wd10-aiChoices button:disabled,.wd10-createPublish:disabled{opacity:.5;cursor:default}.wd10-createPublish{margin-top:12px;border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);font-weight:600}.wd10-publishInvalid{border-color:var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-state-warn-tertiary)}.wd10-publishNotice{border-left:3px solid var(--dsw-alias-state-warn-primary);padding:8px 10px;border-radius:0 8px 8px 0;background:var(--dsw-alias-state-warn-tertiary)}`;
    const REVIEW_CSS = `.wd10-review{display:flex;flex-direction:column;gap:12px}.wd10-reviewHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.wd10-reviewHead h3{margin:0 0 5px;font-size:14px;color:var(--dsw-alias-fg-primary)}.wd10-reviewBlocks,.wd10-tacticWall{display:grid;gap:9px;margin-top:11px}.wd10-reviewBlock,.wd10-tactic{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:11px;background:var(--dsw-alias-bg-base)}.wd10-reviewBlock pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:7px 0 0;font:inherit;font-size:12px;line-height:1.6;color:var(--dsw-alias-fg-primary)}.wd10-reviewMeta,.wd10-tacticMeta{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10px;color:var(--dsw-alias-fg-tertiary)}.wd10-tactic[data-highlight=true]{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 1px var(--dsw-alias-state-business-primary)}.wd10-tactic h4{margin:7px 0 5px;font-size:13px;color:var(--dsw-alias-fg-primary)}.wd10-tacticBadge{border-radius:999px;padding:2px 7px;color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-tertiary)}.wd10-solidify{border:1px solid var(--dsw-alias-state-business-primary);border-radius:8px;padding:7px 10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-state-business-primary);font:inherit;font-size:11px;font-weight:600;cursor:pointer}.wd10-solidify:disabled{opacity:.5;cursor:default}.wd10-reviewTruth{border-left:3px solid var(--dsw-alias-state-warn-primary);padding:8px 10px;border-radius:0 8px 8px 0;background:var(--dsw-alias-state-warn-tertiary)}`;
    const SHOOT_CSS = `.wd10-shoot{display:flex;flex-direction:column;gap:12px}.wd10-shootHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.wd10-shootHead h3,.wd10-shootRecord h4{margin:0 0 5px;color:var(--dsw-alias-fg-primary)}.wd10-shootHead h3{font-size:14px}.wd10-shootRecord h4{font-size:13px}.wd10-shootActions,.wd10-prompterControls,.wd10-prompterChoices{display:flex;flex-wrap:wrap;gap:7px;margin-top:11px}.wd10-shootActions button,.wd10-prompterControls button,.wd10-prompterChoices button{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-primary);font:inherit;font-size:11px;cursor:pointer}.wd10-shootActions button:first-child{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);font-weight:600}.wd10-shootActions button:disabled,.wd10-prompterControls button:disabled,.wd10-prompterChoices button:disabled{opacity:.5;cursor:default}.wd10-prompterChoices button[aria-pressed=true]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-tertiary)}.wd10-prompter{height:300px;overflow:auto;scroll-behavior:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:110px 18px;background:#111;color:#f7f7f7;margin-top:12px}.wd10-prompter pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font:inherit;line-height:1.75}.wd10-prompter[data-font=medium] pre{font-size:26px}.wd10-prompter[data-font=large] pre{font-size:36px}.wd10-shootTruth{border-left:3px solid var(--dsw-alias-state-warn-primary);padding:8px 10px;border-radius:0 8px 8px 0;background:var(--dsw-alias-state-warn-tertiary)}.wd10-shootRecords{display:grid;gap:9px;margin-top:11px}.wd10-shootRecord{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:11px;background:var(--dsw-alias-bg-base)}.wd10-shootRecord[data-confirmed=true]{border-color:var(--dsw-alias-state-business-primary)}`;
    const BROWSER_PROMPTER_CSS = `.wd10-browserPrompt{min-width:0;height:100%;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);border-right:1px solid var(--dsw-alias-border-l2);overflow:hidden}.wd10-browserPrompt textarea{box-sizing:border-box;width:100%;min-height:150px;resize:vertical;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-primary);font:inherit;font-size:12px;line-height:1.55}.wd10-browserPromptMeta{display:flex;justify-content:space-between;gap:8px;margin-top:6px;font-size:10px;color:var(--dsw-alias-fg-tertiary)}`;
    const NARROW_SIDEBAR_CSS = `@media(max-width:1023px){[data-whaledock-left="sessions"] .wd10-switch{grid-template-columns:1fr;margin:8px 4px;padding:2px;gap:2px}[data-whaledock-left="sessions"] .wd10-switch button{padding:5px 2px;font-size:11px;white-space:nowrap}}`;
    const PROJECT_SWITCH_CSS = `.wd10-switch.wd11-switch{grid-template-columns:repeat(3,minmax(0,1fr))}.wd10-switch.wd11-switch button{padding-inline:5px}.wd10-leftView>.wd11-projectDrawer{height:100%}.wd11-projectTools{grid-template-columns:repeat(7,minmax(0,1fr))}`;
    const PROJECT_WORKBENCH_CSS = `.wd11-projectDrawer{min-height:0;flex:1;display:flex;flex-direction:column;overflow:hidden}.wd11-projectHead{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 14px 10px}.wd11-projectHead h2{margin:0;font-size:17px;color:var(--dsw-alias-fg-primary)}.wd11-projectHead button,.wd11-projectAdd,.wd11-projectRetry,.wd11-projectTools button,.wd11-bindOffer button{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-secondary);font:inherit;font-size:11px;cursor:pointer}.wd11-projectHead button{padding:5px 8px}.wd11-projectList{min-height:0;flex:1;overflow:auto;padding:0 9px 12px}.wd11-projectRow{margin:2px 0 6px;border:1px solid transparent;border-radius:11px}.wd11-projectRow[data-current=true]{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l2)}.wd11-projectMain{width:100%;display:grid;grid-template-columns:28px minmax(0,1fr) auto;align-items:center;gap:8px;border:0;border-radius:10px;padding:9px 8px;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}.wd11-projectMain:hover{background:var(--dsw-alias-bg-layer-1)}.wd11-projectMain:disabled,.wd11-projectHead button:disabled,.wd11-projectAdd:disabled,.wd11-projectTools button:disabled,.wd11-bindOffer button:disabled{opacity:.5;cursor:default}.wd11-projectIcon{font-size:19px;line-height:1;text-align:center}.wd11-projectName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;color:var(--dsw-alias-fg-primary)}.wd11-projectDots{display:flex;gap:4px}.wd11-dot{width:7px;height:7px;border-radius:50%;border:1px solid var(--dsw-alias-fg-tertiary);background:transparent}.wd11-dot[data-on=true]{border-color:#53d7a1;background:#53d7a1;box-shadow:0 0 7px rgba(83,215,161,.65)}.wd11-dot[data-unknown=true]{border-style:dashed}.wd11-projectTools{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:3px;padding:0 7px 7px}.wd11-projectTools button{padding:4px 2px}.wd11-projectState{margin:7px 12px;padding:9px 10px;border-radius:9px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-fg-secondary);font-size:11px;line-height:1.5}.wd11-projectState[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}.wd11-projectAdd{margin:8px 12px 4px;padding:9px 10px;color:var(--dsw-alias-fg-primary);font-weight:600}.wd11-projectRetry{margin-top:6px;padding:5px 8px}.wd11-projectFoot{margin:4px 14px 12px;color:var(--dsw-alias-fg-tertiary);font-size:10px;line-height:1.45}.wd11-bindOffer{margin:7px 11px;padding:9px;border:1px solid var(--dsw-alias-state-business-primary);border-radius:10px;background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-fg-primary);font-size:11px;line-height:1.5}.wd11-bindOffer div{display:flex;gap:5px;margin-top:7px}.wd11-bindOffer button{padding:5px 8px}.wd11-control{--wt-bg:#07111f;--wt-panel:rgba(13,31,52,.76);--wt-line:rgba(113,169,223,.14);--wt-fg:#edf7ff;--wt-muted:#86a5bf;min-width:0;height:100%;display:flex;flex-direction:column;overflow:hidden;color:var(--wt-fg);background-color:var(--wt-bg);background-image:linear-gradient(var(--wt-line) 1px,transparent 1px),linear-gradient(90deg,var(--wt-line) 1px,transparent 1px);background-size:28px 28px;border-right:1px solid rgba(122,173,217,.2)}.wd11-control[data-wt-theme=light]{--wt-bg:#eaf3f8;--wt-panel:rgba(255,255,255,.76);--wt-line:rgba(54,105,139,.13);--wt-fg:#102c3f;--wt-muted:#56758a}.wd11-controlHead{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:20px 22px 13px}.wd11-controlTitle h1{margin:2px 0 5px;font-size:23px;letter-spacing:.01em}.wd11-controlTitle p{margin:0;color:var(--wt-muted);font-size:11px;line-height:1.5}.wd11-controlEyebrow{font:600 10px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.17em;color:#62b7f0}.wd11-controlMeta{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap}.wd11-controlCount{padding:4px 7px;border:1px solid rgba(131,180,219,.24);border-radius:999px;color:var(--wt-muted);font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--wt-panel)}.wd11-theme{display:flex;gap:2px;padding:3px;border:1px solid rgba(131,180,219,.24);border-radius:9px;background:var(--wt-panel)}.wd11-theme button{width:28px;height:25px;border:0;border-radius:6px;background:transparent;color:var(--wt-muted);cursor:pointer}.wd11-theme button[aria-pressed=true]{background:rgba(93,171,228,.2);color:var(--wt-fg);box-shadow:inset 0 0 0 1px rgba(115,194,247,.34)}.wd11-controlBody{min-height:0;overflow:auto;padding:10px 22px 28px}.wd11-controlGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(16px,3vw,64px)}.wd11-agentCard,.wd11-controlAdd{position:relative;aspect-ratio:1;border:1px solid rgba(126,178,218,.26);border-radius:16px;background:var(--wt-panel);color:var(--wt-fg);padding:16px;text-align:left;overflow:hidden;box-shadow:0 12px 32px rgba(0,0,0,.16);backdrop-filter:blur(14px);font:inherit}.wd11-agentCard{display:flex;flex-direction:column;cursor:pointer}.wd11-agentCard:hover{border-color:rgba(116,195,249,.62)}.wd11-agentCard:disabled,.wd11-controlAdd:disabled{opacity:.58;cursor:default}.wd11-agentCard[data-glow=true][data-wt-status=need]{border-color:#f3c95e;box-shadow:0 0 0 1px rgba(243,201,94,.3),0 0 30px rgba(243,201,94,.32)}.wd11-agentCard[data-glow=true][data-wt-status=done]{border-color:#5ce2aa;box-shadow:0 0 0 1px rgba(92,226,170,.28),0 0 30px rgba(92,226,170,.28)}.wd11-cardTop{display:flex;align-items:center;justify-content:space-between;gap:9px}.wd11-cardProject{min-width:0;display:flex;align-items:center;gap:8px;font-size:12px;font-weight:650}.wd11-cardProject span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wd11-cardStatus{margin:auto 0 5px;font:700 clamp(21px,2.2vw,33px)/1.05 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:-.04em}.wd11-agentCard[data-wt-status=need] .wd11-cardStatus{color:#f3c95e}.wd11-agentCard[data-wt-status=done] .wd11-cardStatus{color:#5ce2aa}.wd11-agentCard[data-wt-status=busy] .wd11-cardStatus{color:#64bff7}.wd11-cardFacts{display:flex;gap:10px;color:var(--wt-muted);font:500 10px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace}.wd11-cardSession{margin:7px 0 0;color:var(--wt-muted);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wd11-controlAdd{display:grid;place-content:center;text-align:center;cursor:pointer;border-style:dashed;color:var(--wt-muted)}.wd11-controlAdd strong{display:block;margin-bottom:5px;color:var(--wt-fg);font-size:21px}.wd11-controlState{grid-column:1/-1;padding:22px;border:1px dashed rgba(126,178,218,.32);border-radius:14px;background:var(--wt-panel);color:var(--wt-muted);font-size:12px;line-height:1.6}.wd11-controlState button{margin-top:9px;border:1px solid rgba(126,178,218,.38);border-radius:8px;padding:6px 9px;background:transparent;color:var(--wt-fg);font:inherit;cursor:pointer}@media(prefers-color-scheme:light){.wd11-control[data-wt-theme=system]{--wt-bg:#eaf3f8;--wt-panel:rgba(255,255,255,.76);--wt-line:rgba(54,105,139,.13);--wt-fg:#102c3f;--wt-muted:#56758a}}@media(max-width:1260px){.wd11-controlGrid{gap:16px}.wd11-controlHead{padding-inline:16px}.wd11-controlBody{padding-inline:16px}.wd11-agentCard,.wd11-controlAdd{padding:13px}}@media(max-width:1050px){.wd11-controlGrid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(prefers-reduced-motion:no-preference){.wd11-agentCard[data-glow=true]{animation:wd11-breathe 1.8s ease-in-out infinite alternate}}@keyframes wd11-breathe{from{filter:brightness(.98)}to{filter:brightness(1.1)}}`;
    const PROJECT_PANES_CSS = `.wd11-paneSurface{min-width:0;height:100%;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base);border-right:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-fg-primary)}.wd11-paneHead{flex:none;display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:18px 20px 13px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}.wd11-paneTitle{min-width:0}.wd11-paneTitle h1{margin:3px 0 4px;font-size:21px;line-height:1.25;outline:none}.wd11-paneTitle p{margin:0;color:var(--dsw-alias-fg-secondary);font-size:11px;line-height:1.5}.wd11-paneEyebrow{color:var(--dsw-alias-fg-tertiary);font:600 10px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em}.wd11-paneActions{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap}.wd11-paneActions button,.wd11-paneTabs button,.wd11-paneEmpty button,.wd11-paneState button{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-secondary);font:inherit;font-size:11px;cursor:pointer}.wd11-paneActions button[aria-pressed=true]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-tertiary)}.wd11-paneActions button:disabled{opacity:.5;cursor:default}.wd11-paneNotice{flex:none;margin:10px 20px 0;padding:8px 10px;border-left:3px solid var(--dsw-alias-state-warn-primary);border-radius:0 8px 8px 0;background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-fg-secondary);font-size:11px;line-height:1.5}.wd11-paneBody{min-height:0;flex:1;overflow:auto;padding:14px 18px 22px}.wd11-paneGrid{min-height:100%;display:grid;gap:10px;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.wd11-paneGrid[data-preset=split-two]{grid-template-areas:'left right'}.wd11-paneGrid[data-preset=left-stack]{grid-template-areas:'left-top right' 'left-bottom right'}.wd11-paneGrid[data-preset=grid-four]{grid-template-areas:'left-top right-top' 'left-bottom right-bottom'}.wd11-paneWindow{min-width:0;min-height:210px;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:13px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;box-shadow:0 8px 22px rgba(0,0,0,.08)}.wd11-paneWindow[data-retained=true]{min-height:150px}.wd11-paneWindowHead{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}.wd11-paneWindowHead strong{font-size:11px}.wd11-paneWindowHead span{color:var(--dsw-alias-fg-tertiary);font-size:10px}.wd11-paneTabs{display:flex;gap:3px;overflow:auto;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1)}.wd11-paneTabs button{border:0;border-bottom:2px solid transparent;border-radius:5px;padding:5px 7px;background:transparent;white-space:nowrap}.wd11-paneTabs button[aria-selected=true]{border-bottom-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-fg-primary);background:var(--dsw-alias-bg-base)}.wd11-paneContent{min-height:0;flex:1;overflow:auto;padding:12px}.wd11-paneEmpty{height:100%;display:grid;place-content:center;text-align:center;color:var(--dsw-alias-fg-tertiary);font-size:11px;line-height:1.55}.wd11-paneEmpty strong{display:block;margin-bottom:4px;color:var(--dsw-alias-fg-secondary);font-size:12px}.wd11-paneRef{overflow-wrap:anywhere;margin:8px 0 0;padding:8px;border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-primary);font:500 10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.wd11-artifact{height:100%;display:flex;flex-direction:column;gap:8px}.wd11-artifactBadge{align-self:flex-start;border-radius:999px;padding:3px 7px;background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary);font-size:10px;font-weight:650}.wd11-artifactMeta{display:grid;grid-template-columns:auto minmax(0,1fr);gap:5px 9px;margin:0;font-size:10px}.wd11-artifactMeta dt{color:var(--dsw-alias-fg-tertiary)}.wd11-artifactMeta dd{margin:0;min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-fg-secondary)}.wd11-browserFrame{box-sizing:border-box;width:100%;height:100%;min-height:190px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:#fff}.wd11-retained{margin-top:12px}.wd11-retained h2{margin:0 0 8px;color:var(--dsw-alias-fg-secondary);font-size:11px}.wd11-retainedGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.wd11-paneState{height:100%;display:grid;place-content:center;padding:24px;text-align:center;color:var(--dsw-alias-fg-secondary);font-size:12px;line-height:1.6}.wd11-paneState strong{display:block;margin-bottom:5px;color:var(--dsw-alias-fg-primary);font-size:15px}.wd11-paneState button{margin-top:10px}.wd11-paneSurface button:focus-visible,.wd11-paneSurface h1:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}@media(max-width:1180px){.wd11-paneHead{display:block;padding:14px}.wd11-paneActions{justify-content:flex-start;margin-top:10px}.wd11-paneBody{padding:10px}.wd11-paneGrid,.wd11-paneGrid[data-preset=split-two],.wd11-paneGrid[data-preset=left-stack],.wd11-paneGrid[data-preset=grid-four]{display:flex;flex-direction:column}.wd11-paneWindow{min-height:230px}.wd11-retainedGrid{grid-template-columns:1fr}}`;
    const PROJECT_PREVIEW_CSS = `.wd11-preview{min-width:0;display:flex;flex-direction:column;gap:8px}.wd11-previewText{box-sizing:border-box;width:100%;min-height:96px;margin:0;padding:11px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-primary);font:400 11px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace}.wd11-previewImage{margin:0;display:grid;gap:6px;justify-items:center}.wd11-previewImage img{display:block;max-width:100%;max-height:360px;object-fit:contain;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base)}.wd11-preview figcaption,.wd11-previewNote{color:var(--dsw-alias-fg-tertiary);font-size:10px;line-height:1.5}.wd11-previewUnavailable{padding:10px;border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-fg-tertiary);font-size:11px;line-height:1.55}.wd11-paneDocument{min-width:0;display:flex;flex-direction:column;gap:10px}.wd11-paneDocument h3{margin:0;color:var(--dsw-alias-fg-secondary);font-size:12px}`;
    const PROJECT_TEMPLATE_CSS = `.wd11-templateSurface{box-sizing:border-box;min-width:0;min-height:520px;height:100%;display:grid;grid-template-columns:minmax(156px,.42fr) minmax(280px,1fr);overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base)}.wd11-templateCatalog{min-width:0;min-height:0;overflow:hidden;border-right:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-sidebar-fill)}.wd11-templateCatalog .wd10-library{height:100%;box-sizing:border-box}.wd11-templateDetail{min-width:0;border-right:0}.wd11-templateDetail .wd10-detailHead{padding-right:18px}.wd11-templateState{height:100%;min-height:260px;display:grid;place-content:center;padding:18px;text-align:center;color:var(--dsw-alias-fg-secondary);font-size:11px;line-height:1.6}@media(max-width:1180px){.wd11-templateSurface{grid-template-columns:1fr;min-height:680px}.wd11-templateCatalog{max-height:210px;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1)}}`;
    // 项目中栏会被左侧项目抽屉和右侧原生对话同时夹窄，
    // viewport media query 无法感知它的真实宽度，因此用容器查询收敛窗格。
    const PROJECT_CONTAINER_CSS = `.wd11-paneSurface{container-type:inline-size;container-name:wd11-pane}.wd11-paneWindow{container-type:inline-size;container-name:wd11-window}@container wd11-pane (max-width:720px){.wd11-paneHead{display:block;padding:14px}.wd11-paneActions{justify-content:flex-start;margin-top:10px}.wd11-paneBody{padding:10px}.wd11-paneGrid,.wd11-paneGrid[data-preset=split-two],.wd11-paneGrid[data-preset=left-stack],.wd11-paneGrid[data-preset=grid-four]{display:flex;flex-direction:column}.wd11-paneWindow{min-height:340px}.wd11-paneWindow[data-empty=true]{min-height:140px}.wd11-retainedGrid{grid-template-columns:1fr}.wd11-templateSurface{grid-template-columns:1fr;min-height:680px}.wd11-templateCatalog{max-height:210px;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1)}}@container wd11-window (max-width:600px){.wd11-templateSurface{grid-template-columns:1fr;min-height:680px}.wd11-templateCatalog{max-height:210px;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1)}.wd10-overviewMeta,.wd10-currentChoices{grid-template-columns:1fr}.wd10-scriptHead,.wd10-blockMeta,.wd10-publishHead,.wd10-reviewHead,.wd10-reviewMeta,.wd10-tacticMeta,.wd10-shootHead{align-items:flex-start;flex-wrap:wrap}}`;
    const PROJECT_CREATE_ACTION_CSS = `.wd11-createWizard{margin:8px 11px;padding:11px;border:1px solid var(--dsw-alias-state-business-primary);border-radius:11px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-fg-primary)}.wd11-createWizard h3{margin:0 0 5px;font-size:13px}.wd11-createWizard p{margin:0 0 9px;color:var(--dsw-alias-fg-secondary);font-size:10px;line-height:1.55}.wd11-createWizard label{display:grid;gap:5px;color:var(--dsw-alias-fg-secondary);font-size:10px}.wd11-createWizard select{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-primary);font:inherit;font-size:11px}.wd11-createHint{display:block;min-height:30px;margin-top:6px;color:var(--dsw-alias-fg-tertiary);font-size:10px;line-height:1.45}.wd11-createActions{display:flex;gap:6px;margin-top:9px}.wd11-createActions button,.wd11-templateActions button{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-secondary);font:inherit;font-size:11px;cursor:pointer}.wd11-createActions button:first-child,.wd11-templateActions button{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}.wd11-createActions button:disabled,.wd11-templateActions button:disabled{opacity:.5;cursor:default}.wd11-templateActions{flex:none;display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:9px 20px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}.wd11-templateActions>strong{margin-right:2px;color:var(--dsw-alias-fg-secondary);font-size:11px}.wd11-templateActions>span{color:var(--dsw-alias-state-warn-primary);font-size:10px}@media(max-width:1180px){.wd11-templateActions{padding-inline:14px}}`;
    const PROJECT_BATCH5_CSS = `.wd11-cardRecent{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;margin:7px 0 0;color:var(--wt-fg);font-size:10px;line-height:1.45;opacity:.88}.wd11-cardRecent span{color:var(--wt-muted)}.wd11-paneWindowHead>span{display:flex;align-items:center;gap:7px}.wd11-detach{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:3px 6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-secondary);font:inherit;font-size:9px;cursor:pointer}.wd11-terminal{height:100%;display:flex;flex-direction:column;gap:8px}.wd11-terminalNotice{margin:0;padding:8px;border-left:3px solid var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-secondary);font-size:10px;line-height:1.45}.wd11-terminalOutput{min-height:120px;flex:1;overflow:auto;margin:0;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:#07110c;color:#bceccf;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.wd11-terminalStatus{min-height:1.4em;color:var(--dsw-alias-fg-secondary);font-size:10px}.wd11-terminalForm{display:flex;gap:6px}.wd11-terminalForm input{min-width:0;flex:1;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:7px 8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-primary);font:11px ui-monospace,SFMono-Regular,Menlo,monospace}.wd11-terminalForm button,.wd11-terminalActions button{border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:6px 8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-secondary);font:inherit;font-size:10px;cursor:pointer}.wd11-terminalActions{display:flex;gap:6px}`;

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
      tag.textContent = `${SHELL_CSS}${NARROW_SIDEBAR_CSS}${PROJECT_WORKBENCH_CSS}${PROJECT_PANES_CSS}${PROJECT_PREVIEW_CSS}${PROJECT_TEMPLATE_CSS}${PROJECT_CONTAINER_CSS}${PROJECT_CREATE_ACTION_CSS}${PROJECT_BATCH5_CSS}${PROJECT_SWITCH_CSS}${SCRIPT_CSS}${PUBLISH_CSS}${REVIEW_CSS}${SHOOT_CSS}${BROWSER_PROMPTER_CSS}`;
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
      const pathGroups = new Map();
      const claimed = new Set();
      const archived = new Set(workspaces.archivedSessionIds || []);
      for (const workspace of workspaces.items) {
        const workspacePath = normalizeProjectPath(workspace.path);
        const key = workspacePath ? `path:${workspacePath}`
          : `workspace:${String(workspace.workspaceId)}`;
        let project = groups.get(key);
        if (project === undefined) {
          project = {
            key,
            workspaceId: workspace.workspaceId,
            title: workspace.title || projectTitle(workspacePath, '未命名项目'),
            path: workspacePath,
            pathTail: projectPathTail(workspacePath),
            sessions: [],
            sessionIds: [],
            running: false,
            updatedAt: 0,
            representativeId: undefined
          };
          groups.set(key, project);
          if (workspacePath) pathGroups.set(workspacePath, project);
        }
        for (const id of workspace.sessionIds) {
          const session = state.byId[id];
          if (archived.has(id) || session === undefined || session.origin === 'subagent'
              || normalizeProjectPath(session.cwd) !== workspacePath) continue;
          claimed.add(id);
          if (!project.sessionIds.includes(id)) {
            project.sessions.push(session);
            project.sessionIds.push(id);
          }
          project.running ||= session.running === true;
        }
      }
      for (const id of state.ids) {
        const session = state.byId[id];
        if (archived.has(id) || session === undefined
            || session.origin === 'subagent' || claimed.has(id)) continue;
        const normalizedCwd = normalizeProjectPath(session.cwd);
        const sourceKey = normalizedCwd || `session:${String(id)}`;
        const key = `cwd:${sourceKey}`;
        let project = normalizedCwd ? pathGroups.get(normalizedCwd) : groups.get(key);
        if (project === undefined) {
          project = {
            key: normalizedCwd ? `path:${normalizedCwd}` : key,
            title: projectTitle(normalizedCwd, session.displayTitle),
            path: normalizedCwd,
            pathTail: projectPathTail(normalizedCwd),
            sessions: [],
            sessionIds: [],
            running: false,
            updatedAt: 0,
            representativeId: undefined
          };
          groups.set(project.key, project);
          if (normalizedCwd) pathGroups.set(normalizedCwd, project);
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
        canShoot: value.canShoot === true,
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

    function strictOverviewText(value, maximum, nullable = true) {
      if (value === null && nullable) return null;
      if (typeof value !== 'string' || WORKSPACE_TEXT_CONTROL_RE.test(value)) return undefined;
      const clean = value.trim();
      if (!clean || Array.from(clean).length > maximum) return undefined;
      return clean;
    }

    function strictUtf8Text(value, maximum, nullable = true) {
      if (value === null && nullable) return null;
      if (typeof value !== 'string' || CONTROL_RE.test(value)) return undefined;
      const clean = value.trim();
      if (!clean || utf8Bytes(clean) > maximum) return undefined;
      return clean;
    }

    function overviewPageResult(snapshot, expectedContentRef, expectedCursor) {
      const value = snapshot?.state === 'fulfilled' ? snapshot.result : null;
      const keys = [
        'kind', 'contentRef', 'projectToken', 'title', 'stage', 'stageLabel',
        'status', 'updated', 'decision', 'angle', 'hook', 'candidateCount',
        'cursor', 'nextCursor', 'candidates'
      ];
      if (!exact(value, keys) || value.kind !== 'overview'
          || !CONTENT_REF_RE.test(String(value.contentRef || ''))
          || (expectedContentRef && value.contentRef !== expectedContentRef)
          || !PROJECT_TOKEN_RE.test(String(value.projectToken || ''))
          || !(value.stage === null || OVERVIEW_STAGES.has(value.stage))
          || !Number.isSafeInteger(value.candidateCount) || value.candidateCount < 0
          || value.candidateCount > 64
          || !Number.isSafeInteger(value.cursor) || value.cursor !== expectedCursor
          || !(value.nextCursor === null || (Number.isSafeInteger(value.nextCursor)
            && value.nextCursor > value.cursor && value.nextCursor <= value.candidateCount))
          || !Array.isArray(value.candidates) || value.candidates.length > 4
          || value.cursor + value.candidates.length > value.candidateCount) return null;
      const title = strictOverviewText(value.title, 120, false);
      const stageLabel = strictOverviewText(value.stageLabel, 24, false);
      const status = strictOverviewText(value.status, 48);
      const updated = strictOverviewText(value.updated, 64);
      const decision = strictOverviewText(value.decision, 160);
      const angle = strictOverviewText(value.angle, 240);
      const hook = strictOverviewText(value.hook, 240);
      if ([title, stageLabel, status, updated, decision, angle, hook].includes(undefined)) return null;
      const candidates = value.candidates.map((candidate) => {
        if (!exact(candidate, ['field', 'value', 'selected'])
            || !['angle', 'hook'].includes(candidate.field)
            || (candidate.selected !== true && candidate.selected !== false)) return null;
        const text = strictOverviewText(candidate.value, 240, false);
        return text === undefined ? null : Object.freeze({
          field: candidate.field, value: text, selected: candidate.selected
        });
      });
      if (candidates.some((candidate) => candidate === null)
          || new Set(candidates.map((candidate) => `${candidate.field}\u0000${candidate.value}`)).size
            !== candidates.length
          || (value.nextCursor === null
            ? value.cursor + candidates.length !== value.candidateCount
            : value.nextCursor !== value.cursor + candidates.length)) return null;
      return Object.freeze({
        kind: 'overview', contentRef: value.contentRef, projectToken: value.projectToken,
        title, stage: value.stage, stageLabel, status, updated, decision, angle, hook,
        candidateCount: value.candidateCount, cursor: value.cursor,
        nextCursor: value.nextCursor, candidates: Object.freeze(candidates)
      });
    }

    function sameOverviewHeader(left, right) {
      return left && right && [
        'contentRef', 'projectToken', 'title', 'stage', 'stageLabel', 'status',
        'updated', 'decision', 'angle', 'hook', 'candidateCount'
      ].every((key) => Object.is(left[key], right[key]));
    }

    function topicMutationResult(snapshot, expected) {
      const value = snapshot?.state === 'fulfilled' ? snapshot.result : null;
      if (!exact(value, [
        'kind', 'changed', 'contentRef', 'projectToken', 'field',
        'value', 'updated', 'message'
      ]) || value.kind !== 'mutation' || value.changed !== true
          || value.contentRef !== expected.contentRef
          || !CONTENT_REF_RE.test(String(value.contentRef || ''))
          || !PROJECT_TOKEN_RE.test(String(value.projectToken || ''))
          || value.projectToken === expected.projectToken
          || value.field !== expected.field || value.value !== expected.value) return null;
      const updated = strictOverviewText(value.updated, 64, false);
      const message = strictOverviewText(value.message, 160, false);
      return updated === undefined || message === undefined ? null : Object.freeze({
        kind: 'mutation', changed: true, contentRef: value.contentRef,
        projectToken: value.projectToken, field: value.field, value: value.value,
        updated, message
      });
    }

    function publishChecklist(value) {
      if (!exact(value, [
        'structureValid', 'ready', 'published', 'aiDisclosure', 'lights'
      ]) || typeof value.structureValid !== 'boolean'
          || typeof value.ready !== 'boolean' || typeof value.published !== 'boolean'
          || !AI_DISCLOSURES.some(([id]) => id === value.aiDisclosure)
          || !Array.isArray(value.lights) || value.lights.length !== PUBLISH_LIGHTS.length) return null;
      const lights = value.lights.map((light, index) => {
        const expected = PUBLISH_LIGHTS[index];
        if (!exact(light, ['id', 'label', 'available', 'checked', 'satisfied'])
            || light.id !== expected[0] || light.label !== expected[1]
            || typeof light.available !== 'boolean' || typeof light.checked !== 'boolean'
            || typeof light.satisfied !== 'boolean') return null;
        return Object.freeze({ ...light });
      });
      if (lights.some((light) => light === null)) return null;
      if (lights.slice(0, 5).some((light) => (
        light.satisfied !== (light.available && light.checked)
      ))) return null;
      const aiSatisfied = value.aiDisclosure === 'not-ai'
        || value.aiDisclosure === 'ai' && lights[5].available && lights[5].checked;
      const ready = value.structureValid
        && lights.slice(0, 5).every((light) => light.satisfied) && aiSatisfied;
      const published = value.structureValid && ready
        && lights[6].available && lights[6].checked;
      if (value.structureValid && lights.some((light) => !light.available)
          || lights[5].satisfied !== aiSatisfied || value.ready !== ready
          || lights[6].satisfied !== published || value.published !== published) return null;
      return Object.freeze({
        structureValid: value.structureValid, ready: value.ready,
        published: value.published, aiDisclosure: value.aiDisclosure,
        lights: Object.freeze(lights)
      });
    }

    function publishSurface(value, expected = null) {
      if (!exact(value, [
        'kind', 'contentRef', 'projectToken', 'title', 'stage', 'stageLabel',
        'updated', 'canCreate', 'checklist'
      ]) || value.kind !== 'publish'
          || !CONTENT_REF_RE.test(String(value.contentRef || ''))
          || expected !== null && value.contentRef !== expected.contentRef
          || !PROJECT_TOKEN_RE.test(String(value.projectToken || ''))
          || expected !== null && value.projectToken !== expected.projectToken
          || !(value.stage === null || OVERVIEW_STAGES.has(value.stage))
          || typeof value.canCreate !== 'boolean') return null;
      const title = strictOverviewText(value.title, 120, false);
      const stageLabel = strictOverviewText(value.stageLabel, 24, false);
      const updated = strictOverviewText(value.updated, 64);
      if ([title, stageLabel, updated].includes(undefined)) return null;
      const checklist = value.checklist === null ? null : publishChecklist(value.checklist);
      if (value.checklist !== null && checklist === null) return null;
      const canCreate = value.stage !== null && PUBLISH_CREATABLE_STAGES.has(value.stage);
      if (value.canCreate !== canCreate
          || (value.stage === 'publish') !== (checklist !== null)) return null;
      return Object.freeze({
        kind: 'publish', contentRef: value.contentRef, projectToken: value.projectToken,
        title, stage: value.stage, stageLabel, updated,
        canCreate: value.canCreate, checklist
      });
    }

    function publishReadResult(snapshot, expected) {
      const value = snapshot?.state === 'fulfilled' ? snapshot.result : null;
      return publishSurface(value, expected);
    }

    function publishCreateResult(snapshot, expected) {
      const value = snapshot?.state === 'fulfilled' ? snapshot.result : null;
      if (!exact(value, [
        'kind', 'created', 'sourceContentRef', 'sourceProjectToken', 'surface', 'message'
      ]) || value.kind !== 'publish-create' || typeof value.created !== 'boolean'
          || value.sourceContentRef !== expected.contentRef
          || value.sourceProjectToken !== expected.projectToken) return null;
      const surface = publishSurface(value.surface);
      const message = strictOverviewText(value.message, 160, false);
      if (!surface || message === undefined || surface.stage !== 'publish'
          || surface.checklist === null || surface.canCreate
          || surface.contentRef === expected.contentRef) return null;
      return Object.freeze({
        kind: 'publish-create', created: value.created,
        sourceContentRef: value.sourceContentRef,
        sourceProjectToken: value.sourceProjectToken, surface, message
      });
    }

    function publishMutationResult(snapshot, expected) {
      const value = snapshot?.state === 'fulfilled' ? snapshot.result : null;
      if (!exact(value, ['kind', 'changed', 'surface', 'message'])
          || value.kind !== 'publish-mutation' || value.changed !== true) return null;
      const surface = publishSurface(value.surface);
      const message = strictOverviewText(value.message, 160, false);
      if (!surface || message === undefined || surface.stage !== 'publish'
          || surface.checklist === null || surface.contentRef !== expected.contentRef
          || surface.projectToken === expected.projectToken) return null;
      return Object.freeze({ kind: 'publish-mutation', changed: true, surface, message });
    }

    function documentPageResult(snapshot, expectedProjectToken, expectedCursor) {
      const value = snapshot?.state === 'fulfilled' ? snapshot.result : null;
      if (!exact(value, [
        'kind', 'projectToken', 'title', 'stage', 'stageLabel', 'blockCount',
        'cursor', 'nextCursor', 'truncated', 'blocks'
      ]) || value.kind !== 'document' || value.projectToken !== expectedProjectToken
          || !PROJECT_TOKEN_RE.test(String(value.projectToken || ''))
          || !(value.stage === null || OVERVIEW_STAGES.has(value.stage))
          || !Number.isSafeInteger(value.blockCount) || value.blockCount < 0
          || value.blockCount > 4096
          || !Number.isSafeInteger(value.cursor) || value.cursor !== expectedCursor
          || !(value.nextCursor === null || (Number.isSafeInteger(value.nextCursor)
            && value.nextCursor > value.cursor && value.nextCursor <= value.blockCount))
          || typeof value.truncated !== 'boolean'
          || !Array.isArray(value.blocks) || value.blocks.length > 2
          || value.cursor + value.blocks.length > value.blockCount) return null;
      const title = strictOverviewText(value.title, 120, false);
      const stageLabel = strictOverviewText(value.stageLabel, 24, false);
      if (title === undefined || stageLabel === undefined) return null;
      const blocks = value.blocks.map((block) => {
        if (!exact(block, [
          'blockToken', 'kind', 'text', 'textTruncated', 'startLine', 'endLine'
        ]) || !BLOCK_TOKEN_RE.test(String(block.blockToken || ''))
            || typeof block.kind !== 'string' || !/^[a-z][a-z-]{0,31}$/.test(block.kind)
            || typeof block.text !== 'string' || utf8Bytes(block.text) > 2048
            || WORKSPACE_TEXT_CONTROL_RE.test(block.text)
            || typeof block.textTruncated !== 'boolean'
            || !Number.isSafeInteger(block.startLine) || block.startLine < 1
            || !Number.isSafeInteger(block.endLine) || block.endLine < block.startLine) return null;
        return Object.freeze({ ...block });
      });
      if (blocks.some((block) => block === null)
          || new Set(blocks.map((block) => block.blockToken)).size !== blocks.length
          || (value.nextCursor === null
            ? value.cursor + blocks.length !== value.blockCount
            : value.nextCursor !== value.cursor + blocks.length)) return null;
      return Object.freeze({
        kind: 'document', projectToken: value.projectToken, title,
        stage: value.stage, stageLabel, blockCount: value.blockCount,
        cursor: value.cursor, nextCursor: value.nextCursor,
        truncated: value.truncated, blocks: Object.freeze(blocks)
      });
    }

    function sameDocumentHeader(left, right) {
      return left && right && [
        'projectToken', 'title', 'stage', 'stageLabel', 'blockCount'
      ].every((key) => Object.is(left[key], right[key]));
    }

    function shootOpenResult(snapshot, expected) {
      const value = snapshot?.state === 'fulfilled' ? snapshot.result : null;
      if (!exact(value, [
        'kind', 'contentRef', 'projectToken', 'state', 'message'
      ]) || value.kind !== 'shoot-open'
          || value.contentRef !== expected.contentRef
          || value.projectToken !== expected.projectToken
          || !CONTENT_REF_RE.test(String(value.contentRef || ''))
          || !PROJECT_TOKEN_RE.test(String(value.projectToken || ''))
          || !['opened', 'focused', 'busy', 'unavailable'].includes(value.state)) return null;
      const message = strictUtf8Text(value.message, 240, false);
      return message === undefined ? null : Object.freeze({
        kind: 'shoot-open', contentRef: value.contentRef,
        projectToken: value.projectToken, state: value.state, message
      });
    }

    function shootHistoryRecord(value) {
      if (!exact(value, [
        'recordRef', 'title', 'confirmedCount', 'totalShots',
        'missingCount', 'retakeCount', 'allConfirmed'
      ]) || !RECORD_REF_RE.test(String(value.recordRef || ''))
          || !Number.isSafeInteger(value.confirmedCount) || value.confirmedCount < 0
          || !Number.isSafeInteger(value.totalShots) || value.totalShots < 1
          || value.totalShots > 200 || value.confirmedCount > value.totalShots
          || !Number.isSafeInteger(value.missingCount) || value.missingCount < 0
          || value.missingCount > value.totalShots
          || value.confirmedCount + value.missingCount !== value.totalShots
          || !Number.isSafeInteger(value.retakeCount) || value.retakeCount < 0
          || value.retakeCount > 1_000_000_000
          || typeof value.allConfirmed !== 'boolean'
          || value.allConfirmed !== (value.missingCount === 0)) return null;
      const title = strictUtf8Text(value.title, 120, false);
      return title === undefined ? null : Object.freeze({
        recordRef: value.recordRef, title,
        confirmedCount: value.confirmedCount, totalShots: value.totalShots,
        missingCount: value.missingCount, retakeCount: value.retakeCount,
        allConfirmed: value.allConfirmed
      });
    }

    function shootHistoryPageResult(snapshot, expected) {
      const value = snapshot?.state === 'fulfilled' ? snapshot.result : null;
      if (!exact(value, [
        'kind', 'contentRef', 'projectToken', 'collectionToken', 'itemCount',
        'complete', 'cursor', 'nextCursor', 'records'
      ]) || value.kind !== 'shoot-history'
          || value.contentRef !== expected.contentRef
          || value.projectToken !== expected.projectToken
          || !CONTENT_REF_RE.test(String(value.contentRef || ''))
          || !PROJECT_TOKEN_RE.test(String(value.projectToken || ''))
          || !COLLECTION_TOKEN_RE.test(String(value.collectionToken || ''))
          || expected.collectionToken !== null
            && value.collectionToken !== expected.collectionToken
          || !Number.isSafeInteger(value.itemCount) || value.itemCount < 0
          || value.itemCount > MAX_SHOOT_HISTORY_PAGES * 4
          || typeof value.complete !== 'boolean'
          || !Number.isSafeInteger(value.cursor) || value.cursor !== expected.cursor
          || !(value.nextCursor === null || Number.isSafeInteger(value.nextCursor))
          || !Array.isArray(value.records) || value.records.length > 4
          || value.cursor + value.records.length > value.itemCount) return null;
      const records = value.records.map(shootHistoryRecord);
      const endCursor = value.cursor + records.length;
      if (records.some((record) => record === null)
          || new Set(records.map((record) => record.recordRef)).size !== records.length
          || (value.nextCursor === null
            ? endCursor !== value.itemCount
            : value.nextCursor !== endCursor || value.nextCursor <= value.cursor
              || value.nextCursor >= value.itemCount)) return null;
      return Object.freeze({
        kind: 'shoot-history', contentRef: value.contentRef,
        projectToken: value.projectToken, collectionToken: value.collectionToken,
        itemCount: value.itemCount, complete: value.complete,
        cursor: value.cursor, nextCursor: value.nextCursor,
        records: Object.freeze(records)
      });
    }

    function sameShootHistoryHeader(left, right) {
      return left && right && [
        'contentRef', 'projectToken', 'collectionToken', 'itemCount', 'complete'
      ].every((key) => Object.is(left[key], right[key]));
    }

    function tacticSurface(value) {
      if (!exact(value, [
        'contentRef', 'projectToken', 'title', 'summary', 'summaryTruncated',
        'sourceTitle', 'updated'
      ]) || !CONTENT_REF_RE.test(String(value.contentRef || ''))
          || !PROJECT_TOKEN_RE.test(String(value.projectToken || ''))
          || typeof value.summaryTruncated !== 'boolean'
          || CONTROL_RE.test(String(value.title || ''))
          || (value.sourceTitle !== null && CONTROL_RE.test(String(value.sourceTitle || '')))
          || (value.updated !== null && (CONTROL_RE.test(String(value.updated || ''))
            || String(value.updated).length > 64))) return null;
      const title = strictOverviewText(value.title, 120, false);
      const summary = strictUtf8Text(value.summary, 240);
      const sourceTitle = strictOverviewText(value.sourceTitle, 120);
      const updated = strictOverviewText(value.updated, 64);
      if ([title, summary, sourceTitle, updated].includes(undefined)
          || summary === null && value.summaryTruncated) return null;
      return Object.freeze({
        contentRef: value.contentRef, projectToken: value.projectToken,
        title, summary, summaryTruncated: value.summaryTruncated, sourceTitle, updated
      });
    }

    function tacticsPageResult(snapshot, expected) {
      const value = snapshot?.state === 'fulfilled' ? snapshot.result : null;
      if (!exact(value, [
        'kind', 'contentRef', 'projectToken', 'collectionToken', 'itemCount',
        'complete', 'cursor', 'nextCursor', 'tactics'
      ]) || value.kind !== 'tactics'
          || value.contentRef !== expected.contentRef
          || value.projectToken !== expected.projectToken
          || !CONTENT_REF_RE.test(String(value.contentRef || ''))
          || !PROJECT_TOKEN_RE.test(String(value.projectToken || ''))
          || !COLLECTION_TOKEN_RE.test(String(value.collectionToken || ''))
          || (expected.collectionToken !== null
            && value.collectionToken !== expected.collectionToken)
          || !Number.isSafeInteger(value.itemCount) || value.itemCount < 0
          || value.itemCount > 512 || typeof value.complete !== 'boolean'
          || !Number.isSafeInteger(value.cursor) || value.cursor !== expected.cursor
          || !(value.nextCursor === null || Number.isSafeInteger(value.nextCursor))
          || !Array.isArray(value.tactics) || value.tactics.length > 4
          || value.cursor + value.tactics.length > value.itemCount) return null;
      const tactics = value.tactics.map(tacticSurface);
      const endCursor = value.cursor + tactics.length;
      if (tactics.some((tactic) => tactic === null)
          || new Set(tactics.map((tactic) => tactic.contentRef)).size !== tactics.length
          || new Set(tactics.map((tactic) => tactic.projectToken)).size !== tactics.length
          || (value.nextCursor === null
            ? endCursor !== value.itemCount
            : value.nextCursor !== endCursor || value.nextCursor <= value.cursor
              || value.nextCursor >= value.itemCount)) return null;
      return Object.freeze({
        kind: 'tactics', contentRef: value.contentRef, projectToken: value.projectToken,
        collectionToken: value.collectionToken, itemCount: value.itemCount,
        complete: value.complete, cursor: value.cursor, nextCursor: value.nextCursor,
        tactics: Object.freeze(tactics)
      });
    }

    function sameTacticsHeader(left, right) {
      return left && right && [
        'contentRef', 'projectToken', 'collectionToken', 'itemCount', 'complete'
      ].every((key) => Object.is(left[key], right[key]));
    }

    function reviewSolidifyResult(snapshot, expected) {
      const value = snapshot?.state === 'fulfilled' ? snapshot.result : null;
      if (!exact(value, [
        'kind', 'created', 'sourceContentRef', 'sourceProjectToken', 'tactic', 'message'
      ]) || value.kind !== 'review-solidify' || typeof value.created !== 'boolean'
          || value.sourceContentRef !== expected.contentRef
          || value.sourceProjectToken !== expected.projectToken) return null;
      const tactic = tacticSurface(value.tactic);
      const message = strictUtf8Text(value.message, 240, false);
      if (!tactic || message === undefined
          || tactic.contentRef === expected.contentRef
          || tactic.projectToken === expected.projectToken) return null;
      return Object.freeze({
        kind: 'review-solidify', created: value.created,
        sourceContentRef: value.sourceContentRef,
        sourceProjectToken: value.sourceProjectToken, tactic, message
      });
    }

    function strictProposalBlock(value, nullable = true) {
      if (value === null && nullable) return null;
      if (typeof value !== 'string' || utf8Bytes(value) > 1600
          || WORKSPACE_TEXT_CONTROL_RE.test(value)) return undefined;
      return value;
    }

    function proposalResult(snapshot, expectedContentRef) {
      const value = snapshot?.state === 'fulfilled' ? snapshot.result : null;
      const keys = [
        'kind', 'contentRef', 'projectToken', 'status', 'reason', 'proposalToken',
        'proposalRevisionToken', 'revisionToken', 'title', 'intentLabel',
        'before', 'beforeTruncated', 'after', 'afterTruncated', 'canAdopt',
        'canReject', 'canUndo', 'submitted', 'target'
      ];
      if (!exact(value, keys)
          || value.kind !== 'proposal' || value.contentRef !== expectedContentRef
          || !CONTENT_REF_RE.test(String(value.contentRef || ''))
          || !PROJECT_TOKEN_RE.test(String(value.projectToken || ''))
          || !(value.status === null || [
            'queued', 'unchanged', 'ready', 'stale', 'invalid', 'adopted', 'conflict'
          ].includes(value.status))
          || !(value.reason === null || [
            'target-unchanged', 'original-changed', 'outside-target-changed',
            'proposal-too-large', 'read-failed', 'adopted-file-changed'
          ].includes(value.reason))
          || typeof value.beforeTruncated !== 'boolean'
          || typeof value.afterTruncated !== 'boolean'
          || typeof value.canAdopt !== 'boolean' || typeof value.canReject !== 'boolean'
          || typeof value.canUndo !== 'boolean'
          || !(value.submitted === null || [
            'sending', 'accepted', 'rejected', 'unknown', 'error'
          ].includes(value.submitted))) return null;
      const title = strictOverviewText(value.title, 120);
      const intentLabel = strictOverviewText(value.intentLabel, 64);
      const before = strictProposalBlock(value.before);
      const after = strictProposalBlock(value.after);
      const target = strictOverviewText(value.target, 120);
      const proposalToken = value.proposalToken;
      const proposalRevisionToken = value.proposalRevisionToken;
      const revisionToken = value.revisionToken;
      if ([title, intentLabel, before, after, target].includes(undefined)
          || !(proposalToken === null || PROPOSAL_TOKEN_RE.test(String(proposalToken)))
          || !(proposalRevisionToken === null
            || PROPOSAL_REVISION_TOKEN_RE.test(String(proposalRevisionToken)))
          || !(revisionToken === null || REVISION_TOKEN_RE.test(String(revisionToken)))) return null;
      if (value.status === null && [proposalToken, proposalRevisionToken, revisionToken,
        title, intentLabel, before, after, value.reason, value.submitted, target]
        .some((item) => item !== null)) return null;
      if (value.status === null && (value.beforeTruncated || value.afterTruncated
          || value.canAdopt || value.canReject || value.canUndo)) return null;
      if (['adopted', 'conflict'].includes(value.status)) {
        if (proposalToken !== null || proposalRevisionToken !== null || !revisionToken
            || value.canAdopt || value.canReject
            || value.canUndo !== (value.status === 'adopted')) return null;
      } else if (value.status !== null) {
        if (!proposalToken || revisionToken !== null || value.canUndo
            || value.canReject !== true) return null;
        if (value.status === 'ready') {
          const comparisonTruncated = value.beforeTruncated || value.afterTruncated;
          if (comparisonTruncated
            ? (value.canAdopt || proposalRevisionToken !== null)
            : (!value.canAdopt || !proposalRevisionToken)) return null;
        } else if (value.canAdopt || proposalRevisionToken !== null) return null;
      }
      if ((before === null && value.beforeTruncated)
          || (after === null && value.afterTruncated)) return null;
      return Object.freeze({
        kind: 'proposal', contentRef: value.contentRef, projectToken: value.projectToken,
        status: value.status, reason: value.reason, proposalToken,
        proposalRevisionToken, revisionToken, title, intentLabel, before,
        beforeTruncated: value.beforeTruncated, after,
        afterTruncated: value.afterTruncated, canAdopt: value.canAdopt,
        canReject: value.canReject, canUndo: value.canUndo,
        submitted: value.submitted, target
      });
    }

    function proposalDecisionResult(snapshot, expected) {
      const value = snapshot?.state === 'fulfilled' ? snapshot.result : null;
      if (!exact(value, [
        'kind', 'contentRef', 'projectToken', 'decision', 'changed',
        'revisionToken', 'message'
      ]) || value.kind !== 'decision' || value.decision !== expected.decision
          || value.contentRef !== expected.contentRef
          || !CONTENT_REF_RE.test(String(value.contentRef || ''))
          || !PROJECT_TOKEN_RE.test(String(value.projectToken || ''))
          || typeof value.changed !== 'boolean'
          || !(value.revisionToken === null
            || REVISION_TOKEN_RE.test(String(value.revisionToken)))) return null;
      const message = strictOverviewText(value.message, 160, false);
      if (message === undefined) return null;
      if (expected.decision === 'adopt' && (value.changed !== true
          || !value.revisionToken || value.projectToken === expected.projectToken)) return null;
      if (expected.decision === 'reject' && (value.changed !== false
          || value.revisionToken !== null)) return null;
      return Object.freeze({ ...value, message });
    }

    function proposalUndoResult(snapshot, expected) {
      const value = snapshot?.state === 'fulfilled' ? snapshot.result : null;
      if (!exact(value, [
        'kind', 'contentRef', 'projectToken', 'changed', 'message'
      ]) || value.kind !== 'undo' || value.changed !== true
          || value.contentRef !== expected.contentRef
          || !CONTENT_REF_RE.test(String(value.contentRef || ''))
          || !PROJECT_TOKEN_RE.test(String(value.projectToken || ''))
          || value.projectToken === expected.projectToken) return null;
      const message = strictOverviewText(value.message, 160, false);
      return message === undefined ? null : Object.freeze({ ...value, message });
    }

    function blockPreflightResult(snapshot, expected) {
      const value = snapshot?.state === 'fulfilled' ? snapshot.result : null;
      if (!exact(value, [
        'kind', 'contentRef', 'projectToken', 'blockToken', 'action', 'state',
        'preflightToken', 'targetLabel', 'workspaceLabel', 'workspaceMatch',
        'targetRunning', 'eventTracking', 'expiresAt', 'message'
      ]) || value.kind !== 'preflight' || value.contentRef !== expected.contentRef
          || value.projectToken !== expected.projectToken
          || value.blockToken !== expected.blockToken || value.action !== expected.action
          || !['ready', 'error'].includes(value.state)
          || !(value.preflightToken === null
            || OPAQUE_VALUE_RE.test(String(value.preflightToken)))
          || !(value.workspaceMatch === null
            || ['match', 'mismatch', 'unknown'].includes(value.workspaceMatch))
          || !(value.targetRunning === null || typeof value.targetRunning === 'boolean')
          || !(value.eventTracking === null
            || ['ready', 'unavailable'].includes(value.eventTracking))) return null;
      const targetLabel = strictOverviewText(value.targetLabel, 120);
      const workspaceLabel = strictOverviewText(value.workspaceLabel, 120);
      const expiresAt = strictOverviewText(value.expiresAt, 64);
      const message = strictOverviewText(value.message, 160);
      if ([targetLabel, workspaceLabel, expiresAt, message].includes(undefined)) return null;
      if (value.state === 'ready') {
        const expiresMs = Date.parse(expiresAt);
        if (!value.preflightToken || !targetLabel || !workspaceLabel || !value.workspaceMatch
            || value.targetRunning === null || !value.eventTracking
            || !Number.isFinite(expiresMs) || message !== null) return null;
      } else if (message === null) return null;
      return Object.freeze({ ...value, targetLabel, workspaceLabel, expiresAt, message });
    }

    function blockSubmissionResult(snapshot, expected) {
      const value = snapshot?.state === 'fulfilled' ? snapshot.result : null;
      if (!exact(value, [
        'kind', 'contentRef', 'projectToken', 'blockToken', 'action', 'state',
        'reason', 'target', 'receiptId', 'message'
      ]) || value.kind !== 'submission' || value.contentRef !== expected.contentRef
          || value.projectToken !== expected.projectToken
          || value.blockToken !== expected.blockToken || value.action !== expected.action
          || !['accepted', 'rejected', 'unknown', 'error'].includes(value.state)
          || !(value.receiptId === null || OPAQUE_VALUE_RE.test(String(value.receiptId)))) return null;
      const reason = strictOverviewText(value.reason, 80);
      const target = strictOverviewText(value.target, 120);
      const message = strictOverviewText(value.message, 160);
      if ([reason, target, message].includes(undefined)) return null;
      if (value.state === 'error') {
        if (reason !== null || target !== null || value.receiptId !== null
            || message === null) return null;
      } else if (!reason || !/^[a-z][a-z0-9-]{0,63}$/.test(reason)
          || !target || message !== null) return null;
      return Object.freeze({ ...value, reason, target, message });
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
      if (snapshot?.code === 'outcome-unknown') return '操作结果未知；请先核对右栏和任务状态，不要重复点击。';
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

    function CreatorSidebar({ workspace, catalog, selectedToken, onSelect, onRefresh, onLoadMore }) {
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
            react_jsx_runtime.jsx('div', { className: 'wd10-eyebrow', children: '创作文件' }),
            react_jsx_runtime.jsx('h2', { children: '第1步 选择内容' }),
            workspace && react_jsx_runtime.jsx('p', { children: `当前工作区：${workspace.title}` }),
            react_jsx_runtime.jsx('p', { role: 'status', children: catalog.status === 'stale'
              ? `${copy} 自动刷新失败，以下是上次成功结果。` : copy }),
            react_jsx_runtime.jsx('button', { type: 'button', className: 'wd10-refresh',
              disabled: catalog.status === 'loading', onClick: onRefresh,
              children: catalog.status === 'loading' ? '正在刷新…' : '刷新内容' })
          ]
        }), workspace && react_jsx_runtime.jsxs('div', {
          className: 'wd10-workspaceList', children: [
            react_jsx_runtime.jsx('div', { className: 'wd10-eyebrow', children: '当前内容文件夹' }),
            react_jsx_runtime.jsx('span', { className: 'wd10-projectTitle', children: workspace.title }),
            react_jsx_runtime.jsx('span', { className: 'wd10-projectPath', children: workspace.pathTail })
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
      feedback, onConfirm, onAlignThenRetry, onCancel, refreshKey, onCatalogRefresh,
      preflightRemaining }) {
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
        : '右边的对话不在这条内容的文件夹里';
      return react_jsx_runtime.jsxs('section', {
        className: 'wd10-receipts', 'aria-label': '任务状态', children: [
          react_jsx_runtime.jsxs('div', { className: 'wd10-receiptTitle', children: [
            react_jsx_runtime.jsx('strong', { children: '任务状态' }),
            react_jsx_runtime.jsx('span', { children: '工作台交给右侧 AI 的进度与结果会回到这里' })
          ] }),
          preflight && react_jsx_runtime.jsxs('div', {
            className: 'wd10-receipt wd10-preflight', children: [
              react_jsx_runtime.jsxs('div', { className: 'wd10-receiptHead', children: [
                react_jsx_runtime.jsx('strong', { children: `将发往 ${preflight.targetLabel}` }),
                react_jsx_runtime.jsx('span', { children: matchText })
              ] }),
              react_jsx_runtime.jsx('p', { children:
                `${preflight.workspaceLabel} · ${preflight.targetRunning ? '会话正在运行' : '会话当前未运行'} · ${preflight.eventTracking === 'ready' ? '事件回执已接通' : '事件回执未接通'} · ${preflightRemaining ?? 0} 秒后过期` }),
              preflight.workspaceMatch === 'match'
                ? react_jsx_runtime.jsxs('div', { className: 'wd10-receiptFoot', children: [
                  react_jsx_runtime.jsx('button', { type: 'button', disabled: pending,
                    onClick: onCancel, children: '取消' }),
                  react_jsx_runtime.jsx('button', { type: 'button', disabled: pending,
                    onClick: onConfirm, children: pending ? '正在提交…' : '确认发送' })
                ] })
                : react_jsx_runtime.jsxs('div', { className: 'wd10-receiptFoot', children: [
                  react_jsx_runtime.jsx('button', { type: 'button', disabled: pending,
                    onClick: onAlignThenRetry,
                    children: pending ? '正在回到这条内容的对话…' : '先回到这条内容的对话再发' }),
                  react_jsx_runtime.jsx('button', { type: 'button', disabled: pending,
                    onClick: onConfirm, children: pending ? '正在提交…' : '仍然发到现在的对话' }),
                  react_jsx_runtime.jsx('button', { type: 'button', disabled: pending,
                    onClick: onCancel, children: '取消' })
                ] })
            ]
          }),
          receiptState.status === 'loading' && react_jsx_runtime.jsx('p', {
            className: 'wd10-feedback', children: '正在读取任务状态…'
          }),
          receiptState.status === 'error' && react_jsx_runtime.jsx('p', {
            className: 'wd10-feedback', children: '任务状态暂时不可用；没有推断当前进度。'
          }),
          receiptState.status === 'stale' && react_jsx_runtime.jsx('p', {
            className: 'wd10-feedback', children: '任务状态刷新失败；以下保留上次成功结果，不代表当前状态。'
          }),
          receiptState.status === 'ready' && receiptState.receipts.length === 0
            && react_jsx_runtime.jsx('p', { className: 'wd10-feedback', children: '还没有任务状态。' }),
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

    function OverviewPanel({ project, workspaceFiles, actions, actionPending,
      onAction, onMutation }) {
      const [surface, setSurface] = react.useState({ status: 'idle', overview: null });
      const [choiceFeedback, setChoiceFeedback] = react.useState('');
      const [choosing, setChoosing] = react.useState(false);
      const readAttempt = react.useRef(0);
      const readAbort = react.useRef(null);
      const choiceAttempt = react.useRef(0);
      const choiceAbort = react.useRef(null);
      const choosingRef = react.useRef(false);

      react.useEffect(() => {
        const attempt = ++readAttempt.current;
        readAbort.current?.abort();
        const controller = new AbortController();
        readAbort.current = controller;
        choiceAttempt.current += 1;
        choiceAbort.current?.abort();
        choiceAbort.current = null;
        choosingRef.current = false;
        setChoosing(false);
        setChoiceFeedback('');
        setSurface({ status: project ? 'loading' : 'idle', overview: null });
        if (!project || !workspaceFiles || typeof workspaceFiles.execute !== 'function') {
          if (project) setSurface({ status: 'error', overview: null });
          return () => controller.abort();
        }
        const read = async () => {
          let cursor = 0;
          let first = null;
          const candidates = [];
          const seen = new Set();
          let complete = false;
          let failed = false;
          for (let pageIndex = 0; pageIndex < 16; pageIndex += 1) {
            let page = null;
            try {
              page = overviewPageResult(await workspaceFiles.execute('overview.read', {
                projectToken: project.projectToken, cursor, limit: 4
              }, controller.signal), project.contentRef, cursor);
            } catch (_error) { page = null; }
            if (controller.signal.aborted || readAttempt.current !== attempt) return;
            if (!page || (first && !sameOverviewHeader(first, page))) {
              failed = true;
              break;
            }
            first ||= page;
            let duplicate = false;
            for (const candidate of page.candidates) {
              const key = `${candidate.field}\u0000${candidate.value}`;
              if (seen.has(key)) { duplicate = true; break; }
              seen.add(key);
              candidates.push(candidate);
            }
            if (duplicate) { failed = true; break; }
            if (page.nextCursor === null) { complete = true; break; }
            cursor = page.nextCursor;
          }
          if (controller.signal.aborted || readAttempt.current !== attempt) return;
          if (!first) {
            setSurface({ status: 'error', overview: null });
            return;
          }
          const overview = Object.freeze({ ...first, candidates: Object.freeze(candidates) });
          setSurface({ status: complete && !failed ? 'ready' : 'partial', overview });
        };
        void read();
        return () => {
          controller.abort();
          if (readAbort.current === controller) readAbort.current = null;
        };
      }, [project?.contentRef, project?.projectToken, workspaceFiles]);

      react.useEffect(() => () => {
        choiceAttempt.current += 1;
        choiceAbort.current?.abort();
        choiceAbort.current = null;
        choosingRef.current = false;
      }, []);

      const choose = async (candidate) => {
        const overview = surface.overview;
        if (!overview || choosingRef.current || candidate.selected) return;
        choosingRef.current = true;
        setChoosing(true);
        setChoiceFeedback(`正在把${candidate.field === 'angle' ? '角度' : '钩子'}写回项目文件…`);
        const controller = new AbortController();
        choiceAbort.current = controller;
        const attempt = ++choiceAttempt.current;
        try {
          const snapshot = await workspaceFiles.execute('topic.choose', {
            projectToken: overview.projectToken,
            field: candidate.field,
            value: candidate.value
          }, controller.signal);
          if (choiceAttempt.current !== attempt || controller.signal.aborted) return;
          const mutation = topicMutationResult(snapshot, {
            contentRef: overview.contentRef,
            projectToken: overview.projectToken,
            field: candidate.field,
            value: candidate.value
          });
          if (!mutation) {
            setChoiceFeedback(operationError(snapshot, '写回结果无效；请刷新后核对项目文件。'));
            return;
          }
          setSurface((current) => {
            if (!current.overview || current.overview.contentRef !== mutation.contentRef) return current;
            return { ...current, overview: Object.freeze({
              ...current.overview,
              projectToken: mutation.projectToken,
              updated: mutation.updated,
              [mutation.field]: mutation.value,
              candidates: Object.freeze(current.overview.candidates.map((item) => Object.freeze({
                ...item,
                selected: item.field === mutation.field
                  ? item.value === mutation.value : item.selected
              })))
            }) };
          });
          setChoiceFeedback(mutation.message);
          onMutation?.(mutation);
        } catch (_error) {
          if (choiceAttempt.current === attempt && !controller.signal.aborted) {
            setChoiceFeedback('写回结果未知；请刷新后核对项目文件，不要重复点击。');
          }
        } finally {
          if (choiceAbort.current === controller) choiceAbort.current = null;
          if (choiceAttempt.current === attempt) {
            choosingRef.current = false;
            setChoosing(false);
          }
        }
      };

      if (surface.status === 'idle') return react_jsx_runtime.jsx('section', {
        className: 'wd10-card', children: react_jsx_runtime.jsx('p', {
          children: '请从左侧选择一张真实内容卡。'
        })
      });
      if (surface.status === 'loading') return react_jsx_runtime.jsx('section', {
        className: 'wd10-card', children: react_jsx_runtime.jsx('p', {
          children: '正在读取选题与状态…'
        })
      });
      if (surface.status === 'error' || !surface.overview) {
        return react_jsx_runtime.jsx('section', { className: 'wd10-card', children:
          react_jsx_runtime.jsx('p', { role: 'status', children:
            '概览暂时读不到；没有用内容卡摘要冒充文件详情。' }) });
      }
      const overview = surface.overview;
      const angles = overview.candidates.filter((candidate) => candidate.field === 'angle');
      const hooks = overview.candidates.filter((candidate) => candidate.field === 'hook');
      const choiceGroup = (label, emptyCopy, candidates) => react_jsx_runtime.jsxs('div', {
        className: 'wd10-choiceGroup', children: [
          react_jsx_runtime.jsx('h4', { children: label }),
          candidates.length > 0 ? react_jsx_runtime.jsx('div', {
            className: 'wd10-choiceList', children: candidates.map((candidate) => (
              react_jsx_runtime.jsx('button', {
                type: 'button', className: 'wd10-choice',
                'aria-pressed': candidate.selected,
                disabled: choosing || candidate.selected,
                onClick: () => { void choose(candidate); },
                children: candidate.value
              }, `${candidate.field}:${candidate.value}`)
            ))
          }) : react_jsx_runtime.jsx('p', { children: emptyCopy })
        ]
      });
      return react_jsx_runtime.jsxs('section', {
        className: 'wd10-card wd10-overview', 'data-whaledock-overview': true, children: [
          react_jsx_runtime.jsx('h3', { children: '选题拍板' }),
          react_jsx_runtime.jsx('p', { children: overview.decision
            ? `待拍板：${overview.decision}` : '角度与钩子都直接来自当前项目文件。' }),
          react_jsx_runtime.jsxs('div', { className: 'wd10-overviewMeta', children: [
            react_jsx_runtime.jsxs('div', { children: [
              react_jsx_runtime.jsx('span', { children: '当前状态' }),
              react_jsx_runtime.jsx('strong', { children: overview.status || overview.stageLabel })
            ] }),
            react_jsx_runtime.jsxs('div', { children: [
              react_jsx_runtime.jsx('span', { children: '文件更新' }),
              react_jsx_runtime.jsx('strong', { children: overview.updated || '未写明' })
            ] })
          ] }),
          react_jsx_runtime.jsxs('div', { className: 'wd10-currentChoices', children: [
            react_jsx_runtime.jsxs('div', { className: 'wd10-currentChoice', children: [
              react_jsx_runtime.jsx('span', { children: '当前角度' }),
              react_jsx_runtime.jsx('strong', { children: overview.angle || '还没拍板' })
            ] }),
            react_jsx_runtime.jsxs('div', { className: 'wd10-currentChoice', children: [
              react_jsx_runtime.jsx('span', { children: '当前钩子' }),
              react_jsx_runtime.jsx('strong', { children: overview.hook || '还没拍板' })
            ] })
          ] }),
          choiceGroup('候选角度', '文件里没有候选角度。', angles),
          choiceGroup('候选钩子', '文件里没有候选钩子。', hooks),
          surface.status === 'partial' && react_jsx_runtime.jsx('p', {
            className: 'wd10-incomplete', role: 'status', children:
              `候选读取不完整；只显示已成功读取的 ${overview.candidates.length}/${overview.candidateCount} 项。`
          }),
          choiceFeedback && react_jsx_runtime.jsx('p', {
            className: 'wd10-feedback', role: 'status', children: choiceFeedback
          }),
          react_jsx_runtime.jsxs('div', { className: 'wd10-next', children: [
            react_jsx_runtime.jsx('h3', { children: '下一步' }),
            actions.length === 0 ? react_jsx_runtime.jsx('p', {
              children: '当前阶段没有可用的下一步动作。'
            }) : react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, { children: [
              react_jsx_runtime.jsx('p', { children: '会先显示投递去向，再由你确认。' }),
              ...actions.map((action) => react_jsx_runtime.jsx('button', {
                type: 'button', className: 'wd10-nextAction',
                disabled: actionPending || choosing,
                title: action.hint || undefined,
                onClick: () => onAction(action), children: action.label
              }, action.id))
            ] })
          ] })
        ]
      });
    }

    function proposalStatusCopy(proposal) {
      if (!proposal || proposal.status === null) return '';
      if (proposal.status === 'queued') return '建议副本已排队，正在等待任务写入真实文件。';
      if (proposal.status === 'unchanged') return '建议文件已回读，但目标块还没有变化。';
      if (proposal.status === 'ready') return '建议已就绪；采用只会替换这一块。';
      if (proposal.status === 'stale') return '原稿已变化，这张建议不能采用。';
      if (proposal.status === 'invalid') return '建议文件无效，原稿没有变化。';
      if (proposal.status === 'adopted') return '这一块已采用；在原稿再次变化前可撤销一次。';
      return '采用后的原稿已变化，这次撤销不可用。';
    }

    function ScriptPanel({ project, workspaceFiles, actionPending, onBlockAction,
      proposalRefreshKey, onProjectMutation }) {
      const [documentState, setDocumentState] = react.useState({ status: 'idle', document: null });
      const [proposalState, setProposalState] = react.useState({ status: 'idle', proposal: null });
      const [proposalFeedback, setProposalFeedback] = react.useState('');
      const [proposalPending, setProposalPending] = react.useState(false);
      const documentAttempt = react.useRef(0);
      const proposalAttempt = react.useRef(0);
      const proposalActionAttempt = react.useRef(0);
      const proposalActionAbort = react.useRef(null);
      const proposalPendingRef = react.useRef(false);

      react.useEffect(() => {
        const attempt = ++documentAttempt.current;
        const controller = new AbortController();
        setDocumentState({ status: project ? 'loading' : 'idle', document: null });
        if (!project || !workspaceFiles || typeof workspaceFiles.execute !== 'function') {
          if (project) setDocumentState({ status: 'error', document: null });
          return () => controller.abort();
        }
        const read = async () => {
          let cursor = 0;
          let first = null;
          let last = null;
          let complete = false;
          let failed = false;
          const blocks = [];
          const seen = new Set();
          for (let pageIndex = 0; pageIndex < 2048; pageIndex += 1) {
            let page = null;
            try {
              page = documentPageResult(await workspaceFiles.execute('document.read', {
                projectToken: project.projectToken, cursor, limit: 2
              }, controller.signal), project.projectToken, cursor);
            } catch (_error) { page = null; }
            if (controller.signal.aborted || documentAttempt.current !== attempt) return;
            if (!page || (first && !sameDocumentHeader(first, page))) {
              failed = true;
              break;
            }
            first ||= page;
            last = page;
            let duplicate = false;
            for (const block of page.blocks) {
              if (seen.has(block.blockToken)) { duplicate = true; break; }
              seen.add(block.blockToken);
              blocks.push(block);
            }
            if (duplicate) { failed = true; break; }
            if (page.nextCursor === null) { complete = true; break; }
            cursor = page.nextCursor;
          }
          if (controller.signal.aborted || documentAttempt.current !== attempt) return;
          if (!first) {
            setDocumentState({ status: 'error', document: null });
            return;
          }
          const document = Object.freeze({
            ...first,
            blocks: Object.freeze(blocks),
            truncated: last?.truncated === true || blocks.some((block) => block.textTruncated)
          });
          setDocumentState({ status: complete && !failed ? 'ready' : 'partial', document });
        };
        void read();
        return () => controller.abort();
      }, [project?.contentRef, project?.projectToken, workspaceFiles]);

      react.useEffect(() => {
        const attempt = ++proposalAttempt.current;
        const controller = new AbortController();
        let timer = null;
        proposalActionAttempt.current += 1;
        proposalActionAbort.current?.abort();
        proposalActionAbort.current = null;
        proposalPendingRef.current = false;
        setProposalPending(false);
        setProposalFeedback('');
        setProposalState({ status: project ? 'loading' : 'idle', proposal: null });
        if (!project || !workspaceFiles || typeof workspaceFiles.execute !== 'function') {
          if (project) setProposalState({ status: 'error', proposal: null });
          return () => controller.abort();
        }
        const poll = async () => {
          let proposal = null;
          try {
            proposal = proposalResult(await workspaceFiles.execute('proposal.read', {
              contentRef: project.contentRef
            }, controller.signal), project.contentRef);
          } catch (_error) { proposal = null; }
          if (controller.signal.aborted || proposalAttempt.current !== attempt) return;
          if (!proposal) {
            setProposalState((current) => current.proposal
              ? { status: 'stale-read', proposal: current.proposal }
              : { status: 'error', proposal: null });
          } else setProposalState({ status: 'ready', proposal });
          const active = proposal && ['queued', 'unchanged'].includes(proposal.status);
          timer = globalThis.setTimeout(poll, active ? 1000 : 4000);
        };
        void poll();
        return () => {
          controller.abort();
          if (timer !== null) globalThis.clearTimeout(timer);
        };
      }, [project?.contentRef, project?.projectToken, workspaceFiles, proposalRefreshKey]);

      react.useEffect(() => () => {
        proposalActionAttempt.current += 1;
        proposalActionAbort.current?.abort();
        proposalActionAbort.current = null;
        proposalPendingRef.current = false;
      }, []);

      const decide = async (decision) => {
        const proposal = proposalState.proposal;
        const allowed = decision === 'adopt'
          ? proposal?.status === 'ready' && proposal.canAdopt === true
            && !proposal.beforeTruncated && !proposal.afterTruncated
          : proposal?.status !== null && proposal?.canReject === true;
        if (!proposal || !allowed || proposalPendingRef.current || !proposal.proposalToken) return;
        proposalPendingRef.current = true;
        setProposalPending(true);
        setProposalFeedback(decision === 'adopt' ? '正在采用这一块…' : '正在退回建议…');
        const controller = new AbortController();
        proposalActionAbort.current = controller;
        const attempt = ++proposalActionAttempt.current;
        const input = decision === 'adopt' ? {
          contentRef: proposal.contentRef,
          proposalToken: proposal.proposalToken,
          decision,
          proposalRevisionToken: proposal.proposalRevisionToken
        } : {
          contentRef: proposal.contentRef,
          proposalToken: proposal.proposalToken,
          decision
        };
        try {
          const snapshot = await workspaceFiles.execute('proposal.decide', input, controller.signal);
          if (controller.signal.aborted || proposalActionAttempt.current !== attempt) return;
          const result = proposalDecisionResult(snapshot, {
            contentRef: proposal.contentRef,
            projectToken: proposal.projectToken,
            decision
          });
          if (!result) {
            setProposalFeedback(operationError(snapshot, '建议决策结果无效；请刷新后核对原稿。'));
            return;
          }
          setProposalFeedback(result.message);
          if (decision === 'adopt') onProjectMutation?.(result);
          else setProposalState({ status: 'ready', proposal: Object.freeze({
            ...proposal, status: null, reason: null, proposalToken: null,
            proposalRevisionToken: null, revisionToken: null, title: null,
            intentLabel: null, before: null, beforeTruncated: false,
            after: null, afterTruncated: false, canAdopt: false,
            canReject: false, canUndo: false, submitted: null, target: null,
            projectToken: result.projectToken
          }) });
        } catch (_error) {
          if (!controller.signal.aborted && proposalActionAttempt.current === attempt) {
            setProposalFeedback('建议决策结果未知；请刷新后核对原稿，不要重复点击。');
          }
        } finally {
          if (proposalActionAbort.current === controller) proposalActionAbort.current = null;
          if (proposalActionAttempt.current === attempt) {
            proposalPendingRef.current = false;
            setProposalPending(false);
          }
        }
      };

      const undo = async () => {
        const proposal = proposalState.proposal;
        if (!proposal || proposal.status !== 'adopted' || !proposal.revisionToken
            || !proposal.canUndo || proposalPendingRef.current) return;
        proposalPendingRef.current = true;
        setProposalPending(true);
        setProposalFeedback('正在撤销这一次采用…');
        const controller = new AbortController();
        proposalActionAbort.current = controller;
        const attempt = ++proposalActionAttempt.current;
        try {
          const snapshot = await workspaceFiles.execute('proposal.undo', {
            contentRef: proposal.contentRef,
            revisionToken: proposal.revisionToken
          }, controller.signal);
          if (controller.signal.aborted || proposalActionAttempt.current !== attempt) return;
          const result = proposalUndoResult(snapshot, {
            contentRef: proposal.contentRef,
            projectToken: proposal.projectToken
          });
          if (!result) {
            setProposalFeedback(operationError(snapshot, '撤销结果无效；请刷新后核对原稿。'));
            return;
          }
          setProposalFeedback(result.message);
          onProjectMutation?.(result);
        } catch (_error) {
          if (!controller.signal.aborted && proposalActionAttempt.current === attempt) {
            setProposalFeedback('撤销结果未知；请刷新后核对原稿，不要重复点击。');
          }
        } finally {
          if (proposalActionAbort.current === controller) proposalActionAbort.current = null;
          if (proposalActionAttempt.current === attempt) {
            proposalPendingRef.current = false;
            setProposalPending(false);
          }
        }
      };

      const proposal = proposalState.proposal;
      const proposalCard = proposal && proposal.status !== null
        ? react_jsx_runtime.jsxs('section', {
          className: 'wd10-card wd10-proposal', 'data-proposal-status': proposal.status, children: [
            react_jsx_runtime.jsx('h3', { children: '鲸坞建议 · 黄牌，不会自动生效' }),
            react_jsx_runtime.jsx('p', { children:
              `${proposal.intentLabel || '块级建议'} · ${proposalStatusCopy(proposal)}` }),
            proposal.before !== null && react_jsx_runtime.jsxs('div', {
              className: 'wd10-compare', children: [
                react_jsx_runtime.jsx('h4', { children: '原来' }),
                react_jsx_runtime.jsx('pre', { children: proposal.before }),
                proposal.beforeTruncated && react_jsx_runtime.jsx('p', {
                  className: 'wd10-incomplete', children: '原文对照已截断。'
                })
              ]
            }),
            proposal.after !== null && react_jsx_runtime.jsxs('div', {
              className: 'wd10-compare', children: [
                react_jsx_runtime.jsx('h4', { children: '鲸坞建议' }),
                react_jsx_runtime.jsx('pre', { children: proposal.after }),
                proposal.afterTruncated && react_jsx_runtime.jsx('p', {
                  className: 'wd10-incomplete', children: '建议对照已截断，不能采用。'
                })
              ]
            }),
            (proposal.status === 'ready' && proposal.canAdopt || proposal.canReject)
              && react_jsx_runtime.jsxs('div', {
              className: 'wd10-proposalActions', children: [
                proposal.status === 'ready' && proposal.canAdopt
                  && react_jsx_runtime.jsx('button', { type: 'button',
                  disabled: proposalPending || proposal.beforeTruncated || proposal.afterTruncated,
                  onClick: () => { void decide('adopt'); }, children: '采用这一块' }),
                proposal.canReject && react_jsx_runtime.jsx('button', {
                  type: 'button', disabled: proposalPending,
                  onClick: () => { void decide('reject'); }, children: '退回建议' })
              ]
            }),
            proposal.status === 'adopted' && proposal.canUndo
              && react_jsx_runtime.jsx('button', { type: 'button', className: 'wd10-undo',
                disabled: proposalPending, onClick: () => { void undo(); },
                children: '撤销这一次采用' }),
            proposalFeedback && react_jsx_runtime.jsx('p', {
              className: 'wd10-feedback', role: 'status', children: proposalFeedback
            })
          ]
        }) : null;

      if (documentState.status === 'idle') return react_jsx_runtime.jsx('section', {
        className: 'wd10-card', children: react_jsx_runtime.jsx('p', {
          children: '请从左侧选择一张真实内容卡。'
        })
      });
      if (documentState.status === 'loading') return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
        children: [react_jsx_runtime.jsx('section', { className: 'wd10-card', children:
          react_jsx_runtime.jsx('p', { children: '正在读取脚本块…' }) }), proposalCard]
      });
      if (documentState.status === 'error' || !documentState.document) {
        return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, { children: [
          react_jsx_runtime.jsx('section', { className: 'wd10-card', children:
            react_jsx_runtime.jsx('p', { role: 'status', children:
              '脚本暂时读不到；没有使用内容卡摘要冒充正文。' }) }), proposalCard
        ] });
      }
      const document = documentState.document;
      return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, { children: [
        proposalState.status === 'error' && react_jsx_runtime.jsx('p', {
          className: 'wd10-feedback', role: 'status', children: '建议卡暂时读不到；没有推断建议状态。'
        }),
        proposalState.status === 'stale-read' && react_jsx_runtime.jsx('p', {
          className: 'wd10-feedback', role: 'status', children:
            '建议卡刷新失败；以下保留上次成功结果，不代表当前状态。'
        }),
        proposalCard,
        !proposalCard && proposalFeedback && react_jsx_runtime.jsx('p', {
          className: 'wd10-feedback', role: 'status', children: proposalFeedback
        }),
        react_jsx_runtime.jsxs('section', { className: 'wd10-script', children: [
          react_jsx_runtime.jsxs('div', { className: 'wd10-scriptHead', children: [
            react_jsx_runtime.jsx('h3', { children: '真实脚本块' }),
            react_jsx_runtime.jsx('span', { children:
              `${document.blocks.length}/${document.blockCount} 块` })
          ] }),
          documentState.status === 'partial' && react_jsx_runtime.jsx('p', {
            className: 'wd10-incomplete', role: 'status', children:
              `脚本读取不完整；只显示已成功读取的 ${document.blocks.length}/${document.blockCount} 块。`
          }),
          document.truncated && documentState.status === 'ready' && react_jsx_runtime.jsx('p', {
            className: 'wd10-incomplete', role: 'status', children:
              '文档投影含截断内容；只能处理下方显示完整的块。'
          }),
          document.blocks.length === 0 && react_jsx_runtime.jsx('p', {
            className: 'wd10-feedback', children: '这份文件没有可显示的正文块。'
          }),
          ...document.blocks.map((block) => react_jsx_runtime.jsxs('article', {
            className: 'wd10-block', 'data-block-kind': block.kind, children: [
              react_jsx_runtime.jsxs('div', { className: 'wd10-blockMeta', children: [
                react_jsx_runtime.jsx('strong', { children: block.kind }),
                react_jsx_runtime.jsx('span', { children:
                  `第 ${block.startLine}-${block.endLine} 行` })
              ] }),
              react_jsx_runtime.jsx('pre', { children: block.text }),
              block.textTruncated && react_jsx_runtime.jsx('p', {
                className: 'wd10-incomplete', children: '这一块文本已截断，不能发起块级动作。'
              }),
              react_jsx_runtime.jsx('div', { className: 'wd10-blockActions', children:
                BLOCK_ACTIONS.map(([action, label]) => react_jsx_runtime.jsx('button', {
                  type: 'button', disabled: actionPending || block.textTruncated,
                  onClick: () => onBlockAction(block, action), children: label
                }, action)) })
            ]
          }, block.blockToken))
        ] })
      ] });
    }

    function PublishPanel({ project, workspaceFiles, workspaceIdentity,
      onProjectMutation, onPublishCreated, onCatalogRefresh }) {
      const [surfaceState, setSurfaceState] = react.useState({ status: 'idle', surface: null });
      const [feedback, setFeedback] = react.useState('');
      const [pending, setPending] = react.useState(false);
      const [readRefreshKey, setReadRefreshKey] = react.useState(0);
      const readAttempt = react.useRef(0);
      const readAbort = react.useRef(null);
      const mutationAttempt = react.useRef(0);
      const mutationAbort = react.useRef(null);
      const pendingRef = react.useRef(false);
      const lastSurfaceRef = react.useRef(null);
      const lastSurfaceIdentityRef = react.useRef(null);
      const lastFeedbackRef = react.useRef('');

      const showFeedback = (message) => {
        lastFeedbackRef.current = message;
        setFeedback(message);
      };
      const showSurface = (surface, status = 'ready') => {
        lastSurfaceRef.current = surface;
        lastSurfaceIdentityRef.current = workspaceIdentity;
        setSurfaceState({ status, surface });
      };
      const clearStale = (message) => {
        lastSurfaceRef.current = null;
        lastSurfaceIdentityRef.current = null;
        setSurfaceState({ status: 'error', surface: null });
        showFeedback(message);
        onCatalogRefresh?.();
      };

      react.useLayoutEffect(() => {
        const attempt = ++readAttempt.current;
        readAbort.current?.abort();
        const controller = new AbortController();
        readAbort.current = controller;
        mutationAttempt.current += 1;
        mutationAbort.current?.abort();
        mutationAbort.current = null;
        pendingRef.current = false;
        setPending(false);
        const cached = project && lastSurfaceRef.current
          && lastSurfaceIdentityRef.current === workspaceIdentity
          && lastSurfaceRef.current.contentRef === project.contentRef
          && lastSurfaceRef.current.projectToken === project.projectToken
          ? lastSurfaceRef.current : null;
        if (!cached) {
          lastSurfaceRef.current = null;
          lastSurfaceIdentityRef.current = null;
          lastFeedbackRef.current = '';
          setFeedback('');
        } else setFeedback(lastFeedbackRef.current);
        setSurfaceState({ status: project ? 'loading' : 'idle', surface: cached });
        if (!project || !workspaceFiles || typeof workspaceFiles.execute !== 'function') {
          if (project) setSurfaceState({ status: 'error', surface: null });
          return () => controller.abort();
        }
        const expected = Object.freeze({
          contentRef: project.contentRef, projectToken: project.projectToken
        });
        const read = async () => {
          let snapshot = null;
          try {
            snapshot = await workspaceFiles.execute('publish.read', expected, controller.signal);
          } catch (_error) { snapshot = null; }
          if (controller.signal.aborted || readAttempt.current !== attempt) return;
          const surface = publishReadResult(snapshot, expected);
          if (surface) {
            showSurface(surface);
            return;
          }
          if (snapshot?.code === 'operation-stale') {
            clearStale('项目文件已变化；已清空旧发布检查单并刷新内容库。');
            return;
          }
          const prior = lastSurfaceRef.current;
          if (prior && prior.contentRef === expected.contentRef
              && prior.projectToken === expected.projectToken) {
            setSurfaceState({ status: 'stale-read', surface: prior });
            showFeedback(snapshot?.code === 'outcome-unknown'
              ? '读取结果未知；以下保留上次检查单。请核对项目文件，不要重复点击。'
              : '发布检查单暂时读不到；以下保留上次成功结果，不代表当前状态。');
          } else {
            setSurfaceState({ status: 'error', surface: null });
            showFeedback('发布检查单暂时读不到；没有推断文件状态。');
          }
        };
        void read();
        return () => {
          controller.abort();
          if (readAbort.current === controller) readAbort.current = null;
        };
      }, [project?.contentRef, project?.projectToken, workspaceIdentity,
        workspaceFiles, readRefreshKey]);

      react.useEffect(() => () => {
        readAttempt.current += 1;
        readAbort.current?.abort();
        readAbort.current = null;
        mutationAttempt.current += 1;
        mutationAbort.current?.abort();
        mutationAbort.current = null;
        pendingRef.current = false;
      }, []);

      const createChecklist = async () => {
        const surface = surfaceState.surface;
        if (surfaceState.status !== 'ready' || !surface?.canCreate
            || surface.checklist !== null || pendingRef.current) return;
        pendingRef.current = true;
        setPending(true);
        showFeedback('正在创建本地发布检查单…');
        const controller = new AbortController();
        mutationAbort.current = controller;
        const attempt = ++mutationAttempt.current;
        const expected = Object.freeze({
          contentRef: surface.contentRef, projectToken: surface.projectToken
        });
        try {
          const snapshot = await workspaceFiles.execute('publish.create', expected, controller.signal);
          if (controller.signal.aborted || mutationAttempt.current !== attempt) return;
          const result = publishCreateResult(snapshot, expected);
          if (!result) {
            if (snapshot?.code === 'operation-stale') {
              clearStale('源文件已变化；已清空旧结果并刷新内容库。');
            } else if (snapshot?.code === 'outcome-unknown') {
              setSurfaceState({ status: 'stale-write', surface });
              showFeedback('创建结果未知；以下保留创建前状态。请核对项目文件，不要重复点击。');
            } else showFeedback(operationError(snapshot,
              '创建结果无效；请核对项目文件，不要重复点击。'));
            return;
          }
          showSurface(result.surface);
          showFeedback(result.created ? result.message : `已打开既有检查单。${result.message}`);
          onPublishCreated?.(result.surface);
        } catch (_error) {
          if (!controller.signal.aborted && mutationAttempt.current === attempt) {
            setSurfaceState({ status: 'stale-write', surface });
            showFeedback('创建结果未知；以下保留创建前状态。请核对项目文件，不要重复点击。');
          }
        } finally {
          if (mutationAbort.current === controller) mutationAbort.current = null;
          if (mutationAttempt.current === attempt) {
            pendingRef.current = false;
            setPending(false);
          }
        }
      };

      const updateChecklist = async (input) => {
        const surface = surfaceState.surface;
        if (surfaceState.status !== 'ready' || !surface?.checklist?.structureValid
            || pendingRef.current) return;
        pendingRef.current = true;
        setPending(true);
        showFeedback('正在写入本地发布检查单…');
        const controller = new AbortController();
        mutationAbort.current = controller;
        const attempt = ++mutationAttempt.current;
        const expected = Object.freeze({
          contentRef: surface.contentRef, projectToken: surface.projectToken
        });
        try {
          const snapshot = await workspaceFiles.execute('publish.update', {
            ...expected, ...input
          }, controller.signal);
          if (controller.signal.aborted || mutationAttempt.current !== attempt) return;
          const result = publishMutationResult(snapshot, expected);
          if (!result) {
            if (snapshot?.code === 'operation-stale') {
              clearStale('发布文件已变化；已清空旧检查单并刷新内容库。');
            } else if (snapshot?.code === 'outcome-unknown') {
              setSurfaceState({ status: 'stale-write', surface });
              showFeedback('写入结果未知；以下保留写入前检查单。请核对项目文件，不要重复点击。');
            } else showFeedback(operationError(snapshot,
              '写入结果无效；请刷新后核对项目文件。'));
            return;
          }
          showSurface(result.surface);
          showFeedback(result.message);
          onProjectMutation?.({
            contentRef: result.surface.contentRef,
            projectToken: result.surface.projectToken,
            updated: result.surface.updated
          });
        } catch (_error) {
          if (!controller.signal.aborted && mutationAttempt.current === attempt) {
            setSurfaceState({ status: 'stale-write', surface });
            showFeedback('写入结果未知；以下保留写入前检查单。请核对项目文件，不要重复点击。');
          }
        } finally {
          if (mutationAbort.current === controller) mutationAbort.current = null;
          if (mutationAttempt.current === attempt) {
            pendingRef.current = false;
            setPending(false);
          }
        }
      };

      if (surfaceState.status === 'idle') return react_jsx_runtime.jsx('section', {
        className: 'wd10-card', children: react_jsx_runtime.jsx('p', {
          children: '请从左侧选择一张真实内容卡。'
        })
      });
      if (surfaceState.status === 'loading' && !surfaceState.surface) {
        return react_jsx_runtime.jsx('section', { className: 'wd10-card', children:
          react_jsx_runtime.jsx('p', { children: '正在读取发布状态…' }) });
      }
      if (surfaceState.status === 'error' || !surfaceState.surface) {
        return react_jsx_runtime.jsxs('section', { className: 'wd10-card', children: [
          react_jsx_runtime.jsx('p', { role: 'status', children:
            '发布状态暂时读不到；没有用内容卡摘要冒充检查单。' }),
          feedback && react_jsx_runtime.jsx('p', {
            className: 'wd10-feedback', role: 'status', children: feedback
          }),
          react_jsx_runtime.jsx('button', { type: 'button', className: 'wd10-refresh',
            onClick: () => setReadRefreshKey((current) => current + 1),
            children: '重新读取检查单' })
        ] });
      }
      const surface = surfaceState.surface;
      if (surface.checklist === null) {
        return react_jsx_runtime.jsxs('section', {
          className: 'wd10-card wd10-publish', 'data-whaledock-publish': true, children: [
            react_jsx_runtime.jsx('h3', { children: '发布检查单' }),
            surface.canCreate ? react_jsx_runtime.jsx('p', { children:
              `当前是${surface.stageLabel}阶段，可从这份真实文件创建一张本地发布检查单。`
            }) : react_jsx_runtime.jsx('p', { role: 'status', children:
              `当前“${surface.stageLabel}”阶段不能创建发布检查单。只有脚本、拍摄或剪辑阶段可创建。`
            }),
            surface.canCreate && react_jsx_runtime.jsx('button', {
              type: 'button', className: 'wd10-createPublish',
              disabled: pending || surfaceState.status !== 'ready',
              onClick: () => { void createChecklist(); },
              children: pending ? '正在创建…' : '创建发布检查单'
            }),
            react_jsx_runtime.jsx('p', { className: 'wd10-publishNotice', children:
              '只写入本地检查单；鲸坞不会访问平台、代发或宣称已合规'
            }),
            feedback && react_jsx_runtime.jsx('p', {
              className: 'wd10-feedback', role: 'status', children: feedback
            })
          ]
        });
      }

      const checklist = surface.checklist;
      const writeDisabled = pending || surfaceState.status !== 'ready'
        || !checklist.structureValid;
      const aiLight = checklist.lights[5];
      const stateCopy = checklist.published ? '本地已标记为本人发布'
        : checklist.ready ? '发布前检查已就绪' : '还有检查项未完成';
      const lightControl = (light) => {
        const isAiLabel = light.id === 'ai-label';
        const isPublished = light.id === 'published';
        const disabled = writeDisabled || !light.available
          || isAiLabel && checklist.aiDisclosure !== 'ai' && !light.checked
          || isPublished && !checklist.ready && !light.checked;
        return react_jsx_runtime.jsxs('label', {
          className: 'wd10-publishLight', 'data-light-id': light.id,
          'data-satisfied': light.satisfied, children: [
            react_jsx_runtime.jsx('span', { children: light.label }),
            react_jsx_runtime.jsx('input', {
              type: 'checkbox', checked: light.checked, disabled,
              onChange: () => { void updateChecklist({
                type: 'light', lightId: light.id, checked: !light.checked
              }); }
            })
          ]
        }, light.id);
      };
      return react_jsx_runtime.jsxs('section', {
        className: 'wd10-publish', 'data-whaledock-publish': true, children: [
          (surfaceState.status === 'stale-read' || surfaceState.status === 'stale-write')
            && react_jsx_runtime.jsxs('div', { children: [
              react_jsx_runtime.jsx('p', { className: 'wd10-incomplete', role: 'status',
                children: surfaceState.status === 'stale-read'
                  ? '以下是上次成功读取的检查单，不代表当前文件状态。'
                  : '以下是写入前的检查单，不代表写入是否成功。' }),
              react_jsx_runtime.jsx('button', { type: 'button', className: 'wd10-refresh',
                onClick: () => setReadRefreshKey((current) => current + 1),
                children: '重新读取检查单' })
            ] }),
          !checklist.structureValid && react_jsx_runtime.jsxs('section', {
            className: 'wd10-card wd10-publishInvalid', role: 'alert', children: [
              react_jsx_runtime.jsx('h3', { children: '发布检查单结构无效' }),
              react_jsx_runtime.jsx('p', { children:
                '检查项标记缺失、重复或存在歧义；已禁用全部写入控件，请先修复真实文件。'
              })
            ]
          }),
          checklist.lights[6].checked && !checklist.published
            && react_jsx_runtime.jsx('p', { className: 'wd10-incomplete', role: 'status',
              children: !writeDisabled && checklist.lights[6].available
                ? '文件里的“已由本人发布”勾选已失效；当前不会显示为已发布，可直接取消该勾选。'
                : '文件里的“已由本人发布”勾选已失效；当前不会显示为已发布，且未开放取消操作。'
            }),
          react_jsx_runtime.jsxs('section', { className: 'wd10-card', children: [
            react_jsx_runtime.jsxs('div', { className: 'wd10-publishHead', children: [
              react_jsx_runtime.jsxs('div', { children: [
                react_jsx_runtime.jsx('h3', { children: '发布检查单 · 7 灯' }),
                react_jsx_runtime.jsx('p', { children:
                  `${surface.title} · ${surface.updated ? `更新 ${surface.updated}` : '更新时间未写明'}`
                })
              ] }),
              react_jsx_runtime.jsx('span', {
                className: 'wd10-publishState', 'data-ready': checklist.ready,
                children: stateCopy
              })
            ] }),
            react_jsx_runtime.jsx('div', { className: 'wd10-publishLights', children:
              checklist.lights.map(lightControl) })
          ] }),
          react_jsx_runtime.jsxs('section', { className: 'wd10-card', children: [
            react_jsx_runtime.jsx('h3', { children: 'AI 内容选择' }),
            react_jsx_runtime.jsx('p', { children: checklist.aiDisclosure === 'unknown'
              ? '必须先选择是否包含 AI 内容；未选择时发布前检查不会就绪。'
              : checklist.aiDisclosure === 'ai'
                ? '已选择包含 AI 内容；还必须勾选“AI 内容标识”。'
                : aiLight.checked
                  ? !writeDisabled && aiLight.available
                    ? '已选择不包含 AI 内容；文件仍勾选了“AI 内容标识”，可以取消。'
                    : '已选择不包含 AI 内容；当前只显示 AI 内容标识的原始勾选，未开放取消操作。'
                  : '已选择不包含 AI 内容；无需勾选 AI 内容标识。'
            }),
            react_jsx_runtime.jsx('div', { className: 'wd10-aiChoices', children:
              AI_DISCLOSURES.map(([value, label]) => react_jsx_runtime.jsx('button', {
                type: 'button', 'aria-pressed': checklist.aiDisclosure === value,
                disabled: writeDisabled || checklist.aiDisclosure === value
                  || !aiLight.available,
                onClick: () => { void updateChecklist({ type: 'ai-disclosure', value }); },
                children: label
              }, value)) })
          ] }),
          react_jsx_runtime.jsxs('section', { className: 'wd10-card wd10-publishNotice', children: [
            react_jsx_runtime.jsx('h3', { children: '本人已发布不是平台回读' }),
            react_jsx_runtime.jsx('p', { children:
              '只写入本地检查单；鲸坞不会访问平台、代发或宣称已合规'
            })
          ] }),
          feedback && react_jsx_runtime.jsx('p', {
            className: 'wd10-feedback', role: 'status', children: feedback
          })
        ]
      });
    }

    function ShootPanel({ project, workspaceFiles, workspaceIdentity, onCatalogRefresh }) {
      const [documentState, setDocumentState] = react.useState({ status: 'idle', document: null });
      const [historyState, setHistoryState] = react.useState({
        status: 'idle', header: null, records: []
      });
      const [feedback, setFeedback] = react.useState('');
      const [nativePending, setNativePending] = react.useState(false);
      const [nativeBlocked, setNativeBlocked] = react.useState(false);
      const [readRefreshKey, setReadRefreshKey] = react.useState(0);
      const [inlineOpen, setInlineOpen] = react.useState(false);
      const [inlinePlaying, setInlinePlaying] = react.useState(false);
      const [speed, setSpeed] = react.useState(1);
      const [fontSize, setFontSize] = react.useState('medium');
      const readAttempt = react.useRef(0);
      const readAbort = react.useRef(null);
      const nativeAttempt = react.useRef(0);
      const nativeAbort = react.useRef(null);
      const nativePendingRef = react.useRef(false);
      const readIdentityRef = react.useRef(null);
      const documentCacheRef = react.useRef(null);
      const historyCacheRef = react.useRef(null);
      const scrollRef = react.useRef(null);
      const frameRef = react.useRef(null);
      const frameTimeRef = react.useRef(null);
      const viewIdentity = project && typeof workspaceIdentity === 'string' && workspaceIdentity
        ? `${workspaceIdentity}\u0000${project.contentRef}\u0000${project.projectToken}` : null;
      const eligible = Boolean(project && project.canShoot === true);

      const clearStale = (message) => {
        readAttempt.current += 1;
        readAbort.current?.abort();
        readAbort.current = null;
        nativeAttempt.current += 1;
        nativeAbort.current?.abort();
        nativeAbort.current = null;
        nativePendingRef.current = false;
        documentCacheRef.current = null;
        historyCacheRef.current = null;
        setDocumentState({ status: 'error', document: null });
        setHistoryState({ status: 'error', header: null, records: [] });
        setInlinePlaying(false);
        setInlineOpen(false);
        setNativePending(false);
        setNativeBlocked(true);
        setFeedback(message);
        onCatalogRefresh?.();
      };

      react.useLayoutEffect(() => {
        const identityChanged = readIdentityRef.current !== viewIdentity;
        readIdentityRef.current = viewIdentity;
        const attempt = ++readAttempt.current;
        readAbort.current?.abort();
        const controller = new AbortController();
        readAbort.current = controller;
        if (identityChanged) {
          nativeAttempt.current += 1;
          nativeAbort.current?.abort();
          nativeAbort.current = null;
          nativePendingRef.current = false;
          documentCacheRef.current = null;
          historyCacheRef.current = null;
          setNativePending(false);
          setNativeBlocked(false);
          setFeedback('');
          setInlineOpen(false);
          setInlinePlaying(false);
          setSpeed(1);
          setFontSize('medium');
        }
        const priorDocument = !identityChanged
          && documentCacheRef.current?.identity === viewIdentity
          ? documentCacheRef.current.document : null;
        const priorHistory = !identityChanged
          && historyCacheRef.current?.identity === viewIdentity
          ? historyCacheRef.current.value : null;
        const waiting = Boolean(project && eligible && viewIdentity);
        setDocumentState({ status: waiting ? 'loading' : project ? 'not-applicable' : 'idle',
          document: waiting ? priorDocument : null });
        setHistoryState(priorHistory && waiting ? { ...priorHistory, status: 'loading' } : {
          status: waiting ? 'loading' : project ? 'not-applicable' : 'idle',
          header: null, records: []
        });
        if (!project || !eligible || !viewIdentity
            || !workspaceFiles || typeof workspaceFiles.execute !== 'function') {
          if (project && eligible && viewIdentity
              && (!workspaceFiles || typeof workspaceFiles.execute !== 'function')) {
            setDocumentState({ status: 'error', document: null });
            setHistoryState({ status: 'error', header: null, records: [] });
          }
          return () => controller.abort();
        }
        const expected = Object.freeze({
          contentRef: project.contentRef, projectToken: project.projectToken
        });
        const invalidateRead = (message) => {
          if (controller.signal.aborted || readAttempt.current !== attempt) return;
          readAttempt.current += 1;
          controller.abort();
          if (readAbort.current === controller) readAbort.current = null;
          nativeAttempt.current += 1;
          nativeAbort.current?.abort();
          nativeAbort.current = null;
          nativePendingRef.current = false;
          documentCacheRef.current = null;
          historyCacheRef.current = null;
          setDocumentState({ status: 'error', document: null });
          setHistoryState({ status: 'error', header: null, records: [] });
          setInlinePlaying(false);
          setInlineOpen(false);
          setNativePending(false);
          setNativeBlocked(true);
          setFeedback(message);
          onCatalogRefresh?.();
        };
        const readDocument = async () => {
          let cursor = 0;
          let first = null;
          let last = null;
          let pagesComplete = false;
          let failed = false;
          const blocks = [];
          const seen = new Set();
          for (let pageIndex = 0; pageIndex < 2048; pageIndex += 1) {
            let snapshot = null;
            try {
              snapshot = await workspaceFiles.execute('document.read', {
                projectToken: expected.projectToken, cursor, limit: 2
              }, controller.signal);
            } catch (_error) { snapshot = null; }
            if (controller.signal.aborted || readAttempt.current !== attempt) return;
            if (snapshot?.code === 'operation-stale') {
              invalidateRead('口播稿已变化；已清空旧拍摄视图并刷新内容库。');
              return;
            }
            const page = documentPageResult(snapshot, expected.projectToken, cursor);
            if (!page || first && !sameDocumentHeader(first, page)) {
              failed = true;
              break;
            }
            first ||= page;
            last = page;
            let duplicate = false;
            for (const block of page.blocks) {
              if (seen.has(block.blockToken)) { duplicate = true; break; }
              seen.add(block.blockToken);
              blocks.push(block);
            }
            if (duplicate) { failed = true; break; }
            if (page.nextCursor === null) { pagesComplete = true; break; }
            cursor = page.nextCursor;
          }
          if (controller.signal.aborted || readAttempt.current !== attempt) return;
          if (!first) {
            if (priorDocument) setDocumentState({ status: 'stale-read', document: priorDocument });
            else setDocumentState({ status: 'error', document: null });
            return;
          }
          const document = Object.freeze({
            ...first, blocks: Object.freeze(blocks),
            truncated: last?.truncated === true
              || blocks.some((block) => block.textTruncated)
          });
          const value = {
            status: pagesComplete && !failed && !document.truncated ? 'ready' : 'partial',
            document
          };
          documentCacheRef.current = { identity: viewIdentity, document };
          setDocumentState(value);
          if (value.status !== 'ready') setInlinePlaying(false);
        };
        const readHistory = async () => {
          let cursor = 0;
          let collectionToken = null;
          let first = null;
          let pagesComplete = false;
          let failed = false;
          const records = [];
          const seen = new Set();
          for (let pageIndex = 0; pageIndex < MAX_SHOOT_HISTORY_PAGES; pageIndex += 1) {
            let snapshot = null;
            try {
              snapshot = await workspaceFiles.execute('shoot.history.read', {
                ...expected, cursor, limit: 4, collectionToken
              }, controller.signal);
            } catch (_error) { snapshot = null; }
            if (controller.signal.aborted || readAttempt.current !== attempt) return;
            if (snapshot?.code === 'operation-stale') {
              invalidateRead('拍摄记录已变化；已清空旧拍摄视图并刷新内容库。');
              return;
            }
            const page = shootHistoryPageResult(snapshot, {
              ...expected, cursor, collectionToken
            });
            if (!page || first && !sameShootHistoryHeader(first, page)) {
              failed = true;
              break;
            }
            first ||= page;
            collectionToken = page.collectionToken;
            let duplicate = false;
            for (const record of page.records) {
              if (seen.has(record.recordRef)) { duplicate = true; break; }
              seen.add(record.recordRef);
              records.push(record);
            }
            if (duplicate) { failed = true; break; }
            if (page.nextCursor === null) { pagesComplete = true; break; }
            cursor = page.nextCursor;
          }
          if (controller.signal.aborted || readAttempt.current !== attempt) return;
          if (!first) {
            if (priorHistory) setHistoryState({ ...priorHistory, status: 'stale-read' });
            else setHistoryState({ status: 'error', header: null, records: [] });
            return;
          }
          const header = Object.freeze({
            contentRef: first.contentRef, projectToken: first.projectToken,
            collectionToken: first.collectionToken,
            itemCount: first.itemCount, complete: first.complete
          });
          const value = Object.freeze({
            status: pagesComplete && !failed && first.complete ? 'ready' : 'partial',
            header, records: Object.freeze(records)
          });
          historyCacheRef.current = { identity: viewIdentity, value };
          setHistoryState(value);
        };
        void Promise.all([readDocument(), readHistory()]);
        return () => {
          controller.abort();
          if (readAbort.current === controller) readAbort.current = null;
        };
      }, [project?.contentRef, project?.projectToken, project?.canShoot,
        workspaceIdentity, workspaceFiles, readRefreshKey]);

      react.useEffect(() => () => {
        readAttempt.current += 1;
        readAbort.current?.abort();
        readAbort.current = null;
        nativeAttempt.current += 1;
        nativeAbort.current?.abort();
        nativeAbort.current = null;
        nativePendingRef.current = false;
      }, []);

      react.useEffect(() => {
        const page = globalThis.document;
        if (!page || typeof page.addEventListener !== 'function') return undefined;
        const pauseWhenHidden = () => {
          if (page.hidden === true) setInlinePlaying(false);
        };
        page.addEventListener('visibilitychange', pauseWhenHidden);
        return () => page.removeEventListener?.('visibilitychange', pauseWhenHidden);
      }, []);

      react.useEffect(() => {
        if (!inlineOpen || !inlinePlaying
            || typeof globalThis.requestAnimationFrame !== 'function') return undefined;
        let cancelled = false;
        frameTimeRef.current = null;
        const step = (now) => {
          if (cancelled) return;
          const scroller = scrollRef.current;
          const previous = frameTimeRef.current;
          frameTimeRef.current = now;
          if (scroller && previous !== null) {
            const elapsed = Math.min(48, Math.max(0, now - previous));
            scroller.scrollTop += (32 * speed * elapsed) / 1000;
            if (Math.ceil(scroller.scrollTop + scroller.clientHeight) >= scroller.scrollHeight) {
              setInlinePlaying(false);
              return;
            }
          }
          frameRef.current = globalThis.requestAnimationFrame(step);
        };
        frameRef.current = globalThis.requestAnimationFrame(step);
        return () => {
          cancelled = true;
          if (frameRef.current !== null
              && typeof globalThis.cancelAnimationFrame === 'function') {
            globalThis.cancelAnimationFrame(frameRef.current);
          }
          frameRef.current = null;
          frameTimeRef.current = null;
        };
      }, [inlineOpen, inlinePlaying, speed]);

      const document = documentState.document;
      const canInline = documentState.status === 'ready' && document
        && document.blockCount > 0 && document.blocks.length === document.blockCount
        && !document.truncated && !document.blocks.some((block) => block.textTruncated);
      const openNative = async () => {
        if (!eligible || !viewIdentity || !workspaceFiles
            || typeof workspaceFiles.execute !== 'function'
            || nativeBlocked || nativePendingRef.current) return;
        nativePendingRef.current = true;
        setNativePending(true);
        setFeedback('正在打开全屏拍摄现场…');
        const controller = new AbortController();
        nativeAbort.current?.abort();
        nativeAbort.current = controller;
        const attempt = ++nativeAttempt.current;
        const identity = viewIdentity;
        const expected = Object.freeze({
          contentRef: project.contentRef, projectToken: project.projectToken
        });
        try {
          const snapshot = await workspaceFiles.execute('shoot.open', expected, controller.signal);
          if (controller.signal.aborted || nativeAttempt.current !== attempt
              || readIdentityRef.current !== identity) return;
          if (snapshot?.code === 'operation-stale') {
            clearStale('口播稿已变化；已清空旧拍摄视图并刷新内容库。');
            return;
          }
          const result = shootOpenResult(snapshot, expected);
          if (!result) {
            if (snapshot?.code === 'outcome-unknown' || snapshot?.state === 'fulfilled') {
              setNativeBlocked(true);
              setFeedback('全屏拍摄现场可能已经打开；请先检查桌面，不要重复点击。');
            } else setFeedback(operationError(snapshot, '全屏拍摄现场没有打开。'));
            return;
          }
          if (result.state === 'opened') setFeedback(result.message || '全屏拍摄现场已打开。');
          else if (result.state === 'focused') setFeedback(result.message
            || '已切回这份口播稿的全屏拍摄现场。');
          else if (result.state === 'busy') setFeedback(result.message
            || '另一场拍摄尚未收工；当前稿件没有打开。');
          else {
            setFeedback(canInline
              ? `${result.message} 可改用下方页内简版。`
              : `${result.message} 当前口播稿尚未完整读回，页内简版也没有启动。`);
            if (canInline) setInlineOpen(true);
          }
        } catch (_error) {
          if (!controller.signal.aborted && nativeAttempt.current === attempt
              && readIdentityRef.current === identity) {
            setNativeBlocked(true);
            setFeedback('全屏拍摄现场可能已经打开；请先检查桌面，不要重复点击。');
          }
        } finally {
          if (nativeAbort.current === controller) nativeAbort.current = null;
          if (nativeAttempt.current === attempt) {
            nativePendingRef.current = false;
            setNativePending(false);
          }
        }
      };
      const resetInline = () => {
        setInlinePlaying(false);
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
      };
      const refresh = () => {
        setInlinePlaying(false);
        setInlineOpen(false);
        if (!nativeBlocked) setFeedback('');
        setReadRefreshKey((current) => current + 1);
      };

      if (!project) return react_jsx_runtime.jsx('section', {
        className: 'wd10-shoot', 'data-whaledock-shoot': true, children:
          react_jsx_runtime.jsx('section', { className: 'wd10-card', children:
            react_jsx_runtime.jsx('p', { children: '请从左侧选择一张真实内容卡。' })
          })
      });
      if (!eligible) return react_jsx_runtime.jsx('section', {
        className: 'wd10-shoot', 'data-whaledock-shoot': true, children:
          react_jsx_runtime.jsxs('section', { className: 'wd10-card', children: [
            react_jsx_runtime.jsx('h3', { children: '当前内容不能进入拍摄现场' }),
            react_jsx_runtime.jsx('p', { role: 'status', children:
              '拍摄现场只接受 WhaleDock 明确标记的 03_口播稿；当前内容不会被当作台词。'
            })
          ] })
      });

      const sourceStatus = documentState.status === 'loading' && !document
        ? '正在完整读取本地口播稿…'
        : !document ? '口播稿正文暂时读不到；没有使用内容卡摘要冒充台词。'
          : `${document.title} · ${document.blocks.length}/${document.blockCount} 块`;
      const promptText = document?.blocks.map((block) => block.text).join('\n\n') || '';
      return react_jsx_runtime.jsxs('section', {
        className: 'wd10-shoot', 'data-whaledock-shoot': true, children: [
          react_jsx_runtime.jsxs('section', { className: 'wd10-card', children: [
            react_jsx_runtime.jsxs('div', { className: 'wd10-shootHead', children: [
              react_jsx_runtime.jsxs('div', { children: [
                react_jsx_runtime.jsx('h3', { children: '拍摄现场' }),
                react_jsx_runtime.jsx('p', { children: sourceStatus })
              ] }),
              document && react_jsx_runtime.jsx('span', { className: 'wd10-publishState', children:
                canInline ? '全文已读回' : '正文不完整'
              })
            ] }),
            documentState.status === 'partial' && document
              && react_jsx_runtime.jsx('p', { className: 'wd10-incomplete', role: 'status', children:
                `口播稿读取不完整或含截断内容；只显示已成功读取的 ${document.blocks.length}/${document.blockCount} 块。`
              }),
            documentState.status === 'stale-read' && document
              && react_jsx_runtime.jsx('p', { className: 'wd10-incomplete', role: 'status', children:
                '口播稿刷新失败；以下保留上次成功结果，不代表当前文件状态。'
              }),
            documentState.status === 'loading' && document
              && react_jsx_runtime.jsx('p', { className: 'wd10-incomplete', role: 'status', children:
                '正在重新读取口播稿；以下暂存上次已验证正文。'
              }),
            react_jsx_runtime.jsxs('div', { className: 'wd10-shootActions', children: [
              react_jsx_runtime.jsx('button', { type: 'button',
                disabled: !viewIdentity || nativePending || nativeBlocked,
                onClick: () => { void openNative(); },
                children: nativePending ? '正在打开…' : '打开全屏拍摄现场'
              }),
              react_jsx_runtime.jsx('button', { type: 'button', disabled: !canInline,
                onClick: () => {
                  setInlinePlaying(false);
                  setInlineOpen((current) => !current);
                }, children: inlineOpen ? '收起页内简版' : '打开页内简版'
              }),
              react_jsx_runtime.jsx('button', { type: 'button', className: 'wd10-refresh',
                disabled: documentState.status === 'loading'
                  || historyState.status === 'loading',
                onClick: refresh, children: '刷新口播稿与拍摄记录'
              })
            ] }),
            nativeBlocked && react_jsx_runtime.jsx('p', {
              className: 'wd10-incomplete', role: 'status', children:
                feedback || '全屏拍摄现场结果未知；请先检查桌面，不要重复点击。'
            }),
            !nativeBlocked && feedback && react_jsx_runtime.jsx('p', {
              className: 'wd10-feedback', role: 'status', children: feedback
            }),
            !canInline && documentState.status !== 'loading'
              && react_jsx_runtime.jsx('p', { className: 'wd10-feedback', children:
                '页内简版只会在口播稿全文完整读回后开放。'
              })
          ] }),
          react_jsx_runtime.jsxs('section', { className: 'wd10-card', children: [
            react_jsx_runtime.jsx('h3', { children: '页内简版提词器' }),
            react_jsx_runtime.jsx('p', { className: 'wd10-shootTruth', children:
              '页内简版只在当前页面滚动，不记录镜头完成状态，也不会写入拍摄记录。'
            }),
            inlineOpen && canInline && react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, { children: [
              react_jsx_runtime.jsxs('div', { className: 'wd10-prompterControls', children: [
                react_jsx_runtime.jsx('button', { type: 'button',
                  onClick: () => setInlinePlaying(true), disabled: inlinePlaying,
                  children: '开始'
                }),
                react_jsx_runtime.jsx('button', { type: 'button',
                  onClick: () => setInlinePlaying(false), disabled: !inlinePlaying,
                  children: '暂停'
                }),
                react_jsx_runtime.jsx('button', { type: 'button', onClick: resetInline,
                  children: '重置'
                })
              ] }),
              react_jsx_runtime.jsxs('div', { className: 'wd10-prompterChoices', children: [
                ...[0.8, 1, 1.2].map((value) => react_jsx_runtime.jsx('button', {
                  type: 'button', 'aria-pressed': speed === value,
                  onClick: () => setSpeed(value), children: `${value} 倍`
                }, `speed-${value}`)),
                react_jsx_runtime.jsx('button', { type: 'button',
                  'aria-pressed': fontSize === 'medium', onClick: () => setFontSize('medium'),
                  children: '中字'
                }),
                react_jsx_runtime.jsx('button', { type: 'button',
                  'aria-pressed': fontSize === 'large', onClick: () => setFontSize('large'),
                  children: '大字'
                })
              ] }),
              react_jsx_runtime.jsx('div', { ref: scrollRef, className: 'wd10-prompter',
                'data-font': fontSize, tabIndex: 0, 'aria-label': '页内简版提词正文', children:
                  react_jsx_runtime.jsx('pre', { children: promptText })
              })
            ] })
          ] }),
          react_jsx_runtime.jsxs('section', {
            className: 'wd10-card', 'data-shoot-history': true, children: [
              react_jsx_runtime.jsxs('div', { className: 'wd10-shootHead', children: [
                react_jsx_runtime.jsxs('div', { children: [
                  react_jsx_runtime.jsx('h3', { children: '本地拍摄记录' }),
                  react_jsx_runtime.jsx('p', { className: 'wd10-shootTruth', children:
                    '以下是 WhaleDock 标记的本地收工记录；不是视频、设备或平台数据回读。'
                  })
                ] }),
                react_jsx_runtime.jsx('button', { type: 'button', className: 'wd10-refresh',
                  disabled: historyState.status === 'loading', onClick: refresh,
                  children: '刷新拍摄记录'
                })
              ] }),
              historyState.status === 'loading' && historyState.records.length === 0
                && react_jsx_runtime.jsx('p', { children: '正在读取 WhaleDock 本地收工记录…' }),
              historyState.status === 'error' && historyState.records.length === 0
                && react_jsx_runtime.jsx('p', { role: 'status', children:
                  '本地收工记录暂时读不到；没有推断任何记录。'
                }),
              historyState.status === 'stale-read'
                && react_jsx_runtime.jsx('p', { className: 'wd10-incomplete', role: 'status', children:
                  '拍摄记录刷新失败；以下保留上次成功结果，不代表当前文件状态。'
                }),
              historyState.status === 'partial'
                && react_jsx_runtime.jsx('p', { className: 'wd10-incomplete', role: 'status', children:
                  `拍摄记录读取不完整；只显示已成功读取的 ${historyState.records.length} 条 WhaleDock 本地记录。`
                }),
              historyState.status === 'loading' && historyState.records.length > 0
                && react_jsx_runtime.jsx('p', { className: 'wd10-incomplete', role: 'status', children:
                  '正在重新读取拍摄记录；以下暂存上次已验证条目。'
                }),
              historyState.status === 'ready' && historyState.records.length === 0
                && react_jsx_runtime.jsx('p', { children: '还没有 WhaleDock 标记的本地收工记录。' }),
              react_jsx_runtime.jsx('div', { className: 'wd10-shootRecords', children:
                historyState.records.map((record) => react_jsx_runtime.jsxs('article', {
                  className: 'wd10-shootRecord', 'data-shoot-record-ref': record.recordRef,
                  'data-confirmed': record.allConfirmed, children: [
                    react_jsx_runtime.jsx('h4', { children: record.title }),
                    react_jsx_runtime.jsx('p', { children:
                      `记录中写着：确认 ${record.confirmedCount}/${record.totalShots}、缺拍 ${record.missingCount}、重来 ${record.retakeCount}`
                    })
                  ]
                }, record.recordRef))
              })
            ]
          })
        ]
      });
    }

    function ReviewPanel({ project, workspaceFiles, workspaceIdentity, onCatalogRefresh }) {
      const [documentState, setDocumentState] = react.useState({ status: 'idle', document: null });
      const [tacticsState, setTacticsState] = react.useState({
        status: 'idle', header: null, tactics: [], highlight: null, readbackMissing: false
      });
      const [feedback, setFeedback] = react.useState('');
      const [pending, setPending] = react.useState(false);
      const [mutationBlocked, setMutationBlocked] = react.useState(false);
      const [readRefreshKey, setReadRefreshKey] = react.useState(0);
      const readAttempt = react.useRef(0);
      const readAbort = react.useRef(null);
      const mutationAttempt = react.useRef(0);
      const mutationAbort = react.useRef(null);
      const pendingRef = react.useRef(false);
      const readIdentityRef = react.useRef(null);
      const documentCacheRef = react.useRef(null);
      const tacticsCacheRef = react.useRef(null);
      const tacticReadbackRef = react.useRef(null);
      const viewIdentity = project
        ? `${String(workspaceIdentity || '')}\u0000${project.contentRef}\u0000${project.projectToken}`
        : null;

      const clearStale = (message) => {
        readAttempt.current += 1;
        readAbort.current?.abort();
        readAbort.current = null;
        documentCacheRef.current = null;
        tacticsCacheRef.current = null;
        tacticReadbackRef.current = null;
        setDocumentState({ status: 'error', document: null });
        setTacticsState({
          status: 'error', header: null, tactics: [], highlight: null, readbackMissing: false
        });
        setMutationBlocked(true);
        setFeedback(message);
        onCatalogRefresh?.();
      };

      react.useLayoutEffect(() => {
        const identityChanged = readIdentityRef.current !== viewIdentity;
        readIdentityRef.current = viewIdentity;
        const attempt = ++readAttempt.current;
        readAbort.current?.abort();
        const controller = new AbortController();
        readAbort.current = controller;
        mutationAttempt.current += 1;
        mutationAbort.current?.abort();
        mutationAbort.current = null;
        pendingRef.current = false;
        setPending(false);
        setMutationBlocked(false);
        if (identityChanged) {
          documentCacheRef.current = null;
          tacticsCacheRef.current = null;
          tacticReadbackRef.current = null;
          setFeedback('');
        }
        const priorDocument = !identityChanged
          && documentCacheRef.current?.identity === viewIdentity
          ? documentCacheRef.current.document : null;
        const priorTactics = !identityChanged
          && tacticsCacheRef.current?.identity === viewIdentity
          ? tacticsCacheRef.current.value : null;
        setDocumentState({
          status: project ? 'loading' : 'idle', document: priorDocument
        });
        setTacticsState(priorTactics ? {
          ...priorTactics, status: 'loading'
        } : {
          status: project ? 'loading' : 'idle', header: null,
          tactics: [], highlight: null, readbackMissing: false
        });
        if (!project || !workspaceFiles || typeof workspaceFiles.execute !== 'function') {
          if (project) {
            setDocumentState({ status: 'error', document: null });
            setTacticsState({
              status: 'error', header: null, tactics: [], highlight: null, readbackMissing: false
            });
          }
          return () => controller.abort();
        }
        const expected = Object.freeze({
          contentRef: project.contentRef, projectToken: project.projectToken
        });
        const invalidateRead = (message) => {
          if (controller.signal.aborted || readAttempt.current !== attempt) return;
          readAttempt.current += 1;
          controller.abort();
          if (readAbort.current === controller) readAbort.current = null;
          documentCacheRef.current = null;
          tacticsCacheRef.current = null;
          tacticReadbackRef.current = null;
          setDocumentState({ status: 'error', document: null });
          setTacticsState({
            status: 'error', header: null, tactics: [], highlight: null, readbackMissing: false
          });
          setMutationBlocked(true);
          setFeedback(message);
          onCatalogRefresh?.();
        };
        const readDocument = async () => {
          let cursor = 0;
          let first = null;
          let last = null;
          let complete = false;
          let failed = false;
          const blocks = [];
          const seen = new Set();
          for (let pageIndex = 0; pageIndex < 2048; pageIndex += 1) {
            let snapshot = null;
            try {
              snapshot = await workspaceFiles.execute('document.read', {
                projectToken: expected.projectToken, cursor, limit: 2
              }, controller.signal);
            } catch (_error) { snapshot = null; }
            if (controller.signal.aborted || readAttempt.current !== attempt) return;
            if (snapshot?.code === 'operation-stale') {
              invalidateRead('复盘文件已变化；已清空旧视图并刷新内容库。');
              return null;
            }
            const page = documentPageResult(snapshot, expected.projectToken, cursor);
            if (!page || first && !sameDocumentHeader(first, page)) {
              failed = true;
              break;
            }
            first ||= page;
            last = page;
            let duplicate = false;
            for (const block of page.blocks) {
              if (seen.has(block.blockToken)) { duplicate = true; break; }
              seen.add(block.blockToken);
              blocks.push(block);
            }
            if (duplicate) { failed = true; break; }
            if (page.nextCursor === null) { complete = true; break; }
            cursor = page.nextCursor;
          }
          if (controller.signal.aborted || readAttempt.current !== attempt) return null;
          if (!first) {
            if (priorDocument) setDocumentState({ status: 'stale-read', document: priorDocument });
            else setDocumentState({ status: 'error', document: null });
            return null;
          }
          const document = Object.freeze({
            ...first,
            blocks: Object.freeze(blocks),
            truncated: last?.truncated === true || blocks.some((block) => block.textTruncated)
          });
          const value = { status: complete && !failed ? 'ready' : 'partial', document };
          documentCacheRef.current = { identity: viewIdentity, document };
          setDocumentState(value);
          return document;
        };
        const readTactics = async () => {
          let cursor = 0;
          let collectionToken = null;
          let first = null;
          let completePages = false;
          let failed = false;
          const tactics = [];
          const seenContentRefs = new Set();
          const seenProjectTokens = new Set();
          for (let pageIndex = 0; pageIndex < MAX_TACTIC_PAGES; pageIndex += 1) {
            let snapshot = null;
            try {
              snapshot = await workspaceFiles.execute('review.tactics.read', {
                ...expected, cursor, limit: 4, collectionToken
              }, controller.signal);
            } catch (_error) { snapshot = null; }
            if (controller.signal.aborted || readAttempt.current !== attempt) return;
            if (snapshot?.code === 'operation-stale') {
              invalidateRead('打法库文件已变化；已清空旧视图并刷新内容库。');
              return;
            }
            const page = tacticsPageResult(snapshot, {
              ...expected, cursor, collectionToken
            });
            if (!page || first && !sameTacticsHeader(first, page)) {
              failed = true;
              break;
            }
            first ||= page;
            collectionToken = page.collectionToken;
            let duplicate = false;
            for (const tactic of page.tactics) {
              if (seenContentRefs.has(tactic.contentRef)
                  || seenProjectTokens.has(tactic.projectToken)) {
                duplicate = true;
                break;
              }
              seenContentRefs.add(tactic.contentRef);
              seenProjectTokens.add(tactic.projectToken);
              tactics.push(tactic);
            }
            if (duplicate) { failed = true; break; }
            if (page.nextCursor === null) { completePages = true; break; }
            cursor = page.nextCursor;
          }
          if (controller.signal.aborted || readAttempt.current !== attempt) return;
          if (!first) {
            if (priorTactics) setTacticsState({ ...priorTactics, status: 'stale-read' });
            else setTacticsState({
              status: 'error', header: null, tactics: [], highlight: null, readbackMissing: false
            });
            return;
          }
          const readback = tacticReadbackRef.current?.identity === viewIdentity
            ? tacticReadbackRef.current.tactic : null;
          const foundReadback = readback
            && tactics.some((tactic) => tactic.contentRef === readback.contentRef);
          if (foundReadback) tacticReadbackRef.current = null;
          else if (readback && !seenContentRefs.has(readback.contentRef)
              && !seenProjectTokens.has(readback.projectToken)) tactics.unshift(readback);
          const highlight = readback?.contentRef || priorTactics?.highlight || null;
          const readbackMissing = Boolean(readback && !foundReadback);
          const header = Object.freeze({
            contentRef: first.contentRef, projectToken: first.projectToken,
            collectionToken: first.collectionToken, itemCount: first.itemCount,
            complete: first.complete
          });
          const value = Object.freeze({
            status: completePages && !failed && first.complete && !readbackMissing
              ? 'ready' : 'partial',
            header, tactics: Object.freeze(tactics), highlight, readbackMissing
          });
          tacticsCacheRef.current = { identity: viewIdentity, value };
          setTacticsState(value);
        };
        const read = async () => {
          const currentDocument = await readDocument();
          if (controller.signal.aborted || readAttempt.current !== attempt) return;
          if (!currentDocument) {
            if (priorTactics) setTacticsState({ ...priorTactics, status: 'stale-read' });
            else setTacticsState({
              status: 'error', header: null, tactics: [], highlight: null,
              readbackMissing: false
            });
            return;
          }
          if (currentDocument.stage !== 'review') {
            tacticsCacheRef.current = null;
            tacticReadbackRef.current = null;
            setTacticsState({
              status: 'not-applicable', header: null, tactics: [], highlight: null,
              readbackMissing: false
            });
            return;
          }
          await readTactics();
        };
        void read();
        return () => {
          controller.abort();
          if (readAbort.current === controller) readAbort.current = null;
        };
      }, [project?.contentRef, project?.projectToken, workspaceIdentity,
        workspaceFiles, readRefreshKey]);

      react.useEffect(() => () => {
        readAttempt.current += 1;
        readAbort.current?.abort();
        readAbort.current = null;
        mutationAttempt.current += 1;
        mutationAbort.current?.abort();
        mutationAbort.current = null;
        pendingRef.current = false;
      }, []);

      const solidify = async () => {
        const document = documentState.document;
        const wallReady = tacticsState.status === 'ready'
          && tacticsState.header?.complete === true && !tacticsState.readbackMissing;
        if (!project || documentState.status !== 'ready' || !document
            || document.stage !== 'review' || document.truncated || document.blockCount === 0
            || !wallReady || mutationBlocked || pendingRef.current) return;
        pendingRef.current = true;
        setPending(true);
        setFeedback('正在显式固化到本地打法库…');
        const controller = new AbortController();
        mutationAbort.current = controller;
        const attempt = ++mutationAttempt.current;
        const expected = Object.freeze({
          contentRef: project.contentRef, projectToken: project.projectToken
        });
        try {
          const snapshot = await workspaceFiles.execute(
            'review.solidify', expected, controller.signal
          );
          if (controller.signal.aborted || mutationAttempt.current !== attempt) return;
          const result = reviewSolidifyResult(snapshot, expected);
          if (!result) {
            if (snapshot?.code === 'operation-stale') {
              clearStale('复盘文件已变化；已清空旧视图并刷新内容库。');
            } else if (snapshot?.code === 'outcome-unknown'
                || snapshot?.state === 'fulfilled') {
              setMutationBlocked(true);
              setFeedback('固化结果未知；以下保留旧视图。请核对 07_打法库 文件，不要重复点击。');
            } else setFeedback(operationError(snapshot,
              '固化没有完成；本地复盘和打法库没有被推断为已变化。'));
            return;
          }
          const readback = Object.freeze({ identity: viewIdentity, tactic: result.tactic });
          tacticReadbackRef.current = readback;
          setMutationBlocked(false);
          setTacticsState((current) => {
            const tactics = [result.tactic,
              ...current.tactics.filter((tactic) => tactic.contentRef !== result.tactic.contentRef)];
            const value = Object.freeze({
              ...current, status: 'loading', tactics: Object.freeze(tactics),
              highlight: result.tactic.contentRef, readbackMissing: true
            });
            tacticsCacheRef.current = { identity: viewIdentity, value };
            return value;
          });
          setFeedback(result.created
            ? result.message || '已显式固化进本地打法库。'
            : `已定位既有打法；没有重复创建。${result.message ? ` ${result.message}` : ''}`);
          onCatalogRefresh?.();
          setReadRefreshKey((current) => current + 1);
        } catch (_error) {
          if (!controller.signal.aborted && mutationAttempt.current === attempt) {
            setMutationBlocked(true);
            setFeedback('固化结果未知；以下保留旧视图。请核对 07_打法库 文件，不要重复点击。');
          }
        } finally {
          if (mutationAbort.current === controller) mutationAbort.current = null;
          if (mutationAttempt.current === attempt) {
            pendingRef.current = false;
            setPending(false);
          }
        }
      };

      const document = documentState.document;
      const isReview = document?.stage === 'review';
      const wallReady = tacticsState.status === 'ready'
        && tacticsState.header?.complete === true && !tacticsState.readbackMissing;
      const canSolidify = documentState.status === 'ready' && isReview
        && !document.truncated && document.blockCount > 0 && wallReady
        && !mutationBlocked && !pending;
      const refresh = () => {
        setFeedback('');
        setReadRefreshKey((current) => current + 1);
      };
      const documentCard = !project ? react_jsx_runtime.jsx('section', {
        className: 'wd10-card', children: react_jsx_runtime.jsx('p', {
          children: '请从左侧选择一张真实内容卡。'
        })
      }) : documentState.status === 'loading' && !document
        ? react_jsx_runtime.jsx('section', { className: 'wd10-card', children:
          react_jsx_runtime.jsx('p', { children: '正在读取本地复盘正文…' }) })
        : !document ? react_jsx_runtime.jsxs('section', { className: 'wd10-card', children: [
          react_jsx_runtime.jsx('p', { role: 'status', children:
            '复盘正文暂时读不到；没有使用内容卡摘要冒充正文。' }),
          react_jsx_runtime.jsx('button', { type: 'button', className: 'wd10-refresh',
            onClick: refresh, children: '重新读取复盘与打法库' })
        ] }) : !isReview ? react_jsx_runtime.jsxs('section', {
          className: 'wd10-card', children: [
            react_jsx_runtime.jsx('h3', { children: '当前内容不是复盘文件' }),
            react_jsx_runtime.jsx('p', { role: 'status', children:
              `当前“${document.stageLabel}”阶段不能固化；不会把其他正文冒充复盘。`
            })
          ]
        }) : react_jsx_runtime.jsxs('section', { className: 'wd10-card', children: [
          react_jsx_runtime.jsxs('div', { className: 'wd10-reviewHead', children: [
            react_jsx_runtime.jsxs('div', { children: [
              react_jsx_runtime.jsx('h3', { children: '真实本地复盘' }),
              react_jsx_runtime.jsx('p', { children: `${document.title} · ${document.stageLabel}` })
            ] }),
            react_jsx_runtime.jsx('span', { children:
              `${document.blocks.length}/${document.blockCount} 块` })
          ] }),
          ['partial', 'stale-read'].includes(documentState.status)
            && react_jsx_runtime.jsx('p', { className: 'wd10-incomplete', role: 'status', children:
              documentState.status === 'partial'
                ? `复盘正文读取不完整；只显示已成功读取的 ${document.blocks.length}/${document.blockCount} 块。`
                : '复盘正文刷新失败；以下保留上次成功结果，不代表当前文件状态。'
            }),
          document.truncated && react_jsx_runtime.jsx('p', {
            className: 'wd10-incomplete', role: 'status', children:
              '复盘正文投影含截断内容；当前不会开放固化。'
          }),
          document.blocks.length === 0 && react_jsx_runtime.jsx('p', {
            className: 'wd10-feedback', children: '这份真实复盘没有可显示的正文块。'
          }),
          react_jsx_runtime.jsx('div', { className: 'wd10-reviewBlocks', children:
            document.blocks.map((block) => react_jsx_runtime.jsxs('article', {
              className: 'wd10-reviewBlock', 'data-review-block': block.kind, children: [
                react_jsx_runtime.jsxs('div', { className: 'wd10-reviewMeta', children: [
                  react_jsx_runtime.jsx('strong', { children: block.kind }),
                  react_jsx_runtime.jsx('span', { children:
                    `第 ${block.startLine}-${block.endLine} 行` })
                ] }),
                react_jsx_runtime.jsx('pre', { children: block.text }),
                block.textTruncated && react_jsx_runtime.jsx('p', {
                  className: 'wd10-incomplete', children: '这一块正文已截断。'
                })
              ]
            }, block.blockToken)) })
        ] });

      const wall = react_jsx_runtime.jsxs('section', {
        className: 'wd10-card', 'data-tactic-wall': true, children: [
          react_jsx_runtime.jsx('h3', { children: '本地打法库墙' }),
          react_jsx_runtime.jsx('p', { className: 'wd10-reviewTruth', children:
            '一期没有平台数据通道；以下都是本地文件，不显示播放量、评论聚类、使用次数或胜率。'
          }),
          tacticsState.status === 'loading' && tacticsState.tactics.length === 0
            && react_jsx_runtime.jsx('p', { children: '正在读取本地打法库…' }),
          tacticsState.status === 'error' && tacticsState.tactics.length === 0
            && react_jsx_runtime.jsx('p', { role: 'status', children:
              '打法库暂时读不到；没有推断任何本地条目。'
            }),
          tacticsState.status === 'not-applicable'
            && react_jsx_runtime.jsx('p', { role: 'status', children:
              '选择真实复盘文件后，才会读取本地打法库。'
            }),
          tacticsState.status === 'stale-read' && react_jsx_runtime.jsx('p', {
            className: 'wd10-incomplete', role: 'status', children:
              '打法库刷新失败；以下保留上次成功结果，不代表当前文件状态。'
          }),
          tacticsState.status === 'partial' && react_jsx_runtime.jsx('p', {
            className: 'wd10-incomplete', role: 'status', children:
              tacticsState.readbackMissing
                ? '刚返回的本地打法尚未在分页刷新中读回；已保留返回结果并标为不完整。'
                : `打法库读取不完整；只显示已成功读取的 ${tacticsState.tactics.length} 条本地条目。`
          }),
          tacticsState.status === 'loading' && tacticsState.tactics.length > 0
            && react_jsx_runtime.jsx('p', { className: 'wd10-incomplete', role: 'status', children:
              '正在重新读取打法库；以下暂存上次已验证或刚返回的本地条目。'
            }),
          tacticsState.tactics.length === 0 && tacticsState.status === 'ready'
            && react_jsx_runtime.jsx('p', { children: '本地打法库还没有条目。' }),
          react_jsx_runtime.jsx('div', { className: 'wd10-tacticWall', children:
            tacticsState.tactics.map((tactic) => react_jsx_runtime.jsxs('article', {
              className: 'wd10-tactic', 'data-tactic-ref': tactic.contentRef,
              'data-highlight': tacticsState.highlight === tactic.contentRef, children: [
                react_jsx_runtime.jsxs('div', { className: 'wd10-tacticMeta', children: [
                  react_jsx_runtime.jsx('span', { className: 'wd10-tacticBadge', children:
                    '本地收录 · 待验证' }),
                  react_jsx_runtime.jsx('span', { children:
                    tactic.updated ? `更新 ${tactic.updated}` : '更新时间未写明' })
                ] }),
                react_jsx_runtime.jsx('h4', { children: tactic.title }),
                react_jsx_runtime.jsx('p', { children:
                  tactic.summary || '这条本地打法没有可显示的摘要。' }),
                tactic.summaryTruncated && react_jsx_runtime.jsx('p', {
                  className: 'wd10-incomplete', children: '摘要已截断。'
                }),
                react_jsx_runtime.jsx('p', { children:
                  `来源：${tactic.sourceTitle || '本地来源未标明'}` })
              ]
            }, tactic.contentRef)) })
        ]
      });

      return react_jsx_runtime.jsxs('section', {
        className: 'wd10-review', 'data-whaledock-review': true, children: [
          mutationBlocked && react_jsx_runtime.jsxs('div', { children: [
            react_jsx_runtime.jsx('p', { className: 'wd10-incomplete', role: 'status', children:
              feedback || '当前结果需要重新读取；本地固化已锁定。'
            }),
            react_jsx_runtime.jsx('button', { type: 'button', className: 'wd10-refresh',
              onClick: refresh, children: '重新读取复盘与打法库' })
          ] }),
          documentCard,
          react_jsx_runtime.jsxs('section', { className: 'wd10-card', children: [
            react_jsx_runtime.jsx('h3', { children: '显式固化' }),
            react_jsx_runtime.jsx('p', { children: '打法只能由你从真实复盘显式固化。' }),
            react_jsx_runtime.jsx('button', { type: 'button', className: 'wd10-solidify',
              disabled: !canSolidify, onClick: () => { void solidify(); },
              children: pending ? '正在固化…' : '显式固化进打法库'
            }),
            !isReview && document && react_jsx_runtime.jsx('p', {
              className: 'wd10-feedback', children: '只有真实复盘文件可以执行这一步。'
            }),
            isReview && !canSolidify && !pending && !mutationBlocked
              && react_jsx_runtime.jsx('p', { className: 'wd10-feedback', children:
                '请先完整读回复盘正文和本地打法库，再执行固化。'
              }),
            !mutationBlocked && feedback && react_jsx_runtime.jsx('p', {
              className: 'wd10-feedback', role: 'status', children: feedback
            })
          ] }),
          wall
        ]
      });
    }

    function CreatorDetail({ routingProject, project, tab, onTab, workspaceFiles,
      workspaceIdentity, alignment, onAlign, panelCollapseRef, onPanelCollapse, onCatalogRefresh,
      onProjectMutation, onPublishCreated, embedded = false }) {
      const [preflight, setPreflight] = react.useState(null);
      const [feedback, setFeedback] = react.useState('');
      const [pending, setPending] = react.useState(false);
      const [receiptRefresh, setReceiptRefresh] = react.useState(0);
      const [proposalRefresh, setProposalRefresh] = react.useState(0);
      const [preflightRemaining, setPreflightRemaining] = react.useState(null);
      const pendingRef = react.useRef(false);
      const actionAttempt = react.useRef(0);
      const actionAbort = react.useRef(null);
      const preparedActionRef = react.useRef(null);
      react.useEffect(() => {
        actionAttempt.current += 1;
        actionAbort.current?.abort();
        actionAbort.current = null;
        pendingRef.current = false;
        setPending(false);
        setPreflight(null);
        setPreflightRemaining(null);
        setFeedback('');
        preparedActionRef.current = null;
        return () => {
          actionAttempt.current += 1;
          actionAbort.current?.abort();
          actionAbort.current = null;
          pendingRef.current = false;
        };
      }, [project?.contentRef, project?.projectToken, workspaceFiles]);
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
      const runPreparedAction = async (spec, options = {}) => {
        if (!project || pendingRef.current) return;
        preparedActionRef.current = spec;
        pendingRef.current = true;
        setPending(true);
        setPreflight(null);
        setFeedback('正在确认投递去向…');
        const controller = new AbortController();
        actionAbort.current = controller;
        const attempt = ++actionAttempt.current;
        try {
          const retryAlignmentTransient = options.retryAlignmentTransient === true
            && ['project.action.prepare', 'block.action.prepare'].includes(spec.prepareOperation);
          const retryDeadline = retryAlignmentTransient
            ? Date.now() + PREFLIGHT_TIMEOUT_MS : 0;
          let snapshot;
          do {
            snapshot = await workspaceFiles.execute(
              spec.prepareOperation, spec.prepareInput, controller.signal
            );
            if (actionAttempt.current !== attempt) return;
            if (!retryAlignmentTransient
                || snapshot?.state !== 'rejected'
                || !['workspace-unavailable', 'operation-stale'].includes(snapshot.code)
                || Date.now() >= retryDeadline) break;
            const retryDelay = Math.min(PREFLIGHT_RETRY_MS, retryDeadline - Date.now());
            if (retryDelay <= 0) break;
            const waited = await new Promise((resolve) => {
              if (controller.signal.aborted) { resolve(false); return; }
              let timer = null;
              const finish = (value) => {
                if (timer !== null) globalThis.clearTimeout(timer);
                controller.signal.removeEventListener('abort', onAbort);
                resolve(value);
              };
              const onAbort = () => finish(false);
              controller.signal.addEventListener('abort', onAbort, { once: true });
              timer = globalThis.setTimeout(() => finish(true), retryDelay);
            });
            if (!waited) return;
          } while (Date.now() <= retryDeadline);
          if (actionAttempt.current !== attempt) return;
          let value = snapshot?.state === 'fulfilled' ? snapshot.result : null;
          if (spec.scope === 'block') {
            value = blockPreflightResult(snapshot, spec.expected);
            if (value?.state === 'error') {
              setFeedback(value.message);
              return;
            }
          }
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
            scope: spec.scope,
            submitOperation: spec.submitOperation,
            submitInput: Object.freeze({ ...spec.submitInput }),
            preflightToken: value.preflightToken,
            projectToken: project.projectToken,
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
      const runPrepare = (action) => runPreparedAction({
        scope: 'project', prepareOperation: 'project.action.prepare',
        prepareInput: { projectToken: project.projectToken, actionId: action.id },
        submitOperation: 'project.action.submit',
        submitInput: { projectToken: project.projectToken, actionId: action.id }
      });
      const runBlockPrepare = (block, action) => runPreparedAction({
        scope: 'block', prepareOperation: 'block.action.prepare',
        prepareInput: { projectToken: project.projectToken, blockToken: block.blockToken, action },
        submitOperation: 'block.action.submit',
        submitInput: { projectToken: project.projectToken, blockToken: block.blockToken, action },
        expected: {
          contentRef: project.contentRef, projectToken: project.projectToken,
          blockToken: block.blockToken, action
        }
      });
      const cancelPreflight = () => {
        if (pendingRef.current) return;
        setPreflight(null);
        setFeedback('已取消，没有发送。');
      };
      const alignThenRetryPreflight = async () => {
        if (!preflight || pendingRef.current) return;
        const spec = preparedActionRef.current;
        if (!spec || typeof onAlign !== 'function') {
          setFeedback('暂时回不到这条内容的对话；没有发送。');
          return;
        }
        setPreflight(null);
        setPreflightRemaining(null);
        pendingRef.current = true;
        setPending(true);
        setFeedback('正在回到这条内容的对话…');
        const attempt = ++actionAttempt.current;
        try {
          const result = await onAlign();
          if (actionAttempt.current !== attempt) return;
          pendingRef.current = false;
          setPending(false);
          if (result?.ok !== true) {
            setFeedback('暂时回不到这条内容的对话；没有发送。');
            return;
          }
          // sessions.open 的官方 store 已精确落稳，但 main 的认证 selection/stage
          // 可能还差一个 tick。只重试无副作用的 prepare，submit 与未知结果永不重试。
          await runPreparedAction(spec, { retryAlignmentTransient: true });
        } catch (_error) {
          if (actionAttempt.current === attempt) {
            setFeedback('暂时回不到这条内容的对话；没有发送。');
          }
        } finally {
          if (actionAttempt.current === attempt) {
            pendingRef.current = false;
            setPending(false);
          }
        }
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
          const snapshot = await workspaceFiles.execute(frozen.submitOperation, {
            ...frozen.submitInput,
            preflightToken: frozen.preflightToken,
            override: frozen.workspaceMatch !== 'match'
          }, controller.signal);
          if (actionAttempt.current !== attempt) return;
          const value = frozen.scope === 'block'
            ? blockSubmissionResult(snapshot, {
              contentRef: project.contentRef,
              projectToken: frozen.submitInput.projectToken,
              blockToken: frozen.submitInput.blockToken,
              action: frozen.submitInput.action
            })
            : (snapshot?.state === 'fulfilled' ? snapshot.result : null);
          setPreflight(null);
          if (!plain(value) || !['accepted', 'rejected', 'unknown', 'error'].includes(value.state)) {
            setFeedback(operationError(snapshot));
            return;
          }
          setFeedback(value.message || (value.state === 'accepted'
            ? `已提交到 ${boundedUiText(value.target, '目标会话', 96)}；任务状态会继续更新。`
            : value.state === 'rejected'
              ? `目标拒绝投递（${boundedUiText(value.reason, '原因未说明', 64)}）；没有重复发送。`
              : value.state === 'error' ? '提交失败；没有重复发送。'
                : '提交结果未知；请核对任务状态，不要重复点击。'));
          setReceiptRefresh((current) => current + 1);
          if (frozen.scope === 'block' && value.state === 'accepted') {
            setProposalRefresh((current) => current + 1);
          } else if (frozen.scope === 'project') onCatalogRefresh?.();
        } catch (_error) {
          if (actionAttempt.current === attempt) {
            setPreflight(null);
            setFeedback('提交结果未知；请核对右栏和任务状态，不要重复点击。');
          }
        } finally {
          if (actionAbort.current === controller) actionAbort.current = null;
          if (actionAttempt.current === attempt) { pendingRef.current = false; setPending(false); }
        }
      };
      const title = project?.title || routingProject?.title || '未选择内容';
      return react_jsx_runtime.jsxs('div', {
        className: embedded ? 'wd10-detail wd11-templateDetail' : 'wd10-detail',
        'data-template-five-stage': embedded || undefined,
        children: [
        alignment && react_jsx_runtime.jsxs('div', { className: 'wd10-banner', role: 'alert', children: [
          react_jsx_runtime.jsx('span', { children: alignment.pending
            ? '正在连到这条内容的对话…'
            : `右边的对话现在不在这条内容的文件夹里。${alignment.error || ''}` }),
          !alignment.pending && alignment.canAlign !== false
            && react_jsx_runtime.jsx('button', { type: 'button',
            onClick: onAlign, children: '回到这条内容的对话' })
        ] }),
        react_jsx_runtime.jsxs('header', { className: 'wd10-detailHead', children: [
          react_jsx_runtime.jsx('div', { className: 'wd10-eyebrow', children: '第2步 推进当前内容' }),
          !embedded && react_jsx_runtime.jsx('button', { ref: panelCollapseRef, type: 'button',
            className: 'wd10-collapseButton', onClick: onPanelCollapse, children: '只看 AI 对话' }),
          react_jsx_runtime.jsx('h1', { children: title }),
          react_jsx_runtime.jsx('p', { children: project
            ? `${project.workflowLabel} · ${project.updated ? `更新 ${project.updated}` : '更新时间未写明'}`
            : '请从左侧选择一张真实内容卡。' })
        ] }),
        react_jsx_runtime.jsx('nav', { className: 'wd10-tabs', 'aria-label': '项目阶段', children:
          CREATOR_TABS.map(([id, label]) => react_jsx_runtime.jsx('button', {
            type: 'button', 'aria-selected': tab === id, onClick: () => onTab(id), children: label
          }, id)) }),
        react_jsx_runtime.jsx(TaskReceiptStrip, {
          projectToken: project?.projectToken || null,
          workspaceFiles, preflight, pending, feedback,
          onConfirm: () => { void confirmPreflight(); },
          onAlignThenRetry: () => { void alignThenRetryPreflight(); }, onCancel: cancelPreflight,
          refreshKey: receiptRefresh, onCatalogRefresh, preflightRemaining
        }),
        react_jsx_runtime.jsx('main', { className: 'wd10-panel', children: tab === 'overview'
          ? react_jsx_runtime.jsx(OverviewPanel, {
            project, workspaceFiles, actions: project?.actions || [], actionPending: pending,
            onAction: (action) => { void runPrepare(action); },
            onMutation: onProjectMutation
          })
          : tab === 'script' ? react_jsx_runtime.jsx(ScriptPanel, {
            project, workspaceFiles, actionPending: pending,
            onBlockAction: (block, action) => { void runBlockPrepare(block, action); },
            proposalRefreshKey: proposalRefresh,
            onProjectMutation
          })
          : tab === 'shoot' ? react_jsx_runtime.jsx(ShootPanel, {
            project, workspaceFiles, workspaceIdentity, onCatalogRefresh
          })
          : tab === 'publish' ? react_jsx_runtime.jsx(PublishPanel, {
            project, workspaceFiles, workspaceIdentity,
            onProjectMutation, onPublishCreated, onCatalogRefresh
          }) : tab === 'review' ? react_jsx_runtime.jsx(ReviewPanel, {
            project, workspaceFiles, workspaceIdentity, onCatalogRefresh
          }) : react_jsx_runtime.jsxs('section', {
            className: 'wd10-card wd10-unfinished', 'data-whaledock-unfinished': true, children: [
              react_jsx_runtime.jsx('h3', { children:
                CREATOR_TABS.find(([id]) => id === tab)?.[1] || '概览' }),
              react_jsx_runtime.jsx('strong', { children: '这一格还没做' }),
              react_jsx_runtime.jsx('p', { children: '这里还没有接通真实文件能力，不会用静态卡冒充已实现。' })
            ]
          }) })
      ] });
    }

    function createProjectActions(ctx, alignmentScope) {
      const pendingWorkspaces = new Map();
      const workspaceIdsByPath = new Map();
      const pendingConnections = new Map();
      const rememberedConnections = new Map();
      const sharedScope = typeof alignmentScope === 'string' && ID_RE.test(alignmentScope)
        ? alignmentScope : null;

      const sharedKey = (workspaceId) => {
        const value = String(workspaceId ?? '');
        return sharedScope !== null && ID_RE.test(value)
          ? `${ALIGNMENT_STORAGE_PREFIX}${sharedScope}.${value}` : null;
      };
      const readShared = (workspaceId) => {
        const key = sharedKey(workspaceId);
        if (key === null) return null;
        try {
          const value = JSON.parse(globalThis.localStorage.getItem(key));
          if (!exact(value, ['schema', 'sessionId', 'observed']) || value.schema !== 1
              || !OPAQUE_VALUE_RE.test(String(value.sessionId || ''))
              || typeof value.observed !== 'boolean') return null;
          return Object.freeze({ sessionId: value.sessionId, observed: value.observed });
        } catch (_error) {
          return null;
        }
      };
      const writeShared = (workspaceId, value) => {
        const key = sharedKey(workspaceId);
        if (key === null || !OPAQUE_VALUE_RE.test(String(value?.sessionId || ''))
            || typeof value?.observed !== 'boolean') return;
        try {
          globalThis.localStorage.setItem(key, JSON.stringify({
            schema: 1, sessionId: value.sessionId, observed: value.observed
          }));
        } catch (_error) { /* 共享去重失败时仍保留单页内存锁 */ }
      };
      const removeShared = (workspaceId, sessionId) => {
        const key = sharedKey(workspaceId);
        if (key === null) return;
        try {
          const current = readShared(workspaceId);
          if (current !== null && Object.is(current.sessionId, sessionId)) {
            globalThis.localStorage.removeItem(key);
          }
        } catch (_error) { /* 单页锁继续 fail-closed */ }
      };
      const withSharedLock = async (workspaceId, operation) => {
        const key = sharedKey(workspaceId);
        const locks = globalThis.navigator?.locks;
        if (key === null || locks === undefined || typeof locks.request !== 'function') {
          return operation();
        }
        let started = false;
        try {
          return await locks.request(key, { mode: 'exclusive' }, () => {
            started = true;
            return operation();
          });
        } catch (error) {
          if (started) throw error;
          return operation();
        }
      };

      if (sharedScope !== null) {
        try {
          const currentPrefix = `${ALIGNMENT_STORAGE_PREFIX}${sharedScope}.`;
          for (let index = globalThis.localStorage.length - 1; index >= 0; index -= 1) {
            const key = globalThis.localStorage.key(index);
            if (typeof key === 'string' && key.startsWith(ALIGNMENT_STORAGE_PREFIX)
                && !key.startsWith(currentPrefix)) globalThis.localStorage.removeItem(key);
          }
        } catch (_error) { /* 浏览器禁用 storage 时只使用本页内存 */ }
      }

      return Object.freeze({
        currentSession() {
          try { return ctx.get('sessions')?.list.getSnapshot()?.current; }
          catch (_error) { return undefined; }
        },
        target(source = 'host') {
          try {
            if (source === 'none') return { ok: false, code: 'workspace-unavailable' };
            let cwd;
            if (source === 'current-session') {
              const snapshot = ctx.get('sessions')?.list.getSnapshot?.();
              const current = snapshot?.current;
              const session = current === null || current === undefined
                ? null : snapshot?.byId?.[current];
              if (!session || session.origin === 'subagent') {
                return { ok: false, code: 'workspace-unavailable' };
              }
              cwd = normalizeProjectPath(session.cwd);
            } else if (source === 'host') {
              const connection = ctx.get('connection');
              cwd = normalizeProjectPath(connection?.hostDescription?.getSnapshot?.()?.cwd);
            } else {
              return { ok: false, code: 'workspace-unavailable' };
            }
            return cwd ? { ok: true, cwd } : { ok: false, code: 'workspace-unavailable' };
          } catch (_error) {
            return { ok: false, code: 'workspace-unavailable' };
          }
        },
        async ensure(cwd) {
          const workspaces = ctx.get('workspaces');
          const path = normalizeProjectPath(cwd);
          if (workspaces === undefined || !path || typeof workspaces.create !== 'function') {
            return { ok: false, code: 'workspace-unavailable' };
          }
          const knownId = workspaceIdsByPath.get(path);
          if (knownId !== undefined) return { ok: true, workspaceId: knownId, path };
          const existing = pendingWorkspaces.get(path);
          if (existing !== undefined) return existing;
          const operation = (async () => {
            try {
              const workspace = await workspaces.create({ path });
              if (workspace?.workspaceId === undefined) {
                return { ok: false, code: 'workspace-unavailable' };
              }
              workspaceIdsByPath.set(path, workspace.workspaceId);
              return { ok: true, workspaceId: workspace.workspaceId, path };
            } catch (_error) {
              return { ok: false, code: 'workspace-unavailable' };
            }
          })();
          pendingWorkspaces.set(path, operation);
          void operation.finally(() => {
            if (pendingWorkspaces.get(path) === operation) pendingWorkspaces.delete(path);
          });
          return operation;
        },
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
        observe(sessionId, cwd, workspaceId) {
          const path = normalizeProjectPath(cwd);
          if (sessionId === undefined || !path) return;
          const targets = workspaceId === undefined
            ? [...rememberedConnections.keys()] : [workspaceId];
          for (const candidateId of targets) {
            const remembered = rememberedConnections.get(candidateId);
            if (remembered === undefined || (remembered.path === path
                && Object.is(remembered.sessionId, sessionId))) {
              rememberedConnections.set(candidateId, Object.freeze({
                path, sessionId, observed: true
              }));
              void withSharedLock(candidateId, async () => {
                const shared = readShared(candidateId);
                if (shared === null || Object.is(shared.sessionId, sessionId)) {
                  writeShared(candidateId, { sessionId, observed: true });
                }
              });
            }
          }
        },
        async connect(workspaceId, cwd) {
          const workspaces = ctx.get('workspaces');
          const path = normalizeProjectPath(cwd);
          if (workspaces === undefined || workspaceId === undefined || !path) {
            return { ok: false, code: 'workspace-unavailable' };
          }
          const existing = pendingConnections.get(workspaceId);
          if (existing !== undefined && existing.path === path) return existing.promise;
          const operation = (async () => {
            try {
              return await withSharedLock(workspaceId, async () => {
                const remembered = rememberedConnections.get(workspaceId);
                const shared = readShared(workspaceId);
                if ((remembered === undefined || remembered.path === path)
                    && (remembered !== undefined || shared !== null)) {
                  const sessionId = remembered?.sessionId || shared.sessionId;
                  const observed = remembered?.observed === true || shared?.observed === true;
                  if (!observed) {
                    rememberedConnections.set(workspaceId, Object.freeze({
                      path, sessionId, observed: false
                    }));
                    writeShared(workspaceId, { sessionId, observed: false });
                    return { ok: true, sessionId };
                  }
                  rememberedConnections.delete(workspaceId);
                  removeShared(workspaceId, sessionId);
                } else if (remembered !== undefined) {
                  rememberedConnections.delete(workspaceId);
                }
                const sessionId = await workspaces.connectWorkspace(workspaceId);
                if (sessionId === undefined) {
                  return { ok: false, code: 'workspace-unavailable' };
                }
                rememberedConnections.set(workspaceId, Object.freeze({
                  path, sessionId, observed: false
                }));
                writeShared(workspaceId, { sessionId, observed: false });
                return { ok: true, sessionId };
              });
            } catch (_error) {
              return { ok: false, code: 'workspace-unavailable' };
            }
          })();
          pendingConnections.set(workspaceId, Object.freeze({ path, promise: operation }));
          void operation.finally(() => {
            if (pendingConnections.get(workspaceId)?.promise === operation) {
              pendingConnections.delete(workspaceId);
            }
          });
          return operation;
        },
        async fillDraft(sessionId, text, workspaceId, signal, stillValid) {
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
          const operationStale = () => signal?.aborted === true || !currentUnchanged()
            || (typeof stillValid === 'function' && stillValid() !== true);
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

    function BrowserOnlyPrompter() {
      const [text, setText] = react.useState('');
      const [feedback, setFeedback] = react.useState('');
      const [playing, setPlaying] = react.useState(false);
      const [speed, setSpeed] = react.useState(1);
      const [fontSize, setFontSize] = react.useState('medium');
      const scrollRef = react.useRef(null);
      const frameRef = react.useRef(null);
      const frameTimeRef = react.useRef(null);

      react.useEffect(() => {
        const page = globalThis.document;
        if (!page || typeof page.addEventListener !== 'function') return undefined;
        const pauseWhenHidden = () => {
          if (page.hidden === true) setPlaying(false);
        };
        page.addEventListener('visibilitychange', pauseWhenHidden);
        return () => page.removeEventListener?.('visibilitychange', pauseWhenHidden);
      }, []);

      react.useEffect(() => {
        if (!playing || typeof globalThis.requestAnimationFrame !== 'function') return undefined;
        let cancelled = false;
        frameTimeRef.current = null;
        const step = (now) => {
          if (cancelled) return;
          const scroller = scrollRef.current;
          const previous = frameTimeRef.current;
          frameTimeRef.current = now;
          if (scroller && previous !== null) {
            const elapsed = Math.min(48, Math.max(0, now - previous));
            scroller.scrollTop += (32 * speed * elapsed) / 1000;
            if (Math.ceil(scroller.scrollTop + scroller.clientHeight) >= scroller.scrollHeight) {
              setPlaying(false);
              return;
            }
          }
          frameRef.current = globalThis.requestAnimationFrame(step);
        };
        frameRef.current = globalThis.requestAnimationFrame(step);
        return () => {
          cancelled = true;
          if (frameRef.current !== null
              && typeof globalThis.cancelAnimationFrame === 'function') {
            globalThis.cancelAnimationFrame(frameRef.current);
          }
          frameRef.current = null;
          frameTimeRef.current = null;
        };
      }, [playing, speed]);

      const changeText = (event) => {
        const next = event?.target?.value;
        if (typeof next !== 'string') return;
        setPlaying(false);
        if (utf8Bytes(next) > MAX_BROWSER_PROMPTER_BYTES) {
          setFeedback('手动提词文本最多 64 KiB；超出部分没有载入。');
          return;
        }
        if (WORKSPACE_TEXT_CONTROL_RE.test(next)) {
          setFeedback('手动提词文本含不安全控制字符；没有载入。');
          return;
        }
        setText(next);
        setFeedback('');
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
      };
      const reset = () => {
        setPlaying(false);
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
      };
      const hasText = Boolean(text.trim());
      return react_jsx_runtime.jsxs('main', {
        className: 'wd10-browserPrompt', 'data-browser-only-prompter': true, children: [
          react_jsx_runtime.jsxs('header', { className: 'wd10-detailHead', children: [
            react_jsx_runtime.jsx('div', { className: 'wd10-eyebrow', children: '浏览器页内工具' }),
            react_jsx_runtime.jsx('h1', { children: '手动页内提词' }),
            react_jsx_runtime.jsx('p', { children:
              '这里不读取工作区、不创建内容身份；文本只保留在当前页面内存。'
            })
          ] }),
          react_jsx_runtime.jsxs('div', { className: 'wd10-panel', children: [
            react_jsx_runtime.jsxs('section', { className: 'wd10-card', children: [
              react_jsx_runtime.jsx('h3', { children: '粘贴提词文本' }),
              react_jsx_runtime.jsx('textarea', {
                value: text, rows: 7, spellCheck: false,
                'aria-label': '手动粘贴提词文本',
                placeholder: '在这里手动粘贴需要滚动的文本（最多 64 KiB）',
                onChange: changeText
              }),
              react_jsx_runtime.jsxs('div', { className: 'wd10-browserPromptMeta', children: [
                react_jsx_runtime.jsx('span', { children: `${utf8Bytes(text)}/65536 字节` }),
                react_jsx_runtime.jsx('span', { children: '不保存 · 不上传' })
              ] }),
              feedback && react_jsx_runtime.jsx('p', {
                className: 'wd10-incomplete', role: 'status', children: feedback
              }),
              react_jsx_runtime.jsx('p', { className: 'wd10-shootTruth', children:
                '页内简版只在当前页面滚动，不记录镜头完成状态，也不会写入拍摄记录。'
              }),
              react_jsx_runtime.jsxs('div', { className: 'wd10-prompterControls', children: [
                react_jsx_runtime.jsx('button', { type: 'button',
                  disabled: !hasText || playing, onClick: () => setPlaying(true),
                  children: '开始'
                }),
                react_jsx_runtime.jsx('button', { type: 'button', disabled: !playing,
                  onClick: () => setPlaying(false), children: '暂停'
                }),
                react_jsx_runtime.jsx('button', { type: 'button', disabled: !hasText,
                  onClick: reset, children: '重置'
                })
              ] }),
              react_jsx_runtime.jsxs('div', { className: 'wd10-prompterChoices', children: [
                ...[0.8, 1, 1.2].map((value) => react_jsx_runtime.jsx('button', {
                  type: 'button', 'aria-pressed': speed === value,
                  onClick: () => setSpeed(value), children: `${value} 倍`
                }, `browser-speed-${value}`)),
                react_jsx_runtime.jsx('button', { type: 'button',
                  'aria-pressed': fontSize === 'medium', onClick: () => setFontSize('medium'),
                  children: '中字'
                }),
                react_jsx_runtime.jsx('button', { type: 'button',
                  'aria-pressed': fontSize === 'large', onClick: () => setFontSize('large'),
                  children: '大字'
                })
              ] }),
              react_jsx_runtime.jsx('div', { ref: scrollRef, className: 'wd10-prompter',
                'data-font': fontSize, tabIndex: 0, 'aria-label': '浏览器页内提词正文', children:
                  react_jsx_runtime.jsx('pre', { children: text })
              })
            ] })
          ] })
        ]
      });
    }

    const EMPTY_PROJECT_COUNTS = Object.freeze({
      need: 0, done: 0, busy: 0, idle: 0, total: 0, glowing: 0
    });

    function projectUiRecord(value) {
      return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    function projectUiSummary(value) {
      if (!projectUiRecord(value) || !APP_PROJECT_ID_RE.test(value.projectId)
          || !['user', 'builtin'].includes(value.kind)
          || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 40
          || CONTROL_RE.test(value.name)
          || typeof value.icon !== 'string' || !value.icon || value.icon.length > 8
          || /[\s\u0000-\u001f\u007f]/.test(value.icon)
          || typeof value.hasFolder !== 'boolean'
          || typeof value.hidden !== 'boolean' || typeof value.pinned !== 'boolean'
          || !(value.hasBinding === undefined || typeof value.hasBinding === 'boolean')) return null;
      const allowed = new Set([
        'projectId', 'kind', 'name', 'icon', 'hasFolder', 'hasBinding', 'hidden', 'pinned'
      ]);
      if (Object.keys(value).some((key) => !allowed.has(key))) return null;
      return Object.freeze({
        projectId: value.projectId,
        kind: value.kind,
        name: value.name.trim(),
        icon: value.icon,
        hasFolder: value.hasFolder,
        hasBinding: value.hasBinding === true,
        bindingKnown: typeof value.hasBinding === 'boolean',
        hidden: value.hidden,
        pinned: value.pinned
      });
    }

    function projectListResult(snapshot) {
      const value = snapshot?.state === 'fulfilled' ? snapshot.result : null;
      if (!projectUiExact(value, [
        'kind', 'revision', 'cursor', 'nextCursor', 'projects',
        'switchCommand', 'templateCatalog'
      ]) || value.kind !== 'projects'
          || !Number.isSafeInteger(value.revision) || value.revision < 0
          || !Number.isSafeInteger(value.cursor) || value.cursor < 0
          || !(value.nextCursor === null || (Number.isSafeInteger(value.nextCursor)
            && value.nextCursor > value.cursor))
          || !Array.isArray(value.projects) || value.projects.length > 32
          || !Array.isArray(value.templateCatalog) || value.templateCatalog.length > 16) return null;
      const projects = [];
      for (const raw of value.projects) {
        const project = projectUiSummary(raw);
        if (!project || projects.some((item) => item.projectId === project.projectId)) return null;
        projects.push(project);
      }
      let switchCommand = null;
      if (value.switchCommand !== null) {
        if (!projectUiExact(value.switchCommand, ['seq', 'projectId'])
            || !Number.isSafeInteger(value.switchCommand.seq) || value.switchCommand.seq < 1
            || !APP_PROJECT_ID_RE.test(value.switchCommand.projectId)) return null;
        switchCommand = Object.freeze({ ...value.switchCommand });
      }
      const templateCatalog = [];
      for (const raw of value.templateCatalog) {
        if (!projectUiExact(raw, ['id', 'label', 'hint'])
            || !projectUiText(raw.id, 96) || !/^(?:builtin|user):[^\\/]+$/.test(raw.id)
            || !projectUiText(raw.label, 40)
            || !(raw.hint === null || (typeof raw.hint === 'string'
              && raw.hint.length <= 80 && !CONTROL_RE.test(raw.hint)))
            || templateCatalog.some((entry) => entry.id === raw.id)) return null;
        templateCatalog.push(Object.freeze({ id: raw.id, label: raw.label, hint: raw.hint }));
      }
      if (utf8Bytes(JSON.stringify(templateCatalog)) > MAX_PROJECT_TEMPLATE_CATALOG_BYTES
          || (value.cursor !== 0 && (switchCommand !== null || templateCatalog.length > 0))) return null;
      return Object.freeze({
        revision: value.revision,
        cursor: value.cursor,
        nextCursor: value.nextCursor,
        projects: Object.freeze(projects),
        switchCommand,
        templateCatalog: Object.freeze(templateCatalog)
      });
    }

    function projectMutationResult(snapshot) {
      const value = snapshot?.state === 'fulfilled' ? snapshot.result : null;
      if (!projectUiRecord(value) || value.kind !== 'project'
          || !Number.isSafeInteger(value.revision) || value.revision < 0) return null;
      const project = projectUiSummary(value.project);
      return project ? Object.freeze({ revision: value.revision, project }) : null;
    }

    function projectConsoleResult(snapshot) {
      const value = snapshot?.state === 'fulfilled' ? snapshot.result : null;
      if (!projectUiRecord(value) || value.kind !== 'console'
          || !Number.isSafeInteger(value.revision) || value.revision < 0
          || !Array.isArray(value.cards) || value.cards.length > 128
          || !projectUiRecord(value.counts)) return null;
      const counts = {};
      for (const key of ['need', 'done', 'busy', 'idle', 'total', 'glowing']) {
        if (!Number.isSafeInteger(value.counts[key]) || value.counts[key] < 0
            || value.counts[key] > 128) return null;
        counts[key] = value.counts[key];
      }
      if (counts.need + counts.done + counts.busy + counts.idle !== counts.total) return null;
      const cards = [];
      for (const raw of value.cards) {
        const recent = raw.recent === null || raw.recent === undefined ? null
          : projectUiExact(raw.recent, ['role', 'text', 'updatedAt'])
            && ['user', 'assistant'].includes(raw.recent.role)
            && typeof raw.recent.text === 'string' && raw.recent.text.trim()
            && raw.recent.text.length <= 160 && !CONTROL_RE.test(raw.recent.text)
            && Number.isSafeInteger(raw.recent.updatedAt) && raw.recent.updatedAt >= 0
            ? Object.freeze({ ...raw.recent }) : undefined;
        if (!projectUiRecord(raw) || !APP_PROJECT_ID_RE.test(raw.projectId)
            || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 40
            || CONTROL_RE.test(raw.name)
            || typeof raw.icon !== 'string' || !raw.icon || raw.icon.length > 8
            || !['need', 'done', 'busy', 'idle'].includes(raw.status)
            || typeof raw.statusLabel !== 'string' || !raw.statusLabel
            || raw.statusLabel.length > 32 || CONTROL_RE.test(raw.statusLabel)
            || typeof raw.glow !== 'boolean'
            || !(raw.runtimeMs === null || (Number.isFinite(raw.runtimeMs)
              && raw.runtimeMs >= 0))
            || !Number.isSafeInteger(raw.kids) || raw.kids < 0 || raw.kids > 512
            || typeof raw.sessionTitle !== 'string' || raw.sessionTitle.length > 120
            || CONTROL_RE.test(raw.sessionTitle)
            || typeof raw.pinned !== 'boolean' || typeof raw.hidden !== 'boolean'
            || recent === undefined) return null;
        cards.push(Object.freeze({
          projectId: raw.projectId,
          name: raw.name.trim(),
          icon: raw.icon,
          pinned: raw.pinned,
          hidden: raw.hidden,
          status: raw.status,
          statusLabel: raw.statusLabel,
          glow: raw.glow,
          runtimeMs: raw.runtimeMs,
          kids: raw.kids,
          sessionTitle: raw.sessionTitle,
          recent
        }));
      }
      return Object.freeze({
        revision: value.revision,
        cards: Object.freeze(cards),
        counts: Object.freeze(counts)
      });
    }

    function projectUiExact(value, required, optional = []) {
      if (!projectUiRecord(value)) return false;
      const allowed = new Set([...required, ...optional]);
      return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
        && Object.keys(value).every((key) => allowed.has(key));
    }

    function projectUiText(value, maximum) {
      return typeof value === 'string' && value.length > 0 && value.length <= maximum
        && value === value.trim() && !CONTROL_RE.test(value);
    }

    function projectRelativeRef(value) {
      if (!projectUiText(value, 4096) || utf8Bytes(value) > 4096 || value.includes('\\')
          || value.startsWith('/') || /^[A-Za-z]:\//.test(value)) return null;
      const parts = value.split('/');
      return parts.some((part) => !part || part === '.' || part === '..') ? null : value;
    }

    function projectBrowserUrl(value) {
      if (!projectUiText(value, 4096) || utf8Bytes(value) > 4096
          || !/^https?:\/\/[^\s]+$/i.test(value)) return null;
      if (typeof globalThis.URL === 'function') {
        try {
          const parsed = new globalThis.URL(value);
          if (!['http:', 'https:'].includes(parsed.protocol)) return null;
        } catch (_error) { return null; }
      }
      return value;
    }

    function projectBase64ByteLength(value) {
      if (typeof value !== 'string' || value.length < 4 || value.length % 4 !== 0
          || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
        return null;
      }
      const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
      const bytes = (value.length / 4) * 3 - padding;
      return Number.isSafeInteger(bytes) && bytes > 0
        && bytes <= MAX_PROJECT_PREVIEW_IMAGE_BYTES ? bytes : null;
    }

    function projectPanePreview(value, expectedKind) {
      if (!projectUiRecord(value) || value.kind !== expectedKind) return null;
      if (expectedKind === 'markdown' || expectedKind === 'text') {
        if (!projectUiExact(value, ['kind', 'text', 'truncated'])
            || typeof value.text !== 'string' || WORKSPACE_TEXT_CONTROL_RE.test(value.text)
            || utf8Bytes(value.text) > MAX_PROJECT_PREVIEW_TEXT_BYTES
            || typeof value.truncated !== 'boolean') return null;
        return Object.freeze({
          kind: expectedKind, text: value.text, truncated: value.truncated
        });
      }
      if (expectedKind !== 'image'
          || !projectUiExact(value, ['kind', 'dataUrl', 'width', 'height'])
          || typeof value.dataUrl !== 'string'
          || utf8Bytes(value.dataUrl) > MAX_PROJECT_PREVIEW_BYTES
          || !Number.isSafeInteger(value.width) || value.width < 1 || value.width > 2048
          || !Number.isSafeInteger(value.height) || value.height < 1 || value.height > 2048) {
        return null;
      }
      const match = /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value.dataUrl);
      if (!match || projectBase64ByteLength(match[1]) === null) return null;
      return Object.freeze({
        kind: 'image', dataUrl: value.dataUrl, width: value.width, height: value.height
      });
    }

    function projectPaneTab(value, expectedWindow) {
      if (!projectUiRecord(value) || !PROJECT_PANE_TYPES.has(value.type)
          || !projectUiText(value.id, 128) || !projectUiText(value.title, 120)) return null;
      const base = ['id', 'type', 'title'];
      if (['markdown', 'text', 'image'].includes(value.type)) {
        const relativeRef = projectRelativeRef(value.relativeRef);
        const hasPreview = Object.prototype.hasOwnProperty.call(value, 'preview');
        const preview = hasPreview ? projectPanePreview(value.preview, value.type) : null;
        return projectUiExact(value, [...base, 'relativeRef'], ['preview']) && relativeRef
            && (!hasPreview || preview)
          ? Object.freeze({
              id: value.id, type: value.type, title: value.title, relativeRef,
              ...(preview ? { preview } : {})
            }) : null;
      }
      if (value.type === 'browser') {
        const url = projectBrowserUrl(value.url);
        return projectUiExact(value, [...base, 'url']) && url
          ? Object.freeze({ id: value.id, type: 'browser', title: value.title, url }) : null;
      }
      if (value.type === 'video-template') {
        const validTemplate = projectUiText(value.templateId, 96)
          && /^(?:builtin|user):[^\\/]+$/.test(value.templateId);
        return projectUiExact(value, [...base, 'templateId']) && validTemplate
          ? Object.freeze({ id: value.id, type: 'video-template', title: value.title,
            templateId: value.templateId }) : null;
      }
      if (value.type === 'terminal') {
        return projectUiExact(value, base)
          ? Object.freeze({ id: value.id, type: 'terminal', title: value.title }) : null;
      }
      if (!projectUiExact(value, [...base, 'descriptor', 'locked']) || value.locked !== true
          || !projectUiRecord(value.descriptor)) return null;
      const descriptor = value.descriptor;
      const html = descriptor.kind === 'html';
      const descriptorKeys = ['window', 'relativeRef', 'kind', 'fingerprint'];
      const hasPreview = Object.prototype.hasOwnProperty.call(descriptor, 'preview');
      const preview = hasPreview ? projectPanePreview(descriptor.preview, descriptor.kind) : null;
      if (!PROJECT_ARTIFACT_KINDS.has(descriptor.kind)
          || !projectUiExact(descriptor,
            html ? [...descriptorKeys, 'openMode'] : descriptorKeys,
            html ? [] : ['preview'])
          || descriptor.window !== expectedWindow
          || (html && descriptor.openMode !== 'electron-child')
          || (hasPreview && (html || !preview))
          || !projectUiExact(descriptor.fingerprint, ['size', 'mtime', 'sha256'])
          || !Number.isSafeInteger(descriptor.fingerprint.size) || descriptor.fingerprint.size < 0
          || !Number.isFinite(descriptor.fingerprint.mtime) || descriptor.fingerprint.mtime < 0
          || !PROJECT_SHA256_RE.test(descriptor.fingerprint.sha256)
          || projectRelativeRef(descriptor.relativeRef) === null) return null;
      return Object.freeze({
        id: value.id, type: 'artifact', title: value.title, locked: true,
        descriptor: Object.freeze({
          window: descriptor.window,
          relativeRef: descriptor.relativeRef,
          kind: descriptor.kind,
          fingerprint: Object.freeze({ ...descriptor.fingerprint }),
          ...(preview ? { preview } : {}),
          ...(html ? { openMode: 'electron-child' } : {})
        })
      });
    }

    function projectPaneState(value) {
      if (!projectUiExact(value, ['schemaVersion', 'preset', 'windows'])
          || value.schemaVersion !== 1 || !PROJECT_PANE_PRESETS.includes(value.preset)
          || !Array.isArray(value.windows) || value.windows.length < 1
          || value.windows.length > 16) return null;
      const windows = [];
      for (const raw of value.windows) {
        if (!projectUiExact(raw, ['window', 'label', 'tabs', 'active', 'collapsed'])
            || !Number.isSafeInteger(raw.window) || raw.window < 1 || raw.window > 16
            || raw.label !== `窗口${raw.window}` || !Array.isArray(raw.tabs)
            || raw.tabs.length > 32 || typeof raw.collapsed !== 'boolean') return null;
        const tabs = raw.tabs.map((tab) => projectPaneTab(tab, raw.window));
        if (tabs.some((tab) => tab === null)
            || new Set(tabs.map((tab) => tab.id)).size !== tabs.length
            || (tabs.length === 0 ? raw.active !== null
              : typeof raw.active !== 'string' || !tabs.some((tab) => tab.id === raw.active))) return null;
        const locked = tabs.filter((tab) => tab.type === 'artifact' && tab.locked === true);
        if (locked.length > 0
            && (locked.length !== 1 || tabs.length !== 1 || raw.active !== locked[0].id)) return null;
        windows.push(Object.freeze({
          window: raw.window, label: raw.label, tabs: Object.freeze(tabs),
          active: raw.active, collapsed: raw.collapsed
        }));
      }
      windows.sort((left, right) => left.window - right.window);
      const numbers = windows.map((item) => item.window);
      if (new Set(numbers).size !== numbers.length
          || PROJECT_PANE_SLOTS[value.preset].some((_slot, index) => !numbers.includes(index + 1))) {
        return null;
      }
      const previews = [];
      const previewlessWindows = windows.map((window) => ({
        window: window.window,
        label: window.label,
        tabs: window.tabs.map((tab) => {
          const preview = tab.type === 'artifact' ? tab.descriptor.preview : tab.preview;
          if (preview) previews.push({ window: window.window, tabId: tab.id, preview });
          if (['markdown', 'text', 'image'].includes(tab.type)) {
            return { id: tab.id, type: tab.type, title: tab.title, relativeRef: tab.relativeRef };
          }
          if (tab.type === 'artifact') {
            const descriptor = tab.descriptor;
            return {
              id: tab.id, type: 'artifact', title: tab.title,
              descriptor: {
                window: descriptor.window, relativeRef: descriptor.relativeRef,
                kind: descriptor.kind, fingerprint: { ...descriptor.fingerprint },
                ...(descriptor.kind === 'html' ? { openMode: 'electron-child' } : {})
              },
              locked: true
            };
          }
          return { ...tab };
        }),
        active: window.active,
        collapsed: window.collapsed
      }));
      if (previews.length > MAX_PROJECT_PREVIEWS
          || utf8Bytes(JSON.stringify(previews)) > MAX_PROJECT_PREVIEW_BYTES
          || utf8Bytes(JSON.stringify({
            schemaVersion: 1, preset: value.preset, windows: previewlessWindows
          })) > 16 * 1024) return null;
      const result = Object.freeze({
        schemaVersion: 1, preset: value.preset, windows: Object.freeze(windows)
      });
      return result;
    }

    function projectTemplateActionSurface(value, capped) {
      if (!Array.isArray(value) || value.length > 12 || typeof capped !== 'boolean') return null;
      const actions = [];
      for (const action of value) {
        if (!projectUiExact(action, ['id', 'label', 'hint', 'confirm', 'prompt'])
            || typeof action.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(action.id)
            || !projectUiText(action.label, 16)
            || !(action.hint === null || projectUiText(action.hint, 80))
            || typeof action.confirm !== 'boolean'
            || typeof action.prompt !== 'string' || !action.prompt.trim()
            || action.prompt.trim().startsWith('/')
            || WORKSPACE_TEXT_CONTROL_RE.test(action.prompt)
            || utf8Bytes(action.prompt) > 8 * 1024) return null;
        actions.push(Object.freeze({ ...action }));
      }
      if (utf8Bytes(JSON.stringify(actions)) > 12 * 1024) return null;
      return Object.freeze({ actions: Object.freeze(actions), capped });
    }

    function projectSkinSurface(value) {
      const keys = ['background', 'surface', 'border', 'primary', 'accent', 'text', 'textMuted'];
      if (!projectUiExact(value, ['base', 'colors'])
          || !['dark', 'light'].includes(value.base)
          || !projectUiExact(value.colors, keys)
          || keys.some((key) => typeof value.colors[key] !== 'string'
            || !/^#[a-f0-9]{6}$/.test(value.colors[key]))) return null;
      return Object.freeze({ base: value.base, colors: Object.freeze({ ...value.colors }) });
    }

    function projectUiDetail(value) {
      const required = [
        'projectId', 'kind', 'name', 'icon', 'hasFolder', 'hasBinding', 'hidden', 'pinned',
        'folderTail', 'templateId', 'layoutPreset', 'paneState'
      ];
      const hasTemplateActions = Object.prototype.hasOwnProperty.call(value, 'templateActions');
      const hasTemplateCapped = Object.prototype.hasOwnProperty.call(value, 'templateActionsCapped');
      const hasSkin = Object.prototype.hasOwnProperty.call(value, 'skin');
      if (!projectUiExact(value, required, ['templateActions', 'templateActionsCapped', 'skin'])
          || typeof value.hasBinding !== 'boolean'
          || hasTemplateActions !== hasTemplateCapped) return null;
      const summary = projectUiSummary({
        projectId: value.projectId, kind: value.kind, name: value.name, icon: value.icon,
        hasFolder: value.hasFolder, hasBinding: value.hasBinding,
        hidden: value.hidden, pinned: value.pinned
      });
      const folderTailValid = value.folderTail === null
        || (projectUiText(value.folderTail, 255) && !/[\\/]/.test(value.folderTail)
          && !['.', '..'].includes(value.folderTail));
      const templateValid = value.templateId === null
        || (projectUiText(value.templateId, 96) && /^(?:builtin|user):[^\\/]+$/.test(value.templateId));
      const layoutValid = value.layoutPreset === null
        || PROJECT_PANE_PRESETS.includes(value.layoutPreset);
      const paneState = value.paneState === null ? null : projectPaneState(value.paneState);
      const actionSurface = hasTemplateActions
        ? projectTemplateActionSurface(value.templateActions, value.templateActionsCapped)
        : Object.freeze({ actions: Object.freeze([]), capped: false });
      const skin = hasSkin ? projectSkinSurface(value.skin) : null;
      if (!summary || !folderTailValid || !templateValid || !layoutValid
          || (value.paneState !== null && paneState === null)
          || (paneState !== null && paneState.preset !== value.layoutPreset)
          || actionSurface === null || (hasSkin && skin === null)) return null;
      return Object.freeze({
        projectId: summary.projectId,
        kind: summary.kind,
        name: summary.name,
        icon: summary.icon,
        hasFolder: summary.hasFolder,
        hasBinding: summary.hasBinding,
        hidden: summary.hidden,
        pinned: summary.pinned,
        folderTail: value.folderTail,
        templateId: value.templateId,
        layoutPreset: value.layoutPreset,
        paneState,
        templateActions: actionSurface.actions,
        templateActionsCapped: actionSurface.capped,
        ...(skin === null ? {} : { skin })
      });
    }

    function projectOpenEnvelope(snapshot, expectedKind) {
      const value = snapshot?.state === 'fulfilled' ? snapshot.result : null;
      const prepared = expectedKind === 'open-prepared';
      const hasBootstrapTicket = prepared && Object.prototype.hasOwnProperty.call(
        value || {}, 'bootstrapTicket'
      );
      const bindingValid = prepared && value?.bindingRef === null
        ? true : typeof value?.bindingRef === 'string'
          && SESSION_BINDING_REF_RE.test(value.bindingRef);
      if (!['open-prepared', 'open-committed'].includes(expectedKind)
          || !projectUiExact(value,
            prepared ? ['kind', 'project', 'bindingRef', 'openToken']
              : ['kind', 'project', 'bindingRef'],
            prepared ? ['bootstrapTicket'] : [])
          || value.kind !== expectedKind
          || !bindingValid
          || (hasBootstrapTicket && (value.bindingRef !== null
            || typeof value.bootstrapTicket !== 'string'
            || !PROJECT_BOOTSTRAP_TICKET_RE.test(value.bootstrapTicket)
            || utf8Bytes(value.bootstrapTicket) > MAX_PROJECT_BOOTSTRAP_TICKET_BYTES))
          || (prepared && (typeof value.openToken !== 'string'
            || !PROJECT_OPEN_TOKEN_RE.test(value.openToken)))) return null;
      const project = projectUiDetail(value.project);
      return project ? Object.freeze({ project, bindingRef: value.bindingRef }) : null;
    }

    function projectOpenResult(snapshot, expectedKind) {
      return projectOpenEnvelope(snapshot, expectedKind)?.project || null;
    }

    function projectSwitchSequence(current, command) {
      if (!Number.isSafeInteger(current) || current < 0
          || !projectUiExact(command, ['seq', 'projectId'])
          || !Number.isSafeInteger(command.seq) || command.seq < 1
          || !APP_PROJECT_ID_RE.test(command.projectId)
          || command.seq <= current) return null;
      return command.seq;
    }

    async function projectTemplateActionDraft(options) {
      const projectId = options?.projectId;
      const actionId = options?.actionId;
      const signal = options?.signal;
      const failure = (code, envelope = null) => Object.freeze({
        ok: false, code, project: envelope?.project || null,
        bindingRef: envelope?.bindingRef || null, action: null
      });
      if (!APP_PROJECT_ID_RE.test(projectId || '')
          || typeof actionId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(actionId)
          || typeof options?.open !== 'function'
          || typeof options?.isCurrent !== 'function'
          || typeof options?.currentSession !== 'function'
          || typeof options?.fillDraft !== 'function') return failure('operation-invalid');
      let snapshot;
      try { snapshot = await options.open({ projectId }, signal); }
      catch (_error) { return failure('operation-failed'); }
      if (signal?.aborted) return failure('operation-stale');
      const envelope = projectOpenEnvelope(snapshot, 'open-committed');
      if (!envelope || envelope.project.projectId !== projectId) {
        return failure(typeof snapshot?.code === 'string' ? snapshot.code : 'operation-failed');
      }
      if (!options.isCurrent(projectId, envelope.bindingRef)) {
        return failure('operation-stale', envelope);
      }
      const action = envelope.project.templateActions.find((item) => item.id === actionId);
      if (!action) return failure('template-action-missing', envelope);
      if (action.confirm) {
        if (typeof options.confirm !== 'function') {
          return failure('confirmation-unavailable', envelope);
        }
        let confirmed = false;
        try { confirmed = options.confirm(`${action.label}\n\n${action.hint || '请确认后继续。'}`) === true; }
        catch (_error) { return failure('confirmation-unavailable', envelope); }
        if (!confirmed) return failure('cancelled', envelope);
      }
      let sessionId;
      try { sessionId = options.currentSession(); }
      catch (_error) { return failure('session-unavailable', envelope); }
      if (sessionId === null || sessionId === undefined
          || !options.isCurrent(projectId, envelope.bindingRef)) {
        return failure('operation-stale', envelope);
      }
      const stillCurrent = () => {
        try {
          return !signal?.aborted
            && Object.is(options.currentSession(), sessionId)
            && options.isCurrent(projectId, envelope.bindingRef);
        } catch (_error) { return false; }
      };
      let filled;
      try {
        filled = await options.fillDraft(sessionId, action.prompt, undefined, signal, stillCurrent);
      } catch (_error) { return failure('session-unavailable', envelope); }
      if (filled?.ok !== true) {
        return failure(typeof filled?.code === 'string' ? filled.code : 'session-unavailable', envelope);
      }
      if (!stillCurrent()) return failure('operation-stale', envelope);
      return Object.freeze({
        ok: true, code: null, project: envelope.project,
        bindingRef: envelope.bindingRef, action
      });
    }

    function projectActionFailureMessage(snapshot, kind) {
      const code = snapshot?.code;
      if (code === 'cancelled') return kind === 'template-action'
        ? '已取消，未填入草稿。' : '已取消添加项目。';
      if (code === 'project-not-found') return '这个项目已不存在，正在刷新。';
      if (code === 'project-folder-invalid') return '这个项目文件夹不可用。';
      if (code === 'project-protected') return '这个系统位置不能作为项目。';
      if (code === 'project-duplicate-folder') return '这个文件夹已经有项目。';
      if (code === 'project-identity-conflict') {
        return '这个旁车身份已由另一个仍可用的项目文件夹占用，未重新认领。';
      }
      if (code === 'project-limit') return '项目数已达上限。';
      if (code === 'busy') return '上一个操作还在进行，请稍等。';
      if (code === 'draft-not-empty') return '右侧当前对话已有草稿，未覆盖。';
      if (code === 'operation-stale') return '打开期间对话已变化，未填入草稿。';
      if (code === 'template-action-missing') return '该模板动作已更新，未填入草稿。';
      if (code === 'confirmation-unavailable') return '当前窗口无法显示本地确认，未填入草稿。';
      if (code === 'workspace-unavailable' && kind === 'open') {
        return '这个项目还没绑定可用对话。先选择右侧对话并绑定。';
      }
      if (code === 'outcome-unknown' && kind === 'open') {
        return '项目会话创建结果暂时无法确认；未打开、未标记已读，请刷新后重试。';
      }
      if (code === 'workspace-unavailable' && kind === 'bind') {
        return '右侧当前没有可绑定的对话。';
      }
      if (code === 'workspace-mismatch' && kind === 'bind') {
        return '右侧当前对话不属于该项目文件夹，未绑定。';
      }
      if ((code === 'workspace-unavailable' || code === 'session-unavailable')
          && kind === 'template-action') {
        return '项目对话没有成功打开，未填入草稿。';
      }
      return '操作没有完成，项目原状保留。';
    }

    function initialProjectWorkbenchState() {
      return Object.freeze({
        theme: 'system',
        manage: false,
        surface: 'console',
        selectedProjectId: CONTROL_PROJECT_ID,
        projects: Object.freeze({ status: 'loading', request: 0, revision: 0,
          items: Object.freeze([]) }),
        console: Object.freeze({ status: 'loading', request: 0, revision: 0,
          cards: Object.freeze([]), counts: EMPTY_PROJECT_COUNTS }),
        detail: Object.freeze({
          status: 'idle', request: 0, revision: 0, project: null, opened: false
        }),
        templateCatalog: Object.freeze([]),
        createWizard: Object.freeze({ open: false, templateId: null }),
        action: null,
        bindOffer: null,
        notice: ''
      });
    }

    function projectWorkbenchReducer(state, event) {
      if (!event || typeof event !== 'object' || Array.isArray(event)) return state;
      if (event.type === 'theme') {
        return PROJECT_THEMES.has(event.theme) && event.theme !== state.theme
          ? Object.freeze({ ...state, theme: event.theme }) : state;
      }
      if (event.type === 'manage') {
        return typeof event.value === 'boolean' && event.value !== state.manage
          ? Object.freeze({ ...state, manage: event.value }) : state;
      }
      if (event.type === 'control') {
        return Object.freeze({
          ...state,
          surface: 'console',
          selectedProjectId: CONTROL_PROJECT_ID,
          detail: Object.freeze({ ...state.detail, status: 'idle', opened: false })
        });
      }
      if (event.type === 'select') {
        return typeof event.projectId === 'string' && APP_PROJECT_ID_RE.test(event.projectId)
          ? Object.freeze({ ...state, selectedProjectId: event.projectId }) : state;
      }
      if (event.type === 'create:open') {
        if (state.createWizard.open) return state;
        return Object.freeze({ ...state, createWizard: Object.freeze({
          open: true, templateId: state.templateCatalog[0]?.id || null
        }) });
      }
      if (event.type === 'create:select') {
        if (!state.createWizard.open || typeof event.templateId !== 'string'
            || !state.templateCatalog.some((entry) => entry.id === event.templateId)
            || event.templateId === state.createWizard.templateId) return state;
        return Object.freeze({ ...state, createWizard: Object.freeze({
          open: true, templateId: event.templateId
        }) });
      }
      if (event.type === 'create:close') {
        return state.createWizard.open
          ? Object.freeze({ ...state, createWizard: Object.freeze({ open: false, templateId: null }) })
          : state;
      }
      if (event.type === 'templates:success') {
        if (!Array.isArray(event.items)) return state;
        const templateCatalog = Object.freeze(event.items.slice());
        const selectedExists = templateCatalog.some((entry) => (
          entry.id === state.createWizard.templateId
        ));
        return Object.freeze({
          ...state,
          templateCatalog,
          createWizard: state.createWizard.open ? Object.freeze({
            open: true,
            templateId: selectedExists
              ? state.createWizard.templateId : templateCatalog[0]?.id || null
          }) : state.createWizard
        });
      }
      if (event.type === 'projects:start') {
        if (!Number.isSafeInteger(event.request) || event.request <= state.projects.request) return state;
        return Object.freeze({ ...state, projects: Object.freeze({
          ...state.projects, request: event.request,
          status: state.projects.items.length > 0 ? 'refreshing' : 'loading'
        }) });
      }
      if (event.type === 'projects:slow') {
        if (event.request !== state.projects.request
            || !['loading', 'refreshing'].includes(state.projects.status)) return state;
        return Object.freeze({ ...state, projects: Object.freeze({
          ...state.projects, status: 'slow'
        }) });
      }
      if (event.type === 'projects:success') {
        if (event.request !== state.projects.request || !Array.isArray(event.items)
            || !Array.isArray(event.templateCatalog)
            || !Number.isSafeInteger(event.revision) || event.revision < 0) return state;
        const items = Object.freeze(event.items.slice());
        const templateCatalog = Object.freeze(event.templateCatalog.slice());
        const selectedTemplateExists = templateCatalog.some((entry) => (
          entry.id === state.createWizard.templateId
        ));
        const selectedExists = state.selectedProjectId === CONTROL_PROJECT_ID
          || items.some((item) => item.projectId === state.selectedProjectId);
        const detailExists = state.detail.project === null
          || items.some((item) => item.projectId === state.detail.project.projectId);
        return Object.freeze({
          ...state,
          selectedProjectId: selectedExists ? state.selectedProjectId : CONTROL_PROJECT_ID,
          surface: detailExists ? state.surface : 'console',
          detail: detailExists ? state.detail : Object.freeze({
            ...state.detail, status: 'idle', project: null, opened: false
          }),
          templateCatalog,
          createWizard: state.createWizard.open ? Object.freeze({
            open: true,
            templateId: selectedTemplateExists
              ? state.createWizard.templateId : templateCatalog[0]?.id || null
          }) : state.createWizard,
          projects: Object.freeze({ status: 'ready', request: event.request,
            revision: event.revision, items })
        });
      }
      if (event.type === 'projects:error') {
        if (event.request !== state.projects.request) return state;
        return Object.freeze({ ...state, projects: Object.freeze({
          ...state.projects, status: state.projects.items.length > 0 ? 'stale' : 'error'
        }) });
      }
      if (event.type === 'console:start') {
        if (!Number.isSafeInteger(event.request) || event.request <= state.console.request) return state;
        return Object.freeze({ ...state, console: Object.freeze({
          ...state.console, request: event.request,
          status: state.console.cards.length > 0 ? 'refreshing' : 'loading'
        }) });
      }
      if (event.type === 'console:success') {
        if (event.request !== state.console.request || !Array.isArray(event.cards)
            || !Number.isSafeInteger(event.revision) || event.revision < 0
            || !projectUiRecord(event.counts)) return state;
        return Object.freeze({ ...state, console: Object.freeze({
          status: 'ready', request: event.request, revision: event.revision,
          cards: Object.freeze(event.cards.slice()), counts: Object.freeze({ ...event.counts })
        }) });
      }
      if (event.type === 'console:error') {
        if (event.request !== state.console.request) return state;
        return Object.freeze({ ...state, console: Object.freeze({
          ...state.console, status: state.console.cards.length > 0 ? 'stale' : 'error'
        }) });
      }
      if (event.type === 'detail:start') {
        if (!Number.isSafeInteger(event.request) || event.request <= state.detail.request
            || !APP_PROJECT_ID_RE.test(event.projectId || '')
            || event.projectId === CONTROL_PROJECT_ID
            || !Number.isSafeInteger(event.revision) || event.revision < 0) return state;
        const sameProject = state.detail.project?.projectId === event.projectId;
        return Object.freeze({
          ...state,
          selectedProjectId: event.projectId,
          detail: Object.freeze({
            status: sameProject ? 'refreshing' : 'loading',
            request: event.request,
            revision: sameProject ? state.detail.revision : event.revision,
            project: sameProject ? state.detail.project : null,
            opened: sameProject ? state.detail.opened === true : false
          })
        });
      }
      if (event.type === 'detail:success') {
        const project = projectUiDetail(event.project);
        if (event.request !== state.detail.request || project === null
            || project.projectId !== state.selectedProjectId
            || !Number.isSafeInteger(event.revision) || event.revision < 0) return state;
        return Object.freeze({
          ...state,
          surface: 'project',
          detail: Object.freeze({
            status: 'ready', request: event.request, revision: event.revision,
            project, opened: event.opened === true
          })
        });
      }
      if (event.type === 'detail:error') {
        if (event.request !== state.detail.request) return state;
        return Object.freeze({
          ...state,
          surface: state.detail.project === null ? 'console' : state.surface,
          selectedProjectId: state.detail.project === null
            ? CONTROL_PROJECT_ID : state.selectedProjectId,
          detail: Object.freeze({
            ...state.detail,
            status: state.detail.project === null ? 'error' : 'stale'
          })
        });
      }
      if (event.type === 'action:start') {
        if (state.action !== null || !Number.isSafeInteger(event.token)
            || event.token < 1 || typeof event.kind !== 'string') return state;
        return Object.freeze({ ...state, notice: '', action: Object.freeze({
          token: event.token,
          kind: event.kind,
          projectId: typeof event.projectId === 'string' ? event.projectId : null
        }) });
      }
      if (event.type === 'action:finish') {
        if (state.action === null || event.token !== state.action.token) return state;
        return Object.freeze({
          ...state,
          action: null,
          notice: typeof event.notice === 'string' ? event.notice : '',
          bindOffer: Object.prototype.hasOwnProperty.call(event, 'bindOffer')
            ? event.bindOffer : state.bindOffer
        });
      }
      if (event.type === 'bind-offer') {
        return Object.freeze({ ...state, bindOffer: event.value || null });
      }
      if (event.type === 'notice') {
        return Object.freeze({ ...state, notice: typeof event.value === 'string' ? event.value : '' });
      }
      return state;
    }

    const projectWorkbenchStateMachine = Object.freeze({
      initial: initialProjectWorkbenchState,
      reduce: projectWorkbenchReducer,
      projectListResult,
      projectConsoleResult,
      projectOpenResult,
      projectSwitchSequence,
      projectTemplateActionDraft,
      projectActionFailureMessage
    });

    function formatProjectRuntime(value) {
      if (!Number.isFinite(value) || value < 0) return '未运行';
      const total = Math.floor(value / 1000);
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      const two = (number) => String(number).padStart(2, '0');
      return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
    }

    function ProjectDrawer({ state, cards, currentSessionAvailable, onConsole, onProject,
      onAdd, onCreateTemplate, onCloseCreate, onBind, onDismissBind,
      onRename, onIcon, onHide, onMove, onRefresh, onAdopt, onSidecar }) {
      const projectById = new Map(state.projects.items.map((project) => [project.projectId, project]));
      const consoleProject = projectById.get(CONTROL_PROJECT_ID) || Object.freeze({
        projectId: CONTROL_PROJECT_ID, kind: 'builtin', name: '控制室', icon: '🖥️',
        hasFolder: false, hasBinding: false, bindingKnown: true, hidden: false, pinned: true
      });
      const userProjects = state.projects.items.filter((project) => project.kind === 'user');
      const visibleProjects = state.manage ? userProjects : userProjects.filter((project) => !project.hidden);
      const cardById = new Map(cards.map((card) => [card.projectId, card]));
      const busy = state.action !== null;
      const selectedTemplate = state.templateCatalog.find((entry) => (
        entry.id === state.createWizard.templateId
      )) || null;
      const statusText = state.projects.status === 'loading' ? '正在读取项目…'
        : state.projects.status === 'slow' ? '读取比预期慢，仍在继续…'
          : state.projects.status === 'error' ? '项目暂时读不到。'
            : state.projects.status === 'stale' ? '同步失败，先显示上次结果。'
              : state.projects.status === 'refreshing' ? '正在同步…' : '';
      const row = (project, index) => {
        const card = cardById.get(project.projectId);
        const bindingLabel = project.bindingKnown
          ? project.hasBinding ? '对话已绑定' : '对话未绑定'
          : '对话绑定状态未知';
        const folderLabel = project.hasFolder ? '项目文件夹可用' : '项目文件夹不可用';
        return react_jsx_runtime.jsxs('div', {
          className: 'wd11-projectRow',
          'data-current': state.selectedProjectId === project.projectId,
          'data-project-hidden': project.hidden || undefined,
          children: [
            react_jsx_runtime.jsxs('button', {
              type: 'button', className: 'wd11-projectMain', disabled: busy,
              onClick: () => onProject(project),
              'aria-label': `打开项目 ${project.name}；${bindingLabel}；${folderLabel}`,
              children: [
                react_jsx_runtime.jsx('span', { className: 'wd11-projectIcon', children: project.icon }),
                react_jsx_runtime.jsx('span', { className: 'wd11-projectName', children: project.name }),
                react_jsx_runtime.jsxs('span', { className: 'wd11-projectDots', 'aria-hidden': true,
                  children: [
                    react_jsx_runtime.jsx('span', { className: 'wd11-dot',
                      'data-on': project.hasBinding || undefined,
                      'data-unknown': !project.bindingKnown || undefined }),
                    react_jsx_runtime.jsx('span', { className: 'wd11-dot',
                      'data-on': project.hasFolder || undefined })
                  ] })
              ]
            }),
            state.manage && react_jsx_runtime.jsxs('div', {
              className: 'wd11-projectTools', 'aria-label': `${project.name} 管理`, children: [
                react_jsx_runtime.jsx('button', { type: 'button', disabled: busy,
                  onClick: () => onRename(project), children: '改名' }),
                react_jsx_runtime.jsx('button', { type: 'button', disabled: busy,
                  onClick: () => onIcon(project), children: '图标' }),
                react_jsx_runtime.jsx('button', { type: 'button',
                  disabled: busy || !currentSessionAvailable,
                  title: currentSessionAvailable ? '绑定右侧当前对话' : '请先在「对话」选择一条会话',
                  onClick: () => onBind(project),
                  children: project.hasBinding ? '重绑' : '绑定' }),
                react_jsx_runtime.jsx('button', { type: 'button', disabled: busy,
                  onClick: () => onHide(project), children: project.hidden ? '显示' : '隐藏' }),
                react_jsx_runtime.jsx('button', { type: 'button', disabled: busy || !project.hasFolder,
                  title: '显式写入 .whaledock/project.json，便于换机后认领',
                  onClick: () => onSidecar(project), children: '旁车' }),
                react_jsx_runtime.jsx('button', { type: 'button', disabled: busy || index === 0,
                  'aria-label': `${project.name} 上移`, onClick: () => onMove(project, -1), children: '↑' }),
                react_jsx_runtime.jsx('button', { type: 'button',
                  disabled: busy || index === userProjects.length - 1,
                  'aria-label': `${project.name} 下移`, onClick: () => onMove(project, 1), children: '↓' })
              ]
            })
          ]
        }, project.projectId);
      };
      return react_jsx_runtime.jsxs('section', {
        className: 'wd11-projectDrawer', 'aria-label': '项目抽屉', children: [
          react_jsx_runtime.jsxs('div', { className: 'wd11-projectHead', children: [
            react_jsx_runtime.jsx('h2', { children: '项目' }),
            react_jsx_runtime.jsx('button', { type: 'button', disabled: busy,
              'aria-pressed': state.manage, onClick: () => state.dispatch({
                type: 'manage', value: !state.manage
              }), children: state.manage ? '完成' : '管理' })
          ] }),
          react_jsx_runtime.jsxs('div', { className: 'wd11-projectList', children: [
            react_jsx_runtime.jsxs('div', {
              className: 'wd11-projectRow', 'data-current': state.selectedProjectId === CONTROL_PROJECT_ID,
              children: react_jsx_runtime.jsxs('button', {
                type: 'button', className: 'wd11-projectMain', disabled: busy,
                onClick: onConsole, 'aria-label': '打开控制室', children: [
                  react_jsx_runtime.jsx('span', { className: 'wd11-projectIcon', children: consoleProject.icon }),
                  react_jsx_runtime.jsx('span', { className: 'wd11-projectName', children: '控制室' }),
                  react_jsx_runtime.jsxs('span', { className: 'wd11-projectDots', 'aria-hidden': true,
                    children: [
                      react_jsx_runtime.jsx('span', { className: 'wd11-dot', 'data-on': true }),
                      react_jsx_runtime.jsx('span', { className: 'wd11-dot',
                        'data-on': state.console.counts.glowing > 0 || undefined })
                    ] })
                ]
              })
            }),
            visibleProjects.map((project) => row(project, userProjects.indexOf(project))),
            state.projects.status === 'ready' && userProjects.length === 0
              && react_jsx_runtime.jsx('p', { className: 'wd11-projectState', children:
                '还没有项目。从下方添加第一个。'
              }),
            statusText && react_jsx_runtime.jsxs('div', {
              className: 'wd11-projectState',
              'data-tone': ['error', 'stale'].includes(state.projects.status) ? 'warn' : 'quiet',
              role: 'status', children: [
                statusText,
                ['error', 'stale'].includes(state.projects.status)
                  && react_jsx_runtime.jsx('button', { type: 'button', className: 'wd11-projectRetry',
                    disabled: busy, onClick: onRefresh, children: '重试' })
              ]
            })
          ] }),
          state.createWizard.open && react_jsx_runtime.jsxs('section', {
            className: 'wd11-createWizard', 'aria-label': '新建项目向导', children: [
              react_jsx_runtime.jsx('h3', { children: '新建项目' }),
              react_jsx_runtime.jsx('p', { children:
                '先选项目模板，再由系统窗口选项目文件夹。取消选文件夹不会创建任何内容。'
              }),
              state.templateCatalog.length > 0 ? react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
                children: [
                  react_jsx_runtime.jsxs('label', { children: [
                    '项目模板',
                    react_jsx_runtime.jsx('select', {
                      value: state.createWizard.templateId || '', disabled: busy,
                      onChange: (event) => state.dispatch({
                        type: 'create:select', templateId: event.target.value
                      }),
                      children: state.templateCatalog.map((entry) => react_jsx_runtime.jsx('option', {
                        value: entry.id, children: entry.label
                      }, entry.id))
                    })
                  ] }),
                  react_jsx_runtime.jsx('span', { className: 'wd11-createHint', children:
                    selectedTemplate?.hint || '该模板由当前受管工作台提供。'
                  })
                ]
              }) : react_jsx_runtime.jsx('p', { role: 'status', children:
                '暂时读不到可用模板，请先刷新项目列表。'
              }),
              react_jsx_runtime.jsxs('div', { className: 'wd11-createActions', children: [
                react_jsx_runtime.jsx('button', {
                  type: 'button', disabled: busy || selectedTemplate === null,
                  onClick: () => selectedTemplate && onCreateTemplate(selectedTemplate.id),
                  children: '选择文件夹并创建'
                }),
                react_jsx_runtime.jsx('button', { type: 'button', disabled: busy,
                  onClick: onCloseCreate, children: '取消' })
              ] })
            ]
          }),
          state.bindOffer && react_jsx_runtime.jsxs('div', {
            className: 'wd11-bindOffer', role: 'status', children: [
              react_jsx_runtime.jsx('strong', { children: `已新建「${state.bindOffer.name}」` }),
              react_jsx_runtime.jsx('span', { children: currentSessionAvailable
                ? '，要绑定右侧当前对话吗？'
                : '。先从「对话」选一条会话，再回来绑定。' }),
              react_jsx_runtime.jsxs('div', { children: [
                react_jsx_runtime.jsx('button', { type: 'button', disabled: busy || !currentSessionAvailable,
                  onClick: () => onBind(state.bindOffer), children: '绑定当前对话' }),
                react_jsx_runtime.jsx('button', { type: 'button', disabled: busy,
                  onClick: onDismissBind, children: '稍后' })
              ] })
            ]
          }),
          state.notice && react_jsx_runtime.jsx('div', {
            className: 'wd11-projectState', role: 'status', children: state.notice
          }),
          react_jsx_runtime.jsx('button', { type: 'button', className: 'wd11-projectAdd',
            disabled: busy, onClick: onAdd, children: '＋ 添加项目' }),
          react_jsx_runtime.jsx('button', { type: 'button', className: 'wd11-projectAdd',
            disabled: busy, onClick: onAdopt, children: '↪ 认领已有文件夹' }),
          react_jsx_runtime.jsx('p', { className: 'wd11-projectFoot', children:
            '原生会话与设置一直可达；项目只管绑定和切换。'
          })
        ]
      });
    }

    function ControlRoom({ state, onTheme, onProject, onAdd, onRefresh }) {
      const cards = state.console.cards.filter((card) => (
        card.projectId !== CONTROL_PROJECT_ID && !card.hidden
      ));
      const busy = state.action !== null;
      const loading = ['loading', 'refreshing'].includes(state.console.status);
      const stateMessage = state.console.status === 'error' ? '控制室暂时读不到状态。'
        : state.console.status === 'stale' ? '同步失败，先显示上次状态。'
          : state.console.status === 'loading' ? '正在接入各项目的对话状态…' : '';
      const themeButtons = [
        ['dark', '🌙', '深色'], ['light', '☀️', '浅色'], ['system', '🖥️', '跟随系统']
      ];
      return react_jsx_runtime.jsxs('section', {
        className: 'wd11-control', 'data-wt-theme': state.theme,
        'aria-label': '控制室', children: [
          react_jsx_runtime.jsxs('header', { className: 'wd11-controlHead', children: [
            react_jsx_runtime.jsxs('div', { className: 'wd11-controlTitle', children: [
              react_jsx_runtime.jsx('div', { className: 'wd11-controlEyebrow', children: 'WHALEDOCK / LIVE' }),
              react_jsx_runtime.jsx('h1', { children: '控制室' }),
              react_jsx_runtime.jsx('p', { children: loading
                ? '正在同步…' : '哪里在忙、哪里等你，一眼看完。' })
            ] }),
            react_jsx_runtime.jsxs('div', { className: 'wd11-controlMeta', children: [
              state.console.counts.need > 0 && react_jsx_runtime.jsx('span', {
                className: 'wd11-controlCount', children: `${state.console.counts.need} 处等你`
              }),
              react_jsx_runtime.jsx('span', { className: 'wd11-controlCount', children:
                `${state.console.counts.busy} 工作中`
              }),
              react_jsx_runtime.jsx('div', { className: 'wd11-theme', role: 'group',
                'aria-label': '控制室主题', children: themeButtons.map(([value, icon, label]) => (
                  react_jsx_runtime.jsx('button', { type: 'button', title: label,
                    'aria-label': label, 'aria-pressed': state.theme === value,
                    onClick: () => onTheme(value), children: icon
                  }, `theme-${value}`)
                )) })
            ] })
          ] }),
          react_jsx_runtime.jsx('div', { className: 'wd11-controlBody', children:
            react_jsx_runtime.jsxs('div', { className: 'wd11-controlGrid', children: [
              stateMessage && react_jsx_runtime.jsxs('div', {
                className: 'wd11-controlState', role: 'status', children: [
                  stateMessage,
                  ['error', 'stale'].includes(state.console.status)
                    && react_jsx_runtime.jsx('button', { type: 'button', onClick: onRefresh,
                      children: '重试' })
                ]
              }),
              state.console.status === 'ready' && cards.length === 0
                && react_jsx_runtime.jsx('div', { className: 'wd11-controlState', children:
                  '还没有可监看的项目。添加项目后，这里会显示它的实时状态。'
                }),
              cards.map((card) => react_jsx_runtime.jsxs('button', {
                type: 'button', className: 'wd11-agentCard', disabled: busy,
                'data-wt-status': card.status, 'data-glow': card.glow || undefined,
                onClick: () => onProject(card.projectId),
                'aria-label': `打开 ${card.name}，${card.statusLabel}`,
                children: [
                  react_jsx_runtime.jsxs('div', { className: 'wd11-cardTop', children: [
                    react_jsx_runtime.jsxs('span', { className: 'wd11-cardProject', children: [
                      react_jsx_runtime.jsx('span', { children: card.icon }),
                      react_jsx_runtime.jsx('span', { children: card.name })
                    ] }),
                    react_jsx_runtime.jsx('span', { className: 'wd11-controlCount', children:
                      card.glow ? '新状态' : '已同步'
                    })
                  ] }),
                  react_jsx_runtime.jsx('strong', { className: 'wd11-cardStatus', children: card.statusLabel }),
                  react_jsx_runtime.jsxs('div', { className: 'wd11-cardFacts', children: [
                    react_jsx_runtime.jsx('span', { children: formatProjectRuntime(card.runtimeMs) }),
                    react_jsx_runtime.jsx('span', { children: `子代理 ${card.kids}` })
                  ] }),
                  react_jsx_runtime.jsx('p', { className: 'wd11-cardSession', children:
                    card.sessionTitle || '尚未绑定对话'
                  }),
                  card.recent && react_jsx_runtime.jsxs('p', {
                    className: 'wd11-cardRecent', children: [
                      react_jsx_runtime.jsx('span', { children:
                        card.recent.role === 'user' ? '你：' : 'AI：'
                      }),
                      card.recent.text
                    ]
                  })
                ]
              }, card.projectId)),
              react_jsx_runtime.jsxs('button', { type: 'button', className: 'wd11-controlAdd',
                disabled: busy, onClick: onAdd, children: [
                  react_jsx_runtime.jsx('strong', { children: '＋' }),
                  react_jsx_runtime.jsx('span', { children: '添加项目' })
                ]
              })
            ] })
          })
        ]
      });
    }

    function projectPaneTypeLabel(type) {
      return ({
        markdown: 'Markdown', text: '文本', image: '图像', html: 'HTML',
        browser: '网页', 'video-template': '短视频模板', artifact: '锁定产物'
      })[type] || '内容';
    }

    function projectArtifactSize(value) {
      if (value < 1024) return `${value} B`;
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
      return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
    }

    function projectTerminalStatus(value) {
      if (projectUiExact(value, ['kind']) && value.kind === 'running') {
        return Object.freeze({ kind: 'running' });
      }
      if (!projectUiExact(value, ['kind', 'exitCode', 'signal']) || value.kind !== 'exited'
          || !(value.exitCode === null || Number.isSafeInteger(value.exitCode))
          || !(value.signal === null || (typeof value.signal === 'string'
            && /^[A-Z][A-Z0-9]{2,15}$/.test(value.signal)))) return null;
      return Object.freeze({ kind: 'exited', exitCode: value.exitCode, signal: value.signal });
    }

    function projectTerminalPage(value) {
      if (!projectUiExact(value, [
        'contentType', 'renderMode', 'text', 'fromSeq', 'nextSeq', 'endSeq',
        'retainedBytes', 'truncated', 'hasMore'
      ]) || value.contentType !== 'text/plain' || value.renderMode !== 'text-only'
          || typeof value.text !== 'string' || utf8Bytes(value.text) > 32 * 1024
          || WORKSPACE_TEXT_CONTROL_RE.test(value.text)
          || !Number.isSafeInteger(value.fromSeq) || value.fromSeq < 0
          || !Number.isSafeInteger(value.nextSeq) || value.nextSeq < value.fromSeq
          || !Number.isSafeInteger(value.endSeq) || value.endSeq < value.nextSeq
          || !Number.isSafeInteger(value.retainedBytes) || value.retainedBytes < 0
          || value.retainedBytes > 512 * 1024
          || typeof value.truncated !== 'boolean' || typeof value.hasMore !== 'boolean') return null;
      return Object.freeze({ ...value });
    }

    function ProjectPreview({ preview, title }) {
      if (!preview) {
        return react_jsx_runtime.jsx('p', { className: 'wd11-previewUnavailable', children:
          '预览不可用或超过安全上限；项目内引用仍可用于核对。'
        });
      }
      if (preview.kind === 'image') {
        return react_jsx_runtime.jsxs('figure', {
          className: 'wd11-preview wd11-previewImage', 'data-preview-kind': 'image', children: [
            react_jsx_runtime.jsx('img', {
              src: preview.dataUrl, alt: `${title} 预览`, width: preview.width,
              height: preview.height, loading: 'lazy', decoding: 'async'
            }),
            react_jsx_runtime.jsx('figcaption', {
              children: `${preview.width} × ${preview.height} · 受限缩略图`
            })
          ]
        });
      }
      return react_jsx_runtime.jsxs('div', {
        className: 'wd11-preview', 'data-preview-kind': preview.kind, children: [
          react_jsx_runtime.jsx('pre', { className: 'wd11-previewText', children: preview.text }),
          preview.truncated && react_jsx_runtime.jsx('span', {
            className: 'wd11-previewNote', children: '内容已按安全上限截断。'
          })
        ]
      });
    }

    function ProjectVideoTemplate({ tab, surface }) {
      if (!surface || surface.templateId !== tab.templateId) {
        return react_jsx_runtime.jsxs('div', {
          className: 'wd11-templateState', role: 'status', children: [
            react_jsx_runtime.jsx('strong', { children: '短视频模板暂时不可用' }),
            react_jsx_runtime.jsx('span', { children:
              '当前项目没有匹配的受管模板；未回退到其他项目或旧工作区。'
            })
          ]
        });
      }
      return react_jsx_runtime.jsxs('section', {
        className: 'wd11-templateSurface', 'data-project-template': tab.templateId,
        'aria-label': `${tab.title} · 五阶段模板`, children: [
          react_jsx_runtime.jsx('aside', { className: 'wd11-templateCatalog', children:
            react_jsx_runtime.jsx(CreatorSidebar, {
              workspace: surface.workspace,
              catalog: surface.catalog,
              selectedToken: surface.selectedContent?.projectToken || null,
              onSelect: surface.onSelect,
              onRefresh: surface.onRefresh,
              onLoadMore: surface.onLoadMore
            })
          }),
          react_jsx_runtime.jsx(CreatorDetail, {
            routingProject: surface.workspace,
            project: surface.selectedContent,
            tab: surface.creatorTab,
            onTab: surface.onTab,
            workspaceFiles: surface.workspaceFiles,
            workspaceIdentity: surface.workspaceIdentity,
            alignment: surface.alignment,
            onAlign: surface.onAlign,
            onCatalogRefresh: surface.onRefresh,
            onProjectMutation: surface.onProjectMutation,
            onPublishCreated: surface.onPublishCreated,
            embedded: true
          })
        ]
      });
    }

    function ProjectTerminal({ projectId, paneRef, service }) {
      const [record, setRecord] = react.useState(null);
      const [output, setOutput] = react.useState('');
      const [message, setMessage] = react.useState('正在由 Host 打开本机 shell…');
      const [command, setCommand] = react.useState('');
      const recordRef = react.useRef(null);
      const nextSeq = react.useRef(0);
      const mountedRef = react.useRef(false);
      const generationRef = react.useRef(0);
      const controllerRef = react.useRef(null);
      const timerRef = react.useRef(null);
      const clearPump = react.useCallback(() => {
        controllerRef.current?.abort();
        controllerRef.current = null;
        if (timerRef.current !== null) globalThis.clearTimeout(timerRef.current);
        timerRef.current = null;
      }, []);
      const closeCredentials = react.useCallback((credentials) => {
        if (credentials && service?.close) {
          void service.close({ projectId, paneRef, ...credentials });
        }
      }, [paneRef, projectId, service]);
      const open = react.useCallback(async () => {
        const generation = generationRef.current + 1;
        generationRef.current = generation;
        clearPump();
        const previous = recordRef.current;
        recordRef.current = null;
        if (previous) closeCredentials(previous);
        setRecord(null);
        setOutput('');
        setMessage('正在由 Host 打开本机 shell…');
        if (!service?.open) { setMessage('终端服务不可用。'); return; }
        const controller = new AbortController();
        controllerRef.current = controller;
        // open 不绑定组件 AbortSignal：若界面在 Host 创建 PTY 期间卸载，仍等待凭据
        // 回来并走下面的 generation 分支显式 close，避免留下无人持有令牌的会话。
        const value = await service.open({ projectId, paneRef, cols: 100, rows: 28 });
        const credentials = value?.opened && value.terminalRef && value.capability
          ? Object.freeze({ terminalRef: value.terminalRef, capability: value.capability }) : null;
        if (!mountedRef.current || controller.signal.aborted
            || generationRef.current !== generation) {
          closeCredentials(credentials);
          return;
        }
        if (!credentials) {
          setMessage('终端未打开：' + (value?.code || '服务不可用'));
          return;
        }
        recordRef.current = credentials;
        nextSeq.current = value.page?.nextSeq || 0;
        setOutput(value.page?.text || '');
        if (value.status?.kind !== 'running') {
          recordRef.current = null;
          closeCredentials(credentials);
          setMessage('终端已退出');
          return;
        }
        setRecord(credentials);
        setMessage('已连接');
        const pump = async () => {
          const current = recordRef.current;
          if (!mountedRef.current || controller.signal.aborted
              || generationRef.current !== generation || current !== credentials
              || !service?.read) return;
          const result = await service.read({
            projectId, paneRef, ...credentials,
            afterSeq: nextSeq.current, maxBytes: 16 * 1024
          }, controller.signal);
          if (!mountedRef.current || controller.signal.aborted
              || generationRef.current !== generation || recordRef.current !== credentials) return;
          if (result?.accepted && result.page) {
            nextSeq.current = result.page.nextSeq;
            if (result.page.truncated) setOutput(`…[较早输出已截断]\n${result.page.text}`);
            else if (result.page.text) setOutput((currentText) => (
              `${currentText}${result.page.text}`.slice(-512 * 1024)
            ));
            if (result.status?.kind === 'exited') {
              recordRef.current = null;
              setRecord(null);
              setMessage('终端已退出');
              closeCredentials(credentials);
              return;
            }
          } else if (result?.code) {
            recordRef.current = null;
            setRecord(null);
            setMessage(`终端已停止：${result.code}`);
            closeCredentials(credentials);
            return;
          }
          timerRef.current = globalThis.setTimeout(
            pump, result?.page?.hasMore ? 20 : 240
          );
        };
        void pump();
      }, [clearPump, closeCredentials, paneRef, projectId, service]);
      react.useEffect(() => {
        mountedRef.current = true;
        void open();
        return () => {
          mountedRef.current = false;
          generationRef.current += 1;
          clearPump();
          const current = recordRef.current;
          recordRef.current = null;
          closeCredentials(current);
        };
      }, [clearPump, closeCredentials, open]);
      const submit = (event) => {
        event.preventDefault();
        const current = recordRef.current;
        const data = `${command}\n`;
        if (!current || !service?.write || !command || utf8Bytes(data) > 8 * 1024
            || /[\u0000-\u0007\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(command)) return;
        setCommand('');
        void service.write({ projectId, paneRef, ...current, data });
      };
      const close = () => {
        const current = recordRef.current;
        if (!current || !service?.close) return;
        const generation = generationRef.current + 1;
        generationRef.current = generation;
        clearPump();
        recordRef.current = null;
        setRecord(null);
        setMessage('正在关闭…');
        void service.close({ projectId, paneRef, ...current }).then((value) => {
          if (!mountedRef.current || generationRef.current !== generation) return;
          setMessage(value?.closed ? '已关闭' : `关闭未确认：${value?.code || '未知'}`);
        }, () => {
          if (mountedRef.current && generationRef.current === generation) {
            setMessage('关闭未确认：服务不可用');
          }
        });
      };
      return react_jsx_runtime.jsxs('section', { className: 'wd11-terminal', children: [
        react_jsx_runtime.jsx('p', { className: 'wd11-terminalNotice', children:
          '这是你主动打开的本机 shell。起始目录固定为项目根，环境已清空并按白名单重建；但它仍可以读取当前 macOS/Windows 用户有权限的其他文件并访问网络。'
        }),
        react_jsx_runtime.jsx('pre', { className: 'wd11-terminalOutput', children: output }),
        react_jsx_runtime.jsx('span', { className: 'wd11-terminalStatus', role: 'status',
          children: message }),
        react_jsx_runtime.jsx('form', { className: 'wd11-terminalForm', onSubmit: submit, children: [
          react_jsx_runtime.jsx('input', { value: command, disabled: !record,
            onChange: (event) => setCommand(event.target.value),
            'aria-label': '终端命令', placeholder: message }),
          react_jsx_runtime.jsx('button', { type: 'submit', disabled: !record || !command,
            children: '运行' })
        ] }),
        react_jsx_runtime.jsxs('div', { className: 'wd11-terminalActions', children: [
          react_jsx_runtime.jsx('button', { type: 'button', disabled: !record,
            onClick: () => recordRef.current && service?.signal?.({
              projectId, paneRef, ...recordRef.current, signal: 'SIGINT'
            }), children: '中断' }),
          react_jsx_runtime.jsx('button', { type: 'button', disabled: !record,
            onClick: close, children: '关闭' }),
          !record && react_jsx_runtime.jsx('button', { type: 'button', onClick: () => { void open(); },
            children: '重新打开' })
        ] })
      ] });
    }

    function ProjectTabContent({ tab, templateSurface, terminalSurface }) {
      if (tab === undefined) {
        return react_jsx_runtime.jsxs('div', { className: 'wd11-paneEmpty', children: [
          react_jsx_runtime.jsx('strong', { children: '窗口已就绪' }),
          react_jsx_runtime.jsx('span', { children: '等待 Agent 产物，或从项目动作中选择内容。' })
        ] });
      }
      if (tab.type === 'artifact') {
        const descriptor = tab.descriptor;
        const fingerprint = descriptor.fingerprint;
        return react_jsx_runtime.jsxs('article', {
          className: 'wd11-artifact', 'data-artifact-locked': true, children: [
            react_jsx_runtime.jsx('span', { className: 'wd11-artifactBadge', children: '只读 · 已锁定' }),
            react_jsx_runtime.jsx('strong', { children: projectPaneTypeLabel(descriptor.kind) }),
            react_jsx_runtime.jsx('p', { className: 'wd11-paneRef', children: descriptor.relativeRef }),
            react_jsx_runtime.jsxs('dl', { className: 'wd11-artifactMeta', children: [
              react_jsx_runtime.jsx('dt', { children: '状态' }),
              react_jsx_runtime.jsx('dd', { children: '已验证指纹' }),
              react_jsx_runtime.jsx('dt', { children: '大小' }),
              react_jsx_runtime.jsx('dd', { children: projectArtifactSize(fingerprint.size) }),
              react_jsx_runtime.jsx('dt', { children: '修改时间' }),
              react_jsx_runtime.jsx('dd', { children: new Date(fingerprint.mtime).toLocaleString() }),
              react_jsx_runtime.jsx('dt', { children: 'SHA-256' }),
              react_jsx_runtime.jsx('dd', { title: fingerprint.sha256,
                children: `${fingerprint.sha256.slice(0, 16)}…${fingerprint.sha256.slice(-8)}` })
            ] }),
            descriptor.kind !== 'html' && react_jsx_runtime.jsx(ProjectPreview, {
              preview: descriptor.preview, title: tab.title
            }),
            descriptor.kind === 'html' && react_jsx_runtime.jsx('p', {
              className: 'wd11-paneNotice', children:
                'HTML 产物仅能在 Electron 受控子窗中打开；当前页面不执行其中的代码。'
            })
          ]
        });
      }
      if (tab.type === 'browser') {
        return react_jsx_runtime.jsx('iframe', {
          className: 'wd11-browserFrame', title: tab.title, src: tab.url,
          sandbox: 'allow-forms allow-scripts', referrerPolicy: 'no-referrer'
        });
      }
      if (tab.type === 'video-template') {
        return react_jsx_runtime.jsx(ProjectVideoTemplate, { tab, surface: templateSurface });
      }
      if (tab.type === 'terminal') {
        return react_jsx_runtime.jsx(ProjectTerminal, {
          projectId: terminalSurface?.projectId,
          paneRef: tab.id,
          service: terminalSurface?.service
        });
      }
      return react_jsx_runtime.jsxs('article', { className: 'wd11-paneDocument', children: [
        react_jsx_runtime.jsx('h3', { children: `${projectPaneTypeLabel(tab.type)} · 只读预览` }),
        react_jsx_runtime.jsx('p', { className: 'wd11-paneRef', children: tab.relativeRef }),
        react_jsx_runtime.jsx(ProjectPreview, { preview: tab.preview, title: tab.title })
      ] });
    }

    function PaneWindow({ pane, slot, retained, templateSurface, terminalSurface, onDetach }) {
      const [activeId, setActiveId] = react.useState(() => pane.active);
      react.useEffect(() => { setActiveId(pane.active); }, [pane.window, pane.active]);
      const active = pane.tabs.find((tab) => tab.id === activeId)
        || pane.tabs.find((tab) => tab.id === pane.active) || pane.tabs[0];
      return react_jsx_runtime.jsxs('section', {
        className: 'wd11-paneWindow', style: slot ? { gridArea: slot } : undefined,
        'data-window': pane.window, 'data-retained': retained || undefined,
        'data-empty': active === undefined || undefined,
        'aria-label': pane.label, children: [
          react_jsx_runtime.jsxs('header', { className: 'wd11-paneWindowHead', children: [
            react_jsx_runtime.jsx('strong', { children: pane.label }),
            react_jsx_runtime.jsxs('span', { children: [
              retained ? '已保留' : pane.collapsed ? '已折叠' : '可见',
              active && active.type !== 'terminal' && react_jsx_runtime.jsx('button', { type: 'button',
                className: 'wd11-detach', title: '在独立窗口显示当前标签',
                onClick: () => onDetach(pane.window, active.id), children: '分离'
              })
            ] })
          ] }),
          pane.tabs.length > 1 && react_jsx_runtime.jsx('div', {
            className: 'wd11-paneTabs', role: 'tablist', 'aria-label': `${pane.label} 标签`,
            children: pane.tabs.map((tab) => react_jsx_runtime.jsx('button', {
              type: 'button', role: 'tab', 'aria-selected': active?.id === tab.id,
              onClick: () => setActiveId(tab.id), children: tab.title
            }, tab.id))
          }),
          !pane.collapsed && react_jsx_runtime.jsx('div', {
            className: 'wd11-paneContent', role: pane.tabs.length > 1 ? 'tabpanel' : undefined,
            children: react_jsx_runtime.jsx(ProjectTabContent, {
              tab: active, templateSurface, terminalSurface
            })
          })
        ]
      });
    }

    function ProjectPane({ state, currentSessionAvailable, onControl, onBind, onPreset,
      onRetry, onTemplateAction, onDetach, terminalService, templateSurface }) {
      const titleRef = react.useRef(null);
      const [terminalVisible, setTerminalVisible] = react.useState(false);
      const detail = state.detail;
      const project = detail.project;
      react.useEffect(() => { titleRef.current?.focus(); }, [project?.projectId]);
      react.useEffect(() => { setTerminalVisible(false); }, [project?.projectId]);
      if (project === null) {
        const message = detail.status === 'loading'
          ? '正在打开项目窗格…' : '项目详情暂时读不到。';
        return react_jsx_runtime.jsxs('section', {
          className: 'wd11-paneSurface', 'aria-label': '项目窗格', children: [
            react_jsx_runtime.jsxs('div', { className: 'wd11-paneState', role: 'status', children: [
              react_jsx_runtime.jsx('strong', { children: message }),
              detail.status === 'error' && react_jsx_runtime.jsx('button', {
                type: 'button', onClick: onRetry, children: '重试'
              }),
              react_jsx_runtime.jsx('button', { type: 'button', onClick: onControl,
                children: '返回控制室' })
            ] })
          ]
        });
      }
      const preset = project.paneState?.preset || project.layoutPreset || 'split-two';
      const slots = PROJECT_PANE_SLOTS[preset];
      const paneByNumber = new Map((project.paneState?.windows || []).map((pane) => (
        [pane.window, pane]
      )));
      const terminalWindowNumber = Array.from({ length: 16 }, (_value, index) => index + 1)
        .find((number) => !paneByNumber.has(number)) || null;
      const terminalPane = terminalVisible && terminalWindowNumber !== null
        ? Object.freeze({
          window: terminalWindowNumber,
          label: `窗口${terminalWindowNumber}`,
          tabs: Object.freeze([Object.freeze({
            id: `terminal-window-${terminalWindowNumber}`, type: 'terminal', title: '终端'
          })]),
          active: `terminal-window-${terminalWindowNumber}`,
          collapsed: false
        }) : null;
      const activePanes = slots.map((_slot, index) => paneByNumber.get(index + 1)
        || (terminalPane?.window === index + 1 ? terminalPane : null)
        || Object.freeze({ window: index + 1, label: `窗口${index + 1}`,
          tabs: Object.freeze([]), active: null, collapsed: false }));
      const retained = (project.paneState?.windows || []).filter((pane) => pane.window > slots.length);
      if (terminalPane && terminalPane.window > slots.length) retained.push(terminalPane);
      const busy = state.action !== null || detail.status === 'refreshing';
      const skinStyle = project.skin ? {
        '--dsw-alias-bg-base': project.skin.colors.background,
        '--dsw-alias-bg-layer-1': project.skin.colors.surface,
        '--dsw-alias-border-l1': project.skin.colors.border,
        '--dsw-alias-border-l2': project.skin.colors.border,
        '--dsw-alias-state-business-primary': project.skin.colors.primary,
        '--dsw-alias-state-business-tertiary': project.skin.colors.surface,
        '--dsw-alias-fg-primary': project.skin.colors.text,
        '--dsw-alias-fg-secondary': project.skin.colors.textMuted,
        '--dsw-alias-fg-tertiary': project.skin.colors.textMuted,
        '--wd11-template-accent': project.skin.colors.accent,
        colorScheme: project.skin.base
      } : undefined;
      return react_jsx_runtime.jsxs('section', {
        className: 'wd11-paneSurface', 'aria-label': `项目窗格：${project.name}`,
        'data-project-pane': true, 'data-detail-state': detail.status,
        'data-template-skin': project.skin ? project.skin.base : undefined,
        style: skinStyle, children: [
          react_jsx_runtime.jsxs('header', { className: 'wd11-paneHead', children: [
            react_jsx_runtime.jsxs('div', { className: 'wd11-paneTitle', children: [
              react_jsx_runtime.jsx('div', { className: 'wd11-paneEyebrow', children:
                `${project.folderTail || '未选文件夹'} / ${project.hasBinding ? '对话已绑定' : '对话未绑定'}`
              }),
              react_jsx_runtime.jsxs('h1', { ref: titleRef, tabIndex: -1, children: [
                react_jsx_runtime.jsx('span', { 'aria-hidden': true, children: `${project.icon} ` }),
                project.name
              ] }),
              react_jsx_runtime.jsx('p', { children:
                '窗口编号始终稳定；切换布局只补齐所需窗口，已有内容会保留。'
              })
            ] }),
            react_jsx_runtime.jsxs('div', { className: 'wd11-paneActions', children: [
              react_jsx_runtime.jsx('button', { type: 'button', onClick: onControl,
                children: '← 控制室' }),
              !project.hasBinding && react_jsx_runtime.jsx('button', {
                type: 'button', disabled: busy || !currentSessionAvailable,
                title: currentSessionAvailable ? '绑定右侧当前对话' : '请先在「对话」选择一条会话',
                onClick: () => onBind(project), children: '绑定当前对话'
              }),
              react_jsx_runtime.jsx('button', {
                type: 'button', disabled: busy || !project.hasFolder || !project.hasBinding
                  || (terminalWindowNumber === null && !terminalVisible),
                'aria-pressed': terminalVisible,
                title: project.hasFolder && project.hasBinding
                  ? '在项目根启动环境白名单化的本机 shell'
                  : '项目文件夹和对话都就绪后才可打开',
                onClick: () => setTerminalVisible((value) => !value),
                children: terminalVisible ? '收起终端' : '终端'
              }),
              ...PROJECT_PANE_PRESETS.map((value) => react_jsx_runtime.jsx('button', {
                type: 'button', disabled: busy, 'aria-pressed': preset === value,
                onClick: () => onPreset(value),
                children: ({ 'split-two': '双栏', 'left-stack': '左叠右单',
                  'grid-four': '四宫格' })[value]
              }, value)),
            ] })
          ] }),
          (project.templateActions.length > 0 || project.templateActionsCapped)
            && react_jsx_runtime.jsxs('div', {
              className: 'wd11-templateActions', role: 'toolbar',
              'aria-label': '项目模板动作', children: [
                react_jsx_runtime.jsx('strong', { children: '模板动作' }),
                ...project.templateActions.map((action) => react_jsx_runtime.jsx('button', {
                  type: 'button', disabled: busy || !project.hasBinding,
                  title: action.hint || undefined,
                  onClick: () => onTemplateAction(action.id),
                  children: action.label
                }, action.id)),
                project.templateActionsCapped && react_jsx_runtime.jsx('span', {
                  role: 'status', children: '动作列表超过安全上限，本次未显示。'
                })
              ]
            }),
          detail.status === 'stale' && react_jsx_runtime.jsxs('div', {
            className: 'wd11-paneNotice', role: 'status', children: [
              react_jsx_runtime.jsx('span', { children:
                '项目详情同步失败，先保留上次已验证的窗格。'
              }),
              react_jsx_runtime.jsx('button', { type: 'button', onClick: onRetry,
                children: '重试详情同步' })
            ]
          }),
          !project.hasFolder && react_jsx_runtime.jsx('p', {
            className: 'wd11-paneNotice', role: 'status', children:
              '项目文件夹当前不可用；已有窗格将以只读摘要显示。'
          }),
          react_jsx_runtime.jsxs('div', { className: 'wd11-paneBody', children: [
            react_jsx_runtime.jsx('div', { className: 'wd11-paneGrid', 'data-preset': preset,
              children: activePanes.map((pane, index) => react_jsx_runtime.jsx(PaneWindow, {
                pane, slot: slots[index], retained: false, templateSurface, onDetach,
                terminalSurface: { projectId: project.projectId, service: terminalService }
              }, `window-${pane.window}`))
            }),
            retained.length > 0 && react_jsx_runtime.jsxs('section', {
              className: 'wd11-retained', 'aria-label': '已保留窗口', children: [
                react_jsx_runtime.jsx('h2', { children: '已保留的其他窗口' }),
                react_jsx_runtime.jsx('div', { className: 'wd11-retainedGrid', children:
                  retained.map((pane) => react_jsx_runtime.jsx(PaneWindow, {
                    pane, retained: true, templateSurface, onDetach,
                    terminalSurface: { projectId: project.projectId, service: terminalService }
                  }, `retained-${pane.window}`))
                })
              ]
            })
          ] })
        ]
      });
    }

    function WhaleDockContentShell({ useSessions, useWorkspaces, mount, integration }) {
      const sessionState = useSessions((state) => state);
      const workspaceState = useWorkspaces((state) => state);
      const projects = react.useMemo(
        () => creatorProjects(sessionState, workspaceState), [sessionState, workspaceState]
      );
      const { preferences, projectActions, workspaceFiles, whaledockProjects,
        projectDetailReader, projectOpenCurrent, browserOnly } = integration;
      const [mode, setMode] = react.useState(() => {
        if (browserOnly) return 'sessions';
        return 'projects';
      });
      const [hintSeen, setHintSeen] = react.useState(false);
      const [preferenceError, setPreferenceError] = react.useState('');
      const [panelCollapsed, setPanelCollapsed] = react.useState(false);
      const [creatorTab, setCreatorTab] = react.useState('overview');
      const [alignmentPending, setAlignmentPending] = react.useState(false);
      const [alignmentError, setAlignmentError] = react.useState('');
      const [catalog, setCatalog] = react.useState({ status: 'idle', projects: [] });
      const [selectedContentToken, setSelectedContentToken] = react.useState(null);
      const [catalogRefreshKey, setCatalogRefreshKey] = react.useState(0);
      const [projectRefreshKey, setProjectRefreshKey] = react.useState(0);
      const [detailRefreshKey, setDetailRefreshKey] = react.useState(0);
      const [pendingProjectSwitch, setPendingProjectSwitch] = react.useState(null);
      const [workbench, dispatchWorkbench] = react.useReducer(
        projectWorkbenchReducer, undefined, initialProjectWorkbenchState
      );
      const alignmentAttempt = react.useRef(0);
      const alignmentInFlight = react.useRef(null);
      const alignmentExpected = react.useRef(null);
      const alignmentKnown = react.useRef(null);
      const ensuredWorkspace = react.useRef({ path: null, workspaceId: undefined });
      const catalogAttempt = react.useRef(0);
      const catalogIdentity = react.useRef(null);
      const catalogPages = react.useRef(1);
      const catalogBusy = react.useRef(false);
      const catalogLoadMoreAttempt = react.useRef(0);
      const catalogLoadMoreAbort = react.useRef(null);
      const selectedContentRef = react.useRef(null);
      const catalogReadbackTarget = react.useRef(null);
      const panelCollapseButton = react.useRef(null);
      const panelExpandButton = react.useRef(null);
      const panelFocusReady = react.useRef(false);
      const alignmentCurrent = react.useRef(sessionState.current);
      const legacyMode = react.useRef('content');
      const projectReadAttempt = react.useRef(0);
      const consoleReadAttempt = react.useRef(0);
      const projectActionToken = react.useRef(0);
      const projectActionInFlight = react.useRef(null);
      const detailReadAttempt = react.useRef(0);
      const detailRevisionAttempted = react.useRef({
        projectId: null, revision: -1, manualKey: 0
      });
      const selectModeRef = react.useRef(null);
      const openProjectRef = react.useRef(null);
      const consumedProjectSwitch = react.useRef((() => {
        try {
          const value = Number(globalThis.sessionStorage.getItem(PROJECT_SWITCH_STORAGE_KEY));
          return Number.isSafeInteger(value) && value >= 0 ? value : 0;
        } catch (_error) { return 0; }
      })());
      const modeRef = react.useRef(mode);
      modeRef.current = mode;
      const currentSession = sessionState.current === undefined
        ? undefined : sessionState.byId[sessionState.current];
      const currentPath = normalizeProjectPath(currentSession?.cwd);
      const currentContentRoot = currentSession !== undefined
        && currentSession.origin !== 'subagent';
      const openedTemplateProject = workbench.detail.project;
      const templateSessionCurrent = mode === 'projects'
        && workbench.detail.opened === true
        && openedTemplateProject?.hasBinding === true
        && typeof projectOpenCurrent === 'function'
        && projectOpenCurrent(openedTemplateProject.projectId);
      // 经典短视频模式仍跟随 Host 工作根；项目窗格只在本页
      // 两阶段 commit 仍有效时使用当前绑定会话的 cwd，绝不回退到 Host 根。
      const targetSource = mode === 'projects'
        ? templateSessionCurrent ? 'current-session' : 'none'
        : 'host';
      const managedTarget = browserOnly ? null : projectActions?.target?.(targetSource);
      const managedTargetPath = managedTarget?.ok === true
        ? normalizeProjectPath(managedTarget.cwd) : '';
      const managedTargetPathRef = react.useRef(managedTargetPath);
      managedTargetPathRef.current = managedTargetPath;
      const activeRoutingProject = projects.find((project) => project.path === managedTargetPath)
        || (managedTargetPath ? Object.freeze({
          key: `path:${managedTargetPath}`,
          title: projectTitle(managedTargetPath, '当前内容'),
          path: managedTargetPath,
          pathTail: projectPathTail(managedTargetPath),
          sessions: Object.freeze([]), sessionIds: Object.freeze([]),
          running: false, updatedAt: 0, representativeId: undefined
        }) : undefined);
      const routingMismatch = activeRoutingProject !== undefined
        && (!currentContentRoot || currentPath !== managedTargetPath
          || (mode === 'projects' && !templateSessionCurrent));
      const catalogReadable = !browserOnly && !!managedTargetPath && !routingMismatch;
      const currentCatalogIdentity = !browserOnly && managedTargetPath
        ? `path:${managedTargetPath}` : null;
      const projectTemplateSurfaceCurrent = templateSessionCurrent
        && !!managedTargetPath && currentContentRoot && currentPath === managedTargetPath;
      const alignmentScope = react.useRef({ mode, path: managedTargetPath });

      react.useLayoutEffect(() => {
        const previous = alignmentScope.current;
        if (previous.mode === mode && previous.path === managedTargetPath) return;
        alignmentScope.current = { mode, path: managedTargetPath };
        alignmentAttempt.current += 1;
        alignmentInFlight.current = null;
        const expected = alignmentExpected.current;
        alignmentExpected.current = null;
        expected?.finish(false);
        if (previous.path !== managedTargetPath) alignmentKnown.current = null;
        setAlignmentPending(false);
        setAlignmentError('');
      }, [mode, managedTargetPath]);

      react.useLayoutEffect(() => {
        const expected = alignmentExpected.current;
        if (expected !== null) {
          if (Object.is(sessionState.current, expected.sessionId)
              && currentContentRoot && currentPath === expected.path) {
            projectActions?.observe?.(
              expected.sessionId, expected.path, expected.workspaceId
            );
            const known = alignmentKnown.current;
            if (known !== null && known.path === expected.path
                && Object.is(known.sessionId, expected.sessionId)) {
              alignmentKnown.current = Object.freeze({
                path: known.path, sessionId: known.sessionId, observed: true
              });
            }
            alignmentExpected.current = null;
            expected.finish(true);
          } else if (sessionState.current !== undefined
              && !Object.is(sessionState.current, expected.fromSessionId)
              && !Object.is(sessionState.current, expected.sessionId)) {
            alignmentExpected.current = null;
            expected.finish(false);
          }
        }
        if (!Object.is(alignmentCurrent.current, sessionState.current)) {
          alignmentCurrent.current = sessionState.current;
          alignmentAttempt.current += 1;
          alignmentInFlight.current = null;
          setAlignmentPending(false);
          setAlignmentError('');
        }
      }, [sessionState.current, currentPath, currentContentRoot]);
      react.useEffect(() => {
        if (preferences === undefined) return;
        const sync = (value) => {
          let snapshot = value;
          try {
            snapshot = snapshot && typeof snapshot === 'object'
              ? snapshot : preferences.getSnapshot();
          } catch (_error) {
            setPreferenceError('视图设置暂时读不到；已按默认方式显示。');
            return;
          }
          if (snapshot?.contentViewMode === 'content' || snapshot?.contentViewMode === 'sessions') {
            legacyMode.current = snapshot.contentViewMode;
            setMode((current) => current === 'projects' ? current : snapshot.contentViewMode);
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
          setPreferenceError('视图设置暂时读不到；已按默认方式显示。');
        }
      }, [preferences]);
      react.useEffect(() => {
        if (browserOnly) return undefined;
        const fullWorkbench = mode === 'projects';
        const projectRequest = ++projectReadAttempt.current;
        const consoleRequest = fullWorkbench ? ++consoleReadAttempt.current : null;
        if (!whaledockProjects || typeof whaledockProjects.list !== 'function'
            || (fullWorkbench && typeof whaledockProjects.readConsole !== 'function')) {
          if (fullWorkbench) {
            dispatchWorkbench({ type: 'projects:start', request: projectRequest });
            dispatchWorkbench({ type: 'projects:error', request: projectRequest });
            dispatchWorkbench({ type: 'console:start', request: consoleRequest });
            dispatchWorkbench({ type: 'console:error', request: consoleRequest });
          }
          return undefined;
        }
        const controller = new AbortController();
        let pollTimer = null;
        let slowTimer = null;
        const acceptSwitchCommand = (command) => {
          if (command === null) return;
          const next = projectSwitchSequence(consumedProjectSwitch.current, command);
          if (next === null) return;
          // 先持久“已消费”，再触发视图切换；打开失败也不会被同一 seq 重试。
          consumedProjectSwitch.current = next;
          try { globalThis.sessionStorage.setItem(PROJECT_SWITCH_STORAGE_KEY, String(next)); }
          catch (_error) { /* 本页内存仍保持去重 */ }
          setPendingProjectSwitch(Object.freeze({ ...command }));
        };
        const readProjects = async (request, full) => {
          if (full) {
            dispatchWorkbench({ type: 'projects:start', request });
            slowTimer = globalThis.setTimeout(() => {
              if (!controller.signal.aborted) {
                dispatchWorkbench({ type: 'projects:slow', request });
              }
            }, PROJECT_SLOW_MS);
          }
          let cursor = 0;
          let revision = null;
          const items = [];
          let templateCatalog = Object.freeze([]);
          try {
            const pages = full ? 8 : 1;
            for (let page = 0; page < pages && cursor !== null; page += 1) {
              const snapshot = await whaledockProjects.list({
                cursor, limit: 32, includeHidden: full
              }, controller.signal);
              const result = projectListResult(snapshot);
              if (!result || result.cursor !== cursor
                  || (revision !== null && revision !== result.revision)) {
                throw new Error('project-list-invalid');
              }
              revision = result.revision;
              if (page === 0) {
                templateCatalog = result.templateCatalog;
                acceptSwitchCommand(result.switchCommand);
              }
              for (const project of result.projects) {
                if (items.some((item) => item.projectId === project.projectId)) {
                  throw new Error('project-list-duplicate');
                }
                items.push(project);
              }
              cursor = result.nextCursor;
            }
            if (full && cursor !== null) throw new Error('project-list-overflow');
            if (!controller.signal.aborted) {
              if (full) {
                dispatchWorkbench({ type: 'projects:success', request,
                  revision: revision === null ? 0 : revision, items, templateCatalog });
              } else {
                dispatchWorkbench({ type: 'templates:success', items: templateCatalog });
              }
            }
          } catch (_error) {
            if (full && !controller.signal.aborted) {
              dispatchWorkbench({ type: 'projects:error', request });
            }
          } finally {
            if (slowTimer !== null) globalThis.clearTimeout(slowTimer);
            slowTimer = null;
          }
        };
        const readConsole = async (request) => {
          dispatchWorkbench({ type: 'console:start', request });
          try {
            const snapshot = await whaledockProjects.readConsole(controller.signal);
            const result = projectConsoleResult(snapshot);
            if (!result) throw new Error('project-console-invalid');
            if (!controller.signal.aborted) {
              dispatchWorkbench({ type: 'console:success', request,
                revision: result.revision, cards: result.cards, counts: result.counts });
            }
          } catch (_error) {
            if (!controller.signal.aborted) {
              dispatchWorkbench({ type: 'console:error', request });
            }
          }
        };
        const poll = async (nextProjectRequest, nextConsoleRequest) => {
          const reads = [readProjects(nextProjectRequest, fullWorkbench)];
          if (fullWorkbench) reads.push(readConsole(nextConsoleRequest));
          await Promise.allSettled(reads);
          if (controller.signal.aborted) return;
          pollTimer = globalThis.setTimeout(() => {
            void poll(
              ++projectReadAttempt.current,
              fullWorkbench ? ++consoleReadAttempt.current : null
            );
          }, PROJECT_POLL_MS);
        };
        void poll(projectRequest, consoleRequest);
        return () => {
          controller.abort();
          if (slowTimer !== null) globalThis.clearTimeout(slowTimer);
          if (pollTimer !== null) globalThis.clearTimeout(pollTimer);
        };
      // 仅当前会话换人时立即重读；运行态的其他 snapshot 变化
      // 交给 2 秒轮询消化。否则 bootstrap 期间的连续 session 通知会
      // 反复取消并重建 list/console，耗尽页级并发名额，挡住 bind。
      }, [browserOnly, mode, whaledockProjects, projectRefreshKey, sessionState.current]);
      react.useEffect(() => {
        if (browserOnly || pendingProjectSwitch === null) return;
        if (mode !== 'projects') {
          selectModeRef.current?.('projects');
          return;
        }
        // 清空 pending 后才调用，打开失败不进入任何自动重试队列。
        setPendingProjectSwitch(null);
        if (typeof openProjectRef.current === 'function') {
          openProjectRef.current(pendingProjectSwitch.projectId, { shortcut: true });
        } else {
          dispatchWorkbench({ type: 'notice', value: '项目快捷切换暂时不可用。' });
        }
      }, [browserOnly, mode, pendingProjectSwitch]);
      react.useEffect(() => {
        const projectId = workbench.detail.project?.projectId;
        const registryRevision = workbench.projects.revision;
        const attempted = detailRevisionAttempted.current;
        const revisionChanged = registryRevision > workbench.detail.revision
          && (attempted.projectId !== projectId || attempted.revision !== registryRevision);
        const manualRetry = detailRefreshKey > attempted.manualKey;
        if (browserOnly || mode !== 'projects' || workbench.surface !== 'project'
            || !APP_PROJECT_ID_RE.test(projectId || '')
            || typeof projectDetailReader !== 'function'
            || (!revisionChanged && !manualRetry)) return undefined;
        const request = ++detailReadAttempt.current;
        const controller = new AbortController();
        detailRevisionAttempted.current = {
          projectId, revision: registryRevision, manualKey: detailRefreshKey
        };
        dispatchWorkbench({ type: 'detail:start', request, projectId,
          revision: registryRevision });
        void (async () => {
          try {
            const snapshot = await projectDetailReader(projectId, controller.signal);
            const envelope = projectOpenEnvelope(snapshot, 'open-prepared');
            if (!envelope) throw new Error('project-detail-invalid');
            if (!controller.signal.aborted) {
              dispatchWorkbench({
                type: 'detail:success', request, project: envelope.project,
                revision: registryRevision,
                opened: typeof projectOpenCurrent === 'function'
                  && projectOpenCurrent(projectId, envelope.bindingRef)
              });
            }
          } catch (_error) {
            if (!controller.signal.aborted) {
              dispatchWorkbench({ type: 'detail:error', request });
            }
          }
        })();
        return () => { controller.abort(); };
      }, [browserOnly, mode, projectDetailReader, projectOpenCurrent, detailRefreshKey,
        workbench.surface, workbench.projects.revision,
        workbench.detail.project?.projectId, workbench.detail.revision]);
      react.useEffect(() => {
        if (!panelFocusReady.current) {
          panelFocusReady.current = true;
          return;
        }
        (panelCollapsed ? panelExpandButton : panelCollapseButton).current?.focus();
      }, [panelCollapsed]);
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
        let contextRetry = 0;
        if (identityChanged) {
          catalogPages.current = 1;
          selectedContentRef.current = null;
          catalogReadbackTarget.current = null;
          setSelectedContentToken(null);
          setCatalog({ status: identity ? 'loading' : 'idle', projects: [], nextCursor: null });
        }
        if (!identity || !catalogReadable || !workspaceFiles
            || typeof workspaceFiles.execute !== 'function') {
          if (identity && !catalogReadable) {
            setCatalog((current) => current.projects.length > 0
              ? { ...current, status: 'stale', loadingMore: false }
              : { status: 'loading', projects: [], nextCursor: null });
          }
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
          let pagesRead = 0;
          try {
            for (let page = 0; page < MAX_CONTENT_CATALOG_PAGES && cursor !== null; page += 1) {
              const readbackRef = catalogReadbackTarget.current?.contentRef || null;
              if (page >= pageTarget && (!readbackRef
                  || merged.some((item) => item.contentRef === readbackRef))) break;
              const snapshot = await workspaceFiles.execute(
                'catalog.read', { cursor, limit: 4 }, controller.signal
              );
              result = contentCatalogResult(snapshot);
              if (!result) throw new Error('catalog-invalid');
              pagesRead += 1;
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
            contextRetry = 0;
            const prior = selectedContentRef.current;
            const readback = catalogReadbackTarget.current;
            if (readback && merged.some((item) => item.contentRef === readback.contentRef)) {
              catalogPages.current = Math.max(catalogPages.current, pagesRead);
              catalogReadbackTarget.current = null;
            } else if (readback && cursor === null) catalogReadbackTarget.current = null;
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
          const retryDelay = result || mode !== 'projects'
            ? 4000 : PROJECT_CONTEXT_RETRY_MS[contextRetry++] ?? null;
          if (retryDelay !== null) timer = globalThis.setTimeout(readPages, retryDelay);
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
      }, [mode, currentCatalogIdentity, catalogReadable, workspaceFiles, catalogRefreshKey]);

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

      const applyProjectMutation = react.useCallback((mutation) => {
        const selected = selectedContentRef.current;
        if (!selected || selected.contentRef !== mutation.contentRef) return;
        selectedContentRef.current = {
          contentRef: mutation.contentRef, token: mutation.projectToken
        };
        setSelectedContentToken(mutation.projectToken);
        setCatalog((current) => ({
          ...current,
          projects: current.projects.map((project) => project.contentRef === mutation.contentRef
            ? Object.freeze({ ...project, projectToken: mutation.projectToken,
              ...(typeof mutation.updated === 'string' ? { updated: mutation.updated } : {}) }) : project)
        }));
        refreshCatalog();
      }, [refreshCatalog]);

      const applyPublishCreated = react.useCallback((surface) => {
        const project = Object.freeze({
          contentRef: surface.contentRef,
          projectToken: surface.projectToken,
          title: surface.title,
          workflowLabel: surface.stageLabel,
          updated: surface.updated,
          actions: Object.freeze([])
        });
        selectedContentRef.current = {
          contentRef: project.contentRef, token: project.projectToken
        };
        catalogReadbackTarget.current = project;
        setSelectedContentToken(project.projectToken);
        setCatalog((current) => {
          const projects = current.projects.filter((item) => item.contentRef !== project.contentRef);
          projects.push(project);
          return {
            ...current,
            status: 'ready',
            projects,
            projectCount: Math.max(current.projectCount || 0, projects.length)
          };
        });
      }, []);

      const writePreference = async (patch) => {
        if (preferences === undefined || typeof preferences.write !== 'function') {
          setPreferenceError('本次切换只在当前窗口生效；不影响继续使用。');
          return;
        }
        try {
          const result = await preferences.write(patch);
          setPreferenceError(result?.ok === false
            ? '本次切换只在当前窗口生效；不影响继续使用。' : '');
        } catch (_error) {
          setPreferenceError('本次切换只在当前窗口生效；不影响继续使用。');
        }
      };
      const selectMode = (next) => {
        if (next === 'content') setPanelCollapsed(false);
        if (next !== 'content') {
          alignmentAttempt.current += 1;
          alignmentInFlight.current = null;
          const expected = alignmentExpected.current;
          alignmentExpected.current = null;
          expected?.finish(false);
          setAlignmentPending(false);
        }
        setMode(next);
        if (!browserOnly && (next === 'content' || next === 'sessions')) {
          legacyMode.current = next;
          void writePreference({ contentViewMode: next });
        }
      };
      selectModeRef.current = selectMode;
      const refreshProjectWorkbench = () => {
        setProjectRefreshKey((current) => current + 1);
      };
      const actionFailureMessage = projectActionFailureMessage;
      const performProjectAction = async (kind, projectId, invoke, accept, detailRequest = null) => {
        if (projectActionInFlight.current !== null) {
          dispatchWorkbench({ type: 'notice', value: '上一个操作还在进行，请稍等。' });
          return;
        }
        const token = ++projectActionToken.current;
        const controller = new AbortController();
        const operation = Object.freeze({ token, controller });
        projectActionInFlight.current = operation;
        dispatchWorkbench({ type: 'action:start', token, kind, projectId });
        let outcome = { notice: '' };
        let refresh = false;
        try {
          const snapshot = await invoke(controller.signal);
          if (controller.signal.aborted || projectActionInFlight.current !== operation) return;
          const accepted = accept(snapshot);
          if (!accepted) outcome = { notice: actionFailureMessage(snapshot, kind) };
          else {
            outcome = accepted;
            refresh = accepted.refresh !== false;
          }
        } catch (_error) {
          if (!controller.signal.aborted) {
            outcome = { notice: '操作没有完成，项目原状保留。' };
          }
        } finally {
          if (projectActionInFlight.current === operation) {
            projectActionInFlight.current = null;
            dispatchWorkbench({ type: 'action:finish', token,
              notice: outcome.notice || '',
              ...(Object.prototype.hasOwnProperty.call(outcome, 'bindOffer')
                ? { bindOffer: outcome.bindOffer } : {}) });
            if (outcome.selectedProjectId) {
              dispatchWorkbench({ type: 'select', projectId: outcome.selectedProjectId });
            }
            if (outcome.closeCreate === true) {
              dispatchWorkbench({ type: 'create:close' });
            }
            if (detailRequest !== null) {
              if (outcome.projectDetail) {
                detailRevisionAttempted.current = {
                  projectId: outcome.projectDetail.projectId,
                  revision: workbench.projects.revision,
                  manualKey: detailRefreshKey
                };
                dispatchWorkbench({ type: 'detail:success', request: detailRequest,
                  project: outcome.projectDetail, revision: workbench.projects.revision,
                  opened: outcome.projectOpened === true });
              } else {
                dispatchWorkbench({ type: 'detail:error', request: detailRequest });
              }
            }
            if (refresh && !controller.signal.aborted) refreshProjectWorkbench();
          }
        }
      };
      react.useEffect(() => () => {
        projectActionInFlight.current?.controller.abort();
        projectActionInFlight.current = null;
      }, []);
      const addProject = () => {
        dispatchWorkbench({ type: 'create:open' });
      };
      const adoptProject = () => {
        if (!whaledockProjects?.adopt) {
          dispatchWorkbench({ type: 'notice', value: '项目认领服务暂时不可用。' });
          return;
        }
        void performProjectAction('adopt', null,
          (signal) => whaledockProjects.adopt(signal), (snapshot) => {
            const result = snapshot?.state === 'fulfilled' ? snapshot.result : null;
            const project = result?.kind === 'adopted' ? projectUiSummary(result.project) : null;
            if (!project || !['existing', 'relinked', 'manifest', 'new'].includes(result.adopted)) {
              return null;
            }
            const labels = {
              existing: '该文件夹已在项目列表。',
              relinked: '已按旁车身份重新连上搬家后的项目。',
              manifest: '已从旁车恢复项目身份。',
              new: '已认领为新项目；尚未写入旁车。'
            };
            return {
              notice: labels[result.adopted], selectedProjectId: project.projectId,
              bindOffer: project.hasBinding ? null : Object.freeze({
                projectId: project.projectId, name: project.name
              })
            };
          });
      };
      const createProjectFromTemplate = (templateId) => {
        if (!whaledockProjects?.create) {
          dispatchWorkbench({ type: 'notice', value: '项目服务暂时不可用。' });
          return;
        }
        if (!workbench.templateCatalog.some((entry) => entry.id === templateId)) {
          dispatchWorkbench({ type: 'notice', value: '这个模板已失效，请刷新后重选。' });
          return;
        }
        void performProjectAction('create', null,
          (signal) => whaledockProjects.create({ templateId }, signal), (snapshot) => {
            const result = projectMutationResult(snapshot);
            return result ? {
              notice: '项目已添加。',
              bindOffer: Object.freeze({
                projectId: result.project.projectId, name: result.project.name
              }),
              selectedProjectId: result.project.projectId,
              closeCreate: true
            } : null;
          });
      };
      const bindProject = (project) => {
        if (!whaledockProjects?.bindCurrent || sessionState.current === null
            || sessionState.current === undefined) {
          dispatchWorkbench({ type: 'notice', value: '右侧当前没有可绑定的对话。' });
          return;
        }
        void performProjectAction('bind', project.projectId,
          (signal) => whaledockProjects.bindCurrent({ projectId: project.projectId }, signal),
          (snapshot) => snapshot?.state === 'fulfilled'
            && snapshot.result?.kind === 'binding'
            && snapshot.result?.projectId === project.projectId
            ? { notice: `「${project.name}」已绑定当前对话。`, bindOffer: null }
            : null);
      };
      const writeProjectSidecar = (project) => {
        if (!whaledockProjects?.writeSidecar) {
          dispatchWorkbench({ type: 'notice', value: '项目旁车服务暂时不可用。' });
          return;
        }
        if (typeof globalThis.confirm !== 'function'
            || !globalThis.confirm(`要在「${project.name}」文件夹写入 .whaledock/project.json 吗？\n\n它只保存项目身份、名称、图标和模板，不保存对话或绝对路径。`)) return;
        void performProjectAction('sidecar', project.projectId,
          (signal) => whaledockProjects.writeSidecar({ projectId: project.projectId }, signal),
          (snapshot) => snapshot?.state === 'fulfilled'
            && snapshot.result?.kind === 'sidecar'
            && snapshot.result?.projectId === project.projectId
            && snapshot.result?.written === true
            ? { notice: '项目旁车已写入；换机后可用「认领已有文件夹」恢复。' }
            : null);
      };
      const updateProject = (project, changes, notice) => {
        if (!whaledockProjects?.update) {
          dispatchWorkbench({ type: 'notice', value: '项目服务暂时不可用。' });
          return;
        }
        void performProjectAction('update', project.projectId,
          (signal) => whaledockProjects.update({ projectId: project.projectId, changes }, signal),
          (snapshot) => projectMutationResult(snapshot) ? { notice } : null);
      };
      const renameProject = (project) => {
        if (typeof globalThis.prompt !== 'function') {
          dispatchWorkbench({ type: 'notice', value: '当前窗口无法打开改名框。' });
          return;
        }
        const value = globalThis.prompt('项目名称', project.name);
        if (value === null) return;
        const name = value.trim();
        if (!name || name.length > 40 || CONTROL_RE.test(name)) {
          dispatchWorkbench({ type: 'notice', value: '项目名称需要 1–40 个可见字符。' });
          return;
        }
        updateProject(project, { name }, '项目已改名。');
      };
      const changeProjectIcon = (project) => {
        if (typeof globalThis.prompt !== 'function') {
          dispatchWorkbench({ type: 'notice', value: '当前窗口无法打开图标框。' });
          return;
        }
        const icon = globalThis.prompt('项目图标（一个 emoji）', project.icon);
        if (icon === null) return;
        if (!icon || icon.length > 8 || /[\s\u0000-\u001f\u007f]/.test(icon)) {
          dispatchWorkbench({ type: 'notice', value: '请输入一个简短图标。' });
          return;
        }
        updateProject(project, { icon }, '项目图标已更新。');
      };
      const moveProject = (project, delta) => {
        if (!whaledockProjects?.reorder) {
          dispatchWorkbench({ type: 'notice', value: '项目服务暂时不可用。' });
          return;
        }
        const users = workbench.projects.items.filter((item) => item.kind === 'user');
        const index = users.findIndex((item) => item.projectId === project.projectId);
        const target = index + delta;
        if (index < 0 || target < 0 || target >= users.length) return;
        const reordered = users.slice();
        [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
        const ids = reordered.map((item) => item.projectId);
        void performProjectAction('reorder', project.projectId,
          (signal) => whaledockProjects.reorder({ ids }, signal),
          (snapshot) => snapshot?.state === 'fulfilled'
            && snapshot.result?.kind === 'order'
            ? { notice: '项目顺序已更新。' } : null);
      };
      const openProject = (projectOrId, options = {}) => {
        const projectId = typeof projectOrId === 'string'
          ? projectOrId : projectOrId?.projectId;
        if (projectId === CONTROL_PROJECT_ID) {
          dispatchWorkbench({ type: 'control' });
          refreshProjectWorkbench();
          return;
        }
        if (!APP_PROJECT_ID_RE.test(projectId || '')) {
          dispatchWorkbench({ type: 'notice', value: '这个项目暂时打不开。' });
          return;
        }
        if (projectActionInFlight.current !== null) {
          dispatchWorkbench({ type: 'notice', value: '上一个操作还在进行，请稍等。' });
          return;
        }
        const project = workbench.projects.items.find((item) => item.projectId === projectId);
        const shortcut = options.shortcut === true;
        if (!whaledockProjects?.open) {
          dispatchWorkbench({ type: 'notice', value: '这个项目暂时打不开。' });
          return;
        }
        const detailRequest = ++detailReadAttempt.current;
        dispatchWorkbench({ type: 'detail:start', request: detailRequest,
          projectId, revision: workbench.projects.revision });
        void performProjectAction('open', projectId,
          async (signal) => {
            const opened = await whaledockProjects.open(
              { projectId }, signal, { allowBootstrap: !shortcut }
            );
            if (opened?.state === 'fulfilled' || shortcut
                || typeof projectDetailReader !== 'function') return opened;
            // bootstrap/open 失败后才降级为安全 prepare 详情；
            // 它不 commit、不 ACK/touch，也不替代普通点卡的真实打开链。
            const fallback = await projectDetailReader(projectId, signal);
            const envelope = projectOpenEnvelope(fallback, 'open-prepared');
            return envelope?.project?.projectId === projectId
              ? Object.freeze({ ...opened, fallbackProject: envelope.project }) : opened;
          },
          (snapshot) => {
            const envelope = projectOpenEnvelope(snapshot, 'open-committed');
            const detail = envelope?.project;
            if (detail?.projectId === projectId) {
              return { notice: `已打开「${project?.name || '项目'}」并切到它的对话。`,
                selectedProjectId: projectId, projectDetail: detail,
                projectOpened: typeof projectOpenCurrent === 'function'
                  && projectOpenCurrent(projectId, envelope.bindingRef),
                refresh: true };
            }
            const fallback = snapshot?.fallbackProject;
            return fallback?.projectId === projectId
              ? { notice: actionFailureMessage(snapshot, 'open'),
                selectedProjectId: projectId, projectDetail: fallback,
                projectOpened: false, refresh: false }
              : null;
          }, detailRequest);
      };
      openProjectRef.current = openProject;
      const runTemplateAction = (actionId) => {
        const project = workbench.detail.project;
        if (!project || !project.hasBinding
            || typeof actionId !== 'string'
            || !project.templateActions.some((action) => action.id === actionId)) {
          dispatchWorkbench({ type: 'notice', value:
            project?.hasBinding === false
              ? '请先把项目绑定到右侧当前对话。'
              : '该模板动作已更新，请重试。'
          });
          return;
        }
        if (!whaledockProjects?.open || typeof projectOpenCurrent !== 'function'
            || typeof projectActions?.fillDraft !== 'function') {
          dispatchWorkbench({ type: 'notice', value: '项目动作暂时不可用。' });
          return;
        }
        const projectId = project.projectId;
        const detailRequest = ++detailReadAttempt.current;
        dispatchWorkbench({ type: 'detail:start', request: detailRequest,
          projectId, revision: workbench.projects.revision });
        void performProjectAction('template-action', projectId,
          (signal) => projectTemplateActionDraft({
            projectId,
            actionId,
            signal,
            open: whaledockProjects.open,
            isCurrent: projectOpenCurrent,
            currentSession: projectActions.currentSession,
            fillDraft: projectActions.fillDraft,
            confirm: typeof globalThis.confirm === 'function'
              ? (message) => globalThis.confirm(message) : undefined
          }),
          (result) => {
            const detail = result?.project;
            if (detail?.projectId !== projectId) return null;
            const opened = projectOpenCurrent(projectId, result.bindingRef);
            if (result.ok !== true) {
              return {
                notice: actionFailureMessage(result, 'template-action'),
                selectedProjectId: projectId,
                projectDetail: detail,
                projectOpened: opened,
                refresh: true
              };
            }
            return {
              notice: `已把“${result.action.label}”的最新提示词填入右侧草稿；没有发送。`,
              selectedProjectId: projectId,
              projectDetail: detail,
              projectOpened: opened,
              refresh: true
            };
          }, detailRequest);
      };
      const changeProjectLayout = (preset) => {
        const project = workbench.detail.project;
        if (!project || !PROJECT_PANE_PRESETS.includes(preset)
            || preset === (project.paneState?.preset || project.layoutPreset)
            || !whaledockProjects?.update) return;
        void performProjectAction('layout', project.projectId,
          (signal) => whaledockProjects.update({
            projectId: project.projectId, changes: { layoutPreset: preset }
          }, signal),
          (snapshot) => projectMutationResult(snapshot)
            ? { notice: '布局已更新，已有窗口与锁定产物保留。' } : null);
      };
      const detachProjectWindow = (windowNumber, tabId) => {
        const project = workbench.detail.project;
        if (!project || !whaledockProjects?.detach
            || !Number.isSafeInteger(windowNumber) || windowNumber < 1 || windowNumber > 16
            || typeof tabId !== 'string' || !tabId) return;
        void performProjectAction('detach', project.projectId,
          (signal) => whaledockProjects.detach({
            projectId: project.projectId, window: windowNumber, tabId
          }, signal),
          (snapshot) => snapshot?.state === 'fulfilled'
            && snapshot.result?.kind === 'detached'
            && snapshot.result?.projectId === project.projectId
            ? { notice: `已分离窗口${windowNumber}的当前标签。`, refresh: false }
            : null);
      };
      const alignManagedProject = async () => {
        const project = activeRoutingProject;
        const targetPath = managedTargetPath;
        if (browserOnly || modeRef.current !== 'content' || project === undefined || !targetPath
            || !projectActions) {
          return { ok: false, code: 'workspace-unavailable' };
        }
        const expectedAtStart = alignmentExpected.current;
        if (expectedAtStart !== null && expectedAtStart.path === targetPath) {
          const aligned = await expectedAtStart.promise;
          return aligned ? { ok: true, sessionId: expectedAtStart.sessionId }
            : { ok: false, code: 'session-unavailable' };
        }
        if (alignmentInFlight.current !== null) {
          return { ok: false, code: 'workspace-unavailable' };
        }
        const attempt = ++alignmentAttempt.current;
        const currentAtStart = alignmentCurrent.current;
        const operation = Object.freeze({ attempt });
        let expectedOpening = null;
        alignmentInFlight.current = operation;
        setAlignmentPending(true);
        setAlignmentError('');
        const stillCurrent = () => alignmentAttempt.current === attempt
          && alignmentInFlight.current === operation
          && modeRef.current === 'content'
          && managedTargetPathRef.current === targetPath
          && Object.is(alignmentCurrent.current, currentAtStart);
        try {
          let workspaceId = project.workspaceId;
          if (workspaceId === undefined && ensuredWorkspace.current.path === targetPath) {
            workspaceId = ensuredWorkspace.current.workspaceId;
          }
          if (workspaceId === undefined) {
            const ensured = await projectActions.ensure(targetPath);
            if (!stillCurrent()) return { ok: false, code: 'operation-stale' };
            if (ensured?.ok !== true) {
              setAlignmentError('暂时无法打开这条内容的对话。');
              return { ok: false, code: 'workspace-unavailable' };
            }
            workspaceId = ensured.workspaceId;
            ensuredWorkspace.current = { path: targetPath, workspaceId };
          } else {
            ensuredWorkspace.current = { path: targetPath, workspaceId };
          }
          if (currentContentRoot && currentPath === targetPath) {
            projectActions.observe?.(currentAtStart, targetPath, workspaceId);
            alignmentKnown.current = Object.freeze({
              path: targetPath, sessionId: currentAtStart, observed: true
            });
            return { ok: true, sessionId: currentAtStart };
          }
          let targetId = project.representativeId;
          let targetObserved = targetId !== undefined;
          const known = alignmentKnown.current;
          if (targetId === undefined && known !== null && known.path === targetPath) {
            if (known.observed === false || project.sessionIds.includes(known.sessionId)) {
              targetId = known.sessionId;
              targetObserved = known.observed === true
                || project.sessionIds.includes(known.sessionId);
            } else alignmentKnown.current = null;
          }
          if (targetId === undefined) {
            const connected = await projectActions.connect(workspaceId, targetPath);
            if (!stillCurrent()) return { ok: false, code: 'operation-stale' };
            if (connected?.ok !== true) {
              setAlignmentError('暂时无法打开这条内容的对话。');
              return { ok: false, code: 'workspace-unavailable' };
            }
            targetId = connected.sessionId;
            targetObserved = false;
          }
          alignmentKnown.current = Object.freeze({
            path: targetPath, sessionId: targetId, observed: targetObserved
          });
          let settleExpected;
          let settled = false;
          let settleTimer;
          const settledPromise = new Promise((resolve) => { settleExpected = resolve; });
          expectedOpening = Object.freeze({
            path: targetPath,
            workspaceId,
            sessionId: targetId,
            fromSessionId: currentAtStart,
            promise: settledPromise,
            finish(value) {
              if (settled) return false;
              settled = true;
              if (settleTimer !== undefined) clearTimeout(settleTimer);
              settleExpected(value === true);
              return true;
            }
          });
          alignmentExpected.current = expectedOpening;
          settleTimer = setTimeout(() => {
            if (alignmentExpected.current !== expectedOpening) return;
            alignmentExpected.current = null;
            expectedOpening.finish(false);
            if (modeRef.current === 'content'
                && managedTargetPathRef.current === targetPath) {
              setAlignmentError('暂时无法打开这条内容的对话。');
            }
          }, ALIGNMENT_SETTLE_MS);
          const result = projectActions.open(targetId);
          if (stillCurrent() && result?.ok !== true) {
            setAlignmentError('暂时无法打开这条内容的对话。');
          }
          if (result?.ok !== true && alignmentExpected.current === expectedOpening) {
            alignmentExpected.current = null;
            expectedOpening.finish(false);
          }
          if (result?.ok !== true && alignmentKnown.current?.path === targetPath
              && Object.is(alignmentKnown.current.sessionId, targetId)) {
            alignmentKnown.current = null;
          }
          if (result?.ok !== true) return { ok: false, code: 'session-unavailable' };
          const aligned = await expectedOpening.promise;
          return aligned ? { ok: true, sessionId: targetId }
            : { ok: false, code: 'session-unavailable' };
        } catch (_error) {
          if (alignmentExpected.current === expectedOpening) {
            alignmentExpected.current = null;
            expectedOpening?.finish(false);
          }
          if (expectedOpening !== null && alignmentKnown.current?.path === targetPath
              && Object.is(alignmentKnown.current.sessionId, expectedOpening.sessionId)) {
            alignmentKnown.current = null;
          }
          if (stillCurrent()) setAlignmentError('暂时无法打开这条内容的对话。');
          return { ok: false, code: 'workspace-unavailable' };
        } finally {
          if (alignmentInFlight.current === operation) alignmentInFlight.current = null;
          if (alignmentAttempt.current === attempt) setAlignmentPending(false);
        }
      };
      react.useEffect(() => {
        if (browserOnly || mode !== 'content' || !managedTargetPath || !activeRoutingProject) {
          return undefined;
        }
        const expected = alignmentExpected.current;
        if ((routingMismatch || activeRoutingProject.workspaceId === undefined)
            && (expected === null || expected.path !== managedTargetPath)) {
          void alignManagedProject();
        }
        return () => {
          alignmentAttempt.current += 1;
          alignmentInFlight.current = null;
        };
      }, [browserOnly, mode, managedTargetPath]);
      react.useEffect(() => () => {
        alignmentAttempt.current += 1;
        alignmentInFlight.current = null;
        const expected = alignmentExpected.current;
        alignmentExpected.current = null;
        expected?.finish(false);
        alignmentKnown.current = null;
      }, []);

      const modeSwitch = react_jsx_runtime.jsxs('div', {
        className: browserOnly ? 'wd10-switch' : 'wd10-switch wd11-switch',
        role: 'tablist', 'aria-label': '左侧视图',
        children: browserOnly ? [
          react_jsx_runtime.jsx('button', { type: 'button', role: 'tab',
            'aria-selected': mode === 'sessions', onClick: () => selectMode('sessions'), children: '会话' }),
          react_jsx_runtime.jsx('button', { type: 'button', role: 'tab',
            'aria-selected': mode === 'content', onClick: () => selectMode('content'),
            children: '页内提词' })
        ] : [
          react_jsx_runtime.jsx('button', { type: 'button', role: 'tab',
            'aria-selected': mode === 'projects', onClick: () => selectMode('projects'),
            children: '项目' }),
          react_jsx_runtime.jsx('button', { type: 'button', role: 'tab',
            'aria-selected': mode === 'content', onClick: () => selectMode('content'),
            children: '短视频模板' }),
          react_jsx_runtime.jsx('button', { type: 'button', role: 'tab',
            'aria-selected': mode === 'sessions', onClick: () => selectMode('sessions'), children: '对话' })
        ]
      });
      if (browserOnly && mode === 'content') {
        const left = mount.viewport < 1120 ? 232 : 264;
        const prompt = Math.min(460, Math.max(mount.viewport < 1120 ? 320 : 360,
          Math.round(mount.viewport * 0.33)));
        return react_jsx_runtime.jsxs('div', {
          ref: mount.frameRef,
          className: mount.frameClassName,
          style: { gridTemplateColumns: `${left}px ${prompt}px minmax(0, 1fr)` },
          'data-whaledock-layout': 'v0.10-p1',
          'data-whaledock-mode': 'browser-prompter',
          'data-details-collapsed': mount.columns.details === 0 || undefined,
          children: [
            react_jsx_runtime.jsxs('aside', { className: 'wd10-left', children: [
              modeSwitch,
              react_jsx_runtime.jsx('div', { className: 'wd10-nativeSidebar', children:
                mount.renderSidebar(left)
              })
            ] }),
            react_jsx_runtime.jsx(BrowserOnlyPrompter, {}),
            react_jsx_runtime.jsxs('section', { className: 'wd10-chat',
              'aria-label': '原生对话', children: [
                react_jsx_runtime.jsx('div', { className: 'wd10-chatMain',
                  children: mount.renderConversation(true) }),
                mount.renderDetails({
                  className: 'wd10-contentDetails',
                  style: { width: mount.columns.details, flexBasis: mount.columns.details },
                  'aria-hidden': mount.columns.details === 0
                })
              ]
            }),
            mount.renderOverlay()
          ]
        });
      }
      if (browserOnly) {
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
      // 受管工作台的左栏同时承载项目、模板和原生对话入口；不能沿用上游
      // 56px 图标轨，否则最小窗口下三个主路径不可读。
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
      const contentPanelHidden = mode !== 'content' || panelCollapsed;
      const contentRailHidden = mode !== 'content' || !panelCollapsed;
      const currentSessionAvailable = sessionState.current !== null
        && sessionState.current !== undefined && sessionState.byId?.[sessionState.current] !== undefined;
      return react_jsx_runtime.jsxs('div', {
        ref: mount.frameRef,
        className: mount.frameClassName,
        style: { gridTemplateColumns: mode === 'sessions'
          ? `${left}px minmax(0, 1fr)`
          : mode === 'projects'
            ? `${left}px minmax(420px, 1.15fr) minmax(340px, 1fr)`
            : `${left}px ${panelCollapsed ? 36 : detail}px minmax(0, 1fr)` },
        'data-whaledock-layout': mode === 'projects' ? 'v0.11-projects' : 'v0.10-p1',
        'data-whaledock-mode': mode === 'projects' ? 'project-workbench' : 'content',
        'data-whaledock-left': mode === 'projects'
          ? 'projects' : mode === 'content' ? 'library' : 'sessions',
        'data-whaledock-panel': mode === 'projects'
          ? workbench.surface === 'project' ? 'project-panes' : 'control-room'
          : mode === 'sessions' ? 'hidden' : panelCollapsed ? 'collapsed' : 'expanded',
        'data-details-collapsed': mount.columns.details === 0 || undefined,
        children: [
          react_jsx_runtime.jsxs('aside', { className: 'wd10-left', children: [
            modeSwitch,
            react_jsx_runtime.jsx('p', { style: {
              margin: '0 14px 8px', color: 'var(--dsw-alias-fg-secondary)',
              fontSize: 11, lineHeight: 1.45
            }, children: mode === 'projects'
              ? '选项目会切到它绑定的对话；控制室只汇总真实状态'
              : mode === 'content'
                ? panelCollapsed
                  ? '左边选模板内容，点“返回当前内容”继续推进'
                  : '短视频模板窗口在中间，右边 AI 执行'
                : '左边选原生对话，右边继续和 AI 沟通' }),
            mode !== 'projects' && preferenceError && react_jsx_runtime.jsx('p', {
              className: 'wd10-prefStatus', role: 'status', children: preferenceError
            }),
            mode === 'content' && !hintSeen && react_jsx_runtime.jsxs('div', {
              className: 'wd10-hint', role: 'status', children: [
                react_jsx_runtime.jsx('span', { children:
                  '“对话”会暂时隐藏中间模板区；切回“短视频模板”时会继续当前内容。' }),
                react_jsx_runtime.jsx('button', { type: 'button', onClick: () => {
                  setHintSeen(true);
                  void writePreference({ contentViewHintSeen: true });
                }, children: '知道了' })
              ]
            }),
            react_jsx_runtime.jsx('div', { className: 'wd10-leftView',
              hidden: mode !== 'projects', children:
                react_jsx_runtime.jsx(ProjectDrawer, {
                  state: Object.freeze({ ...workbench, dispatch: dispatchWorkbench }),
                  cards: workbench.console.cards,
                  currentSessionAvailable,
                  onConsole: () => openProject(CONTROL_PROJECT_ID),
                  onProject: openProject,
                  onAdd: addProject,
                  onAdopt: adoptProject,
                  onCreateTemplate: createProjectFromTemplate,
                  onCloseCreate: () => dispatchWorkbench({ type: 'create:close' }),
                  onBind: bindProject,
                  onDismissBind: () => dispatchWorkbench({ type: 'bind-offer', value: null }),
                  onRename: renameProject,
                  onIcon: changeProjectIcon,
                  onHide: (project) => updateProject(project, { hidden: !project.hidden },
                    project.hidden ? '项目已恢复显示。' : '项目已隐藏。'),
                  onMove: moveProject,
                  onSidecar: writeProjectSidecar,
                  onRefresh: refreshProjectWorkbench
                }) }),
            react_jsx_runtime.jsx('div', { className: 'wd10-leftView',
              hidden: mode !== 'content', children:
                react_jsx_runtime.jsx(CreatorSidebar, {
                  workspace: activeProject,
                  catalog: visibleCatalog,
                  selectedToken: selectedContent?.projectToken || null,
                  onSelect: selectContent,
                  onRefresh: refreshCatalog,
                  onLoadMore: () => { void loadMoreCatalog(); }
                }) }),
            react_jsx_runtime.jsx('div', { className: 'wd10-nativeSidebar',
              hidden: mode !== 'sessions', children: mount.renderSidebar(left) })
          ] }),
          mode === 'projects' && (workbench.surface === 'project'
            ? react_jsx_runtime.jsx(ProjectPane, {
              state: workbench,
              currentSessionAvailable,
              onControl: () => {
                dispatchWorkbench({ type: 'control' });
                refreshProjectWorkbench();
              },
              onBind: bindProject,
              onPreset: changeProjectLayout,
              onDetach: detachProjectWindow,
              terminalService: whaledockProjects?.terminal,
              onTemplateAction: runTemplateAction,
              onRetry: () => setDetailRefreshKey((current) => current + 1),
              templateSurface: projectTemplateSurfaceCurrent ? {
                templateId: workbench.detail.project?.templateId || null,
                workspace: activeProject,
                catalog: visibleCatalog,
                selectedContent,
                creatorTab,
                onTab: setCreatorTab,
                workspaceFiles,
                workspaceIdentity: currentCatalogIdentity,
                alignment: mismatch || alignmentPending ? {
                  pending: alignmentPending,
                  error: mismatch
                    ? '项目绑定会话与模板文件夹尚未对齐；请返回控制室后重新打开项目。'
                    : alignmentError,
                  canAlign: false
                } : null,
                onAlign: undefined,
                onSelect: selectContent,
                onRefresh: refreshCatalog,
                onLoadMore: () => { void loadMoreCatalog(); },
                onProjectMutation: applyProjectMutation,
                onPublishCreated: applyPublishCreated
              } : null
            })
            : react_jsx_runtime.jsx(ControlRoom, {
              state: workbench,
              onTheme: (theme) => dispatchWorkbench({ type: 'theme', theme }),
              onProject: openProject,
              onAdd: addProject,
              onRefresh: refreshProjectWorkbench
            })),
          react_jsx_runtime.jsx('div', { className: 'wd10-detailFrame',
            hidden: contentPanelHidden, children: react_jsx_runtime.jsx(CreatorDetail, {
              routingProject: activeProject,
              project: selectedContent,
              tab: creatorTab,
              onTab: setCreatorTab,
              workspaceFiles,
              workspaceIdentity: currentCatalogIdentity,
              alignment: mismatch || alignmentPending ? {
                pending: alignmentPending,
                error: alignmentError
              } : null,
              onAlign: alignManagedProject,
              panelCollapseRef: panelCollapseButton,
              onPanelCollapse: () => setPanelCollapsed(true),
              onCatalogRefresh: refreshCatalog,
              onProjectMutation: applyProjectMutation,
              onPublishCreated: applyPublishCreated
            }) }),
          react_jsx_runtime.jsx('div', { className: 'wd10-detailRail', hidden: contentRailHidden,
            children: react_jsx_runtime.jsx('button', { ref: panelExpandButton, type: 'button',
              onClick: () => setPanelCollapsed(false), children: '返回当前内容' }) }),
          react_jsx_runtime.jsxs('section', { className: 'wd10-chat',
            'aria-label': '原生对话', children: [
              react_jsx_runtime.jsx('div', { className: 'wd10-chatMain',
                children: mount.renderConversation(true) }),
              mount.renderDetails({
                className: 'wd10-contentDetails',
                style: { width: mount.columns.details, flexBasis: mount.columns.details },
                'aria-hidden': mount.columns.details === 0
              })
            ]
          }),
          mount.renderOverlay()
        ]
      });
    }

    function createContentShell(ctx, preferences, workspaceFiles, options = {}) {
      const browserOnly = options.browserOnly === true;
      return Object.freeze({
        contract: SHELL_CONTRACT,
        Component: WhaleDockContentShell,
        preferences: browserOnly ? undefined : preferences,
        workspaceFiles: browserOnly ? undefined : workspaceFiles,
        whaledockProjects: browserOnly ? undefined : options.whaledockProjects,
        projectDetailReader: browserOnly ? undefined : options.projectDetailReader,
        projectOpenCurrent: browserOnly ? undefined : options.projectOpenCurrent,
        projectActions: browserOnly ? null : createProjectActions(ctx, options.alignmentScope),
        browserOnly
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

    function workspaceFileLimits(operation) {
      if (operation === 'console.read') {
        return Object.freeze({ input: MAX_PROJECT_CONSOLE_BYTES, result: MAX_PROJECT_RESULT_BYTES });
      }
      if (operation === 'projects.list') {
        return Object.freeze({ input: MAX_WORKSPACE_FILE_INPUT_BYTES, result: MAX_PROJECT_LIST_BYTES });
      }
      if (PROJECT_OPERATIONS.has(operation)) {
        return Object.freeze({ input: MAX_PROJECT_DETAIL_BYTES, result: MAX_PROJECT_DETAIL_BYTES });
      }
      return Object.freeze({
        input: MAX_WORKSPACE_FILE_INPUT_BYTES,
        result: MAX_WORKSPACE_FILE_RESULT_BYTES
      });
    }

    function safeWorkspaceValue(value, maximumBytes, options = {}) {
      const maxDepth = Number.isSafeInteger(options.maxDepth) ? options.maxDepth : 5;
      const maxArrayItems = Number.isSafeInteger(options.maxArrayItems)
        ? options.maxArrayItems : 64;
      const maxStringBytes = Number.isSafeInteger(options.maxStringBytes)
        ? options.maxStringBytes : 2048;
      const maxInteger = Number.isSafeInteger(options.maxInteger)
        ? options.maxInteger : 1_000_000_000_000;
      const maxKeyChars = Number.isSafeInteger(options.maxKeyChars) ? options.maxKeyChars : 64;
      const canonicalKey = (key) => key.toLowerCase().replace(/[-_]/g, '');
      const visit = (item, depth) => {
        if (depth > maxDepth) return null;
        if (item === null || typeof item === 'boolean') return item;
        if (Number.isSafeInteger(item) && Math.abs(item) <= maxInteger) return item;
        if (typeof item === 'string') {
          return utf8Bytes(item) <= maxStringBytes && !WORKSPACE_TEXT_CONTROL_RE.test(item)
            ? item : null;
        }
        if (Array.isArray(item)) {
          if (item.length > maxArrayItems) return null;
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
          if (typeof key !== 'string' || key.length < 1 || key.length > maxKeyChars
              || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)
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

    function safeWorkspaceOperationValue(operation, value, direction) {
      const limits = workspaceFileLimits(operation);
      const project = PROJECT_OPERATIONS.has(operation);
      return safeWorkspaceValue(value, limits[direction], project ? {
        maxDepth: 12,
        maxArrayItems: MAX_PROJECT_CONSOLE_SESSIONS,
        maxStringBytes: MAX_PROJECT_DETAIL_BYTES,
        maxInteger: Number.MAX_SAFE_INTEGER,
        maxKeyChars: operation === 'console.read' ? 128 : 64
      } : undefined);
    }

    function workspaceFileSnapshot(value, operation) {
      if (!exact(value, ['requestToken', 'state', 'code', 'result'])
          || typeof value.requestToken !== 'string' || !TOKEN_RE.test(value.requestToken)
          || !WORKSPACE_FILE_STATES.has(value.state)) return null;
      if (value.state === 'fulfilled') {
        const result = safeWorkspaceOperationValue(operation, value.result, 'result');
        return value.code === null && result
          ? Object.freeze({ ...value, result }) : null;
      }
      const codeValid = (value.state === 'queued' || value.state === 'running')
        ? value.code === null
        : WORKSPACE_FILE_CODES.has(value.code);
      return codeValid && value.result === null
        ? Object.freeze({ ...value, result: null }) : null;
    }

    function validRawSessionId(value) {
      return typeof value === 'string' && value.length > 0 && value.length <= 256
        && !CONTROL_RE.test(value);
    }

    function consoleBindingPlaceholder(index) {
      return `session-binding-${index.toString(16).padStart(64, '0')}`;
    }

    function estimatedHostConsoleBytes(snapshot) {
      const refs = new Map();
      const ref = (raw) => {
        if (raw === null) return null;
        if (!refs.has(raw)) refs.set(raw, consoleBindingPlaceholder(refs.size + 1));
        return refs.get(raw);
      };
      const byId = {};
      for (const entry of snapshot.byId) {
        const bindingRef = ref(entry.sessionId);
        byId[bindingRef] = {
          id: bindingRef,
          running: entry.running,
          completed: entry.completed,
          pendingInteraction: entry.pendingInteraction,
          parentId: ref(entry.parentId),
          displayTitle: entry.displayTitle,
          updatedAt: entry.updatedAt
        };
      }
      const subagentsByParent = {};
      for (const row of snapshot.subagentsByParent) {
        subagentsByParent[ref(row.parentId)] = row.children.map(ref);
      }
      const jobsBySession = {};
      for (const row of snapshot.jobsBySession) {
        jobsBySession[ref(row.sessionId)] = row.jobs;
      }
      return utf8Bytes(JSON.stringify({ snapshot: {
        byId, subagentsByParent, jobsBySession, current: ref(snapshot.current)
      } }));
    }

    // 只从 rc.2 公开 sessions.list snapshot 摘取控制室所需事实。
    // raw id 仅在 Client→Host 受信 RPC 中使用，Host 会先换成稳定 bindingRef 再入 main。
    function projectConsoleInput(raw) {
      if (!plain(raw) || raw.phase === 'pending' || !plain(raw.byId)) return null;
      const byId = [];
      const admitted = new Set();
      for (const [rawId, value] of Object.entries(raw.byId)) {
        if (byId.length >= MAX_PROJECT_CONSOLE_SESSIONS || !validRawSessionId(rawId)
            || !plain(value)) continue;
        const displayTitle = typeof value.displayTitle === 'string'
          && utf8Bytes(value.displayTitle) <= 512
          && !WORKSPACE_TEXT_CONTROL_RE.test(value.displayTitle)
          ? value.displayTitle : '未命名对话';
        const parentId = validRawSessionId(value.parentId) ? value.parentId : null;
        const pendingInteraction = ['approval', 'plan-review', 'question']
          .includes(value.pendingInteraction) ? value.pendingInteraction : null;
        byId.push({
          sessionId: rawId,
          running: value.running === true,
          completed: value.completed === true,
          pendingInteraction,
          parentId,
          displayTitle,
          updatedAt: Number.isSafeInteger(value.updatedAt) && value.updatedAt >= 0
            ? value.updatedAt : 0
        });
        admitted.add(rawId);
      }
      const subagentsByParent = [];
      if (plain(raw.subagentsByParent)) {
        for (const [parentId, catalog] of Object.entries(raw.subagentsByParent)) {
          if (subagentsByParent.length >= MAX_PROJECT_CONSOLE_SESSIONS
              || !admitted.has(parentId)) continue;
          const source = Array.isArray(catalog) ? catalog
            : (Array.isArray(catalog?.entries) ? catalog.entries : []);
          const children = [];
          for (const child of source) {
            const id = typeof child === 'string' ? child : child?.sessionId;
            if (children.length >= 64) break;
            if (admitted.has(id) && !children.includes(id)) children.push(id);
          }
          if (children.length > 0) subagentsByParent.push({ parentId, children });
        }
      }
      const jobsBySession = [];
      if (plain(raw.jobsBySession)) {
        for (const [sessionId, source] of Object.entries(raw.jobsBySession)) {
          if (jobsBySession.length >= MAX_PROJECT_CONSOLE_SESSIONS
              || !admitted.has(sessionId) || !Array.isArray(source)) continue;
          const jobs = [];
          for (const job of source) {
            if (jobs.length >= 64 || !plain(job) || typeof job.status !== 'string'
                || !job.status || job.status.length > 32 || CONTROL_RE.test(job.status)) continue;
            jobs.push({
              status: job.status,
              startedAt: Number.isSafeInteger(job.startedAt) && job.startedAt >= 0
                ? job.startedAt : null
            });
          }
          if (jobs.length > 0) jobsBySession.push({ sessionId, jobs });
        }
      }
      const snapshot = {
        byId,
        subagentsByParent,
        jobsBySession,
        current: admitted.has(raw.current) ? raw.current : null
      };
      // 稳定 binding key 比常见 raw id 长；同时按原始上行与 Host
      // 转换后尺寸截断。按比例批量裁剪，避免512会话时逐条序列化。
      let clean = null;
      while (clean === null) {
        const hostBytes = estimatedHostConsoleBytes(snapshot);
        const rawBytes = utf8Bytes(JSON.stringify({ snapshot }));
        clean = hostBytes <= MAX_PROJECT_CONSOLE_BYTES
          ? safeWorkspaceOperationValue('console.read', { snapshot }, 'input') : null;
        if (clean !== null || snapshot.byId.length === 0) break;
        const larger = Math.max(hostBytes, rawBytes);
        const keep = Math.max(0, Math.min(
          snapshot.byId.length - 1,
          Math.floor(snapshot.byId.length * (MAX_PROJECT_CONSOLE_BYTES / larger) * 0.9)
        ));
        const removed = snapshot.byId.splice(keep).map((entry) => entry.sessionId);
        for (const rawId of removed) admitted.delete(rawId);
        snapshot.subagentsByParent = snapshot.subagentsByParent
          .filter((row) => admitted.has(row.parentId))
          .map((row) => ({
            parentId: row.parentId,
            children: row.children.filter((id) => admitted.has(id))
          })).filter((row) => row.children.length > 0);
        snapshot.jobsBySession = snapshot.jobsBySession
          .filter((row) => admitted.has(row.sessionId));
        if (removed.includes(snapshot.current)) snapshot.current = null;
      }
      return clean ? clean.snapshot : null;
    }

    function projectSessionCandidates(snapshot) {
      if (!plain(snapshot) || !plain(snapshot.byId)) return [];
      const values = [];
      const add = (id) => {
        if (values.length < MAX_PROJECT_CONSOLE_SESSIONS
            && validRawSessionId(id) && !values.includes(id)) values.push(id);
      };
      for (const id of Object.keys(snapshot.byId)) add(id);
      add(snapshot.current);
      return values;
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

    function provideBrowserOnlyContentShell(ctx) {
      if (!ctx?.reflect || typeof ctx.reflect.provide !== 'function') return;
      let disposeContentShell = () => {};
      let disposeShellStyle = () => {};
      try {
        const shell = createContentShell(ctx, undefined, undefined, { browserOnly: true });
        const dispose = ctx.reflect.provide('whaledockContentShell', shell);
        if (typeof dispose === 'function') disposeContentShell = dispose;
        disposeShellStyle = installShellStyle();
      } catch (_error) {
        try { disposeShellStyle(); } catch (_cleanupError) { /* 保持上游原生三栏 */ }
        try { disposeContentShell(); } catch (_cleanupError) { /* 保持上游原生三栏 */ }
        return;
      }
      ctx.effect?.(() => () => {
        try { disposeShellStyle(); } catch (_error) { /* 原生三栏继续接管 */ }
        try { disposeContentShell(); } catch (_error) { /* 原生三栏继续接管 */ }
      }, 'whaledock-context-bridge: browser-only content shell');
    }

    function apply(ctx) {
      const connection = ctx.get('connection');
      const sessions = ctx.get('sessions');
      if (!sessions) return;

      const rawFragment = globalThis.location?.hash || '';
      const parameters = new URLSearchParams(
        rawFragment.startsWith('#') ? rawFragment.slice(1) : rawFragment
      );
      const controllerId = parameters.get('whaledockController');
      const selectionToken = parameters.get('whaledockSelectionToken');
      const managed = connection?.isLoopback === true
        && typeof controllerId === 'string' && ID_RE.test(controllerId)
        && typeof selectionToken === 'string' && TOKEN_RE.test(selectionToken);
      if (!managed) {
        provideBrowserOnlyContentShell(ctx);
        return;
      }
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
      const workspaceOperationByRequest = new Map();
      let committedProjectOpen = null;
      const abort = new AbortController();
      const projectOpenCurrent = (projectId, expectedBindingRef) => {
        const record = committedProjectOpen;
        if (!record || record.projectId !== projectId
            || (expectedBindingRef !== undefined && expectedBindingRef !== record.bindingRef)) {
          return false;
        }
        let snapshot = null;
        try { snapshot = sessions.list.getSnapshot(); } catch (_error) { snapshot = null; }
        const currentSession = plain(snapshot?.byId) ? snapshot.byId[record.rawSessionId] : null;
        const currentCwd = currentSession?.origin === 'subagent'
          ? '' : normalizeProjectPath(currentSession?.cwd);
        if ((snapshot?.current ?? null) !== record.rawSessionId
            || selectionRevision !== record.selectionRevision
            || !currentCwd || currentCwd !== record.cwd
            || !projectSessionCandidates(snapshot).includes(record.rawSessionId)) {
          committedProjectOpen = null;
          return false;
        }
        return true;
      };
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
          const input = WORKSPACE_FILE_OPERATIONS.has(operation)
            ? safeWorkspaceOperationValue(operation, value, 'input') : null;
          if (!input) {
            return Object.freeze({
              accepted: false, requestToken: null, state: 'rejected',
              code: 'operation-invalid', deadlineMs: null
            });
          }
          const registered = await registerSelection(true);
          const selectionState = registered?.ok === true ? registered.value?.state : null;
          if (selectionState !== 'selected'
              && !(PROJECT_OPERATIONS.has(operation) && selectionState === 'none')) {
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
              while (workspaceOperationByRequest.size >= 128) {
                workspaceOperationByRequest.delete(workspaceOperationByRequest.keys().next().value);
              }
              workspaceOperationByRequest.set(result.requestToken, operation);
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
            const snapshot = reply?.ok === true ? workspaceFileSnapshot(
              reply.value, workspaceOperationByRequest.get(requestToken)
            ) : null;
            if (snapshot && snapshot.state !== 'queued' && snapshot.state !== 'running') {
              workspaceOperationByRequest.delete(requestToken);
            }
            return snapshot;
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
            const snapshot = result && workspaceFileSnapshot(
              result.snapshot, workspaceOperationByRequest.get(requestToken)
            );
            if (!exact(result, ['cancelled', 'code', 'snapshot']) || !snapshot
                || typeof result.cancelled !== 'boolean'
                || !['cancelled', 'already-running', 'already-settled'].includes(result.code)
                || (result.cancelled !== (result.code === 'cancelled'))) return null;
            if (snapshot.state !== 'queued' && snapshot.state !== 'running') {
              workspaceOperationByRequest.delete(requestToken);
            }
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
            if (!snapshot) {
              workspaceOperationByRequest.delete(queued.requestToken);
              return Object.freeze({
                requestToken: queued.requestToken, state: 'rejected',
                code: 'outcome-unknown', result: null
              });
            }
            if (snapshot.state !== 'queued' && snapshot.state !== 'running') return snapshot;
            if (!await workspaceWait(signal)) break;
          }
          const cancelled = await workspaceFiles.cancel(queued.requestToken);
          if (cancelled?.snapshot
              && cancelled.snapshot.state !== 'queued'
              && cancelled.snapshot.state !== 'running') return cancelled.snapshot;
          workspaceOperationByRequest.delete(queued.requestToken);
          return Object.freeze({
            requestToken: queued.requestToken, state: 'rejected',
            code: 'outcome-unknown', result: null
          });
        }
      });
      const projectFailure = (code, requestToken = null) => Object.freeze({
        requestToken,
        state: 'rejected',
        code,
        result: null
      });
      const resolveProjectSession = async (bindingRef, signal) => {
        if (typeof bindingRef !== 'string' || !SESSION_BINDING_REF_RE.test(bindingRef)) return null;
        let candidateSessionIds;
        try { candidateSessionIds = projectSessionCandidates(sessions.list.getSnapshot()); }
        catch (_error) { return null; }
        if (candidateSessionIds.length < 1) return null;
        const registered = await registerSelection(true);
        if (registered?.ok !== true
            || !['none', 'selected'].includes(registered.value?.state)) return null;
        try {
          const reply = await connection.rpc.call(CHANNEL, 'projects/session/resolve', {
            ...preferenceAuth(), bindingRef, candidateSessionIds
          }, signal || abort.signal);
          const result = reply?.ok === true ? reply.value : null;
          if (!exact(result, ['resolved', 'candidateIndex', 'code'])
              || typeof result.resolved !== 'boolean') return null;
          if (!result.resolved) return null;
          if (result.code !== null || !Number.isSafeInteger(result.candidateIndex)
              || result.candidateIndex < 0
              || result.candidateIndex >= candidateSessionIds.length) return null;
          return candidateSessionIds[result.candidateIndex];
        } catch (_error) { return null; }
      };
      const resolveBootstrappedProjectSession = async (bindingRef, signal) => {
        for (let attempt = 0; attempt < 4; attempt += 1) {
          if (abort.signal.aborted || signal?.aborted) return null;
          try {
            if (typeof sessions.refresh === 'function') await sessions.refresh();
          } catch (_error) { /* Host event可能已经把新会话合入镜像，继续 resolve */ }
          const resolved = await resolveProjectSession(bindingRef, signal);
          if (resolved !== null) return resolved;
          if (attempt === 3 || !await workspaceWait(signal)) break;
        }
        return null;
      };
      const preparedProjectOpen = (snapshot, projectId) => {
        const value = snapshot?.state === 'fulfilled' ? snapshot.result : null;
        const envelope = projectOpenEnvelope(snapshot, 'open-prepared');
        if (!envelope || envelope.project.projectId !== projectId
            || typeof value?.openToken !== 'string'
            || !PROJECT_OPEN_TOKEN_RE.test(value.openToken)) return null;
        const hasTicket = Object.prototype.hasOwnProperty.call(value, 'bootstrapTicket');
        if (hasTicket && (value.bindingRef !== null
            || typeof value.bootstrapTicket !== 'string'
            || !PROJECT_BOOTSTRAP_TICKET_RE.test(value.bootstrapTicket)
            || utf8Bytes(value.bootstrapTicket) > MAX_PROJECT_BOOTSTRAP_TICKET_BYTES)) return null;
        return Object.freeze({
          project: envelope.project,
          bindingRef: envelope.bindingRef,
          openToken: value.openToken,
          bootstrapTicket: hasTicket ? value.bootstrapTicket : null
        });
      };
      const bootstrapProjectSession = async (prepared, signal) => {
        if (!prepared || prepared.bindingRef !== null
            || !APP_PROJECT_ID_RE.test(prepared.project?.projectId || '')
            || !PROJECT_OPEN_TOKEN_RE.test(prepared.openToken || '')
            || typeof prepared.bootstrapTicket !== 'string'
            || !PROJECT_BOOTSTRAP_TICKET_RE.test(prepared.bootstrapTicket)
            || utf8Bytes(prepared.bootstrapTicket) > MAX_PROJECT_BOOTSTRAP_TICKET_BYTES) {
          return Object.freeze({ ok: false, bindingRef: null, code: 'workspace-unavailable' });
        }
        const registered = await registerSelection(true);
        if (registered?.ok !== true
            || !['none', 'selected'].includes(registered.value?.state)) {
          return Object.freeze({ ok: false, bindingRef: null, code: 'operation-stale' });
        }
        try {
          const reply = await connection.rpc.call(CHANNEL, 'projects/session/bootstrap', {
            ...preferenceAuth(),
            projectId: prepared.project.projectId,
            openToken: prepared.openToken,
            bootstrapTicket: prepared.bootstrapTicket
          }, signal || abort.signal);
          const value = reply?.ok === true ? reply.value : null;
          if (!exact(value, ['bootstrapped', 'bindingRef', 'code'])
              || typeof value.bootstrapped !== 'boolean') {
            return Object.freeze({ ok: false, bindingRef: null, code: 'outcome-unknown' });
          }
          if (value.bootstrapped === true) {
            if (typeof value.bindingRef !== 'string'
                || !SESSION_BINDING_REF_RE.test(value.bindingRef)
                || value.code !== null) {
              return Object.freeze({ ok: false, bindingRef: null, code: 'outcome-unknown' });
            }
            return Object.freeze({ ok: true, bindingRef: value.bindingRef, code: null });
          }
          if (value.bindingRef !== null || ![
            'workspace-unavailable', 'workspace-mismatch', 'operation-stale',
            'outcome-unknown', 'busy'
          ].includes(value.code)) {
            return Object.freeze({ ok: false, bindingRef: null, code: 'outcome-unknown' });
          }
          return Object.freeze({ ok: false, bindingRef: null, code: value.code });
        } catch (_error) {
          return Object.freeze({ ok: false, bindingRef: null, code: 'outcome-unknown' });
        }
      };
      const invalidProjectCall = () => Promise.resolve(projectFailure('operation-invalid'));
      const terminalCode = (value) => value === null
        || (typeof value === 'string' && PROJECT_TERMINAL_CODE_RE.test(value));
      const terminalIdentity = (value) => plain(value)
        && APP_PROJECT_ID_RE.test(value.projectId || '')
        && typeof value.paneRef === 'string'
        && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.paneRef);
      const terminalCredentials = (value) => terminalIdentity(value)
        && PROJECT_TERMINAL_REF_RE.test(value.terminalRef || '')
        && TOKEN_RE.test(value.capability || '');
      const terminalCall = async (endpoint, payload, signal) => {
        if (!terminalIdentity(payload) || !projectOpenCurrent(payload.projectId)) return null;
        const registered = await registerSelection(true);
        if (registered?.ok !== true || registered.value?.state !== 'selected'
            || !projectOpenCurrent(payload.projectId)) return null;
        try {
          const reply = await connection.rpc.call(CHANNEL, endpoint, {
            ...preferenceAuth(), ...payload
          }, signal || abort.signal);
          return reply?.ok === true && plain(reply.value) ? reply.value : null;
        } catch (_error) { return null; }
      };
      const terminal = Object.freeze({
        async open(value, signal) {
          if (!terminalIdentity(value) || !exact(value, ['projectId', 'paneRef', 'cols', 'rows'])
              || !Number.isSafeInteger(value.cols) || value.cols < 20 || value.cols > 300
              || !Number.isSafeInteger(value.rows) || value.rows < 5 || value.rows > 120) return null;
          const result = await terminalCall('terminal.open', value, signal);
          if (!exact(result, ['opened', 'code', 'terminalRef', 'capability', 'status', 'page'])
              || typeof result.opened !== 'boolean' || !terminalCode(result.code)) return null;
          if (!result.opened) {
            return result.terminalRef === null && result.capability === null
              && result.status === null && result.page === null ? Object.freeze({ ...result }) : null;
          }
          const status = projectTerminalStatus(result.status);
          const page = projectTerminalPage(result.page);
          return result.code === null && PROJECT_TERMINAL_REF_RE.test(result.terminalRef || '')
            && TOKEN_RE.test(result.capability || '') && status && page
            ? Object.freeze({ ...result, status, page }) : null;
        },
        async read(value, signal) {
          if (!terminalCredentials(value)
              || !exact(value, [
                'projectId', 'paneRef', 'terminalRef', 'capability', 'afterSeq', 'maxBytes'
              ]) || !Number.isSafeInteger(value.afterSeq) || value.afterSeq < 0
              || !Number.isSafeInteger(value.maxBytes) || value.maxBytes < 4
              || value.maxBytes > 32 * 1024) return null;
          const result = await terminalCall('terminal.read', value, signal);
          if (!exact(result, ['accepted', 'code', 'status', 'page'])
              || typeof result.accepted !== 'boolean' || !terminalCode(result.code)) return null;
          if (!result.accepted) return result.status === null && result.page === null
            ? Object.freeze({ ...result }) : null;
          const status = projectTerminalStatus(result.status);
          const page = projectTerminalPage(result.page);
          return result.code === null && status && page
            ? Object.freeze({ ...result, status, page }) : null;
        },
        async write(value, signal) {
          if (!terminalCredentials(value)
              || !exact(value, [
                'projectId', 'paneRef', 'terminalRef', 'capability', 'data'
              ]) || typeof value.data !== 'string' || !value.data
              || utf8Bytes(value.data) > 8 * 1024
              || /[\u0000-\u0007\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value.data)) return null;
          const result = await terminalCall('terminal.write', value, signal);
          return exact(result, ['accepted', 'code']) && typeof result.accepted === 'boolean'
            && terminalCode(result.code) ? Object.freeze({ ...result }) : null;
        },
        async signal(value, signal) {
          if (!terminalCredentials(value)
              || !exact(value, [
                'projectId', 'paneRef', 'terminalRef', 'capability', 'signal'
              ]) || value.signal !== 'SIGINT') return null;
          const result = await terminalCall('terminal.signal', value, signal);
          return exact(result, ['delivered', 'code']) && typeof result.delivered === 'boolean'
            && terminalCode(result.code) ? Object.freeze({ ...result }) : null;
        },
        async close(value, signal) {
          if (!terminalCredentials(value)
              || !exact(value, ['projectId', 'paneRef', 'terminalRef', 'capability'])) return null;
          const result = await terminalCall('terminal.close', value, signal);
          return exact(result, ['closed', 'quiescent', 'code'])
            && typeof result.closed === 'boolean' && typeof result.quiescent === 'boolean'
            && terminalCode(result.code) ? Object.freeze({ ...result }) : null;
        }
      });
      const whaledockProjects = Object.freeze({
        terminal,
        list(value = {}, signal) {
          if (!plain(value) || Object.keys(value).some((key) => (
            key !== 'cursor' && key !== 'limit' && key !== 'includeHidden'
          ))) return invalidProjectCall();
          const input = {
            cursor: value.cursor === undefined ? 0 : value.cursor,
            limit: value.limit === undefined ? 32 : value.limit,
            includeHidden: value.includeHidden === undefined ? false : value.includeHidden
          };
          return workspaceFiles.execute('projects.list', input, signal);
        },
        create(value = {}, signal) {
          if (!plain(value) || Object.keys(value).some((key) => (
            key !== 'name' && key !== 'icon' && key !== 'templateId'
          ))) return invalidProjectCall();
          return workspaceFiles.execute('projects.create', value, signal);
        },
        adopt(signal) {
          return workspaceFiles.execute('projects.adopt', {}, signal);
        },
        update(value, signal) {
          if (!exact(value, ['projectId', 'changes']) || !APP_PROJECT_ID_RE.test(value.projectId)
              || !plain(value.changes) || Object.keys(value.changes).length < 1
              || Object.keys(value.changes).some((key) => ![
                'name', 'icon', 'hidden', 'layoutPreset', 'paneState'
              ].includes(key))) return invalidProjectCall();
          return workspaceFiles.execute('projects.update', value, signal);
        },
        remove(value, signal) {
          if (!exact(value, ['projectId']) || !APP_PROJECT_ID_RE.test(value.projectId)) {
            return invalidProjectCall();
          }
          return workspaceFiles.execute('projects.remove', value, signal);
        },
        writeSidecar(value, signal) {
          if (!exact(value, ['projectId']) || !APP_PROJECT_ID_RE.test(value.projectId)) {
            return invalidProjectCall();
          }
          return workspaceFiles.execute('projects.sidecar', value, signal);
        },
        detach(value, signal) {
          if (!exact(value, ['projectId', 'window', 'tabId'])
              || !APP_PROJECT_ID_RE.test(value.projectId)
              || !Number.isSafeInteger(value.window) || value.window < 1 || value.window > 16
              || typeof value.tabId !== 'string' || !value.tabId || value.tabId.length > 128
              || CONTROL_RE.test(value.tabId)) return invalidProjectCall();
          return workspaceFiles.execute('projects.detach', value, signal);
        },
        async bindCurrent(value, signal) {
          if (!exact(value, ['projectId']) || !APP_PROJECT_ID_RE.test(value.projectId)) {
            return invalidProjectCall();
          }
          if (committedProjectOpen?.projectId === value.projectId) committedProjectOpen = null;
          return workspaceFiles.execute('projects.bind', value, signal);
        },
        reorder(value, signal) {
          if (!exact(value, ['ids']) || !Array.isArray(value.ids)
              || value.ids.length < 1 || value.ids.length > 128
              || value.ids.some((id) => !APP_PROJECT_ID_RE.test(id))
              || new Set(value.ids).size !== value.ids.length) return invalidProjectCall();
          return workspaceFiles.execute('projects.reorder', value, signal);
        },
        readConsole(signal) {
          let snapshot;
          try { snapshot = projectConsoleInput(sessions.list.getSnapshot()); }
          catch (_error) { snapshot = null; }
          return snapshot
            ? workspaceFiles.execute('console.read', { snapshot }, signal)
            : Promise.resolve(projectFailure('operation-invalid'));
        },
        async open(value, signal, options = {}) {
          if (!exact(value, ['projectId']) || !APP_PROJECT_ID_RE.test(value.projectId)) {
            return projectFailure('operation-invalid');
          }
          const allowBootstrap = !plain(options) || options.allowBootstrap !== false;
          // 只有本次 prepare → sessions.open → Host-verified commit 全链成功后，
          // 才允许项目窗格消费当前会话的旧21项模板能力。
          committedProjectOpen = null;
          let preparedSnapshot = await workspaceFiles.execute('projects.open', {
            projectId: value.projectId, phase: 'prepare'
          }, signal);
          let prepared = preparedProjectOpen(preparedSnapshot, value.projectId);
          if (!prepared) {
            return preparedSnapshot?.state === 'rejected' ? preparedSnapshot
              : projectFailure('operation-failed', preparedSnapshot?.requestToken || null);
          }
          let rawSessionId = null;
          if (prepared.bindingRef === null) {
            // 菜单快捷命令必须保持既有 fail-closed 语义；只有普通项目卡
            // 点击允许消费 main 铸造的 opaque ticket 自动建会话。
            if (!allowBootstrap) {
              return projectFailure('workspace-unavailable', preparedSnapshot.requestToken);
            }
            const bootstrapped = await bootstrapProjectSession(prepared, signal);
            if (bootstrapped.ok !== true) {
              return projectFailure(bootstrapped.code, preparedSnapshot.requestToken);
            }
            rawSessionId = await resolveBootstrappedProjectSession(
              bootstrapped.bindingRef, signal
            );
            if (rawSessionId === null || abort.signal.aborted || signal?.aborted) {
              return projectFailure('workspace-unavailable', preparedSnapshot.requestToken);
            }
            try { await sessions.open(rawSessionId); }
            catch (_error) {
              return projectFailure('workspace-unavailable', preparedSnapshot.requestToken);
            }
            let bootstrapRegistered = null;
            for (let attempt = 0; attempt < 4; attempt += 1) {
              bootstrapRegistered = await registerSelection(true, rawSessionId);
              if (bootstrapRegistered?.ok === true
                  && bootstrapRegistered.value?.state === 'selected') break;
              if (attempt === 3 || !await workspaceWait(signal)) break;
            }
            if (bootstrapRegistered?.ok !== true
                || bootstrapRegistered.value?.state !== 'selected') {
              return projectFailure('workspace-unavailable', preparedSnapshot.requestToken);
            }
            const bound = await workspaceFiles.execute('projects.bind', {
              projectId: value.projectId,
              openToken: prepared.openToken
            }, signal);
            const binding = bound?.state === 'fulfilled' ? bound.result : null;
            if (!exact(binding, ['kind', 'revision', 'projectId', 'bindingRef'])
                || binding.kind !== 'binding' || binding.projectId !== value.projectId
                || binding.bindingRef !== bootstrapped.bindingRef) {
              return bound?.state === 'rejected' ? bound
                : projectFailure('operation-failed', bound?.requestToken || null);
            }
            // bind 成功只表示正确会话已安全登记；必须重新 prepare，旧 token
            // 绑定的是 null，永远不能拿来 commit/touch/ACK。
            preparedSnapshot = await workspaceFiles.execute('projects.open', {
              projectId: value.projectId, phase: 'prepare'
            }, signal);
            prepared = preparedProjectOpen(preparedSnapshot, value.projectId);
            if (!prepared || prepared.bindingRef !== bootstrapped.bindingRef
                || prepared.bootstrapTicket !== null) {
              return preparedSnapshot?.state === 'rejected' ? preparedSnapshot
                : projectFailure('operation-stale', preparedSnapshot?.requestToken || null);
            }
          } else {
            rawSessionId = await resolveProjectSession(prepared.bindingRef, signal);
          }
          if (rawSessionId === null || abort.signal.aborted || signal?.aborted) {
            return projectFailure('workspace-unavailable', preparedSnapshot.requestToken);
          }
          try { await sessions.open(rawSessionId); }
          catch (_error) {
            return projectFailure('workspace-unavailable', preparedSnapshot.requestToken);
          }
          let registered = null;
          for (let attempt = 0; attempt < 4; attempt += 1) {
            registered = await registerSelection(true, rawSessionId);
            if (registered?.ok === true && registered.value?.state === 'selected') break;
            if (attempt === 3 || !await workspaceWait(signal)) break;
          }
          if (registered?.ok !== true || registered.value?.state !== 'selected') {
            return projectFailure('workspace-unavailable', preparedSnapshot.requestToken);
          }
          let preCommitSnapshot = null;
          try { preCommitSnapshot = sessions.list.getSnapshot(); }
          catch (_error) { preCommitSnapshot = null; }
          const preCommitSession = plain(preCommitSnapshot?.byId)
            ? preCommitSnapshot.byId[rawSessionId] : null;
          const preCommitCwd = preCommitSession?.origin === 'subagent'
            ? '' : normalizeProjectPath(preCommitSession?.cwd);
          if (preCommitSnapshot?.current !== rawSessionId || !preCommitCwd) {
            return projectFailure('workspace-unavailable', preparedSnapshot.requestToken);
          }
          const preCommitSelectionRevision = selectionRevision;
          const committed = await workspaceFiles.execute('projects.open', {
            projectId: value.projectId,
            phase: 'commit',
            openToken: prepared.openToken,
            bindingRef: prepared.bindingRef
          }, signal);
          const opened = committed?.state === 'fulfilled' ? committed.result : null;
          let postCommitSnapshot = null;
          try { postCommitSnapshot = sessions.list.getSnapshot(); }
          catch (_error) { postCommitSnapshot = null; }
          const postCommitSession = plain(postCommitSnapshot?.byId)
            ? postCommitSnapshot.byId[rawSessionId] : null;
          const postCommitCwd = postCommitSession?.origin === 'subagent'
            ? '' : normalizeProjectPath(postCommitSession?.cwd);
          if (exact(opened, ['kind', 'project', 'bindingRef'])
              && opened.kind === 'open-committed' && plain(opened.project)
              && opened.project.projectId === value.projectId
              && opened.bindingRef === prepared.bindingRef
              && postCommitSnapshot?.current === rawSessionId
              && postCommitCwd === preCommitCwd
              && selectionRevision === preCommitSelectionRevision) {
            committedProjectOpen = Object.freeze({
              projectId: value.projectId,
              bindingRef: prepared.bindingRef,
              rawSessionId,
              selectionRevision: preCommitSelectionRevision,
              cwd: preCommitCwd
            });
          }
          return committed;
        }
      });
      const projectDetailReader = (projectId, signal) => {
        if (!APP_PROJECT_ID_RE.test(projectId || '')) return invalidProjectCall();
        return workspaceFiles.execute('projects.open', {
          projectId, phase: 'prepare'
        }, signal);
      };
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
      const unsubscribeSessions = sessions.list.subscribe(() => {
        if (committedProjectOpen) projectOpenCurrent(committedProjectOpen.projectId);
        publish();
      });
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
      let disposeProjects = () => {};
      try {
        const dispose = ctx.reflect.provide('whaledockProjects', whaledockProjects);
        if (typeof dispose === 'function') disposeProjects = dispose;
      } catch (_error) { /* 项目服务失败不能破坏 context gate */ }
      let disposeContentShell = () => {};
      let disposeShellStyle = () => {};
      try {
        const shell = createContentShell(ctx, preferences, workspaceFiles, {
          alignmentScope: controllerId,
          whaledockProjects,
          projectDetailReader,
          projectOpenCurrent
        });
        const dispose = ctx.reflect.provide('whaledockContentShell', shell);
        if (typeof dispose === 'function') disposeContentShell = dispose;
        disposeShellStyle = installShellStyle();
      } catch (_error) { /* 内容挂载失败时 layout 保持官方三栏，context gate 继续生效 */ }
      ctx.effect(() => () => {
        try { disposeShellStyle(); } catch (_error) { /* 样式清理失败不阻断协议释放 */ }
        try { disposeContentShell(); } catch (_error) { /* 官方三栏仍可接管回退 */ }
        try { disposeProjects(); } catch (_error) { /* context gate 仍继续释放 */ }
        try { disposeWorkspaceFiles(); } catch (_error) { /* context gate 仍继续释放 */ }
        try { disposePreferences(); } catch (_error) { /* context gate 仍继续释放 */ }
        disposeGate();
        unsubscribeSessions();
        unsubscribeHost();
        preferenceListeners.clear();
        workspaceOperationByRequest.clear();
        stopPreferenceBootstrapRetry();
        globalThis.clearInterval(heartbeat);
        abort.abort();
      }, 'whaledock-context-bridge: current-session reporter');
    }

    exports.createContentShell = createContentShell;
    exports.projectWorkbenchStateMachine = projectWorkbenchStateMachine;
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
