// @vitest-environment jsdom
// Browser-controller seam for GitHub-backed Work Projects (ADR-0022): grouped repository dropdown,
// the "＋" menu and GitHub picker, and forge-aware repository icon and PR texts.
import {readFileSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();localStorage.clear();sessionStorage.clear();vi.resetModules();});

const REPOS=[
  {id:'101',fullName:'acme/app',private:true,archived:false,defaultBranch:'main',cloneUrl:'https://github.com/acme/app.git',webUrl:'https://github.com/acme/app',canPush:true,projectId:'github-101'},
  {id:'102',fullName:'acme/tools',private:false,archived:false,defaultBranch:'trunk',cloneUrl:'https://github.com/acme/tools.git',webUrl:'https://github.com/acme/tools',canPush:true,description:'Build helpers'},
  {id:'103',fullName:'acme/readonly',private:true,archived:false,defaultBranch:'main',cloneUrl:'https://github.com/acme/readonly.git',webUrl:'https://github.com/acme/readonly',canPush:false},
];
type Options={github?:boolean;task?:Record<string,unknown>|null;reposError?:string;registrationGate?:Promise<void>};
async function setup({github=true,task=null,reposError,registrationGate}:Options={}){
  document.documentElement.innerHTML=readFileSync('public/index.html','utf8');
  Object.defineProperty(window,'matchMedia',{value:()=>({matches:false,addEventListener(){}}),configurable:true});Element.prototype.scrollTo=vi.fn();
  const projects:any[]=[{id:'p',name:'demo',branch:'main',webUrl:'https://gitea.example/owner/demo'}];
  if(github)projects.push({id:'github-101',name:'acme/app',branch:'main',forge:'github',repoId:'101',webUrl:'https://github.com/acme/app'});
  const conversations:any[]=task ? [{id:'task-1',workspaceKind:'project',engine:'pi',creationState:'ready',projectId:'github-101',cwd:'/home/test/checkouts/task-1',branch:'coffee/vm/task-1',startSha:'abc',archived:false,createdAt:'2026-09-28T00:00:00Z',...task}] : [];
  if(task)sessionStorage.setItem('pi-coffee.active.v2','task-1');
  const requests:any[]=[],sockets:any[]=[];
  class Socket{static OPEN=1;readyState=1;onopen:any;onmessage:any;onclose:any;onerror:any;constructor(){sockets.push(this);queueMicrotask(()=>this.onopen?.());}close(){}send(){}receive(frame:any){this.onmessage?.({data:JSON.stringify(frame)});}}
  vi.stubGlobal('WebSocket',Socket);vi.stubGlobal('open',vi.fn());
  const json=(value:unknown,ok=true)=>({ok,status:ok ? 200 : 409,json:async()=>value});
  vi.stubGlobal('fetch',vi.fn(async(url:any,init:any)=>{
    if(url==='/api/engines')return json({engines:[{id:'pi',name:'Pi',available:true},{id:'codex',name:'Codex',available:true}]});
    if(url==='/api/me')return json(null);
    if(url==='/auth/me')return json({auth:false});
    const body=init?.body ? JSON.parse(init.body) : null;
    if(!body)return json({projects,conversations,sidebar:{assignments:{},collapsed:[]},vmId:'vm-1',capabilities:{chatWorkspaces:true,forges:{gitea:true,github}}});
    requests.push(body);
    if(body.action==='gitea_repos')return json([{id:'88',fullName:'awangs/ArenaModels',defaultBranch:'trunk',canPush:true}]);
    if(body.action==='gitea_project'){const project={id:'gitea-88',repoId:'88',name:body.repository,branch:'trunk',forge:'gitea'};projects.push(project);return json(project);}
    if(body.action==='github_repos')return reposError ? json({error:reposError},false) : json(REPOS.map(repo=>({...repo,...(projects.some(p=>p.repoId===repo.id) ? {projectId:'github-'+repo.id} : {})})));
    if(body.action==='github_project'){
      await registrationGate;
      const name=String(body.repository).replace(/^https:\/\/github\.com\//,'');const known=REPOS.find(repo=>repo.fullName===name);
      if(name==='acme/readonly')return json({error:'The Host GitHub token cannot push to acme/readonly'},false);
      const project={id:'github-'+(known?.id ?? '900'),name,branch:known?.defaultBranch ?? 'main',forge:'github',repoId:known?.id ?? '900',webUrl:'https://github.com/'+name};
      projects.push(project);return json(project);
    }
    if(body.action==='branches')return json(['main','trunk','dev']);
    if(body.action==='files')return json({url:'http://vm.example',scope:'task-1',token:'t',files:[]});
    if(body.action==='status')return json({state:'synced',dirty:false,branch:'coffee/vm/task-1'});
    if(body.action==='changes')return json({scope:'branch',files:[{path:'a.ts',status:'M',additions:1,deletions:0}],patch:'',checks:[],checkpointPaths:[]});
    return json({});
  }));
  vi.useFakeTimers();await import('../public/app.js');await vi.advanceTimersByTimeAsync(20);
  if(task){sockets.at(-1).receive({type:'opened',sessionId:'task-1',engine:'pi',state:{}});await vi.advanceTimersByTimeAsync(20);}
  return {requests,projects};
}
const q=<T extends Element=HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
const hidden=(selector:string)=>q(selector).classList.contains('hidden');
async function chooseWork(){const kind=q<HTMLSelectElement>('#task-kind');kind.value='project';kind.dispatchEvent(new Event('change'));await vi.advanceTimersByTimeAsync(20);}
async function selectProject(value:string){const select=q<HTMLSelectElement>('#project-select');select.value=value;select.dispatchEvent(new Event('change'));await vi.advanceTimersByTimeAsync(20);}
const rows=()=>[...document.querySelectorAll<HTMLButtonElement>('#github-list .github-row')];

it('does not replace a changed draft selection when a delayed GitHub registration completes',async()=>{
  let release!:()=>void;
  const registrationGate=new Promise<void>(resolve=>{release=resolve;});
  const app=await setup({registrationGate});await chooseWork();await selectProject('p');
  await selectProject('__add_github__');
  rows().find(row=>row.dataset.repo==='acme/tools')!.click();
  await vi.advanceTimersByTimeAsync(20);
  q<HTMLButtonElement>('#github-close').click();await selectProject('github-101');
  release();await vi.advanceTimersByTimeAsync(20);
  expect(app.projects.some(project=>project.id==='github-102')).toBe(true);
  expect(q<HTMLSelectElement>('#project-select').value).toBe('github-101');
});

it('groups the repository dropdown by forge and switches the strip icon with the selection',async()=>{
  const app=await setup();await chooseWork();
  const select=q<HTMLSelectElement>('#project-select');
  const groups=[...select.querySelectorAll('optgroup')].map(group=>[group.label,[...group.querySelectorAll('option')].map(option=>option.textContent)]);
  expect(groups).toEqual([['Gitea',['demo','＋ 选择已有 Gitea 仓库…']],['GitHub',['acme/app','＋ 添加 GitHub 仓库…']]]);
  expect(q('#task-kind').querySelector('option[value="project"]')!.textContent).toBe('Work · Gitea / GitHub');
  await selectProject('github-101');
  expect(q('.strip-repo-icon').dataset.forge).toBe('github');expect(q('.strip-repo-icon').title).toBe('GitHub 仓库');
  expect(app.requests.filter(r=>r.action==='branches')).toEqual([{action:'branches',projectId:'github-101'}]);
  expect(q<HTMLInputElement>('#start-branch').value).toBe('main');
  await selectProject('p');expect(q('.strip-repo-icon').dataset.forge).toBe('gitea');
});

it('adds a GitHub repository from the "＋" menu, then selects it for the new task',async()=>{
  const app=await setup();await chooseWork();
  const button=q<HTMLButtonElement>('#project-create');expect(button.getAttribute('aria-haspopup')).toBe('menu');
  button.click();expect(hidden('#project-create-menu')).toBe(false);expect(button.getAttribute('aria-expanded')).toBe('true');
  q<HTMLButtonElement>('#project-create-github').click();await vi.advanceTimersByTimeAsync(20);
  expect(hidden('#project-create-menu')).toBe(true);expect(hidden('#github-modal')).toBe(false);
  expect(app.requests.filter(r=>r.action==='github_repos')).toHaveLength(1);
  expect(rows().map(row=>[row.dataset.repo,row.disabled,row.querySelector('.github-badges')!.textContent])).toEqual([
    ['acme/app',false,'私有已添加'],['acme/tools',false,''],['acme/readonly',true,'私有无写权限'],
  ]);
  expect(q('#github-sub').textContent).toBe('3 个可访问仓库');
  const search=q<HTMLInputElement>('#github-search');search.value='build';search.dispatchEvent(new Event('input'));
  expect(rows().map(row=>row.dataset.repo)).toEqual(['acme/tools']);
  search.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));await vi.advanceTimersByTimeAsync(20);
  expect(app.requests.filter(r=>r.action==='github_project')).toEqual([{action:'github_project',repository:'acme/tools'}]);
  expect(hidden('#github-modal')).toBe(true);
  expect(q<HTMLSelectElement>('#project-select').value).toBe('github-102');expect(q<HTMLInputElement>('#start-branch').value).toBe('trunk');
  expect(q('#toast').textContent).toContain('GitHub 仓库已添加：acme/tools');
  expect(app.requests.some(r=>r.action==='conversation')).toBe(false);
});

it('opens the picker from the dropdown entry, accepts a pasted URL and keeps the previous selection on cancel',async()=>{
  const app=await setup();await chooseWork();await selectProject('p');
  await selectProject('__add_github__');
  expect(hidden('#github-modal')).toBe(false);expect(q<HTMLSelectElement>('#project-select').value).toBe('p');
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));expect(hidden('#github-modal')).toBe(true);
  expect(q<HTMLSelectElement>('#project-select').value).toBe('p');expect(app.requests.some(r=>r.action==='github_project')).toBe(false);
  await selectProject('__add_github__');
  const search=q<HTMLInputElement>('#github-search');search.value='https://github.com/octo/new-repo';search.dispatchEvent(new Event('input'));
  expect(rows()[0].dataset.repo).toBe('octo/new-repo');expect(rows()[0].textContent).toContain('按名称添加');
  rows()[0].click();await vi.advanceTimersByTimeAsync(20);
  expect(app.requests.filter(r=>r.action==='github_project')).toEqual([{action:'github_project',repository:'https://github.com/octo/new-repo'}]);
  expect(q<HTMLSelectElement>('#project-select').value).toBe('github-900');
});

it('keeps the picker open with the Host reason when a repository cannot be added or listed',async()=>{
  const app=await setup({reposError:'GitHub GET /user/repos failed (401): Bad credentials'});await chooseWork();
  await selectProject('__add_github__');
  expect(q('#github-list').textContent).toContain('Bad credentials');
  const search=q<HTMLInputElement>('#github-search');search.value='acme/readonly';search.dispatchEvent(new Event('input'));
  rows()[0].click();await vi.advanceTimersByTimeAsync(20);
  expect(app.requests.filter(r=>r.action==='github_project')).toHaveLength(1);
  expect(hidden('#github-modal')).toBe(false);expect(q('#toast').textContent).toContain('cannot push to acme/readonly');
});

it('preserves Gitea-only creation alongside existing repositories and "＋ 新建项目" unchanged when the Host has no GitHub token',async()=>{
  await setup({github:false});await chooseWork();
  expect(q('#project-select').querySelector('optgroup')).toBeNull();
  expect([...q<HTMLSelectElement>('#project-select').options].map(option=>option.textContent)).toEqual(['选择项目 / 全部任务','demo','＋ 选择已有 Gitea 仓库…']);
  const button=q<HTMLButtonElement>('#project-create');expect(button.hasAttribute('aria-haspopup')).toBe(false);
  button.click();expect(hidden('#project-create-menu')).toBe(true);expect(q('#modal-title').textContent).toBe('新建 Gitea 项目');
  expect(q('#task-kind').querySelector('option[value="project"]')!.textContent).toBe('Work · Gitea 项目');
});

it('names GitHub in the strip and PR flow of a GitHub task',async()=>{
  await setup({task:{}});
  expect(q('.strip-repo-icon').dataset.forge).toBe('github');
  expect(q('#task-project').textContent).toBe('acme/app');expect(q('#task-project').title).toBe('在 GitHub 打开 acme/app');
  expect(q('#pull-request').title).toBe('提交并推送当前改动，然后创建 GitHub PR');
  q<HTMLButtonElement>('#pull-request').click();await vi.advanceTimersByTimeAsync(20);
  expect(q('#modal-text').textContent).toBe('为当前任务分支创建 GitHub PR；合并在 GitHub 中完成。');
  expect(hidden('#project-create')).toBe(true);expect(hidden('.project-create-wrap')).toBe(true);
});

it('finds an existing Gitea repository without creating a remote or losing the draft',async()=>{
  const app=await setup({github:false});await chooseWork();await selectProject('p');
  q<HTMLTextAreaElement>('#prompt').value='Keep this draft';
  await selectProject('__add_gitea__');
  expect(hidden('#github-modal')).toBe(false);
  expect(q('#github-title').textContent).toBe('选择已有 Gitea 仓库');
  expect(rows().map(row=>row.dataset.repo)).toContain('awangs/ArenaModels');
  rows()[0].click();await vi.advanceTimersByTimeAsync(20);
  expect(q<HTMLSelectElement>('#project-select').value).toBe('gitea-88');
  expect(q<HTMLInputElement>('#start-branch').value).toBe('trunk');
  expect(q<HTMLTextAreaElement>('#prompt').value).toBe('Keep this draft');
  expect(app.requests.filter(r=>r.action==='gitea_project')).toEqual([{action:'gitea_project',repository:'awangs/ArenaModels'}]);
  expect(app.requests.some(r=>['project','discover','conversation'].includes(r.action))).toBe(false);
});

it('starts Chat, Gitea and GitHub drafts from the hero without sending text or creating a task',async()=>{
  const app=await setup();
  expect([...q('#hero').querySelectorAll('button')].map(b=>b.textContent)).toEqual(['新建一个聊天（Chat）','开启一项任务（Gitea）','开启一项任务（GitHub）']);
  q<HTMLTextAreaElement>('#prompt').value='Keep my prompt';
  q<HTMLButtonElement>('[data-task-source="github"]').click();await vi.advanceTimersByTimeAsync(20);
  expect(q<HTMLSelectElement>('#task-kind').value).toBe('project');
  expect(hidden('#github-modal')).toBe(false);expect(q('#github-title').textContent).toBe('添加 GitHub 仓库');
  rows().find(row=>row.dataset.repo==='acme/tools')!.click();await vi.advanceTimersByTimeAsync(20);
  q<HTMLButtonElement>('#agent-menu-btn').click();
  expect([...q('.agent-menu-list').querySelectorAll(':scope > button')].slice(0,2).map(b=>b.id)).toEqual(['agent-kind-row','agent-engine-row']);
  expect(q('#agent-kind-value').textContent).toBe('GitHub');
  expect(q('#agent-source-row').textContent).toContain('模型来源');
  q<HTMLButtonElement>('#agent-menu-btn').click();
  q<HTMLSelectElement>('#task-engine').value='codex';q('#task-engine').dispatchEvent(new Event('change'));
  q<HTMLButtonElement>('[data-task-source="gitea"]').click();await vi.advanceTimersByTimeAsync(20);
  expect(q<HTMLSelectElement>('#task-engine').value).toBe('codex');
  expect(q<HTMLSelectElement>('#project-select').value).toBe('');
  expect(q('#github-title').textContent).toBe('选择已有 Gitea 仓库');
  expect(q('.github-picker .stats-note').textContent).not.toContain('GitHub');
  q<HTMLButtonElement>('#github-close').click();
  q<HTMLButtonElement>('[data-task-source="chat"]').click();await vi.advanceTimersByTimeAsync(20);
  expect(q<HTMLSelectElement>('#task-kind').value).toBe('chat');expect(q<HTMLSelectElement>('#task-engine').value).toBe('pi');
  expect(q<HTMLTextAreaElement>('#prompt').value).toBe('Keep my prompt');
  expect(app.requests.some(r=>r.action==='conversation')).toBe(false);
});

it('keeps the GitHub source visible with a configuration explanation when unavailable',async()=>{
  const app=await setup({github:false});
  q<HTMLButtonElement>('#agent-menu-btn').click();q<HTMLButtonElement>('#agent-kind-row').click();
  const github=[...q('#agent-kind-pane').querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent!.includes('GitHub'))!;
  expect(github.disabled).toBe(true);expect(github.textContent).toContain('未配置');
  expect(q<HTMLButtonElement>('[data-task-source="github"]').disabled).toBe(true);
  expect(app.requests.some(r=>r.action==='github_repos')).toBe(false);
});
