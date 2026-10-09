import {createHash,randomUUID} from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { HOST_ENVIRONMENT_INSTRUCTION as instruction } from "./session-instructions.js";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => value !== null && typeof value === "object" && !Array.isArray(value);
function contains(value: unknown): boolean {
  if (typeof value === "string") return value.includes(instruction);
  if (Array.isArray(value)) return value.some(contains);
  return record(value) && ["text", "content", "parts"].some(key => contains(value[key]));
}
const append = (value: unknown) => typeof value === "string" && value ? `${value}\n${instruction}` : instruction;

/** Zero-system boundary for Web Chat, including emergency mode without Harness. */
export function withoutSystemContext(payload: unknown): unknown {
  if (!record(payload)) return payload;
  const result = { ...payload };
  for (const key of ['system', 'instructions', 'systemInstruction', 'system_instruction']) delete result[key];
  for (const key of ['messages', 'input', 'contents']) {
    if (Array.isArray(result[key])) result[key] = result[key].filter((message: unknown) =>
      !record(message) || !['system', 'developer'].includes(String(message.role)));
  }
  if (record(result.config)) {
    result.config = { ...result.config };
    delete (result.config as RecordValue).systemInstruction;
    delete (result.config as RecordValue).system_instruction;
  }
  return result;
}

/** Work-only Host context; Web Chat is filtered again at the provider boundary. */
export function withHostEnvironment(payload: unknown, api?: string): unknown {
  if (!record(payload)) return payload;
  const systemMessages = ["messages", "input", "contents"].flatMap(key => Array.isArray(payload[key])
    ? payload[key].filter((message: unknown) => record(message) && ["system", "developer"].includes(String(message.role))) : []);
  if ([payload.system, payload.instructions, payload.systemInstruction, payload.system_instruction,
    record(payload.config) ? payload.config.systemInstruction : undefined, ...systemMessages].some(contains)) return payload;
  if (api === "anthropic-messages" || api === "bedrock-converse-stream") {
    const block = api === "anthropic-messages" ? { type: "text", text: instruction } : { text: instruction };
    return { ...payload, system: Array.isArray(payload.system) ? [...payload.system, block]
      : typeof payload.system === "string" ? append(payload.system) : [block] };
  }
  if (Array.isArray(payload.contents)) {
    const config = record(payload.config) ? payload.config : {};
    const existing = config.systemInstruction;
    const systemInstruction = record(existing) && Array.isArray(existing.parts)
      ? { ...existing, parts: [...existing.parts, { text: instruction }] }
      : Array.isArray(existing) ? [...existing, { text: instruction }] : append(existing);
    return { ...payload, config: { ...config, systemInstruction } };
  }
  if (Array.isArray(payload.input)) return { ...payload, instructions: append(payload.instructions) };
  if (Array.isArray(payload.messages)) return { ...payload, messages: [{ role: "system", content: instruction }, ...payload.messages] };
  // Custom transports retain the native before_agent_start prompt; avoid guessing their schema.
  return payload;
}

export default function hostEnvironment(pi: ExtensionAPI): void {
  let runId:string|undefined,nextDispatch:{id:string;hash:string}|undefined;
  pi.registerCommand("coffee-dispatch-control",{description:"Host private dispatch correlation",handler:async(args,ctx)=>{
    const [token,id,hash,...extra]=args.trim().split(/\s+/);
    if(!process.env.PI_COFFEE_DISPATCH_CONTROL||token!==process.env.PI_COFFEE_DISPATCH_CONTROL)throw Error('Invalid Host dispatch control');
    if(id==='clear'&&!hash&&!extra.length){nextDispatch=undefined;return;}
    if(extra.length||!/^mishu-dispatch-[A-Za-z0-9-]+$/.test(id??"")||!/^([a-f0-9]{64})$/.test(hash??'')||!ctx.isIdle())throw Error("Invalid Host dispatch correlation");
    nextDispatch={id,hash};
  }});
  let reportOnly=false;
  async function reportRequest(body:RecordValue):Promise<RecordValue>{
    const endpoint=process.env.PI_COFFEE_MISHU_URL,token=process.env.PI_COFFEE_MISHU_TOKEN;
    if(!endpoint||!token)throw Error('MISHU report capability unavailable');
    const response=await fetch(endpoint,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({action:'report',...body}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('MISHU report admission rejected');return await response.json() as RecordValue;
  }
  // This final platform hook intercepts ALL registered/native/nested tool calls,
  // independent of declarations, Harness activation, or a model-supplied name.
  pi.on('tool_call',()=>reportOnly?{block:true,reason:'Host report-only run: tools and new execution are forbidden'}:undefined);
  if(process.env.PI_COFFEE_MISHU_TOKEN)pi.registerCommand('mishu-report',{description:'整理已登记任务的结果并可靠记录汇报',handler:async(args,ctx)=>{
    try{
      if(reportOnly)throw Error('A report is already processing');
      let taskId=args.trim();
      if(!taskId){
        const response=await reportRequest({operation:'list'}),tasks=Array.isArray(response.tasks)?response.tasks.filter(record):[];
        if(!tasks.length){ctx.ui.notify('暂无可汇报的原生结果。','info');return;}
        const choices=new Map(tasks.map((t,index)=>[String(t.purpose)+' · '+String(t.targetTitle)+' ['+(index+1)+']',String(t.taskId)]));
        const selected=await ctx.ui.select('MISHU：选择要汇报的任务',[...choices.keys(),'取消']);
        if(!selected||selected==='取消')return;taskId=choices.get(selected)!;
      }
      const result=await reportRequest({operation:'prepare',taskId});
      if(!record(result.report)||typeof result.report.processingId!=='string')throw Error('Invalid Host report identity');
      if(typeof result.content!=='string'){ctx.ui.notify(result.report.state==='committed'?'这一版结果已经汇报，请查看当前对话历史。':'已有报告处理记录，结果尚无法核实；未重新生成。','info');return;}
      reportOnly=true;runId=result.report.processingId;
      pi.appendEntry('coffee-native-run',{version:1,runId,origin:'task-report',baselineId:ctx.sessionManager.getLeafId()});
      pi.sendMessage({customType:'coffee-task-report',content:result.content,display:false,details:{processingId:runId}},{triggerTurn:true});
    }catch{reportOnly=false;runId=undefined;ctx.ui.notify('汇报未能开始或结果不确定；请查看任务记录，未自动重试。','error');}
  }});
  pi.on("before_agent_start",(event,ctx)=>{
    // Custom reports bypass this hook; real user turns restore ordinary tools.
    reportOnly=false;
    runId=nextDispatch?.hash===createHash('sha256').update(event.prompt).digest('hex')?nextDispatch.id:randomUUID();nextDispatch=undefined;
    try{pi.appendEntry('coffee-native-run',{version:1,runId,baselineId:ctx.sessionManager.getLeafId()});}catch{runId=undefined;}
  });
  pi.on("agent_settled",event=>{
    if(runId){try{pi.appendEntry('coffee-native-settled',{version:1,runId,...(typeof event.aborted==='boolean'?{aborted:event.aborted}:{})});}catch{/* Missing audit remains uncertain; observation never interrupts native work. */}runId=undefined;}reportOnly=false;
  });
  pi.on("before_agent_start", event => ({
    systemPrompt: process.env.PI_COFFEE_INITIAL_MODE === 'chat' ? '' : contains(event.systemPrompt) ? event.systemPrompt : append(event.systemPrompt),
  }));
  pi.on("before_provider_request", (event, ctx) => process.env.PI_COFFEE_INITIAL_MODE === 'chat' ? withoutSystemContext(event.payload) : withHostEnvironment(event.payload, ctx.model?.api));
}
