// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {it,expect,vi} from 'vitest';
it('creates Chat and Work through the Host API, displays a full cwd, and preserves creation identity on retry',async()=>{
 document.documentElement.innerHTML=readFileSync('public/index.html','utf8');
 Object.defineProperty(window,'matchMedia',{value:()=>({matches:false,addEventListener(){}}),configurable:true});
 Element.prototype.scrollTo=vi.fn();
 const prepareRequests:any[]=[];
 const calls:any[]=[];let conversations:any[]=[];let fail=false;let holdOpen=false;
 const projects=[{id:'p',name:'owner/demo',branch:'main',webUrl:'http://gitea/owner/demo'}];
 class Socket {static OPEN=1;readyState=1;onopen:any;onmessage:any;onclose:any;onerror:any;constructor(){queueMicrotask(()=>this.onopen?.());}close(){}send(text:string){const value=JSON.parse(text);if(value.type==='open' && !holdOpen)queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'opened',sessionId:value.sessionId,state:{}})}));}}
 vi.stubGlobal('WebSocket',Socket);
 vi.stubGlobal('fetch',vi.fn(async(url:any,init:any)=>{
   if(String(url).includes('prepare-upload'))prepareRequests.push(init);
   if(String(url)==='/api/me')return {ok:true,json:async()=>null};
   const body=init?.body?JSON.parse(init.body):null;
   if(!body)return {ok:true,json:async()=>({projects,conversations,vmId:'linux001',capabilities:{chatWorkspaces:true}})};
   calls.push(body);
   if(body.action==='conversation'){
     if(fail){fail=false;return {ok:false,json:async()=>({error:'temporary clone failure'})};}
     const c={id:body.id,workspaceKind:body.workspaceKind,projectId:body.projectId,cwd:'/home/awang/work/'+(body.workspaceKind==='chat'?'chats/':'projects/checkouts/')+body.id,branch:body.workspaceKind==='chat'?'':'coffee/linux001/'+body.id,creationState:'ready'};conversations.push(c);return {ok:true,json:async()=>c};
   }
   return {ok:true,json:async()=>body.action==='status'?{state:conversations.at(-1)?.workspaceKind==='chat'?'local':'synced',branch:conversations.at(-1)?.branch}:{url:'http://localhost',scope:body.id,token:'test',maxFileBytes:100000,maxBatchBytes:100000,files:[]}};
 }));
 vi.useFakeTimers();
 try {
   await import('../public/app.js');await vi.advanceTimersByTimeAsync(10);
   const kind=document.querySelector<HTMLSelectElement>('#task-kind');expect(kind).not.toBeNull();
   document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(10);
   expect(calls.find(c=>c.action==='conversation')).toMatchObject({workspaceKind:'chat'});
   expect(document.querySelector('#workspace-context')?.textContent).toContain('/home/awang/work/chats/');
   expect(document.querySelector('#workspace-context')?.textContent).toContain('linux001');
   let finishHash!:()=>void;
   Object.defineProperty(crypto,'subtle',{configurable:true,value:{digest:async()=>new ArrayBuffer(32)}});
   const file=new File(['original'],'note.txt',{type:'text/plain'});
   Object.defineProperty(file,'arrayBuffer',{value:()=>new Promise(resolve=>{finishHash=()=>resolve(new ArrayBuffer(8));})});
   const input=document.querySelector<HTMLInputElement>('#file')!;Object.defineProperty(input,'files',{configurable:true,value:[file]});input.dispatchEvent(new Event('change'));await vi.advanceTimersByTimeAsync(1);
   expect(prepareRequests).toHaveLength(0);
   document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));await vi.advanceTimersByTimeAsync(1);
   document.querySelector<HTMLButtonElement>('#new-task')!.click();await vi.advanceTimersByTimeAsync(10);
   finishHash();await vi.advanceTimersByTimeAsync(10);expect(prepareRequests).toHaveLength(0);
   kind!.value='project';kind!.dispatchEvent(new Event('change'));
   const project=document.querySelector<HTMLSelectElement>('#project-select')!;project.value='p';project.dispatchEvent(new Event('change'));
   (document.querySelector('#start-branch') as HTMLInputElement).value='main';
   holdOpen=true;fail=true;document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(10);
   document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(10);
   const creates=calls.filter(c=>c.action==='conversation');expect(creates).toHaveLength(3);expect(creates[1].id).toBe(creates[2].id);expect(creates[2]).toMatchObject({projectId:'p',branch:'main',workspaceKind:'project'});
   expect(document.querySelector('#workspace-context')?.textContent).toContain('/home/awang/work/projects/checkouts/');
   expect(localStorage.getItem('pi-coffee.active.v2')).toBe(creates[2].id);
   // Existing tasks expose metadata without redundant creation fields.
   expect(project.closest('label')!.classList.contains('hidden')).toBe(true);
   expect(document.querySelector('#start-branch')!.closest('label')!.classList.contains('hidden')).toBe(true);
   const details=[...document.querySelectorAll('button')].find(b=>b.textContent==='详情');
   expect(details).toBeDefined();details!.click();
   expect(document.querySelector('#modal-text')?.textContent).toContain(creates[2].id);
   expect(document.querySelector('#modal-text')?.textContent).toContain('owner/demo');
   document.querySelector<HTMLButtonElement>('#modal-ok')!.click();
   document.querySelector<HTMLButtonElement>('#new-task')!.click();await vi.advanceTimersByTimeAsync(10);
   kind!.value='project';kind!.dispatchEvent(new Event('change'));
   expect(project.closest('label')!.classList.contains('hidden')).toBe(false);
   expect(document.querySelector('#create-task')?.textContent).toBe('创建任务');
 }finally{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();}
});
