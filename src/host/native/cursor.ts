import {AcpSession} from './acp.js';
import type {NativeCommand} from './process.js';
import type {NativeBinding} from '../workspaces.js';
import type {NativeSettingsStore} from './settings.js';

/** Cursor-specific entry point; vendor methods remain gated inside the ACP adapter. */
export class CursorSession extends AcpSession {
  constructor(command:NativeCommand,cwd:string,binding:NativeBinding|undefined,save:(binding:NativeBinding)=>Promise<void>,settings?:NativeSettingsStore,instructions?:string){super('cursor',command,cwd,binding,save,settings,instructions);}
}
