// @vitest-environment jsdom
// Browser-controller seam for the @pierre/diffs Diff body (ADR-0023): lazy per-file loading,
// in-place Unified/Split and theme, expandable context and line comments → composer.
// The renderer is a stand-in with Pierre's constructor/render contract; patches are parsed
// by the real @pierre/diffs parser so line lookups use its actual data model.
import {readFileSync} from 'node:fs';
import {composeCommentMessage,patchSections,rangeLabel} from '../public/diff-view.js';
import {parsePatchFiles} from '@pierre/diffs';
import {afterEach,expect,it,vi} from 'vitest';

const A_PATCH=[
  'diff --git a/src/a.ts b/src/a.ts','--- a/src/a.ts','+++ b/src/a.ts',
  '@@ -9,4 +9,5 @@ export function run() {',
  ' const keep = 1;',
  '-const answer = compute(left);',
  '+const answer = compute(right);',
  '+const extra = true;',
  ' return answer;',
  ' }',
].join('\n');
const BIG_PATCH=['diff --git a/src/big.ts b/src/big.ts','--- a/src/big.ts','+++ b/src/big.ts','@@ -1,2 +1,2 @@',' export const rows = [','-  1,','+  2,'].join('\n');

class FakeDiff {
  static instances:FakeDiff[]=[];
  options:any;container?:HTMLElement;fileDiff:any;renders:any[]=[];rerenders=0;cleaned=false;theme?:string;
  constructor(options:any,public virtualizer:unknown){this.options=options;FakeDiff.instances.push(this);}
  // Like Pierre, annotations come back from renderAnnotation and are slotted into the container.
  render({fileDiff,fileContainer,lineAnnotations,forceRender}:any){
    if(fileContainer)this.container=fileContainer;
    if(fileDiff)this.fileDiff=fileDiff;
    this.renders.push({lineAnnotations,forceRender});
    this.container!.dataset.file=this.fileDiff.name;
    this.container!.replaceChildren(...(lineAnnotations ?? []).map((annotation:any)=>this.options.renderAnnotation(annotation)).filter(Boolean));
    return true;
  }
  setOptions(options:any){this.options=options;}
  rerender(){this.rerenders++;}
  setThemeType(theme:string){this.theme=theme;}
  setSelectedLines(){}
  cleanUp(){this.cleaned=true;}
}
class FakeVirtualizer{root?:Element;content?:Element;cleaned=false;setup(root:Element,content:Element){this.root=root;this.content=content;}cleanUp(){this.cleaned=true;}}
class FakeObserver{
  static all:FakeObserver[]=[];observed=new Set<Element>();
  constructor(public callback:(entries:Array<{target:Element;isIntersecting:boolean}>)=>void,public options:unknown){FakeObserver.all.push(this);}
  observe(node:Element){this.observed.add(node);}unobserve(node:Element){this.observed.delete(node);}disconnect(){this.observed.clear();}
}

afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();localStorage.clear();sessionStorage.clear();vi.resetModules();delete (globalThis as any).__piCoffeeDiffs;FakeDiff.instances=[];FakeObserver.all=[];});

type Setup={library?:unknown;fileResult?:(body:any)=>any;complete?:boolean};
async function setup({library={parsePatchFiles,VirtualizedFileDiff:FakeDiff,Virtualizer:FakeVirtualizer},fileResult,complete=false}:Setup={}){
  document.documentElement.innerHTML=readFileSync('public/index.html','utf8');
  Object.defineProperty(window,'matchMedia',{value:()=>({matches:false,addEventListener(){}}),configurable:true});Element.prototype.scrollTo=vi.fn();
  (globalThis as any).__piCoffeeDiffs=library;
  vi.stubGlobal('IntersectionObserver',FakeObserver);
  const conversation:any={id:'task-1',workspaceKind:'project',engine:'pi',creationState:'ready',projectId:'p',cwd:'/home/test/checkouts/task-1',branch:'coffee/vm/task-1',startSha:'abc',archived:false,createdAt:'2026-09-28T00:00:00Z'};
  sessionStorage.setItem('pi-coffee.active.v2',conversation.id);
  const requests:any[]=[],sockets:any[]=[];
  // By default the Host capped the combined patch inside src/big.ts, so that section is incomplete.
  const branch:any={scope:'branch',sessionId:conversation.id,branch:conversation.branch,base:'1111111111',target:'2222222222',refreshedAt:'2026-09-28T01:00:00Z',stale:false,
    files:[{path:'src/a.ts',status:'M',additions:2,deletions:1},{path:'src/big.ts',status:'M',additions:1,deletions:1}],patch:A_PATCH+'\n'+(complete ? BIG_PATCH : BIG_PATCH.slice(0,60)),truncated:!complete,checks:[{command:'git diff --check',ok:true,output:''}],checkpointPaths:[]};
  class Socket{static OPEN=1;readyState=1;onopen:any;onmessage:any;onclose:any;onerror:any;constructor(){sockets.push(this);queueMicrotask(()=>this.onopen?.());}close(){}send(){}receive(frame:any){this.onmessage?.({data:JSON.stringify(frame)});}}
  vi.stubGlobal('WebSocket',Socket);vi.stubGlobal('open',vi.fn());
  const json=(value:unknown,ok=true)=>({ok,status:ok ? 200 : 409,json:async()=>value});
  vi.stubGlobal('fetch',vi.fn(async(url:any,init:any)=>{
    if(url==='/api/engines')return json({engines:[{id:'pi',name:'Pi',available:true}]});
    if(url==='/api/me')return json(null);
    if(url==='/auth/me')return json({auth:false});
    const body=init?.body ? JSON.parse(init.body) : null;
    if(!body)return json({projects:[{id:'p',name:'demo',branch:'main',webUrl:'https://gitea.example/owner/demo'}],conversations:[conversation],sidebar:{assignments:{},collapsed:[]},vmId:'vm-1',capabilities:{chatWorkspaces:true}});
    requests.push(body);
    if(body.action==='files')return json({url:'http://vm.example',scope:conversation.id,token:'t',files:[]});
    if(body.action==='status')return json({state:'ahead',dirty:true,branch:conversation.branch});
    if(body.action==='changes')return json(branch);
    if(body.action==='change_file'){
      const custom=fileResult?.(body);if(custom)return json(custom);
      if(body.contents)return json({scope:'branch',path:body.path,base:body.base,patch:'',truncated:false,oldContents:'old text\n',newContents:'new text\n'});
      return json({scope:'branch',path:body.path,base:body.base,patch:body.path==='src/big.ts' ? BIG_PATCH : '',truncated:false});
    }
    return json({});
  }));
  vi.useFakeTimers();await import('../public/app.js');await vi.advanceTimersByTimeAsync(20);
  sockets.at(-1).receive({type:'opened',sessionId:conversation.id,engine:'pi',state:{}});
  await vi.advanceTimersByTimeAsync(20);
  q<HTMLButtonElement>('#branch-diff').click();await vi.advanceTimersByTimeAsync(20);
  const settle=async()=>{sockets.at(-1).receive({type:'event',sessionId:conversation.id,event:{type:'agent_settled'}});await vi.advanceTimersByTimeAsync(20);};
  return {requests,branch,settle};
}
const q=<T extends Element=HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
const section=(path:string)=>[...document.querySelectorAll<HTMLDetailsElement>('#diff-content .review-file')].find(node=>node.dataset.path===path)!;
const instance=(path:string)=>FakeDiff.instances.filter(item=>item.fileDiff?.name===path).at(-1)!;
async function intersect(path:string){
  const observer=FakeObserver.all.at(-1)!;
  observer.callback([{target:section(path),isIntersecting:true}]);
  await vi.advanceTimersByTimeAsync(20);
}
const fileRequests=(requests:any[])=>requests.filter(request=>request.action==='change_file');

it('mounts files as they near the viewport and loads the whole patch of a file the capped Diff lacks',async()=>{
  const {requests}=await setup();
  expect([...document.querySelectorAll('#diff-content .review-file-name')].map(node=>node.textContent)).toEqual(['src/a.ts','src/big.ts']);
  expect(section('src/a.ts').querySelector('.review-file-counts')!.textContent).toBe('+2−1');
  expect(FakeDiff.instances).toHaveLength(0);
  expect(q('#diff-content').textContent).not.toContain('150 KB');
  const observer=FakeObserver.all.at(-1)!;
  expect(observer.options).toMatchObject({root:q('#diff-content')});
  expect(observer.observed.size).toBe(2);

  await intersect('src/a.ts');
  const a=instance('src/a.ts');
  expect(a.options).toMatchObject({diffStyle:'unified',diffIndicators:'bars',lineDiffType:'word-alt',hunkSeparators:'line-info',disableFileHeader:true,enableLineSelection:true,enableGutterUtility:true,overflow:'scroll',themeType:'light'});
  expect((a.virtualizer as FakeVirtualizer).root).toBe(q('#diff-content'));
  expect(a.container!.tagName).toBe('DIFFS-CONTAINER');
  expect(a.fileDiff.hunks[0]).toMatchObject({additionStart:9,deletionStart:9});
  expect(fileRequests(requests)).toEqual([]);

  await intersect('src/big.ts');
  expect(fileRequests(requests)).toEqual([{action:'change_file',id:'task-1',scope:'branch',base:'1111111111',path:'src/big.ts'}]);
  expect(instance('src/big.ts').fileDiff.name).toBe('src/big.ts');
  await intersect('src/big.ts');
  expect(fileRequests(requests)).toHaveLength(1);
});

it('switches Unified/Split and the theme in place, and unmounts folded files',async()=>{
  await setup();
  await intersect('src/a.ts');
  const a=instance('src/a.ts');
  q<HTMLButtonElement>('#diff-split').click();
  expect(a.options.diffStyle).toBe('split');expect(a.rerenders).toBe(1);expect(FakeDiff.instances).toHaveLength(1);
  expect(q('#diff-split').getAttribute('aria-pressed')).toBe('true');
  q<HTMLButtonElement>('#theme-toggle').click();
  expect(a.theme).toBe('dark');
  q<HTMLButtonElement>('#diff-collapse').click();await vi.advanceTimersByTimeAsync(20);
  expect(a.cleaned).toBe(true);expect(section('src/a.ts').open).toBe(false);
  q<HTMLButtonElement>('#diff-collapse').click();await vi.advanceTimersByTimeAsync(20);
  await intersect('src/a.ts');
  expect(instance('src/a.ts')).not.toBe(a);expect(instance('src/a.ts').options.diffStyle).toBe('split');
  q<HTMLButtonElement>('#diff-close').click();
  expect(instance('src/a.ts').cleaned).toBe(true);
});

it('expands unchanged context with both sides fetched once, and explains when it cannot',async()=>{
  const {requests}=await setup({fileResult:body=>body.path==='src/big.ts' && body.contents ? {scope:'branch',path:body.path,base:body.base,patch:BIG_PATCH,truncated:false,oldContents:null,newContents:null,contentsUnavailable:'binary'} : undefined});
  await intersect('src/a.ts');
  const loaded=await instance('src/a.ts').options.loadDiffFiles(instance('src/a.ts').fileDiff);
  expect(loaded).toEqual({oldFile:{name:'src/a.ts',contents:'old text\n'},newFile:{name:'src/a.ts',contents:'new text\n'}});
  expect(fileRequests(requests).at(-1)).toEqual({action:'change_file',id:'task-1',scope:'branch',base:'1111111111',path:'src/a.ts',contents:true});
  await intersect('src/big.ts');
  await expect(instance('src/big.ts').options.loadDiffFiles(instance('src/big.ts').fileDiff)).rejects.toThrow('二进制文件');
  expect(q('#toast').textContent).toBe('无法展开未改动的行：二进制文件');
});

it('collects line comments in the Diff and summarizes them into one composer message',async()=>{
  await setup();
  await intersect('src/a.ts');
  const a=instance('src/a.ts');
  q<HTMLTextAreaElement>('#prompt').value='先看这个：';
  a.options.onGutterUtilityClick({start:11,end:10,side:'additions'});
  await vi.advanceTimersByTimeAsync(20);
  const box=a.container!.querySelector<HTMLFormElement>('.diff-comment-box')!;
  expect(box.querySelector('.diff-comment-ref')!.textContent).toBe('L10–L11');
  expect(a.renders.at(-1).lineAnnotations).toEqual([expect.objectContaining({side:'additions',lineNumber:11})]);
  const input=box.querySelector('textarea')!;
  expect(document.activeElement).toBe(input);
  box.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
  expect(a.container!.querySelector('.diff-comment-box')).not.toBeNull();expect(q('#diff-comments').classList.contains('hidden')).toBe(true);
  input.value='把 right 改成 target，extra 不需要。';input.dispatchEvent(new Event('input'));
  box.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
  expect(a.container!.querySelector('.diff-comment-text')!.textContent).toBe('把 right 改成 target，extra 不需要。');
  expect(q('#diff-comments').classList.contains('hidden')).toBe(false);expect(q('#diff-comments-count').textContent).toBe('评论 (1)');

  a.options.onGutterUtilityClick({start:9,end:10,side:'deletions'});
  const second=a.container!.querySelector('.diff-comment-box textarea') as HTMLTextAreaElement;
  second.value='保留 left 的注释';second.dispatchEvent(new Event('input'));
  second.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true}));
  expect(q('#diff-comments-count').textContent).toBe('评论 (2)');
  // Escape inside a draft cancels it without closing the panel.
  a.options.onGutterUtilityClick({start:12,end:12,side:'additions'});
  a.container!.querySelector('.diff-comment-box textarea')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  expect(a.container!.querySelector('.diff-comment-box')).toBeNull();expect(q<HTMLDialogElement>('#diff-dialog').open).toBe(true);

  const cards=()=>[...a.container!.querySelectorAll('.diff-comment')];
  [...cards()[1].querySelectorAll('button')].find(node=>node.textContent==='编辑')!.click();
  const edit=a.container!.querySelector('.diff-comment-box textarea') as HTMLTextAreaElement;
  expect(edit.value).toBe('保留 left 的注释');expect(cards()).toHaveLength(1);
  edit.value='保留 left 这一行的注释';edit.dispatchEvent(new Event('input'));
  a.container!.querySelector<HTMLButtonElement>('.diff-comment-box button[type=submit]')!.click();
  expect(cards().map(card=>card.querySelector('.diff-comment-text')!.textContent)).toEqual(['把 right 改成 target，extra 不需要。','保留 left 这一行的注释']);
  expect(q('#diff-comments-count').textContent).toBe('评论 (2)');

  // Comments survive a refresh of the Diff (e.g. when a turn settles) and belong to the task.
  q<HTMLButtonElement>('#diff-close').click();q<HTMLButtonElement>('#branch-diff').click();await vi.advanceTimersByTimeAsync(20);
  await intersect('src/a.ts');
  expect(instance('src/a.ts').container!.querySelectorAll('.diff-comment')).toHaveLength(2);

  q<HTMLButtonElement>('#diff-comments-send').click();
  expect(q<HTMLTextAreaElement>('#prompt').value).toBe([
    '先看这个：',
    '',
    '请根据下面 2 条 Diff 评论修改：',
    '',
    '1. `src/a.ts` L10–L11',
    '   > const answer = compute(right);',
    '   > const extra = true;',
    '   评论：把 right 改成 target，extra 不需要。',
    '',
    '2. `src/a.ts` L9–L10（改动前）',
    '   > const keep = 1;',
    '   > const answer = compute(left);',
    '   评论：保留 left 这一行的注释',
  ].join('\n'));
  expect(document.activeElement).toBe(q('#prompt'));
  expect(q('#diff-comments').classList.contains('hidden')).toBe(true);
  expect(instance('src/a.ts').container!.querySelectorAll('.diff-comment')).toHaveLength(0);
  expect(q<HTMLButtonElement>('#send').disabled).toBe(false);
});

it('keeps the mounted Diff when a settled turn changed nothing, and keeps a draft through a real refresh',async()=>{
  const {requests,branch,settle}=await setup({complete:true});
  await intersect('src/a.ts');
  const a=instance('src/a.ts');
  a.options.onGutterUtilityClick({start:10,end:10,side:'additions'});
  await vi.advanceTimersByTimeAsync(20);
  const draft=a.container!.querySelector('.diff-comment-box textarea') as HTMLTextAreaElement;
  draft.value='写到一半';draft.dispatchEvent(new Event('input'));
  const changesBefore=requests.filter(request=>request.action==='changes').length;
  await settle();
  expect(requests.filter(request=>request.action==='changes').length).toBeGreaterThan(changesBefore);
  expect(a.cleaned).toBe(false);expect(FakeDiff.instances).toHaveLength(1);
  expect(a.container!.querySelector('.diff-comment-box textarea')).toBe(draft);
  // The turn edited src/a.ts: the Diff is rebuilt, the draft comes back with its text and focus.
  branch.files[0]={path:'src/a.ts',status:'M',additions:3,deletions:1};
  branch.patch=A_PATCH.replace('+const extra = true;','+const extra = true;\n+const more = 1;').replace('@@ -9,4 +9,5 @@','@@ -9,4 +9,6 @@')+'\n'+BIG_PATCH;
  await settle();
  expect(a.cleaned).toBe(true);
  await intersect('src/a.ts');
  const rebuilt=instance('src/a.ts').container!.querySelector('.diff-comment-box textarea') as HTMLTextAreaElement;
  expect(rebuilt).not.toBe(draft);expect(rebuilt.value).toBe('写到一半');expect(document.activeElement).toBe(rebuilt);
  expect(section('src/a.ts').querySelector('.review-file-counts')!.textContent).toBe('+3−1');
});

it('asks before clearing comments',async()=>{
  await setup();
  await intersect('src/a.ts');
  const a=instance('src/a.ts');
  a.options.onGutterUtilityClick({start:9,end:9,side:'additions'});
  const input=a.container!.querySelector('.diff-comment-box textarea') as HTMLTextAreaElement;
  input.value='keep';input.dispatchEvent(new Event('input'));
  a.container!.querySelector<HTMLButtonElement>('.diff-comment-box button[type=submit]')!.click();
  const confirm=vi.fn(()=>false);vi.stubGlobal('confirm',confirm);
  q<HTMLButtonElement>('#diff-comments-clear').click();
  expect(confirm).toHaveBeenCalledWith('清空 1 条 Diff 评论？');expect(q('#diff-comments-count').textContent).toBe('评论 (1)');
  confirm.mockReturnValue(true);q<HTMLButtonElement>('#diff-comments-clear').click();
  expect(q('#diff-comments').classList.contains('hidden')).toBe(true);expect(a.container!.querySelector('.diff-comment')).toBeNull();
  expect(rangeLabel({start:4,end:5,side:'deletions',scope:'turn'})).toBe('L4–L5（本轮改动前）');
  expect(composeCommentMessage([{path:'src/a.ts',start:4,end:4,side:'deletions',scope:'turn',excerpt:['old'],text:'fix'}])).toContain('`src/a.ts` L4（本轮改动前）');
  expect(patchSections('diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b').has('src/a.ts')).toBe(true);
});

it('falls back to the built-in renderer when the Diff bundle cannot load, still loading capped files',async()=>{
  const offline=Promise.reject(new Error('offline'));offline.catch(()=>undefined);
  const {requests}=await setup({library:offline});
  await vi.advanceTimersByTimeAsync(20);
  expect(q('#toast').textContent).toBe('Diff 渲染组件加载失败，已切换为基础视图');
  expect(FakeDiff.instances).toHaveLength(0);
  expect([...document.querySelectorAll('#diff-content table.review-code')]).toHaveLength(2);
  expect([...document.querySelectorAll('#diff-content mark.review-word')].map(node=>node.textContent)).toEqual(['left','right','1','2']);
  expect(fileRequests(requests)).toEqual([{action:'change_file',id:'task-1',scope:'branch',base:'1111111111',path:'src/big.ts'}]);
  q<HTMLButtonElement>('#diff-split').click();
  expect(q('#diff-content table')!.getAttribute('data-layout')).toBe('split');
  expect(fileRequests(requests)).toHaveLength(1);
});
