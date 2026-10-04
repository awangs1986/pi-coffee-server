// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {afterEach,it,expect,vi} from 'vitest';
import {IDBFactory,IDBDatabase as FakeIDBDatabase} from 'fake-indexeddb';
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();history.replaceState(null,'','/');localStorage.clear();sessionStorage.clear();vi.resetModules();});
async function setup(legacy=false,wide=false,catalog=true,piCatalog=false,authUser?:string,workspaceRead?:Promise<void>){
 document.documentElement.innerHTML=readFileSync('public/index.html','utf8');
 Object.defineProperty(window,'matchMedia',{value:(query:string)=>({matches:wide && query.includes('min-width'),addEventListener(){}}),configurable:true});Element.prototype.scrollTo=vi.fn();
 const sidebar:{showGroups?:boolean;assignments:Record<string,string|null>;collapsed:string[];groups?:Array<{id:string;name:string}>;hiddenProjects?:string[]}={assignments:{} as Record<string,string|null>,collapsed:[] as string[]};
 const requests:any[]=[],frames:any[]=[],conversations:any[]=[],sockets:any[]=[],projects:any[]=[{id:'p',name:'demo',branch:'main'}];
 class Socket{static OPEN=1;readyState=1;onopen:any;onmessage:any;onclose:any;onerror:any;constructor(){sockets.push(this);queueMicrotask(()=>this.onopen?.());}close(){}send(text:string){frames.push(JSON.parse(text));}receive(frame:any){this.onmessage?.({data:JSON.stringify(frame)});}}
 vi.stubGlobal('WebSocket',Socket);
 vi.stubGlobal('fetch',vi.fn(async(url:any,init:any)=>{
  if(url==='/api/skills') {const body=JSON.parse(init.body);requests.push(body);return {ok:true,status:200,json:async()=>body.action==='discover'?{revision:'a'.repeat(40),skills:[{name:'demo',description:'Demo skill',subdir:'skills/demo',installed:false},{name:'other',description:'Other skill',subdir:'skills/other',installed:false}],warnings:[]}:body.action==='detail'?{content:'---\nname: sample\ndescription: Fixture skill.\n---\n<script>not executable</script>'}:body.action==='list'?{directory:'/home/demo/.pi/agent/skills',skills:[{id:'skill-1',name:'sample',description:'Fixture skill.',managed:true,enabled:true,path:'/home/demo/.pi/agent/skills/sample/SKILL.md',revision:'abcdef123456',repoUrl:'https://example.com/skills.git',ref:'main',subdir:'skills/sample'}],warnings:[]}:({ok:true})};}
  if(url==='/auth/me'&&authUser)return {ok:true,status:200,json:async()=>({auth:true,user:authUser})};
  if(url==='/api/workspace'&&!init?.body)await workspaceRead;
  if(url==='/api/me')return {ok:true,json:async()=>null};
  if(url==='/api/engines')return {ok:!legacy,json:async()=>({takeover:true,engines:[{id:'pi',name:'Pi',available:true,modelCatalog:piCatalog},{id:'codex',name:'Codex',available:true,modelCatalog:catalog},{id:'claude',name:'Claude Code',available:false,reason:'CLI unavailable'}]})};
  const body=init?.body?JSON.parse(init.body):null;if(!body)return {ok:true,json:async()=>({projects,conversations,sidebar,vmId:'linux001',capabilities:{chatWorkspaces:true}})};
  requests.push(body);if(body.action==='takeover'){const task=conversations.find(c=>c.id===body.id);task.takeover??={id:'switch-1',status:'preparing',from:body.expectedEngine,to:body.engine};return {ok:true,json:async()=>task.takeover};}
  if(body.action==='sidebar_move'){sidebar.assignments[body.id]=body.projectId;return {ok:true,json:async()=>structuredClone(sidebar)};}
  if(body.action==='sidebar_group_create'){sidebar.groups=[...(sidebar.groups??[]),{id:'custom-group',name:body.name.trim()}];sidebar.showGroups=true;return {ok:true,json:async()=>structuredClone(sidebar)};}
  if(body.action==='sidebar_group_delete'){sidebar.groups=(sidebar.groups??[]).filter(g=>g.id!==body.groupId);return {ok:true,json:async()=>structuredClone(sidebar)};}
  if(body.action==='sidebar_display'){sidebar.showGroups=body.showGroups;return {ok:true,json:async()=>structuredClone(sidebar)};}
  if(body.action==='sidebar_collapse'){sidebar.collapsed=body.collapsed?[body.projectId]:[];return {ok:true,json:async()=>structuredClone(sidebar)};}
  if(body.action==='conversation'){const c={...body,cwd:'/home/test/chats/'+body.id,creationState:'ready'};conversations.push(c);return {ok:true,json:async()=>c};}
  if(body.action==='project'){const p={id:'new-project',name:body.name,branch:'main'};projects.push(p);return {ok:true,json:async()=>p};}
  if(body.action==='branches')return {ok:true,json:async()=>['main']};
  if(body.action==='changes')return {ok:true,json:async()=>({branch:'coffee/demo',base:'abc123',target:'def456',refreshedAt:'2026-09-23',files:[{path:'src/a.ts',status:'M',additions:1,deletions:1}],patch:'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -9,2 +9,2 @@\n-before\n+after\n unchanged',checks:[]})};
  return {ok:true,json:async()=>({state:'local',files:[]})};
 }));vi.useFakeTimers();await import('../public/app.js');await vi.advanceTimersByTimeAsync(20);
 return {requests,frames,sockets,conversations};
}
it('fixes Agent at Task creation, scopes Model controls and ignores obsolete socket frames',async()=>{
 const app=await setup();const select=document.querySelector<HTMLSelectElement>('#task-engine')!;
 expect([...select.options].map(o=>o.value)).toEqual(['pi','codex','claude']);expect(select.options[2].disabled).toBe(true);
 chooseWork();select.value='codex';select.dispatchEvent(new Event('change'));document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const created=app.requests.find(r=>r.action==='conversation');expect(created.engine).toBe('codex');expect(select.disabled).toBe(true);
 expect(app.frames.find(f=>f.type==='open')).toMatchObject({sessionId:created.id,nativeProtocol:1});
 app.sockets[0].receive({type:'opened',engine:'codex',sessionId:created.id,state:{},capabilities:{models:true,tools:true,questions:true,stop:true,images:true}});
 app.sockets[0].receive({type:'history',sessionId:created.id,entries:[]});await vi.advanceTimersByTimeAsync(10);
 expect(app.frames.filter(f=>f.type.startsWith('get_')).map(f=>f.type)).toEqual(['get_model_catalog','get_models']);
 expect(document.querySelector('#plugins-btn')?.classList.contains('hidden')).toBe(true);
 const oldHandler=app.sockets[0].onmessage;document.querySelector<HTMLButtonElement>('#new-task')!.click();await vi.advanceTimersByTimeAsync(10);
 oldHandler({data:JSON.stringify({type:'opened',sessionId:'obsolete',state:{}})});expect(localStorage.getItem('pi-coffee.active.v2')).toBeNull();
});
it('keeps Pi available and disables native choices on a legacy Host',async()=>{
 await setup(true);const options=[...document.querySelector<HTMLSelectElement>('#task-engine')!.options];expect(options.map(o=>o.disabled)).toEqual([false,true,true]);
});
it.each(['steer','follow_up'])('keeps the active Pi reply and Stop available after a rejected %s command',async(mode)=>{
 const app=await setup();document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const id=app.requests.find(r=>r.action==='conversation').id,ws=app.sockets[0];
 const opened={type:'opened',sessionId:id,engine:'pi',state:{isStreaming:true}};
 ws.receive(opened);ws.receive({type:'history',sessionId:id,entries:[]});
 const emit=(event:unknown)=>ws.receive({type:'event',sessionId:id,event});
 emit({type:'agent_start'});emit({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'Still '}});
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;
 document.querySelector<HTMLSelectElement>('#mode')!.value=mode;
 prompt.value='/harness work';prompt.dispatchEvent(new Event('input'));document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));
 const queued=app.frames.find(f=>f.type==='prompt');expect(queued).toMatchObject({mode,text:'/harness work'});
 ws.receive({type:'ack',operation:mode,requestId:queued.requestId});
 ws.receive({type:'error',code:'operation_failed',requestId:queued.requestId,message:'Extension commands cannot be queued.'});
 expect(document.querySelector('#thread')?.textContent).toContain('Extension commands cannot be queued.');
 expect(document.querySelector('#stop')?.classList.contains('hidden')).toBe(false);
 expect(document.querySelector('#mode-wrap')?.classList.contains('hidden')).toBe(false);
 emit({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'working.'}});await vi.advanceTimersByTimeAsync(50);
 expect(document.querySelectorAll('.msg.assistant')).toHaveLength(1);
 expect(document.querySelector('.msg.assistant')?.textContent).toContain('Still working.');
 document.querySelector<HTMLButtonElement>('#stop')!.click();expect(app.frames.at(-1)).toMatchObject({type:'abort'});
 ws.onclose();await vi.advanceTimersByTimeAsync(1300);
 const next=app.sockets.at(-1);next.receive(opened);next.receive({type:'history',sessionId:id,entries:[]});
 expect(document.querySelector('#thread')?.textContent).not.toContain('交付状态尚不确定');
 expect(app.frames.filter(f=>f.type==='prompt')).toHaveLength(1);
});
it.each([false,true])('allows retry after a rejected Pi prompt (queued input promoted to prompt: %s)',async(wasRunning)=>{
 const app=await setup();document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const id=app.requests.find(r=>r.action==='conversation').id,ws=app.sockets[0];
 ws.receive({type:'opened',sessionId:id,engine:'pi',state:{isStreaming:wasRunning}});
 ws.receive({type:'history',sessionId:id,entries:[]});
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;
 prompt.value='first try';prompt.dispatchEvent(new Event('input'));document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));
 const first=app.frames.find(f=>f.type==='prompt');
 ws.receive({type:'ack',operation:'prompt',requestId:first.requestId});
 ws.receive({type:'error',code:'operation_failed',requestId:first.requestId,message:'No API key found for the selected model.'});
 expect(document.querySelector('#stop')?.classList.contains('hidden')).toBe(true);
 expect(document.querySelector('#mode-wrap')?.classList.contains('hidden')).toBe(true);
 prompt.value='explicit retry';prompt.dispatchEvent(new Event('input'));document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));
 const retry=app.frames.filter(f=>f.type==='prompt');expect(retry).toHaveLength(2);expect(retry[1].mode).toBeUndefined();
 expect(retry[1].text).toBe('explicit retry');expect(document.querySelector('#stop')?.classList.contains('hidden')).toBe(false);
});
it('renders replayed native items once, answers a native question and never resends an uncertain prompt',async()=>{
 const app=await setup();chooseWork();document.querySelector<HTMLSelectElement>('#task-engine')!.value='codex';document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const id=app.requests.find(r=>r.action==='conversation').id,ws=app.sockets[0];
 const opened={type:'opened',sessionId:id,engine:'codex',state:{},capabilities:{models:true,stop:true,questions:true,tools:true}};
 ws.receive(opened);ws.receive({type:'history',sessionId:id,entries:[]});
 const emit=(event:any,cursor:number)=>ws.receive({type:'event',sessionId:id,cursor,event});
 emit({type:'run_started'},1);emit({type:'message_delta',id:'a1',delta:'Hello'},2);emit({type:'message_delta',id:'a1',delta:'Hello'},2);emit({type:'message_completed',id:'a1',text:'Hello'},3);
 emit({type:'tool_update',id:'t1',name:'Read',args:{path:'note.txt'},status:'inProgress'},4);emit({type:'tool_update',id:'t1',status:'completed',result:'native content'},5);
 emit({type:'native_request',id:'q1',method:'input',title:'Choose color',message:'blue'},6);
 expect(document.querySelector('#ui-title')?.textContent).toBe('Choose color');(document.querySelector('#ui-input') as HTMLInputElement).value='blue';document.querySelector<HTMLButtonElement>('#ui-ok')!.click();
 expect(app.frames.find(f=>f.type==='ui_response')).toMatchObject({id:'q1',value:'blue'});emit({type:'run_completed',status:'completed'},7);
 await vi.advanceTimersByTimeAsync(50);const nativeTool=document.querySelector<HTMLDetailsElement>('#thread .tool')!;nativeTool.open=true;nativeTool.dispatchEvent(new Event('toggle'));expect(document.querySelector('#thread')?.textContent).toContain('native content');expect(document.querySelector('#thread')?.textContent).not.toContain('HelloHello');
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;prompt.value='one turn';prompt.dispatchEvent(new Event('input'));document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));
 expect(app.frames.filter(f=>f.type==='prompt')).toHaveLength(1);ws.onclose();await vi.advanceTimersByTimeAsync(1300);const next=app.sockets.at(-1);next.receive(opened);next.receive({type:'history',sessionId:id,entries:[]});
 expect(app.frames.filter(f=>f.type==='prompt')).toHaveLength(1);expect(document.querySelector('#thread')?.textContent).toContain('不会自动重发');
 document.querySelector<HTMLButtonElement>('#task-details-btn')!.click();expect(document.querySelector('#task-details')!.classList.contains('hidden')).toBe(false);
 prompt.value='a new explicit instruction';prompt.dispatchEvent(new Event('input'));expect(document.querySelector<HTMLButtonElement>('#send')!.disabled).toBe(false);
 document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));expect(app.frames.filter(f=>f.type==='prompt')).toHaveLength(2);
});
it.each(['pi','codex'].flatMap(engine=>['prompt','steer','follow_up'].map(mode=>({engine,mode}))))('does not mark acknowledged $engine $mode uncertain after reconnect and permits continuing',async({engine,mode})=>{
 const app=await setup();chooseWork();document.querySelector<HTMLSelectElement>('#task-engine')!.value=engine;document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const id=app.requests.find(r=>r.action==='conversation').id,ws=app.sockets[0];
 const opened={type:'opened',sessionId:id,engine,state:{isStreaming:false},capabilities:{models:true,stop:true,steer:true,followUp:true}};
 ws.receive({...opened,state:{isStreaming:mode!=='prompt'}});ws.receive({type:'history',sessionId:id,entries:[]});
 document.querySelector<HTMLSelectElement>('#mode')!.value=mode==='prompt'?'follow_up':mode;
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;
 prompt.value='accepted request';prompt.dispatchEvent(new Event('input'));document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));
 const first=app.frames.find(f=>f.type==='prompt');ws.receive({type:'ack',operation:mode,requestId:first.requestId});
 ws.onclose();await vi.advanceTimersByTimeAsync(1300);const next=app.sockets.at(-1);
 next.receive(opened);next.receive({type:'history',sessionId:id,entries:[{kind:'user',id:'u1',text:'accepted request'}]});
 expect(document.querySelector('#thread')?.textContent).not.toContain('交付状态尚不确定');
 expect(app.frames.filter(f=>f.type==='prompt')).toHaveLength(1);
 document.querySelector<HTMLButtonElement>('#task-details-btn')!.click();expect(document.querySelector('#task-details')!.classList.contains('hidden')).toBe(false);
 prompt.value='continue explicitly';prompt.dispatchEvent(new Event('input'));expect(document.querySelector<HTMLButtonElement>('#send')!.disabled).toBe(false);
 document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));expect(app.frames.filter(f=>f.type==='prompt')).toHaveLength(2);
});
it.each(['pi','codex'])('reconciles a %s context change with lost acknowledgement before allowing continuation',async(engine)=>{
 const app=await setup();chooseWork();document.querySelector<HTMLSelectElement>('#task-engine')!.value=engine;document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const id=app.requests.find(r=>r.action==='conversation').id,ws=app.sockets[0];
 const opened={type:'opened',sessionId:id,engine,state:{},capabilities:{models:true}};
 const models={type:'models',sessionId:id,models:[{provider:'fixture',id:'large'}],current:{provider:'fixture',id:'large'},context:{preset:'272k'}};
 ws.receive(opened);ws.receive({type:'history',sessionId:id,entries:[]});ws.receive(models);
 document.querySelector<HTMLButtonElement>('#agent-menu-btn')!.click();document.querySelector<HTMLButtonElement>('#agent-context-row')!.click();
 [...document.querySelectorAll<HTMLButtonElement>('#agent-context-pane button')].find(b=>b.textContent!.includes('500K'))!.click();document.querySelector<HTMLButtonElement>('#modal-ok')!.click();await vi.advanceTimersByTimeAsync(1);
 expect(app.frames.filter(f=>f.type==='set_context')).toHaveLength(1);
 ws.onclose();await vi.advanceTimersByTimeAsync(1300);const next=app.sockets.at(-1);next.receive(opened);next.receive({type:'history',sessionId:id,entries:[]});next.receive({...models,context:{preset:'maximum'}});
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;prompt.value='continue after reconnect';prompt.dispatchEvent(new Event('input'));
 expect(document.querySelector<HTMLButtonElement>('#send')!.disabled).toBe(false);
 expect(app.frames.filter(f=>f.type==='set_context')).toHaveLength(1);
});
it('restores this tab selection even when another tab last selected another Task',async()=>{
 sessionStorage.setItem('pi-coffee.active.v2','this-tab');localStorage.setItem('pi-coffee.active.v2','other-tab');
 const app=await setup();expect(app.frames.find(f=>f.type==='open')).toMatchObject({sessionId:'this-tab'});
});
it('opens seven-category context usage on click without cumulative data and closes explicitly',async()=>{
 const app=await setup();document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const id=app.requests.find(r=>r.action==='conversation').id,ws=app.sockets[0];
 ws.receive({type:'opened',sessionId:id,engine:'pi',state:{}});
 ws.receive({type:'stats',sessionId:id,stats:{contextUsage:{percent:25,tokens:10000,contextWindow:40000},contextBreakdown:{version:1,contextWindow:40000,totalTokens:10000,method:'o200k_base_estimate',basis:'last_request',categories:[{id:'system',tokens:1000},{id:'tools',tokens:2000},{id:'rules',tokens:500},{id:'skills',tokens:500},{id:'dynamic',tokens:0},{id:'subagents',tokens:0},{id:'conversation',tokens:6000}]},tokens:{input:90000,output:10000,total:100000},cost:0.1}});
 const trigger=document.querySelector<HTMLButtonElement>('#stats')!;
 const panel=document.querySelector<HTMLDialogElement>('#stats-pop')!;
 // JSDOM lacks the native modal API; actual top-layer painting is verified in Chromium.
 panel.showModal=()=>panel.setAttribute('open','');panel.close=()=>{panel.removeAttribute('open');panel.dispatchEvent(new Event('close'));};
 trigger.dispatchEvent(new Event('mouseenter'));trigger.focus();await vi.advanceTimersByTimeAsync(1);
 expect(trigger.getAttribute('aria-expanded')).toBe('false');
 trigger.click();expect(panel.open).toBe(true);expect(trigger.getAttribute('aria-expanded')).toBe('true');
 expect(document.querySelector('#sp-capacity')?.textContent).toBe('~10.0K / 40K 词元');
 expect([...document.querySelectorAll('#sp-context-legend .legend-label')].map(e=>e.textContent)).toEqual(['系统提示词','工具定义','项目规则','技能','MCP 与动态工具','子代理定义','对话']);
 expect(document.querySelector('#sp-context-legend')?.textContent).toContain('6.0K');
 expect(document.querySelector('#sp-context-legend')?.textContent).not.toContain('90.0K');
 expect(panel.textContent).not.toContain('累计输入');
 document.querySelector<HTMLButtonElement>('#stats-close')!.click();expect(panel.open).toBe(false);expect(document.activeElement).toBe(trigger);
 trigger.click();panel.dispatchEvent(new Event('cancel',{cancelable:true}));expect(panel.open).toBe(false);
 ws.receive({type:'stats',sessionId:id,stats:{contextUsage:{percent:null,tokens:null,contextWindow:40000},tokens:{total:100000},cost:0.1}});
 expect(document.querySelector('#sp-pct')?.textContent).toBe('用量暂不可用');
 expect(document.querySelector('#sp-capacity')?.textContent).toBe('— / 40K 词元');
 expect(document.querySelector('#sp-context-legend')?.textContent).not.toContain('30.0K');
});

it('collapses task details when starting another Task',async()=>{
 await setup();const button=document.querySelector<HTMLButtonElement>('#task-details-btn')!,popover=document.querySelector('#task-details')!;
 button.click();expect(popover.classList.contains('hidden')).toBe(false);expect(button.getAttribute('aria-expanded')).toBe('true');
 expect(popover.textContent).toContain('发送第一条消息后创建任务目录');
 document.querySelector<HTMLButtonElement>('#new-task')!.click();
 expect(popover.classList.contains('hidden')).toBe(true);expect(button.getAttribute('aria-expanded')).toBe('false');
});

function chooseWork(){const kind=document.querySelector<HTMLSelectElement>('#task-kind')!;kind.value='project';kind.dispatchEvent(new Event('change'));document.querySelector<HTMLSelectElement>('#project-select')!.value='p';}
it('creates and selects a Gitea project beside the Work selector without changing Agent or draft',async()=>{
 const app=await setup();const button=document.querySelector<HTMLButtonElement>('#project-create')!;
 expect(button).not.toBeNull();expect(button.classList.contains('hidden')).toBe(true);
 chooseWork();expect(button.classList.contains('hidden')).toBe(false);
 const engine=document.querySelector<HTMLSelectElement>('#task-engine')!;engine.value='codex';engine.dispatchEvent(new Event('change'));
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;prompt.value='keep this draft';
 button.click();expect(document.querySelector('#modal-title')?.textContent).toBe('新建 Gitea 项目');
 document.querySelector<HTMLInputElement>('#modal-input')!.value='new-demo';document.querySelector<HTMLButtonElement>('#modal-ok')!.click();await vi.advanceTimersByTimeAsync(20);
 expect(app.requests.filter(r=>r.action==='project')).toEqual([{action:'project',name:'new-demo'}]);
 expect(document.querySelector<HTMLSelectElement>('#project-select')!.value).toBe('new-project');
 expect(document.querySelector<HTMLInputElement>('#start-branch')!.value).toBe('main');
 expect(engine.value).toBe('codex');expect(prompt.value).toBe('keep this draft');
 expect(app.requests.some(r=>r.action==='conversation')).toBe(false);
 document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 expect(app.requests.find(r=>r.action==='conversation')).toMatchObject({projectId:'new-project',engine:'codex',branch:'main'});
 expect(button.classList.contains('hidden')).toBe(true);
});
it.each(['cancel','failure'])('retains the Work selection when Gitea creation ends with %s',async(outcome)=>{
 const app=await setup();chooseWork();
 const branch=document.querySelector<HTMLInputElement>('#start-branch')!;branch.value='feature/existing';
 const button=document.querySelector<HTMLButtonElement>('#project-create')!;button.click();
 if(outcome==='cancel')document.querySelector<HTMLButtonElement>('#modal-cancel')!.click();
 else {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({error:'Gitea repository already exists'}),{status:409}));
  document.querySelector<HTMLInputElement>('#modal-input')!.value='existing';document.querySelector<HTMLButtonElement>('#modal-ok')!.click();
 }
 await vi.advanceTimersByTimeAsync(20);
 expect(document.querySelector<HTMLSelectElement>('#project-select')!.value).toBe('p');expect(branch.value).toBe('feature/existing');
 expect(button.disabled).toBe(false);expect(app.requests.some(r=>r.action==='conversation')).toBe(false);
 if(outcome==='cancel')expect(app.requests.some(r=>r.action==='project')).toBe(false);
 else expect(document.querySelector('#toast')?.textContent).toContain('Gitea repository already exists');
});
it('defaults new conversations to Pi Chat and only offers native engines for Work',async()=>{
 const app=await setup();const kind=document.querySelector<HTMLSelectElement>('#task-kind')!,engine=document.querySelector<HTMLSelectElement>('#task-engine')!;
 expect(kind.value).toBe('chat');expect(engine.value).toBe('pi');expect(engine.disabled).toBe(true);expect(engine.options[1].disabled).toBe(true);
 chooseWork();expect(engine.disabled).toBe(false);expect(engine.options[1].disabled).toBe(false);expect(engine.options[2].disabled).toBe(true);
 engine.value='codex';kind.value='chat';kind.dispatchEvent(new Event('change'));expect(engine.value).toBe('pi');
 document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 expect(app.requests.find(r=>r.action==='conversation')).toMatchObject({engine:'pi',workspaceKind:'chat'});
});
it('keeps global project/archive commands in the brand menu and review closed until requested',async()=>{
 await setup(false,true);
 for(const id of ['project-add','project-discover','show-active','show-archive'])expect(document.querySelector('#'+id)!.closest('#brand-menu')).not.toBeNull();
 expect(document.querySelector('#workspace-panel')!.classList.contains('hidden')).toBe(true);
 document.querySelector<HTMLButtonElement>('#files-toggle')!.click();expect(document.querySelector('#workspace-panel')!.classList.contains('hidden')).toBe(false);
 document.querySelector<HTMLButtonElement>('#new-task')!.click();expect(document.querySelector('#workspace-panel')!.classList.contains('hidden')).toBe(true);
 document.querySelector<HTMLButtonElement>('#brand-menu-btn')!.click();expect(document.querySelector('#brand-menu')!.classList.contains('hidden')).toBe(false);
 document.querySelector<HTMLButtonElement>('#show-archive')!.click();expect(document.querySelector('#brand-menu')!.classList.contains('hidden')).toBe(true);
});

it('opens a separate numbered Diff with functional Unified/Split and file folding',async()=>{
 const app=await setup();chooseWork();document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const id=app.requests.find(r=>r.action==='conversation').id;app.sockets[0].receive({type:'opened',sessionId:id,engine:'pi',state:{}});await vi.advanceTimersByTimeAsync(20);
 const dialog=document.querySelector<HTMLDialogElement>('#diff-dialog')!;dialog.showModal=()=>dialog.setAttribute('open','');dialog.close=()=>dialog.removeAttribute('open');
 document.querySelector<HTMLButtonElement>('#files-toggle')!.click();document.querySelector<HTMLButtonElement>('#view-all-changes')!.click();await vi.advanceTimersByTimeAsync(20);
 expect(dialog.open).toBe(true);expect(dialog.textContent).toContain('src/a.ts');expect(dialog.textContent).toContain('before');expect(dialog.textContent).toContain('after');
 expect([...dialog.querySelectorAll('.review-line-number')].map(n=>n.textContent)).toContain('9');
 document.querySelector<HTMLButtonElement>('#diff-split')!.click();expect(dialog.querySelector('table')?.getAttribute('data-layout')).toBe('split');expect(document.querySelector('#diff-split')?.getAttribute('aria-pressed')).toBe('true');
 expect([...dialog.querySelectorAll('tbody tr')].some(r=>r.textContent?.includes('before')&&r.textContent?.includes('after'))).toBe(true);
 document.querySelector<HTMLButtonElement>('#diff-collapse')!.click();expect(dialog.querySelector<HTMLDetailsElement>('.review-file')!.open).toBe(false);
 document.querySelector<HTMLButtonElement>('#diff-unified')!.click();expect(dialog.querySelector('table')?.getAttribute('data-layout')).toBe('unified');
 document.querySelector<HTMLButtonElement>('#diff-close')!.click();expect(dialog.open).toBe(false);expect(document.querySelector('#workspace-panel')!.classList.contains('hidden')).toBe(false);
});

it('opens search as a separate view, filters results without filtering the sidebar, and preserves the draft',async()=>{
 const app=await setup();const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;prompt.value='unfinished draft';
 app.sockets[0].receive({type:'sessions',sessions:[{id:'one',name:'Alpha project',updatedAt:new Date().toISOString()},{id:'two',name:'Beta chat',updatedAt:new Date().toISOString()}]});
 const trigger=document.querySelector<HTMLButtonElement>('#search-open');expect(trigger).not.toBeNull();expect(document.querySelector('.sidebar input[type="search"]')).toBeNull();
 trigger!.click();expect(document.querySelector('#search-page')!.classList.contains('hidden')).toBe(false);expect(document.activeElement).toBe(document.querySelector('#search'));
 const input=document.querySelector<HTMLInputElement>('#search')!;input.value='Alpha';input.dispatchEvent(new Event('input'));
 expect(document.querySelector('#search-results')!.textContent).toContain('Alpha project');expect(document.querySelector('#search-results')!.textContent).not.toContain('Beta chat');
 expect(document.querySelector('#session-list')!.textContent).toContain('Beta chat');expect(app.frames.filter(f=>f.type==='prompt'||f.type==='abort')).toHaveLength(0);
 document.querySelector<HTMLButtonElement>('#search-close')!.click();expect(document.querySelector('#search-page')!.classList.contains('hidden')).toBe(true);expect(prompt.value).toBe('unfinished draft');
 trigger!.click();document.querySelector<HTMLButtonElement>('#new-task')!.click();expect(document.querySelector('#search-page')!.classList.contains('hidden')).toBe(true);
});

it('filters search by actual task kind and archive state, and Escape returns without stopping a run',async()=>{
 const app=await setup();app.conversations.push({id:'chat',workspaceKind:'chat'},{id:'work',workspaceKind:'project'},{id:'archived',workspaceKind:'chat',archived:true});await vi.advanceTimersByTimeAsync(5000);
 app.sockets[0].receive({type:'sessions',sessions:[{id:'chat',name:'Chat result',updatedAt:new Date().toISOString()},{id:'work',name:'Work result',updatedAt:new Date().toISOString()},{id:'archived',name:'Archived result',updatedAt:new Date().toISOString()}]});
 document.querySelector<HTMLButtonElement>('#search-open')!.click();
 for(const [filter,name] of [['chat','Chat result'],['project','Work result'],['archived','Archived result']]){
  document.querySelector<HTMLButtonElement>('[data-filter="'+filter+'"]')!.click();
  expect([...document.querySelectorAll('.search-result-title')].map(n=>n.textContent)).toEqual([name]);
 }
 document.querySelector<HTMLInputElement>('#search')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 expect(document.querySelector('#search-page')!.classList.contains('hidden')).toBe(true);expect(app.frames.filter(f=>f.type==='abort')).toHaveLength(0);
});

it('manages scoped Skills from the brand menu without losing the conversation draft',async()=>{
 const app=await setup();const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;prompt.value='keep this draft';
 const entry=document.querySelector<HTMLButtonElement>('#skills-btn');expect(entry).not.toBeNull();expect(entry!.closest('#brand-menu')).not.toBeNull();
 entry!.click();await vi.advanceTimersByTimeAsync(20);expect(document.querySelector('#skills-page')!.classList.contains('hidden')).toBe(false);
 expect(document.querySelector('#skills-list')!.textContent).toContain('sample');expect(app.requests.at(-1)).toMatchObject({action:'list',engine:'pi',scope:'user'});
 document.querySelector<HTMLButtonElement>('[data-skill-action="detail"]')!.click();await vi.advanceTimersByTimeAsync(20);
 expect(document.querySelector('#skill-content')!.textContent).toContain('<script>not executable</script>');expect(document.querySelector('#skill-content script')).toBeNull();
 document.querySelector<HTMLButtonElement>('[data-skill-action="disable"]')!.click();await vi.advanceTimersByTimeAsync(20);expect(app.requests.some(r=>r.action==='disable'&&r.id==='skill-1')).toBe(true);
 const agent=document.querySelector<HTMLSelectElement>('#skills-engine')!;agent.value='codex';agent.dispatchEvent(new Event('change'));await vi.advanceTimersByTimeAsync(20);expect(app.requests.at(-1)).toMatchObject({engine:'codex',scope:'user'});
 document.querySelector<HTMLButtonElement>('#skills-close')!.click();expect(prompt.value).toBe('keep this draft');expect(document.querySelector('#skills-page')!.classList.contains('hidden')).toBe(true);expect(app.frames.some(f=>f.type==='prompt'||f.type==='abort')).toBe(false);
});

it('installs a Skill with explicit source and scope, and handles legacy Hosts without false success',async()=>{
 const app=await setup();document.querySelector<HTMLButtonElement>('#skills-btn')!.click();await vi.advanceTimersByTimeAsync(20);
 for(const [id,value] of [['skill-url','https://example.com/skills.git'],['skill-ref','v1'],['skill-subdir','skills/demo']])(document.querySelector('#'+id) as HTMLInputElement).value=value;
 document.querySelector('#skills-form')!.dispatchEvent(new Event('submit',{cancelable:true}));await vi.advanceTimersByTimeAsync(20);
 expect(app.requests.some(r=>r.action==='install')).toBe(false);
 const check=document.querySelector<HTMLInputElement>('[data-skill-subdir="skills/demo"]')!;check.checked=true;check.dispatchEvent(new Event('change'));
 document.querySelector('#skills-form')!.dispatchEvent(new Event('submit',{cancelable:true}));await vi.advanceTimersByTimeAsync(20);
 expect(app.requests.find(r=>r.action==='install')).toMatchObject({engine:'pi',scope:'user',repoUrl:'https://example.com/skills.git',ref:'v1',subdir:'skills/demo'});
 const original=fetch;vi.stubGlobal('fetch',vi.fn((url:any,init:any)=>url==='/api/skills'?Promise.resolve({ok:false,status:404,json:async()=>({error:'Unavailable'})}):original(url,init)));
 document.querySelector<HTMLButtonElement>('#skills-refresh')!.click();await vi.advanceTimersByTimeAsync(20);
 expect(document.querySelector('#skills-status')!.textContent).toContain('更新 Host');expect(document.querySelector<HTMLButtonElement>('#skills-install')!.disabled).toBe(true);
});

it('ignores stale Skill inventories after the user changes Agent',async()=>{
 await setup();const original=fetch;let release:any;
 vi.stubGlobal('fetch',vi.fn((url:any,init:any)=>{
  if(url==='/api/skills'&&JSON.parse(init.body).engine==='pi')return new Promise(resolve=>{release=resolve;});return original(url,init);
 }));
 document.querySelector<HTMLButtonElement>('#skills-btn')!.click();await vi.advanceTimersByTimeAsync(1);
 const select=document.querySelector<HTMLSelectElement>('#skills-engine')!;select.value='codex';select.dispatchEvent(new Event('change'));await vi.advanceTimersByTimeAsync(20);
 release({ok:true,json:async()=>({directory:'/old/pi',skills:[{id:'old',name:'obsolete-pi',description:'stale',managed:false,enabled:true}],warnings:[]})});await vi.advanceTimersByTimeAsync(20);
 expect(document.querySelector('#skills-list')!.textContent).not.toContain('obsolete-pi');expect(select.value).toBe('codex');
});


it.each(['pi','codex'].flatMap(agent=>['history-first','models-first','rejected'].map(order=>({agent,order}))))('selects a $agent draft model and waits before the first prompt ($order)',async({agent,order})=>{
 const app=await setup(false,false,true,agent==='pi');if(agent==='codex')chooseWork();const engine=document.querySelector<HTMLSelectElement>('#task-engine')!;
 if(agent==='codex'){engine.value=agent;engine.dispatchEvent(new Event('change'));}
 const query=app.frames.find(f=>f.type==='get_model_catalog' && f.engine===agent);expect(query).toMatchObject({engine:agent});
 expect(app.requests.some(r=>r.action==='conversation')).toBe(false);
 const ws=app.sockets.at(-1);
 ws.receive({type:'model_catalog',requestId:query.requestId,engine:agent,models:[{provider:agent,id:'default-model'},{provider:agent,id:'chosen-model'}],current:{provider:agent,id:'default-model'},thinkingLevels:[],thinkingLevel:''});
 const button=document.querySelector<HTMLButtonElement>('#agent-menu-btn')!;expect(button.disabled).toBe(false);button.click();
 document.querySelector<HTMLButtonElement>('#agent-model-row')!.click();
 [...document.querySelectorAll<HTMLButtonElement>('#agent-model-pane button')].find(b=>b.textContent?.includes('chosen-model'))!.click();
 expect(app.frames.some(f=>f.type==='set_model')).toBe(false);
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;prompt.value='first message';document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));
 expect(button.disabled).toBe(true);await vi.advanceTimersByTimeAsync(20);
 const id=app.requests.find(r=>r.action==='conversation').id;
 ws.receive({type:'opened',engine:agent,sessionId:id,state:{},capabilities:{models:true}});
 if(order!=='models-first')ws.receive({type:'history',sessionId:id,entries:[]});
 const change=app.frames.find(f=>f.type==='set_model');expect(change).toMatchObject({provider:agent,id:'chosen-model'});
 expect(app.frames.some(f=>f.type==='prompt')).toBe(false);
 if(order==='rejected'){ws.receive({type:'error',requestId:change.requestId,code:'operation_failed',message:'Model unavailable'});expect(app.frames.some(f=>f.type==='prompt')).toBe(false);expect(prompt.value).toBe('first message');return;}
 ws.receive({type:'ack',operation:'set_model',requestId:change.requestId});
 ws.receive({type:'models',requestId:app.frames.filter(f=>f.type==='get_models').at(-1).requestId,models:[{provider:agent,id:'chosen-model'}],current:{provider:agent,id:'chosen-model'},thinkingLevels:[],thinkingLevel:''});
 if(order==='models-first'){expect(app.frames.some(f=>f.type==='prompt')).toBe(false);ws.receive({type:'history',sessionId:id,entries:[]});}
 expect(app.frames.filter(f=>f.type==='prompt')).toEqual([expect.objectContaining({text:'first message'})]);
});

it('ignores a stale Codex catalog after switching back to Pi',async()=>{
 const app=await setup();chooseWork();const engine=document.querySelector<HTMLSelectElement>('#task-engine')!;
 engine.value='codex';engine.dispatchEvent(new Event('change'));const query=app.frames.find(f=>f.type==='get_model_catalog');
 engine.value='pi';engine.dispatchEvent(new Event('change'));
 app.sockets.at(-1).receive({type:'model_catalog',requestId:query.requestId,engine:'codex',models:[{provider:'codex',id:'stale-model'}],current:{provider:'codex',id:'stale-model'}});
 // The trigger stays usable for Agent/类型; only the model rows lock, and the stale Codex model never shows.
 const button=document.querySelector<HTMLButtonElement>('#agent-menu-btn')!;expect(button.disabled).toBe(false);expect(document.querySelector('#agent-name')!.textContent).toBe('Pi');
 button.click();expect(document.querySelector<HTMLButtonElement>('#agent-model-row')!.disabled).toBe(true);expect(document.querySelector('#agent-model-value')!.textContent).toBe('—');
 expect(engine.value).toBe('pi');expect(app.requests.some(r=>r.action==='conversation')).toBe(false);
});

it.each(['pi','codex'].flatMap(agent=>['default','high','rejected'].map(selection=>({agent,selection}))))('chooses $agent thinking before task creation ($selection), defaults to med and waits for acceptance',async({agent,selection})=>{
 const app=await setup(false,false,true,agent==='pi');if(agent==='codex'){chooseWork();const select=document.querySelector<HTMLSelectElement>('#task-engine')!;select.value=agent;select.dispatchEvent(new Event('change'));}
 const query=app.frames.find(f=>f.type==='get_model_catalog'&&f.engine===agent),ws=app.sockets.at(-1);
 ws.receive({type:'model_catalog',requestId:query.requestId,engine:agent,models:[{provider:agent,id:'reasoner',thinkingLevels:['low','medium','high']}],current:{provider:agent,id:'reasoner'},thinkingLevels:['low','medium','high'],thinkingLevel:'low'});
 const row=document.querySelector<HTMLButtonElement>('#agent-thinking-row')!;
 expect(row.classList.contains('hidden')).toBe(false);expect(row.disabled).toBe(false);
 expect(document.querySelector('#agent-thinking-value')!.textContent).toBe('med');
 const level=selection==='default'?'medium':'high';
 if(selection!=='default'){document.querySelector<HTMLButtonElement>('#agent-menu-btn')!.click();row.click();
 [...document.querySelectorAll<HTMLButtonElement>('#agent-thinking-pane button')].find(b=>b.textContent?.includes('high'))!.click();}
 expect(app.frames.some(f=>f.type==='set_thinking')).toBe(false);expect(app.requests.some(r=>r.action==='conversation')).toBe(false);
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;prompt.value='first at high';document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));await vi.advanceTimersByTimeAsync(20);
 const id=app.requests.find(r=>r.action==='conversation').id;
 ws.receive({type:'opened',engine:agent,sessionId:id,state:{},capabilities:{models:true}});ws.receive({type:'history',sessionId:id,entries:[]});
 const model=app.frames.find(f=>f.type==='set_model');ws.receive({type:'ack',operation:'set_model',requestId:model.requestId});
 ws.receive({type:'models',requestId:app.frames.filter(f=>f.type==='get_models').at(-1).requestId,models:[{provider:agent,id:'reasoner'}],current:{provider:agent,id:'reasoner'},thinkingLevels:['low','medium','high'],thinkingLevel:'low'});
 const thinking=app.frames.find(f=>f.type==='set_thinking');expect(thinking).toMatchObject({level});
 expect(app.frames.some(f=>f.type==='prompt')).toBe(false);
 if(selection==='rejected'){ws.receive({type:'error',requestId:thinking.requestId,code:'operation_failed',message:'Effort unavailable'});expect(prompt.value).toBe('first at high');expect(app.frames.some(f=>f.type==='prompt')).toBe(false);return;}
 ws.receive({type:'models',models:[{provider:agent,id:'reasoner'}],current:{provider:agent,id:'reasoner'},thinkingLevels:['low','medium','high'],thinkingLevel:level});
 expect(app.frames.some(f=>f.type==='prompt')).toBe(false);
 ws.receive({type:'ack',operation:'set_thinking',requestId:thinking.requestId});
 expect(app.frames.filter(f=>f.type==='prompt')).toEqual([expect.objectContaining({text:'first at high'})]);
});

it('does not request a draft model catalog from an older Host',async()=>{
 const app=await setup(false,false,false);chooseWork();const engine=document.querySelector<HTMLSelectElement>('#task-engine')!;
 engine.value='codex';engine.dispatchEvent(new Event('change'));
 expect(app.frames.some(f=>f.type==='get_model_catalog')).toBe(false);
 const button=document.querySelector<HTMLButtonElement>('#agent-menu-btn')!;expect(button.disabled).toBe(false);button.click();
 expect(document.querySelector<HTMLButtonElement>('#agent-model-row')!.disabled).toBe(true);
 expect(document.querySelector('#agent-menu-note')!.textContent).toContain('模型在任务创建后可选');
});

it('updates draft effort choices with the model and resets an unavailable choice to med',async()=>{
 const app=await setup(false,false,true,true),ws=app.sockets.at(-1),query=app.frames.find(f=>f.type==='get_model_catalog');
 const choices=[{provider:'pi',id:'reasoner',thinkingLevels:['low','medium','high']},{provider:'pi',id:'compact',thinkingLevels:['low','medium']},{provider:'pi',id:'plain',thinkingLevels:[]}];
 ws.receive({type:'model_catalog',requestId:query.requestId,engine:'pi',models:choices,current:{provider:'pi',id:'reasoner'},thinkingLevels:['low','medium','high'],thinkingLevel:'high'});
 const select=document.querySelector<HTMLSelectElement>('#thinking')!;select.value='high';select.dispatchEvent(new Event('change'));
 const models=document.querySelector<HTMLSelectElement>('#model')!;models.value='pi/compact';models.dispatchEvent(new Event('change'));
 expect(document.querySelector('#agent-thinking-value')!.textContent).toBe('med');expect([...select.options].map(o=>o.value)).toEqual(['low','medium']);
 models.value='pi/plain';models.dispatchEvent(new Event('change'));expect(document.querySelector('#agent-thinking-row')!.classList.contains('hidden')).toBe(true);
 models.value='pi/reasoner';models.dispatchEvent(new Event('change'));expect(document.querySelector('#agent-thinking-value')!.textContent).toBe('med');
 expect(app.frames.some(f=>['set_thinking','set_model'].includes(f.type))).toBe(false);
 document.querySelector<HTMLButtonElement>('#new-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const next=app.frames.filter(f=>f.type==='get_model_catalog').at(-1);
 app.sockets.at(-1).receive({type:'model_catalog',requestId:next.requestId,engine:'pi',models:choices,current:{provider:'pi',id:'reasoner'},thinkingLevel:'high'});
 expect(document.querySelector('#agent-thinking-value')!.textContent).toBe('med');
});

it('retains the first draft while model and effort discovery is still pending',async()=>{
 const app=await setup(false,false,true,true);const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;prompt.value='Wait for model options';
 document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));await vi.advanceTimersByTimeAsync(20);
 expect(app.requests.some(r=>r.action==='conversation')).toBe(false);expect(prompt.value).toBe('Wait for model options');
});

it('does not send the first prompt on stale model metadata before a rejected model choice',async()=>{
 const app=await setup(false,false,true,true),ws=app.sockets.at(-1),query=app.frames.find(f=>f.type==='get_model_catalog');
 ws.receive({type:'model_catalog',requestId:query.requestId,engine:'pi',models:[{provider:'pi',id:'wanted',thinkingLevels:['medium']}],current:{provider:'pi',id:'wanted'},thinkingLevels:['medium'],thinkingLevel:'medium'});
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;prompt.value='Only with wanted model';document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));await vi.advanceTimersByTimeAsync(20);
 const id=app.requests.find(r=>r.action==='conversation').id;ws.receive({type:'opened',engine:'pi',sessionId:id,state:{},capabilities:{models:true}});ws.receive({type:'history',sessionId:id,entries:[]});
 const model=app.frames.find(f=>f.type==='set_model');
 ws.receive({type:'models',requestId:'older-read',models:[{provider:'pi',id:'old'}],current:{provider:'pi',id:'old'},thinkingLevels:['medium'],thinkingLevel:'medium'});
 expect(app.frames.some(f=>f.type==='prompt')).toBe(false);
 ws.receive({type:'error',requestId:model.requestId,code:'operation_failed',message:'Model rejected'});
 expect(prompt.value).toBe('Only with wanted model');expect(app.frames.some(f=>f.type==='prompt')).toBe(false);
});

it('releases a pending effort change on cross-tab cache reconnection without replaying the prompt',async()=>{
 const app=await setup(false,false,true,true),ws=app.sockets.at(-1),query=app.frames.find(f=>f.type==='get_model_catalog');
 ws.receive({type:'model_catalog',requestId:query.requestId,engine:'pi',models:[{provider:'pi',id:'reasoner',thinkingLevels:['low','medium']}],current:{provider:'pi',id:'reasoner'},thinkingLevels:['low','medium'],thinkingLevel:'low'});
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;prompt.value='Retain this request';document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));await vi.advanceTimersByTimeAsync(20);
 const id=app.requests.find(r=>r.action==='conversation').id;ws.receive({type:'opened',engine:'pi',sessionId:id,state:{},capabilities:{models:true}});ws.receive({type:'history',sessionId:id,entries:[]});
 const model=app.frames.find(f=>f.type==='set_model');ws.receive({type:'ack',operation:'set_model',requestId:model.requestId});
 const metadata={type:'models',models:[{provider:'pi',id:'reasoner'}],current:{provider:'pi',id:'reasoner'},thinkingLevels:['low','medium'],thinkingLevel:'low'};
 ws.receive({...metadata,requestId:app.frames.filter(f=>f.type==='get_models').at(-1).requestId});
 expect(app.frames.find(f=>f.type==='set_thinking')).toMatchObject({level:'medium'});
 window.dispatchEvent(new StorageEvent('storage',{key:'pi-coffee.preview-clear.v1',newValue:'cache:fixture'}));await vi.advanceTimersByTimeAsync(20);
 const next=app.sockets.at(-1);expect(next).not.toBe(ws);
 next.receive({type:'opened',engine:'pi',sessionId:id,state:{},capabilities:{models:true}});next.receive({type:'history',sessionId:id,entries:[]});next.receive(metadata);
 expect(prompt.value).toBe('Retain this request');expect(document.querySelector<HTMLButtonElement>('#send')!.disabled).toBe(false);
 expect(app.frames.filter(f=>f.type==='set_thinking')).toHaveLength(1);expect(app.frames.some(f=>f.type==='prompt')).toBe(false);
});

it('locks draft model controls while explicit task creation is in flight',async()=>{
 const app=await setup();chooseWork();const engine=document.querySelector<HTMLSelectElement>('#task-engine')!;
 engine.value='codex';engine.dispatchEvent(new Event('change'));const query=app.frames.find(f=>f.type==='get_model_catalog');
 app.sockets.at(-1).receive({type:'model_catalog',requestId:query.requestId,engine:'codex',models:[{provider:'codex',id:'default-model'}],current:{provider:'codex',id:'default-model'}});
 const button=document.querySelector<HTMLButtonElement>('#agent-menu-btn')!;expect(button.disabled).toBe(false);
 document.querySelector<HTMLButtonElement>('#create-task')!.click();expect(button.disabled).toBe(true);
 await vi.advanceTimersByTimeAsync(20);
});

it('groups project tasks, folds them, and drags out/in without changing the task project or opening it',async()=>{
 const app=await setup();chooseWork();document.querySelector<HTMLSelectElement>('#project-select')!.value='p';
 document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const id=app.requests.find(r=>r.action==='conversation').id;
 const group=()=>document.querySelector<HTMLElement>('[data-sidebar-project="p"]')!;
 expect(group()).not.toBeNull();expect(group().textContent).toContain('demo');
 group().querySelector<HTMLButtonElement>('.project-group-toggle')!.click();await vi.advanceTimersByTimeAsync(20);
 expect(group().querySelector('ul')!.hidden).toBe(true);
 const opens=app.frames.filter(f=>f.type==='open').length;
 const transfer={setData:vi.fn(),getData:()=>id,effectAllowed:'',dropEffect:''};
 const drag=(target:Element,type:string)=>{const e=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,'dataTransfer',{value:transfer});target.dispatchEvent(e);return e;};
 group().querySelector<HTMLButtonElement>('.project-group-toggle')!.click();await vi.advanceTimersByTimeAsync(20);
 drag(group().querySelector('.session-item')!,'dragstart');expect(drag(document.querySelector('[data-sidebar-ungrouped]')!,'dragenter').defaultPrevented).toBe(true);drag(document.querySelector('[data-sidebar-ungrouped]')!,'drop');await vi.advanceTimersByTimeAsync(20);
 expect(group().querySelectorAll('.session-item')).toHaveLength(0);
 expect(document.querySelector('[data-sidebar-ungrouped] .session-item')).not.toBeNull();
 drag(document.querySelector('[data-sidebar-ungrouped] .session-item')!,'dragstart');drag(group(),'drop');await vi.advanceTimersByTimeAsync(20);
 expect(group().querySelectorAll('.session-item')).toHaveLength(1);
 expect(app.conversations[0].projectId).toBe('p');expect(app.frames.filter(f=>f.type==='open')).toHaveLength(opens);
 app.sockets[0].receive({type:'sessions',sessions:[]});expect(group().querySelectorAll('.session-item')).toHaveLength(1);
});
it('keeps prior sidebar placement on failed saves and supports the move menu',async()=>{
 const app=await setup();document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const id=app.requests.find(r=>r.action==='conversation').id;
 const moveSelect=()=>{document.querySelector<HTMLButtonElement>('[data-sidebar-ungrouped] .more')!.click();return document.querySelector<HTMLSelectElement>('[aria-label="移至侧栏分组"]')!;};
 const first=moveSelect();first.value='p';vi.mocked(fetch).mockResolvedValueOnce({ok:false,status:409,json:async()=>({error:'Cannot save grouping'})} as Response);first.dispatchEvent(new Event('change'));await vi.advanceTimersByTimeAsync(20);
 expect(document.querySelector('[data-sidebar-ungrouped] .session-item')).not.toBeNull();expect(document.body.textContent).toContain('Cannot save grouping');
 const retry=moveSelect();retry.value='p';retry.dispatchEvent(new Event('change'));await vi.advanceTimersByTimeAsync(20);
 expect(document.querySelector('[data-sidebar-project="p"] .session-item')?.getAttribute('data-session-id')).toBe(id);
 expect(app.conversations[0].workspaceKind).toBe('chat');expect(app.conversations[0].projectId).toBeUndefined();
});

it('defaults to groups, restores the original list when unchecked, and keeps saved folds and placements',async()=>{
 const app=await setup();chooseWork();document.querySelector<HTMLSelectElement>('#project-select')!.value='p';document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const toggle=()=>document.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"][id="show-groups"]')!;
 expect(toggle()).not.toBeNull();expect(toggle().getAttribute('aria-checked')).toBe('true');
 document.querySelector<HTMLButtonElement>('.project-group-toggle')!.click();await vi.advanceTimersByTimeAsync(20);
 document.querySelector<HTMLButtonElement>('#brand-menu-btn')!.click();toggle().click();await vi.advanceTimersByTimeAsync(20);
 expect(toggle().getAttribute('aria-checked')).toBe('false');expect(document.querySelector('.project-group')).toBeNull();
 expect(document.querySelector('#session-list .session-item')).not.toBeNull();expect(document.querySelector('#session-list')!.textContent).not.toContain('未分组');
 const openCount=app.frames.filter(f=>f.type==='open').length;
 toggle().click();await vi.advanceTimersByTimeAsync(20);
 expect(toggle().getAttribute('aria-checked')).toBe('true');expect(document.querySelector<HTMLUListElement>('.project-group-list')!.hidden).toBe(true);
 expect(app.frames.filter(f=>f.type==='open')).toHaveLength(openCount);
});

it('previews a Skill collection and reports partial installation without retrying successful selections',async()=>{
 const app=await setup();const original=fetch;
 vi.stubGlobal('fetch',vi.fn(async(url:any,init:any)=>{
  const body=init?.body?JSON.parse(init.body):{};
  if(url==='/api/skills'&&body.action==='install'&&body.subdir==='skills/other'){app.requests.push(body);return {ok:false,status:409,json:async()=>({error:'Package was changed; inspect source'})};}
  return original(url,init);
 }));
 document.querySelector<HTMLButtonElement>('#skills-btn')!.click();await vi.advanceTimersByTimeAsync(20);
 document.querySelector<HTMLInputElement>('#skill-url')!.value='https://example.com/collection.git';
 document.querySelector('#skills-form')!.dispatchEvent(new Event('submit',{cancelable:true}));await vi.advanceTimersByTimeAsync(20);
 expect(app.requests.filter(r=>r.action==='install')).toHaveLength(0);
 const choices=[...document.querySelectorAll<HTMLInputElement>('[data-skill-subdir]')];expect(choices).toHaveLength(2);
 expect(choices.every(c=>!c.checked)).toBe(true);
 for(const checkbox of choices){checkbox.checked=true;checkbox.dispatchEvent(new Event('change'));}
 document.querySelector('#skills-form')!.dispatchEvent(new Event('submit',{cancelable:true}));await vi.advanceTimersByTimeAsync(20);
 expect(app.requests.filter(r=>r.action==='install').map(r=>[r.subdir,r.expectedRevision])).toEqual([['skills/demo','a'.repeat(40)],['skills/other','a'.repeat(40)]]);
 expect(document.querySelector('#skills-status')!.textContent).toContain('1 成功，1 失败');
 expect(document.querySelector('#skill-candidates')!.textContent).toContain('Package was changed');
 expect(document.querySelector<HTMLInputElement>('[data-skill-subdir="skills/demo"]')!.disabled).toBe(true);
 document.querySelector('#skills-form')!.dispatchEvent(new Event('submit',{cancelable:true}));await vi.advanceTimersByTimeAsync(20);
 expect(app.requests.filter(r=>r.action==='install'&&r.subdir==='skills/demo')).toHaveLength(1);
 const agent=document.querySelector<HTMLSelectElement>('#skills-engine')!;agent.value='codex';agent.dispatchEvent(new Event('change'));await vi.advanceTimersByTimeAsync(20);
 expect(document.querySelectorAll('[data-skill-subdir]')).toHaveLength(0);
});

it('selects only visible installable Skills and clears that selection without installing anything',async()=>{
 const app=await setup(),original=fetch;
 vi.stubGlobal('fetch',vi.fn(async(url:any,init:any)=>{
  if(url==='/api/skills'&&JSON.parse(init.body).action==='discover')return {ok:true,json:async()=>({revision:'a'.repeat(40),skills:[
   {name:'demo',description:'Demo',subdir:'demo'}, {name:'other',description:'Other',subdir:'other'},
   {name:'existing',description:'Existing',subdir:'existing',installed:true}, {name:'invalid',description:'Invalid',subdir:'invalid',problem:'symlink'}
  ]})};return original(url,init);
 }));
 document.querySelector<HTMLButtonElement>('#skills-btn')!.click();await vi.advanceTimersByTimeAsync(20);
 document.querySelector<HTMLInputElement>('#skill-url')!.value='https://example.com/collection.git';
 document.querySelector('#skills-form')!.dispatchEvent(new Event('submit',{cancelable:true}));await vi.advanceTimersByTimeAsync(20);
 const all=document.querySelector<HTMLButtonElement>('#skills-select-all');expect(all).not.toBeNull();
 const search=document.querySelector<HTMLInputElement>('#skill-candidates input[type=search]')!;
 search.value='demo';search.dispatchEvent(new Event('input'));all!.click();
 expect([...document.querySelectorAll<HTMLInputElement>('[data-skill-subdir]:checked')].map(c=>c.dataset.skillSubdir)).toEqual(['demo']);
 search.value='';search.dispatchEvent(new Event('input'));all!.click();
 expect([...document.querySelectorAll<HTMLInputElement>('[data-skill-subdir]:checked')].map(c=>c.dataset.skillSubdir)).toEqual(['demo','other']);
 expect(document.querySelector('#skills-install')!.textContent).toContain('2');
 document.querySelector<HTMLButtonElement>('#skills-select-none')!.click();
 expect(document.querySelectorAll('[data-skill-subdir]:checked')).toHaveLength(0);
 expect(app.requests.filter(r=>r.action==='install')).toHaveLength(0);
});

it('offers native disable and restore while leaving plugin Skills read-only and invalidating stale previews',async()=>{
 const app=await setup(),original=fetch;let disabled=false;
 vi.stubGlobal('fetch',vi.fn(async(url:any,init:any)=>{
  const body=init?.body?JSON.parse(init.body):{};
  if(url==='/api/skills'&&body.action==='list')return {ok:true,json:async()=>({directory:'/native',skills:[
   {id:'native',name:'native',description:'Native',managed:false,enabled:!disabled,canDisable:!disabled,canRestore:disabled,path:'/native/native/SKILL.md'},
   {id:'bundled',name:'lsp',description:'Bundled',managed:false,enabled:true,path:'/plugin/lsp/SKILL.md'}
  ]})};
  if(url==='/api/skills'&&['disable_native','restore_native'].includes(body.action)){app.requests.push(body);disabled=body.action==='disable_native';return {ok:true,json:async()=>({ok:true})};}
  return original(url,init);
 }));
 document.querySelector<HTMLButtonElement>('#skills-btn')!.click();await vi.advanceTimersByTimeAsync(20);
 document.querySelector<HTMLInputElement>('#skill-url')!.value='https://example.com/skills.git';
 document.querySelector('#skills-form')!.dispatchEvent(new Event('submit',{cancelable:true}));await vi.advanceTimersByTimeAsync(20);
 expect(document.querySelectorAll('[data-skill-subdir]').length).toBeGreaterThan(0);
 const disable=document.querySelector<HTMLButtonElement>('[data-skill-action="disable_native"]');expect(disable).not.toBeNull();disable!.click();await vi.advanceTimersByTimeAsync(20);
 expect(app.requests.at(-1)).toMatchObject({action:'disable_native',engine:'pi',scope:'user',id:'native'});
 expect(document.querySelectorAll('[data-skill-subdir]')).toHaveLength(0);
 expect(document.querySelector('#skills-list')!.textContent).toContain('已停用 · 保留备份');
 const plugin=[...document.querySelectorAll('.skill-card')].find(e=>e.textContent!.includes('Bundled'))!;expect(plugin.querySelectorAll('button')).toHaveLength(1);
 document.querySelector<HTMLButtonElement>('[data-skill-action="restore_native"]')!.click();await vi.advanceTimersByTimeAsync(20);
 expect(app.requests.at(-1)).toMatchObject({action:'restore_native',id:'native'});
});

it('offers installed Pi Skills on slash in a new draft without creating a task or invoking a model',async()=>{
 const app=await setup();const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;
 prompt.value='/';prompt.dispatchEvent(new Event('input'));await vi.advanceTimersByTimeAsync(20);
 const request=app.frames.find(f=>f.type==='get_command_catalog');expect(request).toMatchObject({engine:'pi'});
 expect(app.frames.some(f=>f.type==='open'||f.type==='prompt')).toBe(false);
 app.sockets.at(-1).receive({v:1,type:'command_catalog',engine:'pi',requestId:request.requestId,commands:[{name:'skill:tdd',source:'skill',description:'Write tests first'}]});
 expect(document.querySelector('#slash')!.classList.contains('hidden')).toBe(false);
 expect(document.querySelector('#slash')!.textContent).toContain('/skill:tdd');
 prompt.value='/tdd';prompt.dispatchEvent(new Event('input'));
 expect(document.querySelector('#slash')!.textContent).toContain('/skill:tdd');
 prompt.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
 expect(prompt.value).toBe('/skill:tdd ');expect(app.requests.some(r=>r.action==='conversation')).toBe(false);
});

it('rejects stale Pi command previews after switching engine and explains command discovery failures',async()=>{
 const app=await setup(),prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;
 prompt.value='/';prompt.dispatchEvent(new Event('input'));const request=app.frames.find(f=>f.type==='get_command_catalog');
 chooseWork();const agent=document.querySelector<HTMLSelectElement>('#task-engine')!;agent.value='codex';agent.dispatchEvent(new Event('change'));
 app.sockets.at(-1).receive({type:'command_catalog',engine:'pi',requestId:request.requestId,commands:[{name:'skill:old',source:'skill'}]});
 prompt.dispatchEvent(new Event('input'));expect(document.querySelector('#slash')!.textContent).not.toContain('/skill:old');
 expect(document.querySelector('#slash')!.textContent).toContain('正在读取');
 agent.value='pi';agent.dispatchEvent(new Event('change'));prompt.dispatchEvent(new Event('input'));
 const next=app.frames.filter(f=>f.type==='get_command_catalog').at(-1);
 app.sockets.at(-1).receive({type:'error',code:'operation_failed',requestId:next.requestId,message:'Discovery unavailable'});
 expect(document.querySelector('#slash')!.textContent).toContain('读取命令失败');
});

it('invalidates a draft command catalog after Skill installation and requires explicit reload for an open session',async()=>{
 const app=await setup(),prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;
 prompt.value='/';prompt.dispatchEvent(new Event('input'));const request=app.frames.find(f=>f.type==='get_command_catalog');
 app.sockets.at(-1).receive({type:'command_catalog',engine:'pi',requestId:request.requestId,commands:[]});
 const install=async()=>{
  document.querySelector<HTMLButtonElement>('#skills-btn')!.click();await vi.advanceTimersByTimeAsync(20);
  document.querySelector<HTMLInputElement>('#skill-url')!.value='https://example.com/skills.git';
  document.querySelector('#skills-form')!.dispatchEvent(new Event('submit',{cancelable:true}));await vi.advanceTimersByTimeAsync(20);
  document.querySelector<HTMLInputElement>('[data-skill-subdir="skills/demo"]')!.click();
  document.querySelector('#skills-form')!.dispatchEvent(new Event('submit',{cancelable:true}));await vi.advanceTimersByTimeAsync(20);
  document.querySelector<HTMLButtonElement>('#skills-close')!.click();
 };
 await install();expect(app.frames.filter(f=>f.type==='get_command_catalog')).toHaveLength(2);
 expect(app.frames.some(f=>f.type==='open'||f.type==='prompt')).toBe(false);
 document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const task=app.requests.find(r=>r.action==='conversation');
 app.sockets.at(-1).receive({type:'opened',sessionId:task.id,engine:'pi',state:{isStreaming:false},capabilities:{commands:true,models:false,stats:false}});
 app.sockets.at(-1).receive({type:'commands',commands:[{name:'skill:old',source:'skill'}]});
 prompt.value='/';await install();
 expect(app.requests.some(r=>r.action==='reload')).toBe(false);
 expect(document.querySelector('#slash')!.textContent).toContain('需要重新加载');
 document.querySelector<HTMLButtonElement>('#slash button')!.click();await vi.advanceTimersByTimeAsync(20);
 expect(app.requests.find(r=>r.action==='reload')).toMatchObject({conversationId:task.id,engine:'pi',scope:'user'});
});


it('offers Codex Skills before the first message and inserts native dollar invocation',async()=>{
 const app=await setup();chooseWork();
 const agent=document.querySelector<HTMLSelectElement>('#task-engine')!;agent.value='codex';agent.dispatchEvent(new Event('change'));
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;prompt.value='/';prompt.dispatchEvent(new Event('input'));
 const request=app.frames.find(f=>f.type==='get_command_catalog'&&f.engine==='codex');
 expect(request).toBeTruthy();
 app.sockets.at(-1).receive({type:'command_catalog',engine:'codex',requestId:request.requestId,commands:[{name:'tdd',invocation:'$tdd',source:'skill',description:'Test first'}]});
 expect(document.querySelector('#slash')!.textContent).toContain('$tdd');
 prompt.value='/td';prompt.dispatchEvent(new Event('input'));prompt.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
 expect(prompt.value).toBe('$tdd ');expect(app.frames.some(f=>f.type==='open'||f.type==='prompt')).toBe(false);
});


it('refreshes Codex Skills after installation in an open task without a restart',async()=>{
 const app=await setup();chooseWork();const agent=document.querySelector<HTMLSelectElement>('#task-engine')!;agent.value='codex';agent.dispatchEvent(new Event('change'));
 document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const task=app.requests.find(r=>r.action==='conversation');
 app.sockets.at(-1).receive({type:'opened',sessionId:task.id,engine:'codex',state:{isStreaming:false},capabilities:{commands:true,models:false,stats:false}});
 app.sockets.at(-1).receive({type:'commands',commands:[]});
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;prompt.value='/';prompt.dispatchEvent(new Event('input'));
 document.querySelector<HTMLButtonElement>('#skills-btn')!.click();await vi.advanceTimersByTimeAsync(20);
 const skillEngine=document.querySelector<HTMLSelectElement>('#skills-engine')!;skillEngine.value='codex';skillEngine.dispatchEvent(new Event('change'));await vi.advanceTimersByTimeAsync(20);
 document.querySelector<HTMLInputElement>('#skill-url')!.value='https://example.com/skills.git';
 document.querySelector('#skills-form')!.dispatchEvent(new Event('submit',{cancelable:true}));await vi.advanceTimersByTimeAsync(20);
 document.querySelector<HTMLInputElement>('[data-skill-subdir="skills/demo"]')!.click();
 document.querySelector('#skills-form')!.dispatchEvent(new Event('submit',{cancelable:true}));await vi.advanceTimersByTimeAsync(20);
 const before=app.frames.filter(f=>f.type==='get_commands').length;
 document.querySelector<HTMLButtonElement>('#skills-close')!.click();
 expect(app.frames.filter(f=>f.type==='get_commands')).toHaveLength(before+1);
 app.sockets.at(-1).receive({type:'commands',commands:[{name:'demo',invocation:'$demo',source:'skill'}]});
 expect(document.querySelector('#slash')!.textContent).toContain('$demo');expect(document.querySelector('#slash')!.textContent).not.toContain('需要重新加载');
 expect(app.requests.some(r=>r.action==='reload')).toBe(false);
});

it('keeps a pasted image local and shows one removable preview until Send',async()=>{
 const app=await setup();
 vi.stubGlobal('FileReader',class{result='data:image/png;base64,aGVsbG8=';onload:any;readAsDataURL(){queueMicrotask(()=>this.onload());}});
 vi.stubGlobal('Image',class{width=10;height=10;onload:any;set src(_v:string){queueMicrotask(()=>this.onload());}});
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!,file=new File(['hello'],'paste.png',{type:'image/png'});
 const event=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{items:[{kind:'file',getAsFile:()=>file}]}});prompt.dispatchEvent(event);
 await vi.advanceTimersByTimeAsync(20);
 expect(document.querySelectorAll('#attachments img')).toHaveLength(1);
 expect(document.querySelectorAll('#attachments .upload-chip')).toHaveLength(0);
 expect(app.requests.filter(r=>['conversation','files'].includes(r.action))).toEqual([]);
 expect(app.frames.some(f=>f.type==='open'||f.type==='prompt')).toBe(false);
 expect(document.querySelector('#generated-artifacts')).toBeNull();
 document.querySelector<HTMLButtonElement>('#attachments .attachment-remove')!.click();
 document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));await vi.advanceTimersByTimeAsync(20);
 expect(app.frames.some(f=>f.type==='open'||f.type==='prompt')).toBe(false);
});

it('shows Codex native current context usage without inventing category counts',async()=>{
 const app=await setup();chooseWork();const agent=document.querySelector<HTMLSelectElement>('#task-engine')!;agent.value='codex';agent.dispatchEvent(new Event('change'));
 document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);const task=app.requests.find(r=>r.action==='conversation');
 app.sockets.at(-1).receive({type:'opened',sessionId:task.id,engine:'codex',state:{},capabilities:{stats:true}});
 app.sockets.at(-1).receive({type:'stats',sessionId:task.id,stats:{tokens:{total:999999},contextUsage:{tokens:68000,contextWindow:272000,percent:25}}});
 expect(document.querySelector('#sp-pct')!.textContent).toBe('已用 25%');
 expect(document.querySelector('#sp-capacity')!.textContent).toContain('68.0K');
 expect(document.querySelector('#sp-status')!.textContent).toContain('不提供分类');
 expect(document.querySelector('#stats-title')!.textContent).toBe('上下文用量');
});


it('defaults context to 272k and confirms extra cost before choosing fixed 500K',async()=>{
 const app=await setup(false,false,true,true);
 const catalog=app.frames.find(f=>f.type==='get_model_catalog');
 app.sockets.at(-1).receive({type:'model_catalog',engine:'pi',requestId:catalog.requestId,models:[{provider:'fixture',id:'large',contextWindow:1000000}],current:{provider:'fixture',id:'large'},context:{preset:'272k'}});
 expect(document.querySelector('#agent-context-value')!.textContent).toBe('272k');
 document.querySelector<HTMLButtonElement>('#agent-menu-btn')!.click();document.querySelector<HTMLButtonElement>('#agent-context-row')!.click();
 expect(document.querySelector('#agent-context-pane')!.classList.contains('hidden')).toBe(false);
 const dialog=document.querySelector<HTMLDialogElement>('#modal')!;dialog.showModal=()=>dialog.setAttribute('open','');dialog.close=()=>dialog.removeAttribute('open');
 const option=[...document.querySelectorAll<HTMLButtonElement>('#agent-context-pane button')].find(b=>b.textContent!.includes('500K'))!;option.click();
 expect(document.querySelector('#modal-text')!.textContent).toContain('过大的上下文会产生额外费用');
 expect(document.querySelector('#agent-context-value')!.textContent).toBe('272k');
 document.querySelector<HTMLButtonElement>('#modal-ok')!.click();await vi.advanceTimersByTimeAsync(20);
 expect(document.querySelector('#agent-context-value')!.textContent).toBe('500K');expect(app.frames.some(f=>f.type==='set_context'||f.type==='open')).toBe(false);
});

it('offers cancel, edit and immediate insertion for a pending queue item',async()=>{
 const app=await setup();document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const id=app.requests.find(r=>r.action==='conversation').id,ws=app.sockets[0];
 ws.receive({type:'opened',sessionId:id,engine:'pi',state:{isStreaming:true}});ws.receive({type:'history',sessionId:id,entries:[]});
 ws.receive({type:'queue_state',sessionId:id,items:[{id:'q-1',revision:1,text:'queued instruction',status:'pending',imageCount:0}]});
 const row=document.querySelector('#queue')!;
 expect(row.textContent).toContain('取消');expect(row.textContent).toContain('编辑');expect(row.textContent).toContain('立即插入');
});
it('offers Work takeover in the Agent menu, requires drift consent and keeps the composer draft',async()=>{
 const app=await setup();chooseWork();document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const id=app.requests.find(r=>r.action==='conversation').id;
 app.sockets[0].receive({type:'opened',sessionId:id,engine:'pi',state:{isStreaming:false},capabilities:{models:true}});
 app.sockets[0].receive({type:'history',sessionId:id,entries:[]});await vi.advanceTimersByTimeAsync(10);
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;prompt.value='unsent draft';
 document.querySelector<HTMLButtonElement>('#agent-menu-btn')!.click();
 const row=document.querySelector<HTMLButtonElement>('#agent-engine-row')!;expect(row.disabled).toBe(false);
 const dialog=document.querySelector<HTMLDialogElement>('#takeover-dialog')!;dialog.showModal=()=>dialog.setAttribute('open','');dialog.close=()=>dialog.removeAttribute('open');
 row.click();[...document.querySelectorAll<HTMLButtonElement>('#agent-engine-pane button')].find(b=>b.textContent?.includes('Codex'))!.click();
 expect(dialog.open).toBe(true);expect(dialog.textContent).toContain('信息漂移');expect(app.requests.some(r=>r.action==='takeover')).toBe(false);
 document.querySelector<HTMLButtonElement>('#takeover-cancel')!.click();expect(dialog.open).toBe(false);expect(prompt.value).toBe('unsent draft');
 row.click();[...document.querySelectorAll<HTMLButtonElement>('#agent-engine-pane button')].find(b=>b.textContent?.includes('Codex'))!.click();
 document.querySelector<HTMLButtonElement>('#takeover-confirm')!.click();await vi.advanceTimersByTimeAsync(20);
 expect(app.requests.find(r=>r.action==='takeover')).toMatchObject({id,engine:'codex',expectedEngine:'pi',acceptDrift:true});expect(prompt.value).toBe('unsent draft');
});
it.each(['failed','completed'])('locks task actions during takeover and restores drafts after %s',async(status)=>{
 const app=await setup();chooseWork();document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const task=app.conversations[0],id=task.id,ws=app.sockets[0];
 ws.receive({type:'opened',sessionId:id,engine:'pi',state:{isStreaming:false},capabilities:{models:true,compact:true}});ws.receive({type:'history',sessionId:id,entries:[]});await vi.advanceTimersByTimeAsync(10);
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;prompt.value='keep my draft';prompt.dispatchEvent(new Event('input'));
 const dialog=document.querySelector<HTMLDialogElement>('#takeover-dialog')!;dialog.showModal=()=>dialog.setAttribute('open','');dialog.close=()=>dialog.removeAttribute('open');
 document.querySelector<HTMLButtonElement>('#agent-menu-btn')!.click();document.querySelector<HTMLButtonElement>('#agent-engine-row')!.click();[...document.querySelectorAll<HTMLButtonElement>('#agent-engine-pane button')].find(b=>b.textContent?.includes('Codex'))!.click();
 task.takeover={id:'switch-1',status:'preparing',from:'pi',to:'codex'};
 document.querySelector<HTMLButtonElement>('#takeover-confirm')!.click();
 // A form submission/Enter must be blocked, not only a click on the Send button.
 document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));await vi.advanceTimersByTimeAsync(20);
 expect(app.frames.filter(f=>f.type==='prompt')).toHaveLength(0);expect(prompt.value).toBe('keep my draft');
 for(const id of ['prompt','send','attach','agent-menu-btn','stop'])expect(document.querySelector<HTMLInputElement>('#'+id)!.disabled,id).toBe(true);
 expect(document.querySelector('#queue')!.hasAttribute('inert')).toBe(true);expect(document.querySelector('#hint')!.classList.contains('hidden')).toBe(false);
 task.takeover.status=status;if(status==='completed')task.engine='codex';await vi.advanceTimersByTimeAsync(1100);
 if(status==='completed'){app.sockets.at(-1).receive({type:'opened',sessionId:id,engine:'codex',state:{isStreaming:false}});app.sockets.at(-1).receive({type:'history',sessionId:id,entries:[]});}
 expect(prompt.disabled).toBe(false);expect(prompt.value).toBe('keep my draft');expect(document.querySelector('#queue')!.hasAttribute('inert')).toBe(false);
});

it('shows a recent conversation before the new socket replies and reconciles authoritative history',async()=>{
 const app=await setup();
 app.conversations.push({id:'recent-a',workspaceKind:'chat',engine:'pi'},{id:'recent-b',workspaceKind:'chat',engine:'pi'});
 const listings=[{id:'recent-a',name:'Recent A'},{id:'recent-b',name:'Recent B'}];
 const choose=(name:string)=>[...document.querySelectorAll<HTMLElement>('#session-list [role=button]')].find(n=>n.textContent?.includes(name))!.click();
 app.sockets.at(-1).receive({type:'sessions',sessions:listings});await vi.advanceTimersByTimeAsync(20);
 choose('Recent A');await vi.advanceTimersByTimeAsync(20);
 app.sockets.at(-1).receive({type:'opened',sessionId:'recent-a',engine:'pi',state:{isStreaming:false}});
 app.sockets.at(-1).receive({type:'history',sessionId:'recent-a',entries:[{kind:'user',text:'cached visible marker'}]});
 document.querySelector('#scroller')!.scrollTop=123;
 choose('Recent B');await vi.advanceTimersByTimeAsync(20);
 app.sockets.at(-1).receive({type:'opened',sessionId:'recent-b',engine:'pi',state:{isStreaming:false}});
 app.sockets.at(-1).receive({type:'history',sessionId:'recent-b',entries:[{kind:'user',text:'other conversation'}]});
 choose('Recent A');
 expect(document.querySelector('#thread')!.textContent).toContain('cached visible marker');
 expect(document.querySelector('#scroller')!.scrollTop).toBe(123);
 expect(document.querySelector('#thread')!.hasAttribute('inert')).toBe(false);
 expect(document.querySelector<HTMLButtonElement>('#send')!.disabled).toBe(true);
 await vi.advanceTimersByTimeAsync(20);
 app.sockets.at(-1).receive({type:'opened',sessionId:'recent-a',engine:'pi',state:{isStreaming:false}});
 expect(document.querySelector('#thread')!.textContent).toContain('cached visible marker');
 app.sockets.at(-1).receive({type:'history',sessionId:'recent-a',entries:[{kind:'user',text:'authoritative replacement'}]});
 expect(document.querySelector('#thread')!.textContent).toContain('authoritative replacement');
 expect(document.querySelector('#thread')!.textContent).not.toContain('cached visible marker');
 expect(document.querySelector('#thread')!.hasAttribute('inert')).toBe(false);
});

it('keeps a labelled readable cached transcript after a transient native open failure',async()=>{
 vi.stubGlobal('indexedDB',new IDBFactory());
 const app=await setup(false,false,true,false,'owner');
 app.conversations.push({id:'unavailable-a',workspaceKind:'chat',engine:'pi'},{id:'unavailable-b',workspaceKind:'chat',engine:'pi'});
 const choose=(id:string)=>document.querySelector<HTMLElement>(`[data-session-id="${id}"]`)!.click();
 app.sockets.at(-1).receive({type:'sessions',sessions:[{id:'unavailable-a',name:'Unavailable A'},{id:'unavailable-b',name:'Unavailable B'}]});await vi.advanceTimersByTimeAsync(20);
 for(const id of ['unavailable-a','unavailable-b']){
  choose(id);await vi.advanceTimersByTimeAsync(20);
  app.sockets.at(-1).receive({type:'opened',sessionId:id,engine:'pi',state:{isStreaming:false}});
  app.sockets.at(-1).receive({type:'history',sessionId:id,entries:[{kind:'user',text:`Readable ${id}`}]});
 }
 choose('unavailable-a');await vi.advanceTimersByTimeAsync(20);
 const thread=document.querySelector('#thread')!;
 expect(thread.textContent).toContain('Readable unavailable-a');
 app.sockets.at(-1).receive({type:'error',code:'operation_failed',message:'Native history temporarily unavailable'});
 expect(thread.textContent).toContain('Readable unavailable-a');
 expect(thread.textContent).toContain('正在显示本地缓存');
 expect(thread.textContent).toContain('Native history temporarily unavailable');
 expect(thread.hasAttribute('inert')).toBe(false);
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;
 prompt.value='Do not send before synchronization';prompt.dispatchEvent(new Event('input'));
 document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));
 expect(document.querySelector<HTMLButtonElement>('#send')!.disabled).toBe(true);
 expect(app.frames.filter(frame=>frame.type==='prompt')).toHaveLength(0);
 // The same disposable snapshot is still available after the failed open.
 // @ts-expect-error browser module
 const {ConversationPreviewStore}=await import('../public/conversation-preview-store.js');
 const saved=new ConversationPreviewStore().get('owner','unavailable-a');
 await vi.advanceTimersByTimeAsync(200);
 expect((await saved).entries).toContainEqual({kind:'user',text:'Readable unavailable-a'});
 choose('unavailable-b');choose('unavailable-a');
 expect(thread.textContent).toContain('Readable unavailable-a');
});

it('confirms rename only after acknowledgment and updates the visible title',async()=>{
 const app=await setup();const socket=app.sockets.at(-1);
 socket.receive({type:'sessions',sessions:[{id:'rename-target',name:'Old title',messageCount:1}]});
 document.querySelector<HTMLButtonElement>('#session-list .more')!.click();
 [...document.querySelectorAll<HTMLButtonElement>('.popitem')].find(n=>n.textContent==='重命名')!.click();
 (document.querySelector('#modal-input') as HTMLInputElement).value='Saved title';
 document.querySelector<HTMLButtonElement>('#modal-ok')!.click();await vi.advanceTimersByTimeAsync(20);
 const request=app.frames.find(f=>f.type==='rename_session');expect(request.name).toBe('Saved title');
 expect(document.querySelector('#toast')!.textContent).not.toBe('已重命名');
 expect(document.querySelector('#session-list')!.textContent).toContain('Old title');
 socket.receive({type:'ack',operation:'rename_session',requestId:request.requestId});
 expect(document.querySelector('#session-list')!.textContent).toContain('Saved title');
 expect(document.querySelector('#toast')!.textContent).toBe('已重命名');
});

it('keeps the old title when rename is rejected and does not claim success offline',async()=>{
 const app=await setup();const socket=app.sockets.at(-1);
 socket.receive({type:'sessions',sessions:[{id:'rename-error',name:'Original title',messageCount:1}]});
 const edit=async()=>{
  document.querySelector<HTMLButtonElement>('#session-list .more')!.click();
  [...document.querySelectorAll<HTMLButtonElement>('.popitem')].find(n=>n.textContent==='重命名')!.click();
  (document.querySelector('#modal-input') as HTMLInputElement).value='Rejected title';
  document.querySelector<HTMLButtonElement>('#modal-ok')!.click();await vi.advanceTimersByTimeAsync(20);
 };
 await edit();const request=app.frames.find(f=>f.type==='rename_session');
 socket.receive({type:'error',requestId:request.requestId,code:'operation_failed',message:'Native rename failed'});
 expect(document.querySelector('#toast')!.textContent).toBe('重命名失败：Native rename failed');
 expect(document.querySelector('#session-list')!.textContent).toContain('Original title');
 socket.readyState=3;await edit();
 expect(app.frames.filter(f=>f.type==='rename_session')).toHaveLength(1);
 expect(document.querySelector('#toast')!.textContent).toBe('连接未就绪，标题未保存');
});

it('keeps an unanswered dialog and its text when the socket cannot send',async()=>{
 const app=await setup();const socket=app.sockets.at(-1);
 socket.receive({type:'opened',sessionId:'question-task',engine:'codex',state:{isStreaming:true}});
 socket.receive({type:'history',sessionId:'question-task',entries:[]});
 socket.receive({type:'event',sessionId:'question-task',cursor:1,event:{type:'native_request',method:'input',id:'q-offline',title:'Choose a destination'}});
 const input=document.querySelector<HTMLInputElement>('#ui-input')!;input.value='Keep this answer';socket.readyState=3;
 document.querySelector<HTMLButtonElement>('#ui-ok')!.click();
 expect(app.frames.some(f=>f.type==='ui_response')).toBe(false);
 expect(document.querySelector('#ui-modal')!.classList.contains('hidden')).toBe(false);
 expect(input.value).toBe('Keep this answer');
 expect(document.querySelector('#thread')!.textContent).not.toContain('已回答：');
});
it('offers native choices without selecting or submitting a default answer',async()=>{
 const app=await setup(),socket=app.sockets.at(-1);
 socket.receive({type:'opened',sessionId:'required-question',engine:'codex',state:{isStreaming:true}});
 socket.receive({type:'history',sessionId:'required-question',entries:[]});
 socket.receive({type:'event',sessionId:'required-question',cursor:1,event:{type:'native_request',id:'required-q',method:'input',title:'Choose engine',required:true,options:['Codex','Pi','Both']}});
 const choices=[...document.querySelectorAll<HTMLButtonElement>('#ui-options button')];
 expect(choices.map(button=>button.textContent)).toEqual(['Codex','Pi','Both']);
 expect(document.querySelector('#ui-options')!.classList.contains('hidden')).toBe(false);
 expect(document.querySelector<HTMLInputElement>('#ui-input')!.value).toBe('');
 document.querySelector<HTMLButtonElement>('#ui-ok')!.click();await vi.advanceTimersByTimeAsync(60000);
 expect(app.frames.some(frame=>frame.type==='ui_response')).toBe(false);
 expect(document.querySelector('#ui-modal')!.classList.contains('hidden')).toBe(false);
 choices[1].click();expect(document.querySelector<HTMLInputElement>('#ui-input')!.value).toBe('Pi');
 expect(app.frames.some(frame=>frame.type==='ui_response')).toBe(false);
 document.querySelector<HTMLButtonElement>('#ui-ok')!.click();
 expect(app.frames.filter(frame=>frame.type==='ui_response')).toEqual([expect.objectContaining({id:'required-q',value:'Pi'})]);
 expect(choices.every(button=>button.disabled)).toBe(true);
 expect(document.querySelector<HTMLInputElement>('#ui-input')!.disabled).toBe(true);
});
it('waits for answer acknowledgment and keeps rejected answers available',async()=>{
 const app=await setup();const socket=app.sockets.at(-1);
 socket.receive({type:'opened',sessionId:'question-task',engine:'codex',state:{isStreaming:true}});
 socket.receive({type:'history',sessionId:'question-task',entries:[]});
 socket.receive({type:'event',sessionId:'question-task',cursor:1,event:{type:'native_request',method:'input',id:'q-failed',title:'Choose a destination'}});
 const input=document.querySelector<HTMLInputElement>('#ui-input')!;input.value='Keep this answer';
 document.querySelector<HTMLButtonElement>('#ui-ok')!.click();
 const response=app.frames.find(f=>f.type==='ui_response');
 expect(document.querySelector('#thread')!.textContent).not.toContain('已回答：');
 expect(document.querySelector('#ui-modal')!.classList.contains('hidden')).toBe(false);
 socket.receive({type:'error',requestId:response.requestId,code:'operation_failed',message:'Agent did not accept input'});
 expect(input.value).toBe('Keep this answer');expect(document.querySelector<HTMLButtonElement>('#ui-ok')!.disabled).toBe(false);
 document.querySelector<HTMLButtonElement>('#ui-ok')!.click();
 const retried=app.frames.filter(f=>f.type==='ui_response').at(-1);
 socket.receive({type:'ack',operation:'ui_response',requestId:retried.requestId});
 expect(document.querySelector('#thread')!.textContent).toContain('已回答：Keep this answer');
 expect(document.querySelector('#ui-modal')!.classList.contains('hidden')).toBe(true);
});

it('restores an ordinary answer draft when a waiting dialog is replayed after reconnect',async()=>{
 const app=await setup();const socket=app.sockets.at(-1);
 socket.receive({type:'opened',sessionId:'question-task',engine:'codex',state:{isStreaming:true}});
 socket.receive({type:'history',sessionId:'question-task',entries:[]});
 const question={type:'event',sessionId:'question-task',cursor:1,event:{type:'native_request',method:'input',id:'q-replay',title:'Destination'}};
 socket.receive(question);
 const input=document.querySelector<HTMLInputElement>('#ui-input')!;input.value='Unsent destination';input.dispatchEvent(new Event('input'));
 socket.onclose();await vi.advanceTimersByTimeAsync(1300);
 const next=app.sockets.at(-1);next.receive({type:'opened',sessionId:'question-task',engine:'codex',state:{isStreaming:true}});
 next.receive({type:'history',sessionId:'question-task',entries:[]});next.receive(question);
 expect(input.value).toBe('Unsent destination');expect(app.frames.some(f=>f.type==='ui_response')).toBe(false);
});
it('builds long history without measuring page layout for every entry',async()=>{
 const app=await setup();const socket=app.sockets.at(-1);
 socket.receive({type:'opened',sessionId:'long-history',engine:'codex',state:{isStreaming:false}});
 const scroller=document.querySelector('#scroller')!;let measurements=0;
 Object.defineProperty(scroller,'scrollHeight',{configurable:true,get(){measurements++;return 2000;}});
 const entries=Array.from({length:120},(_,i)=>({kind:i%2?'assistant':'user',id:'entry-'+i,text:'Synthetic history '+i}));
 socket.receive({type:'history',sessionId:'long-history',entries});
 expect(document.querySelector('#thread')!.textContent).toContain('Synthetic history 119');
 expect(measurements).toBeLessThan(5);
});
it('never copies a secret answer into history, composer or a replayed draft',async()=>{
 const app=await setup();const socket=app.sockets.at(-1);
 socket.receive({type:'opened',sessionId:'secret-task',engine:'codex',state:{isStreaming:true}});
 socket.receive({type:'history',sessionId:'secret-task',entries:[]});
 const question={type:'event',sessionId:'secret-task',cursor:1,event:{type:'native_request',method:'input',id:'secret-q',title:'Secret',secret:true}};
 socket.receive(question);const input=document.querySelector<HTMLInputElement>('#ui-input')!;
 input.value='synthetic-secret-marker';input.dispatchEvent(new Event('input'));document.querySelector<HTMLButtonElement>('#ui-ok')!.click();
 const reply=app.frames.find(f=>f.type==='ui_response');
 socket.receive({type:'error',code:'unknown_ui_request',requestId:reply.requestId,message:'Expired question'});
 expect(document.querySelector<HTMLTextAreaElement>('#prompt')!.value).not.toContain('synthetic-secret-marker');
 expect(document.querySelector('#thread')!.textContent).not.toContain('synthetic-secret-marker');expect(input.value).toBe('');
 socket.onclose();await vi.advanceTimersByTimeAsync(1300);
 const next=app.sockets.at(-1);next.receive({type:'opened',sessionId:'secret-task',engine:'codex',state:{isStreaming:true}});
 next.receive({type:'history',sessionId:'secret-task',entries:[]});next.receive(question);
 expect(input.value).toBe('');
});

it.each(['pi','codex'])('preserves an unacknowledged %s message after disconnect and history replacement',async(engine)=>{
 const app=await setup();chooseWork();document.querySelector<HTMLSelectElement>('#task-engine')!.value=engine;document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const id=app.requests.find(r=>r.action==='conversation').id,ws=app.sockets[0];
 const opened={type:'opened',sessionId:id,engine,state:{},capabilities:{models:true,stop:true,steer:true,followUp:true}};
 ws.receive(opened);ws.receive({type:'history',sessionId:id,entries:[]});
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;
 prompt.value='Do not lose this instruction';prompt.dispatchEvent(new Event('input'));document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));
 ws.onclose();await vi.advanceTimersByTimeAsync(1300);const next=app.sockets.at(-1);
 next.receive(opened);next.receive({type:'history',sessionId:id,entries:[]});
 expect(document.querySelector('#thread')!.textContent).toContain('Do not lose this instruction');
 expect(app.frames.filter(f=>f.type==='prompt')).toHaveLength(1);
 const recover=[...document.querySelectorAll<HTMLButtonElement>('#thread button')].find(b=>b.textContent==='恢复到输入框');expect(recover).toBeDefined();recover!.click();
 expect(prompt.value).toBe('Do not lose this instruction');expect(app.frames.filter(f=>f.type==='prompt')).toHaveLength(1);
});
it('rejects an oversized prompt before sending and keeps the composer draft',async()=>{
 const app=await setup();document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const id=app.requests.find(r=>r.action==='conversation').id,ws=app.sockets[0];
 ws.receive({type:'opened',sessionId:id,engine:'pi',state:{}});ws.receive({type:'history',sessionId:id,entries:[]});
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;const text='a'.repeat(1024*1024);
 prompt.value=text;prompt.dispatchEvent(new Event('input'));document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));
 expect(app.frames.filter(f=>f.type==='prompt')).toHaveLength(0);expect(prompt.value).toBe(text);
 expect(document.querySelector('#toast')!.textContent).toContain('超出发送上限');
});
it('keeps multiple unconfirmed queued messages and never overwrites a newer draft during recovery',async()=>{
 const app=await setup();document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const id=app.requests.find(r=>r.action==='conversation').id,ws=app.sockets[0];
 const opened={type:'opened',sessionId:id,engine:'pi',state:{isStreaming:true}};
 ws.receive(opened);ws.receive({type:'history',sessionId:id,entries:[]});
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;
 for(const text of ['first missing input','second missing input']){prompt.value=text;prompt.dispatchEvent(new Event('input'));document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));}
 ws.onclose({code:1006});await vi.advanceTimersByTimeAsync(1300);const next=app.sockets.at(-1);next.receive(opened);next.receive({type:'history',sessionId:id,entries:[]});
 const thread=document.querySelector('#thread')!;expect(thread.textContent).toContain('first missing input');expect(thread.textContent).toContain('second missing input');expect(thread.textContent).toContain('1006');
 prompt.value='new unsent draft';[...thread.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='恢复到输入框')!.click();expect(prompt.value).toBe('new unsent draft');
 expect(app.frames.filter(f=>f.type==='prompt')).toHaveLength(2);
});
it('shows a recoverable message on acknowledgment timeout without retrying the request',async()=>{
 const app=await setup();document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const id=app.requests.find(r=>r.action==='conversation').id,ws=app.sockets[0];
 ws.receive({type:'opened',sessionId:id,engine:'pi',state:{}});ws.receive({type:'history',sessionId:id,entries:[]});
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;prompt.value='slow acceptance';prompt.dispatchEvent(new Event('input'));document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));
 await vi.advanceTimersByTimeAsync(20010);expect(document.querySelector('#thread')!.textContent).toContain('20 秒内未收到发送确认');
 const frame=app.frames.find(f=>f.type==='prompt');ws.receive({type:'ack',operation:'prompt',requestId:frame.requestId});expect(document.querySelector('#thread')!.textContent).not.toContain('20 秒内未收到发送确认');
 expect(app.frames.filter(f=>f.type==='prompt')).toHaveLength(1);
});

it.each(['pi','codex'])('does not interrupt a running %s reply when metadata queries fail',async(engine)=>{
 const app=await setup();chooseWork();document.querySelector<HTMLSelectElement>('#task-engine')!.value=engine;document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const id=app.requests.find(r=>r.action==='conversation').id,ws=app.sockets[0];
 ws.receive({type:'opened',sessionId:id,engine,state:{isStreaming:true},capabilities:{stop:true,steer:true,followUp:true}});ws.receive({type:'history',sessionId:id,entries:[]});
 ws.receive({type:'error',code:'metadata_unavailable',operation:'get_stats',message:'Auxiliary Agent read timed out'});
 expect(document.querySelector('#stop')!.classList.contains('hidden')).toBe(false);expect(document.querySelector('#mode-wrap')!.classList.contains('hidden')).toBe(false);
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;prompt.value='still queue this';prompt.dispatchEvent(new Event('input'));document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));
 expect(app.frames.find(f=>f.type==='prompt')).toMatchObject({text:'still queue this',mode:'follow_up'});
});

it.each(['pi','codex'])('sends long %s text that fits the transport budget',async(engine)=>{
 const app=await setup();chooseWork();document.querySelector<HTMLSelectElement>('#task-engine')!.value=engine;document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const id=app.requests.find(r=>r.action==='conversation').id,ws=app.sockets[0];ws.receive({type:'opened',sessionId:id,engine,state:{}});ws.receive({type:'history',sessionId:id,entries:[]});
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;const text='a'.repeat(71636);prompt.value=text;prompt.dispatchEvent(new Event('input'));document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));
 const prompts=app.frames.filter(f=>f.type==='prompt');expect(prompts).toHaveLength(1);expect(prompts[0].text).toBe(text);
});
it.each([false,true])('keeps queued edits consistent with the frame byte budget (oversize=%s)',async(oversize)=>{
 const app=await setup();document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const id=app.requests.find(r=>r.action==='conversation').id,ws=app.sockets[0];ws.receive({type:'opened',sessionId:id,engine:'pi',state:{isStreaming:true}});ws.receive({type:'history',sessionId:id,entries:[]});
 ws.receive({type:'queue_state',sessionId:id,items:[{id:'q-long',revision:1,text:'original instruction',status:'pending',imageCount:0}]});
 const dialog=document.querySelector<HTMLDialogElement>('#queue-edit-dialog')!;dialog.showModal=()=>{dialog.setAttribute('open','');};dialog.close=()=>{dialog.removeAttribute('open');};
 document.querySelector<HTMLButtonElement>('[data-queue-action="edit"]')!.click();
 const editor=document.querySelector<HTMLTextAreaElement>('#queue-edit-text')!;const text=oversize?'你'.repeat(350000):'a'.repeat(71636);expect(editor.maxLength).toBeGreaterThanOrEqual(text.length);editor.value=text;
 document.querySelector('#queue-edit-form')!.dispatchEvent(new Event('submit',{cancelable:true}));
 const sent=app.frames.filter(f=>f.type==='queue_action');expect(sent).toHaveLength(oversize?0:1);
 if(!oversize){expect(sent[0].text).toBe(text);ws.receive({type:'ack',operation:'queue_action',requestId:sent[0].requestId});expect(dialog.open).toBe(false);}
 else{expect(editor.value).toBe(text);expect(dialog.open).toBe(true);expect(document.querySelector('#queue-edit-status')!.textContent).toContain('1 MiB');}
});

it('retains a recent preview through repeated switches before authoritative synchronization',async()=>{
 const app=await setup();
 app.conversations.push({id:'rapid-a',workspaceKind:'chat',engine:'pi'},{id:'rapid-b',workspaceKind:'chat',engine:'pi'});
 const choose=(name:string)=>[...document.querySelectorAll<HTMLElement>('#session-list [role=button]')].find(n=>n.textContent?.includes(name))!.click();
 app.sockets.at(-1).receive({type:'sessions',sessions:[{id:'rapid-a',name:'Rapid A'},{id:'rapid-b',name:'Rapid B'}]});await vi.advanceTimersByTimeAsync(20);
 for(const [name,id,text] of [['Rapid A','rapid-a','A readable'],['Rapid B','rapid-b','B readable']]){
  choose(name);await vi.advanceTimersByTimeAsync(20);
  app.sockets.at(-1).receive({type:'opened',sessionId:id,engine:'pi',state:{isStreaming:false}});
  app.sockets.at(-1).receive({type:'history',sessionId:id,entries:[{kind:'user',text}]});
 }
 choose('Rapid A');expect(document.querySelector('#thread')!.textContent).toContain('A readable');
 choose('Rapid B');expect(document.querySelector('#thread')!.textContent).toContain('B readable');
 choose('Rapid A');expect(document.querySelector('#thread')!.textContent).toContain('A readable');
 expect(document.querySelector<HTMLButtonElement>('#send')!.disabled).toBe(true);
});

it('keeps five long conversations readable while their new sockets are delayed',async()=>{
 const app=await setup();
 const listings=Array.from({length:5},(_,i)=>({id:`long-${i}`,name:`Long ${i}`}));
 app.conversations.push(...listings.map(s=>({...s,workspaceKind:'chat',engine:'pi'})));
 app.sockets.at(-1).receive({type:'sessions',sessions:listings});await vi.advanceTimersByTimeAsync(20);
 const choose=(i:number)=>[...document.querySelectorAll<HTMLElement>('#session-list [role=button]')].find(n=>n.textContent?.includes(`Long ${i}`))!.click();
 for(let i=0;i<5;i++){
  choose(i);await vi.advanceTimersByTimeAsync(20);
  app.sockets.at(-1).receive({type:'opened',sessionId:`long-${i}`,engine:'pi',state:{isStreaming:false}});
  app.sockets.at(-1).receive({type:'history',sessionId:`long-${i}`,entries:Array.from({length:1500},(_,j)=>({kind:j%2?'assistant':'user',text:`Conversation ${i} message ${j} `+'x'.repeat(2000)}))});
 }
 for(let repeat=0;repeat<3;repeat++)for(let i=0;i<5;i++){
  choose(i);
  expect(document.querySelector('#thread')!.textContent).toContain(`Conversation ${i} message 1499`);
  expect(document.querySelector('#thread')!.textContent).not.toContain(`Conversation ${(i+1)%5} message 1499`);
  expect(document.querySelectorAll('#thread .msg').length).toBeLessThanOrEqual(40);
 }
});

it('restores user-scoped persistent text after page startup before any history response',async()=>{
 vi.stubGlobal('indexedDB',new IDBFactory());
 // @ts-expect-error browser module
 const {ConversationPreviewStore}=await import('../public/conversation-preview-store.js');
 const store=new ConversationPreviewStore();
 await store.put('owner','saved-task',{entries:[{kind:'assistant',text:'Saved across reload <img src=x onerror=alert(1)>'}],scroll:0,truncated:false});
 sessionStorage.setItem('pi-coffee.active.v2:owner','saved-task');
 const app=await setup(false,false,true,false,'owner');await vi.advanceTimersByTimeAsync(200);
 expect(document.querySelector('#thread')!.textContent).toContain('Saved across reload');
 expect(document.querySelector('#thread img')).toBeNull();
 expect(document.querySelector<HTMLButtonElement>('#send')!.disabled).toBe(true);
 app.sockets.at(-1).receive({type:'opened',sessionId:'saved-task',engine:'pi',state:{isStreaming:false}});
 app.sockets.at(-1).receive({type:'history',sessionId:'saved-task',entries:[{kind:'assistant',text:'Current authoritative content'}]});
 expect(document.querySelector('#thread')!.textContent).toContain('Current authoritative content');
 expect(document.querySelector('#thread')!.textContent).not.toContain('Saved across reload');
});

it('revokes pending cache display and socket callbacks when another tab clears private previews',async()=>{
 const app=await setup(false,false,true,false,'owner');
 app.conversations.push({id:'logout-task',workspaceKind:'chat',engine:'pi'});
 app.sockets.at(-1).receive({type:'sessions',sessions:[{id:'logout-task',name:'Private task'}]});await vi.advanceTimersByTimeAsync(20);
 [...document.querySelectorAll<HTMLElement>('#session-list [role=button]')].find(n=>n.textContent?.includes('Private task'))!.click();await vi.advanceTimersByTimeAsync(20);
 const old=app.sockets.at(-1);old.receive({type:'opened',sessionId:'logout-task',engine:'pi',state:{isStreaming:false}});old.receive({type:'history',sessionId:'logout-task',entries:[{kind:'assistant',text:'Private cached body'}]});
 const handler=old.onmessage;
 window.dispatchEvent(new StorageEvent('storage',{key:'pi-coffee.preview-clear.v1',newValue:'revoked'}));
 handler({data:JSON.stringify({type:'history',sessionId:'logout-task',entries:[{kind:'assistant',text:'late secret body'}]})});
 expect(document.querySelector('#thread')!.textContent).not.toContain('Private cached body');
 expect(document.querySelector('#thread')!.textContent).not.toContain('late secret body');
 expect(document.querySelector<HTMLButtonElement>('#send')!.disabled).toBe(true);
});

it('revokes the old socket before a stalled logout can repopulate private history',async()=>{
 const app=await setup(false,false,true,false,'owner');
 const old=app.sockets.at(-1);old.receive({type:'opened',sessionId:'logout-id',engine:'pi',state:{isStreaming:false}});old.receive({type:'history',sessionId:'logout-id',entries:[{kind:'assistant',text:'Private before logout'}]});
 const handler=old.onmessage,original=globalThis.fetch;
 vi.stubGlobal('confirm',()=>true);
 vi.stubGlobal('fetch',vi.fn((url:any,init:any)=>url==='/auth/logout'?new Promise(()=>{}):original(url,init)));
 document.querySelector<HTMLButtonElement>('#user-btn')!.click();await vi.advanceTimersByTimeAsync(20);
 handler({data:JSON.stringify({type:'history',sessionId:'logout-id',entries:[{kind:'assistant',text:'Late private history'}]})});
 handler({data:JSON.stringify({type:'event',sessionId:'logout-id',event:{type:'message_delta',id:'late',delta:'Late private event'}})});
 await vi.advanceTimersByTimeAsync(300);
 expect(document.querySelector('#thread')!.textContent).not.toContain('Private before logout');
 expect(document.querySelector('#thread')!.textContent).not.toContain('Late private');
 expect(old.onmessage).toBeNull();expect(document.querySelector<HTMLButtonElement>('#send')!.disabled).toBe(true);
});

it('invalidates a displayed cache when delayed workspace metadata reveals an Agent change',async()=>{
 const app=await setup();
 const first={id:'changed-a',workspaceKind:'chat',engine:'pi'};app.conversations.push(first,{id:'changed-b',workspaceKind:'chat',engine:'pi'});
 const listings=[{id:first.id,name:'Changed A'},{id:'changed-b',name:'Changed B'}];
 const choose=(name:string)=>[...document.querySelectorAll<HTMLElement>('#session-list [role=button]')].find(n=>n.textContent?.includes(name))!.click();
 app.sockets.at(-1).receive({type:'sessions',sessions:listings});await vi.advanceTimersByTimeAsync(20);
 for(const [name,id] of [['Changed A','changed-a'],['Changed B','changed-b']]){
  choose(name);await vi.advanceTimersByTimeAsync(20);app.sockets.at(-1).receive({type:'opened',sessionId:id,engine:'pi',state:{isStreaming:false}});app.sockets.at(-1).receive({type:'history',sessionId:id,entries:[{kind:'assistant',text:'Old engine '+id}]});
 }
 choose('Changed A');expect(document.querySelector('#thread')!.textContent).toContain('Old engine changed-a');await vi.advanceTimersByTimeAsync(20);
 const original=globalThis.fetch;let release:any;
 vi.stubGlobal('fetch',vi.fn((url:any,init:any)=>url==='/api/workspace'&&!init?.body?new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({projects:[],conversations:app.conversations,sidebar:{assignments:{},collapsed:[]}})});}):original(url,init)));
 app.sockets.at(-1).receive({type:'sessions',sessions:listings});await vi.advanceTimersByTimeAsync(20);
 first.engine='codex';release();await vi.advanceTimersByTimeAsync(20);
 expect(document.querySelector('#thread')!.textContent).not.toContain('Old engine changed-a');
});

it('does not persist an optimistic unacknowledged prompt or send while cached history is synchronizing',async()=>{
 const app=await setup(false,false,true,false,'owner');
 const storeModule=await import('../public/conversation-preview-store.js');
 const put=vi.spyOn(storeModule.ConversationPreviewStore.prototype,'put');
 const ws=app.sockets.at(-1);ws.receive({type:'opened',sessionId:'private-outbox',engine:'pi',state:{isStreaming:false}});ws.receive({type:'history',sessionId:'private-outbox',entries:[]});
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;prompt.value='Unconfirmed private instruction';prompt.dispatchEvent(new Event('input'));document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));
 document.querySelector<HTMLButtonElement>('#new-task')!.click();
 expect(JSON.stringify(put.mock.calls)).not.toContain('Unconfirmed private instruction');put.mockRestore();
 await vi.advanceTimersByTimeAsync(20);
 const next=app.sockets.at(-1);next.receive({type:'opened',sessionId:'waiting-history',engine:'pi',state:{isStreaming:false}});
 const before=app.frames.filter(f=>f.type==='prompt').length;
 prompt.value='Do not send until history';prompt.dispatchEvent(new Event('input'));document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));
 expect(app.frames.filter(f=>f.type==='prompt')).toHaveLength(before);expect(prompt.value).toBe('Do not send until history');
});

it('uses the correct earlier user message when regenerating after bounded history rendering',async()=>{
 const app=await setup(),socket=app.sockets.at(-1);
 socket.receive({type:'opened',sessionId:'long-regenerate',engine:'pi',state:{isStreaming:false}});
 socket.receive({type:'history',sessionId:'long-regenerate',entries:[{kind:'user',text:'Original question outside the latest page'},...Array.from({length:50},(_,i)=>({kind:'assistant',id:`answer-${i}`,text:`Answer ${i}`}))]});
 document.querySelector<HTMLButtonElement>('#thread .regen')!.click();
 expect(app.frames.find(f=>f.type==='prompt')).toMatchObject({text:'Original question outside the latest page'});
});

it('preserves the private prompt outbox when another tab invalidates only transcript caches',async()=>{
 const app=await setup(false,false,true,false,'owner'),socket=app.sockets.at(-1);
 const opened={type:'opened',sessionId:'outbox-other-tab',engine:'pi',state:{isStreaming:false}};
 socket.receive(opened);socket.receive({type:'history',sessionId:'outbox-other-tab',entries:[]});
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;prompt.value='Keep my unconfirmed instruction';prompt.dispatchEvent(new Event('input'));document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));
 window.dispatchEvent(new StorageEvent('storage',{key:'pi-coffee.preview-clear.v1',newValue:'cache:other-tab-archive'}));await vi.advanceTimersByTimeAsync(20);
 const next=app.sockets.at(-1);next.receive(opened);next.receive({type:'history',sessionId:'outbox-other-tab',entries:[]});
 expect(document.querySelector('#thread')!.textContent).toContain('Keep my unconfirmed instruction');
 expect(app.frames.filter(f=>f.type==='prompt')).toHaveLength(1);
});

it.each(['diff','args'])('keeps oversized authoritative tool %s expandable and out of the disposable cache',async(field)=>{
 vi.stubGlobal('indexedDB',new IDBFactory());
 const app=await setup(false,false,true,false,'owner'),socket=app.sockets.at(-1);
 const evidence='evidence-start <img src=x onerror=alert(1)>\n'+'changed line\n'.repeat(1000)+'evidence-end';
 const tool={kind:'tool',id:'large-edit',name:'edit',result:'Permission denied',isError:true,
  args:field==='args'?{path:'a.ts',content:evidence}:{path:'a.ts'},diff:field==='diff'?evidence:undefined};
 socket.receive({type:'opened',sessionId:'large-history',engine:'pi',state:{isStreaming:false}});
 socket.receive({type:'history',sessionId:'large-history',entries:[tool]});
 const node=document.querySelector<HTMLDetailsElement>('#thread .tool')!;
 expect(node.open).toBe(false);expect(node.classList.contains('error')).toBe(true);
 node.open=true;node.dispatchEvent(new Event('toggle'));
 const source=node.querySelector<HTMLSelectElement>('.tool-source-select')!;
 source.value=field==='diff'?'修改':'写入内容';source.dispatchEvent(new Event('change'));
 expect(node.textContent).toContain('evidence-end');
 expect(node.querySelector('.tool-bounded-content')!.textContent!.length).toBeLessThanOrEqual(8192+300);
 node.querySelector<HTMLButtonElement>('[data-text-page="previous"]')!.click();
 expect(node.textContent).toContain('evidence-start');
 node.querySelector<HTMLButtonElement>('[data-text-page="latest"]')!.click();
 expect(node.textContent).toContain('evidence-end');
 source.value='输出';source.dispatchEvent(new Event('change'));
 expect(node.textContent).toContain('Permission denied');
 source.value='参数摘要';source.dispatchEvent(new Event('change'));
 expect(node.textContent).toContain('a.ts');
 expect(node.querySelector('img')).toBeNull();
 // Inspect the public persistent-store boundary, not controller internals.
 // @ts-expect-error browser module
 const {ConversationPreviewStore}=await import('../public/conversation-preview-store.js');
 const saved=new ConversationPreviewStore().get('owner','large-history');
 await vi.advanceTimersByTimeAsync(200);
 expect((await saved).entries).toEqual([{kind:'tool',text:'edit\nPermission denied'}]);
});

it('preserves authoritative tool evidence when paging into earlier history without caching it',async()=>{
 vi.stubGlobal('indexedDB',new IDBFactory());
 const app=await setup(false,false,true,false,'owner'),socket=app.sockets.at(-1);
 const diff='earlier-patch-start <script>alert(1)</script>\n'+'+change\n'.repeat(1500)+'earlier-patch-end';
 socket.receive({type:'opened',sessionId:'earlier-tools',engine:'pi',state:{isStreaming:false}});
 socket.receive({type:'history',sessionId:'earlier-tools',entries:[{kind:'tool',id:'old-edit',name:'edit',result:'Failed edit',isError:true,args:{path:'earlier.ts'},diff},
  ...Array.from({length:40},(_,index)=>({kind:'user',text:`Later message ${index}`}))]});
 const older=document.querySelector<HTMLDetailsElement>('details.history-older')!;
 older.open=true;older.dispatchEvent(new Event('toggle'));
 const tool=older.querySelector<HTMLElement>('[data-preview-kind="tool"]')!;
 expect(tool.textContent).toContain('earlier-patch-start');
 expect(tool.textContent).toContain('earlier.ts');
 expect(tool.textContent).toContain('Failed edit');
 expect(tool.textContent).toContain('错误');
 expect(tool.classList.contains('failure')).toBe(true);
 expect(tool.textContent).not.toContain('earlier-patch-end');
 expect(tool.querySelector('.body')!.textContent!.length).toBeLessThanOrEqual(8192);
 tool.querySelector<HTMLButtonElement>('button')!.click();
 expect(tool.textContent).toContain('earlier-patch-end');
 expect(tool.querySelector('script')).toBeNull();
 // @ts-expect-error browser module
 const {ConversationPreviewStore}=await import('../public/conversation-preview-store.js');
 const saved=new ConversationPreviewStore().get('owner','earlier-tools');
 await vi.advanceTimersByTimeAsync(200);
 const preview=await saved;expect(preview.entries).toHaveLength(40);expect(preview.entries[0]).toEqual({kind:'user',text:'Later message 0'});
 expect(JSON.stringify(preview)).not.toContain('earlier-patch');expect(JSON.stringify(preview)).not.toContain('earlier.ts');
});

it('bounds authoritative history to forty recent messages and pages older messages in order',async()=>{
 const app=await setup(),socket=app.sockets.at(-1);
 socket.receive({type:'opened',sessionId:'paged-history',engine:'pi',state:{isStreaming:false}});
 socket.receive({type:'history',sessionId:'paged-history',entries:Array.from({length:1500},(_,index)=>({kind:'user',text:`History message ${index}`}))});
 const thread=document.querySelector('#thread')!;
 expect(thread.querySelectorAll('.msg')).toHaveLength(40);
 expect([...thread.querySelectorAll('.msg.user .text')].map(node=>node.textContent)).toEqual(Array.from({length:40},(_,index)=>`History message ${1460+index}`));
 const older=thread.querySelector<HTMLDetailsElement>('details.history-older')!;
 expect(older.querySelector('summary')!.textContent).toBe('更早的 1460 条记录');
 expect(older.querySelectorAll('.msg')).toHaveLength(0);
 older.open=true;older.dispatchEvent(new Event('toggle'));
 expect([...older.querySelectorAll('.msg.user .text')].map(node=>node.textContent)).toEqual(Array.from({length:40},(_,index)=>`History message ${1420+index}`));
 [...older.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='加载更早记录')!.click();
 expect([...older.querySelectorAll('.msg.user .text')].map(node=>node.textContent)).toEqual(Array.from({length:80},(_,index)=>`History message ${1380+index}`));
});

it.each(['another conversation','current authoritative history'])('does not replace %s when an older disk preview finishes late',async(destination)=>{
 vi.stubGlobal('indexedDB',new IDBFactory());
 const {ConversationPreviewStore}=await import('../public/conversation-preview-store.js');
 const store=new ConversationPreviewStore();
 await store.put('owner','delayed-a',{entries:[{kind:'assistant',text:'Old disk-only A reply'}],scroll:0,truncated:false,fingerprint:JSON.stringify(['pi',null,null])});
 const app=await setup(false,false,true,false,'owner');
 app.conversations.push({id:'delayed-a',workspaceKind:'chat',engine:'pi'},{id:'delayed-b',workspaceKind:'chat',engine:'pi'});
 app.sockets.at(-1).receive({type:'sessions',sessions:[{id:'delayed-a',name:'Delayed A'},{id:'delayed-b',name:'Delayed B'}]});
 await vi.advanceTimersByTimeAsync(20);
 const choose=(name:string)=>[...document.querySelectorAll<HTMLElement>('#session-list [role=button]')].find(node=>node.textContent?.includes(name))!.click();
 // Delay completion at the IndexedDB boundary; projection, storage reads and
 // controller callbacks remain real, as do the socket/history and sidebar seams.
 let release:(()=>void)|undefined,held=false;
 const original=FakeIDBDatabase.prototype.transaction;
 const transactions=vi.spyOn(FakeIDBDatabase.prototype,'transaction').mockImplementation(function(this:FakeIDBDatabase,names,mode,options){
  const transaction=original.call(this,names,mode,options);
  if(!held){
   held=true;
   Object.defineProperty(transaction,'oncomplete',{configurable:true,set(callback){transaction.addEventListener('complete',event=>{release=()=>callback.call(transaction,event);});}});
  }
  return transaction;
 });
 try{
  choose('Delayed A');await vi.advanceTimersByTimeAsync(20);
  expect(release).toBeTypeOf('function');
  const target=destination==='another conversation'?'delayed-b':'delayed-a';
  if(target==='delayed-b'){choose('Delayed B');await vi.advanceTimersByTimeAsync(20);}
  const current=app.sockets.at(-1),text=target==='delayed-b'?'Current B reply':'Current authoritative A reply';
  current.receive({type:'opened',sessionId:target,engine:'pi',state:{isStreaming:false}});
  current.receive({type:'history',sessionId:target,entries:[{kind:'assistant',text}]});
  release!();await vi.advanceTimersByTimeAsync(20);
  expect(document.querySelector('#thread')!.textContent).toContain(text);
  expect(document.querySelector('#thread')!.textContent).not.toContain('Old disk-only A reply');
 }finally{transactions.mockRestore();}
});

it('invalidates a displayed preview without a known binding when task metadata arrives later',async()=>{
 const app=await setup(false,false,true,false,'owner');
 const listings=[{id:'unbound-a',name:'Unbound A'},{id:'unbound-b',name:'Unbound B'}];
 const choose=(name:string)=>[...document.querySelectorAll<HTMLElement>('#session-list [role=button]')].find(node=>node.textContent?.includes(name))!.click();
 app.sockets.at(-1).receive({type:'sessions',sessions:listings});await vi.advanceTimersByTimeAsync(20);
 // History can arrive while the workspace catalog still has no task binding.
 for(const [name,id] of [['Unbound A','unbound-a'],['Unbound B','unbound-b']]){
  choose(name);await vi.advanceTimersByTimeAsync(20);
  const socket=app.sockets.at(-1);
  socket.receive({type:'opened',sessionId:id,engine:'pi',state:{isStreaming:false}});
  socket.receive({type:'history',sessionId:id,entries:[{kind:'assistant',text:'Unverified old binding '+id}]});
 }
 choose('Unbound A');await vi.advanceTimersByTimeAsync(20);
 expect(document.querySelector('#thread')!.textContent).toContain('Unverified old binding unbound-a');
 app.conversations.push({id:'unbound-a',workspaceKind:'project',engine:'codex',nativeBinding:{id:'new-native-binding'}});
 app.sockets.at(-1).receive({type:'sessions',sessions:listings});await vi.advanceTimersByTimeAsync(20);
 expect(document.querySelector('#thread')!.textContent).not.toContain('Unverified old binding unbound-a');
 expect(document.querySelector<HTMLButtonElement>('#send')!.disabled).toBe(true);
});

it.each([false,true])('shows a disk preview only when it matches known task metadata (binding recorded: %s)',async(recorded)=>{
 vi.stubGlobal('indexedDB',new IDBFactory());
 const {ConversationPreviewStore}=await import('../public/conversation-preview-store.js');
 const store=new ConversationPreviewStore();
 await store.put('owner','known-task',{entries:[{kind:'assistant',text:'Persisted task reply'}],scroll:0,truncated:false,...(recorded?{fingerprint:JSON.stringify(['pi',null,null])}:{})});
 const app=await setup(false,false,true,false,'owner');
 app.conversations.push({id:'known-task',workspaceKind:'chat',engine:'pi'});
 app.sockets.at(-1).receive({type:'sessions',sessions:[{id:'known-task',name:'Known task'}]});await vi.advanceTimersByTimeAsync(20);
 [...document.querySelectorAll<HTMLElement>('#session-list [role=button]')].find(node=>node.textContent?.includes('Known task'))!.click();
 await vi.advanceTimersByTimeAsync(100);
 if(recorded)expect(document.querySelector('#thread')!.textContent).toContain('Persisted task reply');
 else expect(document.querySelector('#thread')!.textContent).not.toContain('Persisted task reply');
 expect(document.querySelector<HTMLButtonElement>('#send')!.disabled).toBe(true);
});

it.each(['before disk','after disk'])('invalidates a deleted task preview when the first workspace metadata arrives %s',async(order)=>{
 vi.stubGlobal('indexedDB',new IDBFactory());
 const {ConversationPreviewStore}=await import('../public/conversation-preview-store.js');
 const store=new ConversationPreviewStore();
 await store.put('owner','deleted-task',{entries:[{kind:'assistant',text:'Private reply from deleted task'}],scroll:0,truncated:false,fingerprint:JSON.stringify(['pi','old-native-binding',null])});
 sessionStorage.setItem('pi-coffee.active.v2:owner','deleted-task');
 let release!:()=>void;
 const metadata=new Promise<void>(resolve=>{release=resolve;});
 await setup(false,false,true,false,'owner',order==='after disk'?metadata:undefined);
 await vi.advanceTimersByTimeAsync(100);
 if(order==='after disk'){
  expect(document.querySelector('#thread')!.textContent).toContain('Private reply from deleted task');
  release();await vi.advanceTimersByTimeAsync(20);
 }
 expect(document.querySelector('#thread')!.textContent).not.toContain('Private reply from deleted task');
 expect(document.querySelector<HTMLButtonElement>('#send')!.disabled).toBe(true);
});

it('creates sidebar groups, blocks occupied deletion and deletes after moving the conversation out',async()=>{
 const app=await setup();const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;prompt.value='Unsent draft';
 document.querySelector<HTMLButtonElement>('#create-sidebar-group')!.click();await vi.advanceTimersByTimeAsync(20);
 document.querySelector<HTMLInputElement>('#modal-input')!.value='资料';document.querySelector<HTMLButtonElement>('#modal-ok')!.click();await vi.advanceTimersByTimeAsync(20);
 const group=()=>document.querySelector<HTMLElement>('[data-sidebar-project="custom-group"]')!;
 expect(group().textContent).toContain('资料');expect(prompt.value).toBe('Unsent draft');expect(app.requests.some(r=>r.action==='project')).toBe(false);
 document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);const task=app.requests.find(r=>r.action==='conversation');
 document.querySelector<HTMLButtonElement>('[data-sidebar-ungrouped] .more')!.click();
 const select=document.querySelector<HTMLSelectElement>('[aria-label="移至侧栏分组"]')!;select.value='custom-group';select.dispatchEvent(new Event('change'));await vi.advanceTimersByTimeAsync(20);
 group().querySelector<HTMLButtonElement>('.project-group-more')!.click();expect(document.querySelector<HTMLButtonElement>('[data-delete-sidebar-group]')!.disabled).toBe(true);
 document.body.click();group().querySelector<HTMLButtonElement>('.session-item .more')!.click();
 const move=document.querySelector<HTMLSelectElement>('[aria-label="移至侧栏分组"]')!;move.value='';move.dispatchEvent(new Event('change'));await vi.advanceTimersByTimeAsync(20);
 group().querySelector<HTMLButtonElement>('.project-group-more')!.click();document.querySelector<HTMLButtonElement>('[data-delete-sidebar-group]')!.click();await vi.advanceTimersByTimeAsync(20);
 expect(group()).toBeNull();expect(document.querySelector('[data-sidebar-ungrouped] .session-item')?.getAttribute('data-session-id')).toBe(task.id);
 expect(app.frames.filter(f=>f.type==='abort'||f.type==='prompt')).toEqual([]);
});
