import {it,expect,vi} from 'vitest';
import {InputQueue} from '../src/host/input-queue.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
it('delivers edited inputs in order once, retains images, and rejects actions after delivery',async()=>{
 let busy=true;const deliver=vi.fn(async()=>{busy=true;});
 const queue=new InputQueue({busy:()=>busy,validate:async()=>{},deliver,changed:()=>{}});
 const image={type:'image' as const,mimeType:'image/png',data:'aGVsbG8='};
 await queue.add('one',[image]);await queue.add('two');const first=queue.items[0];
 await queue.change({...first,action:'edit',text:'changed'});busy=false;queue.wake();await tick();
 expect(deliver.mock.calls[0]).toEqual(['changed',[image],false]);expect(queue.items.map(i=>i.text)).toEqual(['two']);
 await expect(queue.change({...first,action:'promote'})).rejects.toThrow('已开始');
 busy=false;queue.wake();await tick();expect(deliver.mock.calls).toHaveLength(2);expect(queue.items).toEqual([]);
});
it('retains uncertain deliveries and blocks automatic retry or overtaking',async()=>{
 const deliver=vi.fn(async()=>{throw Error('Transport lost');});let busy=true;
 const queue=new InputQueue({busy:()=>busy,validate:async()=>{},deliver,changed:()=>{}});
 await queue.add('one');await queue.add('two');busy=false;queue.wake();await tick();await tick();
 expect(queue.items[0]).toMatchObject({text:'one',status:'failed'});expect(deliver).toHaveBeenCalledTimes(1);
 queue.wake();await tick();expect(deliver).toHaveBeenCalledTimes(1);
 await queue.change({...queue.items[0],action:'edit',text:'keep draft'});await tick();expect(deliver).toHaveBeenCalledTimes(1);
 deliver.mockImplementation(async()=>{busy=true;});await queue.change({...queue.items[0],action:'cancel'});await tick();
 expect(deliver.mock.calls[1]).toEqual(['two',undefined,false]);
});
it('does not edit a different revision after asynchronous validation and never promotes twice',async()=>{
 let validate:()=>Promise<void>=async()=>{};let release!:()=>void;const deliver=vi.fn(()=>new Promise<void>(resolve=>{release=resolve;}));
 const queue=new InputQueue({busy:()=>true,validate:()=>validate(),deliver,changed:()=>{}});
 await queue.add('one');const item=queue.items[0];let finish!:()=>void;validate=()=>new Promise<void>(resolve=>{finish=resolve;});
 const edit=queue.change({...item,action:'edit',text:'late'});await queue.change({...item,action:'cancel'});finish();await expect(edit).rejects.toThrow('已开始');
 validate=async()=>{};await queue.add('next');const row=queue.items[0];const promoted=queue.change({...row,action:'promote'});
 await expect(queue.change({...row,action:'promote'})).rejects.toThrow('已开始');release();await promoted;expect(deliver).toHaveBeenCalledTimes(1);
});
it('does not resurrect pending validation after Stop clears the queue',async()=>{
 let finish!:()=>void;const queue=new InputQueue({busy:()=>true,validate:()=>new Promise<void>(resolve=>{finish=resolve;}),deliver:async()=>{},changed:()=>{}});
 const adding=queue.add('late');queue.clear();finish();await expect(adding).rejects.toThrow('stopped');expect(queue.items).toEqual([]);
});

it('serves at most three queued foreground inputs before a notification and never runs two writers',async()=>{
 let busy=true;const order:string[]=[];
 const queue=new InputQueue({busy:()=>busy,validate:async()=>{},deliver:async text=>{order.push(text);busy=true;},changed:()=>{}});
 queue.addInternal('report',async()=>{order.push('report');busy=true;},async()=>{});
 for(let n=1;n<=5;n++)await queue.add('user-'+n);
 for(let n=0;n<6;n++){busy=false;queue.wake();await tick();await tick();}
 expect(order).toEqual(['user-1','user-2','user-3','report','user-4','user-5']);
});
it('keeps failed foreground input for inspection without starving an independent pending report',async()=>{
 let busy=true;const delivered:string[]=[];
 const queue=new InputQueue({busy:()=>busy,validate:async()=>{},deliver:async()=>{throw Error('Uncertain user delivery');},changed:()=>{}});
 await queue.add('uncertain foreground');busy=false;queue.wake();await tick();await tick();
 queue.addInternal('safe notification',async()=>{delivered.push('notification');},async()=>{});await tick();await tick();
 expect(delivered).toEqual(['notification']);expect(queue.items).toMatchObject([{text:'uncertain foreground',status:'failed'}]);
});

it('restores durable queued text/images paused and never replays after process replacement',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {QueueStore}=await import('../src/host/queue-store.js');
 const root=await mkdtemp(join(tmpdir(),'coffee-queue-recovery-'));try{
 const store=new QueueStore(root),deliver=vi.fn(async()=>{});
 const options={busy:()=>true,validate:async()=>{},deliver,changed:()=>{},persist:(rows:any[])=>store.write('task-a',rows)};
 const first=new InputQueue(options);await first.add('retain this',[{type:'image',mimeType:'image/png',data:'aGVsbG8='}],'request-a');
 const second=new InputQueue({...options,busy:()=>false});second.restore(await store.read('task-a'));second.wake();await tick();
 expect(second.items).toMatchObject([{text:'retain this',status:'failed',imageCount:1}]);expect(deliver).not.toHaveBeenCalled();
 await second.change({...second.items[0],action:'promote'});expect(deliver).toHaveBeenCalledWith('retain this',[{type:'image',mimeType:'image/png',data:'aGVsbG8='}],true,'request-a');
 expect(await store.read('task-a')).toEqual([]);expect(await store.read('task-b')).toEqual([]);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('does not deliver an input when its sending checkpoint fails',async()=>{
 const deliver=vi.fn(async()=>{});let fail=false;
 const q=new InputQueue({busy:()=>true,validate:async()=>{},deliver,changed:()=>{},persist:async()=>{if(fail)throw Error('disk unavailable');}});
 await q.add('must stay recoverable');fail=true;
 await expect(q.change({...q.items[0],action:'promote'})).rejects.toThrow('disk unavailable');
 expect(deliver).not.toHaveBeenCalled();expect(q.items[0].status).toBe('failed');
});
it('persists cancellation before acknowledging it and fails closed on corrupt recovery',async()=>{
 const {mkdtemp,rm,writeFile,readdir,stat}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {QueueStore}=await import('../src/host/queue-store.js');
 const root=await mkdtemp(join(tmpdir(),'coffee-queue-cancel-'));try{
 const store=new QueueStore(root);const q=new InputQueue({busy:()=>true,validate:async()=>{},deliver:async()=>{},changed:()=>{},persist:rows=>store.write('task',rows)});
 await q.add('cancel');await q.change({...q.items[0],action:'cancel'});expect(await store.read('task')).toEqual([]);
 const path=join(root,(await readdir(root))[0]);expect((await stat(path)).mode&0o777).toBe(0o600);
 await writeFile(path,'broken');await expect(store.read('task')).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
});
it('withholds admission confirmation until the queued payload is durable',async()=>{
 let finish!:()=>void;const accepted=vi.fn(),changed=vi.fn();
 const q=new InputQueue({busy:()=>true,validate:async()=>{},deliver:async()=>{},changed,persist:()=>new Promise<void>(resolve=>{finish=resolve;})});
 const adding=q.add('durable before acknowledgement',undefined,'receipt',accepted);await tick();
 expect(accepted).not.toHaveBeenCalled();expect(changed).not.toHaveBeenCalled();
 finish();await adding;expect(accepted).toHaveBeenCalledTimes(1);expect(changed).toHaveBeenCalledTimes(1);
});
