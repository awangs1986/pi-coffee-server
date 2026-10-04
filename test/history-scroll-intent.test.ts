// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {ConversationSyncView} from '../public/conversation-sync-view.js';
const views:any[]=[];afterEach(()=>{for(const view of views.splice(0))view.dispose();document.body.replaceChildren();});
function fixture(){
 const root=document.createElement('div');document.body.append(root);
 const loadOlder=vi.fn(async()=>({entries:Array.from({length:20},(_,i)=>({kind:'assistant',id:'old-'+i,entityRevision:'1',text:'o'.repeat(8000)})),olderCursor:null}));
 const view=new ConversationSyncView({container:root,scroller:root,repository:{loadOlder},context:()=>({conversationId:'b'})});views.push(view);view.select('b');
 const entries=[...Array.from({length:7},(_,i)=>({kind:'assistant',id:'m'+i,entityRevision:'1',text:'x'.repeat(8000)})),{kind:'assistant',id:'latest',entityRevision:'1',text:'LATEST_NATIVE_REPLY'}];
 const state={conversationId:'b',bindingEpoch:'epoch',appliedRevision:'1',runState:'settled',olderCursor:'older',entries};
 view.show(state);return {root,view,loadOlder,state};
}
it('keeps latest history visible when layout/scroll restoration emits a scroll event',async()=>{
 const {root,loadOlder}=fixture();await vi.waitFor(()=>expect(root.textContent).toContain('LATEST_NATIVE_REPLY'));
 root.scrollTop=0;root.dispatchEvent(new Event('scroll'));await new Promise(r=>setTimeout(r,80));
 expect(root.textContent?.includes('LATEST_NATIVE_REPLY')).toBe(true);expect(loadOlder).not.toHaveBeenCalled();
});
it.each(['wheel','keyboard','button'])('still loads older history for explicit %s navigation',async input=>{
 const {root,loadOlder}=fixture();await vi.waitFor(()=>expect(root.textContent).toContain('LATEST_NATIVE_REPLY'));
 if(input==='wheel')root.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true}));
 else if(input==='keyboard')root.dispatchEvent(new KeyboardEvent('keydown',{key:'PageUp',bubbles:true}));
 else root.querySelector<HTMLButtonElement>('.history-page-trigger')!.click();
 root.dispatchEvent(new Event('scroll'));await vi.waitFor(()=>expect(loadOlder).toHaveBeenCalledOnce());
});

it('does not carry reader input intent across conversation selection',async()=>{
 const {root,view,loadOlder,state}=fixture();await vi.waitFor(()=>expect(root.textContent).toContain('LATEST_NATIVE_REPLY'));
 root.scrollTop=500;root.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true}));
 view.select('c');view.show({...state,conversationId:'c'});root.scrollTop=0;root.dispatchEvent(new Event('scroll'));
 await new Promise(r=>setTimeout(r,40));expect(loadOlder).not.toHaveBeenCalled();
});
