import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {execFileSync} from 'node:child_process';
it('backs up all configured stores, restores to a new directory, and rejects mutation/overwrite/live writers',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-backup-'));try{
 const source=join(root,'source');await mkdir(source);await writeFile(join(source,'state'),'original');await symlink('state',join(source,'link'));
 const config=join(root,'config.json'),snapshot=join(root,'snapshot'),restored=join(root,'restored');
 const cmd=(...args:string[])=>execFileSync('python3',[resolve('scripts/backup-state.py'),...args]);
 await writeFile(config,JSON.stringify({roots:{native:source},quiesceCheck:['python3','-c','raise SystemExit(1)']}));
 expect(()=>cmd('create','--config',config,'--destination',snapshot)).toThrow();
 await writeFile(config,JSON.stringify({roots:{native:source},quiesceCheck:['python3','-c','pass']}));
 cmd('create','--config',config,'--destination',snapshot);cmd('restore','--source',snapshot,'--destination',restored);
 expect(await readFile(join(restored,'native','state'),'utf8')).toBe('original');
 expect(()=>cmd('restore','--source',snapshot,'--destination',source)).toThrow();
 await writeFile(join(snapshot,'native','state'),'tampered');expect(()=>cmd('verify','--source',snapshot)).toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
});
