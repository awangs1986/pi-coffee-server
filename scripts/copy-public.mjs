import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {checkedReleaseVersion} from './lib/release-version.mjs';
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
await mkdir(resolve(root, "dist/public"), { recursive: true });
await cp(resolve(root, "public"), resolve(root, "dist/public"), { recursive: true });

// Browser-side libraries the shell imports as flat ES modules. They are copied
// from node_modules at build time so the served `public/` needs no bundler and
// the versions stay pinned by package-lock. Both are MIT.
const vendor = [
  ["marked", "vendor-marked.js"],
  ["dompurify", "vendor-purify.js"],
];
for (const [source, target] of vendor) {
  const from = fileURLToPath(import.meta.resolve(source));
  const moduleText = (await readFile(from, "utf8")).replace(/^\/\/# sourceMappingURL=.*$/gm, "");
  await writeFile(resolve(root, "dist/public", target), moduleText);
  // Keep the source public/ usable for the vitest Web Server too.
  await writeFile(resolve(root, "public", target), moduleText);
}

// This is a verified build artifact for both complete Web and Browser-only releases.
const version=await checkedReleaseVersion(root);
const commit=await promisify(execFile)('git',['rev-parse','HEAD'],{cwd:root}).then(r=>r.stdout.trim()).catch(()=>'unknown');
await writeFile(resolve(root,'dist/public/release-manifest.json'),JSON.stringify({sourceCommit:commit,version})+'\n');
