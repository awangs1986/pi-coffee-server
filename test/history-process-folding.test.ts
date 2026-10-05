// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {ConversationSyncView} from '../public/conversation-sync-view.js';
import {renderConversationPreview} from '../public/conversation-preview-view.js';
const views:any[]=[];
afterEach(()=>{for(const v of views.splice(0))v.dispose();document.body.replaceChildren();});
const entries=[{id:'u',kind:'user',entityRevision:'1',text:'Please fix this'},...Array.from({length:12},(_,i)=>({id:'t'+i,kind:'tool',entityRevision:'1',name:'bash',status:'completed',result:'PROCESS-'+i,text:'PROCESS-'+i})),{id:'a',kind:'assistant',entityRevision:'1',text:'The fix is ready'}];
function root(){const r=document.createElement('div');document.body.append(r);return r;}
it('folds the cached/older preview process while keeping dialogue visible',()=>{
 const r=root();renderConversationPreview(r,{entries},{cached:false});
 expect(r.querySelectorAll(':scope > [data-preview-kind="tool"]')).toHaveLength(0);
 const group=r.querySelector<HTMLDetailsElement>('details.activity')!;expect(group).not.toBeNull();expect(group.open).toBe(false);
 expect(group.querySelector('summary')!.textContent).toContain('12');
 expect(r.querySelectorAll(':scope > .msg')).toHaveLength(2);
 group.open=true;expect(group.textContent).toContain('PROCESS-11');
});
it('groups durable history and preserves expansion during metadata updates',async()=>{
 const r=root();const view=new ConversationSyncView({container:r,scroller:r,repository:{},context:()=>({conversationId:'task'})});views.push(view);view.select('task');
 const state={conversationId:'task',bindingEpoch:'epoch',runState:'settled',entries};view.show(state);
 await vi.waitFor(()=>expect(r.textContent).toContain('The fix is ready'));
 expect(r.querySelectorAll('.synced-transcript > .tool')).toHaveLength(0);
 const group=r.querySelector<HTMLDetailsElement>('details.activity')!;expect(group).not.toBeNull();expect(group.open).toBe(false);expect(group.querySelectorAll('.tool')).toHaveLength(12);
 expect(r.querySelectorAll('.synced-transcript > .msg')).toHaveLength(2);
 group.open=true;view.show({...state,entries:entries.map(e=>e.id==='t1'?{...e,entityRevision:'2',result:'UPDATED'}:e)});
 await vi.waitFor(()=>expect(r.querySelector('[data-entity-id="t1"]')?.getAttribute('data-entity-revision')).toBe('2'));
 expect(r.querySelector('details.activity')).toBe(group);expect(group.open).toBe(true);expect(view.entries).toHaveLength(14);
});

it('folds a newly loaded indexed older page without hiding either dialogue boundary',async()=>{
 const r=root(),loadOlder=vi.fn(async()=>({entries,olderCursor:null}));
 const view=new ConversationSyncView({container:r,scroller:r,repository:{loadOlder},context:()=>({conversationId:'task'})});views.push(view);view.select('task');
 view.show({conversationId:'task',bindingEpoch:'epoch',runState:'settled',olderCursor:'older',entries:[{id:'latest',kind:'assistant',entityRevision:'1',text:'LATEST'}]});
 await view.older();await vi.waitFor(()=>expect(r.querySelectorAll('.history-process .tool')).toHaveLength(12));
 expect(r.querySelector<HTMLDetailsElement>('.history-process')!.open).toBe(false);
 // Dialogue rows are scheduled independently; rendered tools do not imply the final reply is rendered.
 await vi.waitFor(()=>expect([...r.querySelectorAll('.synced-transcript > .msg')].map(n=>n.textContent)).toEqual([expect.stringContaining('Please fix this'),expect.stringContaining('The fix is ready'),expect.stringContaining('LATEST')]));
 expect(loadOlder).toHaveBeenCalledOnce();
});
