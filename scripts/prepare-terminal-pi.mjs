import {mkdir,readFile,writeFile,cp,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dirname,resolve,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
const source=resolve(dirname(fileURLToPath(import.meta.url)),'..'),destination=process.argv[2];
if(!destination || !isAbsolute(destination))throw Error('Usage: node scripts/prepare-terminal-pi.mjs /absolute/new-runtime-directory');
try{await access(destination);throw Error('Choose a new directory; existing runtime directories are never overwritten');}catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir(destination,{recursive:true,mode:0o700});
const manifest=JSON.parse(await readFile(join(source,'package.json'),'utf8'));
const names=['@earendil-works/pi-coding-agent','@earendil-works/pi-agent-core','@earendil-works/pi-ai','@earendil-works/pi-tui','typebox','pi-coffee-harness','pi-coffee-lsp','context-handoff','pi-web-access','pi-subagents'];
// Older source trees used vendored file dependencies; immutable package artifacts need no vendor directory.
if(names.some(name=>manifest.dependencies[name]?.startsWith('file:vendor/')))await cp(join(source,'vendor'),join(destination,'vendor'),{recursive:true});
await writeFile(join(destination,'package.json'),JSON.stringify({name:'coffee-reviewed-terminal',private:true,type:'module',dependencies:Object.fromEntries(names.map(n=>[n,manifest.dependencies[n]])),overrides:manifest.overrides},null,2)+'\n');
execFileSync('npm',['install','--ignore-scripts','--no-fund'],{cwd:destination,stdio:'inherit'});
await mkdir(join(destination,'scripts'));
await cp(join(source,'scripts/configure-native-pi.mjs'),join(destination,'scripts/configure-native-pi.mjs'));
execFileSync(process.execPath,[join(destination,'scripts/configure-native-pi.mjs'),join(destination,'agent')],{stdio:'inherit'});
execFileSync(process.execPath,[join(destination,'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),'--version'],{stdio:'inherit'});
console.log('Prepared only. Select this runtime and the intended agent directory after review; no global PATH, credentials or services were changed.');
