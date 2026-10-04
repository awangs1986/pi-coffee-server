// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {createConversationNavigation} from '../public/conversation-navigation.js';
afterEach(()=>{vi.useRealTimers();history.replaceState(null,'','/');});
it('commits routes immediately and only attaches the last selection, preserving native back/forward',()=>{
 vi.useFakeTimers();const selected:string[]=[],attach=vi.fn();
 const n=createConversationNavigation({window,onSelect:(id:string)=>selected.push(id),onAttach:attach});
 n.select('a');n.select('b');n.select('a');expect(location.pathname).toBe('/conversations/a');expect(selected).toEqual(['a','b','a']);expect(attach).not.toHaveBeenCalled();
 vi.runOnlyPendingTimers();expect(attach).toHaveBeenCalledExactlyOnceWith('a');
 history.replaceState(null,'','/conversations/b');window.dispatchEvent(new PopStateEvent('popstate'));expect(selected.at(-1)).toBe('b');
 n.dispose();vi.runOnlyPendingTimers();expect(attach).toHaveBeenCalledTimes(1);
});
it('uses explicit deep links before remembered selection and replaces a newly created draft route',()=>{
 history.replaceState(null,'','/conversations/deep?syncProtocol=1');const n=createConversationNavigation({window,onSelect:()=>{},onAttach:()=>{}});
 expect(n.initial('remembered')).toBe('deep');n.adopt('created');expect(location.pathname).toBe('/conversations/created');expect(location.search).toBe('?syncProtocol=1');n.dispose();
});
it('does not write a route for a rejected selection',()=>{
 const n=createConversationNavigation({window,onSelect:()=>false,onAttach:()=>{}});n.select('archived');expect(location.pathname).toBe('/');n.dispose();
});
