import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { JsonValue } from "../../shared/protocol.js";

/** JSON-RPC 2.0 over stdio as `codex app-server` speaks it: one object per line, no `jsonrpc` field. */

export type Json = JsonValue;
export type Obj = { [key: string]: Json };

export interface RpcError { code?: number; message: string }

/** A server-initiated request we owe an answer to (approvals). */
export interface PendingServerRequest {
  id: Json;
  method: string;
  params: Obj;
}


export interface ThreadSubscriber {
  notification: (method: string, params: Obj) => void;
  /** Return true when handled; unhandled server requests are declined generically. */
  request: (request: PendingServerRequest) => boolean;
  exit: () => void;
}

export interface CodexAppServerOptions {
  cliPath: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

/** One `codex app-server` child; requests are multiplexed by id, events routed by threadId. */
export class CodexAppServer {
  private readonly options: CodexAppServerOptions;
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: Json) => void; reject: (error: Error) => void }>();
  private readonly subscribers = new Map<string, Set<ThreadSubscriber>>();
  private readonly globalListeners = new Set<(method: string, params: Obj) => void>();
  private exited = false;
  private stderrTail = "";

  constructor(options: CodexAppServerOptions) {
    this.options = options;
  }

  get alive(): boolean {
    return this.child !== undefined && !this.exited;
  }

  async start(clientName: string, clientVersion: string): Promise<void> {
    await mkdir(this.options.cwd, { recursive: true });
    const child = spawn(this.options.cliPath, this.options.args, {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    this.child = child;
    child.stdin.on("error", (error) => this.onExit(`codex app-server input closed: ${error.message}`));
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-4000);
    });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.onLine(line));
    const exit = new Promise<never>((_, reject) => {
      child.once("error", (error) => { this.onExit(`codex app-server failed to start: ${error.message}`); reject(error); });
      child.once("exit", (code, signal) => {
        const reason = `codex app-server exited (${signal ?? code}); inspect native diagnostics on the VM`;
        this.onExit(reason);
        reject(new Error(reason));
      });
    });
    exit.catch(() => undefined);
    await Promise.race([
      this.request("initialize", { clientInfo: { name: clientName, title: "PI Coffee", version: clientVersion } }),
      exit,
    ]);
    this.notify("initialized", {});
  }

  request(method: string, params: Json): Promise<Json> {
    const child = this.child;
    if (!child || this.exited) return Promise.reject(new Error("codex app-server is not running"));
    const id = this.nextId++;
    return new Promise<Json>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(new Error(`codex app-server input closed: ${error.message}`));
        }
      });
    });
  }

  notify(method: string, params: Json): void {
    this.child?.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  respond(id: Json, result: Json): void {
    this.child?.stdin.write(`${JSON.stringify({ id, result })}\n`);
  }

  /** Notifications that belong to no thread (account meters, …). */
  subscribeGlobal(listener: (method: string, params: Obj) => void): () => void {
    this.globalListeners.add(listener);
    return () => { this.globalListeners.delete(listener); };
  }

  subscribe(threadId: string, subscriber: ThreadSubscriber): () => void {
    let set = this.subscribers.get(threadId);
    if (!set) {
      set = new Set();
      this.subscribers.set(threadId, set);
    }
    set.add(subscriber);
    return () => {
      set!.delete(subscriber);
      if (set!.size === 0) this.subscribers.delete(threadId);
    };
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child?.pid) return;
    const gone = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.stdin.end();
    const kill = (signal:NodeJS.Signals) => {
      try {if(child.pid && process.platform!=="win32")process.kill(-child.pid,signal);else child.kill(signal);}catch{}
    };
    if(child.exitCode!==null || child.signalCode!==null){kill("SIGKILL");return;}
    const timer = setTimeout(() => kill("SIGKILL"), 3000);
    kill("SIGTERM");
    await gone;
    clearTimeout(timer);
    kill("SIGKILL"); // The CLI wrapper can exit before its native child.
  }

  private onLine(line: string): void {
    let message: Obj;
    try {
      const parsed = JSON.parse(line) as Json;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
      message = parsed;
    } catch {
      return; // Codex writes only JSON to stdout; anything else is noise.
    }
    const id = message.id;
    if (typeof message.method === "string") {
      const params = (typeof message.params === "object" && message.params !== null && !Array.isArray(message.params) ? message.params : {}) as Obj;
      if (id === undefined || id === null) {
        this.dispatchNotification(message.method, params);
      } else {
        this.dispatchServerRequest({ id, method: message.method, params });
      }
      return;
    }
    if (typeof id === "number") {
      const waiter = this.pending.get(id);
      if (!waiter) return;
      this.pending.delete(id);
      if (message.error !== undefined && message.error !== null) {
        const error = message.error as Partial<RpcError>;
        waiter.reject(new Error(typeof error.message === "string" ? error.message : "Codex RPC error"));
      } else {
        waiter.resolve(message.result ?? null);
      }
    }
  }

  private dispatchNotification(method: string, params: Obj): void {
    const threadId = typeof params.threadId === "string"
      ? params.threadId
      : typeof (params.thread as Obj | undefined)?.id === "string" ? String((params.thread as Obj).id) : undefined;
    if (threadId === undefined) {
      for (const listener of this.globalListeners) {
        try { listener(method, params); } catch { /* same rule: one bad listener must not break the stream */ }
      }
      return;
    }
    for (const subscriber of this.subscribers.get(threadId) ?? []) {
      try { subscriber.notification(method, params); } catch { /* one bad listener must not break the stream */ }
    }
  }

  private dispatchServerRequest(request: PendingServerRequest): void {
    const threadId = typeof request.params.threadId === "string" ? request.params.threadId : undefined;
    const handled = [...(threadId === undefined ? [] : this.subscribers.get(threadId) ?? [])].some((subscriber) => {
      try { return subscriber.request(request); } catch { return false; }
    });
    if (handled) return;
    // Nobody can answer: refuse rather than hang Codex.
    const legacy = request.method === "execCommandApproval" || request.method === "applyPatchApproval";
    if (request.method.endsWith("requestApproval") || legacy) {
      this.respond(request.id, { decision: legacy ? "denied" : "decline" });
    } else if (request.method === "item/tool/requestUserInput") {
      this.respond(request.id, { answers: {} });
    } else {
      this.child?.stdin.write(`${JSON.stringify({ id: request.id, error: { code: -32601, message: `PI Coffee cannot answer ${request.method}` } })}\n`);
    }
  }

  private onExit(reason = "codex app-server exited"): void {
    if (this.exited) return;
    this.exited = true;
    for (const waiter of this.pending.values()) waiter.reject(new Error(reason));
    this.pending.clear();
    for (const set of this.subscribers.values()) for (const subscriber of set) {
      try { subscriber.exit(); } catch { /* ignore */ }
    }
  }
}
