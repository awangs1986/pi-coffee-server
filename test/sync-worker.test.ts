import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error browser module
import { SyncWorkerPool, readBoundedJSON } from '../public/sync-worker.js';
class FakeWorker {
 onmessage:any;onerror:any;onmessageerror:any;posted:any[]=[];terminated=false;
 postMessage(value:any){this.posted.push(value);}terminate(){this.terminated=true;}
 reply(value:any){this.onmessage({data:value});}
}
const context={userScope:'user',authGeneration:1,conversationId:'a'};
describe('bounded synchronization worker pool',()=>{
 it('uses at most two workers and fences result identity',async()=>{
  const workers:FakeWorker[]=[];const pool=new SyncWorkerPool({size:100,workerFactory:()=>{const w=new FakeWorker();workers.push(w);return w;}});
  const a=pool.read('/api/conversations/a/meta',context),b=pool.read('/api/conversations/a/page',context),c=pool.read('/api/conversations/a/changes',context);
  expect(workers).toHaveLength(2);workers[0].reply({requestId:1,...context,value:{headRevision:'1'}});workers[1].reply({requestId:2,...context,userScope:'other',value:{secret:true}});workers[0].reply({requestId:3,...context,value:{headRevision:'3'}});
  expect(await a).toEqual({headRevision:'1'});await expect(b).rejects.toMatchObject({code:'stale_scope'});expect(await c).toEqual({headRevision:'3'});pool.close();expect(workers.every(w=>w.terminated)).toBe(true);
 });
 it('settles crashed worker requests and recreates just that worker',async()=>{
  const workers:FakeWorker[]=[];const pool=new SyncWorkerPool({size:1,workerFactory:()=>{const w=new FakeWorker();workers.push(w);return w;}});
  const old=pool.read('/api/conversations/a/meta',context);workers[0].onerror(new Error('crash'));await expect(old).rejects.toMatchObject({code:'worker_failed'});
  const current=pool.read('/api/conversations/a/meta',context);expect(workers).toHaveLength(2);workers[1].reply({requestId:2,...context,value:'recovered'});expect(await current).toBe('recovered');pool.close();
 });
 it('rejects oversized streamed bodies before JSON parsing',async()=>{
  const cancel=vi.fn();const response=new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('x'.repeat(2048)));},cancel}));
  await expect(readBoundedJSON(async()=>response,'/api/conversations/a/page',{maxBytes:1024})).rejects.toMatchObject({code:'response_too_large'});expect(cancel).toHaveBeenCalledOnce();
 });
 it('classifies unauthorized and reset responses without retaining a response body',async()=>{
  await expect(readBoundedJSON(async()=>new Response('private',{status:401}),'url')).rejects.toMatchObject({code:'unauthorized'});
  await expect(readBoundedJSON(async()=>new Response('reset',{status:409}),'url')).rejects.toMatchObject({code:'reset_required'});
 });
});
