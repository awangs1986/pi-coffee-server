// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';

const q=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const tick=()=>vi.advanceTimersByTimeAsync(20);
const json=(value:unknown,ok=true)=>({ok,status:ok?200:409,json:async()=>value});
function deferred<T=any>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const chat={id:'chat-a',name:'Chat A',engine:'pi',workspaceKind:'chat',creationState:'ready',cwd:'/work/chat-a',createdAt:'2026-10-03T00:00:00Z'};
const work={...chat,id:'work-b',name:'Work B',workspaceKind:'project',projectId:'p',cwd:'/work/work-b',branch:'coffee/work-b',startSha:'abc'};
let frames:any[],requests:any[],sockets:Socket[],intercept:(url:string,body:any,init?:any)=>any;
let listeners:Array<[EventTarget,string,EventListenerOrEventListenerObject,any]>;
class Socket {
  static OPEN=1;readyState=1;onopen:any;onclose:any;onmessage:any;onerror:any;
  constructor(){sockets.push(this);queueMicrotask(()=>this.onopen?.());}
  close(){}
  receive(frame:any){this.onmessage?.({data:JSON.stringify(frame)});}
  send(value:string){const frame=JSON.parse(value);frames.push(frame);if(frame.type==='list_sessions')queueMicrotask(()=>this.receive({type:'sessions',sessions:[chat,work]}));if(frame.type==='open')queueMicrotask(()=>{
    this.receive({type:'opened',sessionId:frame.sessionId,engine:'pi',state:{}});
    this.receive({type:'history',sessionId:frame.sessionId,entries:[]});
  });}
}
beforeEach(()=>{
  vi.resetModules();vi.useFakeTimers();localStorage.clear();sessionStorage.clear();
  document.documentElement.innerHTML=readFileSync('public/index.html','utf8');
  Object.defineProperty(window,'matchMedia',{value:()=>({matches:false,addEventListener(){}}),configurable:true});
  Element.prototype.scrollTo=vi.fn();frames=[];requests=[];sockets=[];intercept=()=>undefined;listeners=[];
  for(const target of [document,window]){
    const add=target.addEventListener.bind(target);
    vi.spyOn(target,'addEventListener').mockImplementation((type:any,listener:any,options:any)=>{listeners.push([target,type,listener,options]);add(type,listener,options);});
  }
  vi.stubGlobal('WebSocket',Socket);
  const conversations:any[]=[{...chat},{...work}];
  vi.stubGlobal('fetch',vi.fn(async(url:any,init:any)=>{
    const body=init?.body?JSON.parse(init.body):null;
    if(body)requests.push(body);
    const result=intercept(String(url),body,init);if(result!==undefined)return result;
    if(url==='/auth/me')return json({auth:false});
    if(url==='/api/me')return json(null);
    if(url==='/api/engines')return json({engines:[{id:'pi',name:'Pi',available:true}]});
    if(String(url).includes('/artifacts'))return json({artifacts:[]});
    if(!body)return json({vmId:'fixture',projects:[{id:'p',name:'demo',branch:'main'}],conversations,sidebar:{assignments:{},collapsed:[]},capabilities:{chatWorkspaces:true}});
    if(body.action==='files')return json({url:'http://localhost',sessionId:body.id,scope:'scoped-'+body.id,token:'fixture',files:[]});
    if(body.action==='status')return json({state:'synced',branch:work.branch});
    if(body.action==='changes')return json({files:[],checks:[],branch:work.branch,patch:'',checkpointPaths:[]});
    if(body.action==='conversation'){const created={...chat,id:body.id};conversations.push(created);return json(created);}
    return json({});
  }));
});
afterEach(()=>{for(const [target,type,listener,options] of listeners)target.removeEventListener(type,listener,options);vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function boot(id:string|null=chat.id){if(id)sessionStorage.setItem('pi-coffee.active.v2',id);await import('../public/app.js');await tick();}
function type(value:string){q<HTMLTextAreaElement>('prompt').value=value;q('prompt').dispatchEvent(new Event('input'));}
function submit(){q('composer').dispatchEvent(new Event('submit',{cancelable:true}));}
async function select(name:string){const row=[...document.querySelectorAll<HTMLElement>('.session-item')].find(n=>n.textContent?.includes(name));expect(row).toBeDefined();row!.click();await tick();}
const key=(name:string,options:KeyboardEventInit={})=>new KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true,...options});

it('keeps a delayed task creation from selecting over another task',async()=>{
  const gate=deferred();intercept=(_url,b)=>b?.action==='conversation'?gate.promise:undefined;
  await boot(null);type('First task');submit();await tick();await select('Work B');
  gate.resolve(json({...chat,id:'created-late'}));await tick();
  expect(sessionStorage.getItem('pi-coffee.active.v2')).toBe(work.id);
  expect(frames.filter(f=>f.type==='open').at(-1).sessionId).toBe(work.id);
});
it('preserves newer edits when creation fails and prevents replacing a pending first send',async()=>{
  const gate=deferred();intercept=(_url,b)=>b?.action==='conversation'?gate.promise:undefined;
  await boot(null);type('First request');submit();await tick();type('Next draft');submit();await tick();
  gate.resolve(json({error:'clone failed'},false));await tick();
  expect(q<HTMLTextAreaElement>('prompt').value).toBe('First request\n\nNext draft');
  expect(frames.filter(f=>f.type==='prompt')).toHaveLength(0);
});
it('keeps unsent text local to each task and resets recall on switching',async()=>{
  await boot();sockets.at(-1)!.receive({type:'history',sessionId:chat.id,entries:[{kind:'user',text:'Chat-only recall'}]});await tick();
  type('Chat draft');await select('Work B');expect(q<HTMLTextAreaElement>('prompt').value).toBe('');
  q('prompt').dispatchEvent(key('ArrowUp'));expect(q<HTMLTextAreaElement>('prompt').value).toBe('');
  type('Work draft');await select('Chat A');expect(q<HTMLTextAreaElement>('prompt').value).toBe('Chat draft');
});
it('does not accept slash completion during IME composition',async()=>{
  await boot();sockets.at(-1)!.receive({type:'commands',commands:[{name:'work',description:'Work'}]});type('/w');
  const event=key('Enter',{isComposing:true});q('prompt').dispatchEvent(event);
  expect(q<HTMLTextAreaElement>('prompt').value).toBe('/w');expect(event.defaultPrevented).toBe(false);
});
it('does not select a task when Enter is pressed on its nested actions button',async()=>{
  await boot();const row=[...document.querySelectorAll('.session-item')].find(n=>n.textContent?.includes('Work B'))!;
  row.querySelector('button')!.dispatchEvent(key('Enter'));await tick();
  expect(sessionStorage.getItem('pi-coffee.active.v2')).toBe(chat.id);
});
it('does not submit a rename or native answer while composing text',async()=>{
  await boot();q('title').click();await tick();q<HTMLInputElement>('modal-input').value='new';q('modal-input').dispatchEvent(key('Enter',{isComposing:true}));await tick();
  expect(frames.filter(f=>f.type==='rename_session')).toHaveLength(0);
  q('modal-cancel').click();
  sockets.at(-1)!.receive({type:'event',sessionId:chat.id,event:{type:'extension_ui_request',method:'input',id:'question',title:'Choose',required:true}});await tick();
  q<HTMLInputElement>('ui-input').value='answer';q('ui-input').dispatchEvent(key('Enter',{isComposing:true}));await tick();
  expect(frames.filter(f=>f.type==='ui_response')).toHaveLength(0);
});
it('traps modal focus, restores the trigger and suppresses background shortcuts',async()=>{
  await boot(work.id);q('title').focus();q('title').click();await tick();
  q('modal-ok').focus();q('modal-ok').dispatchEvent(key('Tab'));
  expect(document.activeElement).toBe(q('modal-input'));
  document.dispatchEvent(key('k',{ctrlKey:true}));await tick();expect(sessionStorage.getItem('pi-coffee.active.v2')).toBe(work.id);
  q('modal-input').dispatchEvent(key('Escape',{isComposing:true}));expect(q('modal').classList.contains('hidden')).toBe(false);
  q('modal-cancel').click();await tick();expect(document.activeElement).toBe(q('title'));
});
it('keeps slow status reads progressing across overlapping polls',async()=>{
  await boot(work.id);const calls:ReturnType<typeof deferred>[]=[];
  intercept=(_url,b)=>{if(b?.action==='status'){const gate=deferred();calls.push(gate);return gate.promise;}};
  await vi.advanceTimersByTimeAsync(10000);
  calls[0].resolve(json({state:'ahead'}));await tick();
  expect(q('sync-state').dataset.state).toBe('ahead');
  expect(calls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(5000);calls[1].resolve(json({state:'synced'}));await tick();
  expect(q('sync-state').dataset.state).toBe('synced');
});
it('keeps sync unknown if an HTTP result arrives after socket disconnect',async()=>{
  await boot(work.id);const gate=deferred();intercept=(_url,b)=>b?.action==='status'?gate.promise:undefined;
  await vi.advanceTimersByTimeAsync(5000);sockets.at(-1)!.readyState=3;sockets.at(-1)!.onclose({code:1006});gate.resolve(json({state:'synced'}));await tick();
  expect(q('sync-state').dataset.state).toBe('unknown');
});
it('ignores an old Checks failure after selecting another task',async()=>{
  await boot(work.id);const gate=deferred();intercept=(_url,b)=>b?.action==='changes'&&b.id===work.id?gate.promise:undefined;
  q('files-checks').click();await tick();await select('Chat A');gate.reject(new Error('Old checkout error'));await tick();
  expect(q('workspace-detail').textContent).not.toContain('Old checkout error');
});
it('does not leave Chat Checks in a permanent loading state',async()=>{
  await boot();q('files-checks').click();await tick();
  expect(q('workspace-detail').textContent).not.toContain('正在读取');
});

function pick(file:File){Object.defineProperty(q('file'),'files',{configurable:true,value:[file]});q('file').dispatchEvent(new Event('change'));}
function slowFile(){const gate=deferred<ArrayBuffer>();const file=new File(['note'],'note.txt',{type:'text/plain'});Object.defineProperty(file,'arrayBuffer',{value:()=>gate.promise});return {file,finish:()=>gate.resolve(new ArrayBuffer(4))};}
it('reserves a selected image before decoding so Send cannot omit it',async()=>{
  await boot();vi.stubGlobal('FileReader',class{readAsDataURL(){}});type('Inspect image');pick(new File(['image'],'photo.png',{type:'image/png'}));
  expect(q<HTMLButtonElement>('send').disabled).toBe(true);submit();await tick();
  expect(frames.filter(f=>f.type==='prompt')).toHaveLength(0);
  expect(requests.filter(r=>r.info)).toHaveLength(0);
});
it.each(['remove','switch'] as const)('does not prepare a file after %s while its hash is pending',async(action)=>{
  await boot();Object.defineProperty(crypto,'subtle',{configurable:true,value:{digest:async()=>new ArrayBuffer(32)}});
  const file=slowFile();pick(file.file);await tick();type('Read file');submit();await tick();
  if(action==='remove')q('attachments').querySelector<HTMLButtonElement>('.attachment-remove')!.click();
  else {await select('Work B');await select('Chat A');}
  file.finish();await tick();
  expect(requests.filter(r=>r.info)).toHaveLength(0);
});
it('ignores a delayed Checks success after A to B to A navigation',async()=>{
  await boot(work.id);const gates:ReturnType<typeof deferred>[]=[];
  intercept=(_url,b)=>{if(b?.action==='changes'&&b.id===work.id){const gate=deferred();gates.push(gate);return gate.promise;}};
  q('files-checks').click();await tick();await select('Chat A');await select('Work B');
  for(const gate of gates.slice(1))gate.resolve(json({files:[],checks:[],branch:'current',patch:''}));await tick();
  gates[0].resolve(json({files:[{path:'stale.ts',status:'M'}],checks:[],branch:'stale',patch:''}));await tick();
  expect(q('workspace-list').textContent).not.toContain('stale.ts');
  expect(q('workspace-detail').textContent).not.toContain('检查 · stale');
});
it('refreshes existing tool download URLs when a scoped grant rotates',async()=>{
  await boot();const ws=sockets.at(-1)!;
  ws.receive({type:'history',sessionId:chat.id,entries:[{kind:'tool',name:'read',args:{path:'note.txt'},result:'note'}]});await tick();
  expect(document.querySelector<HTMLAnchorElement>('.tool-dl')?.href).toContain('token=fixture');
  ws.receive({type:'transfer',sessionId:chat.id,scope:'scoped-'+chat.id,url:'http://localhost',token:'rotated'});await tick();
  expect(document.querySelector<HTMLAnchorElement>('.tool-dl')?.href).toContain('token=rotated');
});
it('keeps the focused sidebar action reachable across unchanged polling',async()=>{
  await boot();const button=document.querySelector<HTMLButtonElement>('.session-item .more')!;button.focus();
  await vi.advanceTimersByTimeAsync(5000);
  expect(document.activeElement?.classList.contains('more')).toBe(true);
  expect(document.activeElement?.closest('.session-item')?.textContent).toContain(button.closest('.session-item')!.querySelector('.title')!.textContent);
});
it('preserves the focused task-details control while metadata polls',async()=>{
  await boot();q('task-details-btn').click();const button=q('workspace-context').querySelectorAll<HTMLButtonElement>('button')[1];button.focus();
  await vi.advanceTimersByTimeAsync(5000);expect(document.activeElement).toBe(button);expect(button.isConnected).toBe(true);
});
it('does not overwrite a newer socket grant with a delayed HTTP grant',async()=>{
  await boot();const ws=sockets.at(-1)!;
  ws.receive({type:'history',sessionId:chat.id,entries:[{kind:'tool',name:'read',args:{path:'note.txt'},result:'note'}]});
  const gate=deferred();intercept=(_url,b)=>b?.action==='files'?gate.promise:undefined;
  await vi.advanceTimersByTimeAsync(5000);
  ws.receive({type:'transfer',sessionId:chat.id,scope:'scoped-'+chat.id,url:'http://localhost',token:'newest'});
  gate.resolve(json({url:'http://localhost',scope:'scoped-'+chat.id,sessionId:chat.id,token:'stale'}));await tick();
  expect(document.querySelector<HTMLAnchorElement>('.tool-dl')?.href).toContain('token=newest');
});
it('requires explicit retry after an upload times out',async()=>{
  await boot();Object.defineProperty(crypto,'subtle',{configurable:true,value:{digest:async()=>new ArrayBuffer(32)}});
  const prepared=deferred();let upload:any;
  intercept=(url)=>url.includes('prepare-upload')?prepared.promise:undefined;
  vi.stubGlobal('XMLHttpRequest',class{upload={};timeout=0;ontimeout:any;open(){}send(){upload=this;}abort(){}});
  const file=slowFile();pick(file.file);await tick();type('Read attachment');submit();file.finish();await tick();
  const info=requests.find(r=>r.info);expect(info).toBeDefined();
  prepared.resolve(json({sessionId:'upload-fixture',files:Object.fromEntries(Object.keys(info.files).map(id=>[id,'upload-token']))}));await tick();
  expect(upload.timeout).toBeGreaterThan(0);upload.ontimeout();await tick();
  expect(q<HTMLTextAreaElement>('prompt').value).toBe('Read attachment');
  expect(frames.filter(f=>f.type==='prompt')).toHaveLength(0);
  expect(q('attachments').querySelector('.upload-retry')).not.toBeNull();
});
it.each(['files-checks','branch-diff'])('settles a slow %s view even when metadata polling overlaps it',async(control)=>{
  await boot(work.id);const gates:ReturnType<typeof deferred>[]=[];
  intercept=(_url,b)=>{if(b?.action==='changes'){const gate=deferred();gates.push(gate);return gate.promise;}};
  q(control).click();await tick();await vi.advanceTimersByTimeAsync(5000);
  const result=()=>json({scope:'branch',sessionId:work.id,files:[],checks:[{command:'git diff --check',ok:true,output:'fixture check complete'}],branch:work.branch,patch:'',base:'abc',target:'def',checkpointPaths:[]});
  for(const gate of gates.slice(1))gate.resolve(result());await tick();gates[0].resolve(result());await tick();
  if(control==='files-checks')expect(q('workspace-detail').textContent).toContain('fixture check complete');
  else expect(q('diff-content').textContent).not.toContain('正在');
});
it('returns the draft when an expired upload grant cannot be refreshed before its deadline',async()=>{
  await boot();Object.defineProperty(crypto,'subtle',{configurable:true,value:{digest:async()=>new ArrayBuffer(32)}});
  let waiting=false,aborted=0;
  intercept=(url,body,init)=>{
    if(url.includes('prepare-upload')){waiting=true;return {...json({message:'expired'},false),status:401};}
    if(waiting&&body?.action==='files')return new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>{aborted++;reject(new Error('grant timed out'));},{once:true}));
  };
  const file=slowFile();pick(file.file);await tick();type('Keep this request');submit();file.finish();await tick();
  await vi.advanceTimersByTimeAsync(30010);
  expect(aborted).toBeGreaterThan(0);expect(q<HTMLTextAreaElement>('prompt').value).toBe('Keep this request');
  expect(frames.filter(f=>f.type==='prompt')).toHaveLength(0);
  expect(q('attachments').querySelector('.upload-retry')).not.toBeNull();
});
