import { initSkills } from "./skills.js";
// PI Coffee browser shell — controller. The browser is a view: conversations,
// history, models and running state live on the Host in the User VM. The only
// local value is which conversation this browser last displayed.
import {

  renderMarkdown, timeGroup, activityGroup, assistantNode, el, fillToolCard, formatBytes, installCopyHandlers,
  noteNode, patchSummary, relativeTime, renderPatchText, toolCard, toolResultDetails, toolResultText, updateActivity, updateAssistant, userBubble,
  copyText,

} from './render.js';
import { attentionOf, orderSessions, formatReset, isTerminalSession, patchFiles, sessionGroups, usageBadge } from './sidebar.js';


const ACTIVE_KEY_BASE = 'pi-coffee.active.v2';
let ACTIVE_KEY = ACTIVE_KEY_BASE;   // suffixed with the login name once /auth/me answers
import { renderReviewFile } from './review.js';
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
  diffPanel: $('#diff-panel'), dpSub: $('#dp-sub'), dpCopy: $('#dp-copy'), dpClose: $('#dp-close'), dpFiles: $('#dp-files'), dpBody: $('#dp-body'),
  turnDiffBtn: $('#turn-diff'), diffModal: $('#diff-modal'), diffBody: $('#diff-body'), diffSub: $('#diff-sub'), diffClose: $('#diff-close'), diffCopy: $('#diff-copy'),
  sessionList: $('#session-list'), search: $('#search'), queue: $('#queue'), slash: $('#slash'),
  attachments: $('#attachments'), attach: $('#attach'), file: $('#file'), hint: $('#hint'),
  agentBtn: $('#agent-menu-btn'), agentMenu: $('#agent-menu'),
  agentRows: { source: $('#agent-source-row'), model: $('#agent-model-row'), thinking: $('#agent-thinking-row') },
  agentPanes: { source: $('#agent-source-pane'), model: $('#agent-model-pane'), thinking: $('#agent-thinking-pane') },
  agentValues: { source: $('#agent-source-value'), model: $('#agent-model-value'), thinking: $('#agent-thinking-value') },
  modelSource: $('#model-source'), model: $('#model'), thinking: $('#thinking'), modeWrap: $('#mode-wrap'), mode: $('#mode'),
  projectSelect: $('#project-select'), startBranch: $('#start-branch'), projectManage: $('.project-manage'),
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
let turnDiff = '';            // cumulative unified diff of the current / last run (agents that report it)
let finishedWhileHidden = false;
const pendingToolFills = new Set();
let connected = false, opened = false, streaming = false, modelPending = null;
let activeId = null;
let currentUser = null;
function rememberTask(id){if(id){sessionStorage.setItem(ACTIVE_KEY,id);localStorage.setItem(ACTIVE_KEY,id);}else{sessionStorage.removeItem(ACTIVE_KEY);localStorage.removeItem(ACTIVE_KEY);}}
let pendingOpenId = null, queuedPrompt = null, prepareNew = false;
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
let transfer = null;           // { url, scope, token, inbox, maxFileBytes, maxBatchBytes } from the Host
let workspaceChanges = null;   // aggregate Checkout status from `/api/workspace` action `changes`
let workspaceSync = null;
let selectedChangedPath = null;
let reviewLayout='unified', diffTaskId=null, diffEpoch=0;
let workspaceDetailOpen = false; // true while a Diff/Checks document replaces the change list
let lastChangeCardSignature = '';
let filesAwaitingTransfer = []; // picked before the Session/transfer endpoint was known
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
const modelControlsLocked = () => !!modelPending || !connected || (!opened && !draftModelEngine());
function loadDraftModels() {
  if (!connected || !draftModelEngine()) return;
  catalogRequest=requestId("catalog");
  send({v:1,type:"get_model_catalog",engine:draftModelEngine(),requestId:catalogRequest});
}
function flushFirstPrompt() {
  if (!historyReady || modelPending || queuedPrompt === null) return;
  const q=queuedPrompt;queuedPrompt=null;submitPrompt(q.text,q.images);
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
  if (!open) { closeAgentMenu(); return; }
  renderAgentSettings();
  ui.agentMenu.classList.remove('hidden');
  ui.agentBtn.setAttribute('aria-expanded', 'true');
  setTimeout(() => ui.agentRows.model.focus(), 0);
}
function openAgentPane(kind) {
  closeAgentPanes();
  const pane = ui.agentPanes[kind];
  if (!pane) return;
  renderAgentPane(kind);
  pane.classList.remove('hidden');
  ui.agentRows[kind].setAttribute('aria-expanded', 'true');
}
function agentOption({ label, meta = '', selected = false, onClick }) {
  const button = el('button', 'agent-option' + (selected ? ' selected' : ''));
  button.type = 'button';
  button.setAttribute('role', 'menuitemradio');
  button.setAttribute('aria-checked', String(selected));
  button.append(el('span', 'agent-option-label', label));
  if (meta) button.append(el('span', 'agent-option-meta', meta));
  if (selected) button.append(el('span', 'agent-option-check', '✓'));
  button.addEventListener('click', onClick);
  return button;
}
function renderAgentPane(kind) {
  const pane = ui.agentPanes[kind];
  pane.replaceChildren();
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
function renderAgentSettings() {
  if (!models || !ui.agentBtn) return;
  const current = selectedModelInfo();
  const source = models.current?.source || current?.source || 'native';
  ui.agentValues.source.textContent = sourceLabel(source);
  ui.agentValues.model.textContent = models.current ? models.current.id : '—';
  ui.agentValues.model.title = models.current ? `${models.current.provider}/${models.current.id}` : '';
  const levels = models.thinkingLevels || [];
  ui.agentRows.thinking.classList.toggle('hidden', levels.length === 0);
  ui.agentValues.thinking.textContent = models.thinkingLevel || levels[0] || '—';
  ui.agentBtn.dataset.state = `${source} · ${models.current ? models.current.id : 'no model'} · ${models.thinkingLevel || 'default'}`;
  ui.agentBtn.title = `Agent · ${sourceLabel(source)} · ${models.current ? models.current.provider + '/' + models.current.id : '未选择模型'} · 思考 ${models.thinkingLevel || '默认'}`;
  ui.agentBtn.disabled = modelControlsLocked() || !models;
  for (const kind of ['source', 'model', 'thinking']) renderAgentPane(kind);
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

const CHIPS = ['列出当前目录的文件', '解释这个仓库的结构', '写一个 Python 脚本统计文件行数'];
function renderHero() {
  const hero = el('div', 'hero');
  hero.id = 'hero';
  hero.innerHTML = '<h1>有什么可以帮你？</h1><p>Agent 会在你的 User VM 中直接执行任务。</p><div class="chips"></div>';
  const chips = hero.querySelector('.chips');
  for (const text of CHIPS) {
    const chip = el('button', 'chip', text);
    chip.type = 'button';
    chip.addEventListener('click', () => { ui.prompt.value = text; ui.prompt.focus(); autoGrow(); refreshComposer(); });
    chips.appendChild(chip);
  }
  ui.thread.appendChild(hero);
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

function renderHistory(frame) {
  resetThread();
  if (frame.truncated) pushNote('更早的记录仍保存在 User VM 中，这里只显示最近的部分。');
  for (const item of frame.entries || []) {
    if (item.kind === 'user') { pushUser(item.text || '', undefined, item.imageCount); lastUserText = item.text || lastUserText; }
    else if (item.kind === 'assistant') nativeItems.set(item.id,pushAssistant(item.text || ''));
    else if (item.kind === 'tool') nativeItems.set(item.id,pushTool({ name: item.name, args: item.args, result: item.result || '', done: true, error: Boolean(item.isError), details: item.diff ? { patch: item.diff } : undefined }));
    else if (item.kind === 'note') pushNote(item.text || '');
  }
  // History groups are finished work: collapse them.
  for (const group of ui.thread.querySelectorAll('.activity')) { group.open = false; group.classList.remove('running'); }
  currentActivity = undefined;
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
  ui.sessionList.innerHTML = '';
  renderSearchResults();
  let known = sessions.slice();
  if (activeId && !known.some((s) => s.id === activeId)) known.unshift({ id: activeId, preview: '', running: streaming, messageCount: 0, updatedAt: new Date().toISOString() });
  if(workspaceState) {
    for(const c of workspaceState.conversations) if(!known.some(s=>s.id===c.id)) known.push({id:c.id,preview:c.creationState==='failed'?'创建失败 · 点击重试':c.creationState==='creating'?'创建中 · 点击恢复':c.workspaceKind==='chat'?'Chat 任务':'Work 任务',updatedAt:c.createdAt,running:false});
    known=known.filter(s=> {const c=workspaceState.conversations.find(c=>c.id===s.id);return Boolean(c?.archived || workspaceState.legacyArchived?.includes(s.id))===showArchived;});
  }
  if (known.length === 0 && !workspaceState?.projects.length) {
    ui.sessionList.appendChild(el('li', 'empty-list', '还没有对话'));
    return;
  }

  if (!workspaceState) { appendSessionGroups(ui.sessionList,known); return; }
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
  node.addEventListener('dragover',event=>{if(!sidebarDragId || sidebarSaving)return;event.preventDefault();event.dataTransfer.dropEffect='move';node.classList.add('drop-target');});
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
  }catch(error){toast(error.message);}finally{sidebarSaving=false;}
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
ui.themeToggle?.addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
ui.agentBtn?.addEventListener('click', toggleAgentMenu);
ui.agentRows.source?.addEventListener('click', () => openAgentPane('source'));
ui.agentRows.model?.addEventListener('click', () => openAgentPane('model'));
ui.agentRows.thinking?.addEventListener('click', () => openAgentPane('thinking'));
ui.agentMenu?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.stopPropagation(); closeAgentMenu(); ui.agentBtn.focus(); }
});
document.addEventListener('click', (event) => {
  if (menuNode && !menuNode.contains(event.target)) closeMenu();
  if (!event.target.closest('.brand-wrap')) closeBrandMenu();
  if (!event.target.closest('.agent-menu-wrap')) closeAgentMenu();
  if (ui.projectManage?.open && !ui.projectManage.contains(event.target)) ui.projectManage.open = false;
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
  ['system','System prompt'], ['tools','Tool definitions'], ['rules','Rules'],
  ['skills','Skills'], ['dynamic','MCP & dynamic tools'], ['subagents','Subagent definitions'], ['conversation','Conversation'],
];

function renderStats() {
  renderUsage();
  if (!statsCache || !activeId) { ui.stats.classList.add('hidden'); hideStatsPop(); return; }
  const snapshot=statsCache.contextBreakdown;
  const valid=snapshot?.version===1 && snapshot.categories?.length===7 && CONTEXT_CATEGORIES.every(([id])=>snapshot.categories.some(c=>c.id===id && Number.isSafeInteger(c.tokens) && c.tokens>=0));
  const capacity=valid?snapshot.contextWindow:statsCache.contextUsage?.contextWindow;
  const used=valid?snapshot.categories.reduce((n,c)=>n+c.tokens,0):null;
  const pct=used!==null && capacity>0?100*used/capacity:null;
  ui.stats.textContent=pct!==null?'上下文 '+Math.floor(pct)+'%':'上下文';
  ui.stats.classList.remove('hidden');ui.stats.classList.toggle('warn',pct!==null && pct>=75);
  ui.spPct.textContent=pct!==null?Math.floor(pct)+'% Full':'Usage unavailable';
  ui.spCapacity.textContent=`${used!==null?'~'+fmtTokens(used):'—'} / ${fmtTokens(capacity).replace(/\.0([KM])$/,'$1')} Tokens`;
  ui.spCapacity.title=valid?`本地 o200k_base 估算 · ${snapshot.basis==='last_request'?'最近一次实际请求':'当前已加载上下文预览'} · ${snapshot.capturedAt}`:'等待引擎分类统计';
  ui.spBar.replaceChildren();ui.spContextLegend.replaceChildren();
  for(const [id,label] of CONTEXT_CATEGORIES){
    const value=valid?snapshot.categories.find(c=>c.id===id).tokens:null;
    const row=el('div','legend-row');row.append(el('span','dot-sq c-'+id),el('span','legend-label',label),el('span','legend-val',fmtTokens(value)));ui.spContextLegend.append(row);
    if(value>0 && capacity>0){const seg=el('span','seg c-'+id);seg.style.width=(value/Math.max(capacity,used)*100)+'%';seg.style.flexShrink='0';ui.spBar.append(seg);}
  }
  const status=$('#sp-status');
  status.textContent=!valid?'分类统计暂不可用，请检查所属 VM 的 Agent 版本。':snapshot.mediaOmitted?'~ 本地文本估算；图片、音频等媒体占用未计入。':'';
  status.classList.toggle('hidden',!status.textContent);
  ui.spBar.setAttribute('aria-valuetext',pct!==null?Math.floor(pct)+'% Full':'Usage unavailable');
  if(pct!==null)ui.spBar.setAttribute('aria-valuenow',String(Math.min(100,pct)));else ui.spBar.removeAttribute('aria-valuenow');
  ui.spCompact.disabled=!opened || streaming || !supports('compact');
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
  if (!opened) return;
  if (streaming) { toast('请先停止当前任务，再执行本地压缩。'); return; }
  hideStatsPop();
  const ok = await askModal({ title: '本地压缩上下文？', text: '默认 context-fold 配置在 VM 本地生成恢复索引，不调用模型生成摘要。原始记录保留；压缩后不会自动重放任务。若插件被关闭，请先恢复默认配置。', okLabel: '本地压缩' });
  if (!ok) return;
  send({ v: 1, type: 'compact', requestId: requestId('compact') });
  toast('正在本地压缩…');
}
function offerContextRecovery(message) {
  if (!isContextError(message)) return;
  const entry = pushNote('上下文过大。可本地压缩后继续；若仍过大，请缩短本次输入或检查模型窗口配置。');
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'btn small'; button.textContent = '本地压缩上下文';
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
  const hasText = ui.prompt.value.trim().length > 0 || attachments.length > 0 || completedUploads().length > 0;
  ui.send.disabled = !connected || !hasText || uploadsBusy() || !!modelPending || (streaming && !supports("steer") && !supports("followUp"));
  ui.model.disabled = ui.modelSource.disabled = ui.thinking.disabled = modelControlsLocked();
  if (ui.agentBtn) ui.agentBtn.disabled = modelControlsLocked() || !models;
  renderProjectContext();
  ui.stop.classList.toggle('hidden', !(connected && streaming));
  ui.modeWrap.classList.toggle('hidden', !(connected && streaming && (supports("steer") || supports("followUp"))));
  ui.pluginsBtn.classList.toggle("hidden",!supports("extensions"));ui.statsWrap.classList.toggle("hidden",!supports("stats"));
  ui.agentRows.source.classList.toggle("hidden",engine!=="pi");
  ui.send.title = uploadsBusy() ? '等待文件传输完成' : streaming && !supports('steer') && !supports('followUp') ? '等待当前轮次结束，或先停止' : streaming ? (ui.mode.value === 'steer' ? '插话：在当前工具调用后打断' : '排队：等这轮结束后发送') : '发送';
  ui.hint.textContent = streaming && !supports('steer') && !supports('followUp') ? '运行中 · 可停止当前轮次' : streaming ? '运行中 · Enter ' + (ui.mode.value === 'steer' ? '插话' : '排队') : 'Enter 发送 · Shift+Enter 换行';
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
    if (response.status === 401) { location.href = '/login'; return false; }
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
ui.userBtn.addEventListener('click', () => {
  if (!currentUser) return;
  if (!confirm('退出 PI Coffee 的登录？User VM 里正在运行的任务不会被打断。')) return;
  const form = document.createElement('form');
  form.method = 'post';
  form.action = '/auth/logout';
  document.body.appendChild(form);
  form.submit();
});
function renderProjectContext() {
  if (!ui.projectSelect || !ui.startBranch) return;
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
  for(const option of kind.options)option.textContent=option.value==='chat'?(lockedToConversation?'Chat':'Chat · 本地目录'):(lockedToConversation?'Work':'Work · Gitea 项目');
  const projectWorkspace=kind.value==='project';
  $('#project-create').classList.toggle('hidden',!projectWorkspace || lockedToConversation);
  $('#project-create').disabled=projectCreating || !!pendingOpenId;
  $('#project-create').textContent=projectCreating?'创建中…':'＋ 新建项目';
  ui.projectSelect.closest('label').classList.toggle('hidden',!projectWorkspace || lockedToConversation);
  ui.startBranch.closest('label').classList.toggle('hidden',!projectWorkspace || lockedToConversation);
  $('#create-task').classList.toggle('hidden',lockedToConversation);
  $('#create-task').textContent=!lockedToConversation && activeId?'为旧任务创建目录':'创建任务';
  $('#project-controls').classList.toggle('task-bound',lockedToConversation);
  $('.context-sep').classList.toggle('hidden',!projectWorkspace || lockedToConversation);
  const projectLink=$('#task-project');
  projectLink.classList.toggle('hidden',!activeProject?.webUrl);
  projectLink.textContent=projectLabel || '';projectLink.title=projectLabel || '';
  if(activeProject?.webUrl)projectLink.href=activeProject.webUrl;
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
  ui.projectSelect.title = activeProject ? activeProject.name : 'Gitea 仓库';
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
    loadDraftModels();
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
async function openSession(id) {
  if(!connected){toast('等待 VM 连接就绪');return;}
  if (pendingOpenId) return;            // an open is already in flight on this socket
  if (opened) { connect(); return; }    // one socket owns one Session: start over
  if(!id && !workspaceState){await loadWorkspace();if(!workspaceState){toast('工作区服务尚未就绪');return;}}
  const existing=workspaceState?.conversations.find(c=>c.id===id);
  if((!id && workspaceState) || existing?.creationState==='failed' || existing?.creationState==='creating') {
    const workspaceKind=existing?.workspaceKind || $('#task-kind').value;
    const projectId=existing?.projectId || ui.projectSelect.value;
    if(workspaceKind==='project' && !projectId) {toast('请先选择 Gitea 项目');return;}
    const selectedEngine=existing?.engine || $("#task-engine").value;
    const signature=JSON.stringify([selectedEngine,workspaceKind,projectId,existing?.startBranch || ui.startBranch.value.trim()]);
    if(!creationRequest || creationRequest.signature!==signature)creationRequest={signature,id:existing?.id || [...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join('')};
    saveCreation();pendingOpenId='creating';refreshComposer();$('#create-task').disabled=true;$('#create-task').textContent='创建中…';
    try {
      const c=await workspaceApi({action:'conversation',id:creationRequest.id,workspaceKind,engine:selectedEngine,...(workspaceKind==='project'?{projectId,branch:existing?.startBranch || ui.startBranch.value.trim() || undefined}:{})});
      id=c.id;activeId=id;rememberTask(id);creationRequest=null;saveCreation();workspaceSync=null;await loadWorkspace();
    }catch(e){pendingOpenId=null;toast(e.message);await loadWorkspace();return;}
    finally{refreshComposer();$('#create-task').disabled=false;$('#create-task').textContent='创建任务 / 重试';}
  }
  pendingOpenId = id || 'new';
  const frame = { v: 1, type: 'open', nativeProtocol:1 };
  if (id) frame.sessionId = id;
  send(frame);
}
function afterOpened() {
  refreshComposer();
  if(supports('models') && !modelPending)send({ v: 1, type: 'get_models' });
  if(supports('commands'))send({ v: 1, type: 'get_commands' });
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
      engine=frame.engine || workspaceState?.conversations.find(c=>c.id===frame.sessionId)?.engine || "pi";capabilities=frame.capabilities || null;models=null;commands=[];
      const sameTransfer=transfer?.scope===frame.sessionId;
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
      workspaceChanges=null;selectedChangedPath=null;lastChangeCardSignature='';if(workspaceDetailOpen)closeWorkspaceDetail();renderWorkspaceSummary();renderWorkspaceList();renderProjectContext();
      setTurnDiff('');

      streaming = false;
      setStreaming(Boolean(frame.state && frame.state.isStreaming));
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
      models = frame;modelPending=null;refreshComposer();
      renderModels();flushFirstPrompt();
      return;
    case 'commands':
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
      setTimeout(()=>{if(workspaceState) {renderWorkspaceList();void refreshArtifactCards();void refreshWorkspaceChanges(false).catch(()=>undefined);}},0);
      if (frame.sessionId !== activeId) return;
      transfer = frame;
      refreshToolDownloadLinks();
      renderUploadLogCard(); // relink rows with the fresh token
      if (filesAwaitingTransfer.length) { const queued = filesAwaitingTransfer; filesAwaitingTransfer = []; void uploadFiles(queued); }
      return;
    case 'ack':
      // Host treats queued input as a new prompt if the previous run already ended.
      if (frame.operation === 'prompt') queuedRequests.delete(frame.requestId);
      if (frame.operation === 'steer' || frame.operation === 'follow_up') toast(frame.operation === 'steer' ? '已插话' : '已排队');
      if (frame.operation === 'set_model' || frame.operation === 'set_thinking') send({ v: 1, type: 'get_models' });
      if (frame.operation === 'compact') setTimeout(() => send({ v: 1, type: 'get_stats' }), 800);
      return;
    case 'resync_required':
      pushNote('正在运行的这一段输出有部分未能补放；已完成的消息以上方历史为准。');
      return;
    case 'event':
      if(frame.sessionId!==activeId)return;
      if(engine!=="pi" && frame.cursor){if(frame.cursor<=nativeCursor && frame.event?.type!=="native_request")return;nativeCursor=Math.max(nativeCursor,frame.cursor);}
      handleEvent(frame.event || {});
      return;
    case 'error': {
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

  if (type === 'agent_start') { setStreaming(true); showThinking(true); currentAssistant = undefined; retryNote = undefined; setTurnDiff(''); return; }
  if (type === 'tool_execution_update') {
    // Live output of a running command: refresh the card at most once per frame.
    const entry = event.toolCallId && openTools.get(event.toolCallId);
    if (!entry || entry.done) return;
    entry.result = toolResultText(event.partialResult);
    if (!pendingToolFills.size) requestAnimationFrame(flushToolFills);
    pendingToolFills.add(entry);
    return;
  }
  if (type === 'turn_diff') { setTurnDiff(typeof event.diff === 'string' ? event.diff : ''); return; }
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
    pendingDelivery=null;uncertainTask=null;setStreaming(false);clearExtensionUi();if(supports('models'))send({v:1,type:'get_models'});
    if(event.status!=='completed')pushNote(event.message || (event.status==='interrupted'?'当前轮次已停止':'本轮运行失败，请检查保存的结果'),event.status!=='interrupted');
    void refreshWorkspaceChanges(false).catch(()=>undefined);return;
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
  if (type === 'compaction_end') { const notice = compactionNotice(event); pushNote(notice.text, notice.failure); send({ v: 1, type: 'get_stats' }); return; }

  if (type === 'agent_settled') {
    queuedRequests.clear();
    pendingDelivery=null;uncertainTask=null;
    void refreshWorkspaceChanges(false).catch(()=>undefined);
    setStreaming(false);
    notifyFinished();
    for (const entry of openTools.values()) { entry.done = true; fillToolCard(entry.node, entry); }
    openTools.clear();
    renderQueue({ steering: [], followUp: [] });
    // Any dialog still open was resolved by Pi (timeout/default); drop it.
    if (uiCurrent || uiQueue.length) { uiQueue.length = 0; closeUiDialog(); }
    send({ v: 1, type: 'get_stats' });
    void refreshWorkspaceChanges(false).then(() => maybeRenderChangesCard()).catch(() => undefined);
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

// ---------- 本轮改动 (cumulative turn diff, P2 docked review) ----------
const DOCK_MIN_WIDTH = 1100;   // below this the panel would crush the thread: use the modal
let diffDocked = false;        // user opened the docked panel; it follows later turn_diff updates
let diffRaf = 0;
function setTurnDiff(diff) {
  turnDiff = diff || '';
  const summary = patchSummary(turnDiff);
  const show = turnDiff.trim().length > 0;
  ui.turnDiffBtn.classList.toggle('hidden', !show);
  if (show) ui.turnDiffBtn.textContent = '本轮改动 ' + summary.files + ' 个文件 +' + summary.add + ' −' + summary.del;
  if (!show) { closeDiffModal(); closeDiffPanel(); return; }
  // The docked panel is live: a run that keeps editing keeps the review current.
  if (diffDocked) { cancelAnimationFrame(diffRaf); diffRaf = requestAnimationFrame(renderDiffPanel); }
}
function canDock() { return window.innerWidth >= DOCK_MIN_WIDTH; }
function openDiffReview() {
  if (!turnDiff.trim()) return;
  if (canDock()) openDiffPanel(); else openDiffModal();
}
function openDiffPanel() {
  setWorkspaceOpen(false);
  diffDocked = true;
  ui.diffPanel.classList.remove('hidden');
  ui.app.classList.add('diff-docked');
  renderDiffPanel();
}
function closeDiffPanel() {
  diffDocked = false;
  ui.diffPanel.classList.add('hidden');
  ui.app.classList.remove('diff-docked');
}
function renderDiffPanel() {
  const files = patchFiles(turnDiff);
  const summary = patchSummary(turnDiff);
  ui.dpSub.textContent = files.length + ' 个文件 · +' + summary.add + ' −' + summary.del;
  ui.dpFiles.innerHTML = '';
  ui.dpBody.innerHTML = '';
  files.forEach((file, index) => {
    const row = el('li', 'diff-file ' + file.status);
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.title = file.path;
    row.appendChild(el('span', 'path', file.path || '(未命名)'));
    row.appendChild(el('span', 'counts', '+' + file.add + ' −' + file.del));
    const jump = () => { const target = ui.dpBody.querySelector('[data-file="' + index + '"]'); if (target) target.scrollIntoView({ block: 'start' }); };
    row.addEventListener('click', jump);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); } });
    ui.dpFiles.appendChild(row);
    const section = el('section', 'diff-file-section');
    section.dataset.file = String(index);
    const head = el('h3', 'diff-file-head');
    head.appendChild(el('span', 'path', file.path || '(未命名)'));
    head.appendChild(el('span', 'counts', '+' + file.add + ' −' + file.del));
    section.appendChild(head);
    const body = el('div', 'diff-file-body');
    body.innerHTML = renderPatchText(file.text);
    section.appendChild(body);
    ui.dpBody.appendChild(section);
  });
}
function openDiffModal() {
  if (!turnDiff.trim()) return;
  const summary = patchSummary(turnDiff);
  ui.diffSub.textContent = summary.files + ' 个文件 · +' + summary.add + ' −' + summary.del;
  ui.diffBody.innerHTML = renderPatchText(turnDiff);
  ui.diffModal.classList.remove('hidden');
}
function closeDiffModal() { ui.diffModal.classList.add('hidden'); }
ui.turnDiffBtn.addEventListener('click', openDiffReview);
ui.diffClose.addEventListener('click', closeDiffModal);
ui.diffModal.addEventListener('click', (e) => { if (e.target === ui.diffModal) closeDiffModal(); });
ui.diffCopy.addEventListener('click', async () => { if (await copyText(turnDiff)) toast('已复制 diff'); });
ui.dpClose.addEventListener('click', closeDiffPanel);
ui.dpCopy.addEventListener('click', async () => { if (await copyText(turnDiff)) toast('已复制 diff'); });
// Dock <-> modal follows the window: a docked panel on a shrinking window becomes a modal.
window.addEventListener('resize', () => { if (diffDocked && !canDock()) { closeDiffPanel(); openDiffModal(); } });

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
document.addEventListener('visibilitychange', () => { if (!document.hidden && finishedWhileHidden) { finishedWhileHidden = false; renderHeader(); } });
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
let slashIndex = 0;
function slashItems() {
  const value = ui.prompt.value;
  if (!value.startsWith('/') || /\s/.test(value)) return [];
  const query = value.slice(1).toLowerCase();
  return commands.filter((c) => c.name.toLowerCase().startsWith(query)).slice(0, 8);
}
function renderSlash() {
  const items = slashItems();
  ui.slash.innerHTML = '';
  ui.slash.classList.toggle('hidden', items.length === 0);
  if (items.length === 0) return;
  slashIndex = Math.min(slashIndex, items.length - 1);
  items.forEach((c, index) => {
    const row = el('div', 'slash-item' + (index === slashIndex ? ' active' : ''));
    row.setAttribute('role', 'option');
    row.innerHTML = '<span class="slash-name">/' + c.name + '</span><span class="slash-desc"></span><span class="slash-src"></span>';
    row.querySelector('.slash-desc').textContent = c.description || '';
    row.querySelector('.slash-src').textContent = c.source === 'extension' ? '扩展' : c.source === 'skill' ? '技能' : '模板';
    row.addEventListener('mousedown', (e) => { e.preventDefault(); applySlash(c); });
    ui.slash.appendChild(row);
  });
}
function applySlash(command) {
  ui.prompt.value = '/' + command.name + ' ';
  ui.slash.classList.add('hidden');
  ui.prompt.focus();
  autoGrow();
  refreshComposer();
}

// ---------- attachments: inline images + direct file transfer ----------
const MAX_IMAGE_BYTES = 600 * 1024;
const INLINE_IMAGE_LIMIT = 4 * 1024 * 1024; // larger images travel as files
const HASH_LIMIT = 32 * 1024 * 1024;         // sha256 in the browser only for files this small

async function addFiles(files) {
  const epoch=taskSelectionEpoch;
  const toUpload = [];
  for (const file of files) {
    const isSmallImage = file.type.startsWith('image/') && file.size <= INLINE_IMAGE_LIMIT;
    if (isSmallImage) {
      // Small images go inline with the prompt so the model can see them.
      if (attachments.length >= 8) { toast('最多 8 张内联图片，其余作为文件上传'); toUpload.push(file); continue; }
      try { const image=await encodeImage(file);if(epoch!==taskSelectionEpoch)return;attachments.push(image); } catch { toast('无法读取图片'); }
      toUpload.push(file); // Persist original bytes before sending the inline representation.
    } else {
      toUpload.push(file);
    }
  }
  renderAttachments();
  refreshComposer();
  if (epoch===taskSelectionEpoch && toUpload.length) await uploadFiles(toUpload);
}

// Files go straight from the browser to the User VM over the LocalSend v2 API
// the Host advertises; the Web Server never sees a byte (ADR-0009).
async function uploadFiles(files) {
  if (!transfer) {
    filesAwaitingTransfer.push(...files);
    if (!opened && !pendingOpenId && connected) { void openSession(activeId); toast('正在为文件建立对话…'); }
    else if (opened) { toast('这个 Host 没有开启文件传输'); filesAwaitingTransfer = []; }
    return;
  }
  const grant=transfer;
  const tooBig = files.filter((f) => f.size > grant.maxFileBytes);
  if (tooBig.length) toast(`已跳过 ${tooBig.length} 个超过 ${formatBytes(grant.maxFileBytes)} 的文件`);
  const batch = files.filter((f) => f.size <= grant.maxFileBytes);
  if (batch.length === 0) return;
  const pending = uploads.filter((u) => u.state === 'uploading').reduce((s, u) => s + u.size, 0);
  if (pending + batch.reduce((s, f) => s + f.size, 0) > grant.maxBatchBytes) { toast(`一次最多传输 ${formatBytes(grant.maxBatchBytes)}`); return; }

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
  if(activeId!==grant.scope)return;
  let prepared;
  try {
    const response = await fetch(`${grant.url}/api/localsend/v2/prepare-upload?scope=${encodeURIComponent(grant.scope)}&token=${encodeURIComponent(grant.token)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ info: { alias: 'PI Coffee Web', version: '2.0', deviceModel: navigator.platform || 'browser', deviceType: 'web', fingerprint: 'web', port: 0, protocol: 'http', download: false }, files: meta }),
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || ('HTTP ' + response.status));
    prepared = await response.json();
  } catch (error) {
    for (const u of entries) { u.state = 'failed'; u.error = '无法连接 User VM 的传输端点：' + (error.message || error); }
    renderAttachments(); refreshComposer();
    toast('文件传输失败：浏览器无法直连 User VM（' + grant.url + '）');
    return;
  }
  if(activeId!==grant.scope)return;
  for (const u of entries) {
    u.sessionId = prepared.sessionId;
    u.token = prepared.files[u.id];
    if (!u.token) { u.state = 'failed'; u.error = '服务端未接受该文件'; continue; }
    void sendFile(u);
  }
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
      renderAttachments(); refreshComposer(); resolve();
    };
    xhr.onerror = () => { if (u.state !== 'cancelled') { u.state = 'failed'; u.error = '网络错误'; } renderAttachments(); refreshComposer(); resolve(); };
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
    // Keep a transcript-side aggregate so uploads stay discoverable after the rail rolls on.
    if (!uploadLog.some((f) => f.path === u.path)) { uploadLog.push({ name: u.name, size: u.size, path: u.path }); renderUploadLogCard(); }
    return;
  }
  if (event.type === 'transfer_failed' && u.state !== 'cancelled') { u.state = 'failed'; u.error = event.message || '传输失败'; renderAttachments(); refreshComposer(); }
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
    row.append(el('span', 'upload-log-name', f.name + ' · ' + formatBytes(f.size)));
    if (href) { const a = el('a', '', '下载'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; row.append(a); }
    card.append(row);
  }
  if (uploadLog.length > 20) card.append(el('p', 'workspace-note', `其余 ${uploadLog.length - 20} 个文件仍在工作区可用。`));
}

function refreshToolDownloadLinks() {
  for (const entry of entries) if (entry.k === 'tool' && entry.node) addToolDownloadLink(entry);
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
  ui.attachments.classList.toggle('hidden', attachments.length === 0 && uploads.length === 0);
  attachments.forEach((image, index) => {
    const wrap = el('div', 'attachment');
    const img = document.createElement('img');
    img.src = 'data:' + image.mimeType + ';base64,' + image.data;
    img.alt = '附图 ' + (index + 1);
    const remove = el('button', 'attachment-remove', '×');
    remove.type = 'button';
    remove.title = '移除';
    remove.addEventListener('click', () => { attachments.splice(index, 1); renderAttachments(); refreshComposer(); });
    wrap.append(img, remove);
    ui.attachments.appendChild(wrap);
  });
  for (const u of uploads) {
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
  // The command list comes from the Pi process of an open Session. Typing "/"
  // before the first message opens the new conversation early to fetch it.
  if (ui.prompt.value.startsWith('/') && !opened && !pendingOpenId && connected) openSession(null);
  renderSlash();
});
ui.prompt.addEventListener('keydown', (event) => {
  const slashOpen = !ui.slash.classList.contains('hidden');
  if (slashOpen) {
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
  if ((!text && attachments.length === 0 && files.length === 0) || !socket || socket.readyState !== WebSocket.OPEN) return;
  if(modelPending){toast('等待模型来源切换确认');return;}
  if (uploadsBusy() || uploads.some(u=>u.state==='failed')) { toast('请等待原始附件上传成功，或移除失败附件'); return; }
  const images = attachments.slice();
  if (!opened) {
    // First message of a brand-new conversation: (re)use the in-flight open
    // and send once `history` confirms the Session.
    queuedPrompt = { text, images };
    attachments = [];
    renderAttachments();
    if (!pendingOpenId) openSession(null);
    ui.prompt.value = '';
    autoGrow();
    setStreaming(true);
    showThinking(true);
    return;
  }
  submitPrompt(text || (files.length ? '（附件）' : '（图片）'), images);
});
function submitPrompt(text, images) {
  if(streaming && !supports('steer') && !supports('followUp')){toast('请等待当前轮次结束，或先停止');return;}
  const mode = streaming ? ui.mode.value : 'prompt';
  requestNotifyPermission();   // first prompt is the moment the user has context for the browser's ask
  const files = completedUploads().map((u) => ({ name: u.name, size: u.size, path: u.path, href: downloadUrl(u.path) }));
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

const skillPanel=initSkills({
  context:()=>{const task=workspaceState?.conversations.find(c=>c.id===activeId);return {id:activeId,engine:task?.engine??engine,kind:task?.archived?null:task?.workspaceKind};},
  onOpen:()=>{setSearchOpen(false);setWorkspaceOpen(false);closeDiffDialog();closeBrandMenu();closeSidebarOnMobile();ui.projectManage.open=false;},
  notify:toast,
});

// ---------- session actions ----------
function switchSession(id) {
  skillPanel.close();
  setSearchOpen(false);
  if(workspaceState?.conversations.find(c=>c.id===id)?.archived || workspaceState?.legacyArchived?.includes(id)) {toast("请从对话菜单恢复后再打开");return;}
  if (id === activeId && opened) return;
  ui.projectManage.open = false;
  setWorkspaceOpen(false);closeDiffDialog();
  clearExtensionUi();
  taskSelectionEpoch++;catalogRequest=null;draftModel=null;modelPending=null;historyReady=false;closeAgentMenu();resetTransfers();filesAwaitingTransfer=[];attachments=[];queuedPrompt=null;workspaceSync=null;
  activeId = id;
  rememberTask(id);
  streaming = false;
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
  skillPanel.close();
  setSearchOpen(false);
  ui.projectManage.open = false;
  setWorkspaceOpen(false);closeDiffDialog();
  clearExtensionUi();
  taskSelectionEpoch++;catalogRequest=null;draftModel=null;modelPending=null;historyReady=false;closeAgentMenu();prepareNew=false;creationRequest=null;saveCreation();workspaceSync=null;resetTransfers();filesAwaitingTransfer=[];attachments=[];queuedPrompt=null;
  engine='pi';capabilities=null;models=null;commands=[];$('#task-engine').value='pi';
  $('#task-kind').value='chat';ui.projectSelect.value='';ui.startBranch.value='';
  activeId = null;
  rememberTask(null);
  streaming = false;
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
    if (menuNode) { closeMenu(); return; }
    if (ui.brandMenu && !ui.brandMenu.classList.contains('hidden')) { closeBrandMenu(); return; }
    if (ui.agentMenu && !ui.agentMenu.classList.contains('hidden')) { closeAgentMenu(); return; }
    if (ui.projectManage?.open) { ui.projectManage.open = false; return; }
    if (!ui.slash.classList.contains('hidden')) { ui.slash.classList.add('hidden'); return; }
    if (workspaceDetailOpen) { closeWorkspaceDetail(); return; }
    if(skillPanel.isOpen()){skillPanel.close();return;}
    if(searchOpen){setSearchOpen(false);$('#search-open').focus();return;}
    closeSidebarOnMobile();
    if (streaming && opened && document.activeElement !== ui.prompt) { send({ v: 1, type: 'abort' }); pushNote('已请求停止当前任务。'); }
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
  if(open)closeDiffPanel();
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
    for(const p of data.projects){const o=document.createElement('option');o.value=p.id;o.textContent=p.name;select.append(o);}
    if(data.projects.some(p=>p.id===old))select.value=old;
    renderProjectContext();
    renderSessionList();
    const hasActive=activeId && data.conversations.some(c=>c.id===activeId);
    if(hasActive) {
      const id=activeId,c=data.conversations.find(c=>c.id===id),chat=c.workspaceKind==='chat';
      $('#migrate-workspace').classList.toggle('hidden',chat || Boolean(c.startSha));
      $('#checkpoint-workspace').classList.toggle('hidden',chat || !c.startSha);
      $('#pull-request').classList.toggle('hidden',chat || !c.startSha);
      if(c.creationState==='failed' || c.creationState==='creating')return;
      const grant=await workspaceApi({action:'files',id});
      if(activeId===id){transfer=grant;bindWorkspaceArtifacts();void refreshArtifactCards();void refreshWorkspaceStatus();void refreshWorkspaceChanges(false).then(()=>maybeRenderChangesCard()).catch(()=>undefined);}
    }
    else {workspaceChanges=null;workspaceSync=null;renderSyncState();for(const id of ['migrate-workspace','checkpoint-workspace','pull-request'])$('#'+id).classList.add('hidden');selectedChangedPath=null;if(workspaceDetailOpen)closeWorkspaceDetail();renderWorkspaceSummary();renderWorkspaceList();}
  } catch(e) {if(workspaceState){workspaceSync={...workspaceSync,state:'unknown',error:e.message};renderSyncState();renderProjectContext();}}
}
$('#task-engine').addEventListener('change',()=>{creationRequest=null;catalogRequest=null;draftModel=null;models=null;engine=$('#task-engine').value;closeAgentMenu();saveCreation();refreshComposer();loadDraftModels();});
$('#task-kind').addEventListener('change',()=>{creationRequest=null;catalogRequest=null;draftModel=null;models=null;closeAgentMenu();saveCreation();refreshComposer();engine=$('#task-engine').value;loadDraftModels();});
$('#create-task').addEventListener('click',async()=>{
  if(activeId && !workspaceState?.conversations.some(c=>c.id===activeId)){
    const id=activeId,workspaceKind=$('#task-kind').value,projectId=ui.projectSelect.value;
    if(workspaceKind==='project' && !projectId)return toast('请先选择项目');
    try{await workspaceApi({action:'conversation',id,workspaceKind,...(workspaceKind==='project'?{projectId,branch:ui.startBranch.value.trim() || undefined}:{})});await loadWorkspace();connect();}catch(e){toast(e.message);}return;
  }
  void openSession(null);
});
ui.projectSelect.addEventListener('change',async()=>{
  creationRequest=null;saveCreation();ui.startBranch.value='';showArchived=false;renderProjectContext();renderSessionList();
  const id=ui.projectSelect.value,list=$('#remote-branches');list.replaceChildren();if(!id || activeId)return;
  try{const branches=await workspaceApi({action:'branches',projectId:id});if(ui.projectSelect.value!==id || activeId)return;for(const branch of branches){const option=document.createElement('option');option.value=branch;list.append(option);}ui.startBranch.value=workspaceState.projects.find(p=>p.id===id)?.branch || branches[0] || '';}
  catch(e){toast('分支列表不可用，可填写已知远端分支：'+e.message);}
});
$('#show-archive').addEventListener('click',()=>{closeBrandMenu();showArchived=true;renderSessionList();});
$('#show-active').addEventListener('click',()=>{closeBrandMenu();showArchived=false;renderSessionList();});
$('#project-discover').addEventListener('click',async()=> {closeBrandMenu();try{await workspaceApi({action:'discover'});await loadWorkspace();}catch(e){toast(e.message);}});
$('#project-create').addEventListener('click',async()=>{
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
});
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
    if(id!==activeId)return;workspaceSync=result;renderSyncState();await refreshWorkspaceChanges(false);toast('Checkpoint 已由远端 SHA 确认');
  }catch(e){if(id===activeId){await refreshWorkspaceStatus();toast(e.message);}}
});
$('#pull-request').addEventListener('click',async()=>{
  const id=activeId;if(!id)return toast('请先打开代码对话');
  try {const title=await askModal({title:'创建 Gitea PR',text:'PR 合并在 Gitea 中完成。',input:'PI Coffee Conversation changes',okLabel:'创建 / 打开'});if(!title || id!==activeId)return;const pr=await workspaceApi({action:'pull_request',id,title});window.open(pr.url,'_blank','noopener,noreferrer');toast(`PR #${pr.number} · ${pr.state}`);}catch(e){toast(e.message);}
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
function renderWorkspaceSummary(data=workspaceChanges) {
  const node=$('#workspace-summary');if(!node)return;
  if(!data || !data.files.length){node.replaceChildren();return;}
  const add=data.files.reduce((sum,file)=>sum+(typeof file.additions==='number' ? file.additions : 0),0);
  const del=data.files.reduce((sum,file)=>sum+(typeof file.deletions==='number' ? file.deletions : 0),0);
  node.replaceChildren(el('span','wt-add','+'+add),el('span','wt-del','−'+del));
}
async function refreshWorkspaceChanges(announce=true) {
  if(!workspaceState || !activeId || !workspaceState.conversations.some(c=>c.id===activeId)){workspaceChanges=null;selectedChangedPath=null;renderWorkspaceSummary();renderWorkspaceList();return null;}
  if(announce)toast('正在读取 Diff 与 Checks…');
  if(workspaceState.conversations.find(c=>c.id===activeId)?.workspaceKind==='chat'){workspaceChanges=null;selectedChangedPath=null;renderWorkspaceSummary();renderWorkspaceList();return null;}
  const id=activeId;const changes=await workspaceApi({action:'changes',id});if(id!==activeId)return null;workspaceChanges=changes;
  if(selectedChangedPath && !workspaceChanges.files.some((file) => file.path === selectedChangedPath)) selectedChangedPath=null;
  renderWorkspaceSummary();
  renderWorkspaceList();
  return workspaceChanges;
}
function changeFileStats(file) {
  return file.additions===null && file.deletions===null ? '未跟踪' : `+${file.additions ?? 0} −${file.deletions ?? 0}`;
}
function changedFileRow(file, { selected = false } = {}) {
  const code=file.status==='?' ? 'U' : String(file.status).toUpperCase();
  const row=el('button','file-row workspace-change-row' + (selected ? ' selected' : ''));
  row.type='button';
  row.title=`查看 ${file.path} 的 Diff`;
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
  const card=el('section','changes-card');
  card.setAttribute('aria-label','本轮 Checkout 变更');
  const head=el('div','changes-card-head');
  head.append(
    el('strong','changes-card-title',`已编辑 ${data.files.length} 个文件`),
    el('span','changes-card-stats',`+${add} −${del}`),
  );
  card.append(head);
  const list=el('div','changes-card-list');
  for(const file of data.files) {
    const row=changedFileRow(file,{selected:selectedChangedPath===file.path});
    row.addEventListener('click',()=>showWorkspaceReview('diff',file.path));
    list.append(row);
  }
  card.append(list);
  if(data.files.length>3) {
    const more=el('button','changes-card-more',`展开其余 ${data.files.length - 3} 个文件`);
    more.type='button';
    more.addEventListener('click',()=>{const expanded=card.classList.toggle('expanded');more.textContent=expanded ? '收起文件列表' : `展开其余 ${data.files.length - 3} 个文件`;});
    card.append(more);
  }
  const actions=el('div','changes-card-actions');
  const review=el('button','btn small','Review changes');
  review.type='button';review.addEventListener('click',()=>showWorkspaceReview('diff'));
  actions.append(review);
  card.append(actions);
  return card;
}
function maybeRenderChangesCard(data=workspaceChanges) {
  if(!data || streaming || !data.files.length) return;
  const signature=activeId + ':' + data.target + ':' + data.files.map((file) => [file.path,file.status,file.additions,file.deletions].join(':')).join('|');
  if(signature===lastChangeCardSignature) return;
  lastChangeCardSignature=signature;
  appendNode(changedFilesCard(data));
}
function patchForFile(patch,path) {
  if(!patch || !path) return '';
  const sections=patch.split(/(?=^diff --git )/m).filter(Boolean);
  for(const section of sections) {
    let target=section.match(/^diff --git [^\n]* b\/(.+)$/m)?.[1] || section.match(/^\+\+\+ b\/(.+)$/m)?.[1];
    if(target?.startsWith('"') && target.endsWith('"'))target=target.slice(1,-1).replace(/\\(["\\])/g,'$1');
    if(target===path)return section;
  }
  return '';
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
    row.title=file.path;row.setAttribute('aria-label',`查看 ${file.path} 的 Diff`);
    const stats=el('span','wt-file-stats');
    if(typeof file.additions==='number' && file.additions>0)stats.append(el('span','wt-add','+'+file.additions));
    if(typeof file.deletions==='number' && file.deletions>0)stats.append(el('span','wt-del','−'+file.deletions));
    if(!stats.children.length)stats.append(el('span','wt-new',file.status==='?' ? '未跟踪' : '±0'));
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
function renderWorkspaceDiff(data, path=selectedChangedPath) {
  selectedChangedPath=path && data.files.some(file=>file.path===path) ? path : null;
  const content=$('#diff-content');content.replaceChildren();
  $('#diff-scope-info').textContent=`${data.branch}\nbase ${data.base}\ntarget ${data.target}\n${data.stale?'远端刷新失败 · 基线可能陈旧':'刷新 '+data.refreshedAt}`;
  for(const mode of ['unified','split'])$('#diff-'+mode).setAttribute('aria-pressed',String(mode===reviewLayout));
  const files=selectedChangedPath?data.files.filter(f=>f.path===selectedChangedPath):data.files;
  for(const file of files)content.append(renderReviewFile(file,patchForFile(data.patch,file.path),reviewLayout));
  if(!files.length)content.append(el('p','workspace-empty','没有文本变更。'));
  if(data.truncated)content.append(el('p','workspace-warning','Diff 过大，仅显示前 150 KB；请在 VM 使用 git diff 查看完整内容。'));
  $('#diff-collapse').setAttribute('aria-label','收起全部文件');$('#diff-collapse').title='收起全部文件';
}
async function showDiffDialog(path) {
  if(workspaceState?.conversations.find(c=>c.id===activeId)?.workspaceKind==='chat')return toast('Chat 没有项目 Diff');
  const id=activeId,epoch=++diffEpoch;diffTaskId=id;selectedChangedPath=path;
  $('#diff-content').replaceChildren(el('p','workspace-empty','正在读取 Diff…'));
  const dialog=$('#diff-dialog');if(!dialog.open)dialog.showModal();
  try{const data=await refreshWorkspaceChanges(false);if(data && id===activeId && epoch===diffEpoch && dialog.open)renderWorkspaceDiff(data,path);}
  catch(e){if(id===activeId && epoch===diffEpoch && dialog.open)$('#diff-content').replaceChildren(el('p','workspace-warning',e.message));}
}
function renderWorkspaceChecks(data) {
  const detail=$('#workspace-detail');detail.replaceChildren();
  detail.append(reviewHead('Checks · '+data.branch,{wrapToggle:false}));
  for(const check of data.checks) {
    const card=el('div','workspace-check '+(check.ok ? 'ok' : 'failed'));
    const head=el('div','workspace-check-head');
    head.append(el('span','workspace-check-icon',check.ok ? '✓' : '!'),el('strong','',check.command),el('span','workspace-check-state',check.ok ? '通过' : '发现问题'));
    card.append(head,el('pre','workspace-check-output',check.output || (check.ok ? 'clean' : '无输出')));
    detail.append(card);
  }
  detail.append(el('p','workspace-note','当前 Checks 是 Checkout 的本地 git diff --check；不会自动运行测试或远程 CI。'));
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
  if(tab==='diff')return showDiffDialog(path);
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
fetch('/api/me').then(r=>r.ok?r.json():null).then(user=>{if(!user)return;const account=el('button','foot-btn',user.login+' · 退出');account.onclick=async()=>{await fetch('/auth/logout',{method:'POST'});localStorage.removeItem(ACTIVE_KEY);location.href='/auth/login';};$('.sidebar-foot').append(account);}).catch(()=>{});

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

let artifactSignature='';
async function refreshArtifactCards() {
 if(!workspaceState || !transfer || !activeId)return;
 const id=activeId;
 try {
  const r=await fetch(fileEndpoint('artifacts'));if(!r.ok)return;const data=await r.json();if(id!==activeId)return;
  const signature=id+JSON.stringify(data.artifacts)+transfer.token;
  if(signature===artifactSignature && $('#generated-artifacts'))return;
  artifactSignature=signature;$('#generated-artifacts')?.remove();
  if(!data.artifacts?.length)return;
  const section=el('section','generated-artifacts');section.id='generated-artifacts';section.append(el('h3','','工作区产物'));
  for(const file of data.artifacts.slice(0,20)) {
    const card=el('div','generated-card');card.append(el('span','',file.path));
    if(!file.available)card.append(el('span','', '文件已移除或不可访问'));
    else {
      const open=el('a','','打开');open.href=fileEndpoint('preview',file.path);open.target='_blank';open.rel='noopener noreferrer';open.addEventListener('click',(e)=>{e.preventDefault();void showWorkspacePreview(file.path);});
      const download=el('a','','下载');download.href=fileEndpoint('workspace-download',file.path);download.target='_blank';download.rel='noopener noreferrer';card.append(open,download);
      if(/\.(png|jpe?g|gif|webp|svg)$/i.test(file.path)){const img=document.createElement('img');img.src=open.href;img.alt=file.path;img.onerror=()=>{img.alt='预览不可用：'+file.path;};const link=open.cloneNode(false);link.append(img);card.append(link);}
    }
    section.append(card);
  }
  ui.thread.append(section);
 }catch { /* Browsing failure must not fail the running chat. Refresh/reconnect can retry. */ }
}

function closeDiffDialog() {
  const dialog=$('#diff-dialog');
  ++diffEpoch;diffTaskId=null;
  if(dialog.open)dialog.close();
}

$('#diff-close').addEventListener('click',closeDiffDialog);
$('#diff-dialog').addEventListener('cancel',event=>{event.preventDefault();closeDiffDialog();});
$('#diff-dialog').addEventListener('keydown',event=>event.stopPropagation());
for(const mode of ['unified','split'])$('#diff-'+mode).addEventListener('click',()=>{reviewLayout=mode;if(workspaceChanges && diffTaskId===activeId)renderWorkspaceDiff(workspaceChanges);});
$('#diff-collapse').addEventListener('click',()=>{const files=[...$('#diff-content').querySelectorAll('.review-file')];const open=!files.some(file=>file.open);for(const file of files)file.open=open;$('#diff-collapse').setAttribute('aria-label',open?'收起全部文件':'展开全部文件');$('#diff-collapse').title=open?'收起全部文件':'展开全部文件';});
