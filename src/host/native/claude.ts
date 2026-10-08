import {LiveRunEvidence} from './live-run-evidence.js';
import {assertNativePrompt,nativeCommandAllowed} from './commands.js';
import {NativeSettingsStore} from './settings.js';
import {NativeQuestions} from "./questions.js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentHistory, AgentHistoryRead, AgentModels, AgentSession } from "../agent-adapter.js";
import { parseSourceLines, readStableSource, sourceHash, unknownHistory } from "./history-source.js";
import { nativeHistoryJob, nativeHistoryNeedsWorker } from "./history-pool.js";
import type { CommandInfo, ContextCategoryId, HistoryEntry, ImageInput, SessionState, SessionStats, UiResponse } from "../../shared/protocol.js";
import { NativeProcess, type NativeCommand } from "./process.js";
import type { NativeBinding } from "../workspaces.js";

/** Reads Claude's durable JSONL without constructing its process-owning Session. */
export async function readClaudeHistory(command: NativeCommand, cwd: string, nativeId: string): Promise<AgentHistoryRead> {
  const binding = `claude:${nativeId}`;
  if (nativeHistoryNeedsWorker) return nativeHistoryJob("claude", { command: { command: "", env: { CLAUDE_CONFIG_DIR: command.env?.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude") } }, cwd, nativeId }).catch(() => unknownHistory(binding));
  if (!/^[a-zA-Z0-9-]+$/.test(nativeId)) return unknownHistory(binding);
  const home = command.env?.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  try {
    const source = await readStableSource(join(home, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${nativeId}.jsonl`));
    const { history, branch } = await projectClaudeHistory(source.text, nativeId);
    return { history, binding: `${binding}:${source.identity}:${branch}`, sourceGeneration: source.generation, sourceFreshness: "current", checkedAt: new Date().toISOString() };
  } catch { return unknownHistory(binding); }
}

async function projectClaudeHistory(source: string, nativeId: string): Promise<{ history: AgentHistory; branch: string }> {
  const rows = await parseSourceLines(source);
  const mainRows = rows.filter(row => row.isSidechain !== true);
  const byUuid = new Map(mainRows.filter(row => typeof row.uuid === "string").map(row => [row.uuid, row]));
  const leaf = mainRows.filter(row => row.message && typeof row.uuid === "string").at(-1);
  const branches: string[] = [];
  let selected = mainRows;
  if (leaf && "parentUuid" in leaf) {
    const children = new Map<string | null, number>();
    for (const row of byUuid.values()) if ("parentUuid" in row) children.set(row.parentUuid, (children.get(row.parentUuid) ?? 0) + 1);
    const path = new Set<string>();
    let row: Record<string, any> | undefined = leaf;
    while (row) {
      if (path.has(row.uuid)) throw new Error("Claude source contains a cyclic branch");
      path.add(row.uuid);
      if ((children.get(row.parentUuid) ?? 0) > 1) branches.push(row.uuid);
      if (row.parentUuid != null && !byUuid.has(row.parentUuid)) throw new Error("Claude source branch is incomplete");
      row = row.parentUuid == null ? undefined : byUuid.get(row.parentUuid);
    }
    selected = mainRows.filter(row => path.has(row.uuid));
  }
  const entries: HistoryEntry[] = [], byId = new Map<string, HistoryEntry>(), seen = new Set<string>();
  for (const row of selected) {
    if (row.sessionId && row.sessionId !== nativeId) throw new Error("Claude source identity changed");
    if (!row.message || !row.uuid || seen.has(row.uuid)) continue;
    seen.add(row.uuid);
    const blocks = Array.isArray(row.message.content) ? row.message.content : [{ type: "text", text: row.message.content }];
    const text = blocks.filter((block: any) => block.type === "text").map((block: any) => String(block.text ?? "")).join("\n");
    if (text && (row.type === "assistant" || row.type === "user")) {
      const id = row.type === "assistant" ? row.message.id ?? row.uuid : row.uuid;
      const previous = byId.get(id);
      // Claude may persist separate content blocks under one assistant message ID.
      if (previous && previous.kind === row.type && "text" in previous) previous.text += `\n${text}`;
      else { const entry: HistoryEntry = { kind: row.type, id, text, ...(typeof row.timestamp === "string" ? { at: row.timestamp } : {}) }; entries.push(entry); byId.set(id, entry); }
    }
    for (const block of blocks) {
      if (block.type === "tool_use") {
        if (typeof block.id !== "string") throw new Error("Claude tool ID is missing");
        const entry: HistoryEntry = { kind: "tool", id: block.id, name: block.name, args: block.input ?? {} };
        const previous = byId.get(block.id);
        if (previous?.kind === "tool") Object.assign(previous, entry);
        else { entries.push(entry); byId.set(entry.id, entry); }
      } else if (block.type === "tool_result") {
        const tool = byId.get(block.tool_use_id);
        if (tool?.kind === "tool") { tool.result = typeof block.content === "string" ? block.content : JSON.stringify(block.content); tool.isError = Boolean(block.is_error); }
      }
    }
  }
  // An empty/truncated file cannot prove an intentionally empty native session.
  if (!rows.some(row => row.sessionId === nativeId)) throw new Error("Claude source identity is unavailable");
  return { history: { entries, leafId: entries.at(-1)?.id ?? null }, branch: sourceHash(JSON.stringify(branches.reverse())) };
}

/** Claude Code 2.1.280's own stream-json CLI. No Agent SDK or provider HTTP client. */
export class ClaudeSession implements AgentSession {
  private readonly tracking=new LiveRunEvidence('claude',()=>this.nativeId);
  private trackingRun?:string;
  readRunEvidence(runId?:string){return this.tracking.read(runId);}
  private process:NativeProcess;
  private listeners=new Set<(event:unknown)=>void>();
  private controls=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();
  private models:any[]=[];
  private questions=new NativeQuestions(event=>this.emit(event));
  private requests=new Map<string,{requestId:string;request:any}>();
  private streaming=false;
  private interruptRequested=false;
  private backgroundKnown=false;
  private recoveryUnknown=false;
  private backgroundTasks=new Set<string>();
  private count=0;
  private currentMessage="";
  private nativeId:string;
  private bound:boolean;
  private name?:string;
  private model?:string;
  private effort="medium";
  private commands:CommandInfo[]=[];
  constructor(command:NativeCommand,private cwd:string,binding:NativeBinding,private save:(binding:NativeBinding)=>Promise<void>,extraDirs:string[]=[],instructions?:string,private preparation=false,private settings=new NativeSettingsStore(),metadataOnly=false) {
    this.recoveryUnknown=binding.writers==="unknown";this.nativeId=binding.id??binding.requestedId!;this.bound=binding.state==="bound";
    const addDirArgs=extraDirs.flatMap(dir=>["--add-dir",dir]);
    this.process=new NativeProcess(command,["--print","--input-format","stream-json","--output-format","stream-json","--verbose","--include-partial-messages","--permission-prompts","host","--permission-prompt-tool","stdio",...addDirArgs,...(metadataOnly?['--no-session-persistence','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--settings','{"disableAllHooks":true}']:[]),...(preparation?['--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--disable-slash-commands','--settings','{"disableAllHooks":true}']:[]),...(instructions?["--append-system-prompt",instructions]:[]),this.bound?"--resume":"--session-id",this.nativeId],cwd);
    this.home=command.env?.CLAUDE_CONFIG_DIR??process.env.CLAUDE_CONFIG_DIR??join(homedir(),".claude");
    this.process.onMessage=message=>this.handle(message);
    this.process.onExit=()=>{
      for(const c of this.controls.values()){clearTimeout(c.timer);c.reject(new Error("Claude process exited"));}this.controls.clear();
      this.backgroundKnown=false;this.streaming=false;this.emit({type:"run_interrupted"});
    };
  }
  private home:string;
  async start(){
    const result=await this.control({subtype:"initialize"});this.models=result.models??[];
    this.commands=(result.commands??[]).filter((c:any)=>nativeCommandAllowed(c.name)).map((c:any)=>({name:c.name,description:c.description,invocation:'/'+c.name,source:'skill'}));
    this.backgroundKnown=!this.recoveryUnknown&&result.session_state==='idle';
    const settings=await this.settings.load();this.name=settings.name;this.model=settings.model??this.models[0]?.value;
    if(settings.model)await this.setModel('claude',settings.model);
    const levels=(await this.getModels()).thinkingLevels;
    if(settings.effort)await this.setThinkingLevel(settings.effort);else if(levels.includes('medium'))await this.setThinkingLevel('medium');
    return this;
  }
  private control(request:unknown):Promise<any>{
    const request_id=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.controls.delete(request_id);reject(new Error("Claude control request timed out"));},30000);
      this.controls.set(request_id,{resolve,reject,timer});
      try{this.process.send({type:"control_request",request_id,request});}catch(error){clearTimeout(timer);this.controls.delete(request_id);reject(error);}
    });
  }
  private emit(event:unknown){const e=event as {type?:string;id?:string;text?:string;status?:string};if(e.type==='message_completed')this.tracking.message(this.trackingRun,e.id,e.text??'');if(e.type==='run_completed')this.tracking.finish(this.trackingRun,e.status??'unknown');if(e.type==='run_interrupted')this.tracking.lost();for(const listener of this.listeners)listener(event);}
  private async handle(message:any){
    if(message.type==="control_response"){
      const r=message.response,c=this.controls.get(r.request_id);if(!c)return;
      this.controls.delete(r.request_id);clearTimeout(c.timer);
      r.subtype==="success"?c.resolve(r.response):c.reject(new Error("Claude rejected the native control request"));return;
    }
    if(message.type==="control_request") {
      const request=message.request;
      if(this.preparation){this.process.send({type:'control_response',response:{subtype:'success',request_id:message.request_id,response:{behavior:'deny',message:'Tools are disabled during Fork preparation'}}});this.emit({type:'native_request',method:'forbidden_preparation_tool'});return;}
      if(request.subtype!=="can_use_tool"){
        this.process.send({type:"control_response",response:{subtype:"error",request_id:message.request_id,error:"Unsupported native request"}});return;
      }
      if(request.tool_name==="AskUserQuestion") {
        this.questions.ask(request.input.questions??[],(answers,cancelled)=>this.process.send({type:"control_response",response:{subtype:"success",request_id:message.request_id,response:cancelled?{behavior:"deny",message:"User cancelled"}:{behavior:"allow",updatedInput:{...request.input,answers}}}}));return;
      }
      const id=`${this.nativeId}:${message.request_id}`;
      this.requests.set(id,{requestId:message.request_id,request});
      this.emit({type:"native_request",id,method:"select",title:`Claude Code: ${request.tool_name}`,message:JSON.stringify(request.input),options:["allow","deny"]});return;
    }
    if(message.type==="system" && message.subtype==="init") {
      if(message.session_id!==this.nativeId)throw new Error("Claude returned a different native Session identity");
      await this.save({state:"bound",id:this.nativeId,writers:"unknown"});this.bound=true;this.model=this.model??message.model;
    }
    if(message.type==="system" && message.subtype==="background_tasks_changed") {
      this.backgroundKnown=!this.recoveryUnknown;this.backgroundTasks=new Set((message.tasks??[]).map((task:any)=>task.task_id));
      if(this.bound && !this.streaming)await this.save({state:"bound",id:this.nativeId,writers:this.backgroundKnown && this.backgroundTasks.size===0?"idle":"unknown"});
      this.emit({type:"background_state",known:this.backgroundKnown,active:this.backgroundTasks.size});
    }
    if(message.type==="stream_event"){
      const e=message.event;
      if(e.type==="message_start")this.currentMessage=e.message.id;
      if(e.type==="content_block_delta" && e.delta.type==="text_delta")this.emit({type:"message_delta",id:this.currentMessage,delta:e.delta.text});
    }
    if(message.type==="user") {
      const blocks=Array.isArray(message.message?.content)?message.message.content:[{type:"text",text:message.message?.content??""}];
      const text=blocks.filter((block:any)=>block.type==="text").map((block:any)=>block.text).join("\n");
      if(typeof message.uuid==="string" && text)this.emit({type:"sync_entity",entry:{kind:"user",id:message.uuid,text}});
      for(const block of blocks)if(block.type==="tool_result")this.emit({type:"tool_update",id:block.tool_use_id,status:block.is_error?"failed":"completed",result:typeof block.content==="string"?block.content:JSON.stringify(block.content),isError:Boolean(block.is_error)});
    }
    if(message.type==="assistant"){
      for(const block of message.message.content??[])if(block.type==="tool_use")this.emit({type:"tool_update",id:block.id,name:block.name,args:block.input,status:"inProgress"});
      const text=(message.message.content??[]).filter((b:any)=>b.type==="text").map((b:any)=>b.text).join("\n");
      if(text)this.emit({type:"message_completed",id:message.message.id??message.uuid,text});
    }
    if(message.type==="result"){
      this.streaming=false;if(this.bound)await this.save({state:"bound",id:this.nativeId,writers:this.backgroundKnown && this.backgroundTasks.size===0?"idle":"unknown"});this.requests.clear();this.questions.clear();this.emit({type:"run_completed",status:this.interruptRequested?"interrupted":message.is_error?"failed":"completed",...(message.is_error && !this.interruptRequested?{message:"Native Claude turn failed; inspect its history before retrying"}:{})});
    }
  }
  async prompt(text:string,images?:ImageInput[]) {
    assertNativePrompt(text);
    if(!this.bound)await this.save({state:"starting",requestedId:this.nativeId,writers:"unknown"});
    else await this.save({state:"bound",id:this.nativeId,writers:"unknown"});
    this.interruptRequested=false;this.streaming=true;this.trackingRun=randomUUID();this.tracking.start(this.trackingRun);this.emit({type:"run_started",runId:this.trackingRun});
    const content:any[]=[{type:"text",text}];
    for(const image of images??[])content.push({type:"image",source:{type:"base64",media_type:image.mimeType,data:image.data}});
    this.process.send({type:"user",message:{role:"user",content},session_id:this.nativeId});
  }
  async getHistory():Promise<AgentHistory>{
    const path=join(this.home,"projects",this.cwd.replace(/[^a-zA-Z0-9]/g,"-"),this.nativeId+".jsonl");
    let source:string;
    try{source=await readFile(path,"utf8");}catch(error){if(!this.bound && (error as NodeJS.ErrnoException).code==="ENOENT")return {entries:[],leafId:null};throw new Error("Native Claude history is missing; no replacement Session was created");}
    const { history } = await projectClaudeHistory(source, this.nativeId);
    this.count=history.entries.length;return history;
  }
  async getState():Promise<SessionState>{return {isStreaming:this.streaming,messageCount:this.count,...(this.name?{sessionName:this.name}:{})};}
  async backgroundState(){return {known:this.backgroundKnown,active:this.backgroundTasks.size+(this.streaming?1:0)};}
  async abort(){if(!this.streaming)return;this.interruptRequested=true;try{await this.control({subtype:"interrupt"});}catch(error){this.interruptRequested=false;throw error;}}
  async getModels():Promise<AgentModels>{
    const choices=this.models.map(m=>({provider:'claude',id:m.value,reasoning:Boolean(m.supportsEffort),thinkingLevels:m.supportsEffort?(m.supportedEffortLevels??[]):[],defaultThinkingLevel:'medium'}));
    const selected=this.models.find(m=>m.value===this.model||m.resolvedModel===this.model);
    return {models:choices,current:this.model?{provider:'claude',id:this.model}:null,thinkingLevel:selected?.supportsEffort?this.effort:'',thinkingLevels:selected?.supportsEffort?(selected.supportedEffortLevels??[]):[]};
  }
  async setModel(provider:string,id:string){
    if(this.streaming||provider!=='claude'||!this.models.some(m=>m.value===id||m.resolvedModel===id))throw new Error('Model unavailable for Claude Code or session is busy');
    await this.control({subtype:'set_model',model:id});this.model=id;
    const levels=(await this.getModels()).thinkingLevels;const effort=levels.includes(this.effort)?this.effort:levels.includes('medium')?'medium':levels[0]??'';
    if(effort)await this.control({subtype:'apply_flag_settings',settings:{effortLevel:effort}});
    await this.settings.save({model:id,effort});this.effort=effort;
  }
  async setThinkingLevel(level:string){if(this.streaming||!(await this.getModels()).thinkingLevels.includes(level))throw new Error('Reasoning selection unavailable for this model');await this.control({subtype:'apply_flag_settings',settings:{effortLevel:level}});await this.settings.save({effort:level});this.effort=level;}
  async steer(_text:string){throw new Error('Steering unavailable');}
  async validateFollowUp(text:string){assertNativePrompt(text);}
  async followUp(_text:string){throw new Error('Follow-up messages must use the Host queue');}
  async rename(name:string){await this.control({subtype:'rename_session',title:name,source:'host',session_id:this.nativeId});await this.settings.save({name});this.name=name;}
  async getCommands(){return this.commands;}
  async getExtensions(){return [];}
  async getStats():Promise<SessionStats>{
    const usage=await this.control({subtype:'get_context_usage',detail:'summary'});
    if(!Number.isFinite(usage.totalTokens)||!Number.isFinite(usage.maxTokens)||usage.maxTokens<=0)throw new Error('Native Claude context usage unavailable');
    const ids:ContextCategoryId[]=['system','tools','rules','skills','dynamic','subagents','conversation'];
    const names:Record<string,ContextCategoryId>={'System prompt':'system','System tools':'tools','Memory files':'rules','Skills':'skills','MCP tools':'dynamic','Custom agents':'subagents','Messages':'conversation'};
    const used=(usage.categories??[]).filter((c:any)=>c.kind==='used');
    const mapped=used.every((c:any)=>names[c.name]&&Number.isSafeInteger(c.tokens)&&c.tokens>=0);
    const categories=ids.map(id=>({id,tokens:used.filter((c:any)=>names[c.name]===id).reduce((n:number,c:any)=>n+c.tokens,0)}));
    return {userMessages:0,assistantMessages:0,toolCalls:0,tokens:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0},cost:0,
      contextUsage:{tokens:usage.totalTokens,contextWindow:usage.maxTokens,percent:100*usage.totalTokens/usage.maxTokens},
      ...(mapped&&categories.reduce((n,c)=>n+c.tokens,0)===usage.totalTokens?{contextBreakdown:{version:1 as const,method:'native_summary' as const,basis:'session_preview' as const,model:usage.model??this.model??'',capturedAt:new Date().toISOString(),contextWindow:usage.maxTokens,totalTokens:usage.totalTokens,categories,mediaOmitted:false}}:{})};
  }
  async compact(){throw new Error('Native compaction unavailable');}
  async respondUi(response:UiResponse){
    if(await this.questions.answer(response))return;
    const pending=this.requests.get(response.id);if(!pending)throw new Error("Native request is no longer pending");
    const behavior=response.cancelled?"deny":response.value;
    if(behavior!=="allow" && behavior!=="deny")throw new Error("Unsupported native decision");
    this.requests.delete(response.id);
    this.process.send({type:"control_response",response:{subtype:"success",request_id:pending.requestId,response:behavior==="allow"?{behavior,updatedInput:pending.request.input}:{behavior,message:"User denied this tool call"}}});
  }
  onEvent(listener:(event:unknown)=>void){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  async stop(){await this.process.stop();for(const c of this.controls.values()){clearTimeout(c.timer);c.reject(new Error("Claude stopped"));}this.controls.clear();}
}
