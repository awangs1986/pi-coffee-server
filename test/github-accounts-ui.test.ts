// @vitest-environment jsdom
import {readFileSync} from 'node:fs';import {it,expect,vi,afterEach} from 'vitest';
import {initGitHubAccounts} from '../public/github-accounts.js';
afterEach(()=>vi.unstubAllGlobals());const tick=()=>new Promise(r=>setTimeout(r,0));
it('manages several GitHub accounts through the Logo menu and makes unavailable OAuth explicit',async()=>{
 document.documentElement.innerHTML=readFileSync('public/index.html','utf8');HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 const calls:unknown[]=[];let accounts=[{id:'one',login:'personal'},{id:'two',login:'work'}];
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{const body=JSON.parse(init.body);calls.push(body);if(body.action==='delete')accounts=accounts.filter(a=>a.id!==body.id);return {ok:true,json:async()=>({accounts,oauthConfigured:false})};}));
 vi.stubGlobal('confirm',()=>true);initGitHubAccounts({onOpen:()=>{},projects:()=>[],bind:async()=>{}});
 document.getElementById('github-accounts-btn')!.click();await tick();expect(document.getElementById('github-accounts-dialog')!.hasAttribute('open')).toBe(true);
 expect(document.getElementById('github-accounts-list')!.textContent).toContain('personal');expect(document.getElementById('github-accounts-list')!.textContent).toContain('work');
 expect((document.getElementById('github-connect') as HTMLButtonElement).disabled).toBe(true);
 (document.querySelector('[data-account-delete="one"]') as HTMLButtonElement).click();await tick();expect(calls).toContainEqual({action:'delete',id:'one'});expect(document.getElementById('github-accounts-list')!.textContent).not.toContain('personal');
});
it('shows binding progress and confirms the selected project and account after refresh',async()=>{
 document.documentElement.innerHTML=readFileSync('public/index.html','utf8');
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 const projects=[{id:'legacy',name:'personal/project',forge:'github',githubAccountId:undefined as string|undefined}];
 let complete:()=>void=()=>{};
 const bind=vi.fn(async(projectId:string,accountId:string)=>{await new Promise<void>(resolve=>{complete=resolve;});projects[0].githubAccountId=accountId;});
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({accounts:[{id:'one',login:'personal'}],oauthConfigured:true})})));
 const manager=initGitHubAccounts({projects:()=>projects,bind});await manager.refresh();
 (document.getElementById('github-legacy-project') as HTMLSelectElement).value='legacy';
 ([...document.querySelectorAll<HTMLButtonElement>('#github-accounts-list button')].find(b=>b.textContent==='绑定旧项目')!).click();
 expect(document.getElementById('github-accounts-status')!.textContent).toContain('正在绑定');
 expect(bind).toHaveBeenCalledWith('legacy','one');
 document.getElementById('github-accounts-refresh')!.click();await manager.refresh();await tick();
 expect(document.getElementById('github-accounts-status')!.textContent).toContain('正在绑定 personal/project');
 complete();await tick();
 expect(document.getElementById('github-accounts-status')!.textContent).toContain('personal/project 已绑定到 personal');
 expect(document.getElementById('github-legacy-row')!.hidden).toBe(true);
});
it('keeps failed legacy binding visible and permits a retry',async()=>{
 document.documentElement.innerHTML=readFileSync('public/index.html','utf8');
 const projects=[{id:'legacy',name:'personal/project',forge:'github'}];
 const bind=vi.fn(async()=>{throw Error('Finish running tasks before binding');});
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({accounts:[{id:'one',login:'personal'}],oauthConfigured:true})})));
 const manager=initGitHubAccounts({projects:()=>projects,bind});await manager.refresh();
 (document.getElementById('github-legacy-project') as HTMLSelectElement).value='legacy';
 const button=[...document.querySelectorAll<HTMLButtonElement>('#github-accounts-list button')].find(b=>b.textContent==='绑定旧项目')!;
 button.click();await tick();
 expect(document.getElementById('github-accounts-status')!.textContent).toContain('Finish running tasks before binding');
 expect(document.getElementById('github-legacy-row')!.hidden).toBe(false);
 button.click();await tick();expect(bind).toHaveBeenCalledTimes(2);
});
