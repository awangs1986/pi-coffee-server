// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {it,expect,vi,afterEach} from 'vitest';
import {initSshme,parseSshme} from '../public/sshme.js';
afterEach(()=>vi.unstubAllGlobals());
const tick=()=>new Promise(r=>setTimeout(r,0));
const input=(id:string)=>document.getElementById(id) as HTMLInputElement;
function setup({fail=false,changed=false}={}){
 document.documentElement.innerHTML=readFileSync('public/index.html','utf8');
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new Event('close'));};
 const calls:any[]=[],ready=vi.fn();let current=!changed;
 vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
  if(url==='/api/client-address')return {ok:true,json:async()=>({address:'192.168.1.10',suggestedHost:'192.168.1.10'})};
  expect(url).toBe('/api/sshme');const body=JSON.parse(init.body);calls.push(body);
  const data=body.action==='list'?{runners:[]} : body.action==='save'?{runner:{...body.runner,password:undefined,id:'id-1',hasPassword:true}}:fail?{error:'Windows 连接失败'}:{prompt:'Safe model request without credentials.'};
  return {ok:!(body.action==='sshme'&&fail),json:async()=>data};
 }));
 const controller=initSshme({onOpen:vi.fn(),isCurrent:()=>current,onReady:ready});return {controller,calls,ready,setCurrent:(value:boolean)=>{current=value;}};
}
it('recognizes only the built-in command, case-insensitively',()=>{
 expect(parseSshme('/SSHME 安装软件')).toBe('安装软件');expect(parseSshme('/sshme')).toBe('');expect(parseSshme('/sshmenu x')).toBeNull();expect(parseSshme('解释 /sshme')).toBeNull();
});
it('prefills the observed IP, sends only after save/connect, and clears the password field',async()=>{
 const {controller,calls,ready}=setup();await controller.open({request:'Install editor',context:'task-a',conversationId:'task-a'});
 expect(input('sshme-host').value).toBe('192.168.1.10');expect(ready).not.toHaveBeenCalled();
 input('sshme-username').value='tester';input('sshme-password').value='fixture-only-secret';
 document.getElementById('sshme-form')!.dispatchEvent(new Event('submit',{cancelable:true}));await tick();
 expect(calls.every(c=>c.conversationId==='task-a')).toBe(true);expect(calls.map(c=>c.action)).toEqual(['list','save','sshme']);expect(ready).toHaveBeenCalledWith('Safe model request without credentials.','task-a');
 expect(input('sshme-password').value).toBe('');expect(document.body.textContent).not.toContain('fixture-only-secret');
});
it.each([{fail:true},{changed:true}])('does not deliver after failed connection or conversation change: %j',async options=>{
 const {controller,ready}=setup(options);await controller.open({request:'Install editor',context:'task-a',conversationId:'task-a'});
 input('sshme-username').value='tester';document.getElementById('sshme-form')!.dispatchEvent(new Event('submit',{cancelable:true}));await tick();expect(ready).not.toHaveBeenCalled();
});
it('closing the dialog does not send the request',async()=>{
 const {controller,ready}=setup();await controller.open({request:'Install editor',context:'task-a',conversationId:'task-a'});input('sshme-password').value='temporary';(document.getElementById('sshme-close') as HTMLButtonElement).click();expect(ready).not.toHaveBeenCalled();expect(input('sshme-password').value).toBe('');
});

it.each(['switch','close'])('never dispatches when the user changes context during the SSH test: %s',async action=>{
 const {controller,calls,ready,setCurrent}=setup();let finish:(value:any)=>void=()=>{};
 const original=globalThis.fetch;
 vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
  if(init?.body&&JSON.parse(String(init.body)).action==='sshme')return await new Promise(resolve=>{finish=resolve;});
  return original(url,init);
 }));
 await controller.open({request:'Install editor',context:'task-a',conversationId:'task-a'});input('sshme-username').value='tester';
 document.getElementById('sshme-form')!.dispatchEvent(new Event('submit',{cancelable:true}));await tick();
 expect(calls.some(c=>c.action==='save')).toBe(true);
 if(action==='close')(document.getElementById('sshme-close') as HTMLButtonElement).click();
 else setCurrent(false);
 finish({ok:true,json:async()=>({prompt:'Stale request must not run'})});await tick();expect(ready).not.toHaveBeenCalled();
});

it.each(['windows','linux','macos'])('saves the selected local-computer OS through the independent endpoint: %s',async platform=>{
 const {controller,calls}=setup();await controller.open({request:'Check system',context:'task-a',conversationId:'task-a'});
 input('sshme-platform').value=platform;input('sshme-username').value='tester';
 document.getElementById('sshme-form')!.dispatchEvent(new Event('submit',{cancelable:true}));await tick();
 expect(calls.find(c=>c.action==='save').runner.platform).toBe(platform);
 expect(document.getElementById('sshme-dialog')!.textContent).not.toContain('配置测试服务器');
});

it('can forget an assistance credential in its own dialog without a model request',async()=>{
 const {controller,calls,ready}=setup();let original=globalThis.fetch;
 vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
  if(init?.body&&JSON.parse(String(init.body)).action==='list')return {ok:true,json:async()=>({runners:[{id:'saved',host:'192.168.1.10',port:22,username:'tester',platform:'macos',hasPassword:true}]})};
  return original(url,init);
 }));
 await controller.open({request:'Check system',context:'task-a',conversationId:'task-a'});expect(input('sshme-platform').value).toBe('macos');
 (document.getElementById('sshme-forget') as HTMLButtonElement).click();await tick();
 expect(calls).toContainEqual({action:'delete',id:'saved',conversationId:'task-a'});expect(ready).not.toHaveBeenCalled();
 expect(document.getElementById('sshme-forget')!.hidden).toBe(true);
});
