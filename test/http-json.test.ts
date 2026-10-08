import {expect,it} from 'vitest';
import {createServer,request} from 'node:http';
import {readJson,json} from '../src/shared/http.js';
it('preserves Unicode split across actual HTTP body chunks and enforces the byte budget',async()=>{
 const server=createServer(async(req,res)=>{try{json(res,200,await readJson(req,64));}catch{json(res,413,{error:'too large'});}});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();if(!address||typeof address==='string')throw Error('address');
 try{
  const body=Buffer.from(JSON.stringify({name:'咖啡😀'}));
  const response=await new Promise<string>((resolve,reject)=>{const req=request({host:'127.0.0.1',port:address.port,method:'POST'},res=>{let s='';res.on('data',c=>s+=c);res.on('end',()=>resolve(s));});req.on('error',reject);req.write(body.subarray(0,10));setTimeout(()=>req.end(body.subarray(10)),20);});expect(JSON.parse(response)).toEqual({name:'咖啡😀'});
  const oversized=await fetch(`http://127.0.0.1:${address.port}`,{method:'POST',body:JSON.stringify({name:'咖'.repeat(25)})});expect(oversized.status).toBe(413);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
