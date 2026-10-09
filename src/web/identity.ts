import {conversationReturnTo} from './conversation-route.js';
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface UserRoute { hostUrl: string; hostToken: string; user?:string }
export function parseUserRoutes(text:string):Record<string,UserRoute> {
  return JSON.parse(text.replace(/^\uFEFF/,'')) as Record<string,UserRoute>;
}
export interface IdentityOptions {
  giteaUrl: string; clientId: string; clientSecret: string; publicUrl: string;
  /** Admin-owned routing configuration, re-read for each authorization check. */
  routes: () => Record<string, UserRoute>;
  fetch?: typeof fetch;
  sessionMs?: number;
  sharedHost?: boolean;
}
interface Login { id: string; login: string; token: string; expires: number; checked: number; route: UserRoute }
const COOKIE = "coffee_session";
function cookie(req: IncomingMessage, name: string) { return (req.headers.cookie ?? "").split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1); }
export class Identity {
  private sessions = new Map<string, Login>();
  private states = new Map<string, { verifier: string; expires: number; returnTo:string }>();
  private request: typeof fetch;
  readonly origin: string;
  constructor(private options: IdentityOptions) {
    this.origin = new URL(options.publicUrl).origin;
    if (!['http:', 'https:'].includes(new URL(options.giteaUrl).protocol)) throw new Error('Gitea URL must be HTTP(S)');
    this.request = options.fetch ?? fetch;
  }
  private setCookie(res: ServerResponse, name: string, value: string, age: number) {
    res.setHeader('set-cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${this.origin.startsWith('https:') ? '; Secure' : ''}`);
  }
  originAllowed(req: IncomingMessage) { return req.headers.origin === this.origin; }
  async authorize(req: IncomingMessage): Promise<Login | undefined> {
    const key = cookie(req, COOKIE); const session = key ? this.sessions.get(key) : undefined;
    if (!session) return;
    let route: UserRoute | undefined;
    try { route = this.routes()[session.id]; } catch { return; }
    if (session.expires <= Date.now() || !route || route.hostUrl !== session.route.hostUrl || route.hostToken !== session.route.hostToken) { this.sessions.delete(key!); return; }
    if (Date.now() - session.checked > 30000) {
      try {
        const user = await this.user(session.token);
        if (String(user.id) !== session.id || user.active === false || user.prohibit_login === true) throw new Error('Revoked');
        session.checked = Date.now();
      } catch { this.sessions.delete(key!); return; }
    }
    if(this.sessions.get(key!)!==session || session.expires<=Date.now())return;
    return session;
  }
  private routes(): Record<string, UserRoute> {
    const routes=this.options.routes();const urls=new Set<string>();const tokens=new Set<string>();
    if(!routes || typeof routes!=="object" || Array.isArray(routes))throw new Error("Invalid VM routes");
    for(const [id,route] of Object.entries(routes)) {
      if(!/^[1-9][0-9]*$/.test(id) || !route || typeof route.hostToken!=="string" || !route.hostToken || !/^wss?:\/\//.test(route.hostUrl))throw new Error("Invalid VM route");
      const url=new URL(route.hostUrl).href;
      if(!this.options.sharedHost && (urls.has(url) || tokens.has(route.hostToken)))throw new Error("Each user needs an independent Host and token");
      if(this.options.sharedHost)route.user="gitea-"+id;
      urls.add(url);tokens.add(route.hostToken);
    }
    return routes;
  }
  /** Service-only reverse OAuth exchange; no browser session can use this grant. */
  authorizesHost(req:IncomingMessage):boolean {
    const token=req.headers.authorization?.replace(/^Bearer /,''),user=req.headers['x-pi-coffee-user'];
    if(!token||user!==undefined&&typeof user!=='string')return false;
    try{return Object.values(this.routes()).some(route=>route.user===user&&timingSafeEqual(createHash('sha256').update(route.hostToken).digest(),createHash('sha256').update(token).digest()));}catch{return false;}
  }
  private async user(token: string) {
    const res = await this.request(`${this.options.giteaUrl.replace(/\/$/,'')}/api/v1/user`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!res.ok) throw new Error('Identity unavailable');
    const user = await res.json() as any;
    if (!Number.isSafeInteger(user.id) || typeof user.login !== 'string') throw new Error('Invalid identity');
    return user;
  }
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', this.origin);
    if (!['/auth/login','/auth/callback','/auth/logout','/api/me'].includes(url.pathname)) return false;
    res.setHeader('cache-control','no-store');
    try {
      if (url.pathname === '/auth/login' && req.method === 'GET') {
        for (const [k,v] of this.states) if(v.expires < Date.now()) this.states.delete(k);
        if (this.states.size >= 1000) throw new Error('Try again later');
        const state = randomBytes(32).toString('hex'); const verifier = randomBytes(32).toString('base64url');
        this.states.set(state, {verifier,expires:Date.now()+300000,returnTo:conversationReturnTo(url.searchParams.get('returnTo'))}); this.setCookie(res,'coffee_oauth',state,300);
        const target = new URL('/login/oauth/authorize',this.options.giteaUrl);
        target.search = new URLSearchParams({client_id:this.options.clientId,redirect_uri:this.origin+'/auth/callback',response_type:'code',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',scope:'read:user'}).toString();
        res.writeHead(302,{location:target.href});res.end();return true;
      }
      if (url.pathname === '/auth/callback' && req.method === 'GET') {
        const state = url.searchParams.get('state') ?? ''; const pending = this.states.get(state);
        if (!pending || cookie(req,'coffee_oauth') !== state || pending.expires < Date.now()) throw new Error('Invalid login state');
        this.states.delete(state);
        const code = url.searchParams.get('code'); if (!code) throw new Error('Missing login code');
        const response = await this.request(new URL('/login/oauth/access_token',this.options.giteaUrl), {method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:this.options.clientId,client_secret:this.options.clientSecret,code,redirect_uri:this.origin+'/auth/callback',code_verifier:pending.verifier}),signal:AbortSignal.timeout(8000),redirect:'error'});
        if (!response.ok) throw new Error('Login failed');
        const tokens = await response.json() as any;
        if (typeof tokens.access_token !== 'string') throw new Error('Login failed');
        const user = await this.user(tokens.access_token); const route = this.routes()[String(user.id)];
        if (!route || !route.hostToken || !/^wss?:\/\//.test(route.hostUrl) || user.active === false || user.prohibit_login === true) throw new Error('No authorized VM');
        for (const [k,v] of this.sessions) if(v.expires < Date.now()) this.sessions.delete(k);
        if(this.sessions.size >= 1000) throw new Error('Session capacity reached');
        const key = randomBytes(32).toString('hex'); const duration = this.options.sessionMs ?? 8*3600000;
        this.sessions.set(key,{id:String(user.id),login:user.login,token:tokens.access_token,expires:Date.now()+duration,checked:Date.now(),route:{...route}});
        this.setCookie(res,COOKIE,key,Math.floor(duration/1000));res.writeHead(302,{location:pending.returnTo});res.end();return true;
      }
      if(url.pathname === '/auth/logout' && req.method === 'POST') {
        if(!this.originAllowed(req)) throw new Error('Invalid origin');
        const key=cookie(req,COOKIE); const session=key ? this.sessions.get(key) : undefined;
        if(session) for(const [k,v] of this.sessions) if(v.id===session.id) this.sessions.delete(k);
        this.setCookie(res,COOKIE,'',0);res.writeHead(204);res.end();return true;
      }
      if(url.pathname === '/api/me' && req.method === 'GET') {
        const session=await this.authorize(req); if(!session) throw new Error('Login required');
        res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:session.id,login:session.login}));return true;
      }
      res.writeHead(405);res.end();
    } catch { res.writeHead(401,{'content-type':'text/plain; charset=utf-8'});res.end('登录或 VM 授权无效。请重新登录，或联系管理员检查固定 VM 路由。'); }
    return true;
  }
}
