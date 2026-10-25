// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';
import {initBackupControls} from '../public/backup.js';
afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();});
it('shows true capture age and unavailable engines and never offers ordinary users capture',async()=>{
 let user='alice';const request=vi.fn(async()=>({scope:user,canManage:false,managedScopes:[],excludedEngines:['claude','cursor','grok'],tasks:[{taskId:'pi-task',engine:'pi',state:'protected',coverage:'complete',checkpointId:'sealed-point',captureAt:'2026-10-23T00:00:00Z',ageMs:25*60*60*1000,stale:true},{taskId:'codex-task',engine:'codex',state:'unprotected',coverage:'unavailable',checkpointId:null,captureAt:null,ageMs:null,reason:'Native writer coverage is not verified'}]}));
 const panel=initBackupControls({context:()=>({user}),request});await panel.open();
 expect(document.body.textContent).toContain('sealed-point');expect(document.body.textContent).toContain('25 小时');expect(document.body.textContent).toContain('超过 24 小时');expect(document.body.textContent).toContain('Native writer coverage is not verified');expect(document.body.textContent).toContain('Claude / Cursor / Grok');
 expect([...document.querySelectorAll('button')].some(b=>b.textContent==='生成检查点')).toBe(false);
 let release!:(value:unknown)=>void;request.mockImplementationOnce(()=>new Promise(r=>release=r));
 const pending=panel.open();user='bob';release({scope:'alice',canManage:false,tasks:[{taskId:'private-alice',engine:'pi',state:'protected',coverage:'complete',checkpointId:'private-point',captureAt:'2026-10-23T00:00:00Z',ageMs:0}]});await pending;
 expect(document.body.textContent).not.toContain('private-point');
});
