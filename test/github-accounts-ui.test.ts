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
