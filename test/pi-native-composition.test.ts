import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {RpcClient} from '@earendil-works/pi-coding-agent';
import {expect,it} from 'vitest';
import {resolveHostPiExtensions} from '../src/host/pi-extensions.js';

it('loads reviewed packages once and honors off without executing discovered extensions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-composition-'));const agent=join(root,'agent');await mkdir(agent);
 const rogue=join(root,'unreviewed.mjs');await writeFile(rogue,`export default pi=>pi.registerCommand('unexpected-extension',{handler:()=>{}})`);
 await writeFile(join(agent,'settings.json'),JSON.stringify({extensions:[rogue]}));
 const packages=resolveHostPiExtensions({PI_COFFEE_SUBAGENTS:'off',PI_COFFEE_WEB:'off',PI_COFFEE_LSP:'off',PI_COFFEE_HANDOFF:'off'});
 const c=new RpcClient({cliPath:resolve('node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),cwd:root,env:{PI_CODING_AGENT_DIR:agent,PI_OFFLINE:'1'},args:['--offline','--no-extensions',...packages.flatMap(p=>['-e',p])]});
 try{await c.start();const commands=(await c.getCommands()).map(c=>c.name);expect(commands.filter(n=>n==='harness')).toHaveLength(1);for(const n of ['unexpected-extension','lsp','handoff','subagents','websearch'])expect(commands).not.toContain(n);}finally{await c.stop();await rm(root,{recursive:true,force:true});}
});
