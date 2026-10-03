import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
// @ts-expect-error browser module
import { ConversationRepository, ConversationSyncStore, compareRevision, applyOperations } from '../public/conversation-repository.js';
// @ts-expect-error browser module
import { BoundedReadPool } from '../public/sync-worker.js';
const entry = (text='a', revision='1') => ({id:'a',kind:'assistant',text,entityRevision:revision});
const page = (revision='1',text='a') => ({userScope:'u',syncProtocol:2,conversationId:'a',bindingEpoch:'e',snapshotId:`s${revision}`,baseRevision:revision,entries:[entry(text,revision)],olderCursor:'old',runState:'running'});
const meta = (revision='1') => ({...page(revision),headRevision:revision,oldestAvailableRevision:'0',sourceFreshness:'current'});
const batch = (from='1',to='2',text='b') => ({userScope:'u',conversationId:'a',bindingEpoch:'e',fromExclusive:from,throughRevision:to,headRevision:to,hasMore:false,operations:[{opId:`op${to}`,revision:to,entityId:'a',entityRevision:to,type:'replaceText',payload:{entry:entry(text,to)}}]});
function repo(options:any={}) { return new ConversationRepository({indexedDB:new IDBFactory(),useWorkers:false,...options}); }

describe('bounded revision repository',()=>{
 it('compares decimal revisions without floating-point precision loss',()=>{
  expect(compareRevision('9007199254740993','9007199254740992')).toBe(1);
  expect(()=>compareRevision('01','1')).toThrow();
 });
 it('loads local cache without any network and isolates users',async()=>{
  const indexedDB=new IDBFactory(); const fetch=vi.fn();
  const a=repo({indexedDB,fetch}); a.setScope('u'); await a.acceptSnapshot('a',page());
  const b=repo({indexedDB,fetch}); b.setScope('u');
  expect((await b.getLocal('a')).entries[0].text).toBe('a'); expect(fetch).not.toHaveBeenCalled();
  b.setScope('v'); expect(await b.getLocal('a')).toBeUndefined(); a.dispose(); b.dispose();
 });
 it('applies only continuous changes, rejects conflicts, ignores identical duplicate batches',async()=>{
  const r=repo();r.setScope('u');await r.acceptSnapshot('a',page());
  await r.acceptChanges('a',batch()); await r.acceptChanges('a',batch());
  expect(r.peek('a').entries[0].text).toBe('b');
  await expect(r.acceptChanges('a',batch('1','2','conflict'))).rejects.toMatchObject({code:'revision_conflict'});
  await expect(r.acceptChanges('a',batch('3','4'))).rejects.toMatchObject({code:'revision_gap'});
  expect(r.peek('a').appliedRevision).toBe('2');r.dispose();
 });
 it('persists entities and watermark atomically with cross-tab compare-and-set',async()=>{
  const indexedDB=new IDBFactory(),a=repo({indexedDB}),b=repo({indexedDB});a.setScope('u');b.setScope('u');
  await a.acceptSnapshot('a',page());await b.getLocal('a'); await a.acceptChanges('a',batch());
  await expect(b.acceptChanges('a',batch('1','2','stale'))).rejects.toMatchObject({code:'store_conflict'});
  expect((await b.getLocal('a',{refresh:true})).entries[0].text).toBe('b');a.dispose();b.dispose();
 });
 it('guards epoch and authentication changes from delayed work',async()=>{
  let resolve:any;const fetch=()=>new Promise(r=>{resolve=r;});const r=repo({fetch});r.setScope('u');
  const pending=r.sync('a'); await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));
  r.setScope('v');resolve(new Response(JSON.stringify(meta()),{status:200}));await pending;
  expect(r.peek('a')).toBeUndefined();r.dispose();
 });
 it('bounds message bytes and never stores executable tool arguments',async()=>{
  const r=repo();r.setScope('u');await r.acceptSnapshot('a',{...page(),entries:[entry('😀'.repeat(100000)),{id:'t',kind:'tool',name:'shell',args:{token:'secret'},result:'x'.repeat(100000),entityRevision:'1'}]});
  const v=r.peek('a'); expect(new TextEncoder().encode(v.entries[0].text).length).toBeLessThanOrEqual(8192);
  expect(v.entries[0].contentTruncated).toBe(true);expect(v.entries[1].args).toBeUndefined();r.dispose();
 });
});
describe('bounded read concurrency',()=>{
 it('keeps an expired underlying request occupying its slot until it settles',async()=>{
  let finish:any;const pool=new BoundedReadPool({concurrency:1});
  const first=pool.run('a',()=>new Promise(r=>{finish=r;}),{timeoutMs:10});
  await expect(first).rejects.toMatchObject({code:'timeout'});const next=vi.fn(async()=>2);const second=pool.run('b',next,{timeoutMs:1000});
  await new Promise(r=>setTimeout(r,10));expect(next).not.toHaveBeenCalled();expect(pool.active).toBe(1);
  finish(1);expect(await second).toBe(2);pool.close();
 });
});

describe('repository recovery and bounded tails',()=>{
 it('keeps the latest text moving once a streaming message exceeds a block',async()=>{
  const r=repo();r.setScope('u');await r.acceptSnapshot('a',page('1','x'.repeat(20_000)+'old'));
  expect(r.peek('a').entries[0].contentOffset).toBe(11811);
  await r.acceptChanges('a',{...batch(),operations:[{opId:'append2',revision:'2',entityId:'a',entityRevision:'2',type:'appendText',payload:{text:' NEW 😀',baseEntityRevision:'1',baseLength:20_003,encoding:'utf-16'}}]});
  const value=r.peek('a').entries[0];expect(value.text.endsWith('old NEW 😀')).toBe(true);expect(value.contentOffset+value.text.length).toBe(value.contentLength);expect(new TextEncoder().encode(value.text).length).toBeLessThanOrEqual(8192);r.dispose();
 });
 it('does not append an edited unloaded historical entity to the latest window',async()=>{
  const r=repo();r.setScope('u');await r.acceptSnapshot('a',page());
  await r.acceptChanges('a',{...batch(),operations:[{opId:'edit2',revision:'2',entityId:'old',entityRevision:'2',type:'replaceText',payload:{isNew:false,entry:{...entry('edited','2'),id:'old'}}}]});
  expect(r.peek('a').entries.map((e:any)=>e.id)).toEqual(['a']);expect(r.peek('a').appliedRevision).toBe('2');r.dispose();
 });
 it('does not roll back the epoch or revision from a late socket snapshot',async()=>{
  const r=repo();r.setScope('u');await r.acceptSnapshot('a',page('2','new'));
  await r.acceptSnapshot('a',page('1','late'));expect(r.peek('a').entries[0].text).toBe('new');
  await expect(r.acceptSnapshot('a',{...page('3','old epoch'),bindingEpoch:'old'})).rejects.toMatchObject({code:'epoch_mismatch'});expect(r.peek('a').bindingEpoch).toBe('e');r.dispose();
 });
 it('fences a deleted conversation while its old response is still in flight',async()=>{
  let resolve:any;const fetch=()=>new Promise(r=>resolve=r);const r=repo({fetch});r.setScope('u');const pending=r.sync('a');
  await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));await r.invalidate('a');resolve(new Response(JSON.stringify(meta())));await pending;
  expect(r.peek('a')).toBeUndefined();expect(await r.getLocal('a')).toBeUndefined();r.dispose();
 });
 it('restores a fresh bounded snapshot when the server requires a reset',async()=>{
  const calls:string[]=[];const fetch=async(url:string)=>{calls.push(url);return url.includes('/meta')?new Response(JSON.stringify(meta('4'))):url.includes('/changes')?new Response('{}',{status:409}):new Response(JSON.stringify(page('4','fresh')));};
  const r=repo({fetch});r.setScope('u');await r.acceptSnapshot('a',page());await r.sync('a');expect(r.peek('a').entries[0].text).toBe('fresh');expect(r.peek('a').appliedRevision).toBe('4');expect(calls.filter(x=>x.includes('/page'))).toHaveLength(1);r.dispose();
 });
 it('makes progress for another conversation when one read never responds',async()=>{
  let finish:any;const fetch=async(url:string)=>url.includes('/a/')?await new Promise(r=>finish=r):new Response(JSON.stringify(url.includes('/meta')?{...meta(),conversationId:'b'}:{...page(),conversationId:'b'}));
  const r=repo({fetch});r.setScope('u');const a=r.sync('a');await r.sync('b');expect(r.peek('b').appliedRevision).toBe('1');r.setScope('v');finish(new Response(JSON.stringify(meta())));await a;r.dispose();
 });
 it('persists receipt digests instead of tool payload secrets',async()=>{
  const indexedDB=new IDBFactory(),r=repo({indexedDB});r.setScope('u');await r.acceptSnapshot('a',page());
  await r.acceptChanges('a',{...batch(),operations:[{opId:'tool2',revision:'2',entityId:'t',entityRevision:'2',type:'upsertTool',payload:{entry:{id:'t',kind:'tool',name:'tool',args:{token:'PRIVATE_SECRET'},result:'safe',entityRevision:'2'}}}]});
  const disk=await r.store.read('u','a',()=>true);expect(JSON.stringify([...disk.receipts.values()])).not.toContain('PRIVATE_SECRET');expect([...disk.receipts.values()][0]).toMatch(/^[a-f0-9]{64}$/);r.dispose();
 });
 it('resnapshots on external reorder metadata without claiming the old ordering is current',async()=>{
  const reordered={...batch(),operations:[{opId:'metadata2',revision:'2',type:'setMetadata',payload:{pagesInvalidated:true}}]};
  const fetch=async(url:string)=>new Response(JSON.stringify(url.includes('/meta')?meta('2'):url.includes('/changes')?reordered:page('2','reordered')));
  const r=repo({fetch});r.setScope('u');await r.acceptSnapshot('a',page());await r.sync('a');expect(r.peek('a').entries[0].text).toBe('reordered');r.dispose();
 });
});

describe('foreground sync capacity',()=>{
 it('reserves an actual read slot for foreground work while background reads hang',async()=>{
  const pool=new BoundedReadPool({concurrency:2});let resolve:any;
  const first=pool.run('background1',()=>new Promise(r=>resolve=r),{priority:3,timeoutMs:1000});const secondTask=vi.fn(async()=>2);const second=pool.run('background2',secondTask,{priority:3,timeoutMs:1000});
  expect(await pool.run('foreground',async()=>3,{priority:0})).toBe(3);expect(secondTask).not.toHaveBeenCalled();resolve(1);await first;expect(await second).toBe(2);pool.close();
 });
});

describe('repository authentication revocation',()=>{
 it('revokes identity and notifies the controller exactly once on a read-only 401',async()=>{
  const onUnauthorized=vi.fn(),r=repo({fetch:async()=>new Response('{}',{status:401}),onUnauthorized});r.setScope('u');await r.acceptSnapshot('a',page());
  await r.sync('a');expect(onUnauthorized).toHaveBeenCalledOnce();expect(r.scope).toBeUndefined();expect(r.peek('a')).toBeUndefined();await r.sync('a');expect(onUnauthorized).toHaveBeenCalledOnce();r.dispose();
 });
 it('revokes identity when an older page request receives a 401',async()=>{
  const onUnauthorized=vi.fn(),r=repo({fetch:async()=>new Response('{}',{status:401}),onUnauthorized});r.setScope('u');await r.acceptSnapshot('a',page());
  await expect(r.loadOlder('a','old')).rejects.toMatchObject({code:'unauthorized'});expect(onUnauthorized).toHaveBeenCalledOnce();expect(r.peek('a')).toBeUndefined();r.dispose();
 });
});

describe('hostile or incompatible revision batches',()=>{
 it('rejects cross-epoch changes even when the numerical revision is continuous',async()=>{
  const r=repo();r.setScope('u');await r.acceptSnapshot('a',page());
  await expect(r.acceptChanges('a',{...batch(),bindingEpoch:'other'})).rejects.toMatchObject({code:'epoch_mismatch'});expect(r.peek('a').entries[0].text).toBe('a');expect(r.peek('a').appliedRevision).toBe('1');r.dispose();
 });
 for (const [field,value] of [['baseEntityRevision','0'],['baseLength',2],['encoding','utf-8']] as const) it(`rejects appendText with a mismatched ${field}`,async()=>{
  const r=repo();r.setScope('u');await r.acceptSnapshot('a',page());
  const op={opId:'append2',revision:'2',entityId:'a',entityRevision:'2',type:'appendText',payload:{text:'b',baseEntityRevision:'1',baseLength:1,encoding:'utf-16',[field]:value}};
  await expect(r.acceptChanges('a',{...batch(),operations:[op]})).rejects.toMatchObject({code:'entity_reset_required'});expect(r.peek('a').entries[0].text).toBe('a');expect(r.peek('a').appliedRevision).toBe('1');r.dispose();
 });
 it('refuses unknown semantic operations without advancing the watermark',async()=>{
  const r=repo();r.setScope('u');await r.acceptSnapshot('a',page());
  await expect(r.acceptChanges('a',{...batch(),operations:[{opId:'unknown2',revision:'2',type:'futureOperation',payload:{}}]})).rejects.toMatchObject({code:'unknown_operation'});expect(r.peek('a').appliedRevision).toBe('1');r.dispose();
 });
 it('rejects future cursors and a batch whose operation does not reach its watermark',async()=>{
  const r=repo();r.setScope('u');await r.acceptSnapshot('a',page());
  await expect(r.acceptChanges('a',{...batch(),headRevision:'1'})).rejects.toMatchObject({code:'future_revision'});
  await expect(r.acceptChanges('a',{...batch(),throughRevision:'3',headRevision:'3'})).rejects.toMatchObject({code:'revision_gap'});expect(r.peek('a').appliedRevision).toBe('1');r.dispose();
 });
});

describe('transactional cache failure boundaries',()=>{
 it('does not advance the durable watermark when a transaction fails',async()=>{
  const indexedDB=new IDBFactory(),a=repo({indexedDB});a.setScope('u');await a.acceptSnapshot('a',page());
  const database=await a.store._open();const original=database.transaction.bind(database);database.transaction=()=>{throw new Error('disk full');};
  await a.acceptChanges('a',batch());expect(a.peek('a').appliedRevision).toBe('2');expect(a.peek('a').durableRevision).toBe('1');expect(a.peek('a').persistent).toBe(false);
  database.transaction=original;const b=repo({indexedDB});b.setScope('u');expect((await b.getLocal('a')).appliedRevision).toBe('1');expect(b.peek('a').durableRevision).toBe('1');a.dispose();b.dispose();
 });
 it('treats a missing entity row as a cache miss instead of a synchronized partial window',async()=>{
  const indexedDB=new IDBFactory(),a=repo({indexedDB});a.setScope('u');await a.acceptSnapshot('a',page());const database=await a.store._open();
  await new Promise<void>((resolve,reject)=>{const tx=database.transaction(['entities'],'readwrite');tx.objectStore('entities').clear();tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});
  const b=repo({indexedDB});b.setScope('u');expect(await b.getLocal('a')).toBeUndefined();a.dispose();b.dispose();
 });
 it('evicts the oldest persisted pages under a page budget, retaining the latest tail',async()=>{
  let clock=1;const r=repo({maxPages:2,now:()=>clock++});r.setScope('u');await r.acceptSnapshot('a',page());
  for(const cursor of ['one','two','three'])await r.store.putPage('u','a',cursor,{...page(),entries:[entry(cursor)]},()=>true);
  expect(await r.store.readPage('u','a','e','one',()=>true)).toBeUndefined();expect((await r.store.readPage('u','a','e','three',()=>true)).entries[0].text).toBe('three');
  expect((await r.store.read('u','a',()=>true)).state.entries[0].text).toBe('a');r.dispose();
 });
 it('never loads historical pages during background tail synchronization',async()=>{
  const fetch=vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes('/meta')?meta('2'):batch())));const r=repo({fetch});r.setScope('u');await r.acceptSnapshot('a',page());await r.sync('a');
  expect(fetch.mock.calls.some(([url])=>url.includes('/page'))).toBe(false);expect(r.peek('a').entries[0].text).toBe('b');r.dispose();
 });
});

describe('authenticated response partition proof',()=>{
 for(const userScope of [undefined,'another-user']) it(`rejects a read with ${userScope===undefined?'missing':'mismatched'} server-authenticated scope`,async()=>{
  const onUnauthorized=vi.fn(),fetch=async()=>new Response(JSON.stringify({...meta(),userScope}));const r=repo({fetch,onUnauthorized});r.setScope('u');await r.acceptSnapshot('a',page());
  await r.sync('a');expect(onUnauthorized).toHaveBeenCalledOnce();expect(r.scope).toBeUndefined();expect(r.peek('a')).toBeUndefined();r.dispose();
 });
 it('clears current-scope records and fences in-flight writes without logging the user out',async()=>{
  const indexedDB=new IDBFactory();let finish:any;const r=repo({indexedDB,fetch:()=>new Promise(resolve=>finish=resolve)});r.setScope('u');await r.acceptSnapshot('a',page());const pending=r.sync('a');
  await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));await r.clear();expect(r.scope).toBe('u');finish(new Response(JSON.stringify(meta('2'))));await pending;
  expect(r.peek('a')).toBeUndefined();const b=repo({indexedDB});b.setScope('u');expect(await b.getLocal('a')).toBeUndefined();r.dispose();b.dispose();
 });
});
