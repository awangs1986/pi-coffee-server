import {it,expect} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile);
it.each([['0.11','small','0.12','0.12.0'],['0.11','large','0.21','0.21.0'],['0.99','small','1.00','1.0.0'],['1.05','large','1.15','1.15.0']])('bumps %s with %s through the public CLI and preserves unrelated metadata',async(before,kind,after,npm)=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-version-'));
 try{
  const initial=before==='0.99'?'0.99.0':before==='1.05'?'1.5.0':'0.11.0';
  await writeFile(join(root,'VERSION'),before+'\n');await writeFile(join(root,'package.json'),JSON.stringify({name:'fixture',version:initial,scripts:{check:'keep'}}));await writeFile(join(root,'package-lock.json'),JSON.stringify({version:initial,packages:{'':{version:initial},'node_modules/fixture':{version:'9.9.9'}}}));
  const result=await exec(process.execPath,[resolve('scripts/bump-version.mjs'),kind,'--repo',root]);expect(JSON.parse(result.stdout)).toMatchObject({previous:before,version:after});
  expect((await readFile(join(root,'VERSION'),'utf8')).trim()).toBe(after);expect(JSON.parse(await readFile(join(root,'package.json'),'utf8'))).toMatchObject({version:npm,scripts:{check:'keep'}});expect(JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'))).toMatchObject({version:npm,packages:{'':{version:npm},'node_modules/fixture':{version:'9.9.9'}}});
 }finally{await rm(root,{recursive:true,force:true});}
});
it('refuses inconsistent metadata without editing any version source',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-version-invalid-'));
 try{await writeFile(join(root,'VERSION'),'0.11\n');const bytes=JSON.stringify({version:'7.8.0'});await writeFile(join(root,'package.json'),bytes);await writeFile(join(root,'package-lock.json'),JSON.stringify({version:'7.8.0',packages:{'':{version:'7.8.0'}}}));await expect(exec(process.execPath,[resolve('scripts/bump-version.mjs'),'small','--repo',root])).rejects.toThrow();expect(await readFile(join(root,'VERSION'),'utf8')).toBe('0.11\n');expect(await readFile(join(root,'package.json'),'utf8')).toBe(bytes);}finally{await rm(root,{recursive:true,force:true});}
});
