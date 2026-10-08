import {afterEach,expect,it,vi} from 'vitest';
import {WebSocketServer} from 'ws';
import {HostClient} from '../src/web/host-client.js';
import {once} from 'node:events';
let server:WebSocketServer,client:HostClient;
afterEach(async()=>{vi.useRealTimers();client?.close();if(server){for(const ws of server.clients)ws.terminate();await new Promise<void>(r=>server.close(()=>r()));}});
it.each([true,false])('detects a silent Web→Host hop without falsely closing one that pongs (respond=%s)',async respond=>{
 server=new WebSocketServer({port:0,host:'127.0.0.1',autoPong:false});await once(server,'listening');const unavailable=vi.fn();
 server.on('connection',ws=>ws.on('ping',data=>{if(respond)ws.pong(data);}));const addr=server.address();if(typeof addr==='string')throw Error('address');
 client=new HostClient({url:`ws://127.0.0.1:${addr.port}`,onUnavailable:unavailable});await client.connect();vi.useFakeTimers({toFake:["setTimeout","clearTimeout","setInterval","clearInterval"]});
 // Reconnect under fake timers so the interval belongs to this test's clock.
 client.close();client=new HostClient({url:`ws://127.0.0.1:${addr.port}`,onUnavailable:unavailable});await client.connect();
 const peer=[...server.clients].at(-1)!;const ping=once(peer,'ping');await vi.advanceTimersByTimeAsync(20000);await ping;
 if(respond){await new Promise<void>(r=>setImmediate(r));await vi.advanceTimersByTimeAsync(10000);expect(unavailable).not.toHaveBeenCalled();}
 else{const closed=once(peer,'close');await vi.advanceTimersByTimeAsync(10000);await closed;await new Promise<void>(r=>setImmediate(r));expect(unavailable).toHaveBeenCalledOnce();}
});
