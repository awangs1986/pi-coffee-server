// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';
import {initBackupControls} from '../public/backup.js';
afterEach(()=>document.body.replaceChildren());
it('confirms a personal account preview once without a separate approval button',async()=>{
 const request=vi.fn(async()=>({scope:'alice',personal:true,canManage:true,managedScopes:['alice','bob'],tasks:[],repository:{jobs:[]},accountRestores:[{id:'account',state:'staged',revision:1,digest:'reviewed',rows:[],vector:[],blocked:false}]}));
 await initBackupControls({context:()=>({user:'awangs'}),request}).open();
 const buttons=[...document.querySelectorAll('button')];expect(buttons.some(b=>b.textContent==='批准此账号修订')).toBe(false);
 const confirm=buttons.find(b=>b.textContent==='确认恢复此账号');expect(confirm).toBeDefined();confirm!.click();await new Promise(r=>setTimeout(r,0));
 expect(request).toHaveBeenCalledWith({action:'account-restore-confirm',id:'account',revision:1,digest:'reviewed'},expect.any(AbortSignal));
});
it('offers one collection preview for all enrolled accounts and shows a single collection confirmation',async()=>{
 const data={scope:'alice',personal:true,canManage:true,managedScopes:['alice','bob'],tasks:[],repository:{jobs:[]},collectionRestores:[{id:'collection',state:'staged',digest:'combined',accounts:[{scope:'alice',state:'staged',rows:[]},{scope:'bob',state:'staged',rows:[]}]}]};
 const request=vi.fn(async(body?:{action?:string})=>body?.action==='recovery-points'?{points:[{jobId:'job',taskId:'one',engine:'pi',captureAt:'2026-10-29T00:00:00Z'}]}:data);
 await initBackupControls({context:()=>({user:'awangs'}),request}).open();
 const button=(text:string)=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)!;
 button('浏览历史恢复点').click();await new Promise(r=>setTimeout(r,0));
 (document.querySelector('[aria-label="选择恢复点作业 job"]') as HTMLInputElement).click();
 const all=document.querySelector('[aria-label="恢复全部纳管账号"]') as HTMLInputElement;expect(all).not.toBeNull();all.click();
 button('预览恢复全部纳管账号').click();await new Promise(r=>setTimeout(r,0));
 expect(request).toHaveBeenCalledWith({action:'collection-preview',selections:[{scope:'alice',jobIds:['job']},{scope:'bob',jobIds:['job']}],mode:'missing-only'},expect.any(AbortSignal));
 button('确认恢复全部所选账号').click();await new Promise(r=>setTimeout(r,0));
 expect(request).toHaveBeenCalledWith({action:'collection-confirm',id:'collection',digest:'combined'},expect.any(AbortSignal));
});

it('shows separate Gitea state and owner backup and restore controls',async()=>{
 const request=vi.fn(async()=>({scope:'alice',personal:true,canManage:true,tasks:[],gitea:{configured:true,version:'1.27.3',last:{state:'failed',errorCode:'service_command_failed'},points:[{id:'service-job',state:'succeeded',points:[{captureAt:'2026-10-30T04:00:00Z'}]}],restores:[{id:'restore-service',digest:'reviewed',state:'staged',targets:[{path:'/fixture/gitea',replaces:false}]}]}}));
 await initBackupControls({context:()=>({user:'awangs'}),request}).open();
 const button=(text:string)=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)!;
 expect(document.body.textContent).toContain('service_command_failed');
 button('备份 Gitea 与登录配置').click();await new Promise(r=>setTimeout(r,0));
 expect(request).toHaveBeenCalledWith({action:'gitea-backup'},expect.any(AbortSignal));
 button('预览恢复 Gitea').click();await new Promise(r=>setTimeout(r,0));
 expect(request).toHaveBeenCalledWith({action:'gitea-preview',jobId:'service-job'},expect.any(AbortSignal));
 button('确认恢复 Gitea').click();await new Promise(r=>setTimeout(r,0));
 expect(request).toHaveBeenCalledWith({action:'gitea-confirm',id:'restore-service',digest:'reviewed'},expect.any(AbortSignal));
});
