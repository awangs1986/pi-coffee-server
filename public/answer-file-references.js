import {Lexer} from './vendor-marked.js';
import {markdownFilePath} from './task-file-reference.js';

// Recognize authored links in one answer without building its full Markdown
// tree. Marked parses at most one bounded candidate. Fences and code spans
// are examples. A content-page read can request a later range independently.
export function answerFileReferences(source,{from=0,to=source.length,budget=2048}={}) {
  if(!source.includes('['))return [];
  const lexer=new Lexer({gfm:true}), result=[],seen=new Set();
  const markers=/^ {0,3}(`{3,}|~{3,})|^(?: {4}|\t)|<!--|\\[^\n]|`+|!?\[/gm;
  const definitions=Object.create(null), pending=[];
  let used=0;
  function add(token){
    const path=markdownFilePath(token.href);
    if(!path || seen.has(path))return;
    const ref={path,label:(token.text || path.split('/').at(-1)).slice(0,120),image:token.type==='image'};
    const size=new TextEncoder().encode(JSON.stringify(ref)).byteLength;
    if(used+size>budget)return;
    used+=size;seen.add(path);result.push(ref);
  }
  for(let match;(match=markers.exec(source));){
    const index=match.index, value=match[0];
    if(match[1]){
      const fence=match[1],end=new RegExp('^ {0,3}'+fence[0]+'{'+fence.length+',}[ \\t]*\\r?$','gm');
      const newline=source.indexOf('\n',markers.lastIndex);
      end.lastIndex=newline<0?source.length:newline+1;
      markers.lastIndex=end.exec(source)?end.lastIndex:source.length;
      continue;
    }
    if(value==='<!--'){const end=source.indexOf('-->',markers.lastIndex);markers.lastIndex=end<0?source.length:end+3;continue;}
    if(value==='    '||value==='\t'){const end=source.indexOf('\n',markers.lastIndex);markers.lastIndex=end<0?source.length:end;continue;}
    if(value[0]==='\\')continue;
    const chunk=source.slice(index,index+8192);
    if(value[0]==='`'){const code=lexer.tokenizer.codespan(chunk);if(code)markers.lastIndex=index+code.raw.length;continue;}
    if(index===0||source[index-1]==='\n'){
      const def=lexer.tokenizer.def(chunk);
      if(def){if(!Object.hasOwn(definitions,def.tag)&&Object.keys(definitions).length<128)definitions[def.tag]=def;markers.lastIndex=index+def.raw.length;continue;}
    }
    const token=lexer.tokenizer.link(chunk);
    if(token){
      markers.lastIndex=index+token.raw.length;
      if(index<to && markers.lastIndex>from)add(token);
    } else if(index<to && index+8192>from && pending.length<128){
      const ref=/^!?\[[^\]\n]{1,200}\](?:\[[^\]\n]{0,200}\])?/.exec(chunk);
      if(ref && index+ref[0].length>from){pending.push(ref[0]);markers.lastIndex=index+ref[0].length;}
    }
    if(result.length>=32)break;
  }
  for(const raw of pending){
    const token=lexer.tokenizer.reflink(raw,definitions);
    if(token && (token.type==='link'||token.type==='image'))add(token);
  }
  return result;
}
