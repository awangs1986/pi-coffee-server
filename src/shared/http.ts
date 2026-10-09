import type { IncomingMessage, ServerResponse } from 'node:http';
export async function readJson(req: IncomingMessage, limit=65536, timeoutMs?:number):Promise<any> {
 const timer=timeoutMs===undefined?undefined:setTimeout(()=>req.destroy(new Error("Request body timeout")),timeoutMs);
 try {
 const chunks: Buffer[] = [];
 let bytes=0;
 for await(const chunk of req) {
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string | Uint8Array);
  bytes += buf.length;
  if(bytes>limit)throw new Error('Request too large');
  chunks.push(buf);
 }
 const data = Buffer.concat(chunks).toString('utf8');
 return JSON.parse(data || '{}');
 }finally{if(timer!==undefined)clearTimeout(timer);}
}
export function json(res:ServerResponse,status:number,value:unknown) {res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));}
