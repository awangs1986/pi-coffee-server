import {SessionManager} from '@earendil-works/pi-coding-agent';
import {fileURLToPath} from 'node:url';
import {readFile,realpath,lstat,readdir} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';

// A real pinned native SDK reader, not an Agent session or provider turn.
// Hold the supervised process until Host persists its observation, so the
// terminal custody receipt can seal it before the shared lock is released.
try {
 const modulePath=fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'));
 const sdk=JSON.parse(await readFile(join(dirname(modulePath),'..','package.json'),'utf8'));
 if(!['1.1.0','1.4.0'].includes(sdk.version))throw Error('Unqualified native SDK');
 const root=resolve(process.argv[2]),nativeId=process.argv[3],expectedCwd=resolve(process.argv[4]);
 if(await realpath(root)!==root)throw Error('Native source root is not canonical');
 async function inspect(path){const info=await lstat(path);if(info.isSymbolicLink()||info.uid!==process.getuid())throw Error('Native source is not owned');if(info.isDirectory()){for(const name of await readdir(path))await inspect(join(path,name));}else if(!info.isFile()||path.endsWith('.jsonl')&&info.size>64*1024*1024)throw Error('Native audit budget or source shape refused');}
 // Validate scope before the native listing API reads any history. No symlink
 // can redirect this account's reader to a different source root.
 await inspect(root);const matches=(await SessionManager.listAll(root)).filter(row=>row.id===nativeId);if(matches.length!==1)throw Error('Native history binding unavailable');
 const file=await realpath(matches[0].path);
 const originalHeader=JSON.parse((await readFile(file,'utf8')).split('\n')[0]);if(originalHeader.type!=='session'||originalHeader.version!==3)throw Error('Native audit cannot migrate a source');
 if(resolve(originalHeader.cwd)!==expectedCwd)throw Error('Native history ownership changed');
 const session=SessionManager.open(file),header=session.getHeader(),entries=session.getEntries();
 const lines=createInterface({input:process.stdin});const acknowledged=new Promise(resolve=>{lines.once('line',resolve);lines.once('close',()=>resolve('cancel'));});
 process.stdout.write(JSON.stringify({schema:1,sdkVersion:sdk.version,sessionId:session.getSessionId(),sourceFile:file,cwd:header?.cwd,entryCount:entries.length,entriesDigest:createHash('sha256').update(JSON.stringify(entries)).digest('hex')})+'\n');
 await acknowledged;lines.close();
} catch {process.stderr.write('Native Pi SDK audit unavailable\n');process.exitCode=1;}
