import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
export interface NativeCommand { command: string; args?: string[]; env?: Record<string,string>; }
export function nativeEnvironment(overrides: Record<string,string> = {}): NodeJS.ProcessEnv {
  // Strip Host secrets from the inherited environment first, then apply the
  // caller's overrides so intentional workspace markers (DATA_ROOT, INITIAL_MODE,
  // SUBAGENTS_TEMP_ROOT, …) survive into the native child.
  const env = {...process.env};
  for (const key of Object.keys(env)) if (/^(PI_COFFEE_|PI_SUBAGENTS_|PI_MCP_|PI_LSP_)/.test(key)) delete env[key];
  Object.assign(env, overrides);
  return env;
}
/** One task-owned native child. No shell, credential inspection or browser lifetime ownership. */
export class NativeProcess {
  readonly child: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<string|number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout|undefined}>();
  private closed = false;
  private messages:Promise<void>=Promise.resolve();
  onMessage?: (message:any)=>void|Promise<void>;
  onExit?: ()=>void;
  constructor(command:NativeCommand,args:string[],cwd:string,private jsonrpc=false) {
    this.child=spawn(command.command,[...(command.args??[]),...args],{cwd,env:nativeEnvironment(command.env),stdio:"pipe",detached:process.platform!=="win32"});
    this.child.stderr.on("data",()=>{}); // Native diagnostics may include provider data; never forward them to Web.
    const input=createInterface({input:this.child.stdout});
    input.on("line",line=>{
      if(Buffer.byteLength(line)>16*1024*1024){this.fail(new Error("Native protocol frame too large"));return;}
      try {
        const message=JSON.parse(line);
        const waiting=this.pending.get(message.id);
        if(waiting && !message.method) {
          this.pending.delete(message.id);clearTimeout(waiting.timer);
          message.error ? waiting.reject(new Error("Native request failed: "+String(message.error.message??"unknown error").replace(/\b(?:sk|xai)-[\w-]+/g,"[redacted]").slice(0,300))) : waiting.resolve(message.result);
        } else this.messages=this.messages.then(()=>this.onMessage?.(message)).catch(()=>this.fail(new Error("Native event could not be processed")));
      } catch { this.fail(new Error("Invalid native protocol response")); }
    });
    this.child.on("error",()=>this.fail(new Error("Native executable could not start")));
    this.child.on("exit",()=>this.fail(new Error("Native process exited")));
  }
  send(value:unknown) {if(this.closed)throw new Error("Native process unavailable");this.child.stdin.write(JSON.stringify(this.jsonrpc?{jsonrpc:"2.0",...(value as object)}:value)+"\n");}
  call(method:string,params:unknown,timeout=30000):Promise<any> {
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{
      const timer=timeout>0?setTimeout(()=>{this.pending.delete(id);reject(new Error("Native request timed out; delivery may be uncertain"));},timeout):undefined;
      this.pending.set(id,{resolve,reject,timer});
      try {this.send({id,method,params});} catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  async drain(){await this.messages;}
  private fail(error:Error) {
    if(this.closed)return;this.closed=true;
    for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(error);}this.pending.clear();
    this.onExit?.();
  }
  async stop() {
    this.onExit=undefined;
    if(this.child.exitCode!==null)return;
    await new Promise<void>(resolve=>{
      const timer=setTimeout(()=>{try{this.kill("SIGKILL");}catch{}resolve();},1500);
      this.child.once("exit",()=>{clearTimeout(timer);resolve();});
      try{this.kill("SIGTERM");}catch{clearTimeout(timer);resolve();}
    });
    this.fail(new Error("Native process stopped"));
  }
  private kill(signal:NodeJS.Signals){if(this.child.pid && process.platform!=="win32")process.kill(-this.child.pid,signal);else this.child.kill(signal);}
}
