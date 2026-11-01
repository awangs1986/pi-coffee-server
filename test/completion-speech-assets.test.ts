import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {WebServer} from '../src/web/server.js';

it('serves the optional speech browser modules through the real Web asset boundary without exposing arbitrary package paths',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-speech-assets-'));const plugin=join(root,'plugins','completion-speech');await mkdir(plugin,{recursive:true});
 for(const file of ['browser.js','presentation.js','private.js'])await writeFile(join(plugin,file),`export const moduleName=${JSON.stringify(file)};`);
 const web=new WebServer({host:'127.0.0.1',port:0,hostUrl:'ws://127.0.0.1:1/host',publicDir:root,allowUnauthenticated:true});await web.start();
 try{
  const base=`http://127.0.0.1:${web.address().port}`;
  for(const name of ['browser.js','presentation.js']){const response=await fetch(base+'/plugins/completion-speech/'+name);expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain('javascript');expect(await response.text()).toContain(name);}
  expect((await fetch(base+'/plugins/completion-speech/private.js')).status).toBe(404);
  expect((await fetch(base+'/plugins/another-plugin/browser.js')).status).toBe(404);
 }finally{await web.close();await rm(root,{recursive:true,force:true});}
});
