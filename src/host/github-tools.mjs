// Invoked only by task-local Git/gh wrappers. Read credentials afresh on each call.
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';
const [mode,file,id,program,...args]=process.argv.slice(2);
try {
  if(mode==='credential'||mode==='gitea'){
    if(program!=='get')process.exit(0);
    const fields=Object.fromEntries(readFileSync(0,'utf8').split('\n').filter(s=>s.includes('=')).map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
    if(mode==='gitea'){
      const gitea=JSON.parse(readFileSync(file,'utf8')).gitea;if(!gitea)process.exit(0);
      const target=new URL(gitea.url);if(fields.host!==target.host||fields.protocol!==target.protocol.slice(0,-1))process.exit(0);
      process.stdout.write('username='+gitea.owner+'\npassword='+gitea.token+'\n\n');process.exit(0);
    }
    if(fields.protocol!=='https'||fields.host!=='github.com')process.exit(0);
  }
  if(mode==='git'){
    const transport=JSON.parse(readFileSync(join(dirname(file),'transport.json'),'utf8'));
    const identity=Object.entries(transport.identity??{}).flatMap(([k,v])=>['-c',k+'='+v]);
    const env={...process.env,HOME:process.env.GH_CONFIG_DIR,XDG_CONFIG_HOME:process.env.GH_CONFIG_DIR};
    const network=args.some(arg=>['clone','fetch','push','pull','ls-remote'].includes(arg));
    if(network){
      const prefix=[];
      for(let i=0;i<args.length;i++){
        if(['-C','-c','--git-dir','--work-tree'].includes(args[i])){prefix.push(args[i],args[++i]);continue;}
        if(args[i].startsWith('--git-dir=')||args[i].startsWith('--work-tree=')){prefix.push(args[i]);continue;}
        if(!args[i].startsWith('-'))break;
      }
      const remotes=spawnSync(program,[...prefix,'config','--local','--get-regexp','^remote\\..*\\.url$'],{env,encoding:'utf8'}).stdout??'';
      const github=args.some(arg=>/github\.com[/:]/i.test(arg))||/github\.com[/:]/i.test(remotes);
      if(id||github){const state=JSON.parse(readFileSync(file,'utf8'));if(state.version!==1||!state.accounts.some(a=>a.id===id&&a.token))throw Error();}
      // Old checkouts may contain credential-bearing headers saved by CI/tools.
      // Fail visibly instead of allowing a local header to outrank the selected helper.
      const local=spawnSync(program,[...prefix,'config','--local','--get-regexp','^http\\..*extraheader$'],{env:{...env,GIT_CONFIG_COUNT:'0'},encoding:'utf8'}).stdout??'';
      if(github&&local.trim()){process.stderr.write('Remove legacy repository HTTP authentication headers before using managed GitHub authorization.\n');process.exit(1);}
    }
    const result=spawnSync(program,[...identity,...args],{env,stdio:'inherit'});process.exit(result.status??1);
  }
  const state=JSON.parse(readFileSync(file,'utf8'));
  const account=state.version===1&&state.accounts.find(a=>a.id===id);
  if(!account?.token)throw Error();
  if(mode==='credential'||mode==='gitea'){
    process.stdout.write('username=x-access-token\npassword='+account.token+'\n\n');
  }else if(mode==='gh'){
    if(args[0]==='auth'&&(args[1]!=='status'||args.includes('--show-token'))){process.stderr.write('Manage GitHub authorization in PI Coffee, not gh auth.\n');process.exit(1);}
    const env={...process.env,GH_TOKEN:account.token,GITHUB_TOKEN:account.token,GH_HOST:'github.com'};
    const result=spawnSync(program,args,{env,stdio:'inherit'});process.exit(result.status??1);
  }else throw Error();
}catch{process.stderr.write('GitHub authorization is missing or disconnected. Connect/select an account in PI Coffee.\n');process.exit(1);}
