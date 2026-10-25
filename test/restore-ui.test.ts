// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';import {initBackupControls} from '../public/backup.js';
afterEach(()=>document.body.replaceChildren());
it('lets readers request a selected recovery point but reserves plan approval and publication for the administrator',async()=>{
 const request=vi.fn(async()=>({scope:'alice',canManage:false,tasks:[],repository:{jobs:[{id:'repository-job',state:'succeeded',points:[{taskId:'lost',captureAt:'2026-10-24T00:00:00Z'}]}]},restores:[{id:'operation',scope:'alice',taskId:'lost',state:'staged',revision:2,digest:'plan-digest'}]}));
 const controls=initBackupControls({context:()=>({user:'alice'}),request});await controls.open();const buttons=[...document.querySelectorAll('button')];const recover=buttons.find(b=>b.textContent==='请求找回此任务');expect(recover).toBeDefined();recover!.click();await new Promise(r=>setTimeout(r,0));expect(request).toHaveBeenCalledWith({action:'restore-request',scope:'alice',taskId:'lost',jobId:'repository-job'},expect.any(AbortSignal));
 expect(document.body.textContent).toContain('operation');expect([...document.querySelectorAll('button')].some(b=>/批准|确认接回/.test(b.textContent??''))).toBe(false);
});
it('shows isolated verification and exact revision before separate approve and publish actions',async()=>{
 const request=vi.fn(async()=>({scope:'alice',canManage:true,managedScopes:['alice'],tasks:[],repository:{jobs:[]},restores:[{id:'operation',scope:'alice',taskId:'lost',state:'staged',phase:'prepared',revision:2,digest:'plan-digest',checkpointId:'checkpoint',warnings:['No input replay'],originalPaths:['/owned/task']}]}));
 const controls=initBackupControls({context:()=>({user:'awangs'}),request});await controls.open();expect(document.body.textContent).toContain('修订 2');expect(document.body.textContent).toContain('/owned/task');const approve=[...document.querySelectorAll('button')].find(b=>b.textContent==='批准此修订');expect(approve).toBeDefined();approve!.click();await new Promise(r=>setTimeout(r,0));expect(request).toHaveBeenCalledWith({action:'restore-approve',id:'operation',scope:'alice',revision:2,digest:'plan-digest'},expect.any(AbortSignal));
});
