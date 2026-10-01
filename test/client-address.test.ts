import {expect,it} from 'vitest';
import {WebServer} from '../src/web/server.js';

it('returns the socket peer only, ignoring forwarded headers and never suggesting localhost as the user computer',async()=>{
 const web=new WebServer({port:0,hostUrl:'ws://127.0.0.1:1/host',allowUnauthenticated:true});await web.start();
 try{
  const url=`http://127.0.0.1:${web.address().port}/api/client-address`;
  const response=await fetch(url,{headers:{'x-forwarded-for':'192.168.10.8','x-real-ip':'192.168.10.9',forwarded:'for=192.168.10.10'}});
  expect(response.status).toBe(200);expect(await response.json()).toEqual({address:'127.0.0.1',suggestedHost:null});
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect((await fetch(url,{method:'POST'})).status).toBe(405);
 }finally{await web.close();}
});

it('requires the configured Web identity before exposing the peer address',async()=>{
 const web=new WebServer({port:0,hostUrl:'ws://127.0.0.1:1/host',auth:{principalOf:()=>undefined,handle:async()=>false} as any});await web.start();
 try{expect((await fetch(`http://127.0.0.1:${web.address().port}/api/client-address`)).status).toBe(401);}
 finally{await web.close();}
});

it('suggests only private unicast addresses and normalizes mapped IPv4',async()=>{
 const {clientAddress}=await import('../src/web/client-address.js');
 for(const value of ['192.168.100.10','10.0.0.5','172.16.2.3','fd00::5'])expect(clientAddress(value).suggestedHost).toBe(value);
 expect(clientAddress('::ffff:192.168.100.10')).toEqual({address:'192.168.100.10',suggestedHost:'192.168.100.10'});
 for(const value of ['127.0.0.1','::1','8.8.8.8','172.32.1.1','fe80::1','invalid'])expect(clientAddress(value).suggestedHost).toBeNull();
});
