import {checkedReleaseVersion} from './lib/release-version.mjs';
import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
await checkedReleaseVersion(root);
await mkdir(resolve(root, "dist/src/host"), { recursive: true });
await cp(resolve(root, "src/host/import-zip.py"), resolve(root, "dist/src/host/import-zip.py"));
await cp(resolve(root, 'src/host/native-custody-supervisor.py'), resolve(root, 'dist/src/host/native-custody-supervisor.py'));
await cp(resolve(root, 'src/host/native-custody-launcher.mjs'), resolve(root, 'dist/src/host/native-custody-launcher.mjs'));

await cp(resolve(root, 'src/host/github-tools.mjs'), resolve(root, 'dist/src/host/github-tools.mjs'));

await cp(resolve(root, 'src/host/mishu-mcp.mjs'), resolve(root, 'dist/src/host/mishu-mcp.mjs'));
await cp(resolve(root, 'src/host/github-token.mjs'), resolve(root, 'dist/src/host/github-token.mjs'));
await cp(resolve(root, 'src/host/gitea-identity.mjs'), resolve(root, 'dist/src/host/gitea-identity.mjs'));

await mkdir(resolve(root, 'dist/src/shared'), { recursive: true });
await cp(resolve(root, 'src/shared/release-version.mjs'), resolve(root, 'dist/src/shared/release-version.mjs'));
await mkdir(resolve(root,'dist/maintenance'),{recursive:true});
await cp(resolve(root,'scripts/restart-worker.py'),resolve(root,'dist/maintenance/restart-worker.py'));
await cp(resolve(root,'deploy/restart'),resolve(root,'dist/maintenance/restart'),{recursive:true});

await cp(resolve(root, 'src/host/backup-unix-peer.py'), resolve(root, 'dist/src/host/backup-unix-peer.py'));
