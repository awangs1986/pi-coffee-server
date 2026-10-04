import {renderProcessEntries} from './history-process.js';
// A bounded projection of the durable repository. No command, approval or native
// lifetime is owned here. Old requests may populate their cache, never this view.
import {ScrollAnchor} from './scroll-anchor.js';
import {createRenderScheduler} from './render-scheduler.js';
import {assistantNode, userBubble, toolCard, noteNode, boundedTextSlice} from './render.js';

const MAX_VISIBLE = 80;
const MAX_TEXT = 64 * 1024;
const MAX_ENTRY = 8 * 1024;
const encoder = new TextEncoder();
function shortText(value, budget = MAX_ENTRY) {
  const text = typeof value === 'string' ? value : '';
  let end = Math.min(text.length, budget);
  while (end && encoder.encode(text.slice(0, end)).byteLength > budget) end = Math.floor(end * .75);
  if (end && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
  return text.slice(0, end);
}
function visibleEntries(source) {
  const output = []; let remaining = MAX_TEXT;
  for (const item of source.slice(-MAX_VISIBLE)) {
    if (!remaining) break;
    const text = shortText(item.kind === 'tool' ? item.result ?? item.text : item.text, Math.min(MAX_ENTRY, remaining));
    remaining -= encoder.encode(text).byteLength;
    output.push({...item, text, ...(item.kind === 'tool' ? {result:text,args:undefined,diff:undefined} : {})});
  }
  return output;
}
function keyOf(item) { return String(item.id ?? item.entityId); }

export class ConversationSyncView {
  constructor({container, scroller, repository, context, onRendered = () => {}, onError = () => {}}) {
    Object.assign(this,{container,scroller,repository,context,onRendered,onError});
    this.scheduler=createRenderScheduler({budgetMs:4,onError});
    this.nodes=new Map();this.processGroups=new Map();this.saved=new Map();this.generation=0;this.active=null;this.window=null;this.readingOlder=false;this.loading=false;this.olderBuffer=[];
    this.anchor=new ScrollAnchor(scroller,container,{isCurrent:()=>Boolean(this.active)});
    this.userScrollUntil=0;this.scrollbarPressed=false;
    this.scroll=()=>{
      if(this.active && (this.scrollbarPressed || Date.now()<this.userScrollUntil) && this.scroller.scrollTop<120){
        this.userScrollUntil=0;void this.older();
      }
    };
    // Layout/anchor restoration emits scroll events too. Only explicit reader
    // input may leave the latest window and enter older-history mode.
    this.scrollIntent=event=>{
      if(event.type==='wheel' && event.deltaY>=0)return;
      if(event.type==='keydown' && (!['ArrowUp','PageUp','Home'].includes(event.key) || event.target.closest?.('input,textarea,select,[contenteditable]')))return;
      this.userScrollUntil=Date.now()+1000;this.scroll();
    };
    this.scrollbarDown=event=>{if(event.target===scroller)this.scrollbarPressed=true;};
    this.scrollbarUp=()=>{if(this.scrollbarPressed)this.userScrollUntil=Date.now()+150;this.scrollbarPressed=false;};
    scroller.addEventListener('scroll',this.scroll,{passive:true});
    for(const type of ['wheel','touchmove','keydown'])scroller.addEventListener(type,this.scrollIntent,{passive:true});
    scroller.addEventListener('pointerdown',this.scrollbarDown,{passive:true});
    for(const type of ['pointerup','pointercancel'])scroller.ownerDocument.addEventListener(type,this.scrollbarUp,{passive:true});
  }
  capture() {return this.anchor.capture();}
  save() {
    if(!this.active)return;
    this.saved.delete(this.active);this.saved.set(this.active,{anchor:this.capture(),window:this.window?{...this.window,entries:this.window.entries.map(entry=>({...entry}))}:null,olderBuffer:this.olderBuffer.map(entry=>({...entry})),readingOlder:this.readingOlder});
    while(this.saved.size>5)this.saved.delete(this.saved.keys().next().value);
  }
  select(id) {
    this.userScrollUntil=0;this.scrollbarPressed=false;
    this.anchor.stopObserving();this.generation++;this.active=id;this.window=null;this.readingOlder=false;this.loading=false;this.olderBuffer=[];this.nodes.clear();this.processGroups.clear();
    this.root=null;this.scheduler.setView({...this.context(),conversationId:id,viewGeneration:this.generation});
  }
  clear() {this.select(null);this.saved.clear();}
  ensureRoot() {
    if(this.root?.isConnected)return;
    this.nodes.clear();this.processGroups.clear();
    this.root=document.createElement('div');this.root.className='synced-transcript';
    this.container.replaceChildren(this.root);
    this.earlier=document.createElement('button');this.earlier.type='button';this.earlier.className='msg-tool history-page-trigger';this.earlier.textContent='加载更早记录';this.earlier.onclick=()=>void this.older();
    this.latest=document.createElement('button');this.latest.type='button';this.latest.className='msg-tool new-message-indicator';this.latest.textContent='有新消息 · 回到最新';this.latest.hidden=true;
    this.latest.onclick=()=>{this.readingOlder=false;this.olderBuffer=[];const state=this.repository.peek(this.active);if(state)this.show(state,{force:true,follow:true});};
    this.root.append(this.earlier,this.latest);
  }
  show(state,{force=false,follow=false,details}={}) {
    if(!this.active||state.conversationId!==this.active)return;
    if(!Array.isArray(state.entries))return;
    const saved=this.saved.get(this.active);
    if(!this.window&&!force&&saved?.readingOlder&&saved.window?.bindingEpoch===state.bindingEpoch){this.readingOlder=true;this.olderBuffer=saved.olderBuffer.slice();this.show(saved.window,{force:true});this.latest.hidden=false;if(saved.window.appliedRevision!==state.appliedRevision)void this.validateHistoryWindow(state);return;}
    if(this.window&&this.window.bindingEpoch!==state.bindingEpoch){this.nodes.clear();this.processGroups.clear();this.root?.remove();this.root=null;this.readingOlder=false;this.window=null;this.scheduler.setView({...this.context(),conversationId:this.active,epoch:state.bindingEpoch,viewGeneration:this.generation});}
    if(this.readingOlder&&!force){
      this.latest.hidden=true;
      const operations=details?.operations||[];
      if(details?.reason==='invalidate'){
        this.readingOlder=false;this.olderBuffer=[];force=true;
      }else if(details?.reason==='snapshot'||details?.pagesInvalidated){
        if(this.window.appliedRevision!==state.appliedRevision)void this.validateHistoryWindow(state);
        return;
      }else{
        let changed=false;const items=new Map(this.window.entries.map(item=>[keyOf(item),item]));
        const buffered=new Map(this.olderBuffer.map(item=>[keyOf(item),item]));
        for(const op of operations){
          const target=items.has(op.entityId)?items:buffered.has(op.entityId)?buffered:null;
          if(!target){this.latest.hidden=false;continue;}
          if(op.type==='deleteEntity'){target.delete(op.entityId);changed=true;}
          else if(op.payload?.entry){target.set(op.entityId,{...op.payload.entry,entityRevision:op.entityRevision});changed=true;}
          else if(op.type==='appendText'){
            const item=target.get(op.entityId),total=op.payload.baseLength+op.payload.text.length;
            const text=boundedTextSlice((item.text??item.result??'')+op.payload.text,{tail:true,maxBytes:MAX_ENTRY}).text;
            target.set(op.entityId,{...item,text,...(item.kind==='tool'?{result:text}:{}),entityRevision:op.entityRevision,contentLength:total,contentOffset:total-text.length,contentTruncated:text.length<total});changed=true;
          }
        }
        this.olderBuffer=[...buffered.values()];
        if(changed)this.show({...this.window,entries:[...items.values()]},{force:true});
        return;
      }
    }
    const first=!this.window;const anchor=first?(this.saved.get(this.active)?.anchor||{followTail:true}):this.capture();
    this.window=state;this.ensureRoot();this.earlier.hidden=!state.olderCursor&&!this.olderBuffer.length;this.earlier.disabled=this.loading;
    const source=visibleEntries(state.entries),ids=new Set(source.map(keyOf));
    for(const [id,entry] of this.nodes)if(!ids.has(id)){this.scheduler.cancelEntity(id);entry.node.remove();this.nodes.delete(id);}
    const generation=this.generation;
    source.forEach((item,index)=>{
      const id=keyOf(item),revision=String(item.entityRevision??state.appliedRevision??state.baseRevision??'0');
      const existing=this.nodes.get(id);
      // Completion belongs to a message, not the whole conversation. A later
      // run must never turn already finished Markdown back into plain text.
      const rich=!item.contentTruncated && (item.status!=='inProgress' || state.runState!=='running');
      if(existing?.revision===revision && existing.rich===rich)return;
      const run=()=>{
        if(generation!==this.generation)return;
        const previous=this.nodes.get(id);const entry={...item,id,k:item.kind,done:item.status!=='inProgress'&&item.done!==false,revision,rich};
        entry.node=item.kind==='assistant'?assistantNode(entry,{done:rich}):item.kind==='user'?userBubble(entry):item.kind==='tool'?toolCard({...entry,name:shortText(item.name,256),result:item.result,error:item.isError}):noteNode(entry);
        if(item.kind==='tool'&&previous?.node.open)entry.node.open=true;
        entry.node.dataset.entityId=id;entry.node.dataset.entityRevision=revision;
        this.addContentControl(entry,item,generation);
        if(previous)previous.node.replaceWith(entry.node);
        this.nodes.set(id,entry);
        this.layout(source);
        this.restore(anchor,follow||anchor?.followTail);
        this.anchor.observe(anchor||this.capture());
        this.onRendered(this.entries,state);
      };
      if(first&&index===0)run();else this.scheduler.schedule({entityId:id,entityRevision:revision,priority:0,run});
    });
    this.layout(source);
    if(!source.length)this.onRendered([],state);
  }
  layout(source){
    renderProcessEntries(this.root,source.map(item=>({id:keyOf(item),kind:item.kind,error:item.isError,node:this.nodes.get(keyOf(item))?.node})),{groups:this.processGroups,end:this.latest});
  }
  async validateHistoryWindow(state){
    if(this.validating||!this.readingOlder||!this.repository.loadAround)return;
    const generation=this.generation,id=this.active,anchor=this.capture();
    if(!anchor.anchorMessageId)return;
    this.validating=true;
    try{const page=await this.repository.loadAround(id,anchor.anchorMessageId);if(generation!==this.generation||!this.readingOlder)return;this.olderBuffer=[];this.show({...page,conversationId:id},{force:true});this.restore(anchor);}
    catch(error){if(generation===this.generation)this.onError(error);}
    finally{this.validating=false;}
  }
  restore(anchor,follow=false) {this.anchor.restore(follow?{...anchor,followTail:true}:anchor);}
  addContentControl(entry,item,generation) {
    const fields=item.kind==='tool'?Object.entries(item.contentLengths||{}).filter(([key,length])=>['args','result','diff'].includes(key)&&length>0):[];
    if(!item.contentTruncated&&!fields.some(([key])=>key!=='result'))return;
    const copy=entry.node.querySelector('.msg-tools .msg-tool');if(copy){copy.textContent='复制当前段';copy.title='仅复制当前显示的正文段落';}
    const controls=document.createElement('div');controls.className='remote-content-pages';
    const label=document.createElement('span');label.className='bounded-text-range';
    let field=item.kind==='tool'?'result':undefined;
    let offset=item.contentOffset||0,end=offset+(item.text?.length||item.result?.length||0),total=item.contentLength||end;
    const previous=document.createElement('button'),next=document.createElement('button'),latest=document.createElement('button');
    for(const [button,text] of [[previous,'上一段'],[next,'下一段'],[latest,'最新内容']]){button.type='button';button.className='msg-tool content-page-trigger';button.textContent=text;}
    let remoteText=null;
    const paintRemote=()=>{if(item.kind!=='tool'||remoteText===null||!entry.node.open)return;const host=entry.node.querySelector('.tool-body');if(!host)return;const body=document.createElement('div');body.className='remote-content-body';body.style.whiteSpace='pre-wrap';body.textContent=remoteText;host.replaceChildren(body);};
    if(item.kind==='tool')entry.node.addEventListener('toggle',paintRemote);
    const update=()=>{label.textContent=`${offset+1}–${end} / ${total} 字符`;previous.disabled=offset===0;next.disabled=end>=total;latest.disabled=end>=total;};
    const read=async start=>{
      if(generation!==this.generation||controls.dataset.loading)return;
      controls.dataset.loading='true';for(const button of [previous,next,latest])button.disabled=true;
      const anchor=this.capture();
      try {
        const page=await this.repository.loadContent(this.active,item,start,field);
        if(generation!==this.generation||!entry.node.isConnected)return;
        let body=item.kind==='tool'?entry.node.querySelector('.tool-body'):entry.node.querySelector('.body,.text,.remote-content-body');
        if(!body){body=document.createElement('div');body.className='remote-content-body';entry.node.replaceChildren(body,controls);}
        entry.text=shortText(page.text);remoteText=entry.text;body.replaceChildren(document.createTextNode(entry.text));body.style.whiteSpace='pre-wrap';
        offset=page.offset;end=page.nextOffset;total=page.totalLength||total;this.restore(anchor);
      }catch(error){if(generation===this.generation)this.onError(error);}
      finally{delete controls.dataset.loading;update();}
    };
    previous.onclick=()=>void read(Math.max(0,offset-2048));next.onclick=()=>void read(end);latest.onclick=()=>void read(Math.max(0,total-2048));
    if(fields.length>1||fields.some(([key])=>key!=='result')){const select=document.createElement('select');select.className='remote-content-source';select.setAttribute('aria-label','工具内容');for(const [key] of fields){const option=document.createElement('option');option.value=key;option.textContent={args:'参数',result:'输出',diff:'差异'}[key];select.append(option);}select.value='result';select.onchange=()=>{field=select.value;offset=0;end=0;total=item.contentLengths[field];void read(0);};controls.append(select);}
    controls.append(previous,label,next,latest);entry.node.append(controls);update();
  }
  async older() {
    const cursor=this.window?.olderCursor;if((!cursor&&!this.olderBuffer.length)||this.loading||!this.active)return;
    this.loading=true;if(this.earlier)this.earlier.disabled=true;
    const id=this.active,generation=this.generation,anchor=this.capture();
    try {
      let page;
      if(!this.olderBuffer.length){
        page=await this.repository.loadOlder(id,cursor);
        if(generation!==this.generation||id!==this.active||!page)return;
        this.olderBuffer=page.entries.slice();this.window={...this.window,olderCursor:page.olderCursor};
      }
      this.readingOlder=true;
      // Reveal at most half a window above the still-visible anchor. Remaining
      // records from this fetched page are consumed before requesting another.
      const prefix=[];let size=0;
      while(this.olderBuffer.length&&prefix.length<20){
        const candidate=this.olderBuffer.at(-1),cost=encoder.encode(shortText(candidate.text??candidate.result??'')).byteLength;
        if(prefix.length&&size+cost>MAX_TEXT/2)break;
        prefix.unshift(this.olderBuffer.pop());size+=cost;
      }
      const merged=[...prefix,...this.window.entries].filter((item,index,all)=>all.findIndex(other=>keyOf(other)===keyOf(item))===index);
      let total=0;const visible=[];
      for(const item of merged){const cost=encoder.encode(shortText(item.text??item.result??'')).byteLength;if(visible.length&&(visible.length>=MAX_VISIBLE||total+cost>MAX_TEXT))break;visible.push(item);total+=cost;}
      this.show({...this.window,conversationId:id,entries:visible},{force:true});this.restore(anchor);
    }catch(error){if(generation===this.generation)this.onError(error);}
    finally{if(generation===this.generation){this.loading=false;if(this.earlier)this.earlier.disabled=false;}}
  }
  get entries() {return [...this.root?.querySelectorAll('[data-entity-id]')||[]].map(node=>this.nodes.get(node.dataset.entityId)).filter(Boolean);}
  dispose(){this.scheduler.dispose();this.anchor.disconnect();this.scroller.removeEventListener('scroll',this.scroll);for(const type of ['wheel','touchmove','keydown'])this.scroller.removeEventListener(type,this.scrollIntent);this.scroller.removeEventListener('pointerdown',this.scrollbarDown);for(const type of ['pointerup','pointercancel'])this.scroller.ownerDocument.removeEventListener(type,this.scrollbarUp);this.saved.clear();this.nodes.clear();this.processGroups.clear();}
}
