// Last-confirmed display metadata only. Never a native setting or model catalog.
const PREFIX='pi-coffee.conversation-models.v1:';
const ENGINES=new Set(['pi','codex','claude','cursor','grok']);
const TTL=30*24*60*60*1000, MAX_ENTRIES=1000, MAX_BYTES=256*1024;
const encoder=new TextEncoder();
const text=(value,max=256)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\x00-\x1f]/.test(value);
function storage(){try{return globalThis.localStorage;}catch{return undefined;}}
function project(value){
  if(!value||!ENGINES.has(value.engine)||!text(value.current?.provider)||!text(value.current?.id,512))return;
  if(value.fingerprint!==undefined&&!text(value.fingerprint,1024))return;
  const current={provider:value.current.provider,id:value.current.id};
  if(['native','relay'].includes(value.current.source))current.source=value.current.source;
  const result={engine:value.engine,current};
  if(value.fingerprint!==undefined)result.fingerprint=value.fingerprint;
  if(text(value.thinkingLevel,64))result.thinkingLevel=value.thinkingLevel;
  if(['272k','maximum'].includes(value.context?.preset))result.context={preset:value.context.preset};
  return result;
}
export class ConversationModels {
  constructor({getStorage=storage,now=()=>Date.now()}={}){this.getStorage=getStorage;this.now=now;this.user=null;this.items=new Map();}
  key(){return this.user===null?null:PREFIX+encodeURIComponent(this.user);}
  setScope(user){
    const next=text(user,256)?user:null;if(next===this.user)return;
    this.user=next;this.items.clear();if(!this.key())return;
    try{
      const raw=this.getStorage()?.getItem(this.key());
      if(!raw||raw.length>MAX_BYTES||encoder.encode(raw).length>MAX_BYTES)return;
      const data=JSON.parse(raw);if(data.version!==1||!Array.isArray(data.entries)||data.entries.length>MAX_ENTRIES)return;
      for(const entry of data.entries){
        const model=project(entry.value);
        if(!text(entry.id,256)||!model||!this.validTime(entry.updatedAt))continue;
        this.items.set(entry.id,{value:model,updatedAt:entry.updatedAt});
      }
    }catch{/* Corrupt/private/quota-limited storage is a cache miss. */}
  }
  validTime(time){return Number.isFinite(time)&&time<=this.now()+60000&&time>this.now()-TTL;}
  get(id,{engine,fingerprint}={}){
    const entry=this.items.get(id);if(!entry)return null;
    if(!this.validTime(entry.updatedAt)||(engine&&entry.value.engine!==engine)||(fingerprint!==undefined&&entry.value.fingerprint!==fingerprint)){
      this.delete(id);return null;
    }
    this.items.delete(id);this.items.set(id,entry);
    return structuredClone(entry.value);
  }
  put(id,frame,{engine,fingerprint}={}){
    if(!this.user||!text(id,256))return;
    const current=frame?.current;
    const source=current?.source||frame?.models?.find(model=>model.provider===current?.provider&&model.id===current?.id)?.source;
    const value=project({engine,fingerprint,current:current?{...current,source}:null,thinkingLevel:frame?.thinkingLevel,context:frame?.context});
    if(!value){this.delete(id);return;}
    this.items.delete(id);this.items.set(id,{value,updatedAt:this.now()});this.persist();
  }
  delete(id){if(this.items.delete(id))this.persist();}
  clear(){try{if(this.key())this.getStorage()?.removeItem(this.key());}catch{}this.items.clear();}
  persist(){
    const encode=()=>JSON.stringify({version:1,entries:[...this.items].map(([id,entry])=>({id,...entry}))});
    for(const [id,entry] of this.items)if(!this.validTime(entry.updatedAt))this.items.delete(id);
    while(this.items.size>MAX_ENTRIES)this.items.delete(this.items.keys().next().value);
    let raw=encode();
    while(this.items.size&&encoder.encode(raw).length>MAX_BYTES){this.items.delete(this.items.keys().next().value);raw=encode();}
    try{if(this.key())this.getStorage()?.setItem(this.key(),raw);}catch{/* Memory still serves warm switches. */}
  }
}
