// View-only rendering of Host-supplied patches; never reads or changes a checkout.
import { el } from './render.js';
import { highlight, normalizeLang } from './highlight.js';

const CHEVRON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
// Above this many token comparisons a block keeps its line colours but skips word highlights.
const WORD_DIFF_BUDGET = 1_500_000;
// Blocks sharing less than this fraction of their text are rewrites; word marks would only add noise.
const WORD_DIFF_MIN_SIMILARITY = 0.3;
const CJK = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}';
// Prose is shown as-is: the code highlighter would colour capitalised words and apostrophes.
const PROSE = new Set(['md','markdown','txt','rst','log','csv']);
const TOKEN = new RegExp(`\\s+|[${CJK}]|(?:(?![${CJK}])[\\p{L}\\p{N}_$])+|[^\\s]`, 'gu');

export function patchRows(patch) {
  const rows=[];
  let oldLine=0,newLine=0,inHunk=false;
  for(const line of String(patch || '').split('\n')) {
    const hunk=line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if(hunk){oldLine=Number(hunk[1]);newLine=Number(hunk[2]);inHunk=true;rows.push({kind:'hunk',text:line,heading:hunk[3].trim(),oldStart:oldLine,newStart:newLine});continue;}
    if(!inHunk)continue;
    if(line.startsWith('+'))rows.push({kind:'add',newLine:newLine++,text:line.slice(1)});
    else if(line.startsWith('-'))rows.push({kind:'del',oldLine:oldLine++,text:line.slice(1)});
    else if(line.startsWith(' '))rows.push({kind:'context',oldLine:oldLine++,newLine:newLine++,text:line.slice(1)});
    else if(line.startsWith('\\'))rows.push({kind:'note',text:line});
    else if(line.startsWith('diff --git '))inHunk=false;
  }
  return rows;
}

function tokens(text) {
  return text.match(TOKEN) || [];
}

// Token-level LCS across a whole deleted block and the added block that replaces it,
// so a statement split over several lines still lines up. Returns changed [start,end)
// character ranges per line; lines that are entirely new get no marks (their row
// colour already says so).
export function wordDiff(oldLines, newLines) {
  const flatten=(lines)=>{
    const list=[];
    lines.forEach((line,index)=>{let offset=0;for(const text of tokens(line)){list.push({text,line:index,start:offset,end:offset+text.length,space:!text.trim()});offset+=text.length;}});
    return list;
  };
  const a=flatten(oldLines),b=flatten(newLines);
  const none={old:oldLines.map(()=>[]),new:newLines.map(()=>[])};
  const n=a.length,m=b.length;
  if(!n || !m || n*m>WORD_DIFF_BUDGET)return none;
  const width=m+1,table=(n<65535 && m<65535) ? new Uint16Array((n+1)*width) : new Uint32Array((n+1)*width);
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)table[i*width+j]=a[i].text===b[j].text ? table[(i+1)*width+j+1]+1 : Math.max(table[(i+1)*width+j],table[i*width+j+1]);
  const keepA=new Uint8Array(n),keepB=new Uint8Array(m);
  for(let i=0,j=0;i<n && j<m;) {
    if(a[i].text===b[j].text){keepA[i]=keepB[j]=1;i++;j++;}
    else if(table[(i+1)*width+j]>=table[i*width+j+1])i++;
    else j++;
  }
  const solid=(list,keep)=>list.reduce((sum,token,index)=>sum+(token.space || !keep[index] ? 0 : token.text.length),0);
  const total=Math.max(a.reduce((sum,token)=>sum+(token.space ? 0 : token.text.length),0),b.reduce((sum,token)=>sum+(token.space ? 0 : token.text.length),0));
  if(!total || solid(a,keepA)/total<WORD_DIFF_MIN_SIMILARITY)return none;
  const ranges=(list,keep,count)=>{
    const out=Array.from({length:count},()=>[]);
    const lineHasKept=new Uint8Array(count);
    list.forEach((token,index)=>{if(keep[index] && !token.space)lineHasKept[token.line]=1;});
    let open=null;
    list.forEach((token,index)=>{
      const changed=!keep[index];
      if(changed && !token.space && lineHasKept[token.line]) {
        const current=out[token.line];
        // Join marks separated only by whitespace so a changed phrase reads as one highlight.
        if(open && open.line===token.line && list.slice(open.index+1,index).every(t=>t.space))current[current.length-1][1]=token.end;
        else current.push([token.start,token.end]);
        open={line:token.line,index};
      } else if(!token.space) open=null;
    });
    return out;
  };
  return {old:ranges(a,keepA,oldLines.length),new:ranges(b,keepB,newLines.length)};
}

// Wrap character ranges of already syntax-highlighted code in <mark>, splitting text nodes.
function markRanges(code, ranges, className) {
  if(!ranges?.length)return;
  const doc=code.ownerDocument,walker=doc.createTreeWalker(code,4);
  const texts=[];for(let node=walker.nextNode();node;node=walker.nextNode())texts.push(node);
  let offset=0,first=0;
  for(const text of texts) {
    const start=offset,end=offset+text.data.length;offset=end;
    const pieces=[];
    for(let i=first;i<ranges.length && ranges[i][0]<end;i++){const [from,to]=ranges[i];if(to>start)pieces.push([Math.max(from,start)-start,Math.min(to,end)-start]);}
    while(first<ranges.length && ranges[first][1]<=end)first++;
    if(!pieces.length)continue;
    const fragment=doc.createDocumentFragment();let cursor=0;
    for(const [from,to] of pieces){if(from>cursor)fragment.append(text.data.slice(cursor,from));const mark=doc.createElement('mark');mark.className=className;mark.textContent=text.data.slice(from,to);fragment.append(mark);cursor=to;}
    if(cursor<text.data.length)fragment.append(text.data.slice(cursor));
    text.replaceWith(fragment);
  }
}

// Group rows so each deleted run is compared with the added run that follows it.
function blocks(rows) {
  const out=[];let dels=[],adds=[];
  const flush=()=>{if(dels.length || adds.length)out.push({kind:'change',dels,adds});dels=[];adds=[];};
  for(const row of rows) {
    if(row.kind==='del'){if(adds.length)flush();dels.push(row);}
    else if(row.kind==='add')adds.push(row);
    else{flush();out.push(row);}
  }
  flush();
  return out;
}

export function fileCounts(file) {
  const counts=el('span','review-file-counts');
  if(typeof file.additions==='number' && file.additions>0)counts.append(el('span','wt-add','+'+file.additions));
  if(typeof file.deletions==='number' && file.deletions>0)counts.append(el('span','wt-del','−'+file.deletions));
  if(!counts.children.length)counts.append(el('span','wt-new',file.additions==null && file.deletions==null ? (file.status==='?' ? '未跟踪' : '二进制') : '±0'));
  return counts;
}

export function renderReviewFile(file,patch,layout='unified',{open=true}={}) {
  const section=el('details','review-file');section.open=open;section.dataset.path=file.path;
  const summary=el('summary','review-file-head');
  const chevron=el('span','review-chevron');chevron.innerHTML=CHEVRON;
  const name=el('code','review-file-name',file.path);name.title=file.path;
  summary.append(chevron,name,fileCounts(file));section.append(summary);
  const rows=patchRows(patch);
  if(!rows.length){section.append(el('p','review-file-empty','该文件没有可显示的文本改动（可能为二进制、重命名或内容超限）。'));return section;}
  const scroll=el('div','review-file-scroll'),table=el('table','review-code');table.dataset.layout=layout;table.setAttribute('aria-label',file.path+' 改动');
  // Fixed-layout Split takes column widths from the first row, which may be a full-width hunk row: pin them.
  if(layout==='split'){const columns=el('colgroup','');for(const kind of ['num','code','num','code'])columns.append(el('col','review-col-'+kind));table.append(columns);}
  const body=el('tbody','');table.append(body);scroll.append(table);section.append(scroll);
  const extension=file.path.includes('.') ? file.path.split('.').pop().toLowerCase() : '';
  const language=PROSE.has(extension) ? null : normalizeLang(extension);
  const number=(n,kind='')=>el('td','review-line-number'+(kind ? ' '+kind : ''),n===undefined ? '' : String(n));
  const content=(text,kind='',ranges)=>{
    const cell=el('td','review-code-cell'+(kind ? ' '+kind : '')),code=el('code','');
    if(language===null)code.textContent=text;else code.innerHTML=highlight(text,language);
    markRanges(code,ranges,'review-word');
    cell.append(code);return cell;
  };
  const empty=()=>[el('td','review-line-number review-empty',''),el('td','review-code-cell review-empty','')];
  const columns=layout==='split' ? 4 : 2;
  const meta=(row)=>{
    const tr=el('tr',row.kind==='note' ? 'review-note' : 'review-hunk'),td=el('td','');td.colSpan=columns;
    td.textContent=row.kind==='note' ? '↵ 文件末尾没有换行符' : '⋯'+(row.heading ? '  '+row.heading : '');
    if(row.kind==='hunk')td.title=row.text;
    tr.append(td);body.append(tr);
  };
  let first=true;
  for(const block of blocks(rows)) {
    if(block.kind==='hunk'){
      // Nothing is hidden above a first hunk that starts at line 1.
      if(!(first && block.oldStart<=1 && block.newStart<=1))meta(block);
      first=false;continue;
    }
    first=false;
    if(block.kind==='note'){meta(block);continue;}
    if(block.kind==='context') {
      const tr=el('tr','context');
      if(layout==='split')tr.append(number(block.oldLine),content(block.text),number(block.newLine),content(block.text));
      else tr.append(number(block.newLine),content(block.text));
      body.append(tr);continue;
    }
    const marks=wordDiff(block.dels.map(row=>row.text),block.adds.map(row=>row.text));
    if(layout==='split') {
      for(let i=0;i<Math.max(block.dels.length,block.adds.length);i++) {
        const left=block.dels[i],right=block.adds[i],tr=el('tr','change');
        tr.append(...(left ? [number(left.oldLine,'del'),content(left.text,'del',marks.old[i])] : empty()));
        tr.append(...(right ? [number(right.newLine,'add'),content(right.text,'add',marks.new[i])] : empty()));
        body.append(tr);
      }
    } else {
      block.dels.forEach((row,i)=>{const tr=el('tr','del');tr.append(number(row.oldLine,'del'),content(row.text,'del',marks.old[i]));body.append(tr);});
      block.adds.forEach((row,i)=>{const tr=el('tr','add');tr.append(number(row.newLine,'add'),content(row.text,'add',marks.new[i]));body.append(tr);});
    }
  }
  return section;
}
