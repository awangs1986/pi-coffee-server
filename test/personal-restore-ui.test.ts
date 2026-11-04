// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';
import {initBackupControls} from '../public/backup.js';
afterEach(()=>document.body.replaceChildren());

it('offers an owner one preview and one confirmation without a separate approval step',async()=>{
 const request=vi.fn(async()=>({scope:'alice',personal:true,canManage:true,managedScopes:['alice'],tasks:[],repository:{jobs:[{id:'job',state:'succeeded',points:[{taskId:'lost',captureAt:'2026-10-29T00:00:00Z'}]}]},restores:[{id:'operation',scope:'alice',taskId:'lost',state:'staged',phase:'prepared',revision:2,digest:'reviewed',checkpointId:'point',originalPaths:['/owned/task']}]}));
 const controls=initBackupControls({context:()=>({user:'awangs'}),request});await controls.open();
 const button=(text:string)=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
 expect(button('预览恢复此任务')).toBeDefined();button('预览恢复此任务')!.click();await new Promise(r=>setTimeout(r,0));
 expect(request).toHaveBeenCalledWith({action:'restore-preview',scope:'alice',taskId:'lost',jobId:'job'},expect.any(AbortSignal));
 expect(document.body.textContent).toContain('/owned/task');expect(button('批准此修订')).toBeUndefined();
 expect(button('确认恢复')).toBeDefined();button('确认恢复')!.click();await new Promise(r=>setTimeout(r,0));
 expect(request).toHaveBeenCalledWith({action:'restore-confirm',id:'operation',scope:'alice',revision:2,digest:'reviewed'},expect.any(AbortSignal));
});
