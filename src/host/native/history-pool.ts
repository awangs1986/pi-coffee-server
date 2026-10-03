import { Worker, isMainThread } from "node:worker_threads";
import type { AgentHistoryRead } from "../agent-adapter.js";

export const nativeHistoryNeedsWorker = isMainThread;
interface Job { id: number; kind: string; args: unknown; resolve(value: any): void; reject(error: Error): void; timer?: ReturnType<typeof setTimeout> }
interface Slot { worker: Worker; job?: Job; failed: boolean }

/** Isolate full audits from task controls. A timed-out worker owns its slot until exit. */
class NativeHistoryPool {
  private slots: Slot[] = [];
  private queue: Job[] = [];
  private sequence = 0;
  request(kind: string, args: unknown): Promise<any> {
    if (this.queue.length + this.slots.filter(slot => slot.job).length >= 18) return Promise.reject(new Error("Native audit queue is full"));
    return new Promise((resolve, reject) => { this.queue.push({ id: ++this.sequence, kind, args, resolve, reject }); this.drain(); });
  }
  private spawn(): Slot {
    const url = new URL(import.meta.url.endsWith(".ts") ? "./history-worker.ts" : "./history-worker.js", import.meta.url);
    // Tests execute source TS. Resolve its .js specifiers like tsc does; only
    // the worker transpiles source, never the Host's control/event thread.
    const bootstrap = `const {registerHooks}=require('node:module');const {readFileSync}=require('node:fs');const {fileURLToPath}=require('node:url');const ts=require('typescript');
      registerHooks({resolve(specifier,context,next){try{return next(specifier,context);}catch(error){if(context.parentURL?.startsWith('file:')&&specifier.endsWith('.js')&&(specifier.startsWith('.')||specifier.startsWith('file:')))return next(specifier.slice(0,-3)+'.ts',context);throw error;}},load(url,context,next){if(url.startsWith('file:')&&url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(fileURLToPath(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};return next(url,context);}});import(${JSON.stringify(url.href)});`;
    const worker = import.meta.url.endsWith(".ts") ? new Worker(bootstrap, { eval: true }) : new Worker(url);
    const slot: Slot = { worker, failed: false }; this.slots.push(slot);
    worker.on("message", message => {
      if (slot.failed || message.id !== slot.job?.id) return;
      const job = slot.job!; slot.job = undefined; clearTimeout(job.timer);
      if (message.error) job.reject(new Error(message.error)); else job.resolve(message.value);
      worker.unref(); this.drain();
    });
    worker.on("error", error => this.fail(slot, error));
    worker.on("exit", () => {
      if (slot.job) this.fail(slot, new Error("Native audit worker exited"));
      this.slots = this.slots.filter(value => value !== slot); this.drain();
    });
    worker.unref(); return slot;
  }
  private fail(slot: Slot, error: Error) {
    if (slot.failed) return;
    slot.failed = true;
    if (slot.job) { clearTimeout(slot.job.timer); slot.job.reject(error); }
    // Keep the occupied slot until termination is confirmed by exit.
    void slot.worker.terminate();
  }
  private drain() {
    while (this.queue.length) {
      const slot = this.slots.find(value => !value.job && !value.failed) ?? (this.slots.length < 2 ? this.spawn() : undefined);
      if (!slot) return;
      const job = this.queue.shift()!; slot.job = job; slot.worker.ref();
      job.timer = setTimeout(() => this.fail(slot, new Error("Native source audit timed out")), 30_000);
      slot.worker.postMessage({ id: job.id, kind: job.kind, args: job.args });
    }
  }
}
const pool = new NativeHistoryPool();
export function nativeHistoryJob(kind: "pi" | "claude" | "codex" | "takeover", args: unknown): Promise<AgentHistoryRead> { return pool.request(kind, args); }
