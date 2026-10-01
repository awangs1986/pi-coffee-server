import {initRunners} from "./runners.js";
import {initSshme,parseSshme,SSHME_COMMAND} from './sshme.js';
import { initSkills } from "./skills.js";
// PI Coffee browser shell — controller. The browser is a view: conversations,
// history, models and running state live on the Host in the User VM. The only
// local value is which conversation this browser last displayed.
import {

  renderMarkdown, timeGroup, activityGroup, assistantNode, el, fillToolCard, formatBytes, installCopyHandlers,
  noteNode, relativeTime, toolCard, toolResultDetails, toolResultText, updateActivity, updateAssistant, userBubble,

} from './render.js';
import { attentionOf, orderSessions, formatReset, isTerminalSession, sessionGroups, usageBadge } from './sidebar.js';


const ACTIVE_KEY_BASE = 'pi-coffee.active.v2';
let ACTIVE_KEY = ACTIVE_KEY_BASE;   // suffixed with the login name once /auth/me answers
import { DiffView } from './diff-view.js';
import { compactionNotice, isContextError } from './context-status.js';


let taskSelectionEpoch=0;
let creationRequest = (()=>{try{return JSON.parse(sessionStorage.getItem('coffee.pending-creation'));}catch{return null;}})();
function saveCreation(){if(creationRequest)sessionStorage.setItem('coffee.pending-creation',JSON.stringify(creationRequest));else sessionStorage.removeItem('coffee.pending-creation');}
const THEME_KEY = 'pi-coffee.theme.v1';

const $ = (selector) => document.querySelector(selector);
const ui = {
  app: $('#app'), thread: $('#thread'), scroller: $('#scroller'), toBottom: $('#to-bottom'),
  brandBtn: $('#brand-menu-btn'), brandMenu: $('#brand-menu'), themeToggle: $('#theme-toggle'), themeLabel: $('#theme-toggle-label'),
  prompt: $('#prompt'), send: $('#send'), stop: $('#stop'), status: $('#status'), dot: $('#dot'), connBanner: $('#conn-banner'),
  composer: $('#composer'), composerWrap: $('.composer-wrap'),
  title: $('#title'), topbarState: $('#topbar-state'), stats: $('#stats'), sessionMeta: $('#session-meta'),
  usage: $('#usage'),
  sessionList: $('#session-list'), search: $('#search'), queue: $('#queue'), slash: $('#slash'),
  attachments: $('#attachments'), attach: $('#attach'), file: $('#file'), hint: $('#hint'),
  agentBtn: $('#agent-menu-btn'), agentMenu: $('#agent-menu'), agentName: $('#agent-name'), agentNote: $('#agent-menu-note'),
  agentRows: { kind: $('#agent-kind-row'), engine: $('#agent-engine-row'), source: $('#agent-source-row'), model: $('#agent-model-row'), thinking: $('#agent-thinking-row'), context: $('#agent-context-row') },
  agentPanes: { engine: $('#agent-engine-pane'), kind: $('#agent-kind-pane'), source: $('#agent-source-pane'), model: $('#agent-model-pane'), thinking: $('#agent-thinking-pane'), context: $('#agent-context-pane') },
  agentValues: { engine: $('#agent-engine-value'), kind: $('#agent-kind-value'), source: $('#agent-source-value'), model: $('#agent-model-value'), thinking: $('#agent-thinking-value'), context: $('#agent-context-value') },
  modelSource: $('#model-source'), model: $('#model'), thinking: $('#thinking'), modeWrap: $('#mode-wrap'), mode: $('#mode'),
  projectSelect: $('#project-select'), startBranch: $('#start-branch'), taskDetails: $('#task-details'), taskDetailsBtn: $('#task-details-btn'),
  modal: $('#modal'), modalTitle: $('#modal-title'), modalText: $('#modal-text'), modalInput: $('#modal-input'),
  modalOk: $('#modal-ok'), modalCancel: $('#modal-cancel'), toast: $('#toast'),
  extStatus: $('#ext-status'), widgets: $('#widgets'),
  pluginsBtn: $('#plugins-btn'), pluginsModal: $('#plugins-modal'), pluginsBody: $('#plugins-body'), pluginsSub: $('#plugins-sub'), pluginsClose: $('#plugins-close'),
  statsWrap: $('#stats-wrap'), statsPop: $('#stats-pop'), spPct: $('#sp-pct'), spCapacity: $('#sp-capacity'), spContextLegend: $('#sp-context-legend'),
  spBar: $('#sp-bar'), spCompact: $('#sp-compact'),
  uiModal: $('#ui-modal'), uiTitle: $('#ui-title'), uiText: $('#ui-text'), uiOptions: $('#ui-options'), uiInput: $('#ui-input'),
  uiEditor: $('#ui-editor'), uiMeta: $('#ui-meta'), uiOk: $('#ui-ok'), uiNo: $('#ui-no'), uiCancel: $('#ui-cancel'),
  userBtn: $('#user-btn'), userName: $('#user-name'),
};

// ---------- state ----------
let socket, reconnectTimer;

let retryNote;
let finishedWhileHidden = false;
const pendingToolFills = new Set();
let connected = false, opened = false, streaming = false, compacting = false, modelPending = null;
let activeId = null;
let currentUser = null;
function rememberTask(id){if(id){sessionStorage.setItem(ACTIVE_KEY,id);localStorage.setItem(ACTIVE_KEY,id);}else{sessionStorage.removeItem(ACTIVE_KEY);localStorage.removeItem(ACTIVE_KEY);}}
let pendingOpenId = null, queuedPrompt = null, prepareNew = false;
let draftFiles = [];
let draftContextPreset='272k', contextToApply=null, contextPending=null;
let searchOpen = false, searchFilter = 'all';

let sessions = [], commands = [], models = null, statsCache = null;
let catalogRequest = null, draftModel = null, historyReady = false;
let entries = [];
const nativeItems=new Map();let nativeCursor=0;let pendingDelivery=null;let uncertainTask=null;
const queuedRequests = new Set(); // A rejected queued input does not end the active run.
let engine="pi", capabilities=null, engineAvailability=[];
const engineName=(value=engine)=>({pi:"Pi",codex:"Codex",claude:"Claude Code"})[value] || value;
const supports=(name)=>capabilities ? capabilities[name]===true : engine==="pi";
async function loadEngines(){
  let available=[];try{const response=await fetch("/api/engines");if(response.ok)available=(await response.json()).engines??[];}catch{}
  engineAvailability=available;renderProjectContext();loadDraftModels();
}
void loadEngines();
let requestNumber = 0;
let currentAssistant, currentActivity, activityCount = 0;
const openTools = new Map();
let lastTool, thinkingNode;
let lastUserText = '';
let attachments = [];          // small inline images: { type, mimeType, data }
let uploads = [];              // files transferred straight to the User VM (ADR-0009)
let uploadLog = [];            // completed uploads for the current conversation: { name, size, path }
let workspaceState = null, showArchived = false, workspaceRequestSeq = 0;
let projectCreating = false;
// Code forges (ADR-0022): Gitea Projects (the default) and GitHub repositories added through the picker.
const FORGE_NAMES = { gitea: 'Gitea', github: 'GitHub' };
const ADD_GITHUB = '__add_github__', ADD_GITEA = '__add_gitea__';
let repositoryPickerForge = 'github', draftProjectForge = 'gitea';
let lastProjectValue = '';            // restores the dropdown after the pseudo-option opens the picker
let githubRepos = null, githubError = '', githubAdding = '', githubSeq = 0;
function projectForge(project) { return project?.forge === 'github' ? 'github' : 'gitea'; }
function forgeName(project) { return FORGE_NAMES[projectForge(project)]; }
function forgeCapabilities() { const forges = workspaceState?.capabilities?.forges; return { gitea: forges?.gitea !== false, github: Boolean(forges?.github) }; }
function workForgeLabel() { return forgeCapabilities().github ? 'Gitea / GitHub' : 'Gitea 项目'; }
let transfer = null;           // { url, scope, token, inbox, maxFileBytes, maxBatchBytes } from the Host
let workspaceChanges = null;   // aggregate Checkout status from `/api/workspace` action `changes`
let workspaceSync = null;
let selectedChangedPath = null;
let reviewLayout='unified', diffTaskId=null, diffEpoch=0, diffView=null;
let diffScope='branch', diffData=null, diffReturnFocus=null, filesPanelBeforeDiff=false; // Diff panel: Branch | 最近一轮
// Codex reports its cumulative diff after every edit (turn_diff). An open 最近一轮 re-reads the Host
// snapshot comparison at most once per interval, never overlapping; the event's own diff is not rendered.
const TURN_DIFF_REFRESH_MS=1500;
let turnDiffTimer=null, turnDiffLoading=false, turnDiffAgain=false;
let prBusy='';                 // progress label while 创建 PR runs checkpoint → push → pull request
let workspaceDetailOpen = false; // true while a Diff/Checks document replaces the change list
let lastChangeCardSignature = '';
let changeCardEpoch = 0, changeCardChecked = '';
let filesAwaitingTransfer = []; // picked before the Session/transfer endpoint was known
let preferSameOriginTransfer = false;
let renderTimer = null;

// ---------- helpers ----------
const scrollToEnd = () => { ui.scroller.scrollTop = ui.scroller.scrollHeight; };
const nearBottom = () => ui.scroller.scrollHeight - ui.scroller.scrollTop - ui.scroller.clientHeight < 120;
function toast(text, ms = 1800) {
  ui.toast.textContent = text;
  ui.toast.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ui.toast.classList.add('hidden'), ms);
}
function send(frame) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(frame));
  return true;
}
function requestId(prefix) { return prefix + '-' + Date.now() + '-' + (++requestNumber); }
function isMobileSidebar() { return window.matchMedia('(max-width: 820px)').matches; }
function applyTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  diffView?.setTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch { /* private-mode storage can fail */ }
  ui.themeToggle?.setAttribute('aria-pressed', String(next === 'dark'));
  if (ui.themeLabel) ui.themeLabel.textContent = next === 'dark' ? '浅色模式' : '深色模式';
}
function closeBrandMenu() {
  ui.brandMenu?.classList.add('hidden');
  ui.brandBtn?.setAttribute('aria-expanded', 'false');
}
function toggleBrandMenu() {
  const open = ui.brandMenu?.classList.contains('hidden');
  if (!open) { closeBrandMenu(); return; }
  ui.brandMenu.classList.remove('hidden');
  ui.brandBtn?.setAttribute('aria-expanded', 'true');
}

// ---------- Agent settings menu ----------
const draftModelEngine = () => !activeId && !pendingOpenId && engineAvailability.some(e=>e.id===$('#task-engine').value && e.available && e.modelCatalog) ? $('#task-engine').value : null;
const modelControlsLocked = () => compacting || !!modelPending || !connected || (!opened && !draftModelEngine());
function loadDraftModels() {
  if (!connected || !draftModelEngine()) return;
  catalogRequest=requestId("catalog");
  send({v:1,type:"get_model_catalog",engine:draftModelEngine(),requestId:catalogRequest});
}
function flushFirstPrompt() {
  if (!historyReady || modelPending || contextPending || contextToApply || queuedPrompt === null || uploadsBusy() || uploads.some(u=>u.state==='failed')) return;
  const q=queuedPrompt;queuedPrompt=null;
  const files=completedUploads();
  submitPrompt(q.text || (files.length ? '（附件）' : '（图片）'),q.images);
}
function sourceLabel(source) {
  return source === 'relay' ? 'Relay' : 'Native';
}
function selectedModelInfo() {
  if (!models) return null;
  return models.models.find((m) => m.provider === models.current?.provider && m.id === models.current?.id) || models.current || null;
}
function closeAgentPanes() {
  for (const pane of Object.values(ui.agentPanes)) pane.classList.add('hidden');
  for (const row of Object.values(ui.agentRows)) row.setAttribute('aria-expanded', 'false');
}
function closeAgentMenu() {
  ui.agentMenu?.classList.add('hidden');
  ui.agentBtn?.setAttribute('aria-expanded', 'false');
  closeAgentPanes();
}
function toggleAgentMenu() {
  if (!ui.agentMenu || ui.agentBtn.disabled) return;
  const open = ui.agentMenu.classList.contains('hidden');
  closeBrandMenu();
  closeTaskDetails();
  if (!open) { closeAgentMenu(); return; }
  renderAgentSettings();
  ui.agentMenu.classList.remove('hidden');
  ui.agentBtn.setAttribute('aria-expanded', 'true');
  setTimeout(() => Object.values(ui.agentRows).find((row) => !row.disabled && !row.classList.contains('hidden'))?.focus(), 0);
}
function openAgentPane(kind) {
  closeAgentPanes();
  const pane = ui.agentPanes[kind];
  if (!pane || ui.agentRows[kind]?.disabled) return;
  renderAgentPane(kind);
  pane.classList.remove('hidden');
  ui.agentRows[kind].setAttribute('aria-expanded', 'true');
}
function agentOption({ label, meta = '', selected = false, disabled = false, plain = false, onClick }) {
  const button = el('button', 'agent-option' + (selected ? ' selected' : '') + (plain ? ' plain' : ''));
  button.type = 'button';
  button.setAttribute('role', 'menuitemradio');
  button.setAttribute('aria-checked', String(selected));
  button.disabled = disabled;
  button.append(el('span', 'agent-option-label', label));
  if (meta) button.append(el('span', 'agent-option-meta', meta));
  if (selected) button.append(el('span', 'agent-option-check', '✓'));
  button.addEventListener('click', onClick);
  return button;
}
// Agent and Chat/Work are chosen here for a new task; the hidden selects stay the source of truth.
function renderChoicePane(pane, select, describe) {
  for (const option of select.options) {
    const { label, meta } = describe(option);
    pane.append(agentOption({
      label, meta, plain: true, selected: select.value === option.value, disabled: option.disabled,
      onClick: () => {
        closeAgentMenu();
        if (select.value !== option.value) { select.value = option.value; select.dispatchEvent(new Event('change')); }
        ui.agentBtn.focus();
      },
    }));
  }
}
function renderAgentPane(kind) {
  const pane = ui.agentPanes[kind];
  pane.replaceChildren();
  if (kind === 'engine') { renderChoicePane(pane, $('#task-engine'), (option) => ({ label: engineName(option.value), meta: option.textContent.split(' · ').slice(1).join(' · ') })); return; }
  if (kind === 'kind') {
    for(const source of ['chat','gitea','github']) {
      const available=source==='chat' || forgeCapabilities()[source];
      pane.append(agentOption({label:source==='chat'?'Chat':FORGE_NAMES[source],meta:source==='chat'?'Pi 聊天':available?'Work 项目':'Host 未配置',selected:taskSource()===source,disabled:!available,onClick:()=>chooseTaskSource(source)}));
    }
    return;
  }
  if(kind==='context'){
    for(const preset of ['272k','maximum'])pane.append(agentOption({label:preset==='272k'?'272k（默认）':'模型最大',selected:(opened?models?.context?.preset:draftContextPreset)===preset,onClick:async()=>{
      const epoch=taskSelectionEpoch,id=activeId;
      closeAgentMenu();
      if(preset==='maximum'&&!await askModal({title:'使用模型最大上下文',text:'过大的上下文会产生额外费用。具体计费以所用模型和服务商为准。',okLabel:'确认使用'}))return;
      if(epoch!==taskSelectionEpoch||id!==activeId)return;
      if(opened){if(streaming||compacting||!models?.context)return;contextPending=requestId('context');send({v:1,type:'set_context',requestId:contextPending,preset});}
      else draftContextPreset=preset;
      renderAgentSettings();refreshComposer();
    }}));return;
  }
  if (!models) return;
  const current = selectedModelInfo();
  if (kind === 'source') {
    const sources = [...new Set(models.models.map((m) => m.source || 'native'))];
    for (const source of sources) {
      const available = models.models.filter((m) => (m.source || 'native') === source).length;
      pane.append(agentOption({
        label: sourceLabel(source),
        meta: `${available} 个模型`,
        selected: (models.current?.source || current?.source || 'native') === source,
        onClick: () => {
          closeAgentMenu();
          const next = models.models.find((m) => (m.source || 'native') === source);
          if (next && (models.current?.source || current?.source || 'native') !== source) chooseModel(next.provider, next.id);
        },
      }));
    }
    return;
  }
  if (kind === 'model') {
    const bySource = new Map();
    for (const model of models.models) {
      const source = model.source || 'native';
      if (!bySource.has(source)) bySource.set(source, []);
      bySource.get(source).push(model);
    }
    for (const [source, sourceModels] of bySource) {
      pane.append(el('div', 'agent-pane-label', sourceLabel(source)));
      for (const model of sourceModels) {
        const selected = current?.provider === model.provider && current?.id === model.id;
        pane.append(agentOption({
          label: model.id,
          meta: model.provider,
          selected,
          onClick: () => { closeAgentMenu(); if (!selected) chooseModel(model.provider, model.id); },
        }));
      }
    }
    return;
  }
  const levels = models.thinkingLevels || [];
  for (const level of levels) {
    pane.append(agentOption({
      label: level,
      selected: models.thinkingLevel === level,
      onClick: () => {
        closeAgentMenu();
        ui.thinking.value = level;
        send({ v: 1, type: 'set_thinking', requestId: requestId('thinking'), level });
      },
    }));
  }
}
// The trigger names the Agent. Agent/类型 lock once the task exists; model rows follow the model catalog.
function agentMenuState() {
  const task = currentTask();
  const agent = task ? (task.engine || 'pi') : activeId ? engine : $('#task-engine').value;
  const kind = task ? (task.workspaceKind === 'chat' ? 'chat' : 'project') : $('#task-kind').value;
  const choiceLocked = Boolean(task) || !!pendingOpenId;
  const modelLocked = modelControlsLocked() || !models;
  return { task, agent, kind, choiceLocked, modelLocked };
}
function renderAgentTrigger() {
  if (!ui.agentBtn) return;
  const { agent, kind, choiceLocked, modelLocked } = agentMenuState();
  ui.agentName.textContent = engineName(agent);
  ui.agentBtn.setAttribute('aria-label', `Agent 设置：${engineName(agent)}`);
  ui.agentBtn.title = [`Agent：${engineName(agent)}`, kind === 'chat' ? 'Chat' : 'Work', models?.current ? `模型 ${models.current.provider}/${models.current.id}` : '', models?.thinkingLevel ? `思考 ${models.thinkingLevel}` : ''].filter(Boolean).join(' · ');
  ui.agentBtn.disabled = !connected || (choiceLocked && modelLocked);
  ui.agentRows.source.classList.toggle('hidden', agent !== 'pi');
}
function renderAgentSettings() {
  if (!ui.agentBtn) return;
  const { task, agent, kind, choiceLocked, modelLocked } = agentMenuState();
  ui.agentValues.engine.textContent = engineName(agent);
  ui.agentValues.kind.textContent = kind === 'chat' ? 'Chat' : FORGE_NAMES[taskSource()];
  // A legacy task (open without a workspace record) keeps its Agent; only its directory type is chosen.
  ui.agentRows.engine.disabled = choiceLocked || Boolean(activeId);
  ui.agentRows.kind.disabled = choiceLocked;
  const current = selectedModelInfo();
  const source = models?.current?.source || current?.source || 'native';
  ui.agentValues.source.textContent = models ? sourceLabel(source) : '—';
  ui.agentValues.model.textContent = models?.current ? models.current.id : '—';
  ui.agentValues.model.title = models?.current ? `${models.current.provider}/${models.current.id}` : '';
  const levels = models?.thinkingLevels || [];
  ui.agentRows.thinking.classList.toggle('hidden', levels.length === 0);
  ui.agentValues.thinking.textContent = models?.thinkingLevel || levels[0] || '—';
  for (const row of ['source', 'model', 'thinking']) ui.agentRows[row].disabled = modelLocked;
  ui.agentRows.context.classList.toggle('hidden',!['pi','codex'].includes(agent));
  ui.agentRows.context.disabled=streaming||compacting||Boolean(contextPending)||!models?.context;
  ui.agentValues.context.textContent=(opened?models?.context?.preset:draftContextPreset)==='maximum'?'模型最大':'272k';
  const note = !models && !opened && !choiceLocked ? (agent === 'claude' ? 'Claude Code 使用 CLI 自己的模型设置。' : '模型在任务创建后可选。')
    : task && !pendingOpenId ? 'Agent 和来源在任务创建时固定。' : '';
  ui.agentNote.textContent = note;
  ui.agentNote.classList.toggle('hidden', !note);
  if (models) ui.agentBtn.dataset.state = `${source} · ${models.current ? models.current.id : 'no model'} · ${models.thinkingLevel || 'default'}`;
  renderAgentTrigger();
  for (const pane of ['source', 'model', 'thinking', 'context']) renderAgentPane(pane);
}
// 任务详情 (scroll button): VM, path, copy path and local compaction.
function closeTaskDetails() {
  ui.taskDetails?.classList.add('hidden');
  ui.taskDetailsBtn?.setAttribute('aria-expanded', 'false');
}
function toggleTaskDetails() {
  const open = ui.taskDetails.classList.contains('hidden');
  closeAgentMenu();
  closeBrandMenu();
  if (!open) { closeTaskDetails(); return; }
  renderProjectContext();
  ui.taskDetails.classList.remove('hidden');
  ui.taskDetailsBtn.setAttribute('aria-expanded', 'true');
}
function openSidebar() {
  if (isMobileSidebar()) ui.app.classList.add('side-open');
  ui.app.classList.remove('side-collapsed');
}
function collapseSidebar() {
  if (isMobileSidebar()) ui.app.classList.remove('side-open');
  else ui.app.classList.add('side-collapsed');
}

// ---------- modal ----------
function askModal({ title, text, input, okLabel = '确定', danger = false }) {
  return new Promise((resolve) => {
    ui.modalTitle.textContent = title;
    ui.modalText.textContent = text || '';
    ui.modalText.classList.toggle('hidden', !text);
    ui.modalInput.classList.toggle('hidden', input === undefined);
    ui.modalOk.textContent = okLabel;
    ui.modalOk.classList.toggle('danger', danger);
    if (input !== undefined) ui.modalInput.value = input;
    ui.modal.classList.remove('hidden');
    const done = (value) => {
      ui.modal.classList.add('hidden');
      ui.modalOk.onclick = ui.modalCancel.onclick = null;
      ui.modalInput.onkeydown = null;
      resolve(value);
    };
    ui.modalOk.onclick = () => done(input !== undefined ? ui.modalInput.value.trim() : true);
    ui.modalCancel.onclick = () => done(null);
    ui.modalInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ui.modalOk.click(); } if (e.key === 'Escape') done(null); };
    setTimeout(() => (input !== undefined ? ui.modalInput : ui.modalOk).focus(), 0);
  });
}

// ---------- thread rendering ----------
function resetThread() {
  ui.thread.innerHTML = '';
  nativeItems.clear();nativeCursor=0;
  entries = [];
  currentAssistant = undefined;
  currentActivity = undefined;
  activityCount = 0;
  openTools.clear();
  lastTool = undefined;
  thinkingNode = undefined;
  uploadLog = [];
}

function taskSource() {
  const task=currentTask();
  if((task?.workspaceKind || $('#task-kind').value)==='chat')return 'chat';
  const project=workspaceState?.projects.find(p=>p.id===(task?.projectId || ui.projectSelect.value));
  return project ? projectForge(project) : draftProjectForge;
}
function chooseTaskSource(source) {
  if(currentTask() || pendingOpenId || (source!=='chat' && !forgeCapabilities()[source]))return;
  taskSelectionEpoch++;closeAgentMenu();closeGitHubPicker();
  const project=workspaceState?.projects.find(p=>p.id===ui.projectSelect.value);
  if(source==='chat' || (project && projectForge(project)!==source)){
    ui.projectSelect.value='';ui.projectSelect.dispatchEvent(new Event('change'));
  }
  if(source!=='chat')draftProjectForge=source;
  const kind=$('#task-kind'),next=source==='chat'?'chat':'project';
  if(kind.value!==next){kind.value=next;kind.dispatchEvent(new Event('change'));}
  renderProjectContext();renderAgentSettings();
  if(source==='chat')ui.prompt.focus();else void openGitHubPicker(source);
}
function refreshHeroChoices() {
  for(const button of document.querySelectorAll('#hero [data-task-source]')){
    const source=button.dataset.taskSource,available=source==='chat' || forgeCapabilities()[source];
    button.disabled=Boolean(activeId || pendingOpenId) || !available;
    button.title=available?'':`${FORGE_NAMES[source]} 尚未在 Host 配置`;
  }
}
const CHIPS = ['列出当前目录的文件', '解释这个仓库的结构', '写一个 Python 脚本统计文件行数'];
function renderHero() {
  const hero = el('div', 'hero');
  hero.id = 'hero';
  hero.innerHTML = '<h1>有什么可以帮你？</h1><p>Agent 会在你的 User VM 中直接执行任务。</p><div class="chips"></div>';
  const chips = hero.querySelector('.chips');
  if(!activeId){
    for(const [source,label] of [['chat','新建一个聊天（Chat）'],['gitea','开启一项任务（Gitea）'],['github','开启一项任务（GitHub）']]){
      const chip=el('button','chip',label);chip.type='button';chip.dataset.taskSource=source;
      chip.addEventListener('click',()=>chooseTaskSource(source));chips.appendChild(chip);
    }
  } else for (const text of CHIPS) {
    const chip = el('button', 'chip', text);
    chip.type = 'button';
    chip.addEventListener('click', () => { ui.prompt.value = text; ui.prompt.focus(); autoGrow(); refreshComposer(); });
    chips.appendChild(chip);
  }
  ui.thread.appendChild(hero);refreshHeroChoices();
}
const removeHero = () => { const hero = $('#hero'); if (hero) hero.remove(); };

function appendNode(node) {
  removeHero();
  const stick = nearBottom();
  ui.thread.appendChild(node);
  if (stick) scrollToEnd();
}

function pushUser(text, images, imageCount, files) {
  const entry = { k: 'user', text, images, imageCount, files };
  entry.node = userBubble(entry);
  entries.push(entry);
  appendNode(entry.node);
  currentActivity = undefined;
  return entry;
}
function pushAssistant(text) {
  const entry = { k: 'assistant', text: text || '' };
  entry.node = assistantNode(entry);
  entries.push(entry);
  appendNode(entry.node);
  // Once text arrives, the tool group for this run is closed visually.
  currentActivity = undefined;
  return entry;
}
function pushNote(text, failure) {
  const entry = { k: 'note', text, failure };
  entry.node = noteNode(entry);
  entries.push(entry);
  appendNode(entry.node);
  return entry;
}
function pushTool(tool) {
  const entry = { k: 'tool', ...tool };
  entry.node = toolCard(entry);
  entries.push(entry);
  if (!currentActivity) {
    currentActivity = activityGroup();
    activityCount = 0;
    appendNode(currentActivity);
  }
  activityCount += 1;
  currentActivity.querySelector('.activity-body').appendChild(entry.node);
  updateActivity(currentActivity, activityCount, !tool.done);
  addToolDownloadLink(entry);
  if (nearBottom()) scrollToEnd();
  return entry;
}
const pendingAssistantRenders = new Set();
function scheduleAssistantRender() {
  if(currentAssistant)pendingAssistantRenders.add(currentAssistant);
  if (renderTimer) return;
  renderTimer = requestAnimationFrame(() => {
    renderTimer = null;
    const stick = nearBottom();
    for(const entry of pendingAssistantRenders)if(entry.node.isConnected)updateAssistant(entry.node,entry.text);
    pendingAssistantRenders.clear();
    if (stick) scrollToEnd();
  });
}
function showThinking(show) {
  if (show && !thinkingNode) {
    thinkingNode = el('div', 'thinking');
    thinkingNode.innerHTML = '<span class="dots"><span></span><span></span><span></span></span><span>Agent 正在思考…</span>';
    appendNode(thinkingNode);
  } else if (!show && thinkingNode) {
    thinkingNode.remove();
    thinkingNode = undefined;
  }
}

function splitUploadedFilesText(rawText) {
  const text = String(rawText || '');
  const marker = '\n\n[已上传到工作目录的文件]\n';
  const cut = text.indexOf(marker);
  if (cut < 0) return { text, files: [] };
  const body = text.slice(0, cut);
  const tail = text.slice(cut + marker.length);
  const files = [];
  for (const line of tail.split('\n')) {
    const match = /^- (.+?)(?: \(([^()]+)\))?$/.exec(line.trim());
    if (!match) continue;
    const path = match[1].trim();
    const name = path.split('/').pop() || path;
    const sizeText = match[2] || '';
    files.push({ name, path, uploadPath: path, sizeText, href: downloadUrl(path) });
  }
  return { text: body, files };
}

function renderHistory(frame) {
  resetThread();
  if (frame.truncated) pushNote('更早的记录仍保存在 User VM 中，这里只显示最近的部分。');
  for (const item of frame.entries || []) {
    if (item.kind === 'user') {
      const parsed = splitUploadedFilesText(item.text || '');
      pushUser(parsed.text, undefined, item.imageCount, parsed.files);
      for (const f of parsed.files) {
        if (!uploadLog.some((x) => x.path === f.path)) uploadLog.push({ name: f.name, size: f.size, sizeText: f.sizeText, path: f.path });
      }
      lastUserText = parsed.text || lastUserText;
    }
    else if (item.kind === 'assistant') nativeItems.set(item.id,pushAssistant(item.text || ''));
    else if (item.kind === 'tool') nativeItems.set(item.id,pushTool({ name: item.name, args: item.args, result: item.result || '', done: true, error: Boolean(item.isError), details: item.diff ? { patch: item.diff } : undefined }));
    else if (item.kind === 'note') pushNote(item.text || '');
  }
  // History groups are finished work: collapse them.
  for (const group of ui.thread.querySelectorAll('.activity')) { group.open = false; group.classList.remove('running'); }
  currentActivity = undefined;
  if (uploadLog.length) renderUploadLogCard();
  if (entries.length === 0) renderHero();
  if (streaming) showThinking(true);
  scrollToEnd();
  addRegenerateButton();
}

function addRegenerateButton() {
  ui.thread.querySelectorAll('.msg-tool.regen').forEach((b) => b.remove());
  const last = [...entries].reverse().find((e) => e.k === 'assistant');
  if (!last || !lastUserText || streaming) return;
  const tools = last.node.querySelector('.msg-tools');
  if (!tools) return;
  const regen = el('button', 'msg-tool regen', '重新生成');
  regen.type = 'button';
  regen.title = '用同一条消息再问一次';
  regen.addEventListener('click', () => { if (!streaming && opened) submitPrompt(lastUserText, []); });
  tools.appendChild(regen);
}

// ---------- sidebar ----------
function sessionTitle(session) {
  const raw = (session && (session.name || session.preview)) || '';
  // The preview is the first prompt as sent; drop the attachment listing we append.
  const cut = raw.indexOf('[已上传到工作目录的文件]');
  return (cut > 0 ? raw.slice(0, cut).trim() : raw) || '新对话';
}
function renderSessionList() {
  if(sidebarDragId)return;
  const grouped=workspaceState?.sidebar?.showGroups!==false;
  $('#show-groups').setAttribute('aria-checked',String(grouped));
  $('#show-groups').disabled=!workspaceState || sidebarSaving;
  ui.sessionList.innerHTML = '';
  renderSearchResults();
  let known = sessions.slice();
  if (activeId && !known.some((s) => s.id === activeId)) known.unshift({ id: activeId, preview: '', running: streaming, messageCount: 0, updatedAt: new Date().toISOString() });
  if(workspaceState) {
    for(const c of workspaceState.conversations) if(!known.some(s=>s.id===c.id)) known.push({id:c.id,preview:c.creationState==='failed'?'创建失败 · 点击重试':c.creationState==='creating'?'创建中 · 点击恢复':c.workspaceKind==='chat'?'Chat 任务':'Work 任务',updatedAt:c.createdAt,running:false});
    known=known.filter(s=> {const c=workspaceState.conversations.find(c=>c.id===s.id);return Boolean(c?.archived || workspaceState.legacyArchived?.includes(s.id))===showArchived;});
  }
  if (known.length === 0 && (!grouped || !workspaceState?.projects.length)) {
    ui.sessionList.appendChild(el('li', 'empty-list', '还没有对话'));
    return;
  }

  if (!workspaceState || !grouped) { appendSessionGroups(ui.sessionList,known); return; }
  const assigned=new Map(workspaceState.projects.map(p=>[p.id,[]]));
  const ungrouped=[];
  for(const session of known){
    const task=workspaceState.conversations.find(c=>c.id===session.id);
    const overrides=workspaceState.sidebar?.assignments;
    const projectId=overrides && Object.hasOwn(overrides,session.id) ? overrides[session.id] : task?.projectId;
    (assigned.get(projectId) || ungrouped).push(session);
  }
  for(const project of workspaceState.projects){
    const items=assigned.get(project.id);
    const group=el('li','project-group');group.dataset.sidebarProject=project.id;
    const folded=workspaceState.sidebar?.collapsed?.includes(project.id) || false;
    const button=el('button','project-group-toggle');button.type='button';
    button.setAttribute('aria-expanded',String(!folded));button.title=project.repoUrl || project.name;
    button.append(el('span','project-chevron',folded?'▸':'▾'),el('span','project-group-name',project.name),el('span','project-group-count',String(items.length)));
    const attention=items.filter(s=>attentionOf(s)==='waiting'||attentionOf(s)==='finished').length;
    const running=items.filter(s=>attentionOf(s)==='running').length;
    if(attention)button.append(el('span','project-group-status',attention+' 待查看'));
    else if(running)button.append(el('span','project-group-status',running+' 运行中'));
    button.addEventListener('click',()=>saveSidebar({action:'sidebar_collapse',projectId:project.id,collapsed:!folded}));
    const list=el('ul','project-group-list');list.hidden=folded;list.setAttribute('aria-label',project.name+' 对话');
    for(const session of orderSessions(items))list.append(sessionRow(session));
    group.append(button,list);sidebarDropTarget(group,project.id);ui.sessionList.append(group);
  }
  const outside=el('li','ungrouped-conversations');outside.dataset.sidebarUngrouped='';
  outside.append(el('div','side-label','未分组'));
  const list=el('ul','project-group-list');appendSessionGroups(list,ungrouped);
  if(!ungrouped.length)list.append(el('li','sidebar-drop-hint','拖到这里移出项目分组'));
  outside.append(list);sidebarDropTarget(outside,null);ui.sessionList.append(outside);
}
function appendSessionGroups(parent,list){
  for(const group of sessionGroups(list)){
    const label=el('li','side-label'+(group.label==='需要你'?' attention':''),group.label);
    parent.append(label);for(const session of group.sessions)parent.append(sessionRow(session));
  }
}
// Native drag payloads are accepted only when this page started the drag.
let sidebarDragId=null,sidebarSaving=false;
function sidebarDropTarget(node,projectId){
  const accept=event=>{if(!sidebarDragId || sidebarSaving)return;event.preventDefault();event.dataTransfer.dropEffect='move';node.classList.add('drop-target');};
  node.addEventListener('dragenter',accept);
  node.addEventListener('dragover',accept);
  node.addEventListener('dragleave',event=>{if(!node.contains(event.relatedTarget))node.classList.remove('drop-target');});
  node.addEventListener('drop',event=>{
    event.preventDefault();event.stopPropagation();node.classList.remove('drop-target');
    const id=sidebarDragId;sidebarDragId=null;
    if(id && !sidebarSaving)void saveSidebar({action:'sidebar_move',id,projectId});
  });
}
async function saveSidebar(change){
  if(sidebarSaving)return;sidebarSaving=true;
  try{
    const sidebar=await workspaceApi(change);
    ++workspaceRequestSeq; // Ignore workspace reads started before this persisted change.
    if(workspaceState)workspaceState.sidebar=sidebar;
    renderSessionList();
  }catch(error){toast(error.message);}finally{sidebarSaving=false;$('#show-groups').disabled=!workspaceState;}
}

function sessionRow(session) {
  const attention = attentionOf(session);
  const terminal = isTerminalSession(session);
  const item = el('li', 'session-item' + (session.id === activeId ? ' active' : '') + (attention ? ' ' + attention : '') + (terminal ? ' terminal' : ''));
  item.dataset.sessionId=session.id;
  if(workspaceState){
    item.draggable=true;
    item.addEventListener('dragstart',event=>{if(sidebarSaving){event.preventDefault();return;}sidebarDragId=session.id;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',session.id);});
    item.addEventListener('dragend',()=>{sidebarDragId=null;document.querySelectorAll('.drop-target').forEach(n=>n.classList.remove('drop-target'));renderSessionList();});
  }
  item.setAttribute('role', 'button');
  item.tabIndex = 0;
  const main = el('div', 'session-main');
  main.appendChild(el('span', 'title', sessionTitle(session)));
  if(workspaceState?.conversations.find(c=>c.id===session.id)?.runState==='interrupted')main.append(el('span','interrupted-badge','上次运行中断 · 未自动续跑'));
  const metaParts = [relativeTime(session.updatedAt), session.messageCount ? session.messageCount + ' 条' : ''];
  if (attention === 'waiting') metaParts.unshift('等你回答');
  else if (attention === 'finished') metaParts.unshift('已完成，待查看');
  else if (attention === 'running') metaParts.unshift('运行中');
  if (terminal) metaParts.push('终端');
  main.appendChild(el('span', 'meta', metaParts.filter(Boolean).join(' · ')));
  item.appendChild(main);
  if (attention === 'waiting') item.appendChild(el('span', 'badge waiting', '?'));
  else if (attention === 'finished') item.appendChild(el('span', 'badge finished', '✓'));
  else if (attention === 'running') item.appendChild(el('span', 'running'));
  const menu = el('button', 'more', '⋯');
  menu.type = 'button';
  menu.title = workspaceState ? '重命名 / 归档' : '重命名 / 删除';
  menu.setAttribute('aria-label', '对话操作');
  menu.addEventListener('click', (event) => { event.stopPropagation(); openSessionMenu(session, menu); });
  item.appendChild(menu);
  const open = () => { switchSession(session.id); closeSidebarOnMobile(); };
  item.addEventListener('click', open);
  item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  return item;
}
/** Conversations that want the user, for the tab title. */
function attentionCount() {
  return sessions.filter((s) => s.id !== activeId && (s.attention === 'waiting' || s.attention === 'finished')).length;
}

let menuNode;
function closeMenu() { if (menuNode) { menuNode.remove(); menuNode = undefined; } }
function openSessionMenu(session, anchor) {
  closeMenu();
  menuNode = el('div', 'popmenu');
  const rename = el('button', 'popitem', '重命名');
  rename.type = 'button';
  rename.addEventListener('click', async () => { closeMenu(); await renameSession(session); });
  const taskEngine=workspaceState?.conversations.find(c=>c.id===session.id)?.engine || 'pi';
  rename.disabled=session.id===activeId ? !supports('rename') : taskEngine==='claude';if(rename.disabled)rename.title='此 Agent 不支持在 Web 重命名原生会话';
  const archived=workspaceState?.conversations.find(c=>c.id===session.id)?.archived || workspaceState?.legacyArchived?.includes(session.id);
  const del = el('button', 'popitem', workspaceState ? (archived ? '恢复对话' : '归档') : '删除');
  del.type = 'button';
  del.addEventListener('click', async () => {
    closeMenu();
    if(workspaceState) {
      try {await workspaceApi({action:archived ? 'restore' : 'archive',id:session.id});await loadWorkspace();if(!archived && activeId===session.id)newSession(false);} catch(e) {toast(e.message);}return;
    }
    await deleteSession(session);
  });
  if(archived && taskEngine==='pi') {
    const remove=el('button','popitem danger','永久删除…');remove.addEventListener('click',async()=> {
      closeMenu();const confirmation=await askModal({title:'永久删除归档对话',text:`将永久删除原生对话历史和本地目录（包括附件、搜索结果、图片及产物）：\n${workspaceState.conversations.find(c=>c.id===session.id)?.cwd || '旧对话历史；旧目录保留'}\nChat 本地文件没有 Git 备份。Work 未提交/未推送代码会阻止删除；远端分支、PR、仓库和旧全局数据保留。运行中的任务须先结束。输入 ID 确认：${session.id}`,input:'',okLabel:'永久删除',danger:true});
      if(confirmation!==session.id)return;
      try {await workspaceApi({action:'delete',id:session.id,confirmation,includeLocalFiles:true});await loadWorkspace();send({v:1,type:'list_sessions'});}catch(e){toast(e.message);}
    });menuNode.append(remove);
  }
  menuNode.append(rename, del);
  if(workspaceState?.projects.length){
    const label=el('label','sidebar-move-label','移至侧栏分组');
    const select=el('select','sidebar-move-select');select.setAttribute('aria-label','移至侧栏分组');
    const option=el('option','','未分组');option.value='';select.append(option);
    for(const p of workspaceState.projects){const o=el('option','',p.name);o.value=p.id;select.append(o);}
    const overrides=workspaceState.sidebar?.assignments;
    select.value=(overrides && Object.hasOwn(overrides,session.id)?overrides[session.id]:workspaceState.conversations.find(c=>c.id===session.id)?.projectId) || '';
    select.addEventListener('change',()=>{const projectId=select.value || null;closeMenu();void saveSidebar({action:'sidebar_move',id:session.id,projectId});});
    label.append(select);menuNode.append(label);
  }
  document.body.appendChild(menuNode);
  const rect = anchor.getBoundingClientRect();
  menuNode.style.top = rect.bottom + 4 + 'px';
  menuNode.style.left = Math.min(rect.left, window.innerWidth - 160) + 'px';
}
ui.brandBtn?.addEventListener('click', toggleBrandMenu);
$('#show-groups').addEventListener('click',()=>saveSidebar({action:'sidebar_display',showGroups:workspaceState?.sidebar?.showGroups===false}));
ui.themeToggle?.addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
ui.agentBtn?.addEventListener('click', toggleAgentMenu);
ui.agentRows.engine?.addEventListener('click', () => openAgentPane('engine'));
ui.agentRows.kind?.addEventListener('click', () => openAgentPane('kind'));
ui.agentRows.source?.addEventListener('click', () => openAgentPane('source'));
ui.agentRows.model?.addEventListener('click', () => openAgentPane('model'));
ui.agentRows.thinking?.addEventListener('click', () => openAgentPane('thinking'));
ui.agentRows.context?.addEventListener('click', () => openAgentPane('context'));
ui.agentMenu?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.stopPropagation(); closeAgentMenu(); ui.agentBtn.focus(); }
});
document.addEventListener('click', (event) => {
  if (menuNode && !menuNode.contains(event.target)) closeMenu();
  if (!event.target.closest('.brand-wrap')) closeBrandMenu();
  if (!event.target.closest('.agent-menu-wrap')) closeAgentMenu();
  if (!event.target.closest('.task-details-wrap')) closeTaskDetails();
  if (!event.target.closest('.review-scope-wrap')) closeDiffScopeMenu();
  if (!event.target.closest('.project-create-wrap')) closeProjectCreateMenu();
});
ui.taskDetailsBtn?.addEventListener('click', toggleTaskDetails);
ui.taskDetails?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.stopPropagation(); closeTaskDetails(); ui.taskDetailsBtn.focus(); }
});
// The strip's "Chat · 本地目录" label is a shortcut into the Agent menu's 类型 pane.
$('#strip-kind').addEventListener('click', (event) => {
  event.stopPropagation();
  if (ui.agentBtn.disabled) return;
  if (ui.agentMenu.classList.contains('hidden')) toggleAgentMenu();
  openAgentPane('kind');
  setTimeout(() => ui.agentPanes.kind.querySelector('[aria-checked="true"]')?.focus(), 0);
});

async function renameSession(session) {
  if(session.id===activeId ? !supports('rename') : (workspaceState?.conversations.find(c=>c.id===session.id)?.engine || 'pi')==='claude'){toast('此 Agent 不支持在 Web 重命名');return;}
  const name = await askModal({ title: '重命名对话', input: session.name || session.preview || '', okLabel: '保存' });
  if (name === null || name === '') return;
  send({ v: 1, type: 'rename_session', requestId: requestId('rename'), sessionId: session.id, name });
  toast('已重命名');
}
async function deleteSession(session) {
  const ok = await askModal({ title: '删除这个对话？', text: '会从 User VM 的会话存储中永久删除「' + sessionTitle(session) + '」，不可恢复。', okLabel: '删除', danger: true });
  if (!ok) return;
  send({ v: 1, type: 'delete_session', requestId: requestId('delete'), sessionId: session.id });
  if (session.id === activeId) newSession(false);
  toast('已删除');
}

function renderHeader() {
  const session = sessions.find((s) => s.id === activeId);
  const title = activeId ? sessionTitle(session) : '新对话';
  ui.title.textContent = title;
  ui.title.disabled = !activeId;
  ui.sessionMeta.textContent = activeId ? activeId.slice(0, 8) : '';

  const pending = attentionCount();
  document.title = (finishedWhileHidden ? '✅ ' : '') + (pending ? '(' + pending + ') ' : '') + (activeId && title !== '新对话' ? title + ' · ' : '') + 'PI Coffee';
  ui.topbarState.replaceChildren();if(streaming)ui.topbarState.append(el('span','dot busy'),document.createTextNode(engineName()+' 正在工作…'));

  renderStats();
}
function fmtTokens(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function renderUsage() {
  const badge = usageBadge(statsCache && statsCache.rateLimits);
  ui.usage.classList.toggle('hidden', !badge);
  if (!badge) return;
  ui.usage.textContent = badge.text;
  ui.usage.classList.toggle('warn', badge.level === 'warn');
  ui.usage.classList.toggle('danger', badge.level === 'danger');
  const l = statsCache.rateLimits;
  const lines = ['帐号用量（VM 上登录的那个 Codex 帐号，所有用户共用）'];
  if (l.fiveHour) lines.push('5 小时窗：已用 ' + Math.round(l.fiveHour.usedPercent) + '%' + (formatReset(l.fiveHour.resetsAt) ? '，' + formatReset(l.fiveHour.resetsAt) : ''));
  if (l.weekly) lines.push('每周窗：已用 ' + Math.round(l.weekly.usedPercent) + '%' + (formatReset(l.weekly.resetsAt) ? '，' + formatReset(l.weekly.resetsAt) : ''));
  if (l.plan) lines.push('套餐：' + l.plan);
  ui.usage.title = lines.join('\n');
}
const CONTEXT_CATEGORIES = [
  ['system','系统提示词'], ['tools','工具定义'], ['rules','项目规则'],
  ['skills','技能'], ['dynamic','MCP 与动态工具'], ['subagents','子代理定义'], ['conversation','对话'],
];

function renderStats() {
  renderUsage();
  if (!statsCache || !activeId) { ui.stats.classList.add('hidden'); hideStatsPop(); return; }
  const snapshot=statsCache.contextBreakdown;
  const valid=snapshot?.version===1 && snapshot.categories?.length===7 && CONTEXT_CATEGORIES.every(([id])=>snapshot.categories.some(c=>c.id===id && Number.isSafeInteger(c.tokens) && c.tokens>=0));
  const capacity=valid?snapshot.contextWindow:statsCache.contextUsage?.contextWindow;
  const nativeUsed=statsCache.contextUsage?.tokens;
  const used=valid?snapshot.categories.reduce((n,c)=>n+c.tokens,0):(Number.isFinite(nativeUsed)&&nativeUsed>=0?nativeUsed:null);
  const pct=used!==null && capacity>0?100*used/capacity:null;
  ui.stats.textContent=pct!==null?'上下文 '+Math.floor(pct)+'%':'上下文';
  ui.stats.classList.remove('hidden');ui.stats.classList.toggle('warn',pct!==null && pct>=75);
  ui.spPct.textContent=pct!==null?'已用 '+Math.floor(pct)+'%':'用量暂不可用';
  ui.spCapacity.textContent=`${used!==null?(valid?'~':'')+fmtTokens(used):'—'} / ${fmtTokens(capacity).replace(/\.0([KM])$/,'$1')} 词元`;
  ui.spCapacity.title=valid?`本地 o200k_base 估算 · ${snapshot.basis==='last_request'?'最近一次实际请求':'当前已加载上下文预览'} · ${snapshot.capturedAt}`:'原生引擎当前上下文用量；不使用累计账单量';
  ui.spBar.replaceChildren();ui.spContextLegend.replaceChildren();
  for(const [id,label] of CONTEXT_CATEGORIES){
    const value=valid?snapshot.categories.find(c=>c.id===id).tokens:null;
    const row=el('div','legend-row');row.append(el('span','dot-sq c-'+id),el('span','legend-label',label),el('span','legend-val',fmtTokens(value)));ui.spContextLegend.append(row);
    if(value>0 && capacity>0){const seg=el('span','seg c-'+id);seg.style.width=(value/Math.max(capacity,used)*100)+'%';seg.style.flexShrink='0';ui.spBar.append(seg);}
  }
  if(!valid&&used!==null&&capacity>0){const seg=el('span','seg c-conversation');seg.style.width=Math.min(100,used/capacity*100)+'%';seg.title='当前上下文总用量（未分类）';ui.spBar.append(seg);}
  const status=$('#sp-status');
  status.textContent=!valid?(engine==='codex'?'Codex 原生接口提供当前总用量，不提供分类统计；分类显示 —。':'分类统计暂不可用，请检查所属 VM 的 Agent 版本。'):snapshot.mediaOmitted?'~ 本地文本估算；图片、音频等媒体占用未计入。':'';
  status.classList.toggle('hidden',!status.textContent);
  ui.spBar.setAttribute('aria-valuetext',pct!==null?'已用 '+Math.floor(pct)+'%':'用量暂不可用');
  if(pct!==null)ui.spBar.setAttribute('aria-valuenow',String(Math.min(100,pct)));else ui.spBar.removeAttribute('aria-valuenow');
  ui.spCompact.textContent=engine==='pi' ? '交接压缩' : '压缩上下文';
  ui.spCompact.disabled=!opened || streaming || compacting || !supports('compact');
  ui.spCompact.classList.toggle('hidden',!supports('compact'));
}
function showStatsPop() {
  if (ui.stats.classList.contains('hidden') || ui.statsWrap.classList.contains('hidden')) return;
  if (!ui.statsPop.open) ui.statsPop.showModal();
  ui.stats.setAttribute('aria-expanded', 'true');
  send({ v: 1, type: 'get_stats' });
}
function hideStatsPop() {
  if (ui.statsPop.open) ui.statsPop.close();
  ui.stats.setAttribute('aria-expanded', 'false');
}
ui.stats.addEventListener('click', showStatsPop);
$('#stats-close').addEventListener('click', hideStatsPop);
ui.statsPop.addEventListener('cancel', event => { event.preventDefault(); hideStatsPop(); });
ui.statsPop.addEventListener('close', () => {
  ui.stats.setAttribute('aria-expanded', 'false');
  if (!ui.stats.classList.contains('hidden') && !ui.statsWrap.classList.contains('hidden')) ui.stats.focus();
});
ui.statsPop.addEventListener('click', event => {
  if(event.target !== ui.statsPop)return;
  const box=ui.statsPop.getBoundingClientRect();
  if(event.clientX<box.left || event.clientX>box.right || event.clientY<box.top || event.clientY>box.bottom)hideStatsPop();
});
ui.statsPop.addEventListener('keydown', event => { event.stopPropagation(); });
async function requestLocalCompaction() {
  if (!opened || compacting) return;
  if (streaming) { toast('请先停止当前任务，再压缩上下文。'); return; }
  const epoch=taskSelectionEpoch, sessionId=activeId, handoff=engine==='pi';
  hideStatsPop();
  const ok = await askModal(handoff
    ? {title:'交接压缩（实验性功能）',text:'交接压缩不保证避免上下文漂移，适合在多次系统自动压缩后重新聚焦当前项目。自动压缩仍使用 Pi 原生自动压缩。同一对话、历史和项目文件保留。',okLabel:'交接压缩'}
    : {title:'压缩上下文？',text:'使用当前 Agent 的原生压缩功能。',okLabel:'压缩'});
  if (!ok || epoch!==taskSelectionEpoch || sessionId!==activeId || !opened || streaming || compacting) return;
  send({ v: 1, type: 'compact', requestId: requestId('compact') });
  toast(handoff ? '正在交接压缩…' : '正在压缩上下文…');
}
function offerContextRecovery(message) {
  if (!isContextError(message)) return;
  const entry = pushNote('上下文过大。可压缩后继续；若仍过大，请缩短本次输入或检查模型窗口配置。');
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'btn small'; button.textContent = engine==='pi' ? '交接压缩' : '压缩上下文';
  const sessionId = activeId;
  button.addEventListener('click', () => { if (sessionId === activeId) void requestLocalCompaction(); });
  entry.node.append(button);
}
ui.spCompact.addEventListener('click', requestLocalCompaction);
ui.title.addEventListener('click', () => {
  const session = sessions.find((s) => s.id === activeId);
  if (session) renameSession(session);
});

// ---------- connection ----------
function setConnection(text, kind) {
  ui.status.textContent = text;
  ui.dot.className = 'dot' + (kind ? ' ' + kind : '');
  connected = kind === 'ready' || kind === 'busy';
  // The footer dot is too subtle: the center column must also announce a lost link.
  ui.connBanner.classList.toggle('hidden', connected);
  if (!connected) ui.connBanner.textContent = text || '连接已断开，正在自动重连…';
  refreshComposer();
}
function setStreaming(active) {
  if (streaming === active) return;
  streaming = active;
  if (active) {
    ++changeCardEpoch;
    lastChangeCardSignature='';changeCardChecked='';
    ui.thread.querySelectorAll('.changes-card').forEach(card=>card.remove());
  }
  if (!active) {
    currentAssistant = undefined;
    showThinking(false);
    if (currentActivity) { updateActivity(currentActivity, activityCount, false); currentActivity.open = false; }
    currentActivity = undefined;
    addRegenerateButton();
  } else {
    ui.thread.querySelectorAll('.msg-tool.regen').forEach((b) => b.remove());
  }
  refreshComposer();
  renderHeader();
  renderSessionList();
}
function refreshComposer() {
  const pendingNewTaskFiles = !opened && filesAwaitingTransfer.length > 0;
  const activeUploadsBusy = uploads.some((u) => u.state === 'uploading' || u.state === 'finishing') || (opened && filesAwaitingTransfer.length > 0);
  const hasText = ui.prompt.value.trim().length > 0 || draftFiles.length>0 || attachments.length > 0 || completedUploads().length > 0 || pendingNewTaskFiles;
  ui.send.disabled = compacting || !connected || !hasText || activeUploadsBusy || !!modelPending || !!contextPending || (streaming && !supports("steer") && !supports("followUp"));
  ui.model.disabled = ui.modelSource.disabled = ui.thinking.disabled = compacting || modelControlsLocked();
  renderProjectContext();
  renderAgentTrigger();
  ui.stop.classList.toggle('hidden', !(connected && (streaming || compacting)));
  ui.modeWrap.classList.toggle('hidden', !(connected && !compacting && streaming && (supports("steer") || supports("followUp"))));
  ui.pluginsBtn.classList.toggle("hidden",!supports("extensions"));ui.statsWrap.classList.toggle("hidden",!supports("stats"));
  ui.send.title = uploadsBusy() ? '等待文件传输完成' : streaming && !supports('steer') && !supports('followUp') ? '等待当前轮次结束，或先停止' : streaming ? (ui.mode.value === 'steer' ? '插话：在当前工具调用后打断' : '排队：等这轮结束后发送') : '发送';
  ui.hint.textContent = streaming && !supports('steer') && !supports('followUp') ? '运行中 · 可停止当前轮次' : streaming ? '运行中 · Enter ' + (ui.mode.value === 'steer' ? '插话' : '排队') : '';
  if(compacting)ui.hint.textContent=engine==='pi' ? '正在交接压缩…' : '正在压缩上下文…';
  ui.hint.classList.toggle('hidden', !streaming && !compacting);
  ui.spCompact.disabled=!opened || streaming || compacting || !supports('compact');
  if (connected) {
    ui.status.textContent = streaming ? engineName()+' 正在工作…' : '已连接';
    ui.dot.className = 'dot ' + (streaming ? 'busy' : 'ready');
  }
}


// Who am I? The Web Server answers from the Gitea cookie (ADR-0004). Without a
// valid login the shell is useless, so go to the login page instead of
// retrying a WebSocket that will only be refused.
async function whoAmI() {
  try {
    const response = await fetch('/auth/me', { cache: 'no-store' });
    if (response.status === 401) {
      const body = await response.json().catch(() => ({}));
      location.href = body?.loginUrl || '/login';
      return false;
    }
    if (!response.ok) return true;
    const info = await response.json();
    currentUser = typeof info.user==='string' ? info.user : info.user?.id ? 'gitea-'+info.user.id : null;
    const key = currentUser ? ACTIVE_KEY_BASE + ':' + currentUser : ACTIVE_KEY_BASE;
    if (key !== ACTIVE_KEY || activeId === null) { ACTIVE_KEY = key; activeId = sessionStorage.getItem(ACTIVE_KEY) || localStorage.getItem(ACTIVE_KEY) || null; }
    ui.userBtn.classList.toggle('hidden', !info.auth);
    ui.userName.textContent = info.user?.login || currentUser || '';
    ui.userBtn.disabled = !info.auth;
    return true;
  } catch {
    return true;   // the Web Server may be restarting; let the socket retry decide
  }
}
ui.userBtn.addEventListener('click', async () => {
  if (!currentUser) return;
  if (!confirm('退出 PI Coffee 的登录？User VM 里正在运行的任务不会被打断。')) return;
  const identityLogin = String(currentUser).startsWith('gitea-');
  sessionStorage.removeItem(ACTIVE_KEY);
  localStorage.removeItem(ACTIVE_KEY);
  await fetch('/auth/logout', { method: 'POST' }).catch(() => undefined);
  location.href = identityLogin ? '/auth/login' : '/login';
});
function renderProjectContext() {
  if (!ui.projectSelect || !ui.startBranch) return;
  refreshHeroChoices();
  const conversation = workspaceState?.conversations.find((c) => c.id === activeId);
  const activeProject = workspaceState?.projects.find((p) => p.id === conversation?.projectId);
  let projectLabel=activeProject?.name;try{if(activeProject?.webUrl)projectLabel=new URL(activeProject.webUrl).pathname.split('/').filter(Boolean).slice(-2).join('/');}catch{}
  const lockedToConversation = Boolean(conversation);
  if (conversation) {
    if ([...ui.projectSelect.options].some((option) => option.value === conversation.projectId)) ui.projectSelect.value = conversation.projectId;
    ui.startBranch.value = conversation.branch || '';
  } else if (!ui.startBranch.value) {
    const project = workspaceState?.projects.find((p) => p.id === ui.projectSelect.value);
    if (project?.branch) ui.startBranch.placeholder = project.branch;
  }
  const agentSelect=$("#task-engine");agentSelect.disabled=lockedToConversation || !!pendingOpenId;
  if(conversation)agentSelect.value=conversation.engine || "pi";
  ui.projectSelect.disabled = lockedToConversation;
  ui.startBranch.disabled = lockedToConversation;
  const kind=$('#task-kind');kind.disabled=lockedToConversation;
  if(conversation)kind.value=conversation.workspaceKind==='chat'?'chat':'project';
  if(!conversation && kind.value==='chat')agentSelect.value='pi';
  agentSelect.disabled=lockedToConversation || !!pendingOpenId || kind.value==='chat';
  for(const option of agentSelect.options){
    const found=engineAvailability.find(e=>e.id===option.value);
    const unavailable=found ? !found.available : option.value!=='pi';
    const workOnly=!lockedToConversation && kind.value==='chat' && option.value!=='pi';
    option.disabled=unavailable || workOnly;
    option.textContent=engineName(option.value)+(workOnly?' · 仅 Work':unavailable?' · '+(found?.reason || 'Host 未启用'):'');
  }
  for(const option of kind.options)option.textContent=option.value==='chat'?(lockedToConversation?'Chat':'Chat · 本地目录'):(lockedToConversation?'Work':'Work · '+workForgeLabel());
  const projectWorkspace=kind.value==='project',forges=forgeCapabilities();
  const createButton=$('#project-create'),showCreate=projectWorkspace && !lockedToConversation;
  createButton.classList.toggle('hidden',!showCreate);createButton.closest('.project-create-wrap').classList.toggle('hidden',!showCreate);
  createButton.disabled=projectCreating || !!pendingOpenId;
  createButton.textContent=projectCreating?'创建中…':'＋ 新建项目';
  createButton.setAttribute('aria-label',forges.github ? (forges.gitea ? '新建 Gitea 项目或添加 GitHub 仓库' : '添加 GitHub 仓库') : '新建 Gitea 项目');
  if(forges.github && forges.gitea)createButton.setAttribute('aria-haspopup','menu');else createButton.removeAttribute('aria-haspopup');
  if(!showCreate || createButton.disabled)closeProjectCreateMenu();
  ui.projectSelect.closest('label').classList.toggle('hidden',!projectWorkspace || lockedToConversation);
  ui.startBranch.closest('label').classList.toggle('hidden',!projectWorkspace || lockedToConversation);
  // New tasks are created by the first message; only a pre-directory legacy task keeps an explicit button.
  const legacyTask=!lockedToConversation && Boolean(activeId);
  $('#create-task').classList.toggle('hidden',!legacyTask);
  $('#create-task').textContent=legacyTask?'为旧任务创建目录':'创建任务';
  $('#project-controls').classList.toggle('task-bound',lockedToConversation);
  const stripKind=$('#strip-kind');
  stripKind.classList.toggle('hidden',projectWorkspace);
  stripKind.disabled=lockedToConversation || !!pendingOpenId;
  stripKind.title=lockedToConversation?'Chat 任务使用本地目录，没有 Git 仓库':'任务类型：点击在 Agent 菜单中切换';
  const shownProject=activeProject || workspaceState?.projects.find(p=>p.id===ui.projectSelect.value);
  const repoIcon=$('.strip-repo-icon');repoIcon.classList.toggle('hidden',!projectWorkspace);
  repoIcon.dataset.forge=projectForge(shownProject);repoIcon.title=`${forgeName(shownProject)} 仓库`;
  const projectLink=$('#task-project');
  const showProject=lockedToConversation && projectWorkspace && Boolean(projectLabel);
  projectLink.classList.toggle('hidden',!showProject);
  projectLink.textContent=projectLabel || '';projectLink.title=activeProject?.webUrl ? `在 ${forgeName(activeProject)} 打开 ${projectLabel}` : (projectLabel || '');
  if(activeProject?.webUrl)projectLink.href=activeProject.webUrl;else projectLink.removeAttribute('href');
  const taskBranch=lockedToConversation && projectWorkspace ? (workspaceSync?.branch || conversation.branch || '') : '';
  $('#task-branch-field').classList.toggle('hidden',!taskBranch);
  $('#task-branch').textContent=taskBranch;$('#task-branch').title=taskBranch ? `任务分支 ${taskBranch}` : '';
  $('.context-sep').classList.toggle('hidden',!projectWorkspace || (lockedToConversation && !(showProject && taskBranch)));
  renderStripActions(conversation);
  const detailsEmpty=$('#task-details-empty');detailsEmpty.classList.toggle('hidden',lockedToConversation);
  detailsEmpty.textContent=legacyTask?'这个旧任务还没有独立目录；可用输入框下方的「为旧任务创建目录」创建。':'发送第一条消息后创建任务目录。';
  const context=$('#workspace-context');context.replaceChildren();
  if(conversation){
    const vm=conversation.vmId || workspaceState.vmId || '未知';
    const state=conversation.creationState==='failed'?'创建失败':conversation.creationState==='creating'?'创建中':'就绪';
    const branch=conversation.workspaceKind==='chat'?'本地文件':workspaceSync?.branch || conversation.branch || '正在核查…';
    const identity=el('span','workspace-identity',`VM ${vm} · ${branch} · ${state}`);
    identity.title=identity.textContent;
    const details=el('button','context-action','详情');details.type='button';
    details.onclick=()=>void askModal({title:'任务详情',text:[
      `任务：${conversation.id}`,`Agent：${engineName(conversation.engine || 'pi')}`,`VM：${vm}`,`项目：${projectLabel || '无项目'}`,
      `本地路径：${conversation.cwd}`,`当前分支：${branch}`,`状态：${state}`,
      `最后核查：${workspaceSync?.lastRemoteAt || '尚未核查远端'}`,conversation.creationError
    ].filter(Boolean).join('\n'),okLabel:'关闭'});
    const path=el('code','workspace-path',conversation.cwd);path.title=conversation.cwd;
    const copy=el('button','context-action','复制路径');copy.type='button';
    copy.onclick=async()=>{try{await navigator.clipboard.writeText(conversation.cwd);toast('已复制完整路径');}catch{const selection=window.getSelection();const range=document.createRange();range.selectNodeContents(path);selection.removeAllRanges();selection.addRange(range);toast('已选中完整路径，可复制');}};
    context.append(identity,details,path,copy);
    if(conversation.creationError){identity.textContent=`VM ${vm} · 创建失败：${conversation.creationError}`;identity.title=identity.textContent;identity.classList.add('workspace-error');}

  }
  ui.projectSelect.title = activeProject ? activeProject.name : forges.github ? 'Gitea / GitHub 仓库' : 'Gitea 仓库';
  ui.projectSelect.setAttribute('aria-label', forges.github ? 'Gitea / GitHub 仓库' : 'Gitea 仓库');
  if (![ADD_GITHUB,ADD_GITEA].includes(ui.projectSelect.value)) lastProjectValue = ui.projectSelect.value;
  ui.startBranch.title = conversation ? `当前对话固定使用 ${conversation.branch}` : '新对话起始分支';
  ui.projectSelect.classList.toggle('locked', lockedToConversation);
  ui.startBranch.classList.toggle('locked', lockedToConversation);
}


function connect() {
  clearTimeout(reconnectTimer);
  whoAmI().then((ok) => { if (ok) connectSocket(); });
}
function connectSocket() {
  clearTimeout(reconnectTimer);
  queuedRequests.clear();
  if (socket) { socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null; try { socket.close(); } catch { /* ignore */ } }
  opened = false;historyReady=false;
  pendingOpenId = null;
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(scheme + '//' + location.host + '/ws');
  socket = ws;
  setConnection('连接中…');
  ws.onopen = () => {
    setConnection('已连接', 'ready');
    send({ v: 1, type: 'list_sessions' });
    loadDraftModels();resetSlashCommands();loadSlashCommands();renderSlash();
    if (activeId) openSession(activeId).catch(e=>toast(e.message));
    else if(prepareNew){prepareNew=false;openSession(null).catch(e=>toast(e.message));}
  };
  ws.onmessage = (event) => {
    if(socket!==ws)return;
    let frame;
    try { frame = JSON.parse(event.data); } catch { return; }
    handleFrame(frame, ws);
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    if(pendingDelivery){uncertainTask=activeId;pendingDelivery=null;}
    queuedRequests.clear();
    modelPending=null;
    opened = false;
    workspaceSync={...workspaceSync,state:'unknown',error:'VM 连接断开；显示上次已知值'};renderSyncState();renderProjectContext();
    setConnection('连接断开，重连中…（Host 上的任务不会被打断）', 'error');
    reconnectTimer = setTimeout(connect, 1200);
  };
  ws.onerror = () => { if (socket === ws) setConnection('连接错误', 'error'); };
}
function restoreQueuedPrompt() {
  if (queuedPrompt === null) return;
  ui.prompt.value = queuedPrompt.text;
  attachments = queuedPrompt.images || [];
  queuedPrompt = null;
  renderAttachments();
  autoGrow();
  if(!opened){setStreaming(false);showThinking(false);}
}
async function openSession(id) {
  if(!connected){restoreQueuedPrompt();toast('等待 VM 连接就绪');return;}
  if (pendingOpenId) return;            // an open is already in flight on this socket
  if (opened) { connect(); return; }    // one socket owns one Session: start over
  if(!id && !workspaceState){await loadWorkspace();if(!workspaceState){restoreQueuedPrompt();toast('工作区服务尚未就绪');return;}}
  const existing=workspaceState?.conversations.find(c=>c.id===id);
  if((!id && workspaceState) || existing?.creationState==='failed' || existing?.creationState==='creating') {
    const workspaceKind=existing?.workspaceKind || $('#task-kind').value;
    const projectId=existing?.projectId || ui.projectSelect.value;
    if(workspaceKind==='project' && !projectId) {restoreQueuedPrompt();toast(forgeCapabilities().github ? '请先选择 Gitea 或 GitHub 仓库' : '请先选择 Gitea 项目');return;}
    const selectedEngine=existing?.engine || $("#task-engine").value;
    const signature=JSON.stringify([selectedEngine,workspaceKind,projectId,existing?.startBranch || ui.startBranch.value.trim()]);
    if(!creationRequest || creationRequest.signature!==signature)creationRequest={signature,id:existing?.id || [...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join('')};
    saveCreation();pendingOpenId='creating';refreshComposer();$('#create-task').disabled=true;$('#create-task').textContent='创建中…';
    try {
      const c=await workspaceApi({action:'conversation',id:creationRequest.id,workspaceKind,engine:selectedEngine,...(workspaceKind==='project'?{projectId,branch:existing?.startBranch || ui.startBranch.value.trim() || undefined}:{})});
      id=c.id;activeId=id;contextToApply=draftContextPreset;rememberTask(id);creationRequest=null;saveCreation();workspaceSync=null;await loadWorkspace();
    }catch(e){
      pendingOpenId=null;toast(e.message);
      // The first message started this creation: give the draft back instead of a stuck "running" state.
      restoreQueuedPrompt();
      await loadWorkspace();return;
    }
    finally{refreshComposer();$('#create-task').disabled=false;$('#create-task').textContent='创建任务 / 重试';}
  }
  pendingOpenId = id || 'new';
  const frame = { v: 1, type: 'open', nativeProtocol:1 };
  if (id) frame.sessionId = id;
  if (!send(frame)) { pendingOpenId = null; restoreQueuedPrompt(); }
}
function afterOpened() {
  refreshComposer();
  if(supports('models') && !modelPending)send({ v: 1, type: 'get_models' });
  if(supports('commands')){commandState='loading';send({ v: 1, type: 'get_commands' });}
  if(supports('stats'))send({ v: 1, type: 'get_stats' });
  if (pluginsWaiting && supports('extensions')) send({ v: 1, type: 'get_extensions' });
}

function handleFrame(frame, ws) {
  switch (frame.type) {
    case 'sessions':
      sessions = Array.isArray(frame.sessions) ? frame.sessions : [];
      renderSessionList();
      renderHeader();
      return;
    case 'opened':
      if(pendingOpenId && pendingOpenId!=="new" && frame.sessionId!==pendingOpenId)return;
      engine=frame.engine || workspaceState?.conversations.find(c=>c.id===frame.sessionId)?.engine || "pi";capabilities=frame.capabilities || null;models=null;resetSlashCommands();skillReloadScope=null;
      const sameTransfer=(transfer?.sessionId || transfer?.scope)===frame.sessionId;
      opened = true;
      pendingOpenId = null;
      activeId = frame.sessionId;
      queuedRequests.clear();
      rememberTask(activeId);
      statsCache = null;
      resetThread();
      clearExtensionUi();
      if(!sameTransfer)resetTransfers();
      void loadWorkspace();
      workspaceChanges=null;selectedChangedPath=null;lastChangeCardSignature='';changeCardChecked='';if(workspaceDetailOpen)closeWorkspaceDetail();renderWorkspaceSummary();renderWorkspaceList();renderProjectContext();
      streaming = false;
  compacting = false;
      compacting=Boolean(frame.state?.isCompacting);
      setStreaming(Boolean(frame.state && frame.state.isStreaming));
      refreshComposer();
      renderHeader();
      renderSessionList();
      historyReady=false;catalogRequest=null;
      if(draftModel && ['pi','codex'].includes(engine)){const chosen=draftModel;draftModel=null;chooseModel(chosen.provider,chosen.id);}
      afterOpened();
      return;
    case 'history':
      if (frame.sessionId !== activeId) return;
      renderHistory(frame);
      if(uncertainTask===activeId)pushNote("上一条请求的交付状态尚不确定，不会自动重发。请先核查历史和运行状态，再决定是否重试。",true);
      historyReady=true;flushFirstPrompt();
      return;
    case 'model_catalog':
      if(!draftModelEngine() || frame.requestId!==catalogRequest || frame.engine!==draftModelEngine())return;
      catalogRequest=null;models={...frame,thinkingLevels:[],thinkingLevel:''};
      if(draftModel && models.models.some(m=>m.provider===draftModel.provider && m.id===draftModel.id))models.current=draftModel;
      draftModel=models.current;
      renderModels();refreshComposer();return;
    case 'models':
      if(frame.sessionId && frame.sessionId!==activeId)return;
      models = frame;modelPending=null;
      if(contextToApply){const wanted=contextToApply;contextToApply=null;if(frame.context&&wanted!==frame.context.preset){contextPending=requestId('context');send({v:1,type:'set_context',requestId:contextPending,preset:wanted});}else if(wanted==='maximum'&&!frame.context){toast('Host 尚不支持上下文设置，请稍后刷新');restoreQueuedPrompt();}}
      refreshComposer();
      renderModels();flushFirstPrompt();
      return;
    case 'command_catalog':
      if(opened||activeId||frame.engine!==$('#task-engine').value||frame.requestId!==commandRequest)return;
      commandRequest=null;commandState='ready';commands=Array.isArray(frame.commands)?frame.commands:[];renderSlash();return;
    case 'commands':
      commandState='ready';
      commands = Array.isArray(frame.commands) ? frame.commands : [];
      renderSlash();
      return;
    case 'stats':
      if (frame.sessionId === activeId) { statsCache = frame.stats; renderStats(); }
      return;
    case 'extensions':
      if (frame.sessionId !== activeId) return;
      renderPlugins(Array.isArray(frame.extensions) ? frame.extensions : []);
      return;
    case 'transfer':
      setTimeout(()=>{if(workspaceState) {renderWorkspaceList();void refreshWorkspaceChanges(false).catch(()=>undefined);}},0);
      if (frame.sessionId !== activeId) return;
      transfer = normalizeTransferGrant(frame, frame.sessionId);
      refreshToolDownloadLinks();
      renderUploadLogCard(); // relink rows with the fresh token
      if (filesAwaitingTransfer.length) { const queued = filesAwaitingTransfer; filesAwaitingTransfer = []; void uploadFiles(queued); }
      return;
    case 'ack':
      // Host treats queued input as a new prompt if the previous run already ended.
      if (frame.operation === 'prompt') queuedRequests.delete(frame.requestId);
      if (frame.operation === 'steer' || frame.operation === 'follow_up') toast(frame.operation === 'steer' ? '已插话' : '已排队');
      if (frame.operation === 'set_model' || frame.operation === 'set_thinking') send({ v: 1, type: 'get_models' });
      if(frame.operation==='set_context'&&frame.requestId===contextPending){contextPending=null;send({v:1,type:'get_stats'});}
      if (frame.operation === 'compact') send({ v: 1, type: 'get_stats' });
      return;
    case 'resync_required':
      pushNote('正在运行的这一段输出有部分未能补放；已完成的消息以上方历史为准。');
      return;
    case 'event':
      if(frame.sessionId!==activeId)return;
      if(engine!=="pi" && frame.cursor){if(frame.cursor<=nativeCursor && frame.event?.type!=="native_request")return;nativeCursor=Math.max(nativeCursor,frame.cursor);}
      handleEvent(frame.event || {});
      return;
    case 'error':
      if(contextPending&&frame.requestId===contextPending){contextPending=null;contextToApply=null;restoreQueuedPrompt();toast('上下文设置未生效：'+frame.message);refreshComposer();return;} {
      if(commandRequest&&frame.requestId===commandRequest){commandRequest=null;commandState='error';commandError='读取命令失败：'+frame.message;renderSlash();return;}
      const rejectedQueuedInput = queuedRequests.delete(frame.requestId);
      if (pendingDelivery === frame.requestId) pendingDelivery = null;
      if(modelPending && frame.requestId===modelPending){modelPending=null;renderModels();refreshComposer();}
      pushNote('错误（' + frame.code + '）：' + frame.message, true);
      if (!rejectedQueuedInput) setStreaming(frame.code === 'busy');
      if (!opened || frame.code === 'not_open' || frame.code === 'already_open') pendingOpenId = null;
      if (queuedPrompt !== null && frame.code !== 'busy') { ui.prompt.value = queuedPrompt.text; attachments = queuedPrompt.images || []; renderAttachments(); queuedPrompt = null; autoGrow(); refreshComposer(); }
      if (frame.fatal) ws.close();
      return;
    }
    default:
      return;
  }
}

function handleEvent(event) {
  const type = event.type;

  if (type === 'agent_start') { setStreaming(true); showThinking(true); currentAssistant = undefined; retryNote = undefined; return; }
  if (type === 'tool_execution_update') {
    // Live output of a running command: refresh the card at most once per frame.
    const entry = event.toolCallId && openTools.get(event.toolCallId);
    if (!entry || entry.done) return;
    entry.result = toolResultText(event.partialResult);
    if (!pendingToolFills.size) requestAnimationFrame(flushToolFills);
    pendingToolFills.add(entry);
    return;
  }
  if (type === 'turn_diff') { scheduleTurnDiffRefresh(); return; }   // Codex edited a file: refresh an open 最近一轮
  if(type==='run_started'){setStreaming(true);showThinking(true);return;}
  if(type==='message_delta' || type==='message_completed'){
    showThinking(false);let entry=nativeItems.get(event.id);
    if(!entry){entry=pushAssistant('');nativeItems.set(event.id,entry);}
    entry.text=type==='message_completed'?event.text:entry.text+(event.delta||'');updateAssistant(entry.node,entry.text);return;
  }
  if(type==='tool_update'){
    showThinking(false);let entry=nativeItems.get(event.id);
    if(!entry){entry=pushTool({name:event.name||'Tool',args:event.args||{},result:'',done:false});nativeItems.set(event.id,entry);}
    if(event.name)entry.name=event.name;if(event.args)entry.args=event.args;if(event.result!==undefined)entry.result=event.result;
    entry.done=event.status!=='inProgress';entry.error=Boolean(event.isError);fillToolCard(entry.node,entry);return;
  }
  if(type==='native_request'){handleExtensionUi(event);return;}
  if(type==='background_state'){ui.status.textContent=event.known?(event.active?`后台任务：${event.active}`:'后台任务已结束'):'后台任务状态未知';return;}
  if(type==='run_completed'){
    queuedRequests.clear();
    pendingDelivery=null;uncertainTask=null;setStreaming(false);notifyFinished();clearExtensionUi();
    if(supports('models'))send({v:1,type:'get_models'});
    if(supports('stats'))send({v:1,type:'get_stats'});
    if(event.status!=='completed')pushNote(event.message || (event.status==='interrupted'?'当前轮次已停止':'本轮运行失败，请检查保存的结果'),event.status!=='interrupted');
    void refreshWorkspaceChanges(false).then(()=>maybeRenderChangesCard(true)).catch(()=>undefined);
    cancelTurnDiffRefresh();
    if($('#diff-dialog').open)void loadDiff(null,{preserve:true});
    return;
  }


  const delta = event.assistantMessageEvent;
  if (delta && delta.type === 'thinking_delta') { showThinking(true); return; }
  if (delta && delta.type === 'text_delta') {
    showThinking(false);
    if (!currentAssistant) currentAssistant = pushAssistant('');
    currentAssistant.text += delta.delta || '';
    scheduleAssistantRender();
    return;
  }
  if (type === 'tool_execution_start') {
    showThinking(false);
    currentAssistant = undefined;
    const entry = pushTool({ name: event.toolName, args: event.args, result: '', done: false, error: false });
    if (event.toolCallId) openTools.set(event.toolCallId, entry);
    lastTool = entry;
    return;
  }
  if (type === 'tool_execution_end') {
    const entry = (event.toolCallId && openTools.get(event.toolCallId)) || lastTool;
    if (entry) {
      entry.done = true;
      entry.error = Boolean(event.isError);
      entry.result = toolResultText(event.result);
      entry.details = toolResultDetails(event.result);
      fillToolCard(entry.node, entry);
      if (event.toolCallId) openTools.delete(event.toolCallId);
    }
    if (currentActivity) updateActivity(currentActivity, activityCount, openTools.size > 0);
    showThinking(true);
    return;
  }
  if (type === 'queue_update') { renderQueue(event); return; }
  if (type === 'extension_ui_request') { handleExtensionUi(event); return; }
  if (type === 'transfer_progress' || type === 'transfer_complete' || type === 'transfer_failed') { handleTransferEvent(event); return; }
  if (type === 'message_end' && event.message && event.message.stopReason === 'error') { pushNote('模型调用失败：' + (event.message.errorMessage || '未知错误'), true); offerContextRecovery(event.message.errorMessage); return; }
  if (type === 'message_end' && event.message && event.message.role === 'custom' && event.message.display === true) {
    const text = customMessageText(event.message.content);
    if (text.trim()) { currentAssistant = undefined; showThinking(false); pushNote(text.slice(0, 8000)); }
    return;
  }

  if (type === 'auto_retry_start') {
    // One note per turn, updated in place: Codex can retry many times in a row.
    const text = '上游暂时不可用，正在重试（' + event.attempt + '/' + event.maxAttempts + '）…';
    if (retryNote && retryNote.node.isConnected) { retryNote.text = text; retryNote.node.textContent = text; } else retryNote = pushNote(text);
    return;
  }
  if(type==='context_operation'){compacting=event.active===true;refreshComposer();if(!compacting && event.success===false)pushNote(event.message || '压缩未完成，原对话保留。',true);if(!compacting && event.success===true)pushNote(engine==='pi' ? '交接压缩完成，已保留原对话和历史。' : '上下文压缩完成。');return;}
  if (type === 'compaction_end') { if(compacting)return; const notice = compactionNotice(event); pushNote(notice.text, notice.failure); send({ v: 1, type: 'get_stats' }); return; }

  if (type === 'agent_settled') {
    queuedRequests.clear();
    pendingDelivery=null;uncertainTask=null;
    setStreaming(false);
    notifyFinished();
    for (const entry of openTools.values()) { entry.done = true; fillToolCard(entry.node, entry); }
    openTools.clear();
    renderQueue({ steering: [], followUp: [] });
    // Any dialog still open was resolved by Pi (timeout/default); drop it.
    if (uiCurrent || uiQueue.length) { uiQueue.length = 0; closeUiDialog(); }
    send({ v: 1, type: 'get_stats' });
    void refreshWorkspaceChanges(false).then(() => maybeRenderChangesCard(true)).catch(() => undefined);
    cancelTurnDiffRefresh();
    if ($('#diff-dialog').open) void loadDiff(null, { preserve: true });
  }
}
function flushToolFills() {
  for (const entry of pendingToolFills) {
    const wasScrolled = nearBottom();
    fillToolCard(entry.node, entry);
    if (!entry.node.open && !entry.node.dataset.userToggled) entry.node.open = true;   // show output as it arrives
    const out = entry.node.querySelector('.tool-out');
    if (out) out.scrollTop = out.scrollHeight;
    if (wasScrolled) scrollToEnd();
  }
  pendingToolFills.clear();
}
ui.thread.addEventListener('toggle', (event) => { if (event.target.classList?.contains('tool')) event.target.dataset.userToggled = '1'; }, true);

// ---------- finished-while-away notification ----------
function notifyFinished() {
  if (!document.hidden) return;
  finishedWhileHidden = true;
  renderHeader();
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const session = sessions.find((s) => s.id === activeId);
    try {
      const n = new Notification('PI Coffee · 这一轮完成了', { body: session ? sessionTitle(session) : '对话', tag: 'pi-coffee-' + activeId });
      n.onclick = () => { window.focus(); n.close(); };
    } catch { /* notifications unavailable */ }
  }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && finishedWhileHidden) { finishedWhileHidden = false; renderHeader(); }
  if (!document.hidden && workspaceState) void loadWorkspace();
});
function requestNotifyPermission() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
  Notification.requestPermission().catch(() => undefined);
}

function customMessageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((p) => p && p.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('\n');
}

// ---------- extension UI (Pi ctx.ui.* over RPC) ----------
const extStatuses = new Map();   // statusKey -> text
const extWidgets = new Map();    // widgetKey -> { lines, placement }
const uiQueue = [];              // pending dialog requests, shown one at a time
const uiSeen = new Set();        // request ids already shown or answered
let uiCurrent = null;

function handleExtensionUi(event) {
  switch (event.method) {
    case 'notify':
      pushNote(String(event.message || ''), event.notifyType === 'error');
      offerContextRecovery(event.message);
      return;
    case 'setStatus':
      if (event.statusText === undefined || event.statusText === null || event.statusText === '') extStatuses.delete(event.statusKey);
      else extStatuses.set(event.statusKey, String(event.statusText));
      renderExtStatus();
      return;
    case 'setWidget':
      if (!Array.isArray(event.widgetLines) || event.widgetLines.length === 0) extWidgets.delete(event.widgetKey);
      else extWidgets.set(event.widgetKey, { lines: event.widgetLines.map(String), placement: event.widgetPlacement || 'aboveEditor' });
      renderWidgets();
      return;
    case 'setTitle':
      // Pi means the terminal title; here it is informational only.
      return;
    case 'set_editor_text':
      ui.prompt.value = String(event.text || '');
      autoGrow();
      refreshComposer();
      return;
    case 'select':
    case 'confirm':
    case 'input':
    case 'editor':
      if (!event.id || uiSeen.has(event.id)) return;
      uiSeen.add(event.id);
      uiQueue.push(event);
      pushNote((event.type==='native_request'?'Agent 请求你的输入：':'扩展请求你的输入：') + (event.title || event.method));
      showNextUiDialog();
      return;
    default:
      return;
  }
}

function renderExtStatus() {
  ui.extStatus.innerHTML = '';
  for (const [key, text] of extStatuses) {
    const chip = el('span', 'ext-chip', text);
    chip.title = key;
    ui.extStatus.appendChild(chip);
  }
}
function renderWidgets() {
  ui.widgets.innerHTML = '';
  ui.widgets.classList.toggle('hidden', extWidgets.size === 0);
  for (const [key, widget] of extWidgets) {
    const box = el('pre', 'widget');
    box.title = key;
    box.textContent = widget.lines.join('\n');
    ui.widgets.appendChild(box);
  }
}
function clearExtensionUi() {
  extStatuses.clear();
  extWidgets.clear();
  uiQueue.length = 0;
  uiSeen.clear();
  closeUiDialog();
  renderExtStatus();
  renderWidgets();
}

function showNextUiDialog() {
  if (uiCurrent || uiQueue.length === 0) return;
  uiCurrent = uiQueue.shift();
  const req = uiCurrent;
  ui.uiTitle.textContent = req.title || ({ select: '请选择', confirm: '请确认', input: '请输入', editor: '请编辑' })[req.method];
  ui.uiText.textContent = req.message || '';
  ui.uiText.classList.toggle('hidden', !req.message);
  ui.uiOptions.classList.toggle('hidden', req.method !== 'select');
  ui.uiInput.classList.toggle('hidden', req.method !== 'input');
  ui.uiEditor.classList.toggle('hidden', req.method !== 'editor');
  ui.uiNo.classList.toggle('hidden', req.method !== 'confirm');
  ui.uiOk.classList.toggle('hidden', req.method === 'select');
  ui.uiOk.textContent = req.method === 'confirm' ? '是' : '确定';
  ui.uiMeta.textContent = (req.timeout ? `超时 ${Math.round(req.timeout / 1000)} 秒后按默认处理 · ` : '') + (uiQueue.length ? `还有 ${uiQueue.length} 个请求排队` : '');
  ui.uiOptions.innerHTML = '';
  if (req.method === 'select') {
    (req.options || []).forEach((option, index) => {
      const button = el('button', 'ui-option', String(option));
      button.type = 'button';
      button.setAttribute('role', 'option');
      button.addEventListener('click', () => answerUi({ value: String(option) }));
      if (index === 0) setTimeout(() => button.focus(), 0);
      ui.uiOptions.appendChild(button);
    });
  }
  if (req.method === 'input') { ui.uiInput.type=req.secret?'password':'text'; ui.uiInput.value = ''; ui.uiInput.placeholder = req.placeholder || ''; setTimeout(() => ui.uiInput.focus(), 0); }
  if (req.method === 'editor') { ui.uiEditor.value = req.prefill || ''; setTimeout(() => ui.uiEditor.focus(), 0); }
  if (req.method === 'confirm') setTimeout(() => ui.uiOk.focus(), 0);
  ui.uiModal.classList.remove('hidden');
}
function answerUi(answer) {
  if (!uiCurrent) return;
  const id = uiCurrent.id;
  send({ v: 1, type: 'ui_response', requestId: requestId('ui'), id, ...answer });
  const summary = uiCurrent.secret ? '已回答' : answer.cancelled ? '已取消' : answer.confirmed !== undefined ? (answer.confirmed ? '已确认' : '已拒绝') : '已回答：' + String(answer.value).slice(0, 80);
  pushNote(summary + '（' + (uiCurrent.title || uiCurrent.method) + '）');
  closeUiDialog();
  showNextUiDialog();
}
function closeUiDialog() {
  uiCurrent = null;
  ui.uiModal.classList.add('hidden');
}
ui.uiOk.addEventListener('click', () => {
  if (!uiCurrent) return;
  if (uiCurrent.method === 'confirm') answerUi({ confirmed: true });
  else if (uiCurrent.method === 'input') answerUi({ value: ui.uiInput.value });
  else if (uiCurrent.method === 'editor') answerUi({ value: ui.uiEditor.value });
});
ui.uiNo.addEventListener('click', () => answerUi({ confirmed: false }));
ui.uiCancel.addEventListener('click', () => answerUi({ cancelled: true }));
ui.uiInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ui.uiOk.click(); } });

// ---------- plugins panel (what the User VM's Pi has loaded) ----------
let pluginsWaiting = false;
function openPlugins() {
  ui.pluginsModal.classList.remove('hidden');
  ui.pluginsSub.textContent = '';
  ui.pluginsBody.innerHTML = '<div class="plugins-empty">正在向 User VM 查询…</div>';
  pluginsWaiting = true;
  if (opened) send({ v: 1, type: 'get_extensions' });
  else if (!pendingOpenId && connected) { openSession(null); }
  else if (!connected) ui.pluginsBody.innerHTML = '<div class="plugins-empty">未连接到 Host</div>';
}
function closePlugins() { ui.pluginsModal.classList.add('hidden'); pluginsWaiting = false; }
const ORIGIN_LABEL = { configured: 'PI Coffee 加载', cli: '命令行加载', auto: '自动发现', inline: 'Pi 内置', package: '安装包', settings: '设置' };
const SCOPE_LABEL = { user: '用户级', project: '项目级', temporary: '本次进程' };
function renderPlugins(list) {
  if (!pluginsWaiting && ui.pluginsModal.classList.contains('hidden')) return;
  pluginsWaiting = false;
  const groups = [['extension', '扩展'], ['skill', '技能'], ['prompt', '提示模板']];
  const counts = groups.map(([kind, label]) => `${list.filter((e) => e.kind === kind).length} ${label}`);
  ui.pluginsSub.textContent = counts.join(' · ');
  ui.pluginsBody.innerHTML = '';
  if (list.length === 0) { ui.pluginsBody.appendChild(el('div', 'plugins-empty', '这个 Pi 进程没有加载任何扩展、技能或提示模板。')); return; }
  for (const [kind, label] of groups) {
    const items = list.filter((e) => e.kind === kind);
    if (items.length === 0) continue;
    ui.pluginsBody.appendChild(el('div', 'side-label', label));
    for (const item of items) {
      const row = el('div', 'plugin');
      const head = el('div', 'plugin-head');
      head.appendChild(el('span', 'plugin-name', item.name));
      const badge = el('span', 'plugin-badge ' + (item.origin || ''), ORIGIN_LABEL[item.origin] || item.origin || '');
      head.appendChild(badge);
      if (item.scope && SCOPE_LABEL[item.scope]) head.appendChild(el('span', 'plugin-scope', SCOPE_LABEL[item.scope]));
      row.appendChild(head);
      if (item.path) { const p = el('div', 'plugin-path', item.path); p.title = item.path; row.appendChild(p); }
      if (item.commands && item.commands.length) {
        const cmds = el('div', 'plugin-cmds');
        for (const c of item.commands) {
          const chip = el('button', 'plugin-cmd', '/' + c.name);
          chip.type = 'button';
          chip.title = (c.description || '') + '\n点击填入输入框';
          chip.addEventListener('click', () => { closePlugins(); ui.prompt.value = '/' + c.name + ' '; ui.prompt.focus(); autoGrow(); refreshComposer(); });
          cmds.appendChild(chip);
          if (c.description) cmds.appendChild(el('span', 'plugin-cmd-desc', c.description));
        }
        row.appendChild(cmds);
      } else if (kind === 'extension') {
        row.appendChild(el('div', 'plugin-cmd-desc', '未注册斜杠命令（通过事件 / 工具生效）'));
      }
      ui.pluginsBody.appendChild(row);
    }
  }
}
ui.pluginsBtn.addEventListener('click', () => { closeBrandMenu(); openPlugins(); });
ui.pluginsClose.addEventListener('click', closePlugins);
ui.pluginsModal.addEventListener('click', (e) => { if (e.target === ui.pluginsModal) closePlugins(); });

// ---------- queue strip ----------
function renderQueue(event) {
  const items = [...(event.steering || []).map((t) => ({ kind: '插话', t })), ...(event.followUp || []).map((t) => ({ kind: '排队', t }))];
  ui.queue.innerHTML = '';
  ui.queue.classList.toggle('hidden', items.length === 0);
  for (const item of items) {
    const row = el('div', 'queue-item');
    row.appendChild(el('span', 'queue-kind', item.kind));
    row.appendChild(el('span', 'queue-text', item.t));
    ui.queue.appendChild(row);
  }
}

// ---------- models ----------
function renderModels() {
  if (!models) return;
  const current = models.models.find((m) => m.provider === models.current?.provider && m.id === models.current?.id);
  const source = models.current?.source || current?.source || 'native';
  ui.modelSource.value = source;
  for (const option of ui.modelSource.options) option.disabled = !models.models.some((m) => (m.source || 'native') === option.value);
  ui.model.innerHTML = '';
  for (const m of models.models || []) {
    if ((m.source || 'native') !== source) continue;
    const option = document.createElement('option');
    option.value = m.provider + '/' + m.id;
    option.textContent = m.id + ' · ' + m.provider;
    ui.model.appendChild(option);
  }
  if (models.current && !current) {
    const option = document.createElement('option');
    option.value = models.current.provider + '/' + models.current.id;
    option.textContent = models.current.id + '（当前不可用，请检查 VM 登录/配置）';
    option.disabled = true;
    ui.model.appendChild(option);
  }
  if (models.current) ui.model.value = models.current.provider + '/' + models.current.id;
  ui.thinking.innerHTML = '';
  for (const level of models.thinkingLevels || []) {
    const option = document.createElement('option');
    option.value = level;
    option.textContent = '思考：' + level;
    ui.thinking.appendChild(option);
  }
  ui.thinking.value = models.thinkingLevel || '';
  renderAgentSettings();
}
ui.model.addEventListener('change', () => {
  const [provider, ...rest] = ui.model.value.split('/');
  if (!provider || rest.length === 0) return;
  chooseModel(provider,rest.join('/'));
});
function chooseModel(provider,id) {
  if(!opened && draftModelEngine()){draftModel={provider,id};models={...models,current:draftModel};renderModels();refreshComposer();return;}
  modelPending=requestId('model');refreshComposer();
  send({v:1,type:'set_model',requestId:modelPending,provider,id});
}
ui.modelSource.addEventListener('change',()=>{
  const next=models?.models.find(m=>(m.source || 'native')===ui.modelSource.value);
  if(next)chooseModel(next.provider,next.id);else renderModels();
});
ui.thinking.addEventListener('change', () => {
  if (ui.thinking.value) send({ v: 1, type: 'set_thinking', requestId: requestId('thinking'), level: ui.thinking.value });
});

// ---------- slash commands ----------
let slashIndex = 0, commandRequest = null, commandState = 'idle', commandError = '', skillReloadScope = null;
function resetSlashCommands(){commands=[];commandRequest=null;commandState='idle';commandError='';ui.slash.classList.add('hidden');}
function loadSlashCommands(){
  if(!ui.prompt.value.startsWith('/')||/\s/.test(ui.prompt.value)||!connected||commandState!=='idle')return;
  if(opened){if(supports('commands')){commandState='loading';send({v:1,type:'get_commands'});}return;}
  if(activeId||pendingOpenId||!['pi','codex'].includes($('#task-engine').value))return;
  commandRequest=requestId('commands');commandState='loading';send({v:1,type:'get_command_catalog',engine:$('#task-engine').value,requestId:commandRequest});
}
function slashItems() {
  const value = ui.prompt.value;
  if (!value.startsWith('/') || /\s/.test(value)) return [];
  const query = value.slice(1).toLowerCase();
  return [SSHME_COMMAND,...commands.filter(c=>c.name.toLowerCase()!=='sshme')].filter((c) => c.name.toLowerCase().startsWith(query) || (c.source==='skill' && c.name.replace(/^skill:/,'').toLowerCase().startsWith(query)));
}
function renderSlash() {
  const items = slashItems();
  ui.slash.innerHTML = '';
  const querying=ui.prompt.value.startsWith('/')&&!/\s/.test(ui.prompt.value);
  ui.slash.classList.toggle('hidden',!querying);
  if(!querying)return;
  if(skillReloadScope&&opened){
    const reload=el('button','btn small');reload.type='button';reload.textContent='新安装或变更的 Skills 需要重新加载（仅空闲时）';
    reload.addEventListener('click',async()=>{const targetId=activeId,targetScope=skillReloadScope;reload.disabled=true;try{
      const response=await fetch('/api/skills',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'reload',...targetScope,conversationId:targetId})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'重新加载失败');
      if(activeId===targetId&&skillReloadScope===targetScope)skillReloadScope=null;
    }catch(e){toast(e.message);reload.disabled=false;}});ui.slash.appendChild(reload);
  }
  if(items.length===0){const note=el('div','skills-help');note.textContent=commandState==='loading'?'正在读取 Agent 命令…':commandError||(!['pi','codex'].includes(engine)?'此 Agent 暂不提供斜杠菜单。':commandState==='ready'?'没有匹配的命令；Skill 可按名称搜索。':'连接就绪后读取命令。');ui.slash.appendChild(note);return;}
  if(commandState==='loading'||commandError){const note=el('div','skills-help');note.textContent=commandError||'正在读取 Agent 命令…';ui.slash.appendChild(note);}

  slashIndex = Math.min(slashIndex, items.length - 1);
  items.forEach((c, index) => {
    const row = el('div', 'slash-item' + (index === slashIndex ? ' active' : ''));
    row.setAttribute('role', 'option');
    row.innerHTML = '<span class="slash-name"></span><span class="slash-desc"></span><span class="slash-src"></span>';
    row.querySelector('.slash-name').textContent=c.invocation||'/'+c.name;
    row.querySelector('.slash-desc').textContent = c.description || '';
    row.querySelector('.slash-src').textContent = c.source === 'web' ? '网页' : c.source === 'extension' ? '扩展' : c.source === 'skill' ? '技能' : '模板';
    row.addEventListener('mousedown', (e) => { e.preventDefault(); applySlash(c); });
    ui.slash.appendChild(row);
  });
}
function applySlash(command) {
  ui.prompt.value = (command.invocation||'/' + command.name) + ' ';
  ui.slash.classList.add('hidden');
  ui.prompt.focus();
  autoGrow();
  refreshComposer();
}

// ---------- attachments: inline images + direct file transfer ----------
const MAX_IMAGE_BYTES = 600 * 1024;
const INLINE_IMAGE_LIMIT = 4 * 1024 * 1024; // larger images travel as files
const HASH_LIMIT = 32 * 1024 * 1024;         // sha256 in the browser only for files this small

function normalizeTransferGrant(grant, fallbackSessionId) {
  if (!grant || typeof grant !== 'object') return null;
  let url = grant.url;
  if (preferSameOriginTransfer) {
    url = location.origin;
  } else {
    try {
      const parsed = new URL(url, location.origin);
      const pageHttps = location.protocol === 'https:';
      const pageLoopback = ['127.0.0.1', 'localhost', '::1'].includes(location.hostname);
      const targetLoopback = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
      if ((pageHttps && parsed.protocol === 'http:') || (!pageLoopback && targetLoopback)) url = location.origin;
    } catch {
      url = location.origin;
    }
  }
  return { ...grant, url, rawUrl: grant.url, sessionId: grant.sessionId || fallbackSessionId || activeId };
}

async function addFiles(files) {
  const epoch=taskSelectionEpoch;
  const toUpload = [];
  for (const file of files) {
    const isSmallImage = file.type.startsWith('image/') && file.size <= INLINE_IMAGE_LIMIT;
    if (isSmallImage) {
      // Small images go inline with the prompt so the model can see them.
      if (attachments.length >= 8) { toast('最多 8 张内联图片，其余作为文件上传'); toUpload.push(file); continue; }
      try { const image=await encodeImage(file);if(epoch!==taskSelectionEpoch)return;Object.defineProperty(image,'file',{value:file});attachments.push(image);file.__inlineAttached=true; } catch { toast('无法读取图片'); }
      toUpload.push(file); // Persist original bytes before sending the inline representation.
    } else {
      toUpload.push(file);
    }
  }
  if(epoch!==taskSelectionEpoch)return;
  draftFiles.push(...toUpload);
  renderAttachments();
  refreshComposer();
}

// Files go straight from the browser to the User VM over the LocalSend v2 API
// the Host advertises, with same-origin Web gateway fallback (ADR-0009 / ADR-0010).
async function uploadFiles(files) {
  if (!transfer) {
    filesAwaitingTransfer.push(...files);
    renderAttachments();
    refreshComposer();
    const canAutoOpen = !workspaceState || $('#task-kind').value !== 'project' || Boolean(ui.projectSelect.value);
    if(!canAutoOpen){draftFiles.push(...filesAwaitingTransfer);filesAwaitingTransfer=[];restoreQueuedPrompt();toast('请先选择项目');refreshComposer();return;}
    if (!opened && !pendingOpenId && connected && canAutoOpen) { void openSession(activeId); toast('正在为文件建立对话…'); }
    else if (opened && activeId && workspaceState) {
      const id = activeId;
      void workspaceApi({ action: 'files', id }).then((grant) => {
        if (activeId !== id || !grant) return;
        transfer = normalizeTransferGrant(grant, id);
        if (filesAwaitingTransfer.length) { const queued = filesAwaitingTransfer; filesAwaitingTransfer = []; void uploadFiles(queued); }
      }).catch(() => {
        draftFiles.push(...filesAwaitingTransfer);
        filesAwaitingTransfer = [];
        renderAttachments(); refreshComposer();
        toast('这个 Host 没有开启文件传输'); restoreQueuedPrompt();
      });
    } else if (opened) {
      draftFiles.push(...filesAwaitingTransfer);
      filesAwaitingTransfer = [];
      renderAttachments(); refreshComposer();
      toast('这个 Host 没有开启文件传输'); restoreQueuedPrompt();
    }
    return;
  }
  let grant=transfer;
  const targetSessionId = grant.sessionId || grant.scope;
  const maxFileBytes = grant.maxFileBytes ?? 256 * 1024 * 1024;
  const maxBatchBytes = grant.maxBatchBytes ?? 1024 * 1024 * 1024;
  const tooBig = files.filter((f) => f.size > maxFileBytes);
  if (tooBig.length) {draftFiles.push(...files);restoreQueuedPrompt();toast(`附件超过 ${formatBytes(maxFileBytes)}，请移除后重试`);return;}
  const batch = files.filter((f) => f.size <= maxFileBytes);
  if (batch.length === 0) return;
  const pending = uploads.filter((u) => u.state === 'uploading').reduce((s, u) => s + u.size, 0);
  if (pending + batch.reduce((s, f) => s + f.size, 0) > maxBatchBytes) { draftFiles.push(...files);restoreQueuedPrompt();toast(`一次最多传输 ${formatBytes(maxBatchBytes)}`); return; }

  const entries = batch.map((file) => ({
    url:grant.url,scope:grant.scope,id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    file, name: file.name, size: file.size, received: 0, state: 'uploading', path: null, error: null, xhr: null, sessionId: null, token: null,
  }));
  uploads.push(...entries);
  renderAttachments();
  refreshComposer();

  const meta = {};
  for (const u of entries) {
    const sha256 = u.size <= HASH_LIMIT ? await sha256Hex(u.file).catch(() => undefined) : undefined;
    meta[u.id] = { id: u.id, fileName: u.name, size: u.size, fileType: u.file.type || 'application/octet-stream', ...(sha256 ? { sha256 } : {}) };
  }
  if(activeId!==targetSessionId)return;
  const prepareBody = JSON.stringify({ info: { alias: 'PI Coffee Web', version: '2.0', deviceModel: navigator.platform || 'browser', deviceType: 'web', fingerprint: 'web', port: 0, protocol: 'http', download: false }, files: meta });
  const requestPrepare = (g) => fetch(`${g.url}/api/localsend/v2/prepare-upload?scope=${encodeURIComponent(g.scope)}&token=${encodeURIComponent(g.token)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: prepareBody,
  });
  const prepareWithFallback = async (g) => {
    try {
      return await requestPrepare(g);
    } catch (networkError) {
      if (g.url !== location.origin) {
        preferSameOriginTransfer = true;
        g.url = location.origin;
        if (transfer && (transfer.sessionId || transfer.scope) === targetSessionId) transfer = g;
        for (const u of entries) u.url = g.url;
        return await requestPrepare(g);
      }
      throw networkError;
    }
  };
  let prepared;
  try {
    let response = await prepareWithFallback(grant);
    if ((response.status === 401 || response.status === 403) && workspaceState && activeId === targetSessionId) {
      const usedSameOrigin = grant.url === location.origin;
      const fresh = await workspaceApi({ action: 'files', id: activeId }).catch(() => null);
      if (fresh && activeId === targetSessionId) {
        grant = normalizeTransferGrant(fresh, activeId);
        if (usedSameOrigin) grant.url = location.origin;
        transfer = grant;
        for (const u of entries) { u.url = grant.url; u.scope = grant.scope; }
        response = await prepareWithFallback(grant);
      }
    }
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || ('HTTP ' + response.status));
    prepared = await response.json();
  } catch (error) {
    for (const u of entries) {
      u.state = 'failed';
      u.error = '无法连接 User VM 的传输端点：' + (error.message || error);
    }
    renderAttachments(); refreshComposer();
    if (uploads.some((u) => u.state === 'failed')) restoreQueuedPrompt();
    else flushFirstPrompt();
    toast('文件传输失败：浏览器无法直连 User VM（' + grant.url + '）');
    return;
  }
  if(activeId!==targetSessionId)return;
  for (const u of entries) {
    u.sessionId = prepared.sessionId;
    u.token = prepared.files[u.id];
    if (!u.token) { u.state = 'failed'; u.error = '服务端未接受该文件'; continue; }
    void sendFile(u);
  }
  if(entries.some(u=>u.state==='failed'))restoreQueuedPrompt();
  renderAttachments();
}

function sendFile(u) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    u.xhr = xhr;
    xhr.open('POST', `${u.url}/api/localsend/v2/upload?sessionId=${encodeURIComponent(u.sessionId)}&fileId=${encodeURIComponent(u.id)}&token=${encodeURIComponent(u.token)}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && u.state === 'uploading') { u.received = Math.max(u.received, e.loaded); renderAttachmentProgress(u); } };
    xhr.onload = () => {
      if (xhr.status === 200) { if (u.state === 'uploading') { try{const result=JSON.parse(xhr.responseText);u.path=result.path;u.sha256=result.sha256;}catch{} u.received = u.size; u.state = u.path ? 'done' : 'finishing'; } }
      else { u.state = 'failed'; u.error = xhr.status === 422 ? '校验失败（SHA-256 不匹配）' : xhr.status === 403 ? '令牌无效' : 'HTTP ' + xhr.status; }
      renderAttachments(); refreshComposer();
      if (u.state === 'failed') restoreQueuedPrompt(); else flushFirstPrompt();
      resolve();
    };
    xhr.onerror = () => {
      if (u.state !== 'cancelled') {
        { u.state = 'failed'; u.error = '网络错误'; }
      }
      renderAttachments(); refreshComposer();
      if (u.state === 'failed') restoreQueuedPrompt(); else flushFirstPrompt();
      resolve();
    };
    xhr.onabort = () => { u.state = 'cancelled'; renderAttachments(); refreshComposer(); resolve(); };
    xhr.send(u.file);
  });
}

async function sha256Hex(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function handleTransferEvent(event) {
  const u = uploads.find((x) => x.id === event.fileId);
  if (!u) return;
  if (event.type === 'transfer_progress') { u.received = Math.max(u.received, event.received || 0); renderAttachmentProgress(u); return; }
  if (event.type === 'transfer_complete') {
    u.path = event.path; u.name = event.fileName || u.name; u.sha256 = event.sha256; u.received = u.size;
    if (u.state !== 'cancelled') u.state = 'done';
    renderAttachments(); refreshComposer();
    flushFirstPrompt();
    // Keep a transcript-side aggregate so uploads stay discoverable after the rail rolls on.
    if (!u.file?.__inlineAttached && !uploadLog.some((f) => f.path === u.path)) { uploadLog.push({ name: u.name, size: u.size, path: u.path }); renderUploadLogCard(); }
    return;
  }
  if (event.type === 'transfer_failed' && u.state !== 'cancelled') {
    { u.state = 'failed'; u.error = event.message || '传输失败'; }
    renderAttachments(); refreshComposer();
    if (u.state === 'failed') restoreQueuedPrompt(); else flushFirstPrompt();
  }
}

function downloadUrl(path) {
  if (!transfer || !path) return null;
  return `${transfer.url}/api/localsend/v2/download?scope=${encodeURIComponent(transfer.scope)}&token=${encodeURIComponent(transfer.token)}&fileId=${encodeURIComponent(path)}`;
}
function renderUploadLogCard() {
  let card = $('#upload-log');
  if (!uploadLog.length) { card?.remove(); return; }
  if (!card) { card = el('section', 'upload-log'); card.id = 'upload-log'; card.append(el('h3', '', '已上传文件')); ui.thread.append(card); }
  for (const child of [...card.querySelectorAll('.upload-log-row')]) child.remove();
  for (const f of uploadLog.slice(0, 20)) {
    const href = downloadUrl(f.path);
    const row = el('div', 'upload-log-row');
    const sizeLabel = typeof f.size === 'number' ? formatBytes(f.size) : (f.sizeText || '');
    row.append(el('span', 'upload-log-name', f.name + (sizeLabel ? ' · ' + sizeLabel : '')));
    if (href) { const a = el('a', '', '下载'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; row.append(a); }
    card.append(row);
  }
  if (uploadLog.length > 20) card.append(el('p', 'workspace-note', `其余 ${uploadLog.length - 20} 个文件仍在工作区可用。`));
}

function refreshToolDownloadLinks() {
  for (const entry of entries) if (entry.k === 'tool' && entry.node) addToolDownloadLink(entry);
  for (const chip of ui.thread.querySelectorAll('.file-chip[data-upload-path]')) {
    const path = chip.dataset.uploadPath;
    const href = downloadUrl(path);
    if (!href) continue;
    if (chip.tagName === 'A') {
      chip.href = href;
    } else {
      const link = el('a', 'file-chip');
      link.dataset.uploadPath = path;
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener';
      link.title = '下载 ' + (chip.querySelector('.file-name')?.textContent || path);
      link.replaceChildren(...chip.childNodes);
      chip.replaceWith(link);
    }
  }
}
function addToolDownloadLink(entry) {
  const args = entry.args && typeof entry.args === 'object' ? entry.args : {};
  const path = args.path || args.file_path;
  if (!path || !['write', 'edit', 'read'].includes(entry.name)) return;
  const summary = entry.node.querySelector('summary');
  if (!summary || summary.querySelector('.tool-dl')) return;
  const href = downloadUrl(String(path));
  if (!href) return;
  const link = document.createElement('a');
  link.className = 'tool-dl';
  link.href = href; link.target = '_blank'; link.rel = 'noopener'; link.title = '从 User VM 下载这个文件';
  link.textContent = '下载';
  link.addEventListener('click', (e) => e.stopPropagation());
  summary.insertBefore(link, summary.querySelector('.state'));
}
function encodeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        if (file.size <= MAX_IMAGE_BYTES && scale === 1) {
          resolve({ type: 'image', mimeType: file.type, data: dataUrl.split(',')[1] });
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const out = canvas.toDataURL('image/jpeg', 0.85);
        resolve({ type: 'image', mimeType: 'image/jpeg', data: out.split(',')[1] });
      };
      img.onerror = () => reject(new Error('decode failed'));
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}
function renderAttachments() {
  ui.attachments.innerHTML = '';
  const visibleQueued = [...draftFiles,...filesAwaitingTransfer].filter((f) => !f.__inlineAttached);
  ui.attachments.classList.toggle('hidden', attachments.length === 0 && uploads.length === 0 && visibleQueued.length === 0);
  attachments.forEach((image, index) => {
    const wrap = el('div', 'attachment');
    const img = document.createElement('img');
    img.src = 'data:' + image.mimeType + ';base64,' + image.data;
    img.alt = '附图 ' + (index + 1);
    const original=uploads.find(u=>u.file===image.file);
    if(original?.state==='failed')wrap.append(el('span','upload-meta',original.error||'上传失败，请移除后重试')); 
    const remove = el('button', 'attachment-remove', '×');
    remove.type = 'button';
    remove.title = '移除';
    remove.disabled=!!queuedPrompt;
    remove.addEventListener('click', () => { draftFiles=draftFiles.filter(file=>file!==image.file);filesAwaitingTransfer=filesAwaitingTransfer.filter(file=>file!==image.file);for(const u of uploads.filter(u=>u.file===image.file))u.xhr?.abort();uploads=uploads.filter(u=>u.file!==image.file);attachments.splice(index, 1); renderAttachments(); refreshComposer(); });
    wrap.append(img, remove);
    ui.attachments.appendChild(wrap);
  });
  for (const file of visibleQueued) {
    const chip = el('div', 'upload-chip uploading');
    chip.innerHTML = '<span class="file-ico">📄</span><span class="upload-main"><span class="upload-name"></span><span class="upload-meta"></span><span class="upload-bar"><span class="upload-fill" style="width:0%"></span></span></span>';
    chip.querySelector('.upload-name').textContent = file.name;
    chip.querySelector('.upload-meta').textContent = `${formatBytes(file.size)} · ${draftFiles.includes(file)?'待发送':'等待建立对话…'}`;
    const remove = el('button', 'attachment-remove', '×');
    remove.type = 'button';
    remove.title = '移除';
    remove.addEventListener('click', () => {
      draftFiles=draftFiles.filter(x=>x!==file);filesAwaitingTransfer = filesAwaitingTransfer.filter((x) => x !== file);
      renderAttachments(); refreshComposer();
    });
    chip.appendChild(remove);
    ui.attachments.appendChild(chip);
  }
  for (const u of uploads.filter(u=>!u.file?.__inlineAttached)) {
    const chip = el('div', 'upload-chip ' + u.state);
    chip.dataset.id = u.id;
    chip.innerHTML = '<span class="file-ico">📄</span><span class="upload-main"><span class="upload-name"></span><span class="upload-meta"></span><span class="upload-bar"><span class="upload-fill"></span></span></span>';
    chip.querySelector('.upload-name').textContent = u.name;
    const remove = el('button', 'attachment-remove', '×');
    remove.type = 'button';
    remove.title = u.state === 'uploading' ? '取消上传' : '移除';
    remove.addEventListener('click', () => {
      if (u.state === 'uploading' && u.xhr) u.xhr.abort();
      uploads = uploads.filter((x) => x !== u);
      renderAttachments(); refreshComposer();
    });
    chip.appendChild(remove);
    ui.attachments.appendChild(chip);
    renderAttachmentProgress(u);
  }
}
function renderAttachmentProgress(u) {
  const chip = ui.attachments.querySelector(`.upload-chip[data-id="${u.id}"]`);
  if (!chip) return;
  chip.className = 'upload-chip ' + u.state;
  const pct = u.size ? Math.min(100, Math.round((u.received / u.size) * 100)) : 100;
  chip.querySelector('.upload-fill').style.width = pct + '%';
  const meta = chip.querySelector('.upload-meta');
  if (u.state === 'uploading') meta.textContent = `${formatBytes(u.received)} / ${formatBytes(u.size)} · ${pct}%`;
  else if (u.state === 'finishing') meta.textContent = '校验中…';
  else if (u.state === 'done') meta.textContent = `${formatBytes(u.size)} · 已存入 User VM`;
  else if (u.state === 'failed') meta.textContent = u.error || '失败';
  else meta.textContent = '已取消';
}
function resetTransfers() {
  // Endpoint and token are per Session; anything in flight belonged to the old one.
  for (const u of uploads) if (u.state === 'uploading' && u.xhr) u.xhr.abort();
  uploads = [];
  transfer = null;
  renderAttachments();
}
function uploadsBusy() { return filesAwaitingTransfer.length>0 || uploads.some((u) => u.state === 'uploading' || u.state === 'finishing'); }
function completedUploads() { return uploads.filter((u) => u.state === 'done' && u.path); }
ui.attach.addEventListener('click', () => ui.file.click());
ui.file.addEventListener('change', () => { addFiles([...ui.file.files]); ui.file.value = ''; });
ui.file.removeAttribute('accept'); // any file type: images inline, everything else straight to the VM
ui.prompt.addEventListener('paste', (event) => {
  const files = [...(event.clipboardData?.items || [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
  if (files.length) { event.preventDefault(); addFiles(files); }
});
for (const type of ['dragenter', 'dragover']) document.addEventListener(type, (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); ui.app.classList.add('dragging'); } });
for (const type of ['dragleave', 'drop']) document.addEventListener(type, (e) => { if (type === 'drop') { e.preventDefault(); addFiles([...(e.dataTransfer?.files || [])]); } ui.app.classList.remove('dragging'); });

// ---------- composer ----------
function autoGrow() {
  ui.prompt.style.height = 'auto';
  ui.prompt.style.height = Math.min(ui.prompt.scrollHeight, 336) + 'px';
}
function syncToBottomPosition() {
  const height = ui.composerWrap?.getBoundingClientRect().height || 150;
  ui.app.style.setProperty('--composer-offset', Math.ceil(height + 18) + 'px');
}
if (globalThis.ResizeObserver && ui.composerWrap) new ResizeObserver(syncToBottomPosition).observe(ui.composerWrap);
ui.prompt.addEventListener('input', () => {
  autoGrow();
  refreshComposer();
  slashIndex = 0;
  loadSlashCommands();
  renderSlash();
});
ui.prompt.addEventListener('keydown', (event) => {
  const slashOpen = !ui.slash.classList.contains('hidden');
  if (slashOpen && slashItems().length) {
    const items = slashItems();
    if (event.key === 'ArrowDown') { event.preventDefault(); slashIndex = (slashIndex + 1) % items.length; renderSlash(); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); slashIndex = (slashIndex - 1 + items.length) % items.length; renderSlash(); return; }
    if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) { event.preventDefault(); applySlash(items[slashIndex]); return; }
    if (event.key === 'Escape') { ui.slash.classList.add('hidden'); return; }
  }
  if (event.key === 'ArrowUp' && ui.prompt.value === '' && lastUserText) { event.preventDefault(); ui.prompt.value = lastUserText; autoGrow(); refreshComposer(); return; }
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('#composer').requestSubmit(); }
});
ui.mode.addEventListener('change', refreshComposer);
$('#composer').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = ui.prompt.value.trim();
  const files = completedUploads();
  const pendingNewTaskFiles = !opened && filesAwaitingTransfer.length > 0;
  if ((!text && draftFiles.length===0 && attachments.length === 0 && files.length === 0 && !pendingNewTaskFiles) || !socket || socket.readyState !== WebSocket.OPEN) return;
  if(modelPending||contextPending){toast('等待模型或上下文设置确认');return;}
  const sshmeRequest=parseSshme(text);
  if(sshmeRequest!==null){
    if(!sshmeRequest){toast('请在 /sshme 后输入需要协助的内容');return;}
    if(streaming||compacting||pendingOpenId){toast('请等待当前任务就绪后使用 /sshme');return;}
    void sshmePanel.open({request:sshmeRequest,context:{activeId,user:currentUser,epoch:taskSelectionEpoch,text}});return;
  }
  const activeUploadsBusy = uploads.some((u) => u.state === 'uploading' || u.state === 'finishing') || (opened && filesAwaitingTransfer.length > 0);
  if (activeUploadsBusy || uploads.some(u=>u.state==='failed')) { toast('请等待原始附件上传成功，或移除失败附件'); return; }
  const images = attachments.slice();
  if(draftFiles.length){
    queuedPrompt={text,images};
    const pending=draftFiles;draftFiles=[];
    ui.prompt.value='';autoGrow();refreshComposer();
    void uploadFiles(pending).then(()=>flushFirstPrompt());
    return;
  }
  if (!opened) {
    // First message of a brand-new conversation: (re)use the in-flight open
    // and send once `history` confirms the Session.
    queuedPrompt = { text, images };
    attachments = [];
    renderAttachments();
    ui.prompt.value = '';
    autoGrow();
    setStreaming(true);
    showThinking(true);
    if (!pendingOpenId) openSession(null);
    return;
  }
  submitPrompt(text || (files.length ? '（附件）' : '（图片）'), images);
});
function submitPrompt(text, images) {
  if(compacting){toast('请等待压缩完成，或先停止');return;}
  if(streaming && !supports('steer') && !supports('followUp')){toast('请等待当前轮次结束，或先停止');return;}
  const mode = streaming ? ui.mode.value : 'prompt';
  requestNotifyPermission();   // first prompt is the moment the user has context for the browser's ask
  const files = completedUploads().filter(u=>!u.file?.__inlineAttached).map((u) => ({ name: u.name, size: u.size, path: u.path, href: downloadUrl(u.path) }));
  // Files are already on the User VM's disk; the model gets their paths, not their bytes.
  const wireText = files.length
    ? text + '\n\n[已上传到工作目录的文件]\n' + files.map((f) => `- ${f.path} (${formatBytes(f.size)})`).join('\n')
    : text;
  const frame = { v: 1, type: 'prompt', requestId: requestId('web'), text: wireText };
  if (images && images.length && supports("images")) frame.images = images;
  if (mode !== 'prompt') frame.mode = mode;
  if (mode !== 'prompt') queuedRequests.add(frame.requestId);
  if (mode === 'prompt') {
    pushUser(text, images, undefined, files);
    lastUserText = text;
    setStreaming(true);
    showThinking(true);
  }
  pendingDelivery=frame.requestId;
  if(!send(frame)){uncertainTask=activeId;pushNote("请求未确认，不会自动重发。",true);}
  attachments = [];
  uploads = uploads.filter((u) => u.state === 'uploading' || u.state === 'finishing');
  renderAttachments();
  ui.prompt.value = '';
  ui.slash.classList.add('hidden');
  autoGrow();
  refreshComposer();
  renderHeader();
  ui.prompt.focus();
}
ui.stop.addEventListener('click', () => { if (opened) { send({ v: 1, type: 'abort' }); pushNote('已请求停止当前任务。'); } });

initRunners({onOpen:()=>{closeBrandMenu();closeSidebarOnMobile();}});
const sshmePanel=initSshme({
  onOpen:()=>{closeBrandMenu();closeAgentMenu();closeSidebarOnMobile();ui.slash.classList.add('hidden');},
  isCurrent:context=>context.activeId===activeId&&context.user===currentUser&&context.epoch===taskSelectionEpoch&&context.text===ui.prompt.value.trim()&&connected&&!streaming&&!compacting&&!pendingOpenId&&!modelPending&&!contextPending,
  onReady:prompt=>{ui.prompt.value=prompt;ui.composer.requestSubmit();},
});

const skillPanel=initSkills({
  context:()=>{const task=workspaceState?.conversations.find(c=>c.id===activeId);return {id:activeId,engine:task?.engine??engine,kind:task?.archived?null:task?.workspaceKind};},
  onOpen:()=>{setSearchOpen(false);setWorkspaceOpen(false);closeDiffDialog();closeBrandMenu();closeSidebarOnMobile();closeTaskDetails();},
  notify:toast,
  onChanged:target=>{if(target.engine!==engine)return;if(engine==='pi'&&opened&&(target.scope==='user'||target.conversationId===activeId))skillReloadScope=target;resetSlashCommands();},
  onClose:()=>{loadSlashCommands();renderSlash();},
});

// ---------- session actions ----------
function switchSession(id) {
  skillPanel.close();resetSlashCommands();skillReloadScope=null;
  setSearchOpen(false);
  if(workspaceState?.conversations.find(c=>c.id===id)?.archived || workspaceState?.legacyArchived?.includes(id)) {toast("请从对话菜单恢复后再打开");return;}
  if (id === activeId && opened) return;
  closeTaskDetails();
  setWorkspaceOpen(false);closeDiffDialog();
  clearExtensionUi();
  taskSelectionEpoch++;catalogRequest=null;draftModel=null;modelPending=null;historyReady=false;closeAgentMenu();resetTransfers();filesAwaitingTransfer=[];draftFiles=[];attachments=[];draftContextPreset='272k';contextToApply=null;contextPending=null;queuedPrompt=null;workspaceSync=null;
  activeId = id;
  rememberTask(id);
  streaming = false;
  compacting = false;
  statsCache = null;
  selectedChangedPath = null;
  lastChangeCardSignature = '';
  resetThread();
  renderProjectContext();
  renderHeader();
  renderSessionList();
  connect();
}
function newSession(focus = true) {
  skillPanel.close();resetSlashCommands();skillReloadScope=null;
  setSearchOpen(false);
  closeTaskDetails();
  setWorkspaceOpen(false);closeDiffDialog();
  clearExtensionUi();
  taskSelectionEpoch++;catalogRequest=null;draftModel=null;modelPending=null;historyReady=false;closeAgentMenu();prepareNew=false;creationRequest=null;saveCreation();workspaceSync=null;resetTransfers();filesAwaitingTransfer=[];draftFiles=[];attachments=[];draftContextPreset='272k';contextToApply=null;contextPending=null;queuedPrompt=null;
  engine='pi';capabilities=null;models=null;commands=[];$('#task-engine').value='pi';
  $('#task-kind').value='chat';draftProjectForge='gitea';ui.projectSelect.value='';ui.startBranch.value='';
  activeId = null;
  rememberTask(null);
  streaming = false;
  compacting = false;
  statsCache = null;
  selectedChangedPath = null;
  lastChangeCardSignature = '';
  resetThread();
  renderHero();
  renderProjectContext();
  renderHeader();
  renderSessionList();
  connect();
  if (focus) ui.prompt.focus();
}

// ---------- sidebar / global ----------
$('#new-task').addEventListener('click', () => { newSession(); closeSidebarOnMobile(); });
$('#open-side').addEventListener('click', openSidebar);
$('#close-side').addEventListener('click', collapseSidebar);
function closeSidebarOnMobile() { ui.app.classList.remove('side-open'); }
function setSearchOpen(open) {
  if(open)skillPanel.close();
  searchOpen=open;ui.app.classList.toggle('search-open',open);
  $('#search-page').classList.toggle('hidden',!open);
  $('#search-open').setAttribute('aria-expanded',String(open));
  if(open){setWorkspaceOpen(false);closeDiffDialog();closeBrandMenu();closeSidebarOnMobile();renderSearchResults();ui.search.focus();}
}
function renderSearchResults() {
  if(!searchOpen)return;
  const list=$('#search-results');list.replaceChildren();
  const query=ui.search.value.trim().toLowerCase();
  const known=sessions.slice();
  for(const c of workspaceState?.conversations || [])if(!known.some(s=>s.id===c.id))known.push({id:c.id,preview:c.workspaceKind==='chat'?'Chat 任务':'Work 任务',updatedAt:c.createdAt});
  const results=known.filter(session=>{
    const task=workspaceState?.conversations.find(c=>c.id===session.id);
    const archived=Boolean(task?.archived || workspaceState?.legacyArchived?.includes(session.id));
    return archived===(searchFilter==='archived') && (['all','archived'].includes(searchFilter) || task?.workspaceKind===searchFilter) && (!query || [sessionTitle(session),session.preview || ''].some(text=>text.toLowerCase().includes(query)));
  }).sort((a,b)=>String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  if(!results.length){list.append(el('li','empty-list',query?'没有匹配的对话':'没有对话'));return;}
  let group=null;
  for(const session of results){
    const current=timeGroup(session.updatedAt);if(current!==group){group=current;list.append(el('li','search-group',group));}
    const row=el('li','search-result');const open=el('button','search-result-open');open.type='button';
    open.append(el('span','search-result-title',sessionTitle(session)),el('span','search-result-meta',relativeTime(session.updatedAt)));
    open.addEventListener('click',()=>{if(searchFilter==='archived'){openSessionMenu(session,open);return;}switchSession(session.id);closeSidebarOnMobile();});
    row.append(open);if(searchFilter==='archived')open.title='对话操作 · 恢复后打开';list.append(row);
  }
}
$('#search-open').addEventListener('click',()=>setSearchOpen(true));
$('#search-close').addEventListener('click',()=>{setSearchOpen(false);$('#search-open').focus();});
$('#search-filters').addEventListener('click',event=>{const button=event.target.closest('[data-filter]');if(!button)return;searchFilter=button.dataset.filter;for(const item of $('#search-filters').querySelectorAll('button'))item.setAttribute('aria-pressed',String(item===button));renderSearchResults();});
ui.search.addEventListener('input',renderSearchResults);
ui.scroller.addEventListener('scroll', () => ui.toBottom.classList.toggle('hidden', nearBottom()));
ui.toBottom.addEventListener('click', scrollToEnd);
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); newSession(); return; }
  if (event.key === 'Escape') {
    if (!ui.uiModal.classList.contains('hidden')) { answerUi({ cancelled: true }); return; }
    if (!ui.pluginsModal.classList.contains('hidden')) { closePlugins(); return; }
    if (!ui.modal.classList.contains('hidden')) { ui.modalCancel.click(); return; }
    if (!$('#github-modal').classList.contains('hidden')) { closeGitHubPicker(); return; }
    if (!$('#project-create-menu').classList.contains('hidden')) { closeProjectCreateMenu(); $('#project-create').focus(); return; }
    if (menuNode) { closeMenu(); return; }
    if (ui.brandMenu && !ui.brandMenu.classList.contains('hidden')) { closeBrandMenu(); return; }
    if (ui.agentMenu && !ui.agentMenu.classList.contains('hidden')) { closeAgentMenu(); return; }
    if (!ui.taskDetails.classList.contains('hidden')) { closeTaskDetails(); ui.taskDetailsBtn.focus(); return; }
    if (!ui.slash.classList.contains('hidden')) { ui.slash.classList.add('hidden'); return; }
    if ($('#diff-dialog').open) { closeDiffDialog(true); return; }
    if (workspaceDetailOpen) { closeWorkspaceDetail(); return; }
    if(skillPanel.isOpen()){skillPanel.close();return;}
    if(searchOpen){setSearchOpen(false);$('#search-open').focus();return;}
    closeSidebarOnMobile();
    if ((streaming || compacting) && opened && document.activeElement !== ui.prompt) { send({ v: 1, type: 'abort' }); pushNote('已请求停止当前任务。'); }
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && socket && socket.readyState === WebSocket.OPEN) send({ v: 1, type: 'list_sessions' });
});
installCopyHandlers(ui.thread);

// ---------- boot ----------
applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
setWorkspaceOpen(false);
resetThread();
renderHero();
renderHeader();
renderSessionList();
autoGrow();
refreshComposer();
syncToBottomPosition();
connect();


// Project metadata stays on the VM. This panel extends the existing shell rather than replacing it.
async function workspaceApi(value) {
  const r=await fetch('/api/workspace',value ? {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)} : {});
  const data=await r.json();if(!r.ok)throw new Error(data.error || '工作区请求失败');return data;
}
function setWorkspaceOpen(open) {
  if(open)closeDiffDialog();
  (open ? ui.app : $('.topbar-actions')).append($('#files-toggle'));
  ui.app.classList.toggle('files-open', open);
  $('#files-toggle').setAttribute('aria-expanded',String(open));
  $('#workspace-panel').classList.toggle('hidden', !open);
}
async function loadWorkspace() {
  const seq=++workspaceRequestSeq;
  try {
    const data=await workspaceApi();if(seq!==workspaceRequestSeq)return;workspaceState=data;
    $('#project-controls').classList.remove('hidden');$('#files-toggle').classList.remove('hidden');
    const select=ui.projectSelect, old=select.value;select.replaceChildren();
    const all=document.createElement("option");all.value="";all.textContent="选择项目 / 全部任务";select.append(all);
    appendProjectOptions(select,data.projects);
    if(data.projects.some(p=>p.id===old))select.value=old;
    renderProjectContext();
    renderSessionList();
    if($('#diff-dialog').open)renderDiffScope();
    const hasActive=activeId && data.conversations.some(c=>c.id===activeId);
    if(hasActive) {
      const id=activeId,c=data.conversations.find(c=>c.id===id),chat=c.workspaceKind==='chat';
      $('#migrate-workspace').classList.toggle('hidden',chat || Boolean(c.startSha));
      $('#checkpoint-workspace').classList.toggle('hidden',chat || !c.startSha);
      if(c.creationState==='failed' || c.creationState==='creating')return;
      const grant=await workspaceApi({action:'files',id}).catch(()=>null);
      if(activeId===id){
        if(grant){
          transfer=normalizeTransferGrant(grant,id);
          refreshToolDownloadLinks();
          renderUploadLogCard();
          bindWorkspaceArtifacts();
          if(filesAwaitingTransfer.length){const queued=filesAwaitingTransfer;filesAwaitingTransfer=[];void uploadFiles(queued);}
        }
        void refreshWorkspaceStatus();
        void refreshWorkspaceChanges(false).then(()=>maybeRenderChangesCard()).catch(()=>undefined);
      }
    }
    else {workspaceChanges=null;workspaceSync=null;renderSyncState();for(const id of ['migrate-workspace','checkpoint-workspace','pull-request'])$('#'+id).classList.add('hidden');selectedChangedPath=null;if(workspaceDetailOpen)closeWorkspaceDetail();renderWorkspaceSummary();renderWorkspaceList();}
  } catch(e) {if(workspaceState){workspaceSync={...workspaceSync,state:'unknown',error:e.message};renderSyncState();renderProjectContext();}}
}
$('#task-engine').addEventListener('change',()=>{resetSlashCommands();creationRequest=null;catalogRequest=null;draftModel=null;models=null;engine=$('#task-engine').value;closeAgentMenu();saveCreation();refreshComposer();loadDraftModels();});
$('#task-kind').addEventListener('change',()=>{resetSlashCommands();creationRequest=null;catalogRequest=null;draftModel=null;models=null;closeAgentMenu();saveCreation();refreshComposer();engine=$('#task-engine').value;loadDraftModels();});
$('#create-task').addEventListener('click',async()=>{
  if(activeId && !workspaceState?.conversations.some(c=>c.id===activeId)){
    const id=activeId,workspaceKind=$('#task-kind').value,projectId=ui.projectSelect.value;
    if(workspaceKind==='project' && !projectId)return toast('请先选择项目');
    try{await workspaceApi({action:'conversation',id,workspaceKind,...(workspaceKind==='project'?{projectId,branch:ui.startBranch.value.trim() || undefined}:{})});await loadWorkspace();connect();}catch(e){toast(e.message);}return;
  }
  void openSession(null);
});
ui.projectSelect.addEventListener('change',async()=>{
  if([ADD_GITHUB,ADD_GITEA].includes(ui.projectSelect.value)){const forge=ui.projectSelect.value===ADD_GITEA?'gitea':'github';ui.projectSelect.value=lastProjectValue;void openGitHubPicker(forge);return;}
  const selectedProject=workspaceState?.projects.find(p=>p.id===ui.projectSelect.value);if(selectedProject)draftProjectForge=projectForge(selectedProject);
  creationRequest=null;saveCreation();ui.startBranch.value='';showArchived=false;renderProjectContext();renderAgentSettings();renderSessionList();
  const id=ui.projectSelect.value,list=$('#remote-branches');list.replaceChildren();if(!id || activeId)return;
  try{const branches=await workspaceApi({action:'branches',projectId:id});if(ui.projectSelect.value!==id || activeId)return;for(const branch of branches){const option=document.createElement('option');option.value=branch;list.append(option);}ui.startBranch.value=workspaceState.projects.find(p=>p.id===id)?.branch || branches[0] || '';}
  catch(e){toast('分支列表不可用，可填写已知远端分支：'+e.message);}
});
$('#show-archive').addEventListener('click',()=>{closeBrandMenu();showArchived=true;renderSessionList();});
$('#show-active').addEventListener('click',()=>{closeBrandMenu();showArchived=false;renderSessionList();});
$('#project-discover').addEventListener('click',async()=> {closeBrandMenu();try{await workspaceApi({action:'discover'});await loadWorkspace();}catch(e){toast(e.message);}});
$('#project-create').addEventListener('click',()=>{
  if(projectCreating || activeId || pendingOpenId)return;
  const forges=forgeCapabilities();
  if(!forges.github){void createGiteaProject();return;}
  if(!forges.gitea){void openGitHubPicker();return;}
  const menu=$('#project-create-menu'),open=menu.classList.contains('hidden');
  menu.classList.toggle('hidden',!open);$('#project-create').setAttribute('aria-expanded',String(open));
  if(open)setTimeout(()=>menu.querySelector('button')?.focus(),0);
});
$('#project-create-gitea').addEventListener('click',()=>{closeProjectCreateMenu();void createGiteaProject();});
$('#project-create-github').addEventListener('click',()=>{closeProjectCreateMenu();void openGitHubPicker();});
$('#project-create-menu').addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.stopPropagation();closeProjectCreateMenu();$('#project-create').focus();return;}
  if(!['ArrowDown','ArrowUp'].includes(event.key))return;
  event.preventDefault();const items=[...$('#project-create-menu').querySelectorAll('button')];
  const index=items.indexOf(document.activeElement);items[(index+(event.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();
});
function closeProjectCreateMenu(){$('#project-create-menu')?.classList.add('hidden');$('#project-create')?.setAttribute('aria-expanded','false');}
async function createGiteaProject(){
  if(projectCreating || activeId || pendingOpenId)return;
  projectCreating=true;renderProjectContext();
  const previousProject=ui.projectSelect.value;
  try {
    const name=await askModal({title:'新建 Gitea 项目',text:'创建私有 Gitea 仓库。名称使用英文字母、数字、短横线或下划线。',input:'',okLabel:'创建'});
    if(!name)return;
    const project=await workspaceApi({action:'project',name});
    await loadWorkspace();
    if(!activeId && !pendingOpenId && $('#task-kind').value==='project' && ui.projectSelect.value===previousProject){
      ui.projectSelect.value=project.id;
      ui.projectSelect.dispatchEvent(new Event('change'));
    }
    toast('Gitea 项目已创建：'+project.name);
  }catch(e){toast(e.message);}
  finally{projectCreating=false;renderProjectContext();}
}
// ---------- GitHub repositories (ADR-0022): add once through the picker, then choose from the dropdown ----------
function appendProjectOptions(select,projects) {
  const forges=forgeCapabilities(),option=(p)=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.name;o.dataset.forge=projectForge(p);return o;};
  const addOption=forge=>{const add=document.createElement('option');add.value=forge==='gitea'?ADD_GITEA:ADD_GITHUB;add.textContent=forge==='gitea'?'＋ 选择已有 Gitea 仓库…':'＋ 添加 GitHub 仓库…';return add;};
  if(!forges.github && !projects.some(p=>projectForge(p)==='github')){for(const p of projects)select.append(option(p));if(forges.gitea)select.append(addOption('gitea'));return;}
  for(const forge of ['gitea','github']) {
    const items=projects.filter(p=>projectForge(p)===forge),addable=forges[forge];
    if(!items.length && !addable)continue;
    const group=document.createElement('optgroup');group.label=FORGE_NAMES[forge];
    for(const p of items)group.append(option(p));
    if(addable)group.append(addOption(forge));
    select.append(group);
  }
}
function parseGitHubInput(text) {
  const match=/^(?:https?:\/\/[^/\s]+\/|git@[^:\s]+:)?([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+?)(?:\.git)?(?:\/.*)?$/.exec(text.trim());
  return match ? match[1] : null;
}
async function openGitHubPicker(forge='github') {
  closeProjectCreateMenu();
  if(activeId || pendingOpenId || githubAdding)return;
  repositoryPickerForge=forge;
  const seq=++githubSeq,search=$('#github-search');
  $('#github-title').textContent=forge==='gitea'?'选择已有 Gitea 仓库':'添加 GitHub 仓库';
  search.placeholder=forge==='gitea'?'搜索仓库，或输入 owner/repo':'搜索仓库，或粘贴 owner/repo、仓库 URL';
  search.setAttribute('aria-label','搜索 '+FORGE_NAMES[forge]+' 仓库');
  $('#github-list').setAttribute('aria-label',FORGE_NAMES[forge]+' 仓库');
  $('#github-modal').classList.remove('hidden');search.value='';githubRepos=null;githubError='';renderGitHubPicker();
  setTimeout(()=>search.focus(),0);
  try{const repos=await workspaceApi({action:forge+'_repos'});if(seq===githubSeq)githubRepos=Array.isArray(repos) ? repos : [];}
  catch(e){if(seq===githubSeq){githubRepos=[];githubError=e.message;}}
  if(seq===githubSeq)renderGitHubPicker();
}
function closeGitHubPicker() { githubSeq++;$('#github-modal').classList.add('hidden'); }
function renderGitHubPicker() {
  const list=$('#github-list'),query=$('#github-search').value.trim(),lower=query.toLowerCase(),repos=githubRepos || [];
  $('#github-sub').textContent=githubRepos ? `${repos.length} 个可访问仓库` : '正在读取…';
  list.replaceChildren();
  if(!githubRepos){list.append(el('div','github-empty','正在读取 Host 令牌可访问的 '+FORGE_NAMES[repositoryPickerForge]+' 仓库…'));return;}
  const typed=repositoryPickerForge==='github'?parseGitHubInput(query):(/^[A-Za-z0-9_][A-Za-z0-9_.-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(query)?query:null);
  if(typed && !repos.some(r=>r.fullName.toLowerCase()===typed.toLowerCase()))list.append(githubRow({fullName:typed,typed:true}));
  const matches=repos.filter(r=>!lower || r.fullName.toLowerCase().includes(lower) || (r.description || '').toLowerCase().includes(lower));
  for(const repo of matches.slice(0,200))list.append(githubRow(repo));
  if(!list.children.length)list.append(el('div','github-empty',githubError ? FORGE_NAMES[repositoryPickerForge]+' 仓库列表不可用：'+githubError : query ? '没有匹配的仓库；可直接输入 owner/repo。' : 'Host 令牌没有可访问的仓库；可直接粘贴 owner/repo。'));
  else if(githubError)list.prepend(el('div','github-empty github-error',FORGE_NAMES[repositoryPickerForge]+' 仓库列表不可用：'+githubError));
}
function githubRow(repo) {
  const row=el('button','github-row');row.type='button';row.setAttribute('role','option');row.dataset.repo=repo.fullName;
  const [owner,name]=repo.fullName.split('/');
  const title=el('span','github-row-name');title.append(el('span','github-owner',owner+'/'),el('strong','',name));
  const badges=el('span','github-badges'),badge=(text,kind='')=>badges.append(el('span','plugin-badge'+(kind ? ' '+kind : ''),text));
  if(repo.typed)badge('按名称添加');
  if(repo.private)badge('私有');
  if(repo.projectId)badge('已添加','added');
  if(repo.archived)badge('已归档','muted');else if(!repo.typed && !repo.canPush)badge('无写权限','muted');
  const blocked=!repo.typed && !repo.projectId && (repo.archived || !repo.canPush);
  const meta=githubAdding===repo.fullName ? '正在核对权限并添加…' : repo.typed ? 'Host 会核对写权限和 VM Git 访问后再添加'
    : [repo.defaultBranch ? '默认分支 '+repo.defaultBranch : '',repo.description || ''].filter(Boolean).join(' · ');
  row.append(title,badges,el('span','github-row-meta',meta));
  row.disabled=Boolean(githubAdding) || blocked;
  row.title=blocked ? (repo.archived ? '仓库已归档' : 'Host 令牌没有这个仓库的写权限，任务分支无法推送') : repo.fullName;
  row.addEventListener('click',()=>void chooseGitHubRepo(repo));
  return row;
}
async function chooseGitHubRepo(repo) {
  if(githubAdding)return;
  if(repo.projectId){closeGitHubPicker();selectNewTaskProject(repo.projectId);return;}
  const forge=repositoryPickerForge,seq=githubSeq,epoch=taskSelectionEpoch,previousProject=ui.projectSelect.value;
  githubAdding=repo.fullName;renderGitHubPicker();
  try {
    const project=await workspaceApi({action:forge+'_project',repository:repo.typed ? $('#github-search').value.trim() : repo.fullName});
    githubAdding='';
    const pickerUnchanged=seq===githubSeq;
    if(pickerUnchanged)closeGitHubPicker();
    await loadWorkspace();
    if(pickerUnchanged && epoch===taskSelectionEpoch && ui.projectSelect.value===previousProject)selectNewTaskProject(project.id);
    toast(FORGE_NAMES[forge]+' 仓库已添加：'+project.name);
  }catch(e){toast(e.message);}
  finally{githubAdding='';if(!$('#github-modal').classList.contains('hidden'))renderGitHubPicker();}
}
function selectNewTaskProject(id) {
  if(activeId || pendingOpenId || $('#task-kind').value!=='project' || ![...ui.projectSelect.options].some(o=>o.value===id))return;
  ui.projectSelect.value=id;ui.projectSelect.dispatchEvent(new Event('change'));
}
$('#github-search').addEventListener('input',renderGitHubPicker);
$('#github-search').addEventListener('keydown',event=>{
  if(event.key==='Enter'){event.preventDefault();$('#github-list').querySelector('.github-row:not(:disabled)')?.click();}
  if(event.key==='ArrowDown'){event.preventDefault();$('#github-list').querySelector('.github-row:not(:disabled)')?.focus();}
});
$('#github-list').addEventListener('keydown',event=>{
  if(!['ArrowDown','ArrowUp'].includes(event.key))return;
  event.preventDefault();const rows=[...$('#github-list').querySelectorAll('.github-row:not(:disabled)')],index=rows.indexOf(document.activeElement);
  if(event.key==='ArrowUp' && index<=0){$('#github-search').focus();return;}
  rows[Math.min(rows.length-1,index+(event.key==='ArrowDown'?1:-1))]?.focus();
});
$('#github-close').addEventListener('click',closeGitHubPicker);
$('#github-modal').addEventListener('click',event=>{if(event.target===$('#github-modal'))closeGitHubPicker();});
$('#project-add').addEventListener('click',async()=> {
  closeBrandMenu();
  const name=await askModal({title:'新建项目',text:'使用英文字母、数字、短横线或下划线。已存在的目录不会被覆盖。',input:'',okLabel:'下一步'});if(!name)return;
  const source=await askModal({title:'项目来源',text:'留空创建空 Git 项目；填写 HTTP(S)/SSH Git URL 克隆。导入 ZIP 请填写 zip:文件名（先在现有对话上传）。',input:'',okLabel:'创建'});if(source===null)return;
  try {
    const data=source.startsWith('zip:') ? {action:'import',name,scope:activeId,file:source.slice(4)} : {action:'project',name,url:source || undefined};
    const p=await workspaceApi(data);await loadWorkspace();ui.projectSelect.value=p.id;showArchived=false;renderProjectContext();renderSessionList();toast('项目已创建');
  } catch(e){toast(e.message);}
});
function renderSyncState() {
  const node=$('#sync-state');if(!node)return;
  if(!workspaceSync){node.textContent='';node.classList.add('hidden');return;}
  const labels={synced:'已同步',unpublished:'未发布',ahead:'待推送',behind:'远端较新',diverged:'已分叉',unknown:'未知 / 上次值已陈旧',local:'本地文件 · 不适用 Git 同步',branch_mismatch:'分支已改变 · 暂停推送'};
  node.textContent=`${labels[workspaceSync.state] || workspaceSync.state}${workspaceSync.dirty ? ' · 有本地改动' : ''}`;
  node.title=workspaceSync.error || (workspaceSync.remoteSha ? `远端 ${workspaceSync.remoteSha.slice(0,12)} · ${workspaceSync.lastRemoteAt || ''}` : '远端分支尚未确认');node.classList.remove('hidden');node.dataset.state=workspaceSync.state;
}
async function refreshWorkspaceStatus() {
  if(!activeId)return;const id=activeId;try{const value=await workspaceApi({action:'status',id});if(id!==activeId)return;workspaceSync=value;}catch(e){if(id!==activeId)return;workspaceSync={...workspaceSync,state:'unknown',error:e.message};}renderSyncState();renderProjectContext();
}
$('#checkpoint-workspace').addEventListener('click',async()=>{
  const id=activeId;if(!id)return toast('请先打开代码对话');
  try {
    const changes=await workspaceApi({action:'changes',id}),paths=changes?.checkpointPaths || [];
    if(id!==activeId)return;
    let result;
    if(!paths.length)result=await workspaceApi({action:'sync',id});
    else{
      const message=await askModal({title:'创建并推送 Checkpoint',text:`将提交当前任务 ${id} 的 ${paths.length} 个文件；私密路径不会包含。`,input:'checkpoint: work in progress',okLabel:'提交并推送'});
      if(!message || id!==activeId)return;
      result=await workspaceApi({action:'checkpoint',id,paths,message});
    }
    if(id!==activeId)return;workspaceSync=result;renderSyncState();await refreshWorkspaceChanges(false);toast('提交已由远端 SHA 确认');
  }catch(e){if(id===activeId){await refreshWorkspaceStatus();toast(e.message);}}
});
// 创建 PR is one click: commit + push what is pending (Checkpoint), then open the PR on the Project's forge.
function defaultPullRequestTitle() {
  const session=sessions.find(s=>s.id===activeId);const title=session ? sessionTitle(session) : '';
  return title && title!=='新对话' ? title.slice(0,120) : 'PI Coffee Conversation changes';
}
async function createPullRequest() {
  const id=activeId,task=currentTask();
  if(!id || !task || task.workspaceKind==='chat')return toast('请先打开代码任务');
  if(task.pullRequest?.url){window.open(task.pullRequest.url,'_blank','noopener,noreferrer');return;}
  if(prBusy)return;
  if(streaming)return toast('请等待当前轮次结束，再创建 PR');
  prBusy='检查改动…';renderStripActions();
  try {
    const [changes,status]=await Promise.all([workspaceApi({action:'changes',id}),workspaceApi({action:'status',id})]);
    if(id!==activeId)return;
    const blocked={behind:'远端分支比本地新，请先在 VM 同步后再创建 PR',diverged:'本地与远端分支已分叉，请先在 VM 处理后再创建 PR',branch_mismatch:'Checkout 不在任务分支上，已暂停推送'}[status.state];
    if(blocked)throw new Error(blocked);
    const paths=changes?.checkpointPaths || [],unpushed=status.state!=='synced',forge=forgeName(taskProject(task));
    const text=paths.length ? `将先提交并推送 ${paths.length} 个文件（Checkpoint），再创建 ${forge} PR。私密路径不会包含。`
      : unpushed ? `将先推送任务分支，再创建 ${forge} PR。` : `为当前任务分支创建 ${forge} PR；合并在 ${forge} 中完成。`;
    prBusy='';renderStripActions();
    const title=await askModal({title:'创建 PR',text,input:defaultPullRequestTitle(),okLabel:'创建 PR'});
    if(!title || id!==activeId)return;
    if(streaming)return toast('Agent 正在运行，已取消创建 PR');
    prBusy=paths.length ? '提交中…' : unpushed ? '推送中…' : '创建中…';renderStripActions();
    if(paths.length)workspaceSync=await workspaceApi({action:'checkpoint',id,paths,message:title});
    else if(unpushed)workspaceSync=await workspaceApi({action:'sync',id});
    if(id===activeId)renderSyncState();
    prBusy='创建中…';renderStripActions();
    const pr=await workspaceApi({action:'pull_request',id,title});
    await loadWorkspace();
    toast(`PR #${pr.number} 已创建 · 点「PR #${pr.number}」在 ${forge} 打开`);
  }catch(e){toast(e.message);if(id===activeId)await refreshWorkspaceStatus();}
  finally{prBusy='';renderStripActions();if(id===activeId)void refreshWorkspaceChanges(false).catch(()=>undefined);}
}
$('#pull-request').addEventListener('click',()=>{void createPullRequest();});
$('#branch-diff').addEventListener('click',()=>{
  if($('#diff-dialog').open && diffScope==='branch'){closeDiffDialog(true);return;}
  void showDiffDialog(null,{scope:'branch'});
});
$('#migrate-workspace').addEventListener('click',async()=>{
  const id=activeId;if(!id)return;
  try {
    const conversation=workspaceState.conversations.find(c=>c.id===id),project=workspaceState.projects.find(p=>p.id===conversation?.projectId);if(!conversation || !project)return;
    if(!project.repoUrl){const repoUrl=await askModal({title:'绑定 Gitea Repository',text:'填写无凭据的 clone URL。旧目录会保留用于回滚。',input:'',okLabel:'验证并绑定'});if(!repoUrl)return;await workspaceApi({action:'bind_project',projectId:project.id,repoUrl});}
    const plan=await workspaceApi({action:'migration_plan',id});const ok=await askModal({title:'迁移为独立 Checkout',text:`旧目录：${plan.legacyCwd}\n本地改动：${plan.dirty?'有，将复制':'无'}\n迁移完成前不会删除旧目录。`,okLabel:'开始迁移'});if(!ok || id!==activeId)return;
    await workspaceApi({action:'migrate',id});await loadWorkspace();toast('Checkout 已迁移；旧目录仍保留');
  }catch(e){toast(e.message);}
});
function fileEndpoint(route,path) {
  if(!transfer)throw new Error('请先打开对话以获取 VM 文件授权');
  const u=new URL('/api/localsend/v2/'+route,transfer.url);u.search=new URLSearchParams({scope:transfer.scope,token:transfer.token,...(path===undefined?{}:{path})});return u.href;
}
function currentTask() { return workspaceState?.conversations.find(c=>c.id===activeId) || null; }
function taskProject(task) { return workspaceState?.projects.find(p=>p.id===task?.projectId) || null; }
// Strip right side: "+A −D ›" (task branch vs base) opens the Diff; 创建 PR / PR #N ↗.
function renderStripActions(task=currentTask()) {
  const work=Boolean(task) && task.workspaceKind!=='chat' && task.creationState!=='failed' && task.creationState!=='creating';
  const files=work && workspaceChanges ? workspaceChanges.files : [];
  const diff=$('#branch-diff');diff.classList.toggle('hidden',!files.length);
  if(files.length) {
    const add=files.reduce((sum,file)=>sum+(typeof file.additions==='number' ? file.additions : 0),0);
    const del=files.reduce((sum,file)=>sum+(typeof file.deletions==='number' ? file.deletions : 0),0);
    $('#branch-diff-add').textContent=add ? '+'+add : '';$('#branch-diff-del').textContent=del ? '−'+del : '';
    $('#branch-diff-files').textContent=add || del ? '' : files.length+' 个文件';
    diff.setAttribute('aria-label',`查看改动：${files.length} 个文件，新增 ${add} 行，删除 ${del} 行`);
  }
  diff.setAttribute('aria-expanded',String($('#diff-dialog').open));
  const pr=$('#pull-request'),label=$('#pull-request-label'),hasCheckout=work && Boolean(task.startSha);
  pr.classList.toggle('hidden',!hasCheckout);
  if(!hasCheckout)return;
  const opened=task.pullRequest?.url ? task.pullRequest : null;
  pr.classList.toggle('pr-open',Boolean(opened));
  label.textContent=prBusy || (opened ? `PR #${opened.number} ↗` : '创建 PR');
  pr.setAttribute('aria-label',label.textContent);
  const forge=forgeName(taskProject(task));
  pr.title=opened ? `在 ${forge} 打开 PR #${opened.number}（${opened.state || 'open'}）` : `提交并推送当前改动，然后创建 ${forge} PR`;
  pr.disabled=Boolean(prBusy) || (!opened && streaming);
}
function renderWorkspaceSummary(data=workspaceChanges) {
  renderStripActions();
  const node=$('#workspace-summary');if(!node)return;
  if(!data || !data.files.length){node.replaceChildren();return;}
  const add=data.files.reduce((sum,file)=>sum+(typeof file.additions==='number' ? file.additions : 0),0);
  const del=data.files.reduce((sum,file)=>sum+(typeof file.deletions==='number' ? file.deletions : 0),0);
  node.replaceChildren(el('span','wt-add','+'+add),el('span','wt-del','−'+del));
}
async function refreshWorkspaceChanges(announce=true) {
  if(!workspaceState || !activeId || !workspaceState.conversations.some(c=>c.id===activeId)){workspaceChanges=null;selectedChangedPath=null;renderWorkspaceSummary();renderWorkspaceList();return null;}
  if(announce)toast('正在读取改动与检查结果…');
  if(workspaceState.conversations.find(c=>c.id===activeId)?.workspaceKind==='chat'){workspaceChanges=null;selectedChangedPath=null;renderWorkspaceSummary();renderWorkspaceList();return null;}
  const id=activeId;const changes=await workspaceApi({action:'changes',id});if(id!==activeId)return null;workspaceChanges=changes;
  if(selectedChangedPath && !workspaceChanges.files.some((file) => file.path === selectedChangedPath)) selectedChangedPath=null;
  renderWorkspaceSummary();
  renderWorkspaceList();
  return workspaceChanges;
}
function changeFileStats(file) {
  return file.additions==null && file.deletions==null ? (file.status==='?' ? '未跟踪' : '二进制') : `+${file.additions ?? 0} −${file.deletions ?? 0}`;
}
function changedFileRow(file, { selected = false } = {}) {
  const code=file.status==='?' ? 'U' : String(file.status).toUpperCase();
  const row=el('button','file-row workspace-change-row' + (selected ? ' selected' : ''));
  row.type='button';
  row.title=`查看 ${file.path} 的改动`;
  row.setAttribute('aria-current',selected ? 'true' : 'false');
  const status=el('span','workspace-change-status '+code.toLowerCase(),code);
  const path=el('span','workspace-change-path',file.path);path.title=file.path;
  const stats=el('span','workspace-change-stats',changeFileStats(file));
  row.append(status,path,stats);
  return row;
}
function changedFilesCard(data) {
  const add=data.files.reduce((sum,file)=>sum+(typeof file.additions==='number' ? file.additions : 0),0);
  const del=data.files.reduce((sum,file)=>sum+(typeof file.deletions==='number' ? file.deletions : 0),0);
  const card=el('details','changes-card');
  card.setAttribute('aria-label','本轮 Checkout 变更');
  const head=el('summary','changes-card-head');
  head.append(
    el('strong','changes-card-title',`本轮已编辑 ${data.files.length} 个文件`),
    el('span','changes-card-stats',`+${add} −${del}`),
  );
  card.append(head);
  const list=el('div','changes-card-list');
  for(const file of data.files) {
    const row=changedFileRow(file,{selected:selectedChangedPath===file.path});
    row.addEventListener('click',()=>showDiffDialog(file.path,{scope:'turn'}));
    list.append(row);
  }
  card.append(list);
  const actions=el('div','changes-card-actions');
  const review=el('button','btn small','查看改动');
  review.type='button';review.addEventListener('click',()=>showDiffDialog(null,{scope:'turn'}));
  actions.append(review);
  card.append(actions);
  return card;
}
async function maybeRenderChangesCard(force=false) {
  const task=currentTask();
  if(!task || task.workspaceKind==='chat' || task.engine==='claude' || streaming)return;
  const id=activeId,selection=taskSelectionEpoch;
  const checked=id+':'+selection+':'+JSON.stringify(task.turnSnapshot);
  if(!force && checked===changeCardChecked)return;
  const epoch=++changeCardEpoch;
  let data;
  try{data=await workspaceApi({action:'changes',id,scope:'turn'});}catch{data=null;}
  if(id!==activeId || selection!==taskSelectionEpoch || epoch!==changeCardEpoch || streaming)return;
  changeCardChecked=checked;
  if(!data || data.scope!=='turn' || data.running || !data.files?.length){
    ui.thread.querySelectorAll('.changes-card').forEach(card=>card.remove());
    lastChangeCardSignature='';return;
  }
  const signature=id+':'+data.base+':'+data.startedAt+':'+data.files.map(file=>[file.path,file.status,file.additions,file.deletions].join(':')).join('|');
  if(signature===lastChangeCardSignature && ui.thread.querySelector('.changes-card'))return;
  lastChangeCardSignature=signature;
  ui.thread.querySelectorAll('.changes-card').forEach(card=>card.remove());
  appendNode(changedFilesCard(data));
}
function middleTruncate(path,max=24) {
  if(path.length<=max)return path;
  const base=path.split('/').pop() || path;
  const head=(path.split('/')[0] || '').slice(0,12);
  let out=(head && base!==path) ? head+'…'+base : base;
  if(out.length>max){const keep=Math.floor((max-1)/2);out=out.slice(0,keep)+'…'+out.slice(-(max-1-keep));}
  return out;
}
function renderWorkspaceList(data=workspaceChanges) {
  const node=$('#workspace-list');if(!node)return;
  node.replaceChildren();
  if(!workspaceState || !activeId || !workspaceState.conversations.some(c=>c.id===activeId)){node.append(el('p','workspace-empty','打开项目对话以查看变更。'));return;}
  if(workspaceState.conversations.find(c=>c.id===activeId)?.workspaceKind==='chat'){node.append(el('p','workspace-empty','Chat 没有项目变更。'));return;}
  if(!data){node.append(el('p','workspace-empty','正在读取变更…'));return;}
  if(!data.files.length){node.append(el('p','workspace-empty','没有变更。'));return;}
  for(const file of data.files) {
    const row=el('button','wt-file'+(selectedChangedPath===file.path ? ' selected' : ''));
    row.type='button';
    row.title=file.path;row.setAttribute('aria-label',`查看 ${file.path} 的改动`);
    const stats=el('span','wt-file-stats');
    if(typeof file.additions==='number' && file.additions>0)stats.append(el('span','wt-add','+'+file.additions));
    if(typeof file.deletions==='number' && file.deletions>0)stats.append(el('span','wt-del','−'+file.deletions));
    if(!stats.children.length)stats.append(el('span','wt-new',file.additions==null && file.deletions==null ? (file.status==='?' ? '未跟踪' : '二进制') : '±0'));
    row.append(el('span','wt-file-name',middleTruncate(file.path)),stats);
    row.addEventListener('click',()=>showWorkspaceReview('diff',file.path));
    node.append(row);
  }
}
function setReviewTab(tab) {
  for(const [id,name] of [['files-diff','diff'],['files-checks','checks']]) {
    const active=Boolean(tab) && tab===name;
    $('#'+id).classList.toggle('active',active);
    $('#'+id).setAttribute('aria-selected',String(active));
  }
}
function closeWorkspaceDetail() {
  workspaceDetailOpen=false;
  selectedChangedPath=null;
  $('#workspace-panel').classList.remove('detail-open');
  $('#workspace-detail').classList.add('hidden');
  setReviewTab('diff');
  renderWorkspaceList();
}
function reviewHead(label) {
  const head=el('div','wt-detail-head');
  const back=el('button','btn small','‹ 返回');back.type='button';back.title='返回变更文件列表';
  back.addEventListener('click',closeWorkspaceDetail);
  head.append(back,el('span','wt-detail-title',label));
  return head;
}
// ---------- Diff: docked right column beside the chat (full-screen overlay below 1100px) ----------
function openDialogElement(dialog) { if(dialog.open)return; if(typeof dialog.show==='function')dialog.show(); else dialog.setAttribute('open',''); }
function closeDialogElement(dialog) { if(!dialog.open)return; if(typeof dialog.close==='function')dialog.close(); else dialog.removeAttribute('open'); }
function shortSha(value) { return typeof value==='string' && value ? value.slice(0,8) : '—'; }
function clockTime(value) { const date=new Date(value);return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
// 最近一轮 needs the Host's start-of-turn snapshot (Pi and Codex Work tasks).
function turnScopeState(task=currentTask()) {
  if(!task || task.workspaceKind==='chat')return {available:false,reason:'聊天没有项目改动'};
  if((task.engine || 'pi')==='claude')return {available:false,reason:'Claude Code 暂不支持最近一轮'};
  if(!task.turnSnapshot)return {available:false,reason:'发送消息后开始记录最近一轮'};
  if(!task.turnSnapshot.tree)return {available:false,reason:'最近一轮快照不可用'};
  return {available:true,reason:''};
}
function diffScopeInfo(data) {
  if(data.scope==='turn')return `最近一轮 · 开始于 ${clockTime(data.startedAt)}${data.running?' · 仍在运行':''}\n快照 ${shortSha(data.base)} → 当前工作区`;
  return `${data.branch}\n基线 ${shortSha(data.base)} · 目标 ${shortSha(data.target)}\n${data.stale?'远端刷新失败 · 基线可能陈旧':'刷新 '+clockTime(data.refreshedAt)}`;
}
function renderDiffScope() {
  const turn=turnScopeState();
  $('#diff-scope-label').textContent=diffScope==='turn' ? '最近一轮' : '分支改动';
  for(const scope of ['branch','turn'])$('#diff-scope-'+scope).setAttribute('aria-checked',String(scope===diffScope));
  $('#diff-scope-turn').disabled=!turn.available && diffScope!=='turn';
  $('#diff-scope-turn-note').textContent=turn.available ? '只看最近一轮改动的文件' : turn.reason;
}
function closeDiffScopeMenu() {
  $('#diff-scope-menu').classList.add('hidden');
  $('#diff-scope').setAttribute('aria-expanded','false');
}
function toggleDiffScopeMenu() {
  const menu=$('#diff-scope-menu');
  if(!menu.classList.contains('hidden')){closeDiffScopeMenu();return;}
  renderDiffScope();
  menu.classList.remove('hidden');$('#diff-scope').setAttribute('aria-expanded','true');
  setTimeout(()=>menu.querySelector('[aria-checked="true"]')?.focus(),0);
}
function syncCollapseToggle() {
  const files=[...$('#diff-content').querySelectorAll('.review-file')];
  const expanded=!files.length || files.some(file=>file.open);
  const label=expanded ? '收起全部文件' : '展开全部文件',button=$('#diff-collapse');
  button.dataset.state=expanded ? 'expanded' : 'collapsed';
  button.setAttribute('aria-label',label);button.disabled=!files.length;
  $('#diff-collapse-tip').textContent=label;
}
// The file list is diff-view.js: @pierre/diffs with per-file lazy loading, or review.js as fallback.
function getDiffView() {
  return diffView ??= new DiffView($('#diff-content'),{onCommentsChange:renderDiffComments,onNotice:toast});
}
function renderDiffComments(count, otherScopeCount = 0) {
  $('#diff-comments').classList.toggle('hidden',!count);
  $('#diff-comments-count').textContent=otherScopeCount > 0 ? `评论 (${count}，含另一视图 ${otherScopeCount} 条)` : `评论 (${count})`;
}
function renderWorkspaceDiff(data, focusPath=null, {preserve=false}={}) {
  $('#diff-scope-info').textContent=diffScopeInfo(data);
  for(const mode of ['unified','split'])$('#diff-'+mode).setAttribute('aria-pressed',String(mode===reviewLayout));
  const id=activeId,scope=data.scope,base=data.base;
  // Whole per-file patches (and both sides' text for expanding context) come from the same scope and base.
  const loadFile=(path,extra={})=>workspaceApi({action:'change_file',id,scope,base,path,...extra});
  getDiffView().render(data,{taskId:id,layout:reviewLayout,theme:document.documentElement.dataset.theme==='dark' ? 'dark' : 'light',loadFile,focusPath,preserve});
  syncCollapseToggle();
}
function showDiffMessage(node) {
  getDiffView().teardown();
  $('#diff-content').replaceChildren(node);
}
async function loadDiff(focusPath=null, {preserve=false}={}) {
  const id=activeId,epoch=++diffEpoch,scope=diffScope,dialog=$('#diff-dialog');diffTaskId=id;
  renderDiffScope();
  if(!preserve)showDiffMessage(el('p','workspace-empty','正在读取改动…'));
  try {
    const data=scope==='turn' ? await workspaceApi({action:'changes',id,scope:'turn'}) : await refreshWorkspaceChanges(false);
    if(!data || id!==activeId || epoch!==diffEpoch || !dialog.open)return;
    if(scope==='turn' && data.scope!=='turn')throw new Error('当前 Host 不支持「最近一轮」改动，请更新 VM 上的 PI Coffee');
    diffData={...data,scope};
    renderWorkspaceDiff(diffData,focusPath,{preserve});
  } catch(e) {
    if(id===activeId && epoch===diffEpoch && dialog.open){diffData=null;$('#diff-scope-info').textContent='';showDiffMessage(el('p','workspace-warning',e.message));syncCollapseToggle();}
  }
}
function turnDiffLive(){return $('#diff-dialog').open && diffScope==='turn';}
function scheduleTurnDiffRefresh(){
  if(!turnDiffLive())return;
  if(turnDiffLoading){turnDiffAgain=true;return;}
  if(!turnDiffTimer)turnDiffTimer=setTimeout(runTurnDiffRefresh,TURN_DIFF_REFRESH_MS);
}
async function runTurnDiffRefresh(){
  turnDiffTimer=null;
  if(!turnDiffLive())return;
  // Rebuilding a file under a comment being typed would move the caret: wait until focus leaves.
  if(document.activeElement?.closest?.('#diff-content .diff-comment-box')){turnDiffTimer=setTimeout(runTurnDiffRefresh,TURN_DIFF_REFRESH_MS);return;}
  turnDiffLoading=true;
  try{await loadDiff(null,{preserve:true});}
  finally{turnDiffLoading=false;if(turnDiffAgain){turnDiffAgain=false;scheduleTurnDiffRefresh();}}
}
function cancelTurnDiffRefresh(){clearTimeout(turnDiffTimer);turnDiffTimer=null;turnDiffAgain=false;}
async function showDiffDialog(path=null, {scope}={}) {
  const task=currentTask();
  if(task?.workspaceKind==='chat')return toast('聊天没有项目改动');
  if(!workspaceState || !activeId)return toast('请先打开项目对话');
  if(scope)diffScope=scope;
  if(!scope && diffScope==='turn' && !turnScopeState(task).available)diffScope='branch';
  selectedChangedPath=path;
  const dialog=$('#diff-dialog');
  if(!dialog.open) {
    diffReturnFocus=document.activeElement instanceof HTMLElement && document.activeElement!==document.body ? document.activeElement : null;
    filesPanelBeforeDiff=ui.app.classList.contains('files-open');
    if(filesPanelBeforeDiff)setWorkspaceOpen(false);
    closeAgentMenu();closeTaskDetails();
    openDialogElement(dialog);
    ui.app.classList.add('diff-open');
    renderStripActions();
    $('#diff-close').focus();
  }
  await loadDiff(path);
}
function renderWorkspaceChecks(data) {
  const detail=$('#workspace-detail');detail.replaceChildren();
  detail.append(reviewHead('检查 · '+data.branch,{wrapToggle:false}));
  for(const check of data.checks) {
    const card=el('div','workspace-check '+(check.ok ? 'ok' : 'failed'));
    const head=el('div','workspace-check-head');
    head.append(el('span','workspace-check-icon',check.ok ? '✓' : '!'),el('strong','',check.command),el('span','workspace-check-state',check.ok ? '通过' : '发现问题'));
    card.append(head,el('pre','workspace-check-output',check.output || (check.ok ? '无问题' : '无输出')));
    detail.append(card);
  }
  detail.append(el('p','workspace-note','当前检查针对本地项目运行 git diff --check；不会自动运行测试或远程 CI。'));
}
async function showWorkspacePreview(path) {
  if(!workspaceState || !transfer || !activeId){toast('请先打开项目对话');return;}
  workspaceDetailOpen=true;
  setWorkspaceOpen(true);
  setReviewTab('');
  $('#workspace-panel').classList.add('detail-open');
  const detail=$('#workspace-detail');detail.classList.remove('hidden');
  detail.replaceChildren();
  detail.append(reviewHead('预览 · '+middleTruncate(path),{wrapToggle:false}));
  const actions=el('div','workspace-preview-actions');
  const open=el('a','btn small','外部打开');open.href=fileEndpoint('preview',path);open.target='_blank';open.rel='noopener noreferrer';
  const download=el('a','btn small','下载');download.href=fileEndpoint('workspace-download',path);download.target='_blank';download.rel='noopener noreferrer';
  actions.append(open,download);detail.append(actions);
  const url=fileEndpoint('preview',path);
  if(/\.(png|jpe?g|gif|webp|svg)$/i.test(path)) {
    const img=document.createElement('img');img.src=url;img.alt=path;img.loading='lazy';
    img.onerror=()=>detail.append(el('p','workspace-warning','图片加载失败，请外部打开或下载。'));
    detail.append(img);return;
  }
  if(/\.pdf$/i.test(path)) {
    const frame=document.createElement('iframe');frame.src=url;frame.title=path;frame.referrerPolicy='no-referrer';frame.setAttribute('sandbox','');
    frame.onerror=()=>detail.append(el('p','workspace-warning','沙箱内无法渲染 PDF，请外部打开或下载。'));
    detail.append(frame,el('p','workspace-note','PDF 在沙箱中预览；需要完整查看时请外部打开或下载。'));return;
  }
  try {
    const r=await fetch(url);
    if(!r.ok)throw new Error('预览不可用，请下载');
    if(!/^(text\/|application\/json)/i.test(r.headers.get('content-type') || ''))throw new Error('此格式不支持文本预览，请下载');
    const text=await r.text();
    if(selectedChangedPath!==null)selectedChangedPath=null;
    if(/\.md$/i.test(path)){const body=el('div','markdown');body.innerHTML=renderMarkdown(text);detail.append(body);bindWorkspaceArtifacts();}
    else detail.append(el('pre','file-text',text));
  } catch(e){detail.append(el('p','workspace-warning',e.message));}
}
async function showWorkspaceReview(tab,path=null) {
  if(!workspaceState || !activeId){toast('请先打开项目对话');return;}
  if(tab==='diff')return showDiffDialog(path,{scope:'branch'});
  selectedChangedPath=null;
  workspaceDetailOpen=true;
  setWorkspaceOpen(true);
  setReviewTab(tab);
  $('#workspace-panel').classList.add('detail-open');
  const detail=$('#workspace-detail');detail.classList.remove('hidden');
  detail.replaceChildren(el('p','workspace-empty','正在读取 Diff / Checks…'));
  try {
    const data=await refreshWorkspaceChanges(false);
    if(!data)return;
    renderWorkspaceChecks(data);
  }
  catch(e){detail.replaceChildren(el('p','workspace-empty',e.message));toast(e.message);}
}
async function downloadWorkspacePatch() {
  if(!workspaceState || !activeId){toast('请先打开项目对话');return;}
  const data=workspaceChanges || await refreshWorkspaceChanges(false);
  if(!data)return;
  if(!data.patch){toast('没有可下载的文本变更');return;}
  const blob=new Blob([data.patch],{type:'text/plain;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=((data.projectId || 'workspace')+'-'+(data.branch || 'changes')+'.patch').replace(/[^\w.-]+/g,'-');
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  if(data.truncated)toast('补丁仅含前 150 KB；完整内容请在 VM 使用 git diff 导出。');
}
$('#files-toggle').addEventListener('click',()=>{const open=!ui.app.classList.contains('files-open');setWorkspaceOpen(open);if(open){renderWorkspaceList();void refreshWorkspaceChanges(false).catch(e=>toast(e.message));}});
$('#files-close').addEventListener('click',()=>setWorkspaceOpen(false));
$('#files-diff').addEventListener('click',closeWorkspaceDetail);
$('#files-checks').addEventListener('click',()=>{showWorkspaceReview('checks').catch(e=>toast(e.message));});
$('#view-all-changes').addEventListener('click',()=>{showWorkspaceReview('diff').catch(e=>toast(e.message));});
$('#wt-download').addEventListener('click',()=>{void downloadWorkspacePatch().catch(e=>toast(e.message));});
void loadWorkspace();
setInterval(()=>{if(!document.hidden || uploadsBusy())void loadWorkspace();},5000);
fetch('/api/me').then(r=>r.ok?r.json():null).then(user=>{if(!user)return;if(!currentUser)currentUser=user.id?'gitea-'+user.id:user.login;ui.userName.textContent=user.login||currentUser||'';ui.userBtn.classList.remove('hidden');ui.userBtn.disabled=false;}).catch(()=>{});

function bindWorkspaceArtifacts() {
 if(!workspaceState || !transfer)return;
 for(const node of document.querySelectorAll('[data-workspace-path]')) {
  const path=node.getAttribute('data-workspace-path');
  const url=fileEndpoint(node.hasAttribute('data-workspace-download')?'workspace-download':'preview',path);
  if(node.tagName==='IMG'){if(node.getAttribute('src')!==url)node.src=url;}
  else {node.href=url;node.target='_blank';node.rel='noopener noreferrer';}
 }
}
new MutationObserver(()=>bindWorkspaceArtifacts()).observe(ui.thread,{childList:true,subtree:true});

// restore=true when the user closes the panel: bring back the Checkout panel it replaced and the focus.
function closeDiffDialog(restore=false) {
  const dialog=$('#diff-dialog');
  ++diffEpoch;diffTaskId=null;diffData=null;
  diffView?.close();
  closeDiffScopeMenu();
  const wasOpen=dialog.open;
  closeDialogElement(dialog);
  ui.app.classList.remove('diff-open');
  if(!wasOpen)return;
  renderStripActions();
  const reopenFiles=restore && filesPanelBeforeDiff;filesPanelBeforeDiff=false;
  if(reopenFiles && activeId)setWorkspaceOpen(true);
  const focus=diffReturnFocus;diffReturnFocus=null;
  if(restore && focus?.isConnected && !focus.closest('.hidden'))focus.focus();
}
$('#diff-close').addEventListener('click',()=>closeDiffDialog(true));
$('#diff-dialog').addEventListener('cancel',event=>{event.preventDefault();closeDiffDialog(true);});
// Keys stay inside the panel (no global shortcuts or run abort); Escape closes the scope menu, then the panel.
$('#diff-dialog').addEventListener('keydown',event=>{
  event.stopPropagation();
  if(event.key!=='Escape')return;
  event.preventDefault();
  if(!$('#diff-scope-menu').classList.contains('hidden')){closeDiffScopeMenu();$('#diff-scope').focus();return;}
  closeDiffDialog(true);
});
$('#diff-scope').addEventListener('click',toggleDiffScopeMenu);
$('#diff-scope-menu').addEventListener('keydown',event=>{
  if(event.key!=='ArrowDown' && event.key!=='ArrowUp')return;
  event.preventDefault();
  const items=[...$('#diff-scope-menu').querySelectorAll('.review-scope-option:not(:disabled)')];
  const index=items.indexOf(document.activeElement);
  items[(index+(event.key==='ArrowDown' ? 1 : -1)+items.length)%items.length]?.focus();
});
for(const option of document.querySelectorAll('.review-scope-option'))option.addEventListener('click',()=>{
  const scope=option.dataset.scope;closeDiffScopeMenu();$('#diff-scope').focus();
  if(scope===diffScope || (scope==='turn' && !turnScopeState().available))return;
  diffScope=scope;void loadDiff();
});
for(const mode of ['unified','split'])$('#diff-'+mode).addEventListener('click',()=>{
  reviewLayout=mode;
  for(const other of ['unified','split'])$('#diff-'+other).setAttribute('aria-pressed',String(other===reviewLayout));
  if(diffData && diffTaskId===activeId){getDiffView().setLayout(mode);syncCollapseToggle();}
});
// Line comments: gathered in the Diff, summarized into one composer message that the user sends.
$('#diff-comments-send').addEventListener('click',()=>{
  const message=getDiffView().takeComments();
  if(!message)return;
  const current=ui.prompt.value.replace(/\s+$/,'');
  ui.prompt.value=current ? current+'\n\n'+message : message;
  ui.prompt.dispatchEvent(new Event('input',{bubbles:true}));
  if(window.matchMedia('(max-width: 1100px)').matches)closeDiffDialog(false);
  ui.prompt.focus();ui.prompt.setSelectionRange(ui.prompt.value.length,ui.prompt.value.length);
  toast('评论已汇总到输入框，确认后再发送');
});
$('#diff-comments-clear').addEventListener('click',()=>{
  const count=getDiffView().comments().length;
  if(count && confirm(`清空 ${count} 条改动评论？`))getDiffView().clearComments();
});
$('#diff-content').addEventListener('toggle',syncCollapseToggle,true);
$('#diff-collapse').addEventListener('click',()=>{const files=[...$('#diff-content').querySelectorAll('.review-file')];const open=!files.some(file=>file.open);for(const file of files)file.open=open;syncCollapseToggle();});
