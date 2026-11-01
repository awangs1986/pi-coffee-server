import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
it('does not send a control prompt or create messages for a never-enabled Pi conversation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-pi-speech-off-')),factory=new RpcPiSessionFactory({cliPath:resolve('test/fixtures/fake-pi-rpc.mjs'),cwd:root,sessionDir:join(root,'sessions')});
 const session=await factory.create({sessionId:'ordinary'});
 try{await expect(session.setTurnInstructions!(undefined)).resolves.toBeUndefined();await session.setTurnInstructions!(undefined);expect((await session.getState()).messageCount).toBe(0);expect((await session.getHistory()).entries).toEqual([]);}
 finally{await session.stop();await rm(root,{recursive:true,force:true});}
});
