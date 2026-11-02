import {expect,it} from 'vitest';
import {speechHttp} from './helpers/speech-http.js';
it('recovers a lost reservation response without consuming the result and grants audio permission only once',async()=>{
 const f=await speechHttp();
 try{
  const body={browserId:'browser-one',pageId:'page-one',id:'task',completionId:f.completionId,operationId:'reserve-one'};
  const lost=await f.call({action:'reserve',...body});expect(lost.status).toBe(200);expect(lost.body.reserved).toBe(true);
  const recovered=await f.call({action:'reserve',...body});expect(recovered.body.reservation.token).toBe(lost.body.reservation.token);
  const pending=await f.call({action:'pending',browserId:'browser-one',pageId:'page-one'});expect(pending.body.items).toHaveLength(1);
  const commit={action:'commit',...body,operationId:'commit-one',token:recovered.body.reservation.token,ownerEpoch:recovered.body.reservation.ownerEpoch};
  expect((await f.call(commit)).body.committed).toBe(true);expect((await f.call(commit)).body.committed).toBe(false);
  await f.restart();const restarted=await f.call({action:'pending',browserId:'browser-one',pageId:'page-one'});
  expect(restarted.body.items).toEqual([]);expect(restarted.body.diagnostics).toMatchObject([{state:'uncertain'}]);
 }finally{await f.close();}
});
it('speaks once after a lost reservation response recovers through the public Host interface',async()=>{
 const {createSpeechController}=await import('../packages/completion-speech/browser.js');
 const f=await speechHttp();let lost=true,spoken=0;
 const controller=createSpeechController({request:async(body:any)=>{const r=await f.call(body);if(r.status!==200)throw Object.assign(Error(r.body.error),{status:r.status,code:r.body.code});if(body.action==='reserve'&&lost){lost=false;throw new TypeError('Response lost after reservation persisted');}return r.body;},context:()=>({user:'alice'}),browserId:'browser-one',speech:{cancel(){},async speak(){spoken++;}}});
 try{await controller.poll();await controller.poll();expect(spoken).toBe(1);}finally{controller.close();await f.close();}
});
it('rejects legacy queue consumers while advertising the separately versioned protocol',async()=>{
 const f=await speechHttp();try{
  expect((await f.call({action:'status',protocol:undefined})).body.protocolVersion).toBe(2);
  const legacy=await f.call({action:'pending',protocol:undefined,browserId:'browser-one'});
  expect(legacy.status).toBe(426);expect(legacy.body.code).toBe('protocol_mismatch');
  expect((await f.call({action:'pending',browserId:'browser-one',pageId:'page-one'})).body.items).toHaveLength(1);
 }finally{await f.close();}
});
it('migrates consumed legacy state with a private rollback copy and never automatically replays it',async()=>{
 const {readFile,stat}=await import('node:fs/promises');const f=await speechHttp({legacyConsumed:true});try{
  const result=await f.call({action:'pending',browserId:'browser-one',pageId:'page-one'});
  expect(result.body.items).toEqual([]);expect(result.body.diagnostics).toContainEqual(expect.objectContaining({state:'uncertain',reason:'legacy-consumed'}));
  const backup=f.statePath+'.v1-backup';expect(JSON.parse(await readFile(backup,'utf8')).attempts.task).toBe(f.completionId);expect((await stat(backup)).mode&0o777).toBe(0o600);
  await f.restart();expect((await f.call({action:'pending',browserId:'browser-one',pageId:'page-one'})).body.items).toEqual([]);
 }finally{await f.close();}
});
it.each(['commit','finish'])('a lost %s response never invokes sound twice, including Host restart',async(action)=>{
 const {createSpeechController}=await import('../packages/completion-speech/browser.js');const f=await speechHttp();let lost=true,spoken=0;
 const controller=createSpeechController({request:async(body:any)=>{const r=await f.call(body);if(body.action===action&&lost){lost=false;throw new TypeError('Lost persisted response');}return r.body;},context:()=>({user:'alice'}),browserId:'browser-one',speech:{cancel(){},async speak(){spoken++;}}});
 try{await controller.poll();await controller.poll();await controller.poll();expect(spoken).toBe(action==='commit'?0:1);controller.close();await f.restart();
  const result=(await f.call({action:'pending',browserId:'browser-one',pageId:'page-new'})).body;expect(result.items).toEqual([]);expect(result.diagnostics).toContainEqual(expect.objectContaining({state:action==='commit'?'uncertain':'played'}));
 }finally{controller.close();await f.close();}
});
it('reconciles its own lost commit as uncertain so explicit replay is available without waiting for the playback lease',async()=>{
 const {createSpeechController}=await import('../packages/completion-speech/browser.js');const f=await speechHttp();let lose=true,spoken=0;
 const controller=createSpeechController({request:async(body:any)=>{const result=await f.call(body);if(body.action==='commit'&&lose){lose=false;throw new TypeError('Lost commit reply');}return result.body;},context:()=>({user:'alice'}),browserId:'browser-one',speech:{cancel(){},async speak(){spoken++;}}});
 try{await controller.poll();await controller.poll();expect(spoken).toBe(0);expect(await controller.replay('task',f.completionId)).toBe(true);expect(spoken).toBe(1);}finally{controller.close();await f.close();}
});
