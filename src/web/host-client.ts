import { USER_HEADER } from "../shared/identity.js";
import { WebSocket, type RawData } from "ws";

export interface HostClientOptions {
  url: string;
  token?: string;
  user?: string;
  onUnavailable?: (error: Error) => void;
}

/** Small adapter for one Web Server ↔ Host connection. */
export class HostClient {
  private readonly options: HostClientOptions;
  private socket?: WebSocket;
  private intentionalClose = false;
  private ready = false;
  private upstreamPingTimer?: ReturnType<typeof setInterval>;
  private upstreamPongTimer?: ReturnType<typeof setTimeout>;
  private readonly listeners = new Set<(data: RawData, isBinary: boolean) => void>();

  constructor(options: HostClientOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    this.clearUpstreamPing();this.ready=false;
    const headers = { ...(this.options.token ? {Authorization:`Bearer ${this.options.token}`} : {}), ...(this.options.user ? {[USER_HEADER]:this.options.user} : {}) };
    const socket = new WebSocket(this.options.url, headers === undefined ? undefined : { headers });
    this.socket = socket;
    this.intentionalClose = false;
    socket.on("message", (data: RawData, isBinary: boolean) => {
      if(this.socket!==socket)return;
      for (const listener of this.listeners) listener(data, isBinary);
    });
    socket.on("error", (error) => {
      if (this.socket===socket && this.ready && !this.intentionalClose) {
        this.options.onUnavailable?.(error instanceof Error ? error : new Error("Host socket error"));
      }
    });
    socket.on("close", () => {
      if(this.socket!==socket)return;
      this.clearUpstreamPing();
      if (this.socket===socket && this.ready && !this.intentionalClose) this.options.onUnavailable?.(new Error("Host connection closed"));
    });
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onClose = () => {
        cleanup();
        reject(new Error("Host connection closed before opening"));
      };
      const cleanup = () => {
        socket.off("open", onOpen);
        socket.off("error", onError);
        socket.off("close", onClose);
      };
      socket.once("open", onOpen);
      socket.once("error", onError);
      socket.once("close", onClose);
    });
    this.ready = true;
    this.startUpstreamPing(socket);
  }

  /** Keep the Web↔Host hop alive through idle NAT/firewall timeouts. */
  private startUpstreamPing(socket: WebSocket): void {
    this.clearUpstreamPing();
    socket.on("pong",()=>{if(this.socket===socket){clearTimeout(this.upstreamPongTimer);this.upstreamPongTimer=undefined;}});
    this.upstreamPingTimer = setInterval(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) {
        this.clearUpstreamPing();
        return;
      }
      // One outstanding probe; timeout tears down only this transport, never an Agent.
      if(this.upstreamPongTimer)return;
      this.upstreamPongTimer=setTimeout(()=>{if(this.socket===socket)socket.terminate();},10000);
      this.upstreamPongTimer.unref?.();
      try { socket.ping(); } catch { socket.terminate(); }
    }, 20000);
    this.upstreamPingTimer.unref?.();
  }

  private clearUpstreamPing(): void {
    clearTimeout(this.upstreamPongTimer);this.upstreamPongTimer=undefined;
    if (this.upstreamPingTimer) {
      clearInterval(this.upstreamPingTimer);
      this.upstreamPingTimer = undefined;
    }
  }

  send(data: RawData | string, isBinary = false): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Host connection is not open");
    }
    this.socket.send(data, { binary: isBinary });
  }

  onFrame(listener: (data: RawData, isBinary: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    const socket = this.socket;
    this.socket = undefined;
    this.intentionalClose = true;
    this.ready = false;
    this.clearUpstreamPing();
    if (socket && socket.readyState !== WebSocket.CLOSED) socket.close();
  }
}
