import {it,expect} from 'vitest';
// @ts-expect-error browser module
import {RecentConversations} from '../public/recent-conversations.js';
it('bounds retained previews by both count and bytes and consumes restored entries',()=>{
 const cache=new RecentConversations({maxEntries:2,maxBytes:10});
 cache.put('a','a',4);cache.put('b','b',4);cache.put('c','c',4);
 expect(cache.take('a')).toBeUndefined();expect(cache.take('b')).toBe('b');
 cache.put('d','d',8);expect(cache.take('c')).toBeUndefined();
 expect(cache.take('d')).toBe('d');expect(cache.bytes).toBe(0);
 cache.put('huge','payload',11);expect(cache.take('huge')).toBeUndefined();
 cache.put('private','text',1);cache.clear();expect(cache.take('private')).toBeUndefined();
});
