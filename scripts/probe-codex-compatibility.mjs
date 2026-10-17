// Read-only native qualification: no login, thread creation, model request or compaction.
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {CodexAppServer} from '../dist/src/host/codex/rpc.js';
const exec=promisify(execFile),cli=process.argv[2];
if(!cli)throw Error('Usage: node scripts/probe-codex-compatibility.mjs /absolute/path/to/codex');
const home=await mkdtemp(join(tmpdir(),'coffee-codex-qualification-'));
const rpc=new CodexAppServer({cliPath:resolve(cli),args:['app-server'],cwd:home,env:{PATH:process.env.PATH,HOME:home,CODEX_HOME:home}});
try{
 const {stdout:version}=await exec(cli,['--version'],{timeout:10000});
 await exec(cli,['app-server','generate-json-schema','--out',join(home,'schema')],{timeout:30000,env:{PATH:process.env.PATH,HOME:home,CODEX_HOME:home}});
 const schema=await readFile(join(home,'schema','codex_app_server_protocol.schemas.json'),'utf8');
 for(const method of ['thread/compact/start','turn/steer','thread/resume','thread/tokenUsage/updated'])if(!schema.includes(method))throw Error('Native protocol missing '+method);
 await rpc.start('pi-coffee-qualification','1');
 const models=await rpc.request('model/list',{},10000),skills=await rpc.request('skills/list',{cwds:[home],forceReload:true},10000);
 if(!Array.isArray(models.data)||!Array.isArray(skills.data))throw Error('Unexpected native metadata shape');
 console.log(JSON.stringify({pass:true,version:version.trim(),modelCount:models.data.length,skillsCatalog:true,modelTurns:0,scope:'isolated metadata/schema; not provider or compaction acceptance'}));
}finally{await rpc.stop();await rm(home,{recursive:true,force:true});}
