import {afterEach,expect,it} from 'vitest';
import {mkdtemp,appendFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WatchJournal} from '../src/host/mishu-journal.js';
import {MishuWatch} from '../src/host/mishu-watch.js';
import {ReceiptArchive,RECEIPT_LIMITS} from '../src/host/mishu-receipts.js';
const roots:string[]=[];
async function temp(){const root=await mkdtemp(join(tmpdir(),'manager-regression-'));roots.push(root);return root;}
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
it('keeps the first post-crash append across another restart',async()=>{
 const root=await temp();let journal=new WatchJournal(root);
 await journal.append({conv:'target',kind:'run.started',data:{}});
 await appendFile(join(root,'events-000000000001.jsonl'),'{"seq":2,"torn');
 journal=new WatchJournal(root);await journal.append({conv:'target',kind:'run.completed',data:{}});
 const reopened=new WatchJournal(root);expect((await reopened.read()).events.map(e=>e.seq)).toEqual([1,2]);
 expect((await reopened.append({conv:'target',kind:'run.started',data:{}})).seq).toBe(3);
});
it('does not acknowledge unread events beyond the digest page budget',async()=>{
 const watch=new MishuWatch({root:await temp()});await watch.start();
 try{
  for(let i=0;i<501;i++)await watch.journal.append({conv:'target',kind:i===500?'run.errored':'run.completed',data:i===500?{error:'FINAL_ERROR'}:{}});
  const first=await watch.digest(0);expect(first.head).toBe(500);
  const second=await watch.digest(first.head);expect(second.events).toBe(1);expect(second.text).toContain('FINAL_ERROR');
 }finally{await watch.close();}
});
it('never raises a stuck alert for an excluded running secretary',async()=>{
 let now=1000;const watch=new MishuWatch({root:await temp(),now:()=>now,timers:{set:()=>0,clear:()=>{}},isExcluded:id=>id==='secretary',catalog:async()=>[{id:'secretary',title:'Secretary',engine:'pi',project:'Chat',running:true,queued:0}]});
 try{await watch.start();now+=24*3600000;await watch.tick();expect((await watch.journal.read()).events).toEqual([]);expect(watch.panel().items).toEqual([]);}finally{await watch.close();}
});
it('retains dedup identity after receipt body retention expires and after restart',async()=>{
 const root=await temp();let now=0;const archive=new ReceiptArchive(root,()=>now);
 const receipt=(messageId:string)=>({messageId,targetId:'t',fingerprint:'f',requestId:messageId,state:'settled',kind:'authorized-execution',createdAt:new Date(0).toISOString()});
 await archive.archive('s',[receipt('old')]);now=RECEIPT_LIMITS.indexMs+1;await archive.archive('s',[receipt('new')]);
 expect((await new ReceiptArchive(root,()=>now).lookup('s','old'))?.fingerprint).toBe('f');
});

it('accepts verified earlier user instructions during a new foreground request',async()=>{
 const {GrantRegistry}=await import('../src/host/mishu-grants.js');
 const grants=new GrantRegistry(join(await temp(),'key'));
 await grants.issue('secretary','clarification','继续');
 expect(()=>grants.use('secretary','clarification','修复登录并运行测试','send:one',['修复登录并运行测试'])).not.toThrow();
 expect(()=>grants.use('secretary','clarification','删除用户数据','send:two',['修复登录并运行测试'])).toThrow();
 grants.expire('secretary','clarification');
 expect(()=>grants.use('secretary','clarification','修复登录并运行测试','send:three',['修复登录并运行测试'])).toThrow();
});

it('does not treat an unreadable legacy receipt archive as empty dedup evidence',async()=>{
 const root=await temp();await mkdir(join(root,'receipts-source.jsonl'));
 await expect(new ReceiptArchive(root).lookup('source','old-message')).rejects.toThrow();
});

it('seals a segment even when its very first event was torn',async()=>{
 const root=await temp();await appendFile(join(root,'events-000000000001.jsonl'),'{"seq":1,"torn');
 const journal=new WatchJournal(root),appended=await journal.append({conv:'target',kind:'run.completed',data:{}});
 const reopened=new WatchJournal(root),page=await reopened.read();expect(page.events).toEqual([appended]);
 expect((await reopened.append({conv:'target',kind:'run.started',data:{}})).seq).toBeGreaterThan(appended.seq);
});
