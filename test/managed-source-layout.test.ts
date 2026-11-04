import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {managedScopeLayout} from '../src/host/managed-source-layout.js';
import {ManagedNativeCustody} from '../src/host/managed-native.js';

it('the actual managed layout exposes own public native data while denying Host runner/GitHub credentials and another synthetic scope',async()=>{
 const root=await mkdtemp(join(tmpdir(),'managed-layout-')),own=managedScopeLayout(root,'awangs'),other=managedScopeLayout(root,'synthetic-other');for(const path of [own.scopeRoot,own.controlRoot,own.work,own.agentDir,own.home,own.githubAccounts,own.runners,other.work])await mkdir(path,{recursive:true,mode:0o700});
 const github=join(own.githubAccounts,'auth.json'),runner=join(own.runners,'runners.json'),neighbor=join(other.work,'private-note');await writeFile(github,'SYNTHETIC_GITHUB_TOKEN');await writeFile(runner,'SYNTHETIC_RUNNER_PASSWORD');await writeFile(neighbor,'SYNTHETIC_OTHER_SCOPE');await writeFile(join(own.agentDir,'models.json'),'PUBLIC_CATALOG_ONLY');
 const custody=new ManagedNativeCustody(join(root,'authority','custody'),{sourceParent:root,lock:join(root,'authority','group.lock'),sources:[{path:own.scopeRoot,destination:own.scopeRoot}],runtimeRoots:[dirname(dirname(process.execPath))],environment:{HOME:own.home,PI_CODING_AGENT_DIR:own.agentDir,PATH:'/usr/bin:/bin'},cwd:own.work});
 try{const program=`const fs=require('node:fs');const denied=path=>{try{fs.readFileSync(path);return false;}catch{return true;}};console.log(JSON.stringify({github:denied(${JSON.stringify(github)}),runner:denied(${JSON.stringify(runner)}),other:denied(${JSON.stringify(neighbor)}),catalog:fs.readFileSync(process.env.PI_CODING_AGENT_DIR+'/models.json','utf8')}));`,launch=await custody.prepare({executable:process.execPath,args:['-e',program]}),child=spawn(process.execPath,[launch.cliPath],{env:{PATH:process.env.PATH,...launch.env},stdio:['ignore','pipe','pipe']});let output='',errors='';child.stdout.on('data',chunk=>output+=String(chunk));child.stderr.on('data',chunk=>errors+=String(chunk));const [code]=await once(child,'exit');expect(code,errors).toBe(0);expect(JSON.parse(output)).toEqual({github:true,runner:true,other:true,catalog:'PUBLIC_CATALOG_ONLY'});
 }finally{await rm(root,{recursive:true,force:true});}
},15000);
