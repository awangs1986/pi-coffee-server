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
