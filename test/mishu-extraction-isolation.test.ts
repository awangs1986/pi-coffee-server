import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,symlink,access,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {runPiMemoryExtraction} from '../src/host/pi-memory-runner.js';
it.each(['existing-session','symlink-session','symlink-parent'] as const)('rejects a nonfresh extraction path before native startup (%s)',async(mode)=>{
 const root=await mkdtemp(join(tmpdir(),'mishu-extract-isolation-')),foreign=join(root,'foreign'),capture=join(root,'native-started.json');await mkdir(foreign);let sessionFile=join(root,'fresh.jsonl');
 try{if(mode==='existing-session')await writeFile(sessionFile,'{"type":"session","version":3,"id":"foreign-session"}\n');
  if(mode==='symlink-session'){await writeFile(join(foreign,'foreign.jsonl'),'FOREIGN_HISTORY_MUST_NOT_BE_READ');await symlink(join(foreign,'foreign.jsonl'),sessionFile);}
  if(mode==='symlink-parent'){await symlink(foreign,join(root,'linked-extractions'));sessionFile=join(root,'linked-extractions','fresh.jsonl');}
  await expect(runPiMemoryExtraction({cliPath:resolve('test/fixtures/memory-env-probe.mjs'),cwd:root,provider:'fake',model:'fake-mini',sessionFile,prompt:'Only current bounded evidence',signal:new AbortController().signal,env:{MEMORY_TEST_ENV_CAPTURE:capture}})).rejects.toThrow();
  await expect(access(capture)).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
},10000);
