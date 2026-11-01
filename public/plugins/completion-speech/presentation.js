// Optional view policy. The host supplies only scoped, captured briefs; envelope
// text in a transcript is never sufficient authorization to fold an answer.
export function createSpeechPresentation({request,context,digest,storage=globalThis.sessionStorage,onChange=()=>{},renderAnswer=()=>{}}){
 const cache=new Map(),expanded=new Map();let closed=false,pending=null,generation=0;
 const scope=()=>{const value=context();return value?.user&&value?.id?JSON.stringify([value.user,value.id]):null;};
 const remember=(key,value)=>{expanded.delete(key);expanded.set(key,value);while(expanded.size>100)expanded.delete(expanded.keys().next().value);try{storage?.setItem('coffee.speech-expansion.v1',JSON.stringify([...expanded]));}catch{/* Optional disposable UI state. */}};
 try{for(const pair of JSON.parse(storage?.getItem('coffee.speech-expansion.v1')||'[]').slice(-100))if(Array.isArray(pair)&&typeof pair[0]==='string'&&typeof pair[1]==='boolean')expanded.set(pair[0],pair[1]);}catch{/* A damaged cache is a miss. */}
 async function refresh(){
  const key=scope();if(closed||!key)return;
  if(pending?.key===key)return pending.work;
  const token=++generation,id=context().id;
  const work=Promise.resolve().then(async()=>{try{const result=await request({action:'summaries',id});if(closed||token!==generation||scope()!==key)return;
   const items=Array.isArray(result.items)?result.items.filter(item=>typeof item?.answerDigest==='string'&&/^[a-f0-9]{64}$/.test(item.answerDigest)&&typeof item.summary==='string'&&item.summary.length>0&&item.summary.length<=1000&&typeof item.completionId==='string').slice(-100):[];
   cache.delete(key);cache.set(key,items);while(cache.size>5)cache.delete(cache.keys().next().value);onChange();
  }catch{/* Plugin absence/failure leaves ordinary full replies intact. */}finally{if(pending?.work===work)pending=null;}});pending={key,work};return work;
 }
 function apply(entries){
  const key=scope();if(closed||!key)return;
  const items=cache.get(key);if(!items?.length)return;
  for(const entry of entries){
   const node=entry.node;if((entry.k??entry.kind)!=='assistant'||!node?.isConnected||entry.status==='inProgress')continue;
   if(node.dataset.messageComplete!=='true'&&entry.status!=='completed')continue;
   const hash=entry.contentDigest??(!entry.contentTruncated?digest(entry.text||''):null);
   const item=items.find(candidate=>candidate.answerDigest===hash);if(!item)continue;
   if(node.dataset.speechCompletionId){node.dataset.speechCompletionId=item.completionId;const existing=node.querySelector('.speech-summary');if(existing)existing.textContent=item.summary;continue;}
   const scroller=node.closest('[data-speech-scroller]'),top=scroller?.scrollTop,atTail=scroller&&scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<80;
   const expansionKey=JSON.stringify([key,item.answerDigest]);
   // Strip only the authenticated envelope of an untruncated complete answer.
   if(!entry.contentTruncated&&typeof entry.text==='string'){
    const match=/\n?\n?```coffee-speech\s*\n([\s\S]*?)\n```\s*$/.exec(entry.text);
    try{const envelope=match&&JSON.parse(match[1]);if(envelope?.profile_version===item.profileVersion&&envelope.summary?.trim()===item.summary)renderAnswer(node,entry.text.slice(0,match.index).trimEnd());}catch{/* Invalid envelopes stay intact. */}
   }
   const summary=document.createElement('div');summary.className='speech-summary';summary.textContent=item.summary;
   const details=document.createElement('details');details.className='speech-full-information';details.open=expanded.get(expansionKey)===true;
   const toggle=document.createElement('summary');toggle.textContent='显示完整信息';details.append(toggle,...node.childNodes);node.append(summary,details);node.dataset.speechCompletionId=item.completionId;
   details.addEventListener('toggle',()=>{remember(expansionKey,details.open);onChange();});
   if(scroller)scroller.scrollTop=atTail?scroller.scrollHeight:top;
  }
 }
 return {refresh,apply,close(){closed=true;generation++;cache.clear();pending=null;}};
}
// The Coffee read controller adds source/revision, visibility and viewport proof.
export function summaryReadProof(entry,completionId){
 const node=entry?.node,summary=node?.querySelector('.speech-summary');
 if(!completionId||!node?.isConnected||node.dataset.speechCompletionId!==completionId||!summary?.isConnected||summary.closest('[hidden]'))return false;
 const scroller=node.closest('[data-speech-scroller]');if(!scroller)return true;
 const rect=summary.getBoundingClientRect(),viewport=scroller.getBoundingClientRect();
 return rect.bottom>=viewport.top&&rect.top<=viewport.bottom;
}
