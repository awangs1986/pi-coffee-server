import {createConnection} from 'node:net';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {kernelPeerCredentials} from './linux-file-lease.js';
import {restoreFail} from './restore-files.js';
import type {CaptureLease} from './backup.js';
const remoteCuts=new WeakSet<CaptureLease>();
export const isLegacyColdCut=(lease:CaptureLease)=>remoteCuts.has(lease);
/** The old trusted Host retains both its actual kernel EX and logical full
 * group lease. Every heartbeat rechecks live retirement and complete custody;
 * socket death or a stalled proof revokes the new Host's capability. */
export async function acquireLegacyColdCut(socketPath:string,serviceUid:number):Promise<CaptureLease>{
 const socket=createConnection(socketPath),controller=new AbortController(),challenge=randomBytes(24).toString('hex');let buffer='',heartbeat=0,cutId='',epoch=0,granted=false,released=false,peerPid=0;
 let ready!:(value:void)=>void,deny!:(error:Error)=>void;const grant=new Promise<void>((ok,fail)=>{ready=ok;deny=fail;});void grant.catch(()=>undefined);const fail=()=>{const error=restoreFail('legacy_cold_cut_lost');controller.abort(error);deny(error);socket.destroy();};const timer=setTimeout(fail,5000);
 socket.on('error',fail);socket.on('close',()=>{if(!released)fail();});socket.on('data',chunk=>{buffer+=String(chunk);if(Buffer.byteLength(buffer)>65536)return fail();let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const value=JSON.parse(line);if(!granted){if(value.schema!==1||value.type!=='cold-cut'||value.challenge!==challenge||value.authority?.uid!==serviceUid||value.authority?.pid!==peerPid||typeof value.cutId!=='string'||!/^[0-9a-f]{48}$/.test(value.cutId)||!Number.isSafeInteger(value.epoch))return fail();cutId=value.cutId;epoch=value.epoch;granted=true;heartbeat=Date.now();clearTimeout(timer);ready();}else if(value.schema===1&&value.type==='cold-heartbeat'&&value.cutId===cutId)heartbeat=Date.now();else return fail();}catch{return fail();}}});
 try{await once(socket,'connect');const fd=(socket as unknown as {_handle?:{fd?:number}})._handle?.fd;if(fd===undefined)throw restoreFail('legacy_cold_cut_lost');const peer=kernelPeerCredentials(fd);if(peer.uid!==serviceUid)throw restoreFail('legacy_cold_cut_lost');peerPid=peer.pid;socket.write(JSON.stringify({schema:1,operation:'hold-cold-export',challenge})+'\n');await grant;
  const lease:CaptureLease={epoch,signal:controller.signal,assertValid(){if(released||controller.signal.aborted||!granted||Date.now()-heartbeat>5000||socket.destroyed)throw restoreFail('legacy_cold_cut_lost');},release(){if(!released){released=true;remoteCuts.delete(lease);clearTimeout(timer);controller.abort(restoreFail('legacy_cold_cut_released'));socket.destroy();}}};remoteCuts.add(lease);lease.assertValid();return lease;
 }catch(error){released=true;clearTimeout(timer);socket.destroy();throw error;}
}
