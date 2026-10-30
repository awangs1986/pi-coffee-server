/** Produce a standalone, dependency-free Linux recovery CLI directory after build. */
import {mkdir,cp,readFile,writeFile,lstat,readdir,open} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {RESTIC_PIN} from '../dist/src/host/backup-repository.js';
const args=process.argv.slice(2),options=new Map();
for(let i=0;i<args.length;i+=2){if(!['--output','--restic'].includes(args[i])||!args[i+1]||options.has(args[i]))throw Error('Use --output NEW_DIRECTORY --restic PINNED_BINARY');options.set(args[i],args[i+1]);}
if(!options.has('--output')||!options.has('--restic'))throw Error('Output and pinned Restic required');
const output=resolve(options.get('--output')),binary=resolve(options.get('--restic'));
if(!await lstat(binary).then(s=>s.isFile()&&!s.isSymbolicLink())||createHash('sha256').update(await readFile(binary)).digest('hex')!==RESTIC_PIN.sha256)throw Error('Restic pin mismatch');
await mkdir(output,{mode:0o700});
await cp('dist/src',join(output,'src'),{recursive:true,errorOnExist:true,force:false});
await cp(binary,join(output,'restic'),{errorOnExist:true,force:false});
await cp('docs/deployment/personal-backup.md',join(output,'README.md'));
await writeFile(join(output,'package.json'),JSON.stringify({type:'module',engines:{node:'>=22.19.0 <23'}})+'\n');
const files={};async function walk(path,relative=''){for(const name of (await readdir(path)).sort()){const key=relative?relative+'/'+name:name,file=join(path,name),info=await lstat(file);if(info.isDirectory())await walk(file,key);else if(info.isFile())files[key]=createHash('sha256').update(await readFile(file)).digest('hex');else throw Error('Unexpected bundle entry');}}await walk(output);
const release=JSON.parse(await readFile('dist/public/release-manifest.json','utf8'));
const manifest={schema:1,release,version:(await readFile('VERSION','utf8')).trim(),node:process.versions.node,platform:process.platform,arch:process.arch,restic:RESTIC_PIN,requirements:['Node 22','Python 3','systemd user manager','ionice','matching Gitea binary and service commands for Gitea restoration'],files};
const file=await open(join(output,'recovery-manifest.json'),'wx',0o600);try{await file.writeFile(JSON.stringify(manifest,null,2)+'\n');await file.sync();}finally{await file.close();}
console.log(JSON.stringify({packaged:true,version:manifest.version,files:Object.keys(files).length}));
