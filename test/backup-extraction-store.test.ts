import {it,expect} from 'vitest';import {mkdtemp,writeFile,lstat,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {BackupExtractionStore} from '../src/host/backup-extraction-store.js';
it('keeps streams exclusive from close/expiry and preserves one stable lock across material deletion and recreation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-export-lease-'));const store=new BackupExtractionStore(root),id='11111111-1111-4111-8111-111111111111';try{
  const stage=await store.create(id);await writeFile(join(stage.root,'receipt.json'),JSON.stringify({expiresAt:new Date(0).toISOString()}),{mode:0o600});stage.lease.release();
  const before=await lstat(join(store.lockRoot,id+'.lock')),stream=await store.open(id,'shared');await expect(store.open(id,'exclusive')).rejects.toMatchObject({code:'extraction_busy'});await store.cleanupExpired();await stream.assertHeld();expect(await lstat(stream.root)).toBeDefined();stream.lease.release();
  await store.cleanupExpired();await expect(lstat(stream.root)).rejects.toMatchObject({code:'ENOENT'});const after=await lstat(join(store.lockRoot,id+'.lock'));expect({ino:after.ino,dev:after.dev}).toEqual({ino:before.ino,dev:before.dev});
  const again=await store.create(id);expect((await lstat(join(store.lockRoot,id+'.lock'))).ino).toBe(before.ino);await again.remove();again.lease.release();
 }finally{await rm(root,{recursive:true,force:true});}
});
