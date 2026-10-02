import {NativeQuestions} from "./questions.js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentHistory, AgentModels, AgentSession } from "../agent-adapter.js";
import type { HistoryEntry, ImageInput, SessionState, UiResponse } from "../../shared/protocol.js";
import { NativeProcess, type NativeCommand } from "./process.js";
import type { NativeBinding } from "../workspaces.js";

/** Claude Code 2.1.280's own stream-json CLI. No Agent SDK or provider HTTP client. */
export class ClaudeSession implements AgentSession {
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
  constructor(command:NativeCommand,private cwd:string,binding:NativeBinding,private save:(binding:NativeBinding)=>Promise<void>,extraDirs:string[]=[],instructions?:string) {
    this.recoveryUnknown=binding.writers==="unknown";this.nativeId=binding.id??binding.requestedId!;this.bound=binding.state==="bound";
    const addDirArgs=extraDirs.flatMap(dir=>["--add-dir",dir]);
    this.process=new NativeProcess(command,["--print","--input-format","stream-json","--output-format","stream-json","--verbose","--include-partial-messages","--permission-prompts","host","--permission-prompt-tool","stdio",...addDirArgs,...(instructions?["--append-system-prompt",instructions]:[]),this.bound?"--resume":"--session-id",this.nativeId],cwd);
    this.home=command.env?.CLAUDE_CONFIG_DIR??process.env.CLAUDE_CONFIG_DIR??join(homedir(),".claude");
    this.process.onMessage=message=>this.handle(message);
    this.process.onExit=()=>{
      for(const c of this.controls.values()){clearTimeout(c.timer);c.reject(new Error("Claude process exited"));}this.controls.clear();
      this.backgroundKnown=false;this.streaming=false;this.emit({type:"run_interrupted"});
    };
  }
  private home:string;
  async start(){await this.control({subtype:"initialize"}).then(result=>{this.models=result.models??[];this.backgroundKnown=!this.recoveryUnknown && result.session_state==="idle";});return this;}
  private control(request:unknown):Promise<any>{
    const request_id=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.controls.delete(request_id);reject(new Error("Claude control request timed out"));},30000);
      this.controls.set(request_id,{resolve,reject,timer});
      try{this.process.send({type:"control_request",request_id,request});}catch(error){clearTimeout(timer);this.controls.delete(request_id);reject(error);}
    });
  }
  private emit(event:unknown){for(const listener of this.listeners)listener(event);}
  private async handle(message:any){
    if(message.type==="control_response"){
      const r=message.response,c=this.controls.get(r.request_id);if(!c)return;
      this.controls.delete(r.request_id);clearTimeout(c.timer);
      r.subtype==="success"?c.resolve(r.response):c.reject(new Error("Claude rejected the native control request"));return;
    }
    if(message.type==="control_request") {
      const request=message.request;
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
      await this.save({state:"bound",id:this.nativeId,writers:"unknown"});this.bound=true;this.model=message.model??this.model;
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
    if(message.type==="user")for(const block of message.message?.content??[])if(block.type==="tool_result")this.emit({type:"tool_update",id:block.tool_use_id,status:block.is_error?"failed":"completed",result:typeof block.content==="string"?block.content:JSON.stringify(block.content),isError:Boolean(block.is_error)});
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
    if(!this.bound)await this.save({state:"starting",requestedId:this.nativeId,writers:"unknown"});
    else await this.save({state:"bound",id:this.nativeId,writers:"unknown"});
    this.interruptRequested=false;this.streaming=true;this.emit({type:"run_started",runId:randomUUID()});
    const content:any[]=[{type:"text",text}];
    for(const image of images??[])content.push({type:"image",source:{type:"base64",media_type:image.mimeType,data:image.data}});
    this.process.send({type:"user",message:{role:"user",content},session_id:this.nativeId});
  }
  async getHistory():Promise<AgentHistory>{
    const path=join(this.home,"projects",this.cwd.replace(/[^a-zA-Z0-9]/g,"-"),this.nativeId+".jsonl");
    let source:string;
    try{source=await readFile(path,"utf8");}catch(error){if(!this.bound && (error as NodeJS.ErrnoException).code==="ENOENT")return {entries:[],leafId:null};throw new Error("Native Claude history is missing; no replacement Session was created");}
    const entries:HistoryEntry[]=[];const seen=new Set<string>();
    const lines=source.split("\n");
    for(const [index,line] of lines.entries()){
      if(!line.trim())continue;
      let row:any;try{row=JSON.parse(line);}catch{if(index===lines.length-1)continue;throw new Error("Native Claude history is damaged; no replacement Session was created");}
      if(row.sessionId && row.sessionId!==this.nativeId)continue;
      if(!row.message || !row.uuid || seen.has(row.uuid))continue;seen.add(row.uuid);
      const blocks=Array.isArray(row.message.content)?row.message.content:[{type:"text",text:row.message.content}];
      const text=blocks.filter((b:any)=>b.type==="text").map((b:any)=>b.text).join("\n");
      if(text && (row.type==="assistant"||row.type==="user"))entries.push({kind:row.type,id:row.type==="assistant"?(row.message.id??row.uuid):row.uuid,text});
      for(const b of blocks)if(b.type==="tool_use")entries.push({kind:"tool",id:b.id,name:b.name,args:b.input??{}});
      else if(b.type==="tool_result"){
        const tool=entries.find(e=>e.kind==="tool"&&e.id===b.tool_use_id);
        if(tool?.kind==="tool"){tool.result=typeof b.content==="string"?b.content:JSON.stringify(b.content);tool.isError=Boolean(b.is_error);}
      }
    }
    this.count=entries.length;return {entries,leafId:entries.at(-1)?.id??null};
  }
  async getState():Promise<SessionState>{return {isStreaming:this.streaming,messageCount:this.count,...(this.name?{sessionName:this.name}:{})};}
  async backgroundState(){return {known:this.backgroundKnown,active:this.backgroundTasks.size+(this.streaming?1:0)};}
  async abort(){if(!this.streaming)return;this.interruptRequested=true;try{await this.control({subtype:"interrupt"});}catch(error){this.interruptRequested=false;throw error;}}
  async getModels():Promise<AgentModels>{return {models:this.models.map(m=>({provider:"claude",id:m.value})),current:this.model?{provider:"claude",id:this.model}:null,thinkingLevel:"",thinkingLevels:[]};}
  async setModel(provider:string,id:string){if(provider!=="claude"||!this.models.some(m=>m.value===id))throw new Error("Model unavailable for Claude Code");await this.control({subtype:"set_model",model:id});this.model=id;}
  async setThinkingLevel(_level:string){throw new Error("Reasoning selection unavailable");}
  async steer(_text:string){throw new Error("Steering unavailable");}
  async followUp(_text:string){throw new Error("Queueing unavailable");}
  async rename(_name:string){throw new Error("Native rename unavailable");}
  async getCommands(){return [];}
  async getExtensions(){return [];}
  async getStats():Promise<never>{throw new Error("Native statistics unavailable");}
  async compact(){throw new Error("Native compaction unavailable");}
  async respondUi(response:UiResponse){
    if(this.questions.answer(response))return;
    const pending=this.requests.get(response.id);if(!pending)throw new Error("Native request is no longer pending");
    const behavior=response.cancelled?"deny":response.value;
    if(behavior!=="allow" && behavior!=="deny")throw new Error("Unsupported native decision");
    this.requests.delete(response.id);
    this.process.send({type:"control_response",response:{subtype:"success",request_id:pending.requestId,response:behavior==="allow"?{behavior,updatedInput:pending.request.input}:{behavior,message:"User denied this tool call"}}});
  }
  onEvent(listener:(event:unknown)=>void){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  async stop(){await this.process.stop();for(const c of this.controls.values()){clearTimeout(c.timer);c.reject(new Error("Claude stopped"));}this.controls.clear();}
}
