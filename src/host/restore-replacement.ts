import {execFileSync} from 'node:child_process';import {lstat} from 'node:fs/promises';import {dirname} from 'node:path';import type {RestoreAction} from './restore.js';import {restoreParent,restoreFail,syncDir,treeDigest} from './restore-files.js';
export interface ReplacementPreimage {dev:number;ino:number;digest:string;}
export interface ReplacementAction extends RestoreAction {replace:ReplacementPreimage;}
/** Called only under approved revision, verified current-safety material and the
 * native group/publication lease. Atomic exchange leaves the old tree at the
 * private staged source, never deleted or rolled back over a later writer. */
export async function preflightApprovedReplacement(action:ReplacementAction,context:{assertValid:()=>void}):Promise<'ready'|'installed'>{
 context.assertValid();const parent=await restoreParent(dirname(action.target),action.parent.guardRoot);if(parent.dev!==action.parent.dev||parent.ino!==action.parent.ino||parent.uid!==action.parent.uid)throw restoreFail('target_parent_changed');
 const target=await lstat(action.target),source=await lstat(action.source);if(target.isSymbolicLink()||source.isSymbolicLink())throw restoreFail('replacement_target_changed');
 const matches=async(path:string,actual:{dev:number;ino:number},expected:ReplacementPreimage)=>actual.dev===expected.dev&&actual.ino===expected.ino&&await treeDigest(path)===expected.digest;
 const newIdentity={dev:action.dev,ino:action.ino,digest:action.digest};if(await matches(action.target,target,newIdentity)){if(!await matches(action.source,source,action.replace))throw restoreFail('replacement_preimage_changed');return 'installed';}
 if(!await matches(action.target,target,action.replace))throw restoreFail('replacement_target_changed');if(!await matches(action.source,source,newIdentity))throw restoreFail('stage_changed');context.assertValid();return 'ready';
}
export async function publishApprovedReplacement(action:ReplacementAction,context:{assertValid:()=>void;afterExchange?:()=>Promise<void>}){
 if(await preflightApprovedReplacement(action,context)==='installed')return;
 context.assertValid();try{execFileSync('/usr/bin/python3',['-c',"import ctypes,os,sys;lib=ctypes.CDLL(None,use_errno=True);r=lib.renameat2(-100,os.fsencode(sys.argv[1]),-100,os.fsencode(sys.argv[2]),2);e=ctypes.get_errno();sys.exit(0) if r==0 else (_ for _ in ()).throw(OSError(e,os.strerror(e)))",action.source,action.target],{timeout:10000,maxBuffer:4096,stdio:'ignore',env:{PATH:'/usr/bin:/bin',LANG:'C',PYTHONNOUSERSITE:'1'}});}catch{throw restoreFail('replacement_exchange_failed');}
 await syncDir(dirname(action.target));await syncDir(dirname(action.source));context.assertValid();await context.afterExchange?.();if(await preflightApprovedReplacement(action,context)!=='installed')throw restoreFail('replacement_target_changed');
}
