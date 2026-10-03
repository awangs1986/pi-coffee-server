import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ConversationIndex} from '../src/host/conversation-index.js';
import type {AgentSessionFactory} from '../src/host/agent-adapter.js';
const roots:string[]=[];const indexes:ConversationIndex[]=[];
async function make(options:any={}) {const root=options.root??await mkdtemp(join(tmpdir(),'conversation-index-'));if(!roots.includes(root))roots.push(root);const index=new ConversationIndex({root,userScope:'alice',factory:{} as AgentSessionFactory,auditIntervalMs:0,...options});indexes.push(index);return {index,root};}
afterEach(async()=>{for(const i of indexes.splice(0))await i.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const entry=(id:string,text=id)=>({id,kind:'assistant',text});
describe('durable conversation display index',()=>{
 it('persists epochs/revisions and scopes the same conversation ID to its user',async()=>{
  const {index,root}=await make();await index.reconcile('c',[entry('a','private')]);const first=await index.meta('c');await index.close();
  const reopened=(await make({root})).index;expect(await reopened.meta('c')).toEqual(first);expect((await reopened.page('c')).entries[0].text).toBe('private');
  const bob=(await make({root,userScope:'bob'})).index;expect((await bob.page('c')).entries).toEqual([]);expect((await bob.meta('c')).bindingEpoch).not.toBe(first.bindingEpoch);
 });
 it('rolls back entity, log and head together when an audit fails mid-transaction',async()=>{
  const {index}=await make();await index.reconcile('c',[entry('a','before')]);const before=await index.meta('c');
  await expect(index.reconcile('c',[entry('a','after'),entry('a','duplicate')])).rejects.toMatchObject({code:'duplicate_entity'});
  expect(await index.meta('c')).toEqual(before);expect((await index.page('c')).entries[0].text).toBe('before');
 });
 it('bounds latest/older pages and long content in UTF-8 wire bytes, with stable IDs',async()=>{
  const {index}=await make();const text='🪴\\"\n'.repeat(50000);await index.reconcile('c',Array.from({length:100},(_,i)=>entry('m'+i,i===99?text:'hello')));
  const page=await index.page('c',{limitBytes:16000});expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(16000);expect(page.entries.at(-1).id).toBe('m99');expect(page.entries.at(-1).contentTruncated).toBe(true);
  const anchored=await index.page('c',{anchorEntityId:'m50'});expect(anchored.entries.at(-1).id).toBe('m50');expect(anchored.anchorAdjusted).toBe(false);expect((await index.page('c',{anchorEntityId:'deleted'})).anchorAdjusted).toBe(true);
  const older=await index.page('c',{cursor:page.olderCursor,limitBytes:16000});expect(new Set([...page.entries,...older.entries].map(e=>e.id)).size).toBe(page.entries.length+older.entries.length);
  let restored='',offset=0;const large=page.entries.at(-1);while(offset<text.length){const part=await index.content('c',{bindingEpoch:page.bindingEpoch,entityId:large.id,entityRevision:large.entityRevision,offset,limitBytes:8192});expect(Buffer.byteLength(JSON.stringify(part))).toBeLessThanOrEqual(8192);expect(part.nextOffset).toBeGreaterThan(offset);restored+=part.text;offset=part.nextOffset;}expect(restored).toBe(text);
 });
 it('emits edits, tombstones and ordering invalidation; rejects stale pages and future revisions',async()=>{
  const {index}=await make();await index.reconcile('c',Array.from({length:50},(_,i)=>entry('m'+i)));const page=await index.page('c');
  await index.reconcile('c',[entry('m0','changed'),...Array.from({length:48},(_,i)=>entry('m'+(i+2)))]);
  const changes=await index.changes('c',{bindingEpoch:page.bindingEpoch,afterRevision:page.baseRevision});
  expect(changes.operations.find(o=>o.entityId==='m0')).toMatchObject({type:'replaceText',payload:{isNew:false,entry:{text:'changed'}}});expect(changes.operations.some(o=>o.type==='deleteEntity'&&o.entityId==='m1')).toBe(true);expect(changes.operations.at(-1)).toMatchObject({type:'setMetadata',payload:{pagesInvalidated:true}});
  await expect(index.page('c',{cursor:page.olderCursor})).rejects.toMatchObject({code:'reset_required'});await expect(index.changes('c',{bindingEpoch:page.bindingEpoch,afterRevision:'999999'})).rejects.toMatchObject({code:'reset_required'});
 });
 it('changes epoch on rebinding and keeps deletion tombstones against late work',async()=>{
  const {index}=await make();await index.reconcile('c',[entry('a')],{binding:'pi:first'});const first=await index.meta('c');await index.reconcile('c',[entry('b')],{binding:'codex:second'});expect((await index.meta('c')).bindingEpoch).not.toBe(first.bindingEpoch);
  await index.remove('c');await expect(index.reconcile('c',[entry('late')])).rejects.toMatchObject({code:'conversation_deleted'});
 });
 it('moves the bounded visible tail during long streaming and rejects wrong content identity/version',async()=>{
  const {index}=await make();await index.reconcile('c',[entry('a','x'.repeat(225000)+'before')]);const page=await index.page('c');const item=page.entries[0];expect(item.text.endsWith('before')).toBe(true);expect(item.contentOffset).toBeGreaterThan(0);expect(item.contentOffset+item.text.length).toBe(item.contentLength);
  await expect(index.content('c',{bindingEpoch:'wrong',entityId:'a',entityRevision:item.entityRevision})).rejects.toMatchObject({code:'reset_required'});
  await expect(index.content('c',{bindingEpoch:page.bindingEpoch,entityId:'a',entityRevision:'999'})).rejects.toMatchObject({code:'entity_changed'});
  index.event('c',{type:'message_delta',id:'a',delta:' after'});await index.flush();const after=(await index.page('c')).entries[0];expect(after.text.endsWith('before after')).toBe(true);expect(after.contentOffset).toBeGreaterThan(item.contentOffset);
 });
 it('snapshots remain internally consistent while both SQLite workers serve reads and writes',async()=>{
  const {index}=await make();await index.reconcile('c',[entry('a','0')]);
  for(let i=1;i<=30;i++){const write=index.reconcile('c',[entry('a',String(i))]);const pages=Promise.all(Array.from({length:6},()=>index.page('c')));const [,values]=await Promise.all([write,pages]);for(const page of values){expect(BigInt(page.entries[0].entityRevision)).toBe(BigInt(page.baseRevision));expect(Number(page.entries[0].text)+1).toBe(Number(page.baseRevision));}}
 });
 it('requires a reset after bounded log retention and preserves the authoritative page',async()=>{
  const {index}=await make({retainBytes:1000});await index.reconcile('c',[entry('a','a'.repeat(3000)),entry('b','b'.repeat(3000))]);const meta=await index.meta('c');expect(BigInt(meta.oldestAvailableRevision)).toBeGreaterThan(0n);await expect(index.changes('c',{bindingEpoch:meta.bindingEpoch,afterRevision:'0'})).rejects.toMatchObject({code:'reset_required'});expect((await index.page('c')).entries).toHaveLength(2);
 });
 it('rejects stale audits after live writes and publishes only committed revisions',async()=>{
  const onChange=vi.fn();const {index}=await make({onChange});await index.reconcile('c',[entry('a','old')]);const before=await index.meta('c');index.event('c',{type:'message_delta',id:'a',delta:' new'});await index.flush();
  await expect(index.reconcile('c',[entry('a','stale')],{expectedEpoch:before.bindingEpoch,expectedRevision:before.headRevision})).rejects.toMatchObject({code:'stale_audit'});expect((await index.page('c')).entries[0].text).toBe('old new');expect(onChange.mock.calls.at(-1)[0].headRevision).toBe((await index.meta('c')).headRevision);
 });
 it('does not create/resume runtimes; hung reads cannot block another conversation or metadata',async()=>{
  let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;});
  const create=vi.fn(()=>{throw Error('must never create');});const readHistory=vi.fn(async id=>{if(id==='hung')await blocked;return {history:{entries:[entry('a')],leafId:'a'},binding:'source',sourceGeneration:'hash',sourceFreshness:'current',checkedAt:new Date().toISOString()};});
  const {index}=await make({factory:{create,readHistory}});
  try{await index.meta('hung');await index.meta('ready');await vi.waitFor(async()=>expect((await index.page('ready')).entries).toHaveLength(1));expect(create).not.toHaveBeenCalled();expect((await index.meta('hung')).sourceFreshness).toBe('reconciling');}finally{release();}
 });
 it('fences shutdown admission and drains accepted reads and writes without closing other indexes',async()=>{
  const {index,root}=await make();let readFinished=false;
  const reading=index.meta('cold').then(()=>{readFinished=true;});
  const writing=index.reconcile('written',[entry('a','committed before close')]);
  const closing=index.close();expect(index.close()).toBe(closing);
  await expect(index.meta('late')).rejects.toMatchObject({code:'index_closed'});
  await expect(index.reconcile('late',[entry('late')])).rejects.toMatchObject({code:'index_closed'});
  expect(()=>index.event('late',{type:'run_completed'})).not.toThrow();
  await closing;expect(readFinished).toBe(true);await reading;await writing;
  const other=(await make()).index;await other.reconcile('other',[entry('b')]);
  const reopened=(await make({root})).index;expect((await reopened.page('written')).entries[0].text).toBe('committed before close');
 });
 it('bounds ingest without throwing into execution and recovers final authoritative output after overflow',async()=>{
  const source={history:{entries:[entry('a','authoritative final')],leafId:'a'},binding:'source',sourceGeneration:'final',sourceFreshness:'current',checkedAt:new Date().toISOString()};
  const {index}=await make({factory:{readHistory:async()=>source}});index.event('c',{type:'run_started'});await index.flush();
  for(let i=0;i<40;i++)expect(()=>index.event('c',{type:'message_delta',id:'a',delta:'x'.repeat(10000)})).not.toThrow();
  index.event('c',{type:'run_completed'});await index.flush();await vi.waitFor(async()=>expect((await index.page('c')).entries[0]?.text).toBe('authoritative final'));
  expect((await index.meta('c')).runState).not.toBe('running');
  // Synchronous actor admission failures are isolated as well.
  for(let i=0;i<260;i++)expect(()=>index.event('overflow'+i,{type:'message_delta',id:'a',delta:'x'})).not.toThrow();await index.flush();
 });
 it('durably deduplicates command IDs, preserves acceptance/delivery states, and marks restart uncertainty',async()=>{
  const {index,root}=await make();await index.command('c','r1','accepted','prompt');expect((await index.commands('c',{requestId:'r1'})).commands[0].state).toBe('accepted');await index.command('c','r1','delivering');
  await expect(index.command('c','r1','accepted')).rejects.toMatchObject({code:'request_already_accepted'});await index.command('c','r2','accepted','follow_up');await index.close();
  const reopened=(await make({root})).index;expect((await reopened.commands('c')).commands.map(command=>command.state)).toEqual(['uncertain','uncertain']);await expect(reopened.command('c','r1','accepted')).rejects.toMatchObject({code:'request_already_accepted'});
  await reopened.command('c','r3','accepted');await reopened.command('c','r3','running');await reopened.command('c','r3','settled');await reopened.command('c','r3','running');expect((await reopened.commands('c',{requestId:'r3'})).commands[0].state).toBe('settled');
 });
 it('unknown native reads never replace the last good snapshot with empty history',async()=>{
  const {index}=await make({factory:{readHistory:async()=>({history:{entries:[],leafId:null},binding:'b',sourceGeneration:'',sourceFreshness:'unknown',checkedAt:''})}});await index.reconcile('c',[entry('a','keep')]);await index.meta('c');await new Promise(r=>setTimeout(r,30));expect((await index.page('c')).entries[0].text).toBe('keep');expect((await index.meta('c')).sourceFreshness).toBe('unknown');
 });
});
