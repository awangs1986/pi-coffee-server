import { test, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { NativeWriterCustody } from '../src/host/native-custody.js';

const eventually = async (check: () => Promise<boolean>) => {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(r => setTimeout(r, 25)); }
  throw new Error('Native writer did not reach the required observable state');
};

test.runIf(process.platform === 'linux')('a naturally exited native process remains an active writer until its detached double-fork descendant exits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-custody-'));
  const marker = join(root, 'detached-ready'), release = join(root, 'release');
  const python = `import os,time\npid=os.fork()\nif pid: os._exit(0)\nos.setsid()\npid=os.fork()\nif pid: os._exit(0)\nopen(${JSON.stringify(marker)},'w').write('alive')\nend=time.monotonic()+4\nwhile time.monotonic()<end and not os.path.exists(${JSON.stringify(release)}): time.sleep(.02)\n`;
  const program = `const {spawn}=require('node:child_process');const p=spawn('python3',['-c',${JSON.stringify(python)}],{stdio:'ignore'});p.on('exit',()=>process.exit(0));`;
  const custody = new NativeWriterCustody(join(root, 'custody'));
  const launch = await custody.prepare({ executable: process.execPath, args: ['-e', program] });
  const child = spawn(process.execPath, [launch.cliPath], { env: { ...process.env, ...launch.env }, stdio: 'ignore' });
  try {
    await eventually(async () => { try { return await readFile(marker, 'utf8') === 'alive'; } catch { return false; } });
    expect(await custody.state()).toEqual({ state: 'active', reason: 'native-writers-active' });
    await writeFile(release, 'release');
    await eventually(async () => (await custody.state()).state === 'quiescent');
    expect(await custody.state()).toEqual({ state: 'quiescent' });
  } finally {
    await writeFile(release, 'release').catch(() => {});
    if (child.exitCode === null) await new Promise<void>(r => { const timer = setTimeout(r, 5000); child.once('exit', () => { clearTimeout(timer); r(); }); });
    await rm(root, { recursive: true, force: true });
  }
});

test.runIf(process.platform === 'linux')('an unestablished custody directory never proves that native writers are absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-custody-'));
  try { expect((await new NativeWriterCustody(root).state()).state).toBe('unknown'); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test.runIf(process.platform === 'linux')('loss of the process custodian reports unknown while the native writer continues', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-custody-'));
  const marker = join(root, 'custodian-pid'), release = join(root, 'release');
  const program = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(marker)},String(process.ppid));const end=Date.now()+3500;const t=setInterval(()=>{if(Date.now()>end||fs.existsSync(${JSON.stringify(release)})){clearInterval(t);process.exit(0);}},20);`;
  const custody = new NativeWriterCustody(join(root, 'custody'));
  const launch = await custody.prepare({ executable: process.execPath, args: ['-e', program] });
  const child = spawn(process.execPath, [launch.cliPath], { env: { ...process.env, ...launch.env }, stdio: 'ignore' });
  try {
    await eventually(async () => { try { return Number(await readFile(marker, 'utf8')) > 1; } catch { return false; } });
    expect((await custody.state()).state).toBe('active');
    const ownedSupervisor = Number(await readFile(marker, 'utf8'));
    process.kill(ownedSupervisor, 'SIGKILL');
    await eventually(async () => (await custody.state()).state === 'unknown');
    expect((await custody.state()).state).toBe('unknown');
  } finally {
    await writeFile(release, 'release').catch(() => {});
    await new Promise(r => setTimeout(r, 100));
    if (child.exitCode === null) await new Promise<void>(r => { const timer = setTimeout(r, 5000); child.once('exit', () => { clearTimeout(timer); r(); }); });
    await rm(root, { recursive: true, force: true });
  }
});
