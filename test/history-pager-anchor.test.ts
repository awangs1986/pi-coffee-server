import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
// @ts-expect-error browser module
import { HistoryPager } from '../public/history-pager.js';
// @ts-expect-error browser module
import { ScrollAnchor } from '../public/scroll-anchor.js';
describe('demand history pager',()=>{
 it('does not prefetch old pages, coalesces cursor reads and ignores old generations',async()=>{
  let resolve:any;const repository={loadOlder:vi.fn(()=>new Promise(r=>resolve=r))},onPage=vi.fn();
  const pager=new HistoryPager({repository,conversationId:'a',onPage});pager.setCursor('one');pager.start();
  expect(repository.loadOlder).not.toHaveBeenCalled();const a=pager.loadOlder(),b=pager.loadOlder();expect(a).toBe(b);
  pager.setCursor('new');resolve({entries:[],olderCursor:'two'});await a;expect(onPage).not.toHaveBeenCalled();expect(pager.cursor).toBe('new');pager.dispose();
 });
 it('does not turn a failed page request into the end of history',async()=>{
  const repository={loadOlder:vi.fn().mockRejectedValue(new Error('network'))},onError=vi.fn();const pager=new HistoryPager({repository,conversationId:'a',onError});pager.setCursor('one');
  await expect(pager.loadOlder()).rejects.toThrow('network');expect(pager.cursor).toBe('one');expect(onError).toHaveBeenCalledOnce();pager.dispose();
 });
});
describe('stable scroll anchor',()=>{
 it('preserves reading position through prepend and refuses stale generation layout',()=>{
  const d=new JSDOM('<div id="s"><div data-entity-id="a"></div><div data-entity-id="b"></div></div>').window.document,s=d.querySelector('#s') as HTMLElement;
  Object.defineProperty(s,'clientHeight',{value:200});Object.defineProperty(s,'scrollHeight',{value:1000});s.scrollTop=100;
  s.getBoundingClientRect=()=>({top:0} as DOMRect);const a=s.children[0] as HTMLElement,b=s.children[1] as HTMLElement;let y=-30;
  a.getBoundingClientRect=()=>({top:y,bottom:y+100} as DOMRect);b.getBoundingClientRect=()=>({top:y+100,bottom:y+200} as DOMRect);
  let current=true;const anchor=new ScrollAnchor(s,s,{isCurrent:()=>current});const saved=anchor.capture();expect(saved.anchorMessageId).toBe('a');expect(saved.followTail).toBe(false);
  y+=120;anchor.restore(saved);expect(s.scrollTop).toBe(220);current=false;y+=100;expect(anchor.restore(saved)).toBe(false);expect(s.scrollTop).toBe(220);anchor.disconnect();
 });
 it('uses a neighboring stable entity when the original anchor was deleted',()=>{
  const d=new JSDOM('<div id="s"><div data-entity-id="b"></div></div>').window.document,s=d.querySelector('#s') as HTMLElement;
  s.getBoundingClientRect=()=>({top:0} as DOMRect);(s.children[0] as HTMLElement).getBoundingClientRect=()=>({top:20,bottom:40} as DOMRect);
  const onAdjusted=vi.fn(),anchor=new ScrollAnchor(s,s,{onAdjusted});anchor.restore({anchorMessageId:'a',nextMessageId:'b',followTail:false,y:5});
  expect(s.scrollTop).toBe(15);expect(onAdjusted).toHaveBeenCalledWith({from:'a',to:'b'});anchor.disconnect();
 });
});
