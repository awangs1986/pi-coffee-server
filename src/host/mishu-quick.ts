import {randomInt} from 'node:crypto';
import type {QuickAction} from 'pi-coffee-mishu/host-policy';
// Product classification and replies live in MISHU; one-time authority stays here.
export {classifyQuick,quickReply} from 'pi-coffee-mishu/host-policy';
export type {QuickRow,QuickPanelItem,QuickSnapshot,QuickIntent,QuickAction,QuickResult} from 'pi-coffee-mishu/host-policy';

const ALPHABET='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** One-time, channel-bound, expiring confirmation codes for stop/cancel. */
export class QuickConfirmations {
 private codes=new Map<string,{code:string;action:QuickAction;expiresAt:number}[]>();
 private failures=new Map<string,number>();
 private lists=new Map<string,{ids:string[];at:number}>();
 constructor(private ttlMs=120000,private now:()=>number=Date.now){}
 issue(channel:string,action:QuickAction):string{
  const now=this.now();
  const live=(this.codes.get(channel)??[]).filter(c=>c.expiresAt>now&&!(c.action.op===action.op&&c.action.conv===action.conv)).slice(-4);
  let code='';do{code=Array.from({length:4},()=>ALPHABET[randomInt(ALPHABET.length)]).join('');}while(live.some(c=>c.code===code));
  live.push({code,action,expiresAt:now+this.ttlMs});this.codes.set(channel,live);return code;
 }
 /** Returns the action once; wrong, expired or reused codes return undefined. Five failures drop all codes. */
 consume(channel:string,code:string):QuickAction|undefined{
  const now=this.now(),live=(this.codes.get(channel)??[]).filter(c=>c.expiresAt>now);
  const found=live.find(c=>c.code===code.toUpperCase());
  if(!found){const n=(this.failures.get(channel)??0)+1;this.failures.set(channel,n);if(n>=5){this.codes.delete(channel);this.failures.delete(channel);}else this.codes.set(channel,live);return undefined;}
  this.codes.set(channel,live.filter(c=>c!==found));this.failures.delete(channel);return found.action;
 }
 revoke(channel:string){this.codes.delete(channel);this.lists.delete(channel);this.failures.delete(channel);}
 rememberList(channel:string,ids:string[]){this.lists.set(channel,{ids,at:this.now()});if(this.lists.size>200)this.lists.delete(this.lists.keys().next().value!);}
 list(channel:string){return this.lists.get(channel);}
}
