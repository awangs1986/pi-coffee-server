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
it('shows encrypted repository coverage and honest failed jobs without exposing administration to readers',async()=>{
 const panel=initBackupControls({context:()=>({user:'bob'}),request:async()=>({scope:'bob',canManage:false,tasks:[],repository:{configured:true,enabled:true,backend:{name:'restic',version:'0.19.1'},points:[{taskId:'saved',captureAt:'2026-10-23T00:00:00Z',ageMs:26*3600000,stale:true}],jobs:[{id:'failed-job',state:'failed',verification:'none',errorCode:'destination_unavailable',startedAt:'2026-10-24T00:00:00Z'}]}})});await panel.open();
 expect(document.body.textContent).toContain('Restic 0.19.1');expect(document.body.textContent).toContain('failed-job');expect(document.body.textContent).toContain('destination_unavailable');expect(document.body.textContent).toContain('26 小时');
 expect([...document.querySelectorAll('button')].some(b=>b.textContent?.includes('导出离线'))).toBe(false);
});
