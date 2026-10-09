import {githubToken} from './github-token.mjs';
// Invoked only by task-local Git/gh wrappers. Read credentials afresh on each call.
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const [mode,file,id,program,...args]=process.argv.slice(2);
// Resolve transport through Git itself (including remote push URLs and URL
// rewrites). These probes are config-only and never contact a remote.
function gitNetworkTargets(program, args, env) {
  const prefix=[];let i=0;
  const globals=new Set(['-C','-c','--git-dir','--work-tree','--namespace','--config-env','--super-prefix']);
  while(i<args.length && args[i].startsWith('-')) {
    const arg=args[i++];prefix.push(arg);
    if(globals.has(arg)&&i<args.length)prefix.push(args[i++]);
  }
  const command=args[i++],rest=args.slice(i);
  if(!['clone','fetch','pull','push','ls-remote'].includes(command))return {prefix,urls:[]};
  if(command==='ls-remote'&&rest.includes('--get-url'))return {prefix,urls:[]};
  const fetchValues=['--upload-pack','--depth','--shallow-since','--shallow-exclude','--deepen','--filter','-j','--jobs','--negotiation-tip','--refmap','-o','--server-option','--recurse-submodules-default'];
  const options={
    clone:['-b','--branch','-o','--origin','-u','--upload-pack','--template','--reference','--reference-if-able','--separate-git-dir','--depth','--shallow-since','--shallow-exclude','--filter','-j','--jobs','-c','--config','--server-option','--bundle-uri','--revision'],
    fetch:fetchValues,
    pull:[...fetchValues,'-s','--strategy','-X','--strategy-option','--cleanup'],
    push:['--receive-pack','--exec','-o','--push-option'],
    'ls-remote':['--upload-pack','-o','--server-option'],
  };
  const values=new Set(options[command]);
  const positional=[];let repo,all=false,multiple=false,literal=false;
  for(let n=0;n<rest.length;n++) {
    const arg=rest[n];
    if(literal){positional.push(arg);continue;}
    if(arg==='--'){literal=true;continue;}
    if(command==='clone'&&(arg==='-c'||arg==='--config')){prefix.push('-c',rest[++n]);continue;}
    if(command==='clone'&&(arg.startsWith('--config=')||arg.startsWith('-c')&&arg.length>2)){prefix.push('-c',arg.startsWith('--config=')?arg.slice(9):arg.slice(2));continue;}
    if(arg==='--repo'){repo=rest[++n];continue;}
    if(arg.startsWith('--repo=')){repo=arg.slice(7);continue;}
    if(arg==='--all'&&command==='fetch'){all=true;continue;}
    if(arg==='--multiple'&&command==='fetch'){multiple=true;continue;}
    if(values.has(arg)){n++;continue;}
    if(arg.startsWith('-'))continue;
    positional.push(arg);
  }
  const query=tail=>spawnSync(program,[...prefix,...tail],{env,encoding:'utf8'}).stdout?.trim()||'';
  const config=key=>query(['config','--get',key]);
  const remotes=()=>query(['remote']).split('\n').filter(Boolean);
  const defaultRemote=()=>{
    const branch=query(['symbolic-ref','--quiet','--short','HEAD']);
    return (command==='push'&&(config('branch.'+branch+'.pushRemote')||config('remote.pushDefault')))
      ||config('branch.'+branch+'.remote')||(remotes().length===1?remotes()[0]:'origin');
  };
  let targets=command==='clone'?positional.slice(0,1):all?remotes():multiple?positional:[repo||positional[0]||defaultRemote()];
  if(command==='fetch'&&!all)targets=targets.flatMap(target=>{
    if(query(['remote','get-url',target]))return [target];
    const group=query(['config','--get-all','remotes.'+target]);
    return group?group.split(/\s+/).filter(Boolean):[target];
  });
  const urls=targets.flatMap(target=>{
    if(command!=='clone'&&remotes().includes(target)){
      const remote=query(['remote','get-url',...(command==='push'?['--push']:[]),'--all',target]);
      if(remote)return remote.split('\n');
    }
    // Direct targets are not names of remotes in the caller's checkout.
    // Git remote get-url ignores command-only remotes, so apply its documented
    // longest-prefix pushInsteadOf rule; a match does not then use insteadOf.
    let direct=target;
    if(command==='push'){
      let longest=-1;
      for(const record of query(['config','--null','--get-regexp','^url\\..*\\.pushinsteadof$']).split('\0')){
        const separator=record.indexOf('\n');if(separator<0)continue;
        const key=record.slice(0,separator),value=record.slice(separator+1);
        if(value.length>longest&&target.startsWith(value)){longest=value.length;direct=key.slice(4,-'.pushinsteadof'.length)+target.slice(value.length);}
      }
      if(longest>=0)return [direct];
    }
    const temporary='coffee-resolve-'+randomUUID();
    return [query(['-c','remote.'+temporary+'.url='+direct,'ls-remote','--get-url',temporary])||direct];
  });
  return {prefix,urls};
}
function isGitHub(url) {
  try{return new URL(url).hostname.toLowerCase()==='github.com';}
  catch{return /^(?:[^/@:]+@)?github\.com:/i.test(url);}
}
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
    const {prefix,urls}=gitNetworkTargets(program,args,env);
    if(urls.some(isGitHub)){
      const state=JSON.parse(readFileSync(file,'utf8'));
      if(state.version!==1||!state.accounts.some(a=>a.id===id&&a.token))throw Error();
      // Reject legacy headers only for an actual GitHub destination.
      const local=spawnSync(program,[...prefix,'config','--local','--get-regexp','^http\\..*extraheader$'],{env:{...env,GIT_CONFIG_COUNT:'0'},encoding:'utf8'}).stdout??'';
      if(local.trim()){process.stderr.write('Remove legacy repository HTTP authentication headers before using managed GitHub authorization.\n');process.exit(1);}
    }
    const result=spawnSync(program,[...identity,...args],{env,stdio:'inherit'});process.exit(result.status??1);
  }
  const token=await githubToken(file,id);
  if(mode==='credential'||mode==='gitea'){
    process.stdout.write('username=x-access-token\npassword='+token+'\n\n');
  }else if(mode==='gh'){
    if(args.includes('auth')&&!(args.length===2&&args[0]==='auth'&&args[1]==='status')){process.stderr.write('Manage GitHub authorization in PI Coffee, not gh auth.\n');process.exit(1);}
    const env={...process.env,GH_TOKEN:token,GITHUB_TOKEN:token,GH_HOST:'github.com'};
    const result=spawnSync(program,args,{env,stdio:'inherit'});process.exit(result.status??1);
  }else throw Error();
}catch{process.stderr.write('GitHub authorization is missing or disconnected. Connect/select an account in PI Coffee.\n');process.exit(1);}
