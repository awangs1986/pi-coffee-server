// Browser-local, account-scoped acknowledgement. No transcript or native state.
const PREFIX='pi-coffee.completion-reads.v1:';
const MAX=1000, MAX_BYTES=256*1024;
const encoder=new TextEncoder();
const text=value=>typeof value==='string'&&value.length>0&&value.length<=512;
const receiptKey=(id,key)=>JSON.stringify([id,key]);
function storage(){try{return globalThis.localStorage;}catch{return undefined;}}
export function completionKey(session){
  if(!session || session.running || session.runStatus==='interrupted' || session.runStatus==='running')return null;
  if(session.runStatus!=='settled' && session.attention!=='finished')return null;
  return text(session.completionId)?session.completionId:text(session.updatedAt)?'legacy:'+session.updatedAt:null;
}
export class CompletionReads {
  constructor({getStorage=storage}={}){this.getStorage=getStorage;this.user=null;this.items=new Map();}
  key(){return this.user===null?null:PREFIX+encodeURIComponent(this.user)+':';}
  setScope(user){
    const next=text(user)?user:null;if(next===this.user)return;
    this.user=next;this.items.clear();this.mergeStored();this.trim(true);
  }
  refresh(){this.items.clear();this.mergeStored();this.trim(true);}
  mergeStored(){
    const prefix=this.key();if(!prefix)return;
    try{
      const store=this.getStorage();
      for(let index=0;index<Math.min(store?.length||0,5000);index++){
        const key=store.key(index);if(!key?.startsWith(prefix)||key.length>10000)continue;
        try{
          const [id,completion]=JSON.parse(decodeURIComponent(key.slice(prefix.length))),at=Number(store.getItem(key));
          if(text(id)&&text(completion)&&Number.isFinite(at)&&at>0)this.items.set(receiptKey(id,completion),at);
        }catch{/* Invalid records are cache misses. */}
      }
    }catch{/* Corrupt or unavailable storage must not prevent navigation. */}
  }
  unread(session){const key=completionKey(session);return Boolean(key&&!this.items.has(receiptKey(session.id,key)));}
  read(session,proof){
    const key=completionKey(session);
    if(!this.user||!key||key!==proof||!text(session.id)||!this.unread(session))return false;
    this.mergeStored();
    const receipt=receiptKey(session.id,key),at=Date.now();this.items.set(receipt,at);
    // One independent storage key per receipt avoids read/modify/write races
    // between tabs, including reads of different runs of the same conversation.
    try{this.getStorage()?.setItem(this.key()+encodeURIComponent(receipt),String(at));}catch{/* Memory still serves this tab. */}
    this.trim(true);return true;
  }
  trim(persist){
    const records=[...this.items].sort((a,b)=>a[1]-b[1]);
    const weight=receipt=>encoder.encode(this.key()+encodeURIComponent(receipt)).length+32;
    let size=records.reduce((sum,[receipt])=>sum+weight(receipt),0);
    for(const [receipt] of records){
      if(this.items.size<=MAX&&size<=MAX_BYTES)break;
      this.items.delete(receipt);size-=weight(receipt);
      if(persist)try{this.getStorage()?.removeItem(this.key()+encodeURIComponent(receipt));}catch{}
    }
  }
}
