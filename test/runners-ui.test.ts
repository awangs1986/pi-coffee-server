// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {it,expect,vi,afterEach} from 'vitest';
import {initRunners} from '../public/runners.js';
afterEach(()=>vi.unstubAllGlobals());
const tick=()=>new Promise(r=>setTimeout(r,0));
it('opens from the Logo menu, saves/tests/edits/deletes without exposing a saved password',async()=>{
 document.documentElement.innerHTML=readFileSync('public/index.html','utf8');
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new Event('close'));};
 const calls:any[]=[],rows:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{const body=JSON.parse(init.body);calls.push(body);let data:any={};
  if(body.action==='list')data={runners:rows};
  if(body.action==='save'){const {password,...r}=body.runner;const row={...r,id:r.id??'runner-1',hasPassword:Boolean(password)||Boolean(rows[0]?.hasPassword)};rows.splice(0,1,row);data={runner:row};}
  if(body.action==='test')data={ok:true,message:'连接成功'};
  if(body.action==='delete')rows.splice(0);
  return {ok:true,json:async()=>structuredClone(data)};
 }));
 initRunners({onOpen:vi.fn()});
 const click=(id:string)=>(document.getElementById(id) as HTMLButtonElement).click();
 click('runners-btn');await tick();expect(document.getElementById('runners-dialog')!.hasAttribute('open')).toBe(true);
 const fill=(id:string,value:string)=>{(document.getElementById(id) as HTMLInputElement).value=value;};
 fill('runner-name','Test <server>');fill('runner-host','localhost');fill('runner-username','tester');fill('runner-password','fixture-secret');
 document.getElementById('runner-form')!.dispatchEvent(new Event('submit',{cancelable:true}));await tick();
 expect(calls.find(c=>c.action==='save').runner.password).toBe('fixture-secret');expect(document.body.textContent).not.toContain('fixture-secret');expect((document.getElementById('runner-password') as HTMLInputElement).value).toBe('');
 expect(document.querySelector('#runners-list server')).toBeNull();expect(document.querySelector('#runners-list')!.textContent).toContain('Test <server>');
 (document.querySelector('[data-runner-action="test"]') as HTMLButtonElement).click();await tick();expect(document.getElementById('runners-status')!.textContent).toBe('连接成功');
 (document.querySelector('[data-runner-action="edit"]') as HTMLButtonElement).click();expect((document.getElementById('runner-password') as HTMLInputElement).value).toBe('');
 (document.querySelector('[data-runner-action="delete"]') as HTMLButtonElement).click();await tick();expect(calls.at(-2)).toMatchObject({action:'delete',id:'runner-1'});expect(document.querySelector('#runners-list')!.textContent).toContain('尚未配置');
});
