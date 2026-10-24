import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {RpcClient} from '@earendil-works/pi-coding-agent';
import {expect,it} from 'vitest';
import {resolveHostPiExtensions} from '../src/host/pi-extensions.js';

it('loads one native xAI OAuth provider beside Coffee and official web without conflicts and honors off',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-xai-')),agent=join(root,'agent');await mkdir(agent);
 const packages=resolveHostPiExtensions({PI_COFFEE_XAI_OAUTH:'on'});
 expect(packages.filter(p=>p.endsWith('/pi-xai-oauth'))).toHaveLength(1);
 expect(resolveHostPiExtensions({PI_COFFEE_XAI_OAUTH:'off'}).some(p=>p.endsWith('/pi-xai-oauth'))).toBe(false);
 const observer=join(root,'observer.mjs'),catalog=join(root,'catalog.json');
 await writeFile(observer,`import {writeFileSync} from 'node:fs';export default pi=>pi.registerCommand('probe-catalog',{handler:(_,ctx)=>writeFileSync(${JSON.stringify(catalog)},JSON.stringify(ctx.modelRegistry.getAll().map(m=>({provider:m.provider,id:m.id}))))});`);
 const c=new RpcClient({cliPath:resolve('node_modules/.bin/pi'),cwd:root,env:{PI_CODING_AGENT_DIR:agent,PI_OFFLINE:'1'},args:['--offline','--no-extensions',...packages.flatMap(p=>['-e',p]),'-e',observer]});
 const errors:unknown[]=[];c.onEvent(e=>{if(e.type==='extension_error')errors.push(e);});
 try {
  await c.start();await c.getState();
  const names=(await c.getCommands()).map(c=>c.name);
  for(const name of ['harness','lsp','handoff','xai-tools','xai-usage'])expect(names.filter(n=>n===name)).toHaveLength(1);
  await c.prompt('/probe-catalog');await c.getState();
  expect(JSON.parse(await readFile(catalog,'utf8')).some((m:{provider:string})=>m.provider==='xai-auth')).toBe(true);
  expect(errors).toEqual([]);
 }finally{await c.stop();await rm(root,{recursive:true,force:true});}
},30000);
