import {createHash,createHmac,randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';

/**
 * Host-issued authorization credentials. A grant exists only because the
 * authenticated Web user sent a real (non-command) message to a secretary Chat.
 * It is bound to that Chat and Host request, expires when the run ends, is
 * capped per run, and its quote must be an exact excerpt of the user's words.
 * The model can quote; it cannot mint, move or revive a grant.
 */
export interface Grant {grantId:string;chatId:string;requestId:string;channel:'web';textSha256:string;text:string;createdAt:number;expired:boolean;uses:Map<string,string>}
export const GRANT_LIMITS={maxUses:3,perChat:20,ttlMs:6*3600*1000,textChars:4000,quoteMin:1,quoteMax:200};
export class GrantError extends Error {}
export const normalizeQuote=(text:string)=>text.normalize('NFKC').replace(/\s+/g,' ').trim();

export class GrantRegistry {
 private key?:Buffer;
 private keyLoad?:Promise<Buffer>;
 private grants=new Map<string,Grant[]>();
 constructor(private keyFile:string,private now:()=>number=Date.now,private limits=GRANT_LIMITS){}
 private async secret(){
  if(this.key)return this.key;
  return this.keyLoad??=(async()=>{
   try{const value=await readFile(this.keyFile);if(value.length===32){this.key=value;return value;}}catch{/* Created below. */}
   await mkdir(dirname(this.keyFile),{recursive:true,mode:0o700});
   const value=randomBytes(32);
   try{await writeFile(this.keyFile,value,{mode:0o600,flag:'wx'});this.key=value;}
   catch{this.key=await readFile(this.keyFile);}
   return this.key!;
  })();
 }
 /** Record a genuine user message for (chat, request). Commands and Host/MISHU requests never reach here. */
 async issue(chatId:string,requestId:string,text:string):Promise<Grant>{
  const key=await this.secret(),clipped=text.slice(0,this.limits.textChars);
  const textSha256=createHash('sha256').update(clipped).digest('hex');
  const grantId='grant-'+createHmac('sha256',key).update(JSON.stringify([chatId,requestId,textSha256])).digest('hex').slice(0,32);
  const list=(this.grants.get(chatId)??[]).filter(g=>!g.expired&&this.now()-g.createdAt<this.limits.ttlMs&&g.requestId!==requestId);
  const grant:Grant={grantId,chatId,requestId,channel:'web',textSha256,text:clipped,createdAt:this.now(),expired:false,uses:new Map()};
  list.push(grant);this.grants.set(chatId,list.slice(-this.limits.perChat));return grant;
 }
 /** A steer joins the running request: its words extend that request's grant. */
 steer(chatId:string,activeRequestId:string|undefined,text:string){
  const grant=activeRequestId?this.find(chatId,activeRequestId):undefined;
  if(grant)grant.text=(grant.text+'\n'+text).slice(-this.limits.textChars);
 }
 expire(chatId:string,requestId:string){const grant=this.grants.get(chatId)?.find(g=>g.requestId===requestId);if(grant)grant.expired=true;}
 revokeChat(chatId:string){this.grants.delete(chatId);}
 private find(chatId:string,requestId:string){
  const grant=this.grants.get(chatId)?.find(g=>g.requestId===requestId);
  return grant&&!grant.expired&&this.now()-grant.createdAt<this.limits.ttlMs?grant:undefined;
 }
 current(chatId:string,activeRequestId:string|undefined){return activeRequestId?this.find(chatId,activeRequestId):undefined;}
 /**
  * Verify and consume. `useKey` identifies one action (e.g. dispatch fingerprint);
  * repeating the same key is idempotent and does not consume another use.
  * quote===undefined is the explicit legacy mode (Host grant still required).
  */
 use(chatId:string,activeRequestId:string|undefined,quote:string|undefined,useKey:string,earlierUserInstructions:readonly string[]=[]){
  const grant=this.current(chatId,activeRequestId);
  if(!grant)throw new GrantError('没有当前用户消息的 Host 授权凭证：执行需要当前前台用户请求；先前同事项的用户授权可继续引用，助手回复、汇报和目标回信不能授权。');
  let normalized:string|undefined;
  if(quote!==undefined){
   normalized=normalizeQuote(quote);
   if(normalized.length<this.limits.quoteMin||normalized.length>this.limits.quoteMax)throw new GrantError(`授权原话需为 ${this.limits.quoteMin}–${this.limits.quoteMax} 个字符的逐字摘录。`);
   if(![grant.text,...earlierUserInstructions].some(text=>normalizeQuote(text).includes(normalized!)))throw new GrantError('授权原话不是已核实用户指令的逐字摘录；可引用同事项的先前用户指令，不能引用助手回复或目标回信。');
  }
  const prior=grant.uses.get(useKey);
  if(prior===undefined){
   if(grant.uses.size>=this.limits.maxUses)throw new GrantError(`本轮用户消息的授权次数已用完（最多 ${this.limits.maxUses} 次执行）；当前执行预算耗尽；已有同事项授权保留，不要求重复确认。`);
   grant.uses.set(useKey,normalized??'');
  }
  return {grantId:grant.grantId,quote:normalized};
 }
}
