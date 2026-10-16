import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {it,expect} from 'vitest';

it.each(['success','source-fence','target-verify','target-fence','source-status'])(
 'migration preserves single active Web through %s',async fault=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-migrate-'));
 try{
 const fixture=join(root,'control.py');
 await writeFile(fixture,`import json,sys,pathlib
root=pathlib.Path(sys.argv[1]);side,op=sys.argv[2:];p=root/'world.json';w=json.loads(p.read_text())
w['events'].append(side+':'+op)
fault=w['fault']
if op=='fence' and side+'-fence'!=fault:w[side]={'active':False,'fenced':True}
if op=='activate':
 other='target' if side=='source' else 'source'
 assert not w[other]['active'],'DUAL WEB'
 w[side]={'active':True,'fenced':False}
p.write_text(json.dumps(w))
if side+'-'+op==fault:sys.exit(1)
if op=='status':print(json.dumps(w[side]))
`);
 await writeFile(join(root,'world.json'),JSON.stringify({source:{active:true,fenced:false},target:{active:false,fenced:true},events:[],fault:fault==='success'?'':fault}));
 const cfg=Object.fromEntries(['source','target'].map(side=>[side,Object.fromEntries(['preflight','status','fence','activate','verify'].map(op=>[op,['python3',fixture,root,side,op]]))]));
 const config=join(root,'config.json');await writeFile(config,JSON.stringify(cfg));
 const args=[resolve('scripts/migrate-web.py'),'--config',config,'--state-dir',join(root,'state'),'migrate'];
 let failed=false;try{execFileSync('python3',args);}catch{failed=true;}
 const world=JSON.parse(await readFile(join(root,'world.json'),'utf8'));
 expect(world.source.active&&world.target.active).toBe(false);
 if(fault==='success'){
 expect(failed).toBe(false);expect(world.target.active).toBe(true);expect(world.source.fenced).toBe(true);
 expect(world.events.indexOf('source:fence')).toBeLessThan(world.events.indexOf('target:activate'));
 execFileSync('python3',args); // completed runs are idempotent
 }else if(fault==='target-fence'){
 // No fault is reached on the success path; explicit rollback must fail closed.
 expect(failed).toBe(false);
 expect(()=>execFileSync('python3',[...args.slice(0,-1),'rollback'])).toThrow();
 const after=JSON.parse(await readFile(join(root,'world.json'),'utf8'));
 expect(after.source.active).toBe(false);expect(after.target.active).toBe(true);
 }else{
 expect(failed).toBe(true);expect(world.target.active).toBe(false);
 expect(world.source.active).toBe(true);
 }
 }finally{await rm(root,{recursive:true,force:true});}
});
