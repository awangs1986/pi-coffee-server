import {afterEach,expect,it} from 'vitest';
import {resolve} from 'node:path';
import {WebServer} from '../src/web/server.js';
const servers:WebServer[]=[];afterEach(async()=>{for(const s of servers.splice(0))await s.close();});
it('serves authenticated conversation deep links while retaining shell authentication and strict asset paths',async()=>{
 const server=new WebServer({port:0,host:'127.0.0.1',hostUrl:'ws://127.0.0.1:1/host',hostToken:'fixture',publicDir:resolve('public'),auth:{handle:async()=>false,principalOf:(req:any)=>req.headers.cookie?{user:'u'}:undefined} as any});servers.push(server);await server.start();const url=`http://127.0.0.1:${server.address().port}`;
 const anonymous=await fetch(url+'/conversations/a',{redirect:'manual'});expect(anonymous.status).toBe(302);expect(anonymous.headers.get('location')).toBe('/login?returnTo=%2Fconversations%2Fa');
 const deep=await fetch(url+'/conversations/a?syncProtocol=1',{headers:{cookie:'fixture'}});expect(deep.status).toBe(200);expect(await deep.text()).toContain('id="thread"');
 for(const path of ['/conversations/a/nested','/api/unknown','/missing.js'])expect((await fetch(url+path,{headers:{cookie:'fixture'}})).status).toBe(404);
});
