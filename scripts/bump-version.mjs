#!/usr/bin/env node
import {readFile,writeFile,rename,stat,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {checkedReleaseVersion,npmReleaseVersion} from './lib/release-version.mjs';
import {nextReleaseVersion} from '../src/shared/release-version.mjs';
const args=process.argv.slice(2),kind=args[0],index=args.indexOf('--repo'),repo=resolve(index<0?'.':args[index+1]);
try{
 if(!['small','large'].includes(kind)||args.some((v,i)=>i>0&&v!=='--repo'&&i!==index+1))throw Error('Usage: bump-version.mjs small|large [--repo path]');
 const previous=await checkedReleaseVersion(repo),version=nextReleaseVersion(previous,kind),npm=npmReleaseVersion(version),pending=[];
 for(const name of ['VERSION','package.json','package-lock.json']){
  const path=join(repo,name),original=await readFile(path,'utf8');let body=version+'\n';
  if(name!=='VERSION'){const value=JSON.parse(original);value.version=npm;if(name==='package-lock.json')value.packages[''].version=npm;body=JSON.stringify(value,null,2)+'\n';}
  pending.push({path,temp:path+'.'+randomUUID(),original,body,mode:(await stat(path)).mode&0o777});
 }
 try{
  for(const item of pending)await writeFile(item.temp,item.body,{mode:item.mode});
  for(const item of pending)await rename(item.temp,item.path);
 }catch(error){for(const item of pending)await writeFile(item.path,item.original,{mode:item.mode});throw error;}
 finally{for(const item of pending)await rm(item.temp,{force:true});}
 console.log(JSON.stringify({previous,version,npmVersion:npm,kind}));
}catch{console.error('Version update refused: choose small/large and keep VERSION/package metadata consistent.');process.exitCode=1;}
