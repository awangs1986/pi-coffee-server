import type {AgentHistoryRead} from './agent-adapter.js';
export const EVIDENCE_LIMITS={scanEntries:10000,scanChars:2_000_000,entries:20,entryChars:2000,totalChars:12000};
const clean=(s:string)=>s.replace(/(?:sk-|xai-)[A-Za-z0-9_-]{8,}/g,'[REDACTED]').replace(/\b(?:Bearer|token|password|api[_-]?key)\s*[:= ]\s*[^\s,;]+/gi,'[REDACTED]');
/** Bounded, rebuildable projection only. The coordinator owns scope and binding checks. */
export function queryEvidence(conversationId:string,source:AgentHistoryRead|undefined,input:Record<string,unknown>){
 if(input.version!==1||!['recent','search','anchor','scan'].includes(String(input.mode??'recent')))throw Error('evidence requires version 1 and recent/search/anchor mode');
 const mode=input.mode??'recent',query=typeof input.query==='string'?input.query.trim():'';
 if(mode==='search'&&(!query||query.length>200))throw Error('Search requires 1–200 characters');
 if(mode==='anchor'&&(typeof input.anchorId!=='string'||!input.anchorId||input.anchorId.length>256))throw Error('Anchor requires an exact message ID');
 const base={version:1,conversationId,untrusted:true,limits:EVIDENCE_LIMITS};
 if(!source||source.sourceFreshness!=='current')return {...base,available:false,freshness:'unknown',reason:'Passive native history unavailable; no CLI was started',entries:[]};
 if(mode==='scan'){
  if(input.afterId!==undefined&&(typeof input.afterId!=='string'||input.afterId.length>256))throw Error('Invalid evidence scan cursor');
  const rows=source.history.entries.filter(row=>row.kind==='user'||row.kind==='assistant'||row.kind==='note');
  const after=input.afterId===undefined?-1:rows.findIndex(row=>row.id===input.afterId);
  if(input.afterId!==undefined&&after<0)return {...base,available:true,freshness:source.sourceFreshness,sourceGeneration:source.sourceGeneration,entries:[],missingAnchor:true,nextId:input.afterId,hasMore:true,truncated:true,reason:'Scan cursor is no longer in the native branch; no cursor was advanced'};
  const limit=Number.isSafeInteger(input.limit)?Math.max(1,Math.min(20,Number(input.limit))):20;
  let total=0,nextId=input.afterId??null;const entries=[];
  for(const row of rows.slice(after+1,after+1+limit)){if(!('text'in row))continue;const text=clean(row.text);if(total+text.length>EVIDENCE_LIMITS.totalChars||text.length>EVIDENCE_LIMITS.entryChars)break;entries.push({conversationId,messageId:row.id,at:row.at??null,role:row.kind,kind:row.kind==='user'?'user-original':row.kind==='assistant'?'model-output':'historical-note',text,range:{start:0,end:text.length,unit:'utf16',redacted:text!==row.text},truncated:false,source:'native-history'});total+=text.length;nextId=row.id;}
  const consumed=after+1+entries.length,hasMore=consumed<rows.length;
  return {...base,available:true,freshness:source.sourceFreshness,sourceGeneration:source.sourceGeneration,checkedAt:source.checkedAt,entries,nextId,hasMore,missingAnchor:false,truncated:hasMore,coverage:'incremental-native-history',...(hasMore&&!entries.length?{reason:'Next native message exceeds batch capacity; cursor retained for manual review'}:{})};
 }
 const all=source.history.entries;let chars=0,scanned=0;const rows:typeof all=[];
 for(let i=all.length-1;i>=0&&scanned<EVIDENCE_LIMITS.scanEntries;i--){const row=all[i];if(row.kind!=='user'&&row.kind!=='assistant'&&row.kind!=='note')continue;if(chars+row.text.length>EVIDENCE_LIMITS.scanChars)break;rows.unshift(row);chars+=row.text.length;scanned++;}
 const limit=Number.isSafeInteger(input.limit)?Math.max(1,Math.min(EVIDENCE_LIMITS.entries,Number(input.limit))):10;
 let selected=rows;
 if(mode==='search')selected=rows.filter(row=>'text'in row&&row.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 const anchor=mode==='anchor'?rows.findIndex(row=>row.id===input.anchorId):-1;
 if(mode==='anchor')selected=anchor<0?[]:rows.slice(Math.max(0,anchor-2),Math.min(rows.length,anchor+3));
 let total=0;const entries=[];
 for(const row of selected.slice(-limit)){if(!('text'in row))continue;const text=clean(row.text),room=Math.min(EVIDENCE_LIMITS.entryChars,EVIDENCE_LIMITS.totalChars-total);if(room<=0)break;const match=mode==='search'?text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()):-1,start=match<0?0:Math.max(0,match-Math.min(400,Math.floor(room/3))),end=Math.min(text.length,start+room);entries.push({conversationId,messageId:row.id,at:row.at??null,role:row.kind,kind:row.kind==='user'?'user-original':row.kind==='assistant'?'model-output':'historical-note',text:text.slice(start,end),range:{start,end,unit:'utf16',redacted:text!==row.text},truncated:start>0||text.length>end,source:'native-history'});total+=end-start;}
 return {...base,available:true,freshness:source.sourceFreshness,checkedAt:source.checkedAt,sourceGeneration:source.sourceGeneration,entries,missingAnchor:mode==='anchor'&&anchor<0,truncated:scanned<all.filter(r=>r.kind!=='tool').length||selected.length>entries.length||entries.some(e=>e.truncated),coverage:'bounded-native-history'};
}
