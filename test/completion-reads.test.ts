import {describe,it,expect} from 'vitest';
// @ts-expect-error Browser module is tested at its public interface.
import {CompletionReads,completionKey} from '../public/completion-reads.js';

describe('completion acknowledgement',()=>{
  const session=(id='same-task',completionId='run-1')=>({id,completionId,runStatus:'settled',running:false});
  function fixture(){
    const values=new Map();
    return {get length(){return values.size;},key:(index:number)=>[...values.keys()][index],removeItem:(key:string)=>values.delete(key),getItem:(key:string)=>values.get(key),setItem:(key:string,value:string)=>values.set(key,value)};
  }
  it('persists the viewed completion, and a later completion remains unread',()=>{
    const storage=fixture(),reads=new CompletionReads({getStorage:()=>storage});reads.setScope('alice');
    expect(reads.unread(session())).toBe(true);
    expect(reads.read(session(),'run-1')).toBe(true);
    const restored=new CompletionReads({getStorage:()=>storage});restored.setScope('alice');
    expect(restored.unread(session())).toBe(false);
    expect(restored.unread(session('same-task','run-2'))).toBe(true);
    expect(restored.read(session('same-task','run-2'),'run-1')).toBe(false);
  });
  it('isolates identities and survives unavailable or corrupt browser storage',()=>{
    const storage=fixture(),reads=new CompletionReads({getStorage:()=>storage});reads.setScope('alice');reads.read(session(),'run-1');
    reads.setScope('bob');expect(reads.unread(session())).toBe(true);
    reads.setScope('alice');expect(reads.unread(session())).toBe(false);
    const memory=new CompletionReads({getStorage:()=>{throw Error('private browser');}});memory.setScope('alice');
    expect(memory.read(session(),'run-1')).toBe(true);expect(memory.unread(session())).toBe(false);
    const corrupt=new CompletionReads({getStorage:()=>({getItem:()=>'{broken'})});corrupt.setScope('alice');expect(corrupt.unread(session())).toBe(true);
  });
  it('does not lose another tab receipt when storage writes interleave',()=>{
    const values=new Map<string,string>();let interleave:(()=>void)|undefined;
    const storage={get length(){return values.size;},key:(index:number)=>[...values.keys()][index],getItem:(key:string)=>values.get(key),removeItem:(key:string)=>values.delete(key),setItem:(key:string,value:string)=>{const hook=interleave;interleave=undefined;hook?.();values.set(key,value);}};
    const a=new CompletionReads({getStorage:()=>storage}),b=new CompletionReads({getStorage:()=>storage});a.setScope('alice');b.setScope('alice');
    interleave=()=>a.read(session('first','run-1'),'run-1');
    b.read(session('second','run-1'),'run-1');
    const reload=new CompletionReads({getStorage:()=>storage});reload.setScope('alice');
    expect(reload.unread(session('first','run-1'))).toBe(false);expect(reload.unread(session('second','run-1'))).toBe(false);
  });
  it('never treats running, interrupted or never-run conversations as unread completion',()=>{
    expect(completionKey({...session(),running:true})).toBeNull();
    expect(completionKey({...session(),runStatus:'interrupted',attention:'finished'})).toBeNull();
    expect(completionKey({id:'untouched',running:false})).toBeNull();
    expect(completionKey({id:'legacy',attention:'finished',updatedAt:'stable'})).toBe('legacy:stable');
  });
  it('merges different tabs without overwriting other conversations or newer completion receipts',()=>{
    const storage=fixture(),a=new CompletionReads({getStorage:()=>storage}),b=new CompletionReads({getStorage:()=>storage});
    a.setScope('alice');b.setScope('alice');
    a.read(session('first','result-2'),'result-2');
    b.read(session('second','result-1'),'result-1');
    b.read(session('first','result-1'),'result-1');
    const reload=new CompletionReads({getStorage:()=>storage});reload.setScope('alice');
    expect(reload.unread(session('first','result-2'))).toBe(false);
    expect(reload.unread(session('second','result-1'))).toBe(false);
  });
  it('uses the account receipt in an empty browser and migrates only locally viewed current completions',async()=>{
    const storage=fixture(),a=new CompletionReads({getStorage:()=>storage});a.setScope('alice');a.read(session(),'run-1');
    const requests:any[]=[];await a.sync([session(),session('never-read','run-1')],async(reads:any[])=>{requests.push(reads);return {reads};});
    expect(requests).toEqual([[{id:'same-task',completionId:'run-1'}]]);
    await a.sync([session()],async()=>{throw Error('Already published');});
    const b=new CompletionReads({getStorage:()=>fixture()});b.setScope('alice');
    expect(b.unread({...session(),readCompletionId:'run-1'})).toBe(false);
    expect(b.unread({...session('same-task','run-2'),readCompletionId:'run-1'})).toBe(true);
    expect(b.unread(session())).toBe(true);
  });
  it('does not repeat rejected stale/native-only receipts after a scoped Host response',async()=>{
    const reads=new CompletionReads({getStorage:()=>fixture()});reads.setScope('alice');reads.read(session(),'run-1');
    let calls=0;const publish=async()=>{calls++;return {reads:[]};};
    await reads.sync([session()],publish);await reads.sync([session()],publish);expect(calls).toBe(1);
  });
  it('retries a failed receipt publication and does not inherit another account in flight',async()=>{
    const reads=new CompletionReads({getStorage:()=>fixture()});reads.setScope('alice');reads.read(session(),'run-1');
    await expect(reads.sync([session()],async()=>{throw Error('offline');})).rejects.toThrow('offline');
    let finish:any;const pending=reads.sync([session()],()=>new Promise(r=>{finish=r;}));
    reads.setScope('bob');finish({reads:[{id:'same-task',completionId:'run-1'}]});await pending;
    expect(reads.unread(session())).toBe(true);
  });

  it('drains a second viewed completion recorded while the first publication is in flight',async()=>{
    const reads=new CompletionReads({getStorage:()=>fixture()});reads.setScope('alice');reads.read(session('a'),'run-1');
    const requests:any[]=[];let release:any;
    const publish=async(batch:any[])=>{requests.push(batch);if(requests.length===1)await new Promise(r=>{release=r;});return {reads:batch};};
    const first=reads.sync([session('a'),session('b')],publish);
    reads.read(session('b'),'run-1');await reads.sync([session('a'),session('b')],publish);
    release();await first;
    expect(requests).toEqual([[{id:'a',completionId:'run-1'}],[{id:'b',completionId:'run-1'}]]);
  });

});
