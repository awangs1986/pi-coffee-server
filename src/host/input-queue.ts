import {randomUUID} from 'node:crypto';
import type {ImageInput, QueueAction, QueueItem} from '../shared/protocol.js';
/** Generic queue fairness policy; notification consumers advertise this same bound. */
export const INPUT_QUEUE_POLICY={foregroundBurst:3} as const;
type Input=QueueItem&{images?:ImageInput[];requestId?:string;internal?:()=>Promise<void>;cancel?:()=>Promise<void>};

/** Pending Web inputs stay here until one native delivery owns them. */
export class InputQueue {
 private rows:Input[]=[];
 private sending=false;
 private foregroundBurst=0;
 private scheduled=false;
 private stopped=false;
 private generation=0;
 private inFlight?:Promise<void>;
 constructor(private readonly options:{busy:()=>boolean;validate:(text:string)=>Promise<void>;deliver:(text:string,images:ImageInput[]|undefined,promote:boolean,requestId?:string)=>Promise<void>;changed:()=>void}){}
 get items():QueueItem[]{return this.rows.map(({images,internal,cancel,...item})=>({...item}));}
 get active(){return this.sending;}
 async add(text:string,images?:ImageInput[],requestId?:string){
  const generation=this.generation;await this.options.validate(text);
  if(this.stopped||generation!==this.generation)throw Error('Session has stopped');
  if(this.rows.length>=100)throw Error('队列最多保留 100 条指令');
  this.checkSize(text,images);
  this.rows.push({id:randomUUID(),requestId,revision:1,text,status:'pending',imageCount:images?.length??0,...(images?{images:structuredClone(images)}:{})});
  this.options.changed();this.wake();
 }
 addInternal(text:string,deliver:()=>Promise<void>,cancel:()=>Promise<void>){
  if(this.stopped||this.rows.length>=100)throw Error('Queue unavailable');this.checkSize(text);
  const row:Input={id:randomUUID(),revision:1,text,status:'pending',imageCount:0,readOnly:true,internal:deliver,cancel};
  this.rows.push(row);this.options.changed();this.wake();return row.id;
 }
 cancelInternal(id:string){const row=this.rows.find(r=>r.id===id&&r.internal);if(row&&row.status!=='sending'){this.rows=this.rows.filter(r=>r!==row);this.options.changed();this.wake();return true;}return false;}
 private checkSize(text:string,images?:ImageInput[],except?:Input){
  const rows=this.rows.filter(row=>row!==except);
  if(Buffer.byteLength(text)+rows.reduce((n,row)=>n+Buffer.byteLength(row.text),0)>512*1024)throw Error('队列文字过多，请先处理已有指令');
  if((images??[]).reduce((n,image)=>n+image.data.length,0)+rows.reduce((n,row)=>n+(row.images??[]).reduce((m,image)=>m+image.data.length,0),0)>16*1024*1024)throw Error('队列图片过多，请先处理已有指令');
 }
 private find(id:string,revision:number){
  const row=this.rows.find(item=>item.id===id);
  if(!row||row.revision!==revision||row.status==='sending')throw Error('这条指令已开始执行或已被修改，请查看最新队列');
  return row;
 }
 async change(action:QueueAction){
  let row=this.find(action.id,action.revision);
  if(row.internal){if(action.action!=='cancel')throw Error('通知不能编辑或插话；请停止跟进');await row.cancel?.();this.cancelInternal(row.id);return;}
  if(action.action==='edit'){
   if(!action.text?.trim())throw Error('指令不能为空');
   await this.options.validate(action.text);row=this.find(action.id,action.revision);
   this.checkSize(action.text,row.images,row);row.text=action.text;row.revision++;this.options.changed();return;
  }
  if(action.action==='cancel'){
   this.rows=this.rows.filter(item=>item!==row);this.options.changed();this.wake();return;
  }
  if(this.sending)throw Error('另一条指令正在发送，请稍后重试');
  await this.deliver(row,true);
 }
 wake(){
  if(this.scheduled||this.stopped)return;this.scheduled=true;
  setImmediate(()=>{this.scheduled=false;
   if(this.stopped||this.sending||this.options.busy())return;
   const foreground=this.rows.find(row=>!row.internal),notification=this.rows.find(row=>row.internal&&row.status==='pending');
   const row=notification&&(this.foregroundBurst>=INPUT_QUEUE_POLICY.foregroundBurst||!foreground||foreground.status==='failed')?notification:foreground;
   if(!row||row.status!=='pending')return;
   void this.deliver(row,false).catch(()=>undefined);
  });
 }
 private async deliver(row:Input,promote:boolean){
  const generation=this.generation;
  this.foregroundBurst=row.internal?0:this.foregroundBurst+1;
  this.sending=true;row.status='sending';row.revision++;this.options.changed();
  try{
   this.inFlight=row.internal?row.internal():row.requestId===undefined?this.options.deliver(row.text,row.images,promote):this.options.deliver(row.text,row.images,promote,row.requestId);
   await this.inFlight;
   this.rows=this.rows.filter(item=>item!==row);
  }catch(error){
   // A transport error can mean "accepted but response lost". Never auto-retry.
   if(generation===this.generation){row.status='failed';row.revision++;row.error='发送未确认，请先检查对话记录，再决定是否重试。';}
   throw error;
  }finally{this.inFlight=undefined;this.sending=false;this.options.changed();this.wake();}
 }
 async waitForDelivery(){await this.inFlight?.catch(()=>undefined);}
 clear(){this.generation++;const old=this.rows.length;this.rows=[];if(old)this.options.changed();}
 pause(){this.generation++;this.stopped=true;for(const row of this.rows){if(row.status!=='sending'){row.status='failed';row.revision++;row.error='Agent 已中断；请检查历史后手动重试。';}}if(this.rows.length)this.options.changed();}
 resume(){this.stopped=false;}
 stop(){this.generation++;this.stopped=true;}
}
