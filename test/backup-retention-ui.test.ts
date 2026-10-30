// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';import {initBackupControls} from '../public/backup.js';
afterEach(()=>document.body.replaceChildren());
it('shows a concrete retention preview and sends only its exact approved revision, never auto-executing it',async()=>{
 const plan={id:'11111111-1111-4111-8111-111111111111',revision:3,digest:'a'.repeat(64),state:'previewed',scopes:['alice'],timeZone:'America/Toronto',keep:[{snapshotId:'safe-last',reasons:[{kind:'last-complete',scope:'alice',taskId:'task'}]}],remove:[{snapshotId:'obsolete',jobIds:['old'],scopes:['alice']}],pins:[]};
 const request=vi.fn(async(body?:any)=>body?.action==='retention-preview'?plan:body?.action==='retention-execute'?{...plan,state:'completed',deletedSnapshotIds:['obsolete']}:{scope:'alice',canManage:true,managedScopes:['alice','bob'],tasks:[],repository:{configured:true,enabled:true,jobs:[],points:[]},retention:{available:true,plans:[],pins:[{id:'active-pin',operationId:'restore-operation',expiresAt:'2026-10-26T00:00:00Z',activeLease:true}]}});
 const panel=initBackupControls({context:()=>({user:'awangs'}),request});await panel.open();
 const button=[...document.querySelectorAll('button')].find(node=>node.textContent==='预览当前账号保留计划');expect(button).toBeTruthy();await button!.click();await vi.waitFor(()=>expect(document.body.textContent).toContain('obsolete'));
 expect(request.mock.calls.some(([body])=>body?.action==='retention-execute')).toBe(false);expect(document.body.textContent).toContain('safe-last');expect(document.body.textContent).toContain('2026-10-26T00:00:00Z');expect(document.body.textContent).toContain('活跃租约');
 const execute=[...document.querySelectorAll('button')].find(node=>node.textContent==='批准并执行此计划');execute!.click();await vi.waitFor(()=>expect(request).toHaveBeenCalledWith(expect.objectContaining({action:'retention-execute',scope:'alice',id:plan.id,revision:3,digest:plan.digest}),expect.any(AbortSignal)));
});
it('lets the administrator preview every managed account together so shared snapshots can be reclaimed safely',async()=>{
 const request=vi.fn(async(body?:any)=>body?.action==='retention-preview'?{id:'all-plan',revision:1,digest:'b'.repeat(64),state:'previewed',scopes:body.scopes,timeZone:'America/Toronto',keep:[],remove:[],pins:[]}:{scope:'alice',canManage:true,managedScopes:['alice','bob'],tasks:[],repository:{configured:true,enabled:true,jobs:[],points:[]},retention:{available:true,plans:[],pins:[]}});
 const panel=initBackupControls({context:()=>({user:'awangs'}),request});await panel.open();const button=[...document.querySelectorAll('button')].find(node=>node.textContent==='预览所有受管账号保留计划');expect(button).toBeTruthy();button!.click();await vi.waitFor(()=>expect(request).toHaveBeenCalledWith({action:'retention-preview',scope:'alice',scopes:['alice','bob'],timeZone:'America/Toronto'},expect.any(AbortSignal)));expect(request.mock.calls.some(([body])=>body?.action==='retention-execute')).toBe(false);
});
