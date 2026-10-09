import {readReleaseCommit,releaseCommit} from '../shared/release.js';
import {isShellPath,loginDestination} from './conversation-route.js';
import {GitHubOAuth,type GitHubOAuthOptions} from './github-oauth.js';
import { USER_HEADER } from "../shared/identity.js";
import {clientAddress} from './client-address.js';
import type { GiteaAuth } from "./auth.js";
import { readJson, json } from "../shared/http.js";
import { Identity, type IdentityOptions } from "./identity.js";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer, request as httpRequest, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { createServer as createHttpsServer, request as httpsRequest } from "node:https";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { HostClient } from "./host-client.js";

/** PEM material for the optional HTTPS route (internal CA); HTTP when omitted. */
export interface TlsMaterial {
  cert: string | Buffer;
  key: string | Buffer;
}

export interface WebServerOptions {
  releaseDir?:string;
  githubOAuth?:GitHubOAuthOptions;
  host?: string;
  port?: number;
  hostUrl: string;
  hostToken?: string;
  publicDir?: string;
  tls?: TlsMaterial;
  identity?: IdentityOptions;
  auth?: GiteaAuth;
  defaultUser?: string;
  /** Deliberate single-user LAN/demo compatibility, never a multi-user deployment. */
  allowUnauthenticated?: boolean;
}

export interface WebAddress {
  host: string;
  port: number;
}

const SUPPORTED_HOST_PROTOCOL = 1;

/** Browser-facing HTTP and WebSocket server. */
export class WebServer {
  private readonly host: string;
  private readonly port: number;
  private readonly hostUrl: string;
  private readonly hostToken?: string;
  private readonly publicDir: string;
  private readonly releaseDir:string;
  private readonly http: HttpServer;
  private readonly wsServer: WebSocketServer;
  private readonly bridges = new Set<BrowserBridge>();
  private readonly secure: boolean;
  private started = false;
  private readonly identity?: Identity;
  private readonly auth?: GiteaAuth;
  private readonly githubOAuth?:GitHubOAuth;
  private readonly defaultUser?:string;
  private readonly allowUnauthenticated: boolean;
  private readonly githubRefreshes=new Map<string,Promise<unknown>>();
  private readonly assets = new Map<string, CachedAsset>();
  private readonly transferByScope = new Map<string, string>();
  private readonly transferByUpload = new Map<string, string>();
  private readonly transferDefaults = new Map<string,string>();

  constructor(options: WebServerOptions) {
    this.githubOAuth=options.githubOAuth?new GitHubOAuth(options.githubOAuth):undefined;
    this.auth=options.auth;this.defaultUser=options.defaultUser;
    this.allowUnauthenticated = options.allowUnauthenticated ?? false;
    this.identity = options.identity ? new Identity(options.identity) : undefined;
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 3000;
    this.hostUrl = options.hostUrl;
    this.hostToken = options.hostToken;
    this.releaseDir=options.releaseDir??process.cwd();
    this.publicDir = options.publicDir ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../public");
    this.secure = options.tls !== undefined;
    const handler = (request: IncomingMessage, response: ServerResponse) => void this.handleHttp(request, response);
    this.http = options.tls ? createHttpsServer({ cert: options.tls.cert, key: options.tls.key }, handler) : createServer(handler);
    this.http.requestTimeout = 0;
    this.wsServer = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
    this.http.on("upgrade", (request, socket, head) => this.handleUpgrade(request, socket, head));
    this.wsServer.on("connection", (socket, request) => {
      const route = (request as IncomingMessage & { coffeeRoute?: { hostUrl: string; hostToken: string; user?:string } }).coffeeRoute;
      const bridge = new BrowserBridge(socket, { url: route?.hostUrl ?? this.hostUrl, token: route?.hostToken ?? this.hostToken, user:route?.user ?? this.defaultUser, authorize:async()=>this.identity ? Boolean(await this.identity.authorize(request)) : this.auth ? Boolean(this.auth.principalOf(request)) : true, onFrame:(data,binary)=>{if(!binary){try{this.recordTransferGrant(JSON.parse(typeof data==="string"?data:data.toString()),(request as IncomingMessage & {coffeeTransferOwner?:string}).coffeeTransferOwner ?? "local");}catch{}}} });
      if (this.identity || this.auth) {
        let checking = false;
        const timer = setInterval(async () => {
          if(checking) return; checking = true;
          try { if (this.identity ? !await this.identity.authorize(request) : !this.auth!.principalOf(request)) {
            bridge.close();
            if(route) await this.hostApi(route,"/api/revoke-files","POST",{}).catch(()=>undefined);
          } } finally { checking=false; }
        }, 5000);
        timer.unref(); socket.once("close", () => clearInterval(timer));
      }
      this.bridges.add(bridge);
      bridge.onClose = () => this.bridges.delete(bridge);
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    if(!this.identity && !this.auth && !this.allowUnauthenticated && !["127.0.0.1","::1","localhost"].includes(this.host))throw new Error("Public Web binding requires Gitea identity. Explicit single-user demo mode is not multi-user isolation.");
    await new Promise<void>((resolvePromise, reject) => {
      const onError = (error: Error) => {
        this.http.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.http.off("error", onError);
        resolvePromise();
      };
      this.http.once("error", onError);
      this.http.once("listening", onListening);
      this.http.listen(this.port, this.host);
    });
    this.started = true;
  }

  address(): WebAddress {
    const address = this.http.address();
    if (address === null || typeof address === "string") throw new Error("WebServer is not listening");
    return { host: this.host, port: address.port };
  }

  /** `https` when started with TLS material, otherwise `http`. */
  get scheme(): "http" | "https" {
    return this.secure ? "https" : "http";
  }

  async close(): Promise<void> {
    if (!this.started) return;
    for (const bridge of this.bridges) bridge.close();
    this.bridges.clear();
    this.wsServer.close();
    await new Promise<void>((resolvePromise, reject) => {
      this.http.close((error) => (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING"
        ? reject(error)
        : resolvePromise()));
    });
    this.started = false;
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if(path==='/internal/github-refresh') {
      const bearer=request.headers.authorization?.replace(/^Bearer /,'');
      const allowed=this.identity?this.identity.authorizesHost(request):Boolean(this.hostToken&&bearer&&timingSafeEqual(createHash('sha256').update(this.hostToken).digest(),createHash('sha256').update(bearer).digest()));
      if(!allowed||request.headers.origin||request.headers.cookie){json(response,401,{error:'Host authorization required'});return;}
      if(request.method!=='POST'){json(response,405,{error:'Use POST'});return;}
      if(!this.githubOAuth){json(response,503,{error:'github_refresh_unavailable'});return;}
      try {
        const input=await readJson(request,8192);
        if(typeof input.refreshToken!=='string'||input.refreshToken.length>4096||!input.refreshToken||/\s/.test(input.refreshToken)){json(response,400,{error:'Invalid refresh request'});return;}
        const key=createHash('sha256').update(input.refreshToken).digest('hex');
        let pending=this.githubRefreshes.get(key);
        if(!pending){if(this.githubRefreshes.size>=32){json(response,503,{error:'github_refresh_unavailable'});return;}pending=this.githubOAuth.refresh(input.refreshToken);this.githubRefreshes.set(key,pending);void pending.finally(()=>this.githubRefreshes.delete(key)).catch(()=>undefined);}
        json(response,200,await pending);
      }catch(error){const reconnect=error instanceof Error&&error.message==='github_reconnect_required';json(response,reconnect?409:503,{error:reconnect?'github_reconnect_required':'github_refresh_unavailable'});}return;
    }
    if (path === "/healthz") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, role: "web" }));
      return;
    }
    if(path === "/auth/logout" && request.method === "POST" && this.identity?.originAllowed(request)) {
      const session=await this.identity.authorize(request);
      // End the local login before contacting a VM that may be unavailable.
      await this.identity.handle(request,response);
      if(session) void this.hostApi(session.route,"/api/revoke-files","POST",{}).catch(()=>undefined);
      return;
    }
    if (this.identity && await this.identity.handle(request, response)) return;
    if(path==="/auth/logout" && request.method==="POST" && this.auth?.originAllowed(request)){
      const principal=this.auth.principalOf(request);
      await this.auth.handle(request,response);
      if(principal){
        for(const bridge of this.bridges)if(bridge.user===principal.user)bridge.close();
        void this.hostApi({hostUrl:this.hostUrl,hostToken:this.hostToken ?? "",user:principal.user},"/api/revoke-files","POST",{}).catch(()=>undefined);
      }
      return;
    }
    if (this.auth && await this.auth.handle(request,response)) return;
    if (path==="/auth/me") {
      const session=await this.identity?.authorize(request);
      if(this.identity && !session){json(response,401,{error:"Login required",loginUrl:"/auth/login"});return;}
      json(response,200,{auth:Boolean(this.identity),user:session?{id:session.id,login:session.login}:this.defaultUser??null});return;
    }
    if (this.auth && !this.auth.principalOf(request) && (path.startsWith('/api/') || isShellPath(path))) {
      if(path.startsWith('/api/'))json(response,401,{error:"Login required"});
      else {response.writeHead(302,{location:loginDestination('/login',path)});response.end();}return;
    }
    if(path === '/api/client-address') {
      if(this.identity && !await this.identity.authorize(request)) {json(response,401,{error:'Login required'});return;}
      if(request.method!=='GET'){json(response,405,{error:'Use GET'});return;}
      response.setHeader('cache-control','no-store');
      json(response,200,clientAddress(request.socket.remoteAddress));return;
    }
    if(path === '/api/github-accounts' || path === '/auth/github/callback') {
      try {
        const session=await this.identity?.authorize(request);
        const user=session?.login??this.auth?.principalOf(request)?.user;
        if(!user){json(response,401,{error:'Login with Gitea to manage GitHub accounts'});return;}
        const route=session?.route??{hostUrl:this.hostUrl,hostToken:this.hostToken??'',user};
        if(path==='/auth/github/callback'){
          if(request.method!=='GET'||!this.githubOAuth){json(response,400,{error:'GitHub OAuth is not configured'});return;}
          await this.githubOAuth.callback(request,response,user,async credentials=>{const r=await this.hostApi(route,'/api/github-accounts','POST',{action:'bind',...credentials});if(!r.ok)throw Error('Host rejected authorization');});return;
        }
        if(request.method!=='POST'){json(response,405,{error:'Use POST'});return;}
        if(!(this.identity?this.identity.originAllowed(request):this.auth!.originAllowed(request))){json(response,403,{error:'Invalid origin'});return;}
        const input=await readJson(request);
        if(input.action==='connect'){
          if(!this.githubOAuth){json(response,409,{error:'管理员尚未配置 GitHub OAuth App'});return;}
          json(response,200,this.githubOAuth.start(request,user));return;
        }
        if(!['list','delete','check'].includes(input.action)){json(response,400,{error:'Invalid account operation'});return;}
        const result=await this.hostApi(route,'/api/github-accounts','POST',{action:input.action,id:input.id});
        json(response,result.status,{...await result.json(),oauthConfigured:Boolean(this.githubOAuth)});
      }catch{json(response,502,{error:'GitHub account management unavailable'});}return;
    }
    if(/^\/api\/conversations\/[^/]+\/(meta|page|changes|content|commands)$/.test(path)) {
      response.setHeader('cache-control','no-store');
      if(request.method!=='GET'){json(response,405,{error:'Use GET'});return;}
      try {
        const session=await this.identity?.authorize(request);
        if(this.identity&&!session){json(response,401,{error:'Login required'});return;}
        const route=session?.route??{hostUrl:this.hostUrl,hostToken:this.hostToken??'',user:this.auth?.principalOf(request)?.user??this.defaultUser};
        const upstreamUrl=new URL(route.hostUrl);upstreamUrl.protocol=upstreamUrl.protocol==='wss:'?'https:':'http:';upstreamUrl.pathname=path;upstreamUrl.search=new URL(request.url??'/', 'http://web').search;
        const upstream=await fetch(upstreamUrl,{headers:{authorization:`Bearer ${route.hostToken}`,...(route.user?{[USER_HEADER]:route.user}:{})},signal:AbortSignal.timeout(path.endsWith('/meta')?3000:10000),redirect:'error'});
        const userScope=session?`gitea-${session.id}`:this.auth?.principalOf(request)?.user??this.defaultUser??null;
        json(response,upstream.status,{...await upstream.json(),userScope});
      }catch{json(response,502,{error:'sync_unavailable'});}
      return;
    }
    if(path === '/api/release') {
      try {
        const session=await this.identity?.authorize(request);if(this.identity&&!session){json(response,401,{error:'Login required'});return;}
        if(request.method!=='GET'){json(response,405,{error:'Method not allowed'});return;}
        const route=session?.route??{hostUrl:this.hostUrl,hostToken:this.hostToken??'',user:this.auth?.principalOf(request)?.user??this.defaultUser};
        const upstream=await this.hostApi(route,'/api/release','GET');const body=upstream.ok?await upstream.json():{};
        json(response,200,{webBackendCommit:await readReleaseCommit(this.releaseDir),frontendCommit:await readReleaseCommit(this.publicDir,'release-manifest.json'),hostBackendCommit:releaseCommit(body.hostBackendCommit)});
      }catch{json(response,503,{error:'Release status unavailable'});}return;
    }
    if(path === "/api/mishu" || path === "/api/workspace" || path === "/api/engines" || path === "/api/runtime" || path === "/api/skills" || path === "/api/runners" || path === "/api/sshme") {
      try {
        const session=await this.identity?.authorize(request);
        if(this.identity && !session) {json(response,401,{error:"Login required"});return;}
        if((path === "/api/engines" || path === "/api/runtime") && request.method !== "GET") {json(response,405,{error:"Method not allowed"});return;}
        if(request.method === "POST" && (this.identity ? !this.identity.originAllowed(request) : this.auth ? !this.auth.originAllowed(request) : request.headers.origin !== `${this.scheme}://${request.headers.host}`)) {json(response,403,{error:"Invalid origin"});return;}
        if(!["GET","POST"].includes(request.method ?? "")) {json(response,405,{error:"Method not allowed"});return;}
        const route=session?.route ?? {hostUrl:this.hostUrl,hostToken:this.hostToken ?? "",user:this.auth?.principalOf(request)?.user ?? this.defaultUser};
        const result=await this.hostApi(route,path,request.method!,request.method==="POST" ? await readJson(request) : undefined);
        const body=await result.json();
        if(result.ok)this.recordTransferGrant(body, session ? `identity:${session.id}` : this.auth ? `auth:${this.auth.principalOf(request)!.user}` : "local");
        json(response,result.status,body);
      } catch {json(response,502,{error:"VM unavailable or invalid request"});}
      return;
    }
    if (path.startsWith("/api/localsend/v2/")) {
      await this.proxyLocalSend(request, response);
      return;
    }
    if (this.identity && (isShellPath(path)) && !await this.identity.authorize(request)) {
      response.writeHead(302,{location:loginDestination("/auth/login",path)});response.end();return;
    }
    const asset = resolveAsset(path);
    if (asset === undefined) {
      response.writeHead(404);
      response.end();
      return;
    }
    try {
      const cached = await this.readAsset(asset.file);
      const cacheControl = assetCacheControl(asset.file);
      const headers: Record<string, string> = { "content-type": asset.contentType, "cache-control": cacheControl, vary: "accept-encoding" };
      if (cacheControl !== "no-store") {
        headers.etag = cached.etag;
        if (request.headers["if-none-match"] === cached.etag) {
          response.writeHead(304, headers);
          response.end();
          return;
        }
      }
      let body = cached.body;
      if (cached.compressible && /\bgzip\b/.test(String(request.headers["accept-encoding"] ?? ""))) {
        cached.gzipped ??= await gzipAsync(cached.body);
        body = cached.gzipped;
        headers["content-encoding"] = "gzip";
      }
      headers["content-length"] = String(body.length);
      response.writeHead(200, headers);
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(asset.file === "index.html" ? 500 : 404, { "content-type": "text/plain; charset=utf-8" });
      response.end(asset.file === "index.html" ? "PI Coffee shell is not installed" : "Not found");
    }
  }

  /** Shell files, re-read only when their size or mtime changes; gzip is computed once per version. */
  private async readAsset(file: string): Promise<CachedAsset> {
    const path = resolve(this.publicDir, file);
    const info = await stat(path);
    const known = this.assets.get(path);
    if (known && known.mtimeMs === info.mtimeMs && known.size === info.size) return known;
    const body = await readFile(path);
    const asset: CachedAsset = {
      mtimeMs: info.mtimeMs, size: info.size, body,
      etag: `"${createHash("sha256").update(body).digest("base64url").slice(0, 22)}"`,
      compressible: body.length >= 1024 && !/\.(png|ico|woff2)$/.test(file),
    };
    if (body.length <= 16 * 1024 * 1024) this.assets.set(path, asset);
    return asset;
  }

  private recordTransferGrant(payload: unknown,owner:string): void {
    if (!payload || typeof payload !== "object") return;
    const record = payload as Record<string, unknown>;
    if (typeof record.url === "string" && /^https?:\/\//.test(record.url)) {
      this.transferDefaults.set(owner,record.url);
      if (typeof record.scope === "string" && record.scope) this.transferByScope.set(JSON.stringify([owner,record.scope]), record.url);
    }
  }

  /** Same-origin LocalSend v2 streaming proxy (ADR-0010 §4) when direct browser-to-VM transfer is unreachable. */
  private async proxyLocalSend(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const session=this.identity ? await this.identity.authorize(request) : undefined;
    if (this.identity && !session) { json(response, 401, { message: "Login required" }); return; }
    if (this.auth && !this.auth.principalOf(request)) { json(response, 401, { message: "Login required" }); return; }
    const owner=session ? `identity:${session.id}` : this.auth ? `auth:${this.auth.principalOf(request)!.user}` : "local";
    const reqUrl = new URL(request.url ?? "/", "http://localhost");
    const scope = reqUrl.searchParams.get("scope");
    const sessionId = reqUrl.searchParams.get("sessionId");
    const baseUrl = scope ? this.transferByScope.get(JSON.stringify([owner,scope]))
      : sessionId ? this.transferByUpload.get(JSON.stringify([owner,sessionId])) : this.transferDefaults.get(owner);
    if ((scope || sessionId) && !baseUrl) {json(response,403,{message:'Transfer grant does not belong to this user'});return;}
    if (!baseUrl) { json(response, 502, { message: "Transfer service unavailable" }); return; }
    let target: URL;
    try { target = new URL(reqUrl.pathname + reqUrl.search, baseUrl); }
    catch { json(response, 502, { message: "Invalid transfer target" }); return; }
    if (reqUrl.pathname === "/api/localsend/v2/prepare-upload" && request.method === "POST") {
      try {
        const body = await readJson(request);
        const upstream = await fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), redirect: "error" });
        const data = await upstream.json().catch(() => ({})) as Record<string, unknown>;
        if (upstream.ok && typeof data.sessionId === "string") this.transferByUpload.set(JSON.stringify([owner,data.sessionId]), baseUrl);
        json(response, upstream.status, data);
      } catch { json(response, 502, { message: "Transfer service unreachable" }); }
      return;
    }
    const requester = target.protocol === "https:" ? httpsRequest : httpRequest;
    const headers: Record<string, string> = {};
    for (const key of ["content-type", "content-length", "range"]) {
      const value = request.headers[key];
      if (typeof value === "string") headers[key] = value;
    }
    const upstreamReq = requester(target, { method: request.method ?? "GET", headers }, (upstreamRes) => {
      const outHeaders: Record<string, string | string[]> = {};
      for (const key of ["content-type", "content-length", "content-disposition", "content-security-policy", "cache-control", "x-content-type-options", "referrer-policy", "content-range", "accept-ranges"]) {
        const value = upstreamRes.headers[key];
        if (value !== undefined) outHeaders[key] = value;
      }
      response.writeHead(upstreamRes.statusCode ?? 502, outHeaders);
      upstreamRes.pipe(response);
    });
    upstreamReq.on("error", () => {
      if (!response.headersSent) json(response, 502, { message: "Transfer stream failed" });
      else response.destroy();
    });
    request.on("aborted", () => upstreamReq.destroy());
    response.on("close", () => { if (!response.writableEnded) upstreamReq.destroy(); });
    request.pipe(upstreamReq);
  }

  private hostApi(route: { hostUrl:string;hostToken:string;user?:string }, path:string, method:string, value?:unknown) {
    const url=new URL(route.hostUrl);url.protocol=url.protocol==="wss:" ? "https:" : "http:";url.pathname=path;url.search="";
    return fetch(url,{method,headers:{authorization:`Bearer ${route.hostToken}`,"content-type":"application/json",...(route.user?{[USER_HEADER]:route.user}:{})},...(value===undefined ? {} : {body:JSON.stringify(value)}),signal:AbortSignal.timeout(125000),redirect:"error"});
  }

  private async assertHostCompatibility(route: { hostUrl: string; hostToken: string; user?:string }): Promise<void> {
    const response = await this.hostApi(route, "/healthz", "GET");
    if (!response.ok) throw new Error("Host health check failed");
    const health = await response.json() as { protocolVersion?: unknown };
    if (health.protocolVersion !== SUPPORTED_HOST_PROTOCOL) {
      throw new Error(`Unsupported Host protocol version: ${String(health.protocolVersion)}`);
    }
  }

  private async handleUpgrade(request: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer): Promise<void> {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path !== "/ws") {
      socket.destroy();
      return;
    }
    let transferOwner="local";
    let route:{hostUrl:string;hostToken:string;user?:string} = { hostUrl: this.hostUrl, hostToken: this.hostToken ?? "",user:this.defaultUser };
    if(this.auth){
      const principal=this.auth.principalOf(request);
      if(!principal){socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");return;}
      if(!this.auth.originAllowed(request)){socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");return;}
      route.user=principal.user;transferOwner=`auth:${principal.user}`;
    }
    if (this.identity) {
      if (!this.identity.originAllowed(request)) { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
      const session = await this.identity.authorize(request);
      if (!session) { socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); return; }
      route = session.route;transferOwner=`identity:${session.id}`;
      try {
        const readiness=await this.hostApi(route,"/api/workspace","GET");
        await readiness.body?.cancel();
        if(!readiness.ok)throw new Error("VM workspace mode required");
      } catch {socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");return;}
      (request as IncomingMessage & { coffeeRoute?: unknown }).coffeeRoute = session.route;
    }
    try {
      await this.assertHostCompatibility(route);
    } catch {
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      return;
    }
    (request as IncomingMessage & { coffeeTransferOwner?:string }).coffeeTransferOwner=transferOwner;
    (request as IncomingMessage & { coffeeRoute?: unknown }).coffeeRoute=route;
    this.wsServer.handleUpgrade(request, socket, head, (websocket) => {
      this.wsServer.emit("connection", websocket, request);
    });
  }
}

interface BrowserBridgeOptions {
  authorize?:()=>Promise<boolean>;
  onFrame?:(data: RawData, isBinary: boolean)=>void;
  user?: string;
  url: string;
  token?: string;
}

class BrowserBridge {
  readonly user?:string;
  private readonly authorize?:()=>Promise<boolean>;
  private readonly onFrame?:(data: RawData, isBinary: boolean)=>void;
  private readonly browser: WebSocket;
  private readonly host: HostClient;
  private hostUnsubscribe?: () => void;
  private connected = false;
  private closed = false;
  private messageQueue: Promise<void> = Promise.resolve();
  onClose: () => void = () => undefined;

  constructor(browser: WebSocket, options: BrowserBridgeOptions) {
    this.browser = browser;
    this.user=options.user;this.authorize=options.authorize;this.onFrame=options.onFrame;
    this.host = new HostClient({
      ...options,
      onUnavailable: (error) => {
        this.sendGatewayError("host_unavailable", error.message);
        this.close();
      },
    });
    browser.on("message", (data: RawData, isBinary: boolean) => {
      this.messageQueue = this.messageQueue.then(() => this.handleMessage(data, isBinary)).catch(() => undefined);
    });
    browser.on("close", () => this.close());
    browser.on("error", () => this.close());
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.hostUnsubscribe?.();
    this.hostUnsubscribe = undefined;
    this.host.close();
    if (this.browser.readyState !== WebSocket.CLOSED) this.browser.close();
    this.onClose();
  }

  private send(data: RawData | string, isBinary = false): void {
    if (this.closed || this.browser.readyState !== WebSocket.OPEN) return;
    try {
      this.browser.send(data, { binary: isBinary });
    } catch {
      this.close();
    }
  }

  private sendGatewayError(code: string, message: string): void {
    this.send(JSON.stringify({ v: 1, type: "error", code, message }));
  }

  private async handleMessage(data: RawData, isBinary: boolean): Promise<void> {
    if (this.closed) return;
    try {
      if(this.authorize && !await this.authorize()){this.close();return;}
      if (!this.connected) {
        await this.host.connect();
        this.hostUnsubscribe = this.host.onFrame((hostData, hostBinary) => {
          this.onFrame?.(hostData, hostBinary);
          this.send(hostData, hostBinary);
        });
        this.connected = true;
      }
      this.host.send(data, isBinary);
    } catch (error) {
      this.sendGatewayError("host_unavailable", error instanceof Error ? error.message : "Host is unavailable");
    }
  }
}

interface CachedAsset { mtimeMs: number; size: number; body: Buffer; etag: string; compressible: boolean; gzipped?: Buffer }
const gzipAsync = promisify(gzip);

/**
 * The shell itself is replaced in place on deploy, so it is never cached. The Diff
 * bundle's chunks are content-hashed by esbuild (diffs-<hash>.js) and never change
 * under the same name; its stable entry revalidates with an ETag instead.
 */
function assetCacheControl(file: string): string {
  if (/^vendor\/[A-Za-z0-9_]+-[A-Z0-9]{8}\.js$/.test(file)) return "public, max-age=31536000, immutable";
  if (file.startsWith("vendor/")) return "no-cache";
  return "no-store";
}

const ASSET_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
  ico: "image/x-icon",
  woff2: "font/woff2",
};

/**
 * The shell is a flat set of files directly under `public/`, plus the generated
 * Diff bundle under `public/vendor/` and the explicitly named sync worker. Only a single safe path
 * segment with a known extension is served, so `..`, deeper paths, and anything
 * else never reach the filesystem.
 */
function resolveAsset(path: string): { file: string; contentType: string } | undefined {
  if(path === "/workers/conversation-sync.js")return {file:"workers/conversation-sync.js",contentType:ASSET_TYPES.js};
  if (isShellPath(path)) return { file: "index.html", contentType: ASSET_TYPES.html };
  const vendor = /^\/vendor\/([A-Za-z0-9_-]+)\.js$/.exec(path);
  if (vendor !== null) return { file: `vendor/${vendor[1]}.js`, contentType: ASSET_TYPES.js };
  const match = /^\/([A-Za-z0-9_-]+)\.([a-z0-9]+)$/.exec(path);
  if (match === null) return undefined;
  const contentType = ASSET_TYPES[match[2]];
  if (contentType === undefined) return undefined;
  return { file: `${match[1]}.${match[2]}`, contentType };
}
