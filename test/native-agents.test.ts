// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {afterEach,it,expect,vi} from 'vitest';
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();localStorage.clear();sessionStorage.clear();vi.resetModules();});
async function setup(legacy=false,wide=false,catalog=true){
 document.documentElement.innerHTML=readFileSync('public/index.html','utf8');
 Object.defineProperty(window,'matchMedia',{value:(query:string)=>({matches:wide && query.includes('min-width'),addEventListener(){}}),configurable:true});Element.prototype.scrollTo=vi.fn();
 const requests:any[]=[],frames:any[]=[],conversations:any[]=[],sockets:any[]=[],projects:any[]=[{id:'p',name:'demo',branch:'main'}];
 class Socket{static OPEN=1;readyState=1;onopen:any;onmessage:any;onclose:any;onerror:any;constructor(){sockets.push(this);queueMicrotask(()=>this.onopen?.());}close(){}send(text:string){frames.push(JSON.parse(text));}receive(frame:any){this.onmessage?.({data:JSON.stringify(frame)});}}
 vi.stubGlobal('WebSocket',Socket);
 vi.stubGlobal('fetch',vi.fn(async(url:any,init:any)=>{
  if(url==='/api/skills') {const body=JSON.parse(init.body);requests.push(body);return {ok:true,status:200,json:async()=>body.action==='detail'?{content:'---\nname: sample\ndescription: Fixture skill.\n---\n<script>not executable</script>'}:body.action==='list'?{directory:'/home/demo/.pi/agent/skills',skills:[{id:'skill-1',name:'sample',description:'Fixture skill.',managed:true,enabled:true,path:'/home/demo/.pi/agent/skills/sample/SKILL.md',revision:'abcdef123456',repoUrl:'https://example.com/skills.git',ref:'main',subdir:'skills/sample'}],warnings:[]}:({ok:true})};}
  if(url==='/api/me')return {ok:true,json:async()=>null};
  if(url==='/api/engines')return {ok:!legacy,json:async()=>({engines:[{id:'pi',name:'Pi',available:true},{id:'codex',name:'Codex',available:true,modelCatalog:catalog},{id:'claude',name:'Claude Code',available:false,reason:'CLI unavailable'}]})};
  const body=init?.body?JSON.parse(init.body):null;if(!body)return {ok:true,json:async()=>({projects,conversations,vmId:'linux001',capabilities:{chatWorkspaces:true}})};
  requests.push(body);if(body.action==='conversation'){const c={...body,cwd:'/home/test/chats/'+body.id,creationState:'ready'};conversations.push(c);return {ok:true,json:async()=>c};}
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
 expect(document.querySelector('#sp-capacity')?.textContent).toBe('~10.0K / 40K Tokens');
 expect([...document.querySelectorAll('#sp-context-legend .legend-label')].map(e=>e.textContent)).toEqual(['System prompt','Tool definitions','Rules','Skills','MCP & dynamic tools','Subagent definitions','Conversation']);
 expect(document.querySelector('#sp-context-legend')?.textContent).toContain('6.0K');
 expect(document.querySelector('#sp-context-legend')?.textContent).not.toContain('90.0K');
 expect(panel.textContent).not.toContain('累计输入');
 document.querySelector<HTMLButtonElement>('#stats-close')!.click();expect(panel.open).toBe(false);expect(document.activeElement).toBe(trigger);
 trigger.click();panel.dispatchEvent(new Event('cancel',{cancelable:true}));expect(panel.open).toBe(false);
 ws.receive({type:'stats',sessionId:id,stats:{contextUsage:{percent:null,tokens:null,contextWindow:40000},tokens:{total:100000},cost:0.1}});
 expect(document.querySelector('#sp-pct')?.textContent).toBe('Usage unavailable');
 expect(document.querySelector('#sp-capacity')?.textContent).toBe('— / 40K Tokens');
 expect(document.querySelector('#sp-context-legend')?.textContent).not.toContain('30.0K');
});

it('collapses task details when starting another Task',async()=>{
 await setup();const disclosure=document.querySelector<HTMLDetailsElement>('.project-manage')!;disclosure.open=true;
 document.querySelector<HTMLButtonElement>('#new-task')!.click();
 expect(disclosure.open).toBe(false);
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


it.each(['history-first','models-first','rejected'])('selects a Codex draft model and waits before the first prompt (%s)',async(order)=>{
 const app=await setup();chooseWork();const engine=document.querySelector<HTMLSelectElement>('#task-engine')!;
 engine.value='codex';engine.dispatchEvent(new Event('change'));
 const query=app.frames.find(f=>f.type==='get_model_catalog');expect(query).toMatchObject({engine:'codex'});
 expect(app.requests.some(r=>r.action==='conversation')).toBe(false);
 const ws=app.sockets.at(-1);
 ws.receive({type:'model_catalog',requestId:query.requestId,engine:'codex',models:[{provider:'codex',id:'default-model'},{provider:'codex',id:'chosen-model'}],current:{provider:'codex',id:'default-model'},thinkingLevels:[],thinkingLevel:''});
 const button=document.querySelector<HTMLButtonElement>('#agent-menu-btn')!;expect(button.disabled).toBe(false);button.click();
 document.querySelector<HTMLButtonElement>('#agent-model-row')!.click();
 [...document.querySelectorAll<HTMLButtonElement>('#agent-model-pane button')].find(b=>b.textContent?.includes('chosen-model'))!.click();
 expect(app.frames.some(f=>f.type==='set_model')).toBe(false);
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;prompt.value='first message';document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));
 expect(button.disabled).toBe(true);await vi.advanceTimersByTimeAsync(20);
 const id=app.requests.find(r=>r.action==='conversation').id;
 ws.receive({type:'opened',engine:'codex',sessionId:id,state:{},capabilities:{models:true}});
 if(order!=='models-first')ws.receive({type:'history',sessionId:id,entries:[]});
 const change=app.frames.find(f=>f.type==='set_model');expect(change).toMatchObject({provider:'codex',id:'chosen-model'});
 expect(app.frames.some(f=>f.type==='prompt')).toBe(false);
 if(order==='rejected'){ws.receive({type:'error',requestId:change.requestId,code:'operation_failed',message:'Model unavailable'});expect(app.frames.some(f=>f.type==='prompt')).toBe(false);expect(prompt.value).toBe('first message');return;}
 ws.receive({type:'ack',operation:'set_model',requestId:change.requestId});
 ws.receive({type:'models',models:[{provider:'codex',id:'chosen-model'}],current:{provider:'codex',id:'chosen-model'},thinkingLevels:[],thinkingLevel:''});
 if(order==='models-first'){expect(app.frames.some(f=>f.type==='prompt')).toBe(false);ws.receive({type:'history',sessionId:id,entries:[]});}
 expect(app.frames.filter(f=>f.type==='prompt')).toEqual([expect.objectContaining({text:'first message'})]);
});

it('ignores a stale Codex catalog after switching back to Pi',async()=>{
 const app=await setup();chooseWork();const engine=document.querySelector<HTMLSelectElement>('#task-engine')!;
 engine.value='codex';engine.dispatchEvent(new Event('change'));const query=app.frames.find(f=>f.type==='get_model_catalog');
 engine.value='pi';engine.dispatchEvent(new Event('change'));
 app.sockets.at(-1).receive({type:'model_catalog',requestId:query.requestId,engine:'codex',models:[{provider:'codex',id:'stale-model'}],current:{provider:'codex',id:'stale-model'}});
 expect(document.querySelector<HTMLButtonElement>('#agent-menu-btn')!.disabled).toBe(true);
 expect(engine.value).toBe('pi');expect(app.requests.some(r=>r.action==='conversation')).toBe(false);
});

it('does not request a draft model catalog from an older Host',async()=>{
 const app=await setup(false,false,false);chooseWork();const engine=document.querySelector<HTMLSelectElement>('#task-engine')!;
 engine.value='codex';engine.dispatchEvent(new Event('change'));
 expect(app.frames.some(f=>f.type==='get_model_catalog')).toBe(false);
 expect(document.querySelector<HTMLButtonElement>('#agent-menu-btn')!.disabled).toBe(true);
});

it('locks draft model controls while explicit task creation is in flight',async()=>{
 const app=await setup();chooseWork();const engine=document.querySelector<HTMLSelectElement>('#task-engine')!;
 engine.value='codex';engine.dispatchEvent(new Event('change'));const query=app.frames.find(f=>f.type==='get_model_catalog');
 app.sockets.at(-1).receive({type:'model_catalog',requestId:query.requestId,engine:'codex',models:[{provider:'codex',id:'default-model'}],current:{provider:'codex',id:'default-model'}});
 const button=document.querySelector<HTMLButtonElement>('#agent-menu-btn')!;expect(button.disabled).toBe(false);
 document.querySelector<HTMLButtonElement>('#create-task')!.click();expect(button.disabled).toBe(true);
 await vi.advanceTimersByTimeAsync(20);
});
