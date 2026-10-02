import {NativeQuestions} from "./questions.js";
import type { AgentSession, AgentHistory, AgentModels } from "../agent-adapter.js";
import type { HistoryEntry, ImageInput, UiResponse, SessionState } from "../../shared/protocol.js";
import { NativeProcess, type NativeCommand } from "./process.js";

export class CodexSession implements AgentSession {
  private listeners=new Set<(event:unknown)=>void>();
  private threadId="";
  private turnId?:string;
  private streaming=false;
  private model?:string;
  private effort?:string;
  private count=0;
  private initialThread:any;
  private hasPrompt=false;
  private questions=new NativeQuestions(event=>this.emit(event));
  private requests=new Map<string,{id:string|number;method:string;params:any}>();
  private readonly process:NativeProcess;
  constructor(command:NativeCommand,private cwd:string,private instructions?:()=>Promise<string|undefined>){this.process=new NativeProcess(command,["app-server"],cwd);}
  async start(nativeId:string|undefined,bind:(id:string)=>Promise<void>) {
    await this.process.call("initialize",{clientInfo:{name:"pi_coffee",version:"0.1.0"},capabilities:{experimentalApi:true}});
    this.process.send({method:"initialized"});
    let extra:{}|{developerInstructions:string}={};
    if(this.instructions){const result=await this.process.call('config/read',{includeLayers:false,cwd:this.cwd});const configured=result.config?.developer_instructions;extra={developerInstructions:[typeof configured==='string'?configured:undefined,await this.instructions()].filter(Boolean).join('\n')};}
    const result=await this.process.call(nativeId?"thread/resume":"thread/start",nativeId?{threadId:nativeId,...extra}:{cwd:this.cwd,...extra});
    this.initialThread=result.thread;this.threadId=result.thread.id;this.model=result.model??result.thread.model;
    if(nativeId && this.threadId!==nativeId)throw new Error("Native resume changed the Session identity");
    await bind(this.threadId);
    this.process.onMessage=message=>this.handle(message);
    this.process.onExit=()=>this.emit({type:"run_interrupted"});
    return this;
  }
  private emit(event:unknown){for(const listener of this.listeners)listener(event);}
  private handle(message:any) {
    const p=message.params??{};if(p.threadId && p.threadId!==this.threadId)return;
    if(message.id!==undefined && message.method) {
      if(message.method==="item/tool/requestUserInput") {
        this.questions.ask(p.questions??[],(answers,cancelled)=>this.process.send({id:message.id,result:{answers:cancelled?{}:Object.fromEntries(Object.entries(answers).map(([key,value])=>[key,{answers:[value]}]))}}));
      } else if(["item/commandExecution/requestApproval","item/fileChange/requestApproval"].includes(message.method)) {
        const id=`${this.threadId}:${p.turnId}:${message.id}`;
        this.requests.set(id,{id:message.id,method:message.method,params:p});
        this.emit({type:"native_request",id,method:"select",title:message.method.includes("fileChange")?"Codex file-change approval":"Codex command approval",message:String(p.command??p.reason??"Review the native request"),options:["accept","decline","cancel"]});
      } else this.process.send({id:message.id,error:{code:-32601,message:"Native request is not supported by this client"}});
      return;
    }
    if((message.method==="item/started" || message.method==="item/completed") && p.item && !["userMessage","agentMessage","reasoning"].includes(p.item.type)) {
      const item=p.item;this.emit({type:"tool_update",id:item.id,name:item.type,args:item.type==="commandExecution"?{command:item.command}:item.arguments??item.changes??{},status:item.status??(message.method==="item/completed"?"completed":"inProgress"),result:item.aggregatedOutput??JSON.stringify(item.result??item.changes??""),isError:item.status==="failed"});
    }
    if(message.method==="turn/started"){this.turnId=p.turn.id;this.streaming=true;this.emit({type:"run_started",runId:this.turnId});}
    if(message.method==="item/agentMessage/delta")this.emit({type:"message_delta",id:p.itemId,delta:p.delta});
    if(message.method==="item/completed" && p.item.type==="agentMessage")this.emit({type:"message_completed",id:p.item.id,text:p.item.text});
    if(message.method==="turn/completed"){this.streaming=false;this.turnId=undefined;this.requests.clear();this.questions.clear();this.emit({type:"run_completed",status:p.turn.status,...(p.turn.error?{message:"Native Codex turn failed; check native authentication and provider configuration, then retry explicitly"}:{})});}
  }
  async prompt(text:string,images?:ImageInput[]) {
    this.hasPrompt=true;
    const input:any[]=[{type:"text",text,text_elements:[]}];
    for(const image of images??[])input.push({type:"image",url:`data:${image.mimeType};base64,${image.data}`});
    const result=await this.process.call("turn/start",{threadId:this.threadId,input,...(this.model?{model:this.model}:{}),...(this.effort?{effort:this.effort}:{})});
    this.turnId=result.turn.id;
  }
  async getHistory():Promise<AgentHistory> {
    const thread=!this.hasPrompt ? this.initialThread : (await this.process.call("thread/read",{threadId:this.threadId,includeTurns:true})).thread;
    const entries:HistoryEntry[]=[];
    for(const turn of thread.turns??[]) {
      if(turn.status==="inProgress")continue;
      for(const item of turn.items??[]) {
        if(item.type==="userMessage")entries.push({kind:"user",id:item.id,text:(item.content??[]).filter((c:any)=>c.type==="text").map((c:any)=>c.text).join("\n")});
        else if(item.type==="agentMessage")entries.push({kind:"assistant",id:item.id,text:item.text??""});
        else if(item.type==="commandExecution")entries.push({kind:"tool",id:item.id,name:"command",args:{command:item.command},result:item.aggregatedOutput??"",isError:item.exitCode!=null&&item.exitCode!==0});
        else if(item.type==="fileChange")entries.push({kind:"tool",id:item.id,name:"fileChange",args:{changes:item.changes??[]},result:JSON.stringify(item.changes??[]),isError:item.status==="failed"});
      }
    }
    this.count=entries.length;return {entries,leafId:entries.at(-1)?.id??null};
  }
  async getState():Promise<SessionState>{return {isStreaming:this.streaming,messageCount:this.count};}
  async backgroundState(){
    const {thread}=await this.process.call("thread/read",{threadId:this.threadId,includeTurns:this.hasPrompt || Boolean(this.initialThread?.turns?.length)});
    let active=this.streaming?1:0,known=thread.status?.type==="idle";
    for(const turn of thread.turns??[]){
      if(turn.status==="inProgress"){known=false;active++;}
      for(const item of turn.items??[]) {
      if(item.type==="commandExecution" && (item.status==="inProgress" || item.processId && item.exitCode==null)){active++;known=false;}
      if(item.type==="collabAgentToolCall")for(const child of Object.values(item.agentsStates??{}) as any[])if(!["completed","shutdown"].includes(child.status)){known=false;active++;}
    }
    }
    return {known,active};
  }
  async abort(){if(this.turnId)await this.process.call("turn/interrupt",{threadId:this.threadId,turnId:this.turnId});}
  async getModels():Promise<AgentModels>{const result=await this.process.call("model/list",{});return {models:[...new Set([this.model,...result.data.map((m:any)=>m.model??m.id)].filter(Boolean))].map(id=>({provider:"codex",id:String(id)})),current:this.model?{provider:"codex",id:this.model}:null,thinkingLevel:this.effort??"",thinkingLevels:[]};}
  async setModel(provider:string,id:string){if(provider!=="codex" || !(await this.getModels()).models.some(m=>m.id===id))throw new Error("Model unavailable for Codex");this.model=id;}
  async setThinkingLevel(_level:string){throw new Error("Reasoning selection is not supported yet");}
  async steer(_text:string){throw new Error("Steering is unavailable for this Agent");}
  async followUp(_text:string){throw new Error("Queueing is unavailable for this Agent");}
  async rename(_name:string){throw new Error("Native rename unavailable");}
  async getCommands(){return [];}
  async getExtensions(){return [];}
  async getStats():Promise<never>{throw new Error("Native statistics unavailable");}
  async compact(){throw new Error("Native compaction unavailable");}
  async respondUi(response:UiResponse){
    if(this.questions.answer(response))return;
    const request=this.requests.get(response.id);if(!request)throw new Error("Native request is no longer pending");
    const decision=response.cancelled?"cancel":response.value;
    if(!["accept","decline","cancel"].includes(decision??""))throw new Error("Unsupported native decision");
    this.requests.delete(response.id);this.process.send({id:request.id,result:{decision}});
  }
  onEvent(listener:(event:unknown)=>void){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  async stop(){await this.process.stop();}
}
