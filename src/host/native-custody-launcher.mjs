import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// RpcClient launches `node <cliPath> ...args`; preserve that interface and its
// byte-for-byte stdio without loading any Agent implementation into the Host.
const child = spawn('python3', [fileURLToPath(new URL('./native-custody-supervisor.py', import.meta.url)), ...process.argv.slice(2)], { stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { if (child.exitCode === null) child.kill(signal); });
child.once('error', () => { process.stderr.write('Native writer custody unavailable\n'); process.exitCode = 78; });
child.once('exit', code => { process.exitCode = code ?? 78; });
