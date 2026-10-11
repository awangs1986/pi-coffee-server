import {expect,it,vi} from 'vitest';
import {createRestartController} from '../public/restart.js';
it('requires confirmation and never resubmits a restart while restoring its receipt',async()=>{
 const values=new Map(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)};
 let accepted=false,posts=0;const notices:string[]=[];
 const request=vi.fn(async(_path:string,options?:RequestInit)=>{if(options?.method==='POST'){posts++;accepted=true;return Response.json({operation:{id:'id',phase:'scheduled'}},{status:202});}return Response.json({available:true,busy:false,operation:accepted?{id:'id',phase:'succeeded'}:null});});
 const cancelled=createRestartController({request,storage,confirm:()=>false,notify:(text:string)=>notices.push(text),newId:()=> 'id',wait:async()=>{}});
 expect(cancelled.handle('/restart')).toBe(true);await cancelled.settled();expect(posts).toBe(0);
 const controller=createRestartController({request,storage,confirm:()=>true,notify:(text:string)=>notices.push(text),newId:()=> 'id',wait:async()=>{}});
 expect(controller.handle('/restart extra')).toBe(true);expect(posts).toBe(0);
 expect(controller.handle('/restart')).toBe(true);expect(controller.handle('/restart')).toBe(true);await controller.settled();
 expect(posts).toBe(1);expect(notices).toContain('Web 和 Host 已重启，健康检查通过');expect(values.size).toBe(0);
 values.set('coffee-maintenance-restart','id');await controller.restore();expect(posts).toBe(1);expect(values.size).toBe(0);
 expect(controller.handle('explain /restart')).toBe(false);
});
it('keeps the operation ID for a new login instead of repeatedly treating 401 as a restart outage',async()=>{
 const values=new Map([['coffee-maintenance-restart','id']]),notices:string[]=[];
 const storage={getItem:(k:string)=>values.get(k)??null,removeItem:(k:string)=>values.delete(k),setItem:(k:string,v:string)=>values.set(k,v)};
 const request=vi.fn(async()=>Response.json({error:'Login required'},{status:401}));
 const controller=createRestartController({request,storage,notify:(text:string)=>notices.push(text),wait:async()=>{throw Error('Must not poll again before login');}});
 await controller.restore();expect(request).toHaveBeenCalledTimes(1);expect(values.get('coffee-maintenance-restart')).toBe('id');expect(notices[0]).toContain('重新登录');
});
