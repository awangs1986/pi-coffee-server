import {expect,it} from 'vitest';
import {speechPolicy} from './helpers/speech-policy.js';
it('never resurrects a consumed completion when a duplicate settlement arrives',async()=>{
 const f=speechPolicy();await f.init();await f.complete();const grant=await f.commit(await f.reserve());expect(grant.committed).toBe(true);
 await f.request({action:'finish',id:'task',completionId:'c1',deliveryId:grant.deliveryId,outcome:'played'});
 await f.policy.settled('task','0.1.0','Duplicate completion',false);
 expect((await f.request({action:'pending'})).items).toEqual([]);
});
it('releases expired reservations, fences stale owners and rejects conflicting operation identities',async()=>{
 const f=speechPolicy();await f.init();await f.complete();const first=await f.reserve();f.advance(30000);
 expect((await f.commit(first)).committed).toBe(false);
 const second=await f.request({action:'reserve',id:'task',completionId:'c1',pageId:'page-two',operationId:'reserve-two'});
 expect(second.reserved).toBe(true);
 await expect(f.request({action:'reserve',id:'task',completionId:'c1',pageId:'different-page',operationId:'reserve-two'})).rejects.toThrow('身份');
 await f.request({action:'designate',browserId:'browser-two'});
 expect((await f.request({action:'commit',id:'task',completionId:'c1',pageId:'page-two',token:second.reservation.token,ownerEpoch:second.reservation.ownerEpoch})).committed).toBe(false);
 expect((await f.request({action:'pending',browserId:'browser-two',pageId:'new-page'})).items).toHaveLength(1);
 f.restart();expect((await f.request({action:'pending',browserId:'browser-two',pageId:'new-page'})).items).toHaveLength(1);
});
it('never grants audio before durable storage succeeds and keeps failed reservations recoverable',async()=>{
 const f=speechPolicy();await f.init();await f.complete();const held=await f.reserve();f.failSave(true);
 await expect(f.commit(held)).rejects.toThrow('storage');f.failSave(false);
 expect((await f.request({action:'pending'})).reservation.token).toBe(held.reservation.token);
 expect((await f.commit(held)).committed).toBe(true);f.restart();expect((await f.request({action:'pending'})).items).toEqual([]);
});
it('does not let a second page finish another page permission and makes finish retries harmless',async()=>{
 const f=speechPolicy();await f.init();await f.complete();const grant=await f.commit(await f.reserve());
 const finish={action:'finish',id:'task',completionId:'c1',deliveryId:grant.deliveryId,outcome:'played',operationId:'finish-one'};
 await f.request({...finish,pageId:'foreign-page',operationId:'foreign-finish'});
 expect((await f.request({action:'pending'})).active.deliveryId).toBe(grant.deliveryId);
 await f.request(finish);await f.request(finish);f.restart();
 const result=await f.request({action:'pending'});expect(result.items).toEqual([]);expect(result.diagnostics.filter((d:any)=>d.state==='played')).toHaveLength(1);
});
it.each(['disabled','deselected','archived','superseded','deleted'])('revokes a reserved result on %s and never resurrects it',async(reason)=>{
 const f=speechPolicy();await f.init();await f.complete();const held=await f.reserve();
 if(reason==='disabled')await f.request({action:'configure',enabled:false});
 if(reason==='deselected')await f.request({action:'select',id:'task',enabled:false});
 if(reason==='archived')f.tasks.get('task')!.archived=true;
 if(reason==='superseded')f.tasks.get('task')!.completionId='c2';
 if(reason==='deleted')f.tasks.delete('task');
 expect((await f.commit(held)).committed).toBe(false);
 await f.request({action:'configure',enabled:true});
 if(reason!=='deleted'){f.tasks.get('task')!.archived=false;f.tasks.get('task')!.completionId='c1';await f.request({action:'select',id:'task',enabled:true});}
 f.restart();expect((await f.request({action:'pending'})).items).toEqual([]);
});
it('preserves an opt-in changed while native preparation is awaiting the first state read',async()=>{
 const {CompletionSpeech}=await import('../packages/completion-speech/index.js');let saved:any,first=true,release:()=>void=()=>{},entered:()=>void=()=>{};const started=new Promise<void>(r=>{entered=r;});
 const policy=new CompletionSpeech({load:async()=>{const snapshot=saved;if(first){first=false;entered();await new Promise<void>(r=>{release=r;});}return snapshot;},save:async value=>{saved=structuredClone(value);},task:async()=>undefined});
 const preparing=policy.prepare('task');await started;const configuring=policy.handle({action:'configure',enabled:true});
 for(let n=0;n<30;n++)await Promise.resolve();release();await preparing;await configuring;expect((await policy.status()).enabled).toBe(true);
});
it('rejects a mismatched token or ownership epoch before granting any audio permission',async()=>{
 const f=speechPolicy();await f.init();await f.complete();const held=await f.reserve();
 expect((await f.request({action:'commit',id:'task',completionId:'c1',token:'wrong-token',ownerEpoch:held.reservation.ownerEpoch})).committed).toBe(false);
 expect((await f.request({action:'commit',id:'task',completionId:'c1',token:held.reservation.token,ownerEpoch:held.reservation.ownerEpoch+1})).committed).toBe(false);
 expect((await f.commit(held)).committed).toBe(true);
});
it('does not resurrect a completion that settles after the master switch was turned off',async()=>{
 const f=speechPolicy();await f.init();await f.complete();await f.request({action:'configure',enabled:false});f.tasks.get('task')!.completionId='c2';
 await f.policy.settled('task','0.1.0','Completed while disabled',false);await f.request({action:'configure',enabled:true});
 expect((await f.request({action:'pending'})).items).toEqual([]);
});
it('rejects future completion times rather than extending their retention window',async()=>{
 const f=speechPolicy();await f.init();await f.complete();f.advance(-1);const result=await f.request({action:'pending'});
 expect(result.items).toEqual([]);expect(result.diagnostics).toContainEqual(expect.objectContaining({reason:'expired'}));
});
it('pins an eligible payload independently of the hundred-summary presentation cache',async()=>{
 const f=speechPolicy();await f.init();await f.complete('retained','c1','Answer\n\n```coffee-speech\n{"profile_version":"0.1.0","summary":"KEEP THIS BRIEF"}\n```');
 for(let n=0;n<101;n++){f.advance(1);await f.complete('waiting-'+n,'w'+n,'Choose\n\n```coffee-speech\n{"profile_version":"0.1.0","status":"awaiting_user"}\n```');}
 expect((await f.request({action:'summaries',id:'retained'})).items).toEqual([]);
 expect((await f.request({action:'pending'})).items).toMatchObject([{id:'retained',summary:'KEEP THIS BRIEF'}]);
});
it('bounds retained queue and diagnostic history while preserving durable overflow decisions',async()=>{
 const f=speechPolicy();await f.init();for(let n=0;n<115;n++){await f.complete('task-'+n);f.advance(1);}
 const pending=await f.request({action:'pending'});expect(pending.items.map((item:any)=>item.id)).toEqual(Array.from({length:10},(_,n)=>'task-'+(105+n)));expect(pending.diagnostics).toHaveLength(100);
 await f.request({action:'configure',enabled:false});await f.request({action:'configure',enabled:true});f.restart();expect((await f.request({action:'pending'})).items).toEqual([]);
});
