// @vitest-environment jsdom
// Browser-controller seam for the Arena-style composer: in-card task strip, merged Agent menu,
// docked Diff panel (Branch / 最近一轮) and one-click 创建 PR.
import {readFileSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();localStorage.clear();sessionStorage.clear();vi.resetModules();});

const PATCH=[
  'diff --git a/src/a.ts b/src/a.ts','--- a/src/a.ts','+++ b/src/a.ts',
  '@@ -9,3 +9,4 @@ export function run() {',
  ' const keep = 1;',
  '-const answer = compute(left);',
  '+const answer = compute(right);',
  '+const extra = true;',
  ' return answer;',
  'diff --git a/notes.md b/notes.md','new file mode 100644','--- /dev/null','+++ b/notes.md',
  '@@ -0,0 +1,3 @@','+one','+two','+three',
].join('\n');

type Options={task?:Record<string,unknown>;changes?:Record<string,unknown>;turn?:Record<string,unknown>;status?:Record<string,unknown>;failCreate?:boolean};
async function setup({task={},changes={},turn,status,failCreate=false}:Options={}){
  document.documentElement.innerHTML=readFileSync('public/index.html','utf8');
  Object.defineProperty(window,'matchMedia',{value:()=>({matches:false,addEventListener(){}}),configurable:true});Element.prototype.scrollTo=vi.fn();
  const conversation:any={id:'task-1',workspaceKind:'project',engine:'pi',creationState:'ready',projectId:'p',cwd:'/home/test/checkouts/task-1',branch:'coffee/vm/task-1',startSha:'abc',archived:false,createdAt:'2026-09-28T00:00:00Z',...task};
  sessionStorage.setItem('pi-coffee.active.v2',conversation.id);
  const requests:any[]=[],frames:any[]=[],sockets:any[]=[];
  const projects=[{id:'p',name:'demo',branch:'main',webUrl:'https://gitea.example/owner/demo'}];
  const branch={scope:'branch',sessionId:conversation.id,branch:conversation.branch,base:'1111111111',target:'2222222222',refreshedAt:'2026-09-28T01:00:00Z',stale:false,files:[{path:'src/a.ts',status:'M',additions:2,deletions:1},{path:'notes.md',status:'?',additions:3,deletions:0}],patch:PATCH,checks:[],checkpointPaths:['src/a.ts','notes.md'],...changes};
  class Socket{static OPEN=1;readyState=1;onopen:any;onmessage:any;onclose:any;onerror:any;constructor(){sockets.push(this);queueMicrotask(()=>this.onopen?.());}close(){}send(text:string){frames.push(JSON.parse(text));}receive(frame:any){this.onmessage?.({data:JSON.stringify(frame)});}}
  vi.stubGlobal('WebSocket',Socket);vi.stubGlobal('open',vi.fn());
  const json=(value:unknown,ok=true)=>({ok,status:ok ? 200 : 409,json:async()=>value});
  vi.stubGlobal('fetch',vi.fn(async(url:any,init:any)=>{
    if(String(url).includes('/artifacts?'))return json({artifacts:[{path:'output/report.html',available:true}]});
    if(url==='/api/engines')return json({engines:[{id:'pi',name:'Pi',available:true},{id:'codex',name:'Codex',available:true},{id:'claude',name:'Claude Code',available:true}]});
    if(url==='/api/me')return json(null);
    if(url==='/auth/me')return json({auth:false});
    const body=init?.body ? JSON.parse(init.body) : null;
    if(!body)return json({projects,conversations:[conversation],sidebar:{assignments:{},collapsed:[]},vmId:'vm-1',capabilities:{chatWorkspaces:true}});
    requests.push(body);
    if(body.action==='files')return json({url:'http://vm.example',scope:conversation.id,token:'t',files:[]});
    if(body.action==='status')return json(status ?? {state:'ahead',dirty:true,branch:conversation.branch});
    if(body.action==='changes')return body.scope==='turn' ? (turn ? json(turn) : json({error:'No turn recorded yet; send a message first'},false)) : json(branch);
    if(body.action==='checkpoint' || body.action==='sync')return json({state:'synced',dirty:false,branch:conversation.branch});
    if(body.action==='pull_request'){conversation.pullRequest={number:7,url:'https://gitea.example/owner/demo/pulls/7',state:'open',target:'main',source:conversation.branch};return json(conversation.pullRequest);}
    if(body.action==='conversation')return failCreate ? json({error:'Gitea unavailable'},false) : json({...body,cwd:'/home/test/chats/'+body.id,creationState:'ready'});
    return json({});
  }));
  vi.useFakeTimers();await import('../public/app.js');await vi.advanceTimersByTimeAsync(20);
  const ws=sockets.at(-1);ws.receive({type:'opened',sessionId:conversation.id,engine:conversation.engine,state:{}});
  await vi.advanceTimersByTimeAsync(20);
  return {requests,frames,sockets,conversation};
}
const q=<T extends Element=HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
const hidden=(selector:string)=>q(selector).classList.contains('hidden');
const workspaceActions=(requests:any[])=>requests.map(r=>r.action).filter(a=>['checkpoint','sync','pull_request'].includes(a));

it('requires explicit confirmation of experimental handoff compaction and preserves cancellation',async()=>{
  const app=await setup();
  const compact=q<HTMLButtonElement>('#sp-compact');
  expect(compact.textContent).toBe('交接压缩');
  compact.click();await vi.advanceTimersByTimeAsync(20);
  expect(q('#modal-title').textContent).toBe('交接压缩（实验性功能）');
  expect(q('#modal-text').textContent).toContain('不保证避免上下文漂移');
  expect(q('#modal-text').textContent).toContain('多次系统自动压缩后');
  expect(q('#modal-text').textContent).toContain('Pi 原生自动压缩');
  expect(app.frames.filter(f=>f.type==='compact')).toHaveLength(0);
  q<HTMLButtonElement>('#modal-cancel').click();await vi.advanceTimersByTimeAsync(20);
  expect(app.frames.filter(f=>f.type==='compact')).toHaveLength(0);
  compact.click();await vi.advanceTimersByTimeAsync(20);
  q<HTMLButtonElement>('#modal-ok').click();await vi.advanceTimersByTimeAsync(20);
  expect(app.frames.filter(f=>f.type==='compact')).toHaveLength(1);
});

it('does not compact a different task after the confirmation dialog was opened',async()=>{
  const app=await setup();
  q<HTMLButtonElement>('#sp-compact').click();await vi.advanceTimersByTimeAsync(20);
  q<HTMLButtonElement>('#new-task').click();await vi.advanceTimersByTimeAsync(20);
  q<HTMLButtonElement>('#modal-ok').click();await vi.advanceTimersByTimeAsync(20);
  expect(app.frames.filter(f=>f.type==='compact')).toHaveLength(0);
});

it('shows active compaction after reconnect and blocks input until settlement',async()=>{
  const app=await setup();const ws=app.sockets.at(-1);
  ws.receive({type:'opened',sessionId:'task-1',engine:'pi',state:{isCompacting:true}});
  q<HTMLTextAreaElement>('#prompt').value='continue';q('#prompt').dispatchEvent(new Event('input'));
  expect(q<HTMLButtonElement>('#send').disabled).toBe(true);
  expect(q<HTMLButtonElement>('#sp-compact').disabled).toBe(true);
  expect(hidden('#stop')).toBe(false);
  ws.receive({type:'event',sessionId:'task-1',event:{type:'compaction_end',result:{summary:'handoff'},aborted:false}});
  expect(q('#thread').textContent).not.toContain('上下文已压缩');
  ws.receive({type:'event',sessionId:'task-1',event:{type:'context_operation',active:false,success:true}});
  expect(q<HTMLButtonElement>('#send').disabled).toBe(false);
  expect(q('#thread').textContent).toContain('交接压缩完成');
});

it('reports failed compaction to a reconnected browser without an originating request',async()=>{
  const app=await setup();app.sockets.at(-1).receive({type:'event',sessionId:'task-1',event:{type:'context_operation',active:false,success:false,message:'Handoff did not commit'}});
  expect(q('#thread').textContent).toContain('Handoff did not commit');
});

it('puts repository | branch, the branch Diff total and 创建 PR inside the composer card',async()=>{
  await setup();
  expect(q('#project-controls').closest('#composer-card')).not.toBeNull();expect(hidden('#project-controls')).toBe(false);
  expect(q('#task-project').textContent).toBe('owner/demo');expect(q<HTMLAnchorElement>('#task-project').href).toBe('https://gitea.example/owner/demo');
  expect(q('#task-branch').textContent).toBe('coffee/vm/task-1');expect(hidden('#task-branch-field')).toBe(false);
  expect(q('#project-select').closest('label')!.classList.contains('hidden')).toBe(true);
  expect(hidden('#branch-diff')).toBe(false);expect(q('#branch-diff-add').textContent).toBe('+5');expect(q('#branch-diff-del').textContent).toBe('−1');
  expect(q('#pull-request-label').textContent).toBe('创建 PR');expect(hidden('#pull-request')).toBe(false);
  expect(hidden('#strip-kind')).toBe(true);expect(hidden('#create-task')).toBe(true);
  expect(q('#agent-name').textContent).toBe('Pi');expect(q<HTMLTextAreaElement>('#prompt').placeholder).toBe('想让 PI Coffee 做什么？');
});

it('shows only "Chat · 本地目录" for a Chat task, without Diff or PR',async()=>{
  const app=await setup({task:{workspaceKind:'chat',projectId:undefined,branch:'',startSha:undefined,cwd:'/home/test/chats/task-1'}});
  expect(hidden('#strip-kind')).toBe(false);expect(q<HTMLButtonElement>('#strip-kind').disabled).toBe(true);
  for(const id of ['#branch-diff','#pull-request','#task-project','#task-branch-field','.strip-repo-icon'])expect(hidden(id)).toBe(true);
  expect(app.requests.some(r=>r.action==='changes')).toBe(false);
});

it('keeps task details in the scroll-icon popover',async()=>{
  await setup();
  const button=q<HTMLButtonElement>('#task-details-btn');button.click();
  expect(hidden('#task-details')).toBe(false);expect(hidden('#task-details-empty')).toBe(true);
  expect(q('#workspace-context').textContent).toContain('/home/test/checkouts/task-1');
  q('#prompt').click();expect(hidden('#task-details')).toBe(true);
});

it('chooses Agent and Chat/Work in the Agent menu for a new task, and locks them once the task exists',async()=>{
  const app=await setup();
  const trigger=q<HTMLButtonElement>('#agent-menu-btn');expect(trigger.disabled).toBe(true);
  app.sockets.at(-1).receive({type:'models',models:[{provider:'fixture',id:'demo-model'}],current:{provider:'fixture',id:'demo-model'},thinkingLevels:[],thinkingLevel:''});
  expect(trigger.disabled).toBe(false);trigger.click();
  expect(q<HTMLButtonElement>('#agent-model-row').disabled).toBe(false);expect(q('#agent-model-value').textContent).toBe('demo-model');
  expect(q<HTMLButtonElement>('#agent-engine-row').disabled).toBe(true);expect(q<HTMLButtonElement>('#agent-kind-row').disabled).toBe(true);
  expect(q('#agent-menu-note').textContent).toContain('固定');
  q<HTMLButtonElement>('#new-task').click();await vi.advanceTimersByTimeAsync(20);
  expect(trigger.disabled).toBe(false);trigger.click();q<HTMLButtonElement>('#agent-engine-row').click();
  const codexInChat=[...document.querySelectorAll<HTMLButtonElement>('#agent-engine-pane button')].find(b=>b.textContent!.includes('Codex'))!;
  expect(codexInChat.disabled).toBe(true);expect(codexInChat.textContent).toContain('仅 Work');
  q<HTMLButtonElement>('#agent-kind-row').click();
  [...document.querySelectorAll<HTMLButtonElement>('#agent-kind-pane button')].find(b=>b.textContent!.includes('Gitea'))!.click();q<HTMLButtonElement>('#github-close').click();
  expect(q<HTMLSelectElement>('#task-kind').value).toBe('project');expect(q('#project-select').closest('label')!.classList.contains('hidden')).toBe(false);
  expect(hidden('#strip-kind')).toBe(true);
  trigger.click();q<HTMLButtonElement>('#agent-engine-row').click();
  [...document.querySelectorAll<HTMLButtonElement>('#agent-engine-pane button')].find(b=>b.textContent!.includes('Codex'))!.click();
  expect(q<HTMLSelectElement>('#task-engine').value).toBe('codex');expect(q('#agent-name').textContent).toBe('Codex');
  expect(hidden('#create-task')).toBe(true);
});

it('opens the Diff as a docked panel beside the chat, with folding, Split and the scope menu',async()=>{
  const app=await setup();
  const strip=q<HTMLButtonElement>('#branch-diff');strip.focus();strip.click();await vi.advanceTimersByTimeAsync(20);
  const dialog=q<HTMLDialogElement>('#diff-dialog');
  expect(dialog.open).toBe(true);expect(dialog.parentElement!.id).toBe('app');expect(q('#app').classList.contains('diff-open')).toBe(true);
  expect(strip.getAttribute('aria-expanded')).toBe('true');
  expect(app.requests.filter(r=>r.action==='changes').at(-1).scope).toBeUndefined();
  expect([...dialog.querySelectorAll('.review-file-name')].map(n=>n.textContent)).toEqual(['src/a.ts','notes.md']);
  expect([...dialog.querySelectorAll('mark.review-word')].map(n=>n.textContent)).toEqual(['left','right']);
  const collapse=q<HTMLButtonElement>('#diff-collapse');collapse.click();
  expect([...dialog.querySelectorAll<HTMLDetailsElement>('.review-file')].some(file=>file.open)).toBe(false);
  expect(collapse.getAttribute('aria-label')).toBe('展开全部文件');expect(q('#diff-collapse-tip').textContent).toBe('展开全部文件');
  q<HTMLButtonElement>('#diff-split').click();
  expect(dialog.querySelector('table')!.dataset.layout).toBe('split');
  expect([...dialog.querySelectorAll<HTMLDetailsElement>('.review-file')].some(file=>file.open)).toBe(false);
  const scope=q<HTMLButtonElement>('#diff-scope');scope.click();
  expect(scope.getAttribute('aria-expanded')).toBe('true');
  const turn=q<HTMLButtonElement>('#diff-scope-turn');expect(turn.disabled).toBe(true);expect(turn.textContent).toContain('发送消息后开始记录最近一轮');
  expect(q('#diff-scope-info').textContent).toContain('coffee/vm/task-1');
  dialog.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  expect(scope.getAttribute('aria-expanded')).toBe('false');expect(dialog.open).toBe(true);
  dialog.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  expect(dialog.open).toBe(false);expect(q('#app').classList.contains('diff-open')).toBe(false);expect(document.activeElement).toBe(strip);
});

it('switches to 最近一轮 once the Host has a turn snapshot, and returns the Checkout panel it replaced',async()=>{
  const turnPatch='diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -10 +10 @@\n-const answer = compute(left);\n+const answer = compute(right);';
  const app=await setup({task:{turnSnapshot:{tree:'3333333333',startedAt:'2026-09-28T02:00:00Z'}},turn:{scope:'turn',sessionId:'task-1',branch:'coffee/vm/task-1',base:'3333333333',target:'WORKTREE',startedAt:'2026-09-28T02:00:00Z',running:false,files:[{path:'src/a.ts',status:'M',additions:1,deletions:1}],patch:turnPatch,truncated:false}});
  q<HTMLButtonElement>('#files-toggle').click();expect(hidden('#workspace-panel')).toBe(false);
  q<HTMLButtonElement>('#view-all-changes').click();await vi.advanceTimersByTimeAsync(20);
  expect(hidden('#workspace-panel')).toBe(true);
  q<HTMLButtonElement>('#diff-scope').click();
  const option=q<HTMLButtonElement>('#diff-scope-turn');expect(option.disabled).toBe(false);option.click();await vi.advanceTimersByTimeAsync(20);
  expect(app.requests.filter(r=>r.action==='changes').at(-1)).toMatchObject({id:'task-1',scope:'turn'});
  expect(q('#diff-scope-label').textContent).toBe('最近一轮');
  expect([...document.querySelectorAll('#diff-content .review-file-name')].map(n=>n.textContent)).toEqual(['src/a.ts']);
  expect(q('#diff-scope-info').textContent).toContain('最近一轮');
  q<HTMLButtonElement>('#diff-close').click();
  expect(q<HTMLDialogElement>('#diff-dialog').open).toBe(false);expect(hidden('#workspace-panel')).toBe(false);
});

it('refreshes an open 最近一轮 view while Codex reports turn_diff, throttled and only for that scope',async()=>{
  const turnPatch='diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -10 +10 @@\n-const answer = compute(left);\n+const answer = compute(right);';
  const app=await setup({task:{engine:'codex',turnSnapshot:{tree:'3333333333',startedAt:'2026-09-28T02:00:00Z'}},turn:{scope:'turn',sessionId:'task-1',branch:'coffee/vm/task-1',base:'3333333333',target:'WORKTREE',startedAt:'2026-09-28T02:00:00Z',running:true,files:[{path:'src/a.ts',status:'M',additions:1,deletions:1}],patch:turnPatch,truncated:false}});
  const turnReads=()=>app.requests.filter(r=>r.action==='changes' && r.scope==='turn').length;
  const branchReads=()=>app.requests.filter(r=>r.action==='changes' && r.scope===undefined).length;
  const turnDiff=()=>app.sockets.at(-1).receive({type:'event',sessionId:'task-1',event:{type:'turn_diff',diff:turnPatch}});
  q<HTMLButtonElement>('#branch-diff').click();await vi.advanceTimersByTimeAsync(20);
  q<HTMLButtonElement>('#diff-scope').click();q<HTMLButtonElement>('#diff-scope-turn').click();await vi.advanceTimersByTimeAsync(20);
  expect(q('#diff-scope-label').textContent).toBe('最近一轮');
  const opened=turnReads();
  // A burst of edits waits for the interval, then refreshes once in place (still from the Host snapshot).
  turnDiff();turnDiff();turnDiff();
  await vi.advanceTimersByTimeAsync(200);
  expect(turnReads()).toBe(opened);
  await vi.advanceTimersByTimeAsync(1400);
  expect(turnReads()).toBe(opened+1);
  expect([...document.querySelectorAll('#diff-content .review-file-name')].map(n=>n.textContent)).toEqual(['src/a.ts']);
  expect(q('#diff-scope-info').textContent).toContain('仍在运行');
  // A comment being typed is not rebuilt under the caret: the refresh waits until focus leaves.
  const box=document.createElement('form');box.className='diff-comment-box';const input=document.createElement('textarea');box.append(input);q('#diff-content').append(box);input.focus();
  turnDiff();await vi.advanceTimersByTimeAsync(3200);
  expect(turnReads()).toBe(opened+1);
  input.blur();await vi.advanceTimersByTimeAsync(1600);
  expect(turnReads()).toBe(opened+2);
  // Branch compares against the base branch and is refreshed after the turn, not per edit.
  q<HTMLButtonElement>('#diff-scope').click();q<HTMLButtonElement>('#diff-scope-branch').click();await vi.advanceTimersByTimeAsync(20);
  const branch=branchReads();
  turnDiff();await vi.advanceTimersByTimeAsync(1600);
  expect(turnReads()).toBe(opened+2);expect(branchReads()).toBe(branch);
  // A closed panel ignores the event.
  q<HTMLButtonElement>('#diff-close').click();
  turnDiff();await vi.advanceTimersByTimeAsync(1600);
  expect(turnReads()).toBe(opened+2);
});

it('lets the settled turn replace a pending turn_diff refresh',async()=>{
  const app=await setup({task:{engine:'codex',turnSnapshot:{tree:'3333333333',startedAt:'2026-09-28T02:00:00Z'}},turn:{scope:'turn',sessionId:'task-1',branch:'coffee/vm/task-1',base:'3333333333',target:'WORKTREE',startedAt:'2026-09-28T02:00:00Z',running:false,files:[],patch:'',truncated:false}});
  const turnReads=()=>app.requests.filter(r=>r.action==='changes' && r.scope==='turn').length;
  const emit=(event:unknown)=>app.sockets.at(-1).receive({type:'event',sessionId:'task-1',event});
  q<HTMLButtonElement>('#branch-diff').click();await vi.advanceTimersByTimeAsync(20);
  q<HTMLButtonElement>('#diff-scope').click();q<HTMLButtonElement>('#diff-scope-turn').click();await vi.advanceTimersByTimeAsync(20);
  const opened=turnReads();
  emit({type:'turn_diff',diff:''});await vi.advanceTimersByTimeAsync(300);
  emit({type:'agent_settled'});await vi.advanceTimersByTimeAsync(20);
  expect(turnReads()).toBe(opened+1);
  await vi.advanceTimersByTimeAsync(2000);
  expect(turnReads()).toBe(opened+1);
});

it('marks 最近一轮 as unsupported for Claude Code tasks',async()=>{
  await setup({task:{engine:'claude',turnSnapshot:{tree:'3333333333',startedAt:'2026-09-28T02:00:00Z'}}});
  q<HTMLButtonElement>('#branch-diff').click();await vi.advanceTimersByTimeAsync(20);
  q<HTMLButtonElement>('#diff-scope').click();
  expect(q<HTMLButtonElement>('#diff-scope-turn').disabled).toBe(true);expect(q('#diff-scope-turn').textContent).toContain('Claude Code 暂不支持');
});

it('creates a PR in one click: Checkpoint the pending files, then open the Gitea PR',async()=>{
  const app=await setup();
  const button=q<HTMLButtonElement>('#pull-request');button.click();await vi.advanceTimersByTimeAsync(20);
  expect(hidden('#modal')).toBe(false);expect(q('#modal-text').textContent).toContain('2 个文件');
  q<HTMLInputElement>('#modal-input').value='Tidy the composer';q<HTMLButtonElement>('#modal-ok').click();await vi.advanceTimersByTimeAsync(20);
  expect(workspaceActions(app.requests)).toEqual(['checkpoint','pull_request']);
  expect(app.requests.find(r=>r.action==='checkpoint')).toMatchObject({id:'task-1',paths:['src/a.ts','notes.md'],message:'Tidy the composer'});
  expect(app.requests.find(r=>r.action==='pull_request')).toMatchObject({id:'task-1',title:'Tidy the composer'});
  expect(q('#pull-request-label').textContent).toBe('PR #7 ↗');expect(button.disabled).toBe(false);
  button.click();expect(window.open).toHaveBeenCalledWith('https://gitea.example/owner/demo/pulls/7','_blank','noopener,noreferrer');
  expect(workspaceActions(app.requests)).toEqual(['checkpoint','pull_request']);
});

it('pushes an unpublished branch before creating the PR when nothing is left to commit',async()=>{
  const app=await setup({changes:{checkpointPaths:[]},status:{state:'unpublished',dirty:false,branch:'coffee/vm/task-1'}});
  q<HTMLButtonElement>('#pull-request').click();await vi.advanceTimersByTimeAsync(20);
  expect(q('#modal-text').textContent).toContain('先推送任务分支');q<HTMLButtonElement>('#modal-ok').click();await vi.advanceTimersByTimeAsync(20);
  expect(workspaceActions(app.requests)).toEqual(['sync','pull_request']);
});

it('refuses to push a diverged branch and never opens the PR dialog',async()=>{
  const app=await setup({status:{state:'diverged',dirty:false,branch:'coffee/vm/task-1'}});
  q<HTMLButtonElement>('#pull-request').click();await vi.advanceTimersByTimeAsync(20);
  expect(hidden('#modal')).toBe(true);expect(workspaceActions(app.requests)).toEqual([]);
  expect(q('#toast').textContent).toContain('已分叉');expect(q('#pull-request-label').textContent).toBe('创建 PR');
});

it('gives the draft back when the first message cannot create the task',async()=>{
  await setup({failCreate:true});
  q<HTMLButtonElement>('#new-task').click();await vi.advanceTimersByTimeAsync(20);
  const prompt=q<HTMLTextAreaElement>('#prompt');prompt.value='hello';prompt.dispatchEvent(new Event('input'));
  q('#composer').dispatchEvent(new Event('submit',{cancelable:true}));
  expect(prompt.value).toBe('');await vi.advanceTimersByTimeAsync(20);
  expect(prompt.value).toBe('hello');expect(hidden('#stop')).toBe(true);expect(q('#toast').textContent).toContain('Gitea unavailable');
});

it('restores the draft when sending a new Work task without a repository, and does not create early on "/"',async()=>{
  const app=await setup();
  q<HTMLButtonElement>('#new-task').click();await vi.advanceTimersByTimeAsync(20);
  const kind=q<HTMLSelectElement>('#task-kind');kind.value='project';kind.dispatchEvent(new Event('change'));
  q<HTMLSelectElement>('#project-select').value='';
  const prompt=q<HTMLTextAreaElement>('#prompt');
  prompt.value='/help';prompt.dispatchEvent(new Event('input'));
  expect(app.requests.some(r=>r.action==='conversation')).toBe(false);
  q('#composer').dispatchEvent(new Event('submit',{cancelable:true}));
  await vi.advanceTimersByTimeAsync(20);
  expect(prompt.value).toBe('/help');expect(hidden('#stop')).toBe(true);
  expect(q('#toast').textContent).toContain('请先选择');
});

it('refreshes the open Diff and renders the changed-files card when a native run_completed arrives',async()=>{
  const turnPatch='diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -10 +10 @@\n-const answer = compute(left);\n+const answer = compute(right);';
  const app=await setup({task:{engine:'codex',turnSnapshot:{tree:'3333333333',startedAt:'2026-09-28T02:00:00Z'}},turn:{scope:'turn',sessionId:'task-1',branch:'coffee/vm/task-1',base:'3333333333',target:'WORKTREE',startedAt:'2026-09-28T02:00:00Z',running:false,files:[{path:'src/a.ts',status:'M',additions:1,deletions:1}],patch:turnPatch,truncated:false}});
  const turnReads=()=>app.requests.filter(r=>r.action==='changes' && r.scope==='turn').length;
  const emit=(event:unknown)=>app.sockets.at(-1).receive({type:'event',sessionId:'task-1',event});
  q<HTMLButtonElement>('#branch-diff').click();await vi.advanceTimersByTimeAsync(20);
  q<HTMLButtonElement>('#diff-scope').click();q<HTMLButtonElement>('#diff-scope-turn').click();await vi.advanceTimersByTimeAsync(20);
  const opened=turnReads();
  emit({type:'turn_diff',diff:''});await vi.advanceTimersByTimeAsync(300);
  emit({type:'run_completed',status:'completed'});await vi.advanceTimersByTimeAsync(20);
  expect(turnReads()).toBe(opened+1);
  expect(q('#thread .changes-card')).not.toBeNull();
  await vi.advanceTimersByTimeAsync(2000);
  expect(turnReads()).toBe(opened+1);
});

it('keeps edited files collapsed until clicked and does not insert workspace artifact galleries',async()=>{
  const app=await setup();
  const card=q<HTMLDetailsElement>('#thread .changes-card');
  expect(card.tagName).toBe('DETAILS');expect(card.open).toBe(false);
  const summary=card.querySelector('summary')!;expect(summary.textContent).toContain('已编辑 2 个文件');
  summary.click();expect(card.open).toBe(true);
  expect(card.querySelectorAll('.workspace-change-row')).toHaveLength(2);
  card.querySelector<HTMLButtonElement>('.workspace-change-row')!.click();await vi.advanceTimersByTimeAsync(20);
  expect(q<HTMLDialogElement>('#diff-dialog').open).toBe(true);
  summary.click();expect(card.open).toBe(false);
  for(let turn=0;turn<2;turn++){
    app.sockets.at(-1).receive({type:'event',sessionId:'task-1',event:{type:'agent_end'}});
    await vi.advanceTimersByTimeAsync(5100);
    expect(q('#thread').textContent).not.toContain('工作区产物');
    expect(q('#thread').textContent).not.toContain('output/report.html');
  }
});

it('uploads attachments with hashed authenticated scopes, refreshes expired tokens, and includes new-task files in the first prompt',async()=>{
  const app=await setup();
  app.sockets.at(-1).receive({type:'history',sessionId:'task-1',entries:[]});
  Object.defineProperty(crypto,'subtle',{configurable:true,value:{digest:async()=>new ArrayBuffer(32)}});
  const xhrRequests:{url:string;body:any}[]=[];
  class FakeXHR{
    url='';status=200;responseText='';upload:any={};onload:any;onerror:any;onabort:any;
    open(_method:string,url:string){this.url=url;}
    send(body:any){xhrRequests.push({url:this.url,body});this.responseText=JSON.stringify({path:`inbox/${body.name}`,sha256:'00'.repeat(32)});queueMicrotask(()=>this.onload?.());}
    abort(){this.onabort?.();}
  }
  vi.stubGlobal('XMLHttpRequest',FakeXHR);
  let tokenCount=0;let firstPrepareExpired=true;const prepareUrls:string[]=[];
  const baseFetch=globalThis.fetch;
  vi.stubGlobal('fetch',vi.fn(async(url:any,init:any)=>{
    const urlStr=String(url);
    if(urlStr.includes('/api/localsend/v2/prepare-upload')){
      prepareUrls.push(urlStr);
      if(urlStr.startsWith('http://unreachable.vm:53317'))throw new Error('ECONNREFUSED');
      if(firstPrepareExpired){firstPrepareExpired=false;return {ok:false,status:401,json:async()=>({message:'Invalid scope token'})};}
      const parsed=JSON.parse(init.body);
      const files=Object.fromEntries(Object.keys(parsed.files).map(k=>[k,'file-tok-'+k]));
      return {ok:true,status:200,json:async()=>({sessionId:'ls-1',files})};
    }
    const body=init?.body ? JSON.parse(init.body) : null;
    if(body?.action==='files'){
      tokenCount+=1;
      return {ok:true,status:200,json:async()=>({url:'http://unreachable.vm:53317',scope:'hashed-user-scope-'+body.id,sessionId:body.id,token:'fresh-tok-'+tokenCount,maxFileBytes:10_000_000,maxBatchBytes:50_000_000,files:[]})};
    }
    return baseFetch(url,init);
  }));

  // 1. Existing task with authenticated hashed scope (`scope !== activeId`), unreachable direct URL -> same-origin fallback, and expired 401 token -> auto-refresh
  app.sockets.at(-1).receive({type:'transfer',sessionId:'task-1',scope:'hashed-user-scope-task-1',url:'http://unreachable.vm:53317',token:'stale-tok',maxFileBytes:10_000_000,maxBatchBytes:50_000_000});
  vi.stubGlobal('FileReader',class{result='data:image/png;base64,aGVsbG8=';onload:any;readAsDataURL(){queueMicrotask(()=>this.onload());}});
  vi.stubGlobal('Image',class{width=10;height=10;onload:any;set src(_v:string){queueMicrotask(()=>this.onload());}});
  const file1=new File(['spec'],'paste.png',{type:'image/png'});
  Object.defineProperty(file1,'arrayBuffer',{value:async()=>new ArrayBuffer(4)});
  const input=q<HTMLInputElement>('#file');
  Object.defineProperty(input,'files',{configurable:true,value:[file1]});
  input.dispatchEvent(new Event('change'));
  await vi.advanceTimersByTimeAsync(30);

  expect(document.querySelectorAll('#attachments img')).toHaveLength(1);
  expect(document.querySelectorAll('#attachments .upload-chip')).toHaveLength(0);
  expect(prepareUrls).toHaveLength(0);
  q('#composer').dispatchEvent(new Event('submit',{cancelable:true}));
  await vi.advanceTimersByTimeAsync(30);
  expect(prepareUrls.some(u=>u.startsWith('http://unreachable.vm:53317'))).toBe(true);
  expect(prepareUrls.some(u=>u.startsWith(location.origin) && u.includes('token=fresh-tok-'))).toBe(true);
  expect(xhrRequests).toHaveLength(1);
  expect(app.frames.filter(f=>f.type==='prompt')).toHaveLength(1);
  expect(app.frames.find(f=>f.type==='prompt').images).toHaveLength(1);
  expect(app.frames.find(f=>f.type==='prompt').text).not.toContain('[已上传到工作目录的文件]');
  app.frames.length=0;

  // 2. New Work task: attaching a file before selecting a repository queues the file visibly without prematurely failing openSession, and sends it with the first prompt once submitted
  q<HTMLButtonElement>('#new-task').click();await vi.advanceTimersByTimeAsync(20);
  const kind=q<HTMLSelectElement>('#task-kind');kind.value='project';kind.dispatchEvent(new Event('change'));
  q<HTMLSelectElement>('#project-select').value='';
  const file2=new File(['draft'],'notes.txt',{type:'text/plain'});
  Object.defineProperty(file2,'arrayBuffer',{value:async()=>new ArrayBuffer(5)});
  Object.defineProperty(input,'files',{configurable:true,value:[file2]});
  input.dispatchEvent(new Event('change'));
  await vi.advanceTimersByTimeAsync(20);
  expect(q('#attachments .upload-chip')?.textContent).toContain('待发送');
  expect(app.requests.some(r=>r.action==='conversation')).toBe(false);

  q<HTMLSelectElement>('#project-select').value='p';q<HTMLSelectElement>('#project-select').dispatchEvent(new Event('change'));
  const prompt=q<HTMLTextAreaElement>('#prompt');prompt.value='请总结附件';prompt.dispatchEvent(new Event('input'));
  q('#composer').dispatchEvent(new Event('submit',{cancelable:true}));
  await vi.advanceTimersByTimeAsync(20);

  const created=app.requests.find(r=>r.action==='conversation');
  expect(created).toBeDefined();
  const ws=app.sockets.at(-1);
  ws.receive({type:'opened',sessionId:created.id,engine:'pi',state:{}});
  ws.receive({type:'history',sessionId:created.id,entries:[]});
  ws.receive({type:'transfer',sessionId:created.id,scope:'hashed-user-scope-'+created.id,url:location.origin,token:'new-task-tok',maxFileBytes:10_000_000,maxBatchBytes:50_000_000});
  await vi.advanceTimersByTimeAsync(30);

  ws.receive({type:'models',sessionId:created.id,models:[],context:{preset:'272k'}});
  const sentPrompt=app.frames.find(f=>f.type==='prompt');
  expect(sentPrompt).toBeDefined();
  expect(sentPrompt.text).toContain('请总结附件');
  expect(sentPrompt.text).toContain('[已上传到工作目录的文件]');
  expect(sentPrompt.text).toContain('inbox/notes.txt');

  // 3. Reloading history parses [已上传到工作目录的文件] back into clickable .file-chip pills and keeps same-origin + refreshed tokens on poll
  ws.receive({type:'history',sessionId:created.id,entries:[{kind:'user',id:'u1',text:sentPrompt.text}]});
  ws.receive({type:'transfer',sessionId:created.id,scope:'hashed-user-scope-'+created.id,url:'http://unreachable.vm:53317',token:'rotated-tok-99',maxFileBytes:10_000_000,maxBatchBytes:50_000_000});
  await vi.advanceTimersByTimeAsync(20);
  expect(q('#thread .msg.user .text').textContent).toBe('请总结附件');
  const chip=q<HTMLAnchorElement>('#thread .msg.user a.file-chip');
  expect(chip).not.toBeNull();
  expect(chip.querySelector('.file-name')?.textContent).toBe('notes.txt');
  expect(chip.href).toContain(location.origin);
  expect(chip.href).toContain('token=rotated-tok-99');
  expect(q('#upload-log')?.textContent).toContain('notes.txt');
});

