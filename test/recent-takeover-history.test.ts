import {it,expect,vi} from 'vitest';
import {withPriorHistory} from '../src/host/takeover.js';
it('retains the complete earlier segment when recent native pages reach the takeover boundary',async()=>{
 const previous=Array.from({length:85},(_,i)=>({kind:'assistant' as const,id:'prior-'+i,text:'previous '+i}));
 const getHistory=vi.fn(async()=>({entries:[{kind:'assistant',id:'new',text:'new answer'}],leafId:'new'}));
 const native:any={getHistory,getHistoryPage:vi.fn(async()=>({entries:[{kind:'assistant',id:'new',text:'new answer [TAKEOVER_READY]'}],leafId:'new',olderCursor:null,coverage:'recent'}))};
 const load=vi.fn(async()=>previous);const session=withPriorHistory(native,load);const page=await session.getHistoryPage!();expect(load).not.toHaveBeenCalled();expect(page.entries).toEqual([{kind:'assistant',id:'new',text:'new answer '}]);
 let cursor=page.olderCursor;const ids:string[]=[];while(cursor){const p=await session.getHistoryPage!(cursor);ids.unshift(...p.entries.map(e=>e.id));cursor=p.olderCursor;}
 expect(ids).toEqual(previous.map(e=>e.id));expect(native.getHistoryPage).toHaveBeenCalledTimes(1);expect(getHistory).not.toHaveBeenCalled();expect((await session.getHistory()).entries).toHaveLength(86);
});
