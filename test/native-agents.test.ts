// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {afterEach,it,expect,vi} from 'vitest';
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();localStorage.clear();sessionStorage.clear();vi.resetModules();});
async function setup(legacy=false,wide=false,catalog=true,piCatalog=false){
 document.documentElement.innerHTML=readFileSync('public/index.html','utf8');
 Object.defineProperty(window,'matchMedia',{value:(query:string)=>({matches:wide && query.includes('min-width'),addEventListener(){}}),configurable:true});Element.prototype.scrollTo=vi.fn();
 const sidebar:{showGroups?:boolean;assignments:Record<string,string|null>;collapsed:string[]}={assignments:{} as Record<string,string|null>,collapsed:[] as string[]};
 const requests:any[]=[],frames:any[]=[],conversations:any[]=[],sockets:any[]=[],projects:any[]=[{id:'p',name:'demo',branch:'main'}];
 class Socket{static OPEN=1;readyState=1;onopen:any;onmessage:any;onclose:any;onerror:any;constructor(){sockets.push(this);queueMicrotask(()=>this.onopen?.());}close(){}send(text:string){frames.push(JSON.parse(text));}receive(frame:any){this.onmessage?.({data:JSON.stringify(frame)});}}
 vi.stubGlobal('WebSocket',Socket);
 vi.stubGlobal('fetch',vi.fn(async(url:any,init:any)=>{
  if(url==='/api/skills') {const body=JSON.parse(init.body);requests.push(body);return {ok:true,status:200,json:async()=>body.action==='discover'?{revision:'a'.repeat(40),skills:[{name:'demo',description:'Demo skill',subdir:'skills/demo',installed:false},{name:'other',description:'Other skill',subdir:'skills/other',installed:false}],warnings:[]}:body.action==='detail'?{content:'---\nname: sample\ndescription: Fixture skill.\n---\n<script>not executable</script>'}:body.action==='list'?{directory:'/home/demo/.pi/agent/skills',skills:[{id:'skill-1',name:'sample',description:'Fixture skill.',managed:true,enabled:true,path:'/home/demo/.pi/agent/skills/sample/SKILL.md',revision:'abcdef123456',repoUrl:'https://example.com/skills.git',ref:'main',subdir:'skills/sample'}],warnings:[]}:({ok:true})};}
  if(url==='/api/me')return {ok:true,json:async()=>null};
  if(url==='/api/engines')return {ok:!legacy,json:async()=>({takeover:true,engines:[{id:'pi',name:'Pi',available:true,modelCatalog:piCatalog},{id:'codex',name:'Codex',available:true,modelCatalog:catalog},{id:'claude',name:'Claude Code',available:false,reason:'CLI unavailable'}]})};
  const body=init?.body?JSON.parse(init.body):null;if(!body)return {ok:true,json:async()=>({projects,conversations,sidebar,vmId:'linux001',capabilities:{chatWorkspaces:true}})};
  requests.push(body);if(body.action==='takeover'){const task=conversations.find(c=>c.id===body.id);task.takeover??={id:'switch-1',status:'preparing',from:body.expectedEngine,to:body.engine};return {ok:true,json:async()=>task.takeover};}
  if(body.action==='sidebar_move'){sidebar.assignments[body.id]=body.projectId;return {ok:true,json:async()=>structuredClone(sidebar)};}
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
 await vi.advanceTimersByTimeAsync(50);expect(document.querySelector('#thread')?.textContent).toContain('native content');expect(document.querySelector('#thread')?.textContent).not.toContain('HelloHello');
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;prompt.value='one turn';prompt.dispatchEvent(new Event('input'));document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));
 expect(app.frames.filter(f=>f.type==='prompt')).toHaveLength(1);ws.onclose();await vi.advanceTimersByTimeAsync(1300);const next=app.sockets.at(-1);next.receive(opened);next.receive({type:'history',sessionId:id,entries:[]});
 expect(app.frames.filter(f=>f.type==='prompt')).toHaveLength(1);expect(document.querySelector('#thread')?.textContent).toContain('不会自动重发');
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
 ws.receive({type:'models',models:[{provider:agent,id:'chosen-model'}],current:{provider:agent,id:'chosen-model'},thinkingLevels:[],thinkingLevel:''});
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

it('does not request a draft model catalog from an older Host',async()=>{
 const app=await setup(false,false,false);chooseWork();const engine=document.querySelector<HTMLSelectElement>('#task-engine')!;
 engine.value='codex';engine.dispatchEvent(new Event('change'));
 expect(app.frames.some(f=>f.type==='get_model_catalog')).toBe(false);
 const button=document.querySelector<HTMLButtonElement>('#agent-menu-btn')!;expect(button.disabled).toBe(false);button.click();
 expect(document.querySelector<HTMLButtonElement>('#agent-model-row')!.disabled).toBe(true);
 expect(document.querySelector('#agent-menu-note')!.textContent).toContain('模型在任务创建后可选');
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
 expect(document.querySelector('#thread')!.hasAttribute('inert')).toBe(true);
 await vi.advanceTimersByTimeAsync(20);
 app.sockets.at(-1).receive({type:'opened',sessionId:'recent-a',engine:'pi',state:{isStreaming:false}});
 expect(document.querySelector('#thread')!.textContent).toContain('cached visible marker');
 app.sockets.at(-1).receive({type:'history',sessionId:'recent-a',entries:[{kind:'user',text:'authoritative replacement'}]});
 expect(document.querySelector('#thread')!.textContent).toContain('authoritative replacement');
 expect(document.querySelector('#thread')!.textContent).not.toContain('cached visible marker');
 expect(document.querySelector('#thread')!.hasAttribute('inert')).toBe(false);
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
