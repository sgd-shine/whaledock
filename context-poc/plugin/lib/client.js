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
      'catalog.read', 'overview.read', 'document.read', 'topic.choose',
      'project.action.prepare', 'project.action.submit',
      'block.action.prepare', 'block.action.submit',
      'proposal.read', 'proposal.decide', 'proposal.undo',
      'publish.read', 'publish.create', 'publish.update',
      'review.tactics.read', 'review.solidify',
      'shoot.open', 'shoot.history.read',
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
    const inject = ['connection', 'sessions'];

    const SHELL_CSS = `.wd10-left{background:var(--dsw-specific-sidebar-fill);border-right:1px solid var(--dsw-alias-border-l1);min-width:0;height:100%;display:flex;flex-direction:column;overflow:hidden}.wd10-switch{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:12px;padding:4px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}.wd10-switch button{border:0;border-radius:7px;padding:7px 10px;color:var(--dsw-alias-fg-secondary);background:transparent;font:inherit;font-size:13px;cursor:pointer}.wd10-switch button[aria-selected=true]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-primary);box-shadow:0 1px 3px rgba(0,0,0,.08)}.wd10-library{min-height:0;overflow:auto;padding:0 10px 18px}.wd10-libraryHead{padding:8px 6px 10px}.wd10-eyebrow{font-size:11px;letter-spacing:.08em;color:var(--dsw-alias-fg-tertiary);text-transform:uppercase}.wd10-libraryHead h2{font-size:17px;line-height:1.35;margin:4px 0;color:var(--dsw-alias-fg-primary)}.wd10-libraryHead p{font-size:12px;line-height:1.5;margin:0;color:var(--dsw-alias-fg-secondary)}.wd10-refresh,.wd10-loadMore{margin-top:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:5px 8px;background:transparent;color:var(--dsw-alias-fg-secondary);font:inherit;font-size:11px;cursor:pointer}.wd10-refresh:disabled,.wd10-loadMore:disabled{opacity:.55;cursor:default}.wd10-loadMore{width:100%;padding:8px}.wd10-workspaceList{margin:0 0 10px;padding:8px 6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}.wd10-workspaceChoice{width:100%;text-align:left;border:1px solid transparent;border-radius:8px;padding:7px 8px;margin-top:4px;background:transparent;color:inherit;cursor:pointer}.wd10-workspaceChoice:hover,.wd10-workspaceChoice[aria-current=true]{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l1)}.wd10-projectPath{display:block;margin-top:3px;font-size:10px;color:var(--dsw-alias-fg-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wd10-project{width:100%;text-align:left;border:1px solid transparent;border-radius:10px;padding:10px;margin:2px 0 6px;background:transparent;color:inherit;cursor:pointer}.wd10-project:hover{background:var(--dsw-alias-bg-layer-1)}.wd10-project[aria-current=true]{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l2)}.wd10-projectTitle{display:block;font-size:13px;font-weight:600;color:var(--dsw-alias-fg-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wd10-projectMeta{display:flex;align-items:center;gap:7px;margin-top:5px;font-size:11px;color:var(--dsw-alias-fg-tertiary)}.wd10-stageBadge{border-radius:999px;padding:1px 7px;background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary)}.wd10-detailFrame{min-width:0;height:100%;overflow:hidden}.wd10-detailFrame[hidden],.wd10-detailRail[hidden]{display:none}.wd10-detailRail{min-width:0;height:100%;display:flex;background:var(--dsw-alias-bg-layer-1);border-right:1px solid var(--dsw-alias-border-l2);overflow:hidden}.wd10-detailRail button{width:36px;height:100%;border:0;padding:12px 0;background:transparent;color:var(--dsw-alias-fg-secondary);font:inherit;font-size:11px;letter-spacing:.12em;writing-mode:vertical-rl;text-orientation:upright;cursor:pointer}.wd10-detailRail button:hover{color:var(--dsw-alias-fg-primary);background:var(--dsw-alias-bg-base)}.wd10-detail{min-width:0;height:100%;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);border-right:1px solid var(--dsw-alias-border-l2);overflow:hidden}.wd10-detailHead{position:relative;padding:22px 118px 12px 24px}.wd10-collapseButton{position:absolute;top:18px;right:18px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-secondary);font:inherit;font-size:11px;cursor:pointer}.wd10-collapseButton:hover{color:var(--dsw-alias-fg-primary);border-color:var(--dsw-alias-fg-tertiary)}.wd10-detailHead h1{font-size:22px;line-height:1.25;margin:5px 0 7px;color:var(--dsw-alias-fg-primary)}.wd10-detailHead p{font-size:12px;line-height:1.5;margin:0;color:var(--dsw-alias-fg-secondary)}.wd10-projectActions{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}.wd10-projectActions button,.wd10-receipt button,.wd10-choice,.wd10-nextAction{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-primary);font:inherit;font-size:11px;cursor:pointer}.wd10-projectActions button:disabled,.wd10-receipt button:disabled,.wd10-choice:disabled,.wd10-nextAction:disabled{opacity:.55;cursor:default}.wd10-tabs{display:flex;gap:3px;padding:0 20px;border-bottom:1px solid var(--dsw-alias-border-l1);overflow:auto}.wd10-tabs button{border:0;border-bottom:2px solid transparent;padding:10px 8px 9px;background:transparent;color:var(--dsw-alias-fg-secondary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}.wd10-tabs button[aria-selected=true]{border-bottom-color:var(--dsw-alias-fg-primary);color:var(--dsw-alias-fg-primary)}.wd10-receipts{flex:none;max-height:188px;overflow:auto;padding:10px 18px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}.wd10-receiptTitle{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--dsw-alias-fg-secondary)}.wd10-receipt{margin-top:7px;padding:8px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);font-size:11px;color:var(--dsw-alias-fg-secondary)}.wd10-receiptHead,.wd10-receiptFoot{display:flex;align-items:center;justify-content:space-between;gap:8px}.wd10-receipt strong{color:var(--dsw-alias-fg-primary)}.wd10-receipt p{margin:5px 0 0;line-height:1.45}.wd10-preflight{border-color:var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-state-warn-tertiary)}.wd10-pulse{color:var(--dsw-alias-state-business-primary);font-weight:600}.wd10-panel{min-height:0;overflow:auto;padding:20px 24px 28px}.wd10-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px;background:var(--dsw-alias-bg-layer-1);margin-bottom:12px}.wd10-card h3{font-size:14px;margin:0 0 7px;color:var(--dsw-alias-fg-primary)}.wd10-card p{font-size:12px;line-height:1.65;margin:0;color:var(--dsw-alias-fg-secondary)}.wd10-overviewMeta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}.wd10-overviewMeta div{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:9px;background:var(--dsw-alias-bg-base)}.wd10-overviewMeta span,.wd10-currentChoice span{display:block;font-size:10px;color:var(--dsw-alias-fg-tertiary);margin-bottom:3px}.wd10-overviewMeta strong,.wd10-currentChoice strong{font-size:12px;color:var(--dsw-alias-fg-primary)}.wd10-currentChoices{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}.wd10-currentChoice{border-left:3px solid var(--dsw-alias-state-business-primary);padding:7px 9px;background:var(--dsw-alias-bg-base);border-radius:0 8px 8px 0}.wd10-choiceGroup{margin-top:14px}.wd10-choiceGroup h4{font-size:11px;margin:0 0 7px;color:var(--dsw-alias-fg-secondary)}.wd10-choiceList{display:flex;flex-wrap:wrap;gap:6px}.wd10-choice[aria-pressed=true]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-tertiary);font-weight:600}.wd10-incomplete{color:var(--dsw-alias-state-warn-primary)!important;margin-top:10px!important}.wd10-next{margin-top:16px;padding-top:14px;border-top:1px solid var(--dsw-alias-border-l1)}.wd10-nextAction{margin-top:8px;border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-bg-base);font-weight:600}.wd10-unfinished strong{display:block;margin:8px 0;color:var(--dsw-alias-fg-primary)}.wd10-feedback{font-size:12px;line-height:1.5;margin:8px 0 0;color:var(--dsw-alias-fg-secondary)}.wd10-chat{min-width:0;height:100%;display:flex;overflow:hidden}.wd10-chatMain{min-width:0;flex:1;display:flex;flex-direction:column;overflow:hidden}.wd10-empty{padding:24px;color:var(--dsw-alias-fg-secondary);font-size:13px;line-height:1.6}@media(max-width:1120px){.wd10-detailHead{padding:18px 112px 10px 18px}.wd10-collapseButton{top:14px;right:14px}.wd10-panel{padding:16px 18px}.wd10-detailHead h1{font-size:19px}.wd10-tabs{padding:0 14px}.wd10-receipts{padding:9px 14px}.wd10-overviewMeta,.wd10-currentChoices{grid-template-columns:1fr}}.wd10-leftViews,.wd10-leftView,.wd10-nativeSidebar{min-height:0;flex:1;overflow:hidden}.wd10-leftView[hidden],.wd10-nativeSidebar[hidden]{display:none}.wd10-banner,.wd10-hint{display:flex;align-items:center;gap:8px;margin:10px 18px 0;padding:9px 10px;border:1px solid var(--dsw-alias-state-warn-primary);border-radius:9px;color:var(--dsw-alias-fg-primary);background:var(--dsw-alias-state-warn-tertiary);font-size:12px;line-height:1.45}.wd10-banner span,.wd10-hint span{min-width:0;flex:1}.wd10-banner button,.wd10-hint button{flex:none;border:1px solid currentColor;border-radius:7px;padding:4px 8px;background:transparent;color:inherit;cursor:pointer}.wd10-banner button:disabled{opacity:.55;cursor:default}.wd10-prefStatus{margin:0 14px 8px;color:var(--dsw-alias-state-warn-primary);font-size:11px}.wd10-contentDetails{transition:width var(--ds-transition-duration-slow) var(--ds-ease-in-out);flex-shrink:0}`;
    const SCRIPT_CSS = `.wd10-script{display:flex;flex-direction:column;gap:10px}.wd10-scriptHead,.wd10-blockMeta{display:flex;align-items:center;justify-content:space-between;gap:8px}.wd10-scriptHead h3{margin:0;color:var(--dsw-alias-fg-primary);font-size:14px}.wd10-scriptHead span,.wd10-blockMeta span{font-size:10px;color:var(--dsw-alias-fg-tertiary)}.wd10-block{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:13px;background:var(--dsw-alias-bg-layer-1)}.wd10-blockMeta strong{font-size:11px;color:var(--dsw-alias-fg-secondary)}.wd10-block pre,.wd10-compare pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:9px 0 0;font:inherit;font-size:12px;line-height:1.6;color:var(--dsw-alias-fg-primary)}.wd10-blockActions,.wd10-proposalActions{display:flex;flex-wrap:wrap;gap:6px;margin-top:11px}.wd10-blockActions button,.wd10-proposalActions button,.wd10-undo{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-primary);font:inherit;font-size:11px;cursor:pointer}.wd10-blockActions button:disabled,.wd10-proposalActions button:disabled,.wd10-undo:disabled{opacity:.5;cursor:default}.wd10-proposal{border-color:var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-state-warn-tertiary)}.wd10-compare{margin-top:10px;border-radius:9px;padding:10px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1)}.wd10-compare h4{margin:0;font-size:11px;color:var(--dsw-alias-fg-secondary)}.wd10-proposalActions button:first-child,.wd10-undo{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);font-weight:600}.wd10-undo{margin-top:11px}`;
    const PUBLISH_CSS = `.wd10-publish{display:flex;flex-direction:column;gap:12px}.wd10-publishHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.wd10-publishHead h3{margin:0 0 5px;font-size:14px;color:var(--dsw-alias-fg-primary)}.wd10-publishState{flex:none;border-radius:999px;padding:3px 8px;font-size:10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-secondary);border:1px solid var(--dsw-alias-border-l1)}.wd10-publishState[data-ready=true]{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}.wd10-publishLights{display:grid;gap:7px;margin-top:12px}.wd10-publishLight{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:9px 10px;background:var(--dsw-alias-bg-base)}.wd10-publishLight span{font-size:12px;color:var(--dsw-alias-fg-primary)}.wd10-publishLight input{margin:0}.wd10-publishLight[data-satisfied=true]{border-color:var(--dsw-alias-state-business-primary)}.wd10-aiChoices{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}.wd10-aiChoices button,.wd10-createPublish{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-primary);font:inherit;font-size:11px;cursor:pointer}.wd10-aiChoices button[aria-pressed=true]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-tertiary);font-weight:600}.wd10-aiChoices button:disabled,.wd10-createPublish:disabled{opacity:.5;cursor:default}.wd10-createPublish{margin-top:12px;border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);font-weight:600}.wd10-publishInvalid{border-color:var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-state-warn-tertiary)}.wd10-publishNotice{border-left:3px solid var(--dsw-alias-state-warn-primary);padding:8px 10px;border-radius:0 8px 8px 0;background:var(--dsw-alias-state-warn-tertiary)}`;
    const REVIEW_CSS = `.wd10-review{display:flex;flex-direction:column;gap:12px}.wd10-reviewHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.wd10-reviewHead h3{margin:0 0 5px;font-size:14px;color:var(--dsw-alias-fg-primary)}.wd10-reviewBlocks,.wd10-tacticWall{display:grid;gap:9px;margin-top:11px}.wd10-reviewBlock,.wd10-tactic{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:11px;background:var(--dsw-alias-bg-base)}.wd10-reviewBlock pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:7px 0 0;font:inherit;font-size:12px;line-height:1.6;color:var(--dsw-alias-fg-primary)}.wd10-reviewMeta,.wd10-tacticMeta{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10px;color:var(--dsw-alias-fg-tertiary)}.wd10-tactic[data-highlight=true]{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 1px var(--dsw-alias-state-business-primary)}.wd10-tactic h4{margin:7px 0 5px;font-size:13px;color:var(--dsw-alias-fg-primary)}.wd10-tacticBadge{border-radius:999px;padding:2px 7px;color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-tertiary)}.wd10-solidify{border:1px solid var(--dsw-alias-state-business-primary);border-radius:8px;padding:7px 10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-state-business-primary);font:inherit;font-size:11px;font-weight:600;cursor:pointer}.wd10-solidify:disabled{opacity:.5;cursor:default}.wd10-reviewTruth{border-left:3px solid var(--dsw-alias-state-warn-primary);padding:8px 10px;border-radius:0 8px 8px 0;background:var(--dsw-alias-state-warn-tertiary)}`;
    const SHOOT_CSS = `.wd10-shoot{display:flex;flex-direction:column;gap:12px}.wd10-shootHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.wd10-shootHead h3,.wd10-shootRecord h4{margin:0 0 5px;color:var(--dsw-alias-fg-primary)}.wd10-shootHead h3{font-size:14px}.wd10-shootRecord h4{font-size:13px}.wd10-shootActions,.wd10-prompterControls,.wd10-prompterChoices{display:flex;flex-wrap:wrap;gap:7px;margin-top:11px}.wd10-shootActions button,.wd10-prompterControls button,.wd10-prompterChoices button{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-primary);font:inherit;font-size:11px;cursor:pointer}.wd10-shootActions button:first-child{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);font-weight:600}.wd10-shootActions button:disabled,.wd10-prompterControls button:disabled,.wd10-prompterChoices button:disabled{opacity:.5;cursor:default}.wd10-prompterChoices button[aria-pressed=true]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-tertiary)}.wd10-prompter{height:300px;overflow:auto;scroll-behavior:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:110px 18px;background:#111;color:#f7f7f7;margin-top:12px}.wd10-prompter pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font:inherit;line-height:1.75}.wd10-prompter[data-font=medium] pre{font-size:26px}.wd10-prompter[data-font=large] pre{font-size:36px}.wd10-shootTruth{border-left:3px solid var(--dsw-alias-state-warn-primary);padding:8px 10px;border-radius:0 8px 8px 0;background:var(--dsw-alias-state-warn-tertiary)}.wd10-shootRecords{display:grid;gap:9px;margin-top:11px}.wd10-shootRecord{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:11px;background:var(--dsw-alias-bg-base)}.wd10-shootRecord[data-confirmed=true]{border-color:var(--dsw-alias-state-business-primary)}`;
    const BROWSER_PROMPTER_CSS = `.wd10-browserPrompt{min-width:0;height:100%;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);border-right:1px solid var(--dsw-alias-border-l2);overflow:hidden}.wd10-browserPrompt textarea{box-sizing:border-box;width:100%;min-height:150px;resize:vertical;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-primary);font:inherit;font-size:12px;line-height:1.55}.wd10-browserPromptMeta{display:flex;justify-content:space-between;gap:8px;margin-top:6px;font-size:10px;color:var(--dsw-alias-fg-tertiary)}`;
    const NARROW_SIDEBAR_CSS = `@media(max-width:1023px){[data-whaledock-left="sessions"] .wd10-switch{grid-template-columns:1fr;margin:8px 4px;padding:2px;gap:2px}[data-whaledock-left="sessions"] .wd10-switch button{padding:5px 2px;font-size:11px;white-space:nowrap}}`;

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
      tag.textContent = `${SHELL_CSS}${NARROW_SIDEBAR_CSS}${SCRIPT_CSS}${PUBLISH_CSS}${REVIEW_CSS}${SHOOT_CSS}${BROWSER_PROMPTER_CSS}`;
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
      onProjectMutation, onPublishCreated }) {
      const [preflight, setPreflight] = react.useState(null);
      const [feedback, setFeedback] = react.useState('');
      const [pending, setPending] = react.useState(false);
      const [receiptRefresh, setReceiptRefresh] = react.useState(0);
      const [proposalRefresh, setProposalRefresh] = react.useState(0);
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
      const runPreparedAction = async (spec) => {
        if (!project || pendingRef.current) return;
        pendingRef.current = true;
        setPending(true);
        setPreflight(null);
        setFeedback('正在确认投递去向…');
        const controller = new AbortController();
        actionAbort.current = controller;
        const attempt = ++actionAttempt.current;
        try {
          const snapshot = await workspaceFiles.execute(
            spec.prepareOperation, spec.prepareInput, controller.signal
          );
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
            ? `已提交到 ${boundedUiText(value.target, '目标会话', 96)}；任务回执会继续更新。`
            : value.state === 'rejected'
              ? `目标拒绝投递（${boundedUiText(value.reason, '原因未说明', 64)}）；没有重复发送。`
              : value.state === 'error' ? '提交失败；没有重复发送。'
                : '提交结果未知；请核对任务回执，不要重复点击。'));
          setReceiptRefresh((current) => current + 1);
          if (frozen.scope === 'block' && value.state === 'accepted') {
            setProposalRefresh((current) => current + 1);
          } else if (frozen.scope === 'project') onCatalogRefresh?.();
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
          react_jsx_runtime.jsx('button', { ref: panelCollapseRef, type: 'button',
            className: 'wd10-collapseButton', onClick: onPanelCollapse, children: '收起工作台' }),
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
          onConfirm: () => { void confirmPreflight(); }, onCancel: cancelPreflight,
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

    function WhaleDockContentShell({ useSessions, useWorkspaces, mount, integration }) {
      const sessionState = useSessions((state) => state);
      const workspaceState = useWorkspaces((state) => state);
      const projects = react.useMemo(
        () => creatorProjects(sessionState, workspaceState), [sessionState, workspaceState]
      );
      const { preferences, projectActions, workspaceFiles, browserOnly } = integration;
      const [mode, setMode] = react.useState(() => {
        if (browserOnly) return 'sessions';
        try {
          const initial = preferences?.getSnapshot?.();
          return initial?.contentViewMode === 'sessions' ? 'sessions' : 'content';
        } catch (_error) { return 'content'; }
      });
      const [hintSeen, setHintSeen] = react.useState(false);
      const [preferenceError, setPreferenceError] = react.useState('');
      const [panelCollapsed, setPanelCollapsed] = react.useState(false);
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
      const catalogReadbackTarget = react.useRef(null);
      const panelCollapseButton = react.useRef(null);
      const panelExpandButton = react.useRef(null);
      const panelFocusReady = react.useRef(false);
      const alignmentCurrent = react.useRef(sessionState.current);
      const currentProject = sessionState.current === undefined ? undefined
        : projects.find((project) => project.sessionIds.includes(sessionState.current));
      const currentProjectKey = currentProject?.key || null;
      const activeRoutingProject = projects.find((project) => project.key === activeProjectKey)
        || projects[0];
      const routingMismatch = activeRoutingProject !== undefined
        && activeRoutingProject.key !== currentProjectKey;
      const currentCatalogIdentity = !browserOnly && !routingMismatch && activeRoutingProject
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
        if (!panelFocusReady.current) {
          panelFocusReady.current = true;
          return;
        }
        (panelCollapsed ? panelExpandButton : panelCollapseButton).current?.focus();
      }, [panelCollapsed]);
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
          catalogReadbackTarget.current = null;
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
        if (!browserOnly) void writePreference({ contentViewMode: next });
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
        className: 'wd10-switch', role: 'tablist', 'aria-label': '左侧视图',
        children: browserOnly ? [
          react_jsx_runtime.jsx('button', { type: 'button', role: 'tab',
            'aria-selected': mode === 'sessions', onClick: () => selectMode('sessions'), children: '会话' }),
          react_jsx_runtime.jsx('button', { type: 'button', role: 'tab',
            'aria-selected': mode === 'content', onClick: () => selectMode('content'),
            children: '页内提词' })
        ] : [
          react_jsx_runtime.jsx('button', { type: 'button', role: 'tab',
            'aria-selected': mode === 'content', onClick: () => selectMode('content'),
            children: '内容库' }),
          react_jsx_runtime.jsx('button', { type: 'button', role: 'tab',
            'aria-selected': mode === 'sessions', onClick: () => selectMode('sessions'), children: '会话' })
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
      const left = mode === 'sessions' && mount.sidebarCollapsed
        ? 56 : mount.viewport < 1120 ? 232 : 272;
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
      return react_jsx_runtime.jsxs('div', {
        ref: mount.frameRef,
        className: mount.frameClassName,
        style: { gridTemplateColumns:
          `${left}px ${panelCollapsed ? 36 : detail}px minmax(0, 1fr)` },
        'data-whaledock-layout': 'v0.10-p1',
        'data-whaledock-mode': 'content',
        'data-whaledock-left': mode === 'content' ? 'library' : 'sessions',
        'data-whaledock-panel': panelCollapsed ? 'collapsed' : 'expanded',
        'data-details-collapsed': mount.columns.details === 0 || undefined,
        children: [
          react_jsx_runtime.jsxs('aside', { className: 'wd10-left', children: [
            modeSwitch,
            preferenceError && react_jsx_runtime.jsx('p', {
              className: 'wd10-prefStatus', role: 'status', children: preferenceError
            }),
            mode === 'content' && !hintSeen && react_jsx_runtime.jsxs('div', {
              className: 'wd10-hint', role: 'status', children: [
                react_jsx_runtime.jsx('span', { children:
                  '左边「会话」是原生会话' + '与设置；「收起工作台」能让对话占满。' }),
                react_jsx_runtime.jsx('button', { type: 'button', onClick: () => {
                  setHintSeen(true);
                  void writePreference({ contentViewHintSeen: true });
                }, children: '知道了' })
              ]
            }),
            react_jsx_runtime.jsx('div', { className: 'wd10-leftView',
              hidden: mode !== 'content', children:
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
              hidden: mode !== 'sessions', children: mount.renderSidebar(left) })
          ] }),
          react_jsx_runtime.jsx('div', { className: 'wd10-detailFrame',
            hidden: panelCollapsed, children: react_jsx_runtime.jsx(CreatorDetail, {
              routingProject: activeProject,
              project: selectedContent,
              tab: creatorTab,
              onTab: setCreatorTab,
              workspaceFiles,
              workspaceIdentity: currentCatalogIdentity,
              alignment: mismatch ? {
                currentTitle: currentProject?.title
                  || sessionState.byId[sessionState.current]?.displayTitle || '未选择会话',
                pending: alignmentPending,
                error: alignmentError
              } : null,
              onAlign: () => { void alignProject(activeProject, true); },
              panelCollapseRef: panelCollapseButton,
              onPanelCollapse: () => setPanelCollapsed(true),
              onCatalogRefresh: refreshCatalog,
              onProjectMutation: applyProjectMutation,
              onPublishCreated: applyPublishCreated
            }) }),
          react_jsx_runtime.jsx('div', { className: 'wd10-detailRail', hidden: !panelCollapsed,
            children: react_jsx_runtime.jsx('button', { ref: panelExpandButton, type: 'button',
              onClick: () => setPanelCollapsed(false), children: '展开工作台' }) }),
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
        projectActions: browserOnly ? null : createProjectActions(ctx),
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
