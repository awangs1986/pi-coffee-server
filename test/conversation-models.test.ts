import {describe,it,expect} from 'vitest';
import {ConversationModels} from '../public/conversation-models.js';

function fixture(){
  const entries=new Map<string,string>();let time=Date.now();
  const storage={getItem:(key:string)=>entries.get(key)??null,setItem:(key:string,value:string)=>entries.set(key,value),removeItem:(key:string)=>entries.delete(key)};
  return {entries,storage,now:()=>time,advance:(ms:number)=>{time+=ms;}};
}
const frame={current:{provider:'codex',id:'gpt-6.1-sol'},thinkingLevel:'medium',context:{preset:'maximum'},models:[{provider:'codex',id:'gpt-6.1-sol',source:'native',secret:'DO_NOT_SAVE'}],secret:'DO_NOT_SAVE'};
describe('last-confirmed conversation display metadata',()=>{
  it('survives a new browser controller without persisting catalogs, requests or arbitrary fields',()=>{
    const f=fixture(),a=new ConversationModels({getStorage:()=>f.storage,now:f.now});a.setScope('alice');
    a.put('task',frame,{engine:'codex',fingerprint:'native-a'});
    const restored=new ConversationModels({getStorage:()=>f.storage,now:f.now});restored.setScope('alice');
    expect(restored.get('task',{engine:'codex',fingerprint:'native-a'})).toEqual({engine:'codex',fingerprint:'native-a',current:{provider:'codex',id:'gpt-6.1-sol',source:'native'},thinkingLevel:'medium',context:{preset:'maximum'}});
    expect([...f.entries.values()].join('')).not.toContain('DO_NOT_SAVE');
    const copy=restored.get('task');copy.current.id='modified-return';
    expect(restored.get('task')?.current.id).toBe('gpt-6.1-sol');
  });
  it('isolates accounts, invalidates changed engines/bindings, and clears the current account',()=>{
    const f=fixture(),s=new ConversationModels({getStorage:()=>f.storage,now:f.now});s.setScope('alice');s.put('task',frame,{engine:'codex',fingerprint:'native-a'});
    s.setScope('bob');expect(s.get('task')).toBeNull();s.setScope('alice');expect(s.get('task',{engine:'pi'})).toBeNull();
    s.put('task',frame,{engine:'codex',fingerprint:'native-a'});expect(s.get('task',{fingerprint:'native-b'})).toBeNull();
    s.put('task',frame,{engine:'codex'});s.clear();const fresh=new ConversationModels({getStorage:()=>f.storage});fresh.setScope('alice');expect(fresh.get('task')).toBeNull();
  });
  it('keeps warm navigation functional with failed storage and drops expired metadata',()=>{
    const f=fixture(),s=new ConversationModels({getStorage:()=>{throw Error('unavailable');},now:f.now});s.setScope('alice');s.put('task',frame,{engine:'codex'});
    expect(s.get('task')?.current.id).toBe('gpt-6.1-sol');f.advance(31*24*60*60*1000);expect(s.get('task')).toBeNull();
    f.storage.setItem('pi-coffee.conversation-models.v1:alice','{invalid');const fresh=new ConversationModels({getStorage:()=>f.storage});expect(()=>fresh.setScope('alice')).not.toThrow();expect(fresh.get('task')).toBeNull();
  });
  it('bounds persistent metadata while retaining recent selections and clearing a native unknown model',()=>{
    const f=fixture(),s=new ConversationModels({getStorage:()=>f.storage,now:f.now});s.setScope('alice');
    for(let n=0;n<1100;n++)s.put('task-'+n,{...frame,current:{provider:'codex',id:'gpt-'+n}},{engine:'codex'});
    expect(s.get('task-0')).toBeNull();expect(s.get('task-1099')?.current.id).toBe('gpt-1099');
    expect(new TextEncoder().encode([...f.entries.values()].join('')).byteLength).toBeLessThanOrEqual(256*1024);
    s.put('task-1099',{current:null},{engine:'codex'});expect(s.get('task-1099')).toBeNull();
  });
});
