import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(resolve(root, "dist/src/host"), { recursive: true });
await cp(resolve(root, "src/host/import-zip.py"), resolve(root, "dist/src/host/import-zip.py"));
