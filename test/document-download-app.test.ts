// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();vi.resetModules();sessionStorage.clear();localStorage.clear();history.replaceState(null,'','/');});

it('renders a scoped Word download in the actual restored Chat controller',async()=>{
 vi.useFakeTimers();document.documentElement.innerHTML=readFileSync('public/index.html','utf8');
 Object.defineProperty(window,'matchMedia',{value:()=>({matches:false,addEventListener(){}}),configurable:true});Element.prototype.scrollTo=vi.fn();
 sessionStorage.setItem('pi-coffee.active.v2','word-chat');
 const task={id:'word-chat',engine:'pi',workspaceKind:'chat',creationState:'ready',archived:false,createdAt:'2026-10-07T00:00:00Z'},sockets:any[]=[];
 class Socket{static OPEN=1;readyState=1;onopen:any;onmessage:any;constructor(){sockets.push(this);queueMicrotask(()=>this.onopen?.());}send(){}close(){}receive(frame:any){this.onmessage?.({data:JSON.stringify(frame)});}}
 vi.stubGlobal('WebSocket',Socket);
 const json=(value:unknown)=>({ok:true,status:200,json:async()=>value});
 vi.stubGlobal('fetch',vi.fn(async(url:any,init:any)=>{
  if(String(url).includes('/artifacts?'))return json({artifacts:[{path:'report.docx',available:true}]});
  if(url==='/auth/me')return json({auth:false});if(url==='/api/me')return json(null);
  if(url==='/api/engines')return json({engines:[{id:'pi',available:true}]});
  const body=init?.body?JSON.parse(init.body):null;
  if(body?.action==='files')return json({url:'http://vm.example',scope:task.id,token:'synthetic-file-grant'});
  if(body)return json({state:'local',files:[]});
  return json({projects:[],conversations:[task],sidebar:{assignments:{},collapsed:[]},capabilities:{chatWorkspaces:true}});
 }));
 await import('../public/app.js');await vi.advanceTimersByTimeAsync(30);
 sockets.at(-1).receive({v:1,type:'opened',sessionId:task.id,engine:'pi',state:{isStreaming:false,messageCount:2},capabilities:{models:true}});
 sockets.at(-1).receive({v:1,type:'history',sessionId:task.id,entries:[{id:'reply',kind:'assistant',text:'Document: `report.docx`'}],leafId:'reply'});
 await vi.advanceTimersByTimeAsync(50);
 const link=document.querySelector<HTMLAnchorElement>('.generated-document-download');
 expect(link).not.toBeNull();expect(link!.href).toContain('/workspace-download?');expect(new URL(link!.href).searchParams.get('path')).toBe('report.docx');
 expect(document.querySelector('#thread')!.textContent).not.toContain('工作区产物');
});
