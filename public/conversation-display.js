// One owner chooses the visible projection. Indexed and compatibility-native
// histories are different sources; neither may repaint a later selection.
export class ConversationDisplay {
  constructor({repository,view,status,renderNative,onIndex=()=>{}}) {
    Object.assign(this,{repository,view,status,renderNative,onIndex});this.generation=0;this.recent=[];this.id=null;this.scope=null;this.mode='preview';this.hasIndex=false;
  }
  select(id) {
    this.generation++;this.unsubscribe?.();this.unsubscribe=null;
    this.id=id;this.indexed=false;this.mode='preview';this.hasIndex=false;this.view.select(id);this.status.select(id);
    if(this.scope!==this.repository.scope){this.scope=this.repository.scope;this.recent=[];}
    if(!id||!this.scope)return;
    const generation=this.generation,scope=this.scope;
    const current=()=>generation===this.generation&&scope===this.repository.scope;
    const update=(state,details={})=>{if(current())this.update(state,details);};
    this.unsubscribe=this.repository.subscribe(id,update);
    this.status.update({conversationId:id,state:'syncing'});
    const cached=this.repository.peek(id);if(cached)update(cached,{reason:'local'});
    void this.repository.getLocal(id).then(state=>{if(state&&current()&&!this.hasIndex)this.update(state,{reason:'local'});}).catch(()=>{});
    this.recent=[id,...this.recent.filter(key=>key!==id)].slice(0,5);
    this.repository.watch(this.recent);void this.repository.sync(id,{priority:0});
  }
  update(state,details) {
    if(state.conversationId!==this.id||this.mode==='native')return;
    const failed=!['cached','current','syncing'].includes(state.status);
    const status=details.reason==='local'?'syncing':failed?(state.status==='timeout'?'timeout':'error'):state.status==='syncing'?'syncing':state.sourceFreshness==='current'?'idle':'synced';
    const message=state.status==='not_found'?'对话不存在或当前账号无权访问':failed?'同步暂时失败，仍可阅读本地内容':state.sourceFreshness==='reconciling'?'对话副本已同步，原生历史核对中':state.sourceFreshness!=='current'?'对话副本已同步，原生历史尚未核对':undefined;
    this.status.update({conversationId:this.id,state:status,message});
    if(details.reason!=='status'&&state.bindingEpoch&&(state.entries?.length||state.sourceFreshness==='current')){
      this.hasIndex=true;this.view.show(state,{details});this.onIndex(state);
    }
  }
  protocol(frame) {if(frame.sessionId===this.id)this.indexed=frame.syncProtocol===2;}
  history(frame) {
    if(frame.sessionId!==this.id)return false;
    const id=this.id,generation=this.generation;
    this.indexed=frame.syncProtocol===2;
    if(this.indexed){
      this.mode='index';
      void this.repository.ingestSnapshot(id,{...frame,conversationId:id,appliedRevision:frame.baseRevision}).then(()=>{
        if(generation===this.generation)void this.repository.sync(id,{priority:0});
      }).catch(()=>{if(generation===this.generation)void this.repository.sync(id,{priority:0});});
    }else{
      this.mode='native';this.hasIndex=false;
      // Cancel queued indexed renders before the compatibility renderer takes over.
      this.view.select(id);this.status.update({conversationId:id,state:'idle'});this.renderNative(frame);
    }
    return true;
  }
  invalidate(id){if(id!==this.id)return;this.hasIndex=false;this.mode='preview';this.view.select(id);}
  preview(render) {if(this.mode!=='preview'||this.hasIndex)return false;return render();}
  dispose(){this.select(null);this.recent=[];}
}
