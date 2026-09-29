// @vitest-environment jsdom
import {describe,expect,it} from 'vitest';
// @ts-expect-error browser module without type declarations
import {renderReviewFile,wordDiff} from '../public/review.js';

const PATCH=[
  'diff --git a/src/a.ts b/src/a.ts','--- a/src/a.ts','+++ b/src/a.ts',
  '@@ -9,3 +9,4 @@ export function run() {',
  ' const keep = 1;',
  '-const answer = compute(left);',
  '+const answer = compute(right);',
  '+const extra = true;',
  ' return answer;',
].join('\n');
const file={path:'src/a.ts',status:'M',additions:2,deletions:1};
const kinds=(root:Element)=>[...root.querySelectorAll('.review-line-number')].map(cell=>[cell.textContent,cell.classList.contains('del') ? 'del' : cell.classList.contains('add') ? 'add' : cell.classList.contains('review-empty') ? 'blank' : 'context']);

describe('block word diff',()=>{
  it('marks only the changed words of a modified line',()=>{
    expect(wordDiff(['return compute(left);'],['return compute(right);'])).toEqual({old:[[[15,19]]],new:[[[15,20]]]});
  });
  it('aligns a statement re-wrapped across lines instead of marking every line',()=>{
    expect(wordDiff(['foo(a,','  b)'],['foo(a, b)'])).toEqual({old:[[],[]],new:[[]]});
  });
  it('leaves lines that are entirely new, and wholesale rewrites, unmarked',()=>{
    const marks=wordDiff(['const answer = compute(left);'],['const answer = compute(right);','const extra = true;']);
    expect(marks.new[1]).toEqual([]);expect(marks.new[0]).toEqual([[23,28]]);
    expect(wordDiff(['alpha beta gamma'],['completely different words'])).toEqual({old:[[]],new:[[]]});
  });
  it('joins adjacent changed words into one highlight and splits CJK text per character',()=>{
    expect(wordDiff(['let a = old value;'],['let a = new thing;'])).toEqual({old:[[[8,17]]],new:[[[8,17]]]});
    expect(wordDiff(['保存设置'],['保存配置'])).toEqual({old:[[[2,3]]],new:[[[2,3]]]});
  });
});

describe('Diff rendering',()=>{
  it('uses one line-number column in Unified: old numbers on removed rows, new numbers elsewhere, no sign column',()=>{
    const section=renderReviewFile(file,PATCH,'unified');
    expect(kinds(section)).toEqual([['9','context'],['10','del'],['10','add'],['11','add'],['12','context']]);
    expect(section.querySelector('.review-sign')).toBeNull();
    expect([...section.querySelectorAll('mark.review-word')].map(mark=>mark.textContent)).toEqual(['left','right']);
    expect(section.querySelector('.review-hunk')!.textContent).toContain('export function run() {');
  });
  it('pairs removed and added lines in Split and hatches the side with no counterpart',()=>{
    const section=renderReviewFile(file,PATCH,'split');
    expect(section.querySelector('table')!.dataset.layout).toBe('split');
    const rows=[...section.querySelectorAll('tbody tr')];
    const paired=rows.find(row=>row.textContent!.includes('left'))!;
    expect(paired.textContent).toContain('right');expect(kinds(paired)).toEqual([['10','del'],['10','add']]);
    const unpaired=rows.find(row=>row.textContent!.includes('extra'))!;
    expect(unpaired.querySelectorAll('td.review-empty')).toHaveLength(2);expect(kinds(unpaired)).toEqual([['','blank'],['11','add']]);
  });
  it('keeps syntax highlighting intact when marking words inside highlighted tokens',()=>{
    const section=renderReviewFile({path:'x.ts',status:'M',additions:1,deletions:1},'@@ -3 +3 @@\n-const label = "draft";\n+const label = "final";','unified');
    const code=section.querySelectorAll('.review-code-cell code')[1]!;
    expect(code.textContent).toBe('const label = "final";');
    expect(code.querySelector('mark.review-word')!.textContent).toBe('final');
    expect(code.querySelector('.tok-k')!.textContent).toBe('const');
  });
  it('hides the header of a first hunk that starts at line 1 and omits zero counts',()=>{
    const added=renderReviewFile({path:'notes.md',status:'?',additions:2,deletions:0},'@@ -0,0 +1,2 @@\n+hello\n+world','unified');
    expect(added.querySelector('.review-hunk')).toBeNull();
    expect(added.querySelector('.review-file-counts')!.textContent).toBe('+2');
    const binary=renderReviewFile({path:'logo.png',status:'M',additions:null,deletions:null},'','unified');
    expect(binary.querySelector('.review-file-counts')!.textContent).toBe('二进制');
    expect(binary.textContent).toContain('没有可显示的文本 Diff');
  });
  it('can start folded so a re-render keeps the files the user collapsed',()=>{
    expect(renderReviewFile(file,PATCH,'unified',{open:false}).open).toBe(false);
    expect(renderReviewFile(file,PATCH,'unified').dataset.path).toBe('src/a.ts');
  });
});
