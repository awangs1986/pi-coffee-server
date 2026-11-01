import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,chmod,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {CodexSessionFactory} from '../src/host/codex-adapter.js';

it('keeps native mode instructions and a stable speech slot without changing the native thread, model or effort',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-codex-speech-')),cli=join(root,'codex'),factories:CodexSessionFactory[]=[];
 await writeFile(cli,`#!/bin/sh\nexec "${process.execPath}" "${fileURLToPath(new URL('./fixtures/fake-codex-app-server.mjs',import.meta.url))}" "$@"\n`);await chmod(cli,0o755);await mkdir(join(root,'work'));
 const factory=()=>{const f=new CodexSessionFactory({cwd:join(root,'work'),codexHome:join(root,'native'),cliPath:cli,model:'gpt-fake',reasoningEffort:'medium'});factories.push(f);return f;};
 try{
  const session=await factory().create({sessionId:'speech-slot'});
  const set=(s:any,text?:string)=>s.setTurnInstructions(text);
  const turn=async(s:any)=>{await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('turn timeout')),3000);const unsub=s.onEvent((e:any)=>{if(e.type==='agent_settled'){clearTimeout(timer);unsub();resolve();}});s.prompt('report speech instructions').catch(reject);});const history=await s.getHistory();return JSON.parse(history.entries.filter((e:any)=>e.kind==='assistant').at(-1).text);};
  await set(session,'FIXED_SPEECH_0.1.0');const first=await turn(session);
  expect(first).toMatchObject({mode:'default',model:'gpt-fake',effort:'medium',instructions:'NATIVE_DEFAULT\n\nFIXED_SPEECH_0.1.0',acquisitions:2});
  await set(session,'FIXED_SPEECH_0.1.0');const second=await turn(session);
  expect(second).toEqual(first);
  await session.runCommand!('plan','on');await set(session,'FIXED_SPEECH_0.1.0');const plan=await turn(session);
  expect(plan).toMatchObject({threadId:first.threadId,mode:'plan',instructions:'NATIVE_PLAN\n\nFIXED_SPEECH_0.1.0',acquisitions:4});
  await set(session);const disabled=await turn(session);expect(disabled).toMatchObject({threadId:first.threadId,mode:'plan',instructions:'NATIVE_PLAN'});
  await session.stop();const resumed=await factory().create({sessionId:'speech-slot'});await set(resumed,'FIXED_SPEECH_0.1.0');const after=await turn(resumed);
  expect(after).toMatchObject({threadId:first.threadId,model:'gpt-fake',effort:'medium',mode:'plan',instructions:'NATIVE_PLAN\n\nFIXED_SPEECH_0.1.0'});
 }finally{for(const f of factories)await f.close();await rm(root,{recursive:true,force:true});}
});
