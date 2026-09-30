#!/usr/bin/env node
import {dirname,resolve,basename} from 'node:path';
import {RunnerManager} from './runners.js';
const args=process.argv.slice(2);
async function main(){
 if(args.shift()!=='--config')throw new Error('Usage: node runner-cli.js --config /absolute/path/runners.json list|exec|upload|download ...');
 const config=args.shift();if(!config||basename(config)!=='runners.json')throw new Error('Specify runners.json');
 const manager=new RunnerManager(dirname(resolve(config))),action=args.shift();
 if(action==='list'){console.log(JSON.stringify(await manager.list(),null,2));return;}
 const id=args.shift();if(!id)throw new Error('Specify a runner id');
 let operation:import('./runner-ssh.js').RunnerOperation;
 if(action==='exec'){if(args.shift()!=='--'||args.length!==1)throw new Error('exec <id> -- <one quoted shell command>');operation={kind:'exec',command:args[0]};}
 else if((action==='upload'||action==='download')&&args.length===2)operation={kind:action,local:args[action==='upload'?0:1],remote:args[action==='upload'?1:0]};
 else throw new Error('Use list, exec, upload or download');
 const result=await manager.run(id,operation);process.stdout.write(result.stdout);process.stderr.write(result.stderr);process.exitCode=result.code;
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Runner operation failed');process.exitCode=1;});
