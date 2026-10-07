const WORD=/\.docx?$/i;
const INPUT=/^(?:\.\.\/attachments|(?:\.pi-coffee\/)?inbox)(?:\/|$)/;
function bodies(root){return [...root.querySelectorAll('.msg.assistant[data-message-complete="true"] .body')].filter(node=>!node.querySelector('.bounded-text-content'));}
function signature(root){return bodies(root).flatMap(node=>(node.textContent||'').slice(0,32768).match(/[^\s`]+\.docx?\b/gi)||[]).slice(0,400).join('\n');}
function removeLink(link){link.replaceWith(link.querySelector('code')||document.createTextNode(link.dataset.documentText||''));}
function unwrap(root){for(const link of root.querySelectorAll('.generated-document-download'))removeLink(link);}
function verified(files){return Array.isArray(files)?files.slice(0,200).filter(file=>file?.available===true&&typeof file.path==='string'&&file.path.length<=512&&WORD.test(file.path)&&!INPUT.test(file.path)):[];}
function findPath(text,files){
 const name=text.replace(/^\.\//,'');
 const exact=files.find(file=>file.path===name);if(exact)return exact.path;
 if(name.includes('/')||name.includes('\\'))return null;
 const matches=files.filter(file=>file.path.split('/').at(-1)===name);
 return matches.length===1?matches[0].path:null;
}
function filenameIndex(text,name){
 let index=text.indexOf(name);
 while(index>=0){
  const before=text[index-1]||'',after=text[index+name.length]||'',next=text[index+name.length+1]||'';
  if(!/[A-Za-z0-9_./\\-]/.test(before)&&!/[A-Za-z0-9_-]/.test(after)&&!(after==='.'&&/[A-Za-z0-9_]/.test(next)))return index;
  index=text.indexOf(name,index+name.length);
 }
 return -1;
}
function bind(root,files,endpoint){
 for(const link of root.querySelectorAll('.generated-document-download')){
  if(!files.some(file=>file.path===link.dataset.documentPath)){removeLink(link);continue;}
  const url=endpoint(link.dataset.documentPath);if(url&&link.getAttribute('href')!==url)link.href=url;
 }
 for(const body of bodies(root)){
  for(const code of [...body.querySelectorAll('code')].slice(0,400)){
   if(code.closest('pre')||code.closest('a:not(.generated-document-download)'))continue;
   const path=findPath(code.textContent||'',files),old=code.closest('.generated-document-download');
   if(!path){if(old)old.replaceWith(code);continue;}
   const url=endpoint(path);if(!url)continue;
   if(old){if(old.getAttribute('href')!==url)old.href=url;continue;}
   const link=document.createElement('a');link.className='artifact-download generated-document-download';
   link.dataset.documentPath=path;
   link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.title='下载 Word 文档';
   code.replaceWith(link);link.append(code,document.createTextNode(' · 下载'));
  }
  // Plain filenames also work; code blocks, user text and existing Markdown links stay intact.
  const walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT),nodes=[];let node;
  while((node=walker.nextNode())&&nodes.length<400)if(!node.parentElement?.closest('a,pre,code,button'))nodes.push(node);
  const names=[...new Set(files.map(file=>file.path.split('/').at(-1)))].filter(name=>findPath(name,files));
  for(const text of nodes){
   let remaining=text.textContent||'',fragment=null;
   while(remaining){
    const match=names.map(name=>({name,index:filenameIndex(remaining,name)})).filter(value=>value.index>=0).sort((a,b)=>a.index-b.index)[0];
    if(!match)break;
    const path=findPath(match.name,files),url=endpoint(path);if(!url)break;
    fragment??=document.createDocumentFragment();fragment.append(document.createTextNode(remaining.slice(0,match.index)));
    const link=document.createElement('a');link.className='artifact-download generated-document-download';link.dataset.documentPath=path;link.dataset.documentText=match.name;link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=match.name+' · 下载';fragment.append(link);
    remaining=remaining.slice(match.index+match.name.length);
   }
   if(fragment){fragment.append(document.createTextNode(remaining));text.replaceWith(fragment);}
  }
 }
}

/** Display-only; file discovery and serving stay behind the existing task grant. */
export function createDocumentDownloads({root,context,load,endpoint}) {
 let key=null,files=[],lastSignature=null,pending=null,epoch=0,again=false;
 async function refresh(force=false){
  const current=context();
  if(current!==key){key=current;files=[];lastSignature=null;pending=null;again=false;epoch++;unwrap(root);}
  if(!key)return;
  bind(root,files,endpoint);
  const wanted=signature(root);if(!wanted)return;
  if(pending){again ||= force;return pending;}
  if(!force&&wanted===lastSignature)return;
  const owner=key,version=++epoch;
  let work;try{work=load();}catch(error){work=Promise.reject(error);}
  const request=Promise.resolve(work).then(value=>{
   if(context()!==owner||key!==owner||epoch!==version)return;
   files=verified(value);lastSignature=wanted;bind(root,files,endpoint);
  }).catch(()=>{if(key===owner&&epoch===version)lastSignature=wanted;}).finally(()=>{
   if(pending!==request)return;
   pending=null;const repeat=again;again=false;if(repeat&&context()===owner)return refresh(true);
  });
  pending=request;return request;
 }
 return {refresh};
}
