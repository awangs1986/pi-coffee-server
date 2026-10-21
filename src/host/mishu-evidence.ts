import type {AgentHistoryRead} from './agent-adapter.js';
export const EVIDENCE_LIMITS={scanEntries:10000,scanChars:2_000_000,entries:20,entryChars:2000,totalChars:12000};
const clean=(s:string)=>s.replace(/(?:sk-|xai-)[A-Za-z0-9_-]{8,}/g,'[REDACTED]').replace(/\b(?:Bearer|token|password|api[_-]?key)\s*[:= ]\s*[^\s,;]+/gi,'[REDACTED]');
/** Bounded, rebuildable projection only. The coordinator owns scope and binding checks. */
export function queryEvidence(conversationId:string,source:AgentHistoryRead|undefined,input:Record<string,unknown>){
 if(input.version!==1||!['recent','search','anchor'].includes(String(input.mode??'recent')))throw Error('evidence requires version 1 and recent/search/anchor mode');
 const mode=input.mode??'recent',query=typeof input.query==='string'?input.query.trim():'';
 if(mode==='search'&&(!query||query.length>200))throw Error('Search requires 1–200 characters');
 if(mode==='anchor'&&(typeof input.anchorId!=='string'||!input.anchorId||input.anchorId.length>256))throw Error('Anchor requires an exact message ID');
 const base={version:1,conversationId,untrusted:true,limits:EVIDENCE_LIMITS};
 if(!source||source.sourceFreshness!=='current')return {...base,available:false,freshness:'unknown',reason:'Passive native history unavailable; no CLI was started',entries:[]};
 const all=source.history.entries;let chars=0,scanned=0;const rows:typeof all=[];
 for(let i=all.length-1;i>=0&&scanned<EVIDENCE_LIMITS.scanEntries;i--){const row=all[i];if(row.kind!=='user'&&row.kind!=='assistant'&&row.kind!=='note')continue;if(chars+row.text.length>EVIDENCE_LIMITS.scanChars)break;rows.unshift(row);chars+=row.text.length;scanned++;}
 const limit=Number.isSafeInteger(input.limit)?Math.max(1,Math.min(EVIDENCE_LIMITS.entries,Number(input.limit))):10;
 let selected=rows;
 if(mode==='search')selected=rows.filter(row=>'text'in row&&row.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 const anchor=mode==='anchor'?rows.findIndex(row=>row.id===input.anchorId):-1;
 if(mode==='anchor')selected=anchor<0?[]:rows.slice(Math.max(0,anchor-2),Math.min(rows.length,anchor+3));
 let total=0;const entries=[];
 for(const row of selected.slice(-limit)){if(!('text'in row))continue;const text=clean(row.text),room=Math.min(EVIDENCE_LIMITS.entryChars,EVIDENCE_LIMITS.totalChars-total);if(room<=0)break;const end=Math.min(text.length,room);entries.push({conversationId,messageId:row.id,at:row.at??null,role:row.kind,kind:row.kind==='user'?'user-original':row.kind==='assistant'?'model-output':'historical-note',text:text.slice(0,end),range:{start:0,end,unit:'utf16',redacted:text!==row.text},truncated:text.length>end,source:'native-history'});total+=end;}
 return {...base,available:true,freshness:source.sourceFreshness,checkedAt:source.checkedAt,sourceGeneration:source.sourceGeneration,entries,missingAnchor:mode==='anchor'&&anchor<0,truncated:scanned<all.filter(r=>r.kind!=='tool').length||selected.length>entries.length||entries.some(e=>e.truncated),coverage:'bounded-native-history'};
}
