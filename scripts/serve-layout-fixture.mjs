// Real browser shell, synthetic Host responses. No account, VM writes, or model calls.
// PI_COFFEE_LAYOUT_HOST=0.0.0.0 exposes it for a remote preview; the default stays loopback.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {WebSocketServer} from 'ws';
const root=resolve('public');
const branch='coffee/test-vm/00000000-0000-4000-8000-000000000000';
const conversation={id:'layout-task',engine:'pi',workspaceKind:'project',creationState:'ready',projectId:'demo',cwd:'/home/awang/work/projects/checkouts/00000000-0000-4000-8000-000000000000',branch,startSha:'abc',createdAt:new Date().toISOString(),turnSnapshot:{tree:'4b825dc642cb6eb9a060e54bf8d69288fbee4904',startedAt:'2026-09-28T09:30:00Z'}};
const tasks=Array.from({length:40},(_,i)=>i ? {...conversation,id:'layout-task-'+i,turnSnapshot:undefined} : conversation);

const section=(path,lines,{created=false}={})=>[`diff --git a/${path} b/${path}`,...(created ? ['new file mode 100644','--- /dev/null'] : [`--- a/${path}`]),`+++ b/${path}`,...lines].join('\n');
const workspacesHunks=[
 '@@ -212,14 +212,19 @@ export class WorkspaceStore {',
 '   async changes(id: string) {',
 '     const c = this.conversation(id);',
 '     await this.checkDirectory(c);',
 "-    const base = await this.git(c.cwd, ['merge-base', 'HEAD', `origin/${c.startBranch}`]);",
 '-    const files = await this.numstat(c.cwd, base);',
 '+    const base = await this.mergeBase(c);',
 '+    const files = await diffFiles(c.cwd, base, { untracked: true });',
 "     const patch = await this.git(c.cwd, ['diff', base, '--', '.']);",
 '-    return { branch: c.branch, base, files, patch };',
 "+    return { scope: 'branch', branch: c.branch, base, files, patch: patch.slice(0, PATCH_LIMIT) };",
 '   }',
 ' ',
];
const turnHunk=[
 '@@ -226,6 +231,13 @@ export class WorkspaceStore {',
 '   }',
 ' ',
 '+  async turnChanges(id: string) {',
 '+    const c = this.conversation(id);',
 "+    if (!c.turnSnapshot?.tree) throw new Error('No turn recorded yet; send a message first');",
 '+    const files = await diffFiles(c.cwd, c.turnSnapshot.tree, { untracked: true });',
 "+    return { scope: 'turn', startedAt: c.turnSnapshot.startedAt, files };",
 '+  }',
 '+',
 '   private async numstat(cwd: string, base: string) {',
 "-    const out = await this.git(cwd, ['diff', '--numstat', base]);",
 "+    const out = await this.git(cwd, ['diff', '--numstat', '-z', base]);",
 '     return parseNumstat(out);',
 '   }',
];
const specLines=['@@ -0,0 +1,6 @@','+# Composer 与 Diff','+','+- 输入框、工具栏和任务条在同一张卡片里。','+- 「+N −M」打开右侧 Diff，默认对比基线分支。','+- 「最近一轮」只显示最后一轮 Agent 改动的文件。','+- 「创建 PR」会先 Checkpoint，再打开 Gitea PR。'];
const realistic=[
 ['src/host/workspaces.ts','M',section('src/host/workspaces.ts',[...workspacesHunks,...turnHunk])],
 ['public/app.css','M',section('public/app.css',[
  '@@ -251,9 +251,12 @@ .composer-wrap {',' .composer {','-  width: min(var(--composer-width), 100%); margin: 0 auto;','-  border: 1px solid var(--border); border-radius: 16px;','+  display: flex; flex-direction: column; min-width: 0;',' }',
  '+.composer-card {','+  border: 1px solid var(--border); border-radius: 16px; background: var(--bg);','+}',' .send, .stop {','-  border: 0; border-radius: 999px; width: 34px; height: 34px;','+  border: 1px solid var(--border-strong); border-radius: 9px; width: 32px; height: 32px;',' }'])],
 ['public/review.js','M',section('public/review.js',[
  '@@ -1,6 +1,9 @@',' // View-only rendering of Host-supplied patches; never reads or changes a checkout.'," import { el } from './render.js';"," import { highlight, normalizeLang } from './highlight.js';",'+','+const WORD_DIFF_BUDGET = 1_500_000;','+const WORD_DIFF_MIN_SIMILARITY = 0.3;',' ',' function patchRows(patch) {',
  "@@ -24,7 +27,7 @@ export function renderReviewFile(file,patch,layout='unified') {","   const section=el('details','review-file');section.open=true;","-  const summary=el('summary','review-file-head');","+  const summary=el('summary','review-file-head');summary.append(chevron());","   const name=el('code','review-file-name',file.path);name.title=file.path;"])],
 ['docs/spec/arena-navigation.md','?',section('docs/spec/arena-navigation.md',specLines,{created:true})],
 ['test/turn-changes.test.ts','A',section('test/turn-changes.test.ts',['@@ -0,0 +1,8 @@',"+import { describe, expect, it } from 'vitest';",'+',"+describe('last-turn Diff', () => {","+  it('only reports files the latest turn changed', async () => {",'+    const turn = await store.turnChanges(id);',"+    expect(turn.files.map((file) => file.path)).toEqual(['agent.txt']);",'+  });','+});'],{created:true})],
 ['README.md','M',section('README.md',['@@ -40,7 +40,6 @@ npm run check',' ## Review',' ','-The topbar shows a 本轮改动 chip for Codex runs.',' Open the Diff from the composer strip.'])],
];
const synthetic=Array.from({length:34},(_,i)=>{const path=`src/components/example-${i}.ts`;return [path,'M',section(path,['@@ -1,3 +1,3 @@',` export const id = ${i};`,"-export const label = 'old';","+export const label = 'new';",' export default id;'])];});
function stats([path,status,patch]) {
 let additions=0,deletions=0,inHunk=false;
 for(const line of patch.split('\n')){if(line.startsWith('@@')){inHunk=true;continue;}if(!inHunk)continue;if(line.startsWith('+'))additions++;else if(line.startsWith('-'))deletions++;}
 return {path,status,additions,deletions};
}
const all=[...realistic,...synthetic];
const changes={scope:'branch',sessionId:conversation.id,projectId:'demo',branch,base:'abc1234def5678',target:'fed9876cba5432',refreshedAt:'2026-09-28T10:00:00Z',stale:false,files:all.map(stats),checks:[{command:'git diff --check',ok:true,output:''}],patch:all.map(entry=>entry[2]).join('\n'),stat:`${all.length} files changed`,checkpointPaths:all.map(entry=>entry[0])};
const turnEntries=[['src/host/workspaces.ts','M',section('src/host/workspaces.ts',turnHunk)],realistic[3]];
const turn={scope:'turn',sessionId:conversation.id,projectId:'demo',branch,base:conversation.turnSnapshot.tree,target:'WORKTREE',startedAt:conversation.turnSnapshot.startedAt,running:false,stale:false,refreshedAt:'2026-09-28T10:00:00Z',files:turnEntries.map(stats),patch:turnEntries.map(entry=>entry[2]).join('\n'),truncated:false};

// GitHub-backed Projects (ADR-0022): one already added; the picker lists what a Host token could reach.
const initialProjects=()=>[{id:'demo',name:'example/project',branch:'main',webUrl:'https://example.com/example/project'},{id:'github-424242',name:'example/github-app',branch:'main',forge:'github',repoId:'424242',webUrl:'https://github.com/example/github-app'}];
let projects=initialProjects();
const githubRepos=[
 {id:'424242',fullName:'example/github-app',private:true,archived:false,defaultBranch:'main',canPush:true,description:'Web client and Host'},
 {id:'424243',fullName:'example/docs-site',private:false,archived:false,defaultBranch:'gh-pages',canPush:true,description:'Documentation website'},
 {id:'424244',fullName:'example-org/infra',private:true,archived:false,defaultBranch:'main',canPush:true,description:'Deployment manifests and VM images'},
 {id:'424245',fullName:'example-org/design-tokens',private:false,archived:false,defaultBranch:'main',canPush:false,description:'Read-only for this token'},
 {id:'424246',fullName:'example/legacy-api',private:true,archived:true,defaultBranch:'master',canPush:true},
].map(repo=>({...repo,cloneUrl:`https://github.com/${repo.fullName}.git`,webUrl:`https://github.com/${repo.fullName}`}));

const server=createServer(async(req,res)=>{
 res.setHeader('content-type','application/json');
 if(req.url==='/api/engines')return res.end(JSON.stringify({engines:['pi','codex','claude'].map(id=>({id,name:id,available:true}))}));
 if(req.url==='/api/me')return res.end(JSON.stringify({login:'demo-owner'}));
 if(req.url==='/auth/me')return res.end(JSON.stringify({auth:false,user:null}));
 if(req.url==='/api/workspace'){
  let raw='';for await(const b of req)raw+=b;const body=raw?JSON.parse(raw):null;
  const state={vmId:'test-vm',projects,conversations:tasks,capabilities:{chatWorkspaces:true,forges:{gitea:true,github:true}}};
  const origin=`${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
  let result={};
  if(!body)result=state;
  else if(body.action==='files')result={url:origin,scope:conversation.id,token:'synthetic',files:[]};
  else if(body.action==='status')result={state:conversation.pullRequest ? 'synced' : 'ahead',dirty:!conversation.pullRequest,branch,lastRemoteAt:'2026-09-22T12:00:00Z'};
  else if(body.action==='changes')result=body.scope==='turn' ? turn : conversation.pullRequest ? {...changes,checkpointPaths:[]} : changes;
  else if(body.action==='branches')result=body.projectId==='github-424243' ? ['gh-pages','main'] : ['main','release/2026.09'];
  else if(body.action==='checkpoint' || body.action==='sync')result={state:'synced',dirty:false,branch,lastRemoteAt:new Date().toISOString()};
  else if(body.action==='pull_request')result=conversation.pullRequest={number:12,url:'https://example.com/example/project/pulls/12',state:'open',target:'main',source:branch};
  else if(body.action==='github_repos')result=githubRepos.map(repo=>({...repo,...(projects.some(p=>p.repoId===repo.id) ? {projectId:'github-'+repo.id} : {})}));
  else if(body.action==='github_project'){
   const name=String(body.repository||'').trim().replace(/^https:\/\/github\.com\//,'').replace(/\.git$/,'');const repo=githubRepos.find(item=>item.fullName===name);
   if(!repo){res.statusCode=409;return res.end(JSON.stringify({error:`GitHub GET /repos/${name} failed (404): Not Found`}));}
   if(!repo.canPush || repo.archived){res.statusCode=409;return res.end(JSON.stringify({error:repo.archived ? `GitHub repository ${name} is archived` : `The Host GitHub token cannot push to ${name}; choose a repository it can write to`}));}
   result=projects.find(p=>p.repoId===repo.id);
   if(!result){result={id:'github-'+repo.id,name:repo.fullName,branch:repo.defaultBranch,forge:'github',repoId:repo.id,webUrl:repo.webUrl};projects.push(result);}
  }
  return res.end(JSON.stringify(result));
 }
 if(req.url.includes('/artifacts'))return res.end('{"artifacts":[]}');
 if(req.url==='/'){delete conversation.pullRequest;projects=initialProjects();} // every page load starts before 创建 PR
 const path=resolve(root,'.'+(req.url==='/'?'/index.html':req.url.split('?')[0]));
 if(!path.startsWith(root+'/')){res.statusCode=404;return res.end();}
 try{res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(path)]||'text/plain');res.end(await readFile(path));}catch{res.statusCode=404;res.end();}
});
const wss=new WebSocketServer({server,path:'/ws'});
wss.on('connection',ws=>ws.on('message',raw=>{
 const f=JSON.parse(raw);const send=x=>ws.send(JSON.stringify(x));
 if(f.type==='list_sessions')send({type:'sessions',sessions:tasks.map((c,i)=>({id:c.id,name:'布局验收 '+i+' · 长任务标题测试，不包含用户对话',updatedAt:c.createdAt,messageCount:2}))});
 if(f.type==='open'){send({type:'opened',sessionId:f.sessionId,engine:'pi',state:{}});send({type:'event',sessionId:f.sessionId,event:{type:'extension_ui_request',method:'setStatus',key:'fixture',text:'⧉ idle'}});send({type:'history',sessionId:conversation.id,entries:[{kind:'user',text:'请检查项目的排版问题。'},{kind:'assistant',text:'已定位问题，变更保存在当前任务目录。\n\n```ts\nconst layout = "responsive";\n```'}]});}
 if(f.type==='get_stats')send({type:'stats',sessionId:conversation.id,stats:{contextBreakdown:{version:1,method:'o200k_base_estimate',basis:'last_request',capturedAt:'2026-09-23T10:00:00Z',contextWindow:256000,totalTokens:119100,categories:[{id:'system',tokens:1500},{id:'tools',tokens:13300},{id:'rules',tokens:2800},{id:'skills',tokens:3900},{id:'dynamic',tokens:2900},{id:'subagents',tokens:1600},{id:'conversation',tokens:93100}]},contextUsage:{percent:50,tokens:5000,contextWindow:10000},tokens:{total:6000,input:5000,output:1000},cost:0.01}});
 if(f.type==='get_models')send({type:'models',models:[{provider:'fixture',id:'demo-model',source:'native'}],current:{provider:'fixture',id:'demo-model'},thinkingLevels:['low','high'],thinkingLevel:'high'});
}));
const port=Number(process.env.PI_COFFEE_LAYOUT_PORT || 4175),host=process.env.PI_COFFEE_LAYOUT_HOST || '127.0.0.1';
await new Promise(r=>server.listen(port,host,r));
console.log(`Layout fixture: http://${host}:${server.address().port}`);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{for(const ws of wss.clients)ws.terminate();wss.close();server.close();});
