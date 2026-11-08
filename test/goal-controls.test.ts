// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {it,expect,vi,afterEach} from 'vitest';
import {initGoalControls} from '../public/goal-controls.js';
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();});

it('does not replay an uncertain goal mutation and refreshes only the current conversation',async()=>{
 vi.useFakeTimers();document.documentElement.innerHTML=readFileSync('public/index.html','utf8');
 const frames:any[]=[];let next=0;
 const root=document.querySelector<HTMLElement>('#goal-status')!;
 const controls=initGoalControls({root,send:(frame:any)=>{frames.push(frame);return true;},requestId:()=>String(++next),details:()=>{}});
 const reply=(request:any,goal:any,id='a')=>controls.receive({type:'agent_command_result',sessionId:id,requestId:request.requestId,name:'goal',text:JSON.stringify({goal})});
 const goal={objective:'Only current account data',status:'active'};
 controls.opened('a');reply(frames.at(-1),goal);
 const toggle=document.querySelector<HTMLButtonElement>('#goal-toggle')!;
 toggle.click();const mutation=frames.at(-1);expect(mutation.args).toBe('pause');
 await vi.advanceTimersByTimeAsync(15001);
 expect(root.textContent).toContain('状态未确认');expect(toggle.hidden).toBe(true);
 expect(frames.filter(frame=>frame.args==='pause')).toHaveLength(1);
 controls.connection(false);expect(root.textContent).toContain('连接断开');
 controls.opened('a');expect(frames.at(-1).args).toBe('');
 reply(mutation,{...goal,status:'paused'});expect(root.textContent).not.toContain('已暂停');
 reply(frames.at(-1),{...goal,status:'paused'});expect(toggle.textContent).toBe('继续');
 const former=frames.at(-1);controls.reset();controls.opened('b');
 reply(former,goal);expect(root.textContent).not.toContain(goal.objective);
 reply(frames.at(-1),null,'b');expect(root.hidden).toBe(true);
 controls.reset();expect(root.textContent).not.toContain(goal.objective);
});
