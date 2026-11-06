import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {bounded,preparationExecution,readPreparationArtifact} from '../preparation-execution.js';
import {durableFile,sha} from '../restore-files.js';
import {FORK_PREPARATION_POLICY,ForkTurnFailure,applyForkSettings,handoffPrompt,seedForkPrompt,forkTurn,HANDOFF_END,FORK_END,type ForkMode,type ForkPreparationControl} from '../fork.js';
import type {AgentHistory,AgentSession,AgentSessionFactory} from '../agent-adapter.js';
import type {NativeAgentOptions} from './factory.js';
import {ClaudeSession} from './claude.js';
interface ForkPorts {
 closing():boolean;
 preparations:Map<AbortController,AgentSession>;
 buildCodexFactory(id:string,cwd:string,onBound:(id:string)=>Promise<void>,environment?:()=>Promise<Record<string,string>>,preparation?:boolean):Promise<AgentSessionFactory>;
 codexFactory(id:string,cwd:string):Promise<AgentSessionFactory|undefined>;
 resetTaskRuntime(id:string):Promise<void>;
}
/** Native preparation policy only: durable admission, recovery and publication belong to TaskPreparation. */
export async function executeForkPreparation(options:NativeAgentOptions,ports:ForkPorts,sourceId:string,targetId:string,mode:ForkMode,_history:AgentHistory,control?:ForkPreparationControl){
    if(ports.closing())throw new Error('Host is stopping');
    const source=await options.workspaces.lookup(sourceId),target=await options.workspaces.lookup(targetId);
    if(!source||!target?.fork||target.fork.sourceId!==sourceId)throw new Error('Unknown Fork');
    const engine=source.engine??'pi',sourceNative=source.nativeBinding?.id??source.id,cwd=target.cwd;
    const records=join(await options.workspaces.forkRecordsDirectory(targetId),'source-history.json');
    const controller=new AbortController();
    const abort=()=>controller.abort(control?.signal.reason);control?.signal.addEventListener('abort',abort,{once:true});if(control?.signal.aborted)abort();
    const stage=<T>(name:string,run:()=>Promise<T>)=>control?control.stage(name,run):bounded(run,['summary','seed'].includes(name)?180000:120000,controller.signal);
    let savedSummary:string|undefined;
    if(control?.summary){savedSummary=await readPreparationArtifact(join(await options.workspaces.forkRecordsDirectory(targetId),'handoff.md'),256*1024);if(sha(savedSummary)!==control.summary.digest)throw Error('Saved summary changed; resume refused');}
    let session:AgentSession|undefined,temporaryFactory:AgentSessionFactory|undefined;
    const track=(child:AgentSession)=>{session=child;ports.preparations.set(controller,child);if(ports.closing())controller.abort();return child;};
    const closeChild=async()=>{await preparationExecution.exit(()=>bounded(async()=>{try{await session?.stop();}finally{await temporaryFactory?.close?.();}},10000));ports.preparations.delete(controller);session=undefined;temporaryFactory=undefined;};
    let primaryError:unknown;
    try{
      if(engine==='pi'){
        if(!options.pi.forkNative)throw new Error('Native Pi Fork unavailable');
        const child=track(await stage('native-binding',()=>options.pi.forkNative!(sourceNative,{sessionId:targetId,cwd,sourceCwd:source.cwd})));
        if(controller.signal.aborted)throw new Error('Host is stopping');
        await applyForkSettings(child,target.fork.settings);
        if(mode==='handoff')await stage('summary',()=>child.compact());
        await child.rename(target.fork.title);return;
      }
      if(engine==='codex'){
        if(!Boolean(options.codexSessionOptions||options.codexSessionFactory))throw new Error('Native Codex Fork unavailable');
        if(mode==='native'){
          const factory=await ports.codexFactory(targetId,cwd);if(!factory?.forkNative)throw new Error('Native Codex Fork unavailable');
          const child=track(await factory.forkNative(sourceNative,{sessionId:targetId,cwd,sourceCwd:source.cwd}));
          if(controller.signal.aborted)throw new Error('Host is stopping');
          await applyForkSettings(child,target.fork.settings);await child.rename(target.fork.title);return;
        }
        if(!savedSummary){
        const tempId=randomUUID();
        temporaryFactory=await ports.buildCodexFactory(targetId+'-handoff',cwd,id=>options.workspaces.retainForkNative(targetId,id),()=>options.workspaces.runtimeEnvironment(targetId),true);
        if(!temporaryFactory.forkNative)throw new Error('Native Codex Fork unavailable');
        track(await stage('summary-binding',()=>temporaryFactory!.forkNative!(sourceNative,{sessionId:tempId,cwd,sourceCwd:source.cwd})));
        }
      }else{
        if(mode!=='handoff'||!options.claude)throw new Error('Claude supports Handoff Fork only');
        const tempId=randomUUID();await options.workspaces.retainForkNative(targetId,tempId);
        const command={...options.claude,env:{...options.claude.env,...await options.workspaces.runtimeEnvironment(targetId)}};
        track(await new ClaudeSession(command,cwd,{state:'prepared',requestedId:tempId},async()=>{},[await options.workspaces.dataRoot(targetId)],[await options.instructions?.(),await options.workspaces.forkInstructionForCwd(cwd)].filter(Boolean).join('\n'),true).start());
      }
      const preparationSettings=engine==='codex'?{...target.fork.settings,model:{provider:'codex',id:FORK_PREPARATION_POLICY.codexModel},thinkingLevel:FORK_PREPARATION_POLICY.thinkingLevel}:target.fork.settings;
      if(session)await applyForkSettings(session,preparationSettings);
      const prepareTurn=async(prompt:string,marker:string,phase:string)=>{
        try{return await stage(phase,()=>forkTurn(session!,prompt,marker,controller.signal,180000,receipt=>control?.turnCompleted?.(phase,receipt)??Promise.resolve()));}
        catch(error){const Failure=error instanceof ForkTurnFailure?ForkTurnFailure:Error;throw new Failure(`Fork handoff ${phase} failed (${preparationSettings.model?.id??engine} / ${preparationSettings.thinkingLevel??'default'}): ${error instanceof Error?error.message:'Preparation failed'}`);}
      };
      const exported=engine==='claude'?await readPreparationArtifact(records,1024*1024):undefined;if(exported&&Buffer.byteLength(exported)>1024*1024)throw new Error('Claude Handoff history is too large for preparation; source and snapshot retained');
      const summary=savedSummary??await prepareTurn(handoffPrompt(records,cwd,engine==='codex',exported),HANDOFF_END,'summary');
      if(!savedSummary){await durableFile(join(await options.workspaces.forkRecordsDirectory(targetId),'handoff.md'),summary+'\n');await control?.summarySaved(sha(summary+'\n'));}
      await closeChild();if(ports.closing())throw new Error('Host is stopping');
      if(engine==='codex'){
        temporaryFactory=await ports.buildCodexFactory(targetId,cwd,id=>options.workspaces.setNativeBinding(targetId,{state:'bound',id}),()=>options.workspaces.runtimeEnvironment(targetId),true);const current=await options.workspaces.lookup(targetId);track(await stage('seed-binding',()=>temporaryFactory!.create({sessionId:savedSummary&&current?.nativeBinding?.id?current.nativeBinding.id:targetId,requireExisting:Boolean(savedSummary&&current?.nativeBinding?.id)})));
      }else{
        const nativeId=randomUUID();
        const command={...options.claude!,env:{...options.claude!.env,...await options.workspaces.runtimeEnvironment(targetId)}};
        track(await new ClaudeSession(command,cwd,{state:'prepared',requestedId:nativeId},binding=>options.workspaces.setNativeBinding(targetId,binding),[await options.workspaces.dataRoot(targetId)],[await options.instructions?.(),await options.workspaces.forkInstructionForCwd(cwd)].filter(Boolean).join('\n'),true).start());
      }
      await applyForkSettings(session!,{...preparationSettings,contextPreset:undefined});await prepareTurn(seedForkPrompt(summary,records,cwd),FORK_END,'seed');await stage('settings',()=>applyForkSettings(session!,target.fork!.settings));
      if(engine==='codex')await session!.rename(target.fork.title);
    }catch(error){primaryError=error;throw error;}finally{control?.signal.removeEventListener('abort',abort);try{await closeChild();await ports.resetTaskRuntime(targetId);}catch(error){throw Object.assign(new Error(primaryError instanceof Error?primaryError.message:'Preparation cleanup could not be confirmed'),{cleanupUncertain:true,cause:error});}}
}
