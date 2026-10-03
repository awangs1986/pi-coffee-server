import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {expect,it} from 'vitest';

it('bounds watchdog recovery at the local HTTP and service-manager interfaces',async()=>{
  const result=await promisify(execFile)('python3',['scripts/test-watchdog.py'],{timeout:30_000,maxBuffer:1_000_000});
  expect(result.stderr).toContain('OK');
},35_000);
