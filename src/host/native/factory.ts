import {AcpSession,acpArguments,initializeAcp,acpAuthentication} from './acp.js';
import {NativeSettingsStore} from './settings.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {applyForkSettings,handoffPrompt,seedForkPrompt,forkTurn,HANDOFF_END,FORK_END,type ForkMode} from '../fork.js';
import {writeFile,readFile} from 'node:fs/promises';
import {prepareTakeoverRecords,takeoverPrompt,reconstruct,priorHistory,withPriorHistory,type TakeoverState} from "../takeover.js";
import type {AgentHistory,AgentHistoryRead,AgentSession} from "../agent-adapter.js";
import { CHAT_ENGINES, capabilitiesFor, type AgentEngine } from "../../shared/protocol.js";
import { randomUUID } from "node:crypto";
import { ClaudeSession, readClaudeHistory } from "./claude.js";
import { readCodexHistory } from "../codex/history.js";
import { unknownHistory } from "./history-source.js";
import { nativeHistoryJob } from "./history-pool.js";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentSessionFactory, EngineAvailability } from "../agent-adapter.js";
import { PI_ONLY_ENGINES } from "../agent-adapter.js";
import type { Workspaces } from "../workspaces.js";
import { CodexSession } from "./codex.js";
import { NativeProcess, nativeEnvironment, type NativeCommand } from "./process.js";
const exec=promisify(execFile);
export interface NativeAgentOptions { instructions?:(id?:string)=>Promise<string|undefined>; pi:AgentSessionFactory;workspaces:Workspaces;codex?:NativeCommand;claude?:NativeCommand;cursor?:NativeCommand;grok?:NativeCommand;codexSessionFactory?:(id:string,cwd:string,onBound:(nativeId:string)=>Promise<void>,environment?:()=>Promise<Record<string,string>>,preparation?:boolean)=>AgentSessionFactory;legacyCodex?:AgentSessionFactory;codexSummary?:(cwd:string,id:string)=>Promise<import("../agent-adapter.js").AgentSessionListing|undefined>;codexListings?:(cwd:string)=>Promise<import("../agent-adapter.js").AgentSessionListing[]>; }
/** Routes only by the durable Task binding; browser-provided native IDs are never accepted. */
export class NativeAgentFactory implements AgentSessionFactory {
  private closing=false;
  private readonly preparations=new Map<AbortController,AgentSession>();
  private readonly generation=new Map<string,string>();
  private readonly codexFactories=new Map<string,AgentSessionFactory>();
  constructor(private options:NativeAgentOptions){}
  contextResetEngines():AgentEngine[]{
    return CHAT_ENGINES.filter(engine=>engine==='pi'?Boolean(this.options.pi.resetNative):Boolean(this.options.codex&&this.options.codexSessionFactory));
  }
  forkModes(engine:"pi"|"codex"|"claude"|"cursor"|"grok"):ForkMode[]{
    if(engine==='cursor'||engine==='grok')return [];
    if(engine==='pi')return this.options.pi.forkNative?['native','handoff']:[];
    if(engine==='codex')return this.options.codexSessionFactory?['native','handoff']:[];
    return this.options.claude?['handoff']:[];
  }
  async forkConversation(sourceId:string,targetId:string,mode:ForkMode,_history:AgentHistory){
    if(this.closing)throw new Error('Host is stopping');
    const source=await this.options.workspaces.lookup(sourceId),target=await this.options.workspaces.lookup(targetId);
    if(!source||!target?.fork||target.fork.sourceId!==sourceId)throw new Error('Unknown Fork');
    const engine=source.engine??'pi',sourceNative=source.nativeBinding?.id??source.id,cwd=target.cwd;
    const records=join(await this.options.workspaces.forkRecordsDirectory(targetId),'source-history.json');
    const controller=new AbortController();let session:AgentSession|undefined,temporaryFactory:AgentSessionFactory|undefined;
    const track=(child:AgentSession)=>{session=child;this.preparations.set(controller,child);if(this.closing)controller.abort();return child;};
    const closeChild=async()=>{this.preparations.delete(controller);await session?.stop();session=undefined;await temporaryFactory?.close?.();temporaryFactory=undefined;};
    try{
      if(engine==='pi'){
        if(!this.options.pi.forkNative)throw new Error('Native Pi Fork unavailable');
        const child=track(await this.options.pi.forkNative(sourceNative,{sessionId:targetId,cwd,sourceCwd:source.cwd}));
        if(controller.signal.aborted)throw new Error('Host is stopping');
        await applyForkSettings(child,target.fork.settings);
        if(mode==='handoff')await child.compact();
        await child.rename(target.fork.title);return;
      }
      if(engine==='codex'){
        if(!this.options.codexSessionFactory)throw new Error('Native Codex Fork unavailable');
        if(mode==='native'){
          const factory=await this.codexFactory(targetId,cwd);if(!factory?.forkNative)throw new Error('Native Codex Fork unavailable');
          const child=track(await factory.forkNative(sourceNative,{sessionId:targetId,cwd,sourceCwd:source.cwd}));
          if(controller.signal.aborted)throw new Error('Host is stopping');
          await applyForkSettings(child,target.fork.settings);await child.rename(target.fork.title);return;
        }
        const tempId=randomUUID();
        temporaryFactory=this.options.codexSessionFactory(targetId+'-handoff',cwd,id=>this.options.workspaces.retainForkNative(targetId,id),()=>this.options.workspaces.runtimeEnvironment(targetId),true);
        if(!temporaryFactory.forkNative)throw new Error('Native Codex Fork unavailable');
        track(await temporaryFactory.forkNative(sourceNative,{sessionId:tempId,cwd,sourceCwd:source.cwd}));
      }else{
        if(mode!=='handoff'||!this.options.claude)throw new Error('Claude supports Handoff Fork only');
        const tempId=randomUUID();await this.options.workspaces.retainForkNative(targetId,tempId);
        const command={...this.options.claude,env:{...this.options.claude.env,...await this.options.workspaces.runtimeEnvironment(targetId)}};
        track(await new ClaudeSession(command,cwd,{state:'prepared',requestedId:tempId},async()=>{},[await this.options.workspaces.dataRoot(targetId)],[await this.options.instructions?.(),await this.options.workspaces.forkInstructionForCwd(cwd)].filter(Boolean).join('\n'),true).start());
      }
      await applyForkSettings(session!,target.fork.settings);
      const exported=engine==='claude'?await readFile(records,'utf8'):undefined;if(exported&&Buffer.byteLength(exported)>1024*1024)throw new Error('Claude Handoff history is too large for preparation; source and snapshot retained');
      const summary=await forkTurn(session!,handoffPrompt(records,cwd,engine==='codex',exported),HANDOFF_END,controller.signal);
      await writeFile(join(await this.options.workspaces.forkRecordsDirectory(targetId),'handoff.md'),summary+'\n',{mode:0o600});
      await closeChild();if(this.closing)throw new Error('Host is stopping');
      if(engine==='codex'){
        temporaryFactory=this.options.codexSessionFactory!(targetId,cwd,id=>this.options.workspaces.setNativeBinding(targetId,{state:'bound',id}),()=>this.options.workspaces.runtimeEnvironment(targetId),true);track(await temporaryFactory.create({sessionId:targetId}));
      }else{
        const nativeId=randomUUID();
        const command={...this.options.claude!,env:{...this.options.claude!.env,...await this.options.workspaces.runtimeEnvironment(targetId)}};
        track(await new ClaudeSession(command,cwd,{state:'prepared',requestedId:nativeId},binding=>this.options.workspaces.setNativeBinding(targetId,binding),[await this.options.workspaces.dataRoot(targetId)],[await this.options.instructions?.(),await this.options.workspaces.forkInstructionForCwd(cwd)].filter(Boolean).join('\n'),true).start());
      }
      await applyForkSettings(session!,{...target.fork.settings,contextPreset:undefined});await forkTurn(session!,seedForkPrompt(summary,records,cwd),FORK_END,controller.signal);await applyForkSettings(session!,target.fork.settings);
      if(engine==='codex')await session!.rename(target.fork.title);
    }finally{await closeChild();await this.resetTaskRuntime(targetId);}
  }
  async resetTaskRuntime(id:string){
    for(const [key,factory] of this.codexFactories){if(key.startsWith(id+':')){await factory.close?.();this.codexFactories.delete(key);}}
  }
  async cancelTakeovers(){this.closing=true;for(const controller of this.preparations.keys())controller.abort();await Promise.allSettled([...this.preparations.values()].map(s=>s.stop()));}
  async close(){await this.cancelTakeovers();await Promise.all([...this.codexFactories.values()].map(f=>f.close?.()));await this.options.legacyCodex?.close?.();}
  private async codexFactory(id:string,cwd:string){
    const generation=id+':'+(this.generation.get(id)??'original');let factory=this.codexFactories.get(generation);
    if(!factory&&this.options.codexSessionFactory){
      let nativeId=(await this.options.workspaces.lookup(id))?.nativeBinding?.id;
      factory=this.options.codexSessionFactory((this.generation.get(id)??'original')==='original'?id:generation.replace(':','-'),cwd,async value=>{
        if(nativeId&&nativeId!==value)await this.options.workspaces.rebindCodexThread(id,nativeId,value);
        else await this.options.workspaces.setNativeBinding(id,{state:'bound',id:value});
        nativeId=value;
      },()=>this.options.workspaces.runtimeEnvironment(id));
      this.codexFactories.set(generation,factory);
    }
    return factory;
  }
  async supportsDispatchCorrelation(sessionId:string){const task=await this.options.workspaces.lookup(sessionId);return Boolean(task&&(task.engine??'pi')==='pi'&&await this.options.pi.supportsDispatchCorrelation?.(task.nativeBinding?.id??sessionId));}
  async readRunEvidence(sessionId:string,runId?:string):Promise<import('../agent-adapter.js').AgentRunEvidence>{
    const task=await this.options.workspaces.lookup(sessionId);
    const unknown={supported:false,freshness:'unknown' as const,state:'uncertain' as const,runId,reason:'Engine has no verified passive run evidence capability'};
    if(!task||task.cleanupStarted||task.workspaceRemoved)return unknown;
    if((task.engine??'pi')!=='pi')return {...unknown,capabilities:{online:task.engine==='codex'&&!this.options.codexSessionFactory?'unavailable':'supported',restartRecovery:'unknown',passiveHistory:task.engine==='codex'||task.engine==='claude'?'supported':'unknown',detachedWriters:'unknown'},reason:'No verified passive run recovery; only work observed on an existing Host connection can be registered'};
    const nativeId=task.nativeBinding?.id??sessionId,identity=JSON.stringify(task.nativeBinding);
    const result=await this.options.pi.readRunEvidence?.(nativeId,runId)??unknown;
    const after=await this.options.workspaces.lookup(sessionId);
    if(!after||JSON.stringify(after.nativeBinding)!==identity||(after.engine??'pi')!=='pi')return {...unknown,supported:true};
    return {...result,identity:'native-run',referenceKind:'native-message',capabilities:{online:'supported',restartRecovery:'supported',passiveHistory:'supported',detachedWriters:'unknown'}};
  }
  async readHistory(sessionId: string): Promise<AgentHistoryRead> {
    const task = await this.options.workspaces.lookup(sessionId);
    if (!task) {
      // Legacy discovery must not call list(): Codex list may start app-server.
      const pi = await this.options.pi.readHistory?.(sessionId);
      if (pi?.sourceFreshness === "current") return pi;
      const codex = await this.options.legacyCodex?.readHistory?.(sessionId);
      return codex?.sourceFreshness === "current" ? codex : pi ?? codex ?? unknownHistory(`unbound:${sessionId}`);
    }
    const identity = (value: typeof task | undefined) => value ? JSON.stringify({ engine: value.engine ?? "pi", cwd: value.cwd, nativeId: value.nativeBinding?.id, segments: value.takeoverSegments ?? [], removed: value.workspaceRemoved, cleanup: value.cleanupStarted }) : "missing";
    const before = identity(task), segment = task.takeoverSegments?.at(-1), engine = task.engine ?? "pi";
    const nativeId = engine === "pi" && !segment && !task.contextReset ? sessionId : task.nativeBinding?.id;
    const binding = `${engine}:${nativeId ?? "unbound"}:${segment?.id ?? task.contextReset?.id ?? "original"}`;
    if (!nativeId || task.cleanupStarted || task.workspaceRemoved) return unknownHistory(binding);
    try {
      let read: AgentHistoryRead;
      if (engine === "pi") read = await this.options.pi.readHistory?.(nativeId) ?? unknownHistory(binding);
      else if ((engine === "cursor" || engine === "grok")) read = unknownHistory(binding); // ACP has no verified passive native-history reader.
      else if (engine === "claude") read = this.options.claude ? await readClaudeHistory(this.options.claude, task.cwd, nativeId) : unknownHistory(binding);
      else {
        this.generation.set(sessionId, segment?.id ?? task.contextReset?.id ?? "original");
        const factory = await this.codexFactory(sessionId, task.cwd);
        read = factory?.readHistory ? await factory.readHistory(nativeId) : this.options.codex ? await readCodexHistory({ cwd: task.cwd, env: this.options.codex.env }, nativeId) : unknownHistory(binding);
      }
      if (read.sourceFreshness !== "current" || identity(await this.options.workspaces.lookup(sessionId)) !== before) return unknownHistory(binding);
      if (segment) {
        // The takeover display prefix is already durable. Do not call dataRoot(),
        // which creates directories and updates Git exclusions on a read route.
        const root = task.taskRoot ?? (task.workspaceKind === "chat" ? task.cwd : join(task.cwd, ".pi-coffee"));
        read = await nativeHistoryJob("takeover", { read, root, segment });
      }
      if (identity(await this.options.workspaces.lookup(sessionId)) !== before) return unknownHistory(binding);
      return { ...read, binding: `${read.binding}:${segment?.id ?? "original"}`, checkedAt: new Date().toISOString() };
    } catch { return unknownHistory(binding); }
  }
  async capabilities(id:string){
    const task=await this.options.workspaces.lookup(id);
    const engine=task?.engine ?? ((await this.options.legacyCodex?.list().catch(()=>[]) ?? []).some(s=>s.id===id)?"codex":"pi");
    if(engine==="codex" && this.options.codexSessionFactory)return {...capabilitiesFor("pi"),commands:true,extensions:false,cleanup:false};
    return capabilitiesFor(engine);
  }
  private claudeDiscovery?:Promise<{models:import("../agent-adapter.js").AgentModels;commands:import("../../shared/protocol.js").CommandInfo[]}>;
  private claudeCatalog(){return this.claudeDiscovery??=this.discoverClaude().finally(()=>{this.claudeDiscovery=undefined;});}
  private async discoverClaude(){
    if(!this.options.claude)throw new Error('Claude Code is not configured');
    const cwd=await mkdtemp(join(tmpdir(),'coffee-claude-catalog-'));
    const session=new ClaudeSession(this.options.claude,cwd,{state:'prepared',requestedId:randomUUID()},async()=>{},[],undefined,false,new NativeSettingsStore(),true);
    try{await session.start();return {models:await session.getModels(),commands:await session.getCommands()};}
    finally{await session.stop();await rm(cwd,{recursive:true,force:true});}
  }
  async commandCatalog(engine:import('../../shared/protocol.js').AgentEngine) {
    if(engine==='claude')return (await this.claudeCatalog()).commands;
    if(engine==="codex"){
      if(!this.options.codex || !this.options.legacyCodex?.commandCatalog)throw new Error("Codex Skill discovery unavailable");
      return this.options.legacyCodex.commandCatalog(engine);
    }
    if(engine!=="pi"||!this.options.pi.commandCatalog)throw new Error("Pi command discovery unavailable");
    return this.options.pi.commandCatalog(engine);
  }
  async modelCatalog(engine:import('../../shared/protocol.js').AgentEngine) {
    if(engine==='claude')return (await this.claudeCatalog()).models;
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
      const supported=original.id==="grok" ? /\b1\.0\.46\b/.test(version) : original.id==="cursor" ? /^2026\.10\.01-e373342$/.test(version) : original.id==="codex" ? /\b0\.(154\.0|156\.1|159\.1)\b/.test(version) : /\b2\.1\.280\b/.test(version);
      if(!supported)return {...original,version,available:false,reason:"Unsupported native CLI version; use the verified release"};
      try {
        const ready=await this.authentication(original.id as "codex"|"claude"|"cursor"|"grok",config);
        return {...original,version,available:ready,modelCatalog:original.id==="claude" || (original.id==="codex" && Boolean(this.options.legacyCodex?.modelCatalog)),authentication:ready?"configured" as const:"required" as const,reason:ready?undefined:"Native authentication required; configure this CLI on the User VM"};
      } catch {return {...original,version,available:false,authentication:"unknown" as const,reason:"Native authentication status unavailable; inspect this CLI on the User VM"};}
    }));
  }
  private async authentication(engine:"codex"|"claude"|"cursor"|"grok",config:NativeCommand):Promise<boolean> {
    if(engine==='grok'){
      const probe=new NativeProcess(config,acpArguments('grok'),process.cwd(),true);
      try{
        const initialized=await initializeAcp(probe,5000);
        if(initialized.protocolVersion!==1)throw new Error('Unsupported Grok ACP protocol');
        let params:Record<string,unknown>;try{params=acpAuthentication('grok',initialized,config);}catch{return false;}
        await probe.call('authenticate',params,5000);return true;
      }finally{await probe.stop();}
    }
    if(engine==="codex") {
      // Readiness is local credential configuration, not remote account hydration.
      // account/read can time out while this login and model/list remain usable.
      const loggedIn=await exec(config.command,[...(config.args??[]),'login','status'],{env:nativeEnvironment(config.env),timeout:5000,maxBuffer:8192})
        .then(()=>true,error=>{if(error.code===1)return false;throw error;});
      if(loggedIn)return true;
      // A custom provider can intentionally require no OpenAI credentials.
      const probe=new NativeProcess(config,["app-server"],process.cwd());
      try {
        await probe.call("initialize",{clientInfo:{name:"pi_coffee_readiness",version:"0.1.0"}},5000);
        probe.send({method:"initialized"});
        const result=await probe.call("account/read",{refreshToken:false},5000);
        return result.requiresOpenaiAuth===false || Boolean(result.account);
      } finally {await probe.stop();}
    }
    const args=[...(config.args??[]),...(engine==="cursor"?["status","--format","json"]:["auth","status","--json"])];
    const result=await exec(config.command,args,{env:nativeEnvironment(config.env),timeout:5000,maxBuffer:8192}).catch(error=>{
      if(error.code===1 && error.stdout)return {stdout:String(error.stdout)};throw error;
    });
    const status=JSON.parse(result.stdout);return engine==="cursor"?status.isAuthenticated===true:status.loggedIn===true;
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
        if(this.options.codexSessionFactory){temporaryFactory=this.options.codexSessionFactory(id+'-'+operation.id,cwd,bound,()=>this.options.workspaces.runtimeEnvironment(id));candidate=await temporaryFactory.create({sessionId:operation.id});}
        else candidate=await new CodexSession({...this.options.codex,env:{...this.options.codex.env,...await this.options.workspaces.runtimeEnvironment(id)}},cwd,this.options.instructions).start(undefined,bound);
      }
      this.preparations.set(controller,candidate);if(this.closing)controller.abort();
      if(operation.to==='codex'){await candidate.setModel('codex','gpt-6.1-sol');await candidate.setThinkingLevel('medium');}
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
  async prepareContextReset(id:string,operation:{id:string;expectedNativeId:string;title:string},settings:import('../agent-adapter.js').AgentModels){
    const task=await this.options.workspaces.lookup(id);
    if(!task||task.workspaceKind!=='chat'||!this.contextResetEngines().includes(task.engine??'pi')||task.archived||task.contextReset?.id===operation.id||(task.nativeBinding?.id??id)!==operation.expectedNativeId)throw new Error('Chat context changed or reset unavailable; refresh before clearing');
    if(this.closing)throw new Error('Host is stopping');
    let nativeId:string=randomUUID(),committed=false;const controller=new AbortController();let session:AgentSession|undefined,temporaryFactory:AgentSessionFactory|undefined;
    const rollback=async()=>{this.preparations.delete(controller);await session?.stop();if(temporaryFactory)await temporaryFactory.close?.();else await this.options.pi.delete(nativeId);};
    try{
      if((task.engine??'pi')==='pi')session=await this.options.pi.resetNative!(operation.expectedNativeId,{sessionId:nativeId,cwd:task.cwd,workspaceSessionId:id});
      else{
        temporaryFactory=this.options.codexSessionFactory!(id+'-'+operation.id,task.cwd,async value=>{if(committed&&value!==nativeId)await this.options.workspaces.rebindCodexThread(id,nativeId,value);nativeId=value;},()=>this.options.workspaces.runtimeEnvironment(id));
        session=await temporaryFactory.create({sessionId:operation.id});
      }
      this.preparations.set(controller,session);if(this.closing||controller.signal.aborted)throw new Error('Host is stopping');
      await applyForkSettings(session,{model:settings.current??undefined,thinkingLevel:settings.thinkingLevel,contextPreset:settings.context?.preset});
      await session.rename(operation.title||'Chat');
      if((await session.getHistory()).entries.some(e=>e.kind==='user'||e.kind==='assistant'||e.kind==='tool'))throw new Error('Native context reset did not produce an empty conversation');
      return {session,commit:async()=>{if(this.closing||controller.signal.aborted)throw new Error('Host is stopping');await this.options.workspaces.commitContextReset(id,operation,nativeId);committed=true;if(temporaryFactory){this.codexFactories.set(id+':'+operation.id,temporaryFactory);this.generation.set(id,operation.id);}this.preparations.delete(controller);},rollback};
    }catch(error){await rollback().catch(()=>undefined);throw error;}
  }
  async create({sessionId}:{sessionId:string}):Promise<AgentSession> {
    const task=await this.options.workspaces.lookup(sessionId);
    const segment=task?.takeoverSegments?.at(-1);
    const session=await this.createNative(sessionId);
    const read=session.readRunEvidence?.bind(session);
    if(read){
      // The adapter may remain open when an out-of-band task binding changes.
      // Fence that connection before exposing evidence for the replacement task.
      const engine=task?.engine,cwd=task?.cwd,generation=segment?.id;
      session.readRunEvidence=async runId=>{
        const current=await this.options.workspaces.lookup(sessionId),evidence=await read(runId);
        const valid=current&&!current.cleanupStarted&&!current.workspaceRemoved&&current.engine===engine&&current.cwd===cwd&&current.takeoverSegments?.at(-1)?.id===generation&&current.nativeBinding?.id&&evidence.binding?.startsWith(`${engine}:${current.nativeBinding.id}:`);
        return valid?evidence:{supported:true,freshness:'unknown',state:'uncertain',runId,capabilities:evidence.capabilities,reason:'Live native binding changed; no run was adopted'};
      };
    }
    if(!segment)return session;
    try{return withPriorHistory(session,await priorHistory(await this.options.workspaces.dataRoot(sessionId),segment));}
    catch(error){await session.stop();throw error;}
  }
  private async createNative(sessionId:string):Promise<AgentSession> {
    const task=await this.options.workspaces.lookup(sessionId);
    if(task?.fork&&task.fork.status!=='completed')throw new Error(task.fork.error??'Fork preparation is not complete');
    if(!task && this.options.legacyCodex && (await this.options.legacyCodex.list().catch(()=>[])).some(s=>s.id===sessionId))return this.options.legacyCodex.create({sessionId});
    if(!task && !(await this.options.pi.list()).some(s=>s.id===sessionId))throw new Error("Unknown Task; create a Task with an explicit Agent first");
    if(!task || (task.engine??"pi")==="pi")return this.options.pi.create({sessionId:task?.takeoverSegments?.length||task?.contextReset?task.nativeBinding!.id!:sessionId,workspaceSessionId:sessionId,requireExisting:Boolean(task?.takeoverSegments?.length||task?.contextReset)});
    const readiness=(await this.engines()).find(e=>e.id===task.engine);if(!readiness?.available)throw new Error(readiness?.reason??"Agent unavailable");
    const baseConfig=this.options[task.engine as "codex"|"claude"|"cursor"|"grok"];if(!baseConfig)throw new Error("Agent not configured");
    const config={...baseConfig,env:{...baseConfig.env,...await this.options.workspaces.runtimeEnvironment(sessionId)}};
    const cwd=await this.options.workspaces.file(sessionId,"");
    if(task.nativeBinding?.state==="starting" && !task.nativeBinding.id)throw new Error("Native start was uncertain; inspect it before recovery. No prompt was replayed.");
    if(task.engine==='cursor'||task.engine==='grok'){
      const settings=new NativeSettingsStore(join(await this.options.workspaces.dataRoot(sessionId),task.engine+'-settings.json'));
      const session=new AcpSession(task.engine,config,cwd,task.nativeBinding,binding=>this.options.workspaces.setNativeBinding(sessionId,binding),settings,await this.options.instructions?.());
      try{return await session.start();}catch(error){await session.stop();throw error;}
    }
    if(task.engine==="claude"){
      if(!task.nativeBinding){task.nativeBinding={state:"prepared",requestedId:randomUUID()};await this.options.workspaces.setNativeBinding(sessionId,task.nativeBinding);}
      const extraDirs=task.taskRoot?[await this.options.workspaces.dataRoot(sessionId)]:[];
      const session=new ClaudeSession(config,cwd,task.nativeBinding!,binding=>this.options.workspaces.setNativeBinding(sessionId,binding),extraDirs,[await this.options.instructions?.(),await this.options.workspaces.forkInstructionForCwd(cwd)].filter(Boolean).join('\n'),false,new NativeSettingsStore(join(await this.options.workspaces.dataRoot(sessionId),'claude-settings.json')));
      try{return await session.start();}catch(error){await session.stop();throw error;}
    }
    this.generation.set(sessionId,task.takeoverSegments?.at(-1)?.id??task.contextReset?.id??'original');
    const nativeId=task.nativeBinding?.id;
    if(!nativeId)await this.options.workspaces.setNativeBinding(sessionId,{state:"starting"});
    const advanced=await this.codexFactory(sessionId,cwd);
    if(advanced)return advanced.create({sessionId:nativeId ?? sessionId,requireExisting:Boolean(nativeId)});
    const session=new CodexSession(config,cwd,this.options.instructions&&task.workspaceKind!=='chat'?()=>this.options.instructions!(sessionId):undefined);
    try{return await session.start(nativeId,id=>this.options.workspaces.setNativeBinding(sessionId,{state:"bound",id}));}
    catch(error){await session.stop();throw error;}
  }
  async list() {
    const state=await this.options.workspaces.list();
    const piListings=await this.options.pi.list();
    const native=state.conversations.filter(c=>c.engine && (c.engine!=="pi"||c.takeoverSegments?.length||c.contextReset||c.fork));
    const ids=new Set(native.map(c=>c.id));
    for(const c of state.conversations){for(const nativeId of c.retainedNativeIds??[])ids.add(nativeId);if(c.takeover?.nativeId)ids.add(c.takeover.nativeId);for(const segment of c.takeoverSegments??[])if(segment.nativeId)ids.add(segment.nativeId);if((c.takeoverSegments?.length||c.contextReset)&&c.nativeBinding?.id)ids.add(c.nativeBinding.id);}
    const summaries=await Promise.all(native.map(async c=>{
      const readable=!c.workspaceRemoved&&!c.cleanupStarted&&(!c.creationState||c.creationState==='ready');
      const known=!readable?undefined:c.engine==="codex" && c.nativeBinding?.id && this.options.codexSummary
        ? await this.options.codexSummary(await this.options.workspaces.file(c.id,""),c.nativeBinding.id).catch(()=>undefined)
        : c.engine==="codex" && c.nativeBinding?.id && this.options.codexListings
        ? (await this.options.codexListings(await this.options.workspaces.file(c.id,"")).catch(()=>[])).find(s=>s.id===c.nativeBinding!.id) : c.engine==='pi'?piListings.find(s=>s.id===(c.nativeBinding?.id??c.id)):undefined;
      const preferences=c.engine==="claude"&&readable?await new NativeSettingsStore(join(c.taskRoot??join(c.cwd,".pi-coffee"),"claude-settings.json")).load().catch(()=>({name:undefined})):undefined;
      return {...(preferences?.name?{name:preferences.name}:{}),createdAt:c.createdAt,updatedAt:c.createdAt,messageCount:c.takeoverSegments?.length?1:0,preview:c.engine==="codex"?"Codex Task":c.engine==="pi"?"Pi Task":c.engine==="cursor"?"Cursor Task":c.engine==="grok"?"Grok Build Task":"Claude Code Task",...(c.fork?{name:c.fork.title,preview:c.fork.title}:{}),...known,...(c.takeoverTitle?{preview:c.takeoverTitle}:{}),...(c.contextReset?.title&&!known?.name?{name:c.contextReset.title}:{}),id:c.id,engine:c.engine};
    }));
    return [...(await this.options.legacyCodex?.list().catch(()=>[]) ?? []).filter(s=>!ids.has(s.id)).map(s=>({...s,engine:"codex" as const})),...piListings.filter(c=>!ids.has(c.id)).map(row=>{const task=state.conversations.find(c=>c.id===row.id);return task?.fork?{...row,name:row.name||task.fork.title,preview:row.preview||task.fork.title}:row;}),...summaries];
  }
  async delete(id:string) {
    const task=await this.options.workspaces.lookup(id);
    if(task?.takeoverSegments?.length||task?.contextReset)throw new Error("Retained native history exists; archive this Task instead");
    if(task?.engine && task.engine!=="pi")throw new Error("Native history is retained; complete native cleanup is not supported");
    return this.options.pi.delete(id);
  }
}
