import {assertNativePrompt,nativeCommandAllowed} from './commands.js';
import {randomUUID} from 'node:crypto';
import type {AgentHistory,AgentModels,AgentSession} from '../agent-adapter.js';
import type {CommandInfo,HistoryEntry,ImageInput,UiResponse} from '../../shared/protocol.js';
import type {NativeBinding} from '../workspaces.js';
import {NativeProcess,type NativeCommand} from './process.js';
import {NativeQuestions} from './questions.js';
import {NativeSettingsStore} from './settings.js';

/** Cursor owns authentication, tools and durable sessions; ACP is only a local stdio transport. */
export class CursorSession implements AgentSession {
  private process:NativeProcess;
  private listeners=new Set<(event:unknown)=>void>();
  private questions=new NativeQuestions(event=>this.emit(event));
  private requests=new Map<string,{id:string|number;method:string;params:any}>();
  private entries:HistoryEntry[]=[];
  private message:Extract<HistoryEntry,{kind:'user'|'assistant'}>|undefined;
  private nativeId?:string;
  private streaming=false;
  private stopped=false;
  private loading=true;
  private model?:string;
  private models:Array<{modelId:string;name?:string}>=[];
  private modelOption?:string;
  private commands:CommandInfo[]=[];
  constructor(command:NativeCommand,private cwd:string,private binding:NativeBinding|undefined,private save:(binding:NativeBinding)=>Promise<void>,private settings=new NativeSettingsStore(),private instructions?:string){
    this.process=new NativeProcess(command,['acp'],cwd,true);
    this.nativeId=binding?.id;
    this.process.onMessage=m=>this.handle(m);
    this.process.onExit=()=>{this.stopped=true;this.streaming=false;this.requests.clear();this.questions.clear();this.emit({type:'run_interrupted'});};
  }
  async start(){
    const initialized=await this.process.call('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},clientInfo:{name:'pi-coffee',version:'0.1.0'}});
    if(initialized.protocolVersion!==1)throw new Error('Unsupported Cursor ACP version');
    await this.process.call('authenticate',{methodId:'cursor_login'});
    let result:any;
    if(this.nativeId){
      if(!initialized.agentCapabilities?.loadSession)throw new Error('Cursor cannot resume the bound session');
      result=await this.process.call('session/load',{sessionId:this.nativeId,cwd:this.cwd,mcpServers:[]});
    }else{
      await this.save({state:'starting',writers:'unknown'});
      result=await this.process.call('session/new',{cwd:this.cwd,mcpServers:[]});
      if(typeof result.sessionId!=='string'||!result.sessionId||result.sessionId.length>256)throw new Error('Cursor did not return a valid native session');
      this.nativeId=result.sessionId;await this.save({state:'bound',id:this.nativeId,writers:'unknown'});
    }
    await this.process.drain();this.configuration(result);this.message=undefined;this.loading=false;
    const settings=await this.settings.load();if(settings.model)await this.setModel('cursor',settings.model);
    return this;
  }
  private configuration(value:any){
    if(value.models){this.models=value.models.availableModels??[];this.model=value.models.currentModelId;}
    const option=(value.configOptions??[]).find((o:any)=>o.category==='model'||o.id==='model');
    if(option){this.modelOption=option.id;this.model=option.currentValue;this.models=(option.options??[]).flatMap((o:any)=>o.options??[o]).map((o:any)=>({modelId:o.value,name:o.name}));}
  }
  private emit(event:unknown){if(!this.loading)for(const listener of this.listeners)listener(event);}
  private answer(id:string|number,result:unknown){this.process.send({id,result});}
  private async handle(m:any){
    const p=m.params??{};
    if(p.sessionId&&this.nativeId&&p.sessionId!==this.nativeId)throw new Error('Cursor session identity changed');
    if(m.method==='session/update'){
      const u=p.update??{};
      if(u.sessionUpdate==='user_message_chunk'||u.sessionUpdate==='agent_message_chunk'){
        const kind=u.sessionUpdate==='user_message_chunk'?'user':'assistant';
        if(kind==='user'&&!this.loading&&this.streaming)return; // Native live echo of the submitted user message.
        if(!this.message||this.message.kind!==kind){this.completeMessage();const entry:Extract<HistoryEntry,{kind:'user'|'assistant'}>={kind,id:`cursor:${this.nativeId}:${this.entries.length}`,text:''};this.message=entry;this.entries.push(entry);}
        const message=this.message!;
        if(u.content?.type==='text'){message.text+=u.content.text;if(kind==='assistant')this.emit({type:'message_delta',id:message.id,delta:u.content.text});}
        else if(message.kind==='user'&&u.content?.type==='image')message.imageCount=(message.imageCount??0)+1;
      }else if(u.sessionUpdate==='tool_call'||u.sessionUpdate==='tool_call_update'){
        this.completeMessage();let entry=this.entries.find(e=>e.kind==='tool'&&e.id===u.toolCallId);
        if(!entry){entry={kind:'tool',id:u.toolCallId,name:u.title??'Cursor tool',args:u.rawInput??{}};this.entries.push(entry);}
        if(entry.kind==='tool'){if(u.title)entry.name=u.title;if(u.rawInput)entry.args=u.rawInput;if(u.rawOutput!==undefined||u.content)entry.result=typeof u.rawOutput==='string'?u.rawOutput:JSON.stringify(u.rawOutput??u.content);entry.isError=u.status==='failed';this.emit({type:'tool_update',id:entry.id,name:entry.name,args:entry.args,result:entry.result,isError:entry.isError,status:u.status==='completed'?'completed':u.status==='failed'?'failed':'inProgress'});}
      }else if(u.sessionUpdate==='available_commands_update')this.commands=(u.availableCommands??[]).filter((c:any)=>nativeCommandAllowed(c.name)).map((c:any)=>({name:c.name,description:c.description,invocation:'/'+c.name,source:'extension' as const}));
      else if(u.sessionUpdate==='config_option_update')this.configuration(u);
      else if(u.sessionUpdate==='current_model_update')this.model=u.currentModelId;
      return;
    }
    if(m.id===undefined)return; // Unhandled vendor notifications do not execute anything.
    if(m.method==='cursor/ask_question'){
      const questions=p.questions??[];
      this.questions.ask(questions.map((q:any)=>({id:q.id,question:q.prompt,options:q.options,multiSelect:q.allowMultiple})),(answers,cancelled)=>{
        if(cancelled){this.answer(m.id,{outcome:{outcome:'cancelled'}});return;}
        const mapped=questions.map((q:any)=>{const labels=q.allowMultiple?answers[q.id].split(',').map((s:string)=>s.trim()):[answers[q.id]];const selected=labels.map((label:string)=>q.options.find((o:any)=>o.label===label||o.id===label)?.id);if(selected.some((id:any)=>!id))throw new Error('Cursor requires one of the listed options');return {questionId:q.id,selectedOptionIds:selected};});
        this.answer(m.id,{outcome:{outcome:'answered',answers:mapped}});
      });return;
    }
    if(m.method==='session/request_permission'||m.method==='cursor/create_plan'){
      const id=randomUUID();this.requests.set(id,{id:m.id,method:m.method,params:p});
      this.emit({type:'native_request',id,method:'select',title:m.method==='cursor/create_plan'?(p.name??'Cursor plan'):(p.toolCall?.title??'Cursor permission'),message:m.method==='cursor/create_plan'?p.plan:JSON.stringify(p.toolCall??{}),options:m.method==='cursor/create_plan'?['accept','reject']:(p.options??[]).map((o:any)=>o.optionId)});return;
    }
    // No client filesystem or terminal capabilities were advertised.
    this.process.send({id:m.id,error:{code:-32601,message:'Unsupported client method'}});
  }
  private completeMessage(){if(this.message){const e=this.message;if(e.kind==='assistant')this.emit({type:'message_completed',id:e.id,text:e.text});else this.emit({type:'sync_entity',entry:e});this.message=undefined;}}
  async prompt(text:string,images?:ImageInput[]){
    assertNativePrompt(text);
    if(this.streaming||this.stopped)throw new Error('Cursor session is unavailable or busy');
    this.streaming=true;this.emit({type:'run_started',runId:randomUUID()});
    const user:HistoryEntry={kind:'user',id:`cursor:${this.nativeId}:${this.entries.length}`,text,...(images?.length?{imageCount:images.length}:{})};this.entries.push(user);this.emit({type:'sync_entity',entry:user});
    // ACP replies only when the turn ends. Keep Stop/questions responsive, with no arbitrary turn timeout.
    void this.process.call('session/prompt',{sessionId:this.nativeId,prompt:[{type:'text',text},...(this.entries.length===1&&this.instructions?[{type:'text',text:'[PI Coffee Host environment]\n'+this.instructions}]:[]),...(images??[]).map(i=>({type:'image',data:i.data,mimeType:i.mimeType}))]},0).then(async result=>{
      await this.process.drain();this.completeMessage();this.streaming=false;this.requests.clear();this.questions.clear();this.emit({type:'run_completed',status:result.stopReason==='cancelled'?'interrupted':'completed'});
    },()=>{this.streaming=false;this.requests.clear();this.questions.clear();this.emit({type:'run_interrupted'});});
  }
  async getHistory():Promise<AgentHistory>{await this.process.drain();return {entries:structuredClone(this.entries),leafId:this.entries.at(-1)?.id??null};}
  async getState(){return {isStreaming:this.streaming,messageCount:this.entries.length};}
  // ACP does not prove that all detached writers have stopped. Destructive workspace operations remain guarded.
  async backgroundState(){return {known:false,active:this.streaming?1:0};}
  async abort(){if(this.streaming)this.process.send({method:'session/cancel',params:{sessionId:this.nativeId}});}
  async getModels():Promise<AgentModels>{return {models:this.models.map(m=>({provider:'cursor',id:m.modelId})),current:this.model?{provider:'cursor',id:this.model}:null,thinkingLevel:'',thinkingLevels:[]};}
  async setModel(provider:string,id:string){if(this.streaming||provider!=='cursor'||!this.models.some(m=>m.modelId===id))throw new Error('Cursor model is unavailable or session is busy');if(this.modelOption)this.configuration(await this.process.call('session/set_config_option',{sessionId:this.nativeId,configId:this.modelOption,value:id}));else await this.process.call('session/set_model',{sessionId:this.nativeId,modelId:id});await this.settings.save({model:id});this.model=id;}
  async setThinkingLevel(_level:string){throw new Error('Cursor ACP does not expose a verified reasoning control');}
  async steer(_text:string){throw new Error('Cursor does not support native steering');}
  async validateFollowUp(text:string){assertNativePrompt(text);}
  async followUp(_text:string){throw new Error('Follow-up messages must use the Host queue');}
  async rename(_name:string){throw new Error('Cursor does not expose native rename');}
  async getCommands(){return this.commands;}
  async getExtensions(){return [];}
  async getStats():Promise<never>{throw new Error('Cursor does not expose verified context statistics');}
  async compact(){throw new Error('Cursor does not expose verified manual compaction');}
  async respondUi(response:UiResponse){
    if(await this.questions.answer(response))return;
    const r=this.requests.get(response.id);if(!r)throw new Error('Native request is no longer pending');
    let result:any;
    if(r.method==='cursor/create_plan'){
      if(!response.cancelled&&!['accept','reject'].includes(response.value??''))throw new Error('Choose accept or reject');
      result={outcome:{outcome:response.cancelled?'cancelled':response.value==='accept'?'accepted':'rejected'}};
    }else{
      if(!response.cancelled&&!r.params.options.some((o:any)=>o.optionId===response.value))throw new Error('Unknown Cursor permission option');
      result={outcome:response.cancelled?{outcome:'cancelled'}:{outcome:'selected',optionId:response.value}};
    }
    this.answer(r.id,result);this.requests.delete(response.id);
  }
  onEvent(listener:(event:unknown)=>void){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  async stop(){this.stopped=true;await this.process.stop();this.requests.clear();this.questions.clear();}
}
