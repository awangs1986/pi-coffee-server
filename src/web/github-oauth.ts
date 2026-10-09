import {oauthCredentials,githubSecret,type GitHubCredentials} from '../shared/github-credentials.js';
import {createHash,randomBytes} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {json} from '../shared/http.js';
export interface GitHubOAuthOptions {clientId:string;clientSecret:string;publicUrl:string;providerUrl?:string;}
/** Short-lived OAuth transactions only. Durable account credentials belong to Host. */
export class GitHubOAuth {
  private readonly pending=new Map<string,{user:string;browser:string;verifier:string;expires:number}>();
  private readonly origin:string;
  private readonly provider:string;
  constructor(private readonly options:GitHubOAuthOptions){
    this.origin=new URL(options.publicUrl).origin;this.provider=options.providerUrl??'https://github.com';
    if(!options.clientId||!options.clientSecret)throw Error('GitHub OAuth App configuration is incomplete');
  }
  private browser(req:IncomingMessage){return createHash('sha256').update(req.headers.cookie??'').digest('hex');}
  start(req:IncomingMessage,user:string){
    for(const [key,value] of this.pending)if(value.expires<Date.now())this.pending.delete(key);
    if(this.pending.size>=1000)throw Error('Too many pending GitHub connections');
    const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
    this.pending.set(state,{user,browser:this.browser(req),verifier,expires:Date.now()+600000});
    const url=new URL('/login/oauth/authorize',this.provider);
    url.search=new URLSearchParams({client_id:this.options.clientId,redirect_uri:this.origin+'/auth/github/callback',scope:'repo read:user offline_access',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',prompt:'select_account'}).toString();
    return {authorizeUrl:url.href};
  }
  async callback(req:IncomingMessage,res:ServerResponse,user:string,bind:(credentials:GitHubCredentials)=>Promise<void>){
    const url=new URL(req.url??'/',this.origin),state=url.searchParams.get('state')??'',entry=this.pending.get(state);this.pending.delete(state);
    const code=url.searchParams.get('code');
    if(!entry||entry.expires<Date.now()||entry.user!==user||entry.browser!==this.browser(req)||!code||code.length>2048||url.searchParams.has('error')){json(res,400,{error:'GitHub authorization expired or does not match this login; connect again'});return;}
    try {
      const response=await fetch(new URL('/login/oauth/access_token',this.provider),{method:'POST',headers:{accept:'application/json','content-type':'application/json'},body:JSON.stringify({client_id:this.options.clientId,client_secret:this.options.clientSecret,code,code_verifier:entry.verifier,redirect_uri:this.origin+'/auth/github/callback'}),redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error('OAuth rejected');
      await bind(oauthCredentials(await response.json()));
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"});
      res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>GitHub 已连接</title><p>GitHub 账号已连接。请关闭此窗口，返回 PI Coffee 刷新账号列表。</p></html>');
    }catch{json(res,502,{error:'GitHub connection failed; retry authorization. No shared account was used.'});}
  }
  async refresh(refreshToken:unknown):Promise<GitHubCredentials> {
    if(!githubSecret(refreshToken))throw Error('Invalid GitHub refresh credential');
    const response=await fetch(new URL('/login/oauth/access_token',this.provider),{method:'POST',headers:{accept:'application/json','content-type':'application/json'},body:JSON.stringify({client_id:this.options.clientId,client_secret:this.options.clientSecret,grant_type:'refresh_token',refresh_token:refreshToken}),redirect:'error',signal:AbortSignal.timeout(15000)});
    const result=await response.json() as Record<string,unknown>;
    if(['bad_refresh_token','invalid_grant','expired_token'].includes(String(result.error)))throw Error('github_reconnect_required');
    if(!response.ok||result.error)throw Error('github_refresh_unavailable');
    const credentials=oauthCredentials(result);
    if(!credentials.refreshToken)throw Error('github_refresh_unavailable');
    return credentials;
  }

}
