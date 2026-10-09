import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,resolve,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(join(root,'package.json'));
const agentDir=process.argv[2];
if(!agentDir || !isAbsolute(agentDir))throw Error('Usage: node scripts/configure-native-pi.mjs /absolute/agent-directory');
await mkdir(agentDir,{recursive:true,mode:0o700});
const cli=fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent')).replace(/index\.js$/,'cli.js');
const roots=['pi-subagents','pi-web-access','pi-coffee-harness','pi-coffee-lsp','context-handoff'].map(name=>name==='pi-subagents'?dirname(require.resolve(name)):dirname(require.resolve(name+'/package.json')));
const env={...process.env,PI_CODING_AGENT_DIR:agentDir,PI_OFFLINE:'1'};
const configured=async file=>{try{return JSON.parse(await readFile(join(agentDir,file),'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw e;}};
const settings=await configured('settings.json'),auth=await configured('auth.json'),models=await configured('models.json');
const legacy='azure-openai-responses';
const rename=(entries,from,to,file)=>{
 if(!entries || !Object.hasOwn(entries,from))return false;
 if(Object.hasOwn(entries,to) && !isDeepStrictEqual(entries[from],entries[to]))throw Error(`Conflicting Azure entries in ${file}; reconcile them before upgrading. No native configuration was changed.`);
 entries[to]=entries[from];delete entries[from];return true;
};
// Preflight every rename before backups, package registration or file writes.
// The provider name changes; the azure-openai-responses API identifier does not.
const authChanged=rename(auth,legacy,'azure','auth.json');
const modelsChanged=rename(models.providers,legacy,'azure','models.json');
if(settings.defaultProvider===legacy)settings.defaultProvider='azure';
const providerReference=value=>typeof value==='string' && (value===legacy || value.startsWith(legacy+'/'))?'azure'+value.slice(legacy.length):value;
if(Array.isArray(settings.enabledModels))settings.enabledModels=settings.enabledModels.map(providerReference);
for(const key of Object.keys(settings.modelThinkingLevels??{})){
 const renamed=providerReference(key);if(renamed!==key)rename(settings.modelThinkingLevels,key,renamed,'settings.json modelThinkingLevels');
}
// Pi owns declarations, identity and discovery. Back up configuration before registering packages.
for(const file of ['settings.json','web-search.json','auth.json','models.json']){
 try{const data=await readFile(join(agentDir,file));await writeFile(join(agentDir,file+'.before-pi104'),data,{flag:'wx',mode:0o600});}
 catch(e){if(!['ENOENT','EEXIST'].includes(e.code))throw e;}
}
if(authChanged)await writeFile(join(agentDir,'auth.json'),JSON.stringify(auth,null,2)+'\n',{mode:0o600});
if(modelsChanged)await writeFile(join(agentDir,'models.json'),JSON.stringify(models,null,2)+'\n',{mode:0o600});
await writeFile(join(agentDir,'settings.json'),JSON.stringify(settings,null,2)+'\n',{mode:0o600});
const filters=new Map();
const owned=new Set(['pi-coffee','pi-coffee-harness','pi-coffee-lsp','context-handoff','pi-subagents','pi-web-access']);
// Retire only explicit extension files owned by replaced Coffee/upstream packages.
// Other user extensions remain configured; Host executes only its explicit roots.
const retained=[];
for(const value of settings.extensions??[]){
 let candidate=resolve(agentDir,value),owner;
 try{if(!(await stat(candidate)).isDirectory())candidate=dirname(candidate);}catch{}
 while(candidate!==dirname(candidate)){
  try{owner=JSON.parse(await readFile(join(candidate,'package.json'),'utf8')).name;break;}catch{}
  candidate=dirname(candidate);
 }
 if(!owned.has(owner))retained.push(value);
}
if(settings.extensions){settings.extensions=retained;await writeFile(join(agentDir,'settings.json'),JSON.stringify(settings,null,2)+'\n',{mode:0o600});}
for(const entry of settings.packages??[]){
 const source=typeof entry==='string'?entry:entry.source;let name;
 if(source.startsWith('npm:'))name=source.slice(4).replace(/@[^@/]+$/,'');
 else{try{name=JSON.parse(await readFile(join(resolve(agentDir,source),'package.json'),'utf8')).name;}catch{}}
 if(owned.has(name)){if(typeof entry==='object')filters.set(name,entry);execFileSync(process.execPath,[cli,'remove',source.startsWith('npm:')?source:resolve(agentDir,source)],{cwd:root,env,stdio:'pipe'});}
}
for(const path of roots)execFileSync(process.execPath,[cli,'install',path],{cwd:root,env,stdio:'pipe'});
const updated=await configured('settings.json');
updated.packages=(updated.packages??[]).map(entry=>{
 const source=typeof entry==='string'?entry:entry.source;
 const rootPath=resolve(agentDir,source);
 if(!roots.includes(rootPath))return entry;
 const name=require(join(rootPath,'package.json')).name,prior=filters.get(name);
 return prior?{...prior,source}:entry;
});
await writeFile(join(agentDir,'settings.json'),JSON.stringify(updated,null,2)+'\n',{mode:0o600});
const web=await configured('web-search.json');
// Preserve credentials/provider choices; explicitly select the reviewed output/activation policy.
web.toolActivation='dynamic';web.maxInlineContentChars=6000;web.workflow='none';
await writeFile(join(agentDir,'web-search.json'),JSON.stringify(web,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({agentDir,pi:execFileSync(process.execPath,[cli,'--version'],{env,encoding:'utf8'}).trim(),packages:roots.map(p=>JSON.parse(require('node:fs').readFileSync(join(p,'package.json'),'utf8'))).map(p=>({name:p.name,version:p.version})),policy:{toolActivation:'dynamic',maxInlineContentChars:6000,workflow:'none'}},null,2));
