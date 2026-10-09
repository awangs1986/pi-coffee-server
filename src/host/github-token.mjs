// Managed subprocesses receive only an access token from their owning Host.
import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {request} from 'node:http';
export async function githubToken(file,id) {
  let broker;
  try{broker=JSON.parse(await readFile(join(dirname(file),'broker.json'),'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(broker) {
    return await new Promise((resolve,reject)=>{
      const req=request({socketPath:broker.socketPath,path:'/token',method:'POST',headers:{authorization:'Bearer '+broker.key,'content-type':'application/json'}},res=>{
        let body='';res.setEncoding('utf8');res.on('data',chunk=>{body+=chunk;if(body.length>8192)req.destroy(Error('Invalid credential response'));});res.on('end',()=>{try{const result=JSON.parse(body);if(res.statusCode!==200||typeof result.token!=='string'||!result.token)throw Error('GitHub credential unavailable');resolve(result.token);}catch(error){reject(error);}});res.on('error',reject);
      });
      const timer=setTimeout(()=>req.destroy(Error('GitHub credential timeout')),22000);req.once('close',()=>clearTimeout(timer));req.on('error',reject);req.end(JSON.stringify({id}));
    });
  }
  const state=JSON.parse(await readFile(file,'utf8')),account=state.version===1&&state.accounts.find(a=>a.id===id);
  if(!account?.token||account.expiresAt!==undefined&&account.expiresAt<=Date.now()+60000)throw Error('GitHub authorization needs renewal by Host');
  return account.token;
}
