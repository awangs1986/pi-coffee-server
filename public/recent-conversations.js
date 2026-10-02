// Bounded page-memory snapshots. Host/native history remains authoritative.
export class RecentConversations {
  constructor({maxEntries=5,maxBytes=48*1024*1024}={}) {
    this.maxEntries=maxEntries;this.maxBytes=maxBytes;this.bytes=0;this.items=new Map();
  }
  delete(key) {const old=this.items.get(key);if(old){this.bytes-=old.bytes;this.items.delete(key);}}
  put(key,value,bytes) {
    this.delete(key);
    if(!Number.isFinite(bytes)||bytes<0||bytes>this.maxBytes)return;
    this.items.set(key,{value,bytes});this.bytes+=bytes;
    while(this.items.size>this.maxEntries||this.bytes>this.maxBytes)this.delete(this.items.keys().next().value);
  }
  get(key) {const item=this.items.get(key);if(item){this.items.delete(key);this.items.set(key,item);}return item?.value;}
  take(key) {const item=this.items.get(key);this.delete(key);return item?.value;}
  clear() {this.items.clear();this.bytes=0;}
}
