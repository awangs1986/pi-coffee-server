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
export interface NativeAgentOptions { pi:AgentSessionFactory;workspaces:Workspaces;codex?:NativeCommand;claude?:NativeCommand;codexSessionFactory?:(id:string,cwd:string,onBound:(nativeId:string)=>Promise<void>)=>AgentSessionFactory;legacyCodex?:AgentSessionFactory;codexListings?:(cwd:string)=>Promise<import("../agent-adapter.js").AgentSessionListing[]>; }
/** Routes only by the durable Task binding; browser-provided native IDs are never accepted. */
export class NativeAgentFactory implements AgentSessionFactory {
  private readonly codexFactories=new Map<string,AgentSessionFactory>();
  constructor(private options:NativeAgentOptions){}
  async close(){await Promise.all([...this.codexFactories.values()].map(f=>f.close?.()));await this.options.legacyCodex?.close?.();}
  private codexFactory(id:string,cwd:string){let factory=this.codexFactories.get(id);if(!factory && this.options.codexSessionFactory){factory=this.options.codexSessionFactory(id,cwd,nativeId=>this.options.workspaces.setNativeBinding(id,{state:"bound",id:nativeId}));this.codexFactories.set(id,factory);}return factory;}
  async capabilities(id:string){
    const task=await this.options.workspaces.lookup(id);
    const engine=task?.engine ?? ((await this.options.legacyCodex?.list().catch(()=>[]) ?? []).some(s=>s.id===id)?"codex":"pi");
    if(engine==="codex" && this.options.codexSessionFactory)return {...capabilitiesFor("pi"),commands:false,extensions:false,cleanup:false};
    return capabilitiesFor(engine);
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
      const supported=original.id==="codex" ? /\b0\.(154\.0|156\.1)\b/.test(version) : /\b2\.1\.280\b/.test(version);
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
  async create({sessionId}:{sessionId:string}) {
    const task=await this.options.workspaces.lookup(sessionId);
    if(!task && this.options.legacyCodex && (await this.options.legacyCodex.list().catch(()=>[])).some(s=>s.id===sessionId))return this.options.legacyCodex.create({sessionId});
    if(!task && !(await this.options.pi.list()).some(s=>s.id===sessionId))throw new Error("Unknown Task; create a Task with an explicit Agent first");
    if(!task || (task.engine??"pi")==="pi")return this.options.pi.create({sessionId});
    const readiness=(await this.engines()).find(e=>e.id===task.engine);if(!readiness?.available)throw new Error(readiness?.reason??"Agent unavailable");
    const config=this.options[task.engine as "codex"|"claude"];if(!config)throw new Error("Agent not configured");
    const cwd=await this.options.workspaces.file(sessionId,"");
    if(task.nativeBinding?.state==="starting" && !task.nativeBinding.id)throw new Error("Native start was uncertain; inspect it before recovery. No prompt was replayed.");
    if(task.engine==="claude"){
      if(!task.nativeBinding)await this.options.workspaces.setNativeBinding(sessionId,{state:"prepared",requestedId:randomUUID()});
      const session=new ClaudeSession(config,cwd,task.nativeBinding!,binding=>this.options.workspaces.setNativeBinding(sessionId,binding));
      try{return await session.start();}catch(error){await session.stop();throw error;}
    }
    const nativeId=task.nativeBinding?.id;
    if(!nativeId)await this.options.workspaces.setNativeBinding(sessionId,{state:"starting"});
    const advanced=this.codexFactory(sessionId,cwd);
    if(advanced)return advanced.create({sessionId:nativeId ?? sessionId,requireExisting:Boolean(nativeId)});
    const session=new CodexSession(config,cwd);
    try{return await session.start(nativeId,id=>this.options.workspaces.setNativeBinding(sessionId,{state:"bound",id}));}
    catch(error){await session.stop();throw error;}
  }
  async list() {
    const state=await this.options.workspaces.list();
    const native=state.conversations.filter(c=>c.engine && c.engine!=="pi");
    const ids=new Set(native.map(c=>c.id));
    const summaries=await Promise.all(native.map(async c=>{
      const known=c.engine==="codex" && c.nativeBinding?.id && this.options.codexListings
        ? (await this.options.codexListings(await this.options.workspaces.file(c.id,"")).catch(()=>[])).find(s=>s.id===c.nativeBinding!.id) : undefined;
      return {createdAt:c.createdAt,updatedAt:c.createdAt,messageCount:0,preview:c.engine==="codex"?"Codex Task":"Claude Code Task",...known,id:c.id,engine:c.engine};
    }));
    return [...(await this.options.legacyCodex?.list().catch(()=>[]) ?? []).map(s=>({...s,engine:"codex" as const})),...(await this.options.pi.list()).filter(c=>!ids.has(c.id)),...summaries];
  }
  async delete(id:string) {
    const task=await this.options.workspaces.lookup(id);
    if(task?.engine && task.engine!=="pi")throw new Error("Native history is retained; complete native cleanup is not supported");
    return this.options.pi.delete(id);
  }
}
