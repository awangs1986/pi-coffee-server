import {prepareTakeoverRecords,takeoverPrompt,reconstruct,priorHistory,withPriorHistory,type TakeoverState} from "../takeover.js";
import type {AgentHistory,AgentSession} from "../agent-adapter.js";
import { capabilitiesFor } from "../../shared/protocol.js";
import { randomUUID } from "node:crypto";
import { ClaudeSession } from "./claude.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentSessionFactory, EngineAvailability } from "../agent-adapter.js";
import { PI_ONLY_ENGINES } from "../agent-adapter.js";
import type { Workspaces } from "../workspaces.js";
import { CodexSession } from "./codex.js";
import { NativeProcess, nativeEnvironment, type NativeCommand } from "./process.js";
const exec=promisify(execFile);
export interface NativeAgentOptions { instructions?:()=>Promise<string|undefined>; pi:AgentSessionFactory;workspaces:Workspaces;codex?:NativeCommand;claude?:NativeCommand;codexSessionFactory?:(id:string,cwd:string,onBound:(nativeId:string)=>Promise<void>)=>AgentSessionFactory;legacyCodex?:AgentSessionFactory;codexListings?:(cwd:string)=>Promise<import("../agent-adapter.js").AgentSessionListing[]>; }
/** Routes only by the durable Task binding; browser-provided native IDs are never accepted. */
export class NativeAgentFactory implements AgentSessionFactory {
  private closing=false;
  private readonly preparations=new Map<AbortController,AgentSession>();
  private readonly generation=new Map<string,string>();
  private readonly codexFactories=new Map<string,AgentSessionFactory>();
  constructor(private options:NativeAgentOptions){}
  async close(){this.closing=true;for(const controller of this.preparations.keys())controller.abort();await Promise.allSettled([...this.preparations.values()].map(s=>s.stop()));await Promise.all([...this.codexFactories.values()].map(f=>f.close?.()));await this.options.legacyCodex?.close?.();}
  private codexFactory(id:string,cwd:string){const generation=id+':'+(this.generation.get(id)??'original');let factory=this.codexFactories.get(generation);if(!factory && this.options.codexSessionFactory){factory=this.options.codexSessionFactory((this.generation.get(id)??'original')==='original'?id:generation.replace(':','-'),cwd,nativeId=>this.options.workspaces.setNativeBinding(id,{state:"bound",id:nativeId}));this.codexFactories.set(generation,factory);}return factory;}
  async capabilities(id:string){
    const task=await this.options.workspaces.lookup(id);
    const engine=task?.engine ?? ((await this.options.legacyCodex?.list().catch(()=>[]) ?? []).some(s=>s.id===id)?"codex":"pi");
    if(engine==="codex" && this.options.codexSessionFactory)return {...capabilitiesFor("pi"),commands:true,extensions:false,cleanup:false};
    return capabilitiesFor(engine);
  }
  async commandCatalog(engine:"pi" | "codex") {
    if(engine==="codex"){
      if(!this.options.codex || !this.options.legacyCodex?.commandCatalog)throw new Error("Codex Skill discovery unavailable");
      return this.options.legacyCodex.commandCatalog(engine);
    }
    if(engine!=="pi"||!this.options.pi.commandCatalog)throw new Error("Pi command discovery unavailable");
    return this.options.pi.commandCatalog(engine);
  }
  async modelCatalog(engine:"pi" | "codex") {
    if(engine==="pi"){
      if(!this.options.pi.modelCatalog)throw new Error("Pi model discovery unavailable");
      return this.options.pi.modelCatalog(engine);
    }
    const factory=this.options.legacyCodex;
    if(engine!=="codex" || !this.options.codex || !factory?.modelCatalog)throw new Error("Codex model discovery unavailable");
    return factory.modelCatalog(engine);
  }
  async engines():Promise<EngineAvailability[]> {
    return Promise.all(PI_ONLY_ENGINES.map(async original=>{
      const config=original.id==="pi"?undefined:this.options[original.id];
      if(!config)return {...original,...(original.id==="pi"?{modelCatalog:Boolean(this.options.pi.modelCatalog)}:{})};
      let version:string;
      try {
        const result=await exec(config.command,[...(config.args??[]),"--version"],{env:nativeEnvironment(config.env),timeout:5000,maxBuffer:8192});
        version=result.stdout.trim();
      } catch {return {...original,available:false,reason:"Native executable unavailable"};}
      const supported=original.id==="codex" ? /\b0\.(154\.0|156\.1|159\.1)\b/.test(version) : /\b2\.1\.280\b/.test(version);
      if(!supported)return {...original,version,available:false,reason:"Unsupported native CLI version; use the verified release"};
      try {
        const ready=await this.authentication(original.id as "codex"|"claude",config);
        return {...original,version,available:ready,modelCatalog:original.id==="codex" && Boolean(this.options.legacyCodex?.modelCatalog),authentication:ready?"configured" as const:"required" as const,reason:ready?undefined:"Native authentication required; configure this CLI on the User VM"};
      } catch {return {...original,version,available:false,authentication:"unknown" as const,reason:"Native authentication status unavailable; inspect this CLI on the User VM"};}
    }));
  }
  private async authentication(engine:"codex"|"claude",config:NativeCommand):Promise<boolean> {
    if(engine==="codex") {
      const probe=new NativeProcess(config,["app-server"],process.cwd());
      try {
        await probe.call("initialize",{clientInfo:{name:"pi_coffee_readiness",version:"0.1.0"}},5000);
        probe.send({method:"initialized"});
        const result=await probe.call("account/read",{refreshToken:false},5000);
        return result.requiresOpenaiAuth===false || Boolean(result.account);
      } finally {await probe.stop();}
    }
    const args=[...(config.args??[]),"auth","status","--json"];
    const result=await exec(config.command,args,{env:nativeEnvironment(config.env),timeout:5000,maxBuffer:8192}).catch(error=>{
      if(error.code===1 && error.stdout)return {stdout:String(error.stdout)};throw error;
    });
    return JSON.parse(result.stdout).loggedIn===true;
  }
  async prepareTakeover(id:string,operation:TakeoverState,history:AgentHistory){
    if(this.closing)throw new Error('Host is stopping');
    const controller=new AbortController();
    const task=await this.options.workspaces.lookup(id);if(!task)throw new Error('Unknown Task');
    const root=await this.options.workspaces.dataRoot(id),cwd=await this.options.workspaces.file(id,'');
    operation.title ||= history.entries.find(e=>e.kind==='user')?.text.slice(0,160);
    const paths=await prepareTakeoverRecords(root,operation,history);
    let candidate:AgentSession|undefined,nativeId=operation.id,committed=false,temporaryFactory:AgentSessionFactory|undefined;
    const bound=async(value:string)=>{nativeId=value;if(committed)await this.options.workspaces.setNativeBinding(id,{state:'bound',id:value});else await this.options.workspaces.updateTakeover(id,operation.id,{nativeId:value});};
    const rollback=async()=>{this.preparations.delete(controller);await candidate?.stop();await temporaryFactory?.close?.();};
    try{
      if(operation.to==='pi'){
        await bound(nativeId);candidate=await this.options.pi.create({sessionId:nativeId,workspaceSessionId:id});
      }else{
        if(!this.options.codex)throw new Error('Codex unavailable');
        if(this.options.codexSessionFactory){temporaryFactory=this.options.codexSessionFactory(id+'-'+operation.id,cwd,bound);candidate=await temporaryFactory.create({sessionId:operation.id});}
        else candidate=await new CodexSession(this.options.codex,cwd,this.options.instructions).start(undefined,bound);
      }
      this.preparations.set(controller,candidate);if(this.closing)controller.abort();
      await reconstruct(candidate,takeoverPrompt(paths,cwd),180_000,controller.signal);
      if(operation.title)await candidate.rename(operation.title).catch(()=>undefined);
      const previous=await priorHistory(root,operation);
      return {session:withPriorHistory(candidate,previous),commit:async()=>{
        if(this.closing)throw new Error('Host is stopping');
        await this.options.workspaces.commitTakeover(id,operation,{state:'bound',id:nativeId});committed=true;this.preparations.delete(controller);
        if(temporaryFactory)this.codexFactories.set(id+':'+operation.id,temporaryFactory);
      },rollback};
    }catch(error){await rollback().catch(()=>undefined);throw error;}
  }
  async create({sessionId}:{sessionId:string}):Promise<AgentSession> {
    const task=await this.options.workspaces.lookup(sessionId);
    const segment=task?.takeoverSegments?.at(-1);
    const session=await this.createNative(sessionId);
    if(!segment)return session;
    try{return withPriorHistory(session,await priorHistory(await this.options.workspaces.dataRoot(sessionId),segment));}
    catch(error){await session.stop();throw error;}
  }
  private async createNative(sessionId:string):Promise<AgentSession> {
    const task=await this.options.workspaces.lookup(sessionId);
    if(!task && this.options.legacyCodex && (await this.options.legacyCodex.list().catch(()=>[])).some(s=>s.id===sessionId))return this.options.legacyCodex.create({sessionId});
    if(!task && !(await this.options.pi.list()).some(s=>s.id===sessionId))throw new Error("Unknown Task; create a Task with an explicit Agent first");
    if(!task || (task.engine??"pi")==="pi")return this.options.pi.create({sessionId:task?.takeoverSegments?.length?task.nativeBinding!.id!:sessionId,workspaceSessionId:sessionId,requireExisting:Boolean(task?.takeoverSegments?.length)});
    const readiness=(await this.engines()).find(e=>e.id===task.engine);if(!readiness?.available)throw new Error(readiness?.reason??"Agent unavailable");
    const config=this.options[task.engine as "codex"|"claude"];if(!config)throw new Error("Agent not configured");
    const cwd=await this.options.workspaces.file(sessionId,"");
    if(task.nativeBinding?.state==="starting" && !task.nativeBinding.id)throw new Error("Native start was uncertain; inspect it before recovery. No prompt was replayed.");
    if(task.engine==="claude"){
      if(!task.nativeBinding)await this.options.workspaces.setNativeBinding(sessionId,{state:"prepared",requestedId:randomUUID()});
      const extraDirs=task.taskRoot?[await this.options.workspaces.dataRoot(sessionId)]:[];
      const session=new ClaudeSession(config,cwd,task.nativeBinding!,binding=>this.options.workspaces.setNativeBinding(sessionId,binding),extraDirs,await this.options.instructions?.());
      try{return await session.start();}catch(error){await session.stop();throw error;}
    }
    this.generation.set(sessionId,task.takeoverSegments?.at(-1)?.id??'original');
    const nativeId=task.nativeBinding?.id;
    if(!nativeId)await this.options.workspaces.setNativeBinding(sessionId,{state:"starting"});
    const advanced=this.codexFactory(sessionId,cwd);
    if(advanced)return advanced.create({sessionId:nativeId ?? sessionId,requireExisting:Boolean(nativeId)});
    const session=new CodexSession(config,cwd,this.options.instructions);
    try{return await session.start(nativeId,id=>this.options.workspaces.setNativeBinding(sessionId,{state:"bound",id}));}
    catch(error){await session.stop();throw error;}
  }
  async list() {
    const state=await this.options.workspaces.list();
    const piListings=await this.options.pi.list();
    const native=state.conversations.filter(c=>c.engine && (c.engine!=="pi"||c.takeoverSegments?.length));
    const ids=new Set(native.map(c=>c.id));
    for(const c of state.conversations){for(const nativeId of c.retainedNativeIds??[])ids.add(nativeId);if(c.takeover?.nativeId)ids.add(c.takeover.nativeId);for(const segment of c.takeoverSegments??[])if(segment.nativeId)ids.add(segment.nativeId);if(c.takeoverSegments?.length&&c.nativeBinding?.id)ids.add(c.nativeBinding.id);}
    const summaries=await Promise.all(native.map(async c=>{
      const known=c.engine==="codex" && c.nativeBinding?.id && this.options.codexListings
        ? (await this.options.codexListings(await this.options.workspaces.file(c.id,"")).catch(()=>[])).find(s=>s.id===c.nativeBinding!.id) : c.engine==='pi'?piListings.find(s=>s.id===c.nativeBinding?.id):undefined;
      return {createdAt:c.createdAt,updatedAt:c.createdAt,messageCount:c.takeoverSegments?.length?1:0,preview:c.engine==="codex"?"Codex Task":c.engine==="pi"?"Pi Task":"Claude Code Task",...known,...(c.takeoverTitle?{preview:c.takeoverTitle}:{}),id:c.id,engine:c.engine};
    }));
    return [...(await this.options.legacyCodex?.list().catch(()=>[]) ?? []).filter(s=>!ids.has(s.id)).map(s=>({...s,engine:"codex" as const})),...piListings.filter(c=>!ids.has(c.id)),...summaries];
  }
  async delete(id:string) {
    const task=await this.options.workspaces.lookup(id);
    if(task?.takeoverSegments?.length)throw new Error("Takeover history is retained; archive this Task instead");
    if(task?.engine && task.engine!=="pi")throw new Error("Native history is retained; complete native cleanup is not supported");
    return this.options.pi.delete(id);
  }
}
