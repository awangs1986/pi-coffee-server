import {constants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {link,mkdir,open,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {checkedTaskRoot,writeTaskJson} from './task-storage.js';

export const MAX_FILES = 8;
export const DELIVERY_MESSAGE_KEY = /^(?:pi-message:[0-9]{1,16}|native-message:[a-zA-Z0-9_.:-]{1,200})$/;
type FileRecord = { path: string; fingerprint: string };
export type RecordRow = { binding: string; key: string; files: FileRecord[] };
export const excluded = /^(?:node_modules|venv|attachments|inbox|__pycache__|\.git)$/i;
export const privateName = /secret|credential|token|password|auth\.json/i;

export function deliveryPath(path: string) {
  const relative = path.replace(/^\.\.\/(?:artifacts|images)\//, '');
  return path.length <= 320 && !/[\\\x00-\x1f\x7f]/.test(path)
    && relative.split('/').every(part => part && !part.startsWith('.') && !excluded.test(part) && !privateName.test(part))
    && /\.(?:html?|docx?|pdf|png|jpe?g|gif|webp|svg|zip)$/i.test(relative);
}

const legacyJournal = 'answer-deliveries.json';
const indexDir = 'answer-deliveries-v2';
const migrated = 'legacy-imported.json';
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

function recordName(binding: string, key: string) {
  return createHash('sha256').update(JSON.stringify([binding,key])).digest('hex') + '.json';
}

async function readJson(path: string, limit: number): Promise<unknown> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    .catch(error => { if (!missing(error)) throw error; });
  if (!handle) return;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw Error('Invalid delivery record');
    const buffer = Buffer.alloc(info.size + 1);
    const {bytesRead} = await handle.read(buffer);
    if (bytesRead !== info.size) throw Error('Delivery record changed');
    return JSON.parse(buffer.toString('utf8', 0, bytesRead));
  } finally { await handle.close(); }
}

function validRow(value: unknown): value is RecordRow {
  const row = value as Partial<RecordRow> | null;
  return Boolean(row && typeof row.binding === 'string' && row.binding.length <= 1024
    && typeof row.key === 'string' && DELIVERY_MESSAGE_KEY.test(row.key)
    && Array.isArray(row.files) && row.files.length <= MAX_FILES
    && row.files.every(file => file && typeof file.path === 'string' && deliveryPath(file.path)
      && typeof file.fingerprint === 'string' && /^[\d.:]+$/.test(file.fingerprint) && file.fingerprint.length <= 110));
}

async function legacyRows(history: string): Promise<RecordRow[]> {
  const rows = await readJson(join(history,legacyJournal),160 * 1024);
  return Array.isArray(rows) ? rows.slice(-40).filter(validRow) : [];
}

export async function readDeliveryRows(root: string, binding: string, keys: Set<string>) {
  const history = await checkedTaskRoot(join(await checkedTaskRoot(root),'history'));
  const index = await checkedTaskRoot(join(history,indexDir)).catch(error => { if (!missing(error)) throw error; });
  const fallback = !index || await readJson(join(index,migrated),64) !== true
    ? await legacyRows(history) : [];
  const result: RecordRow[] = [];
  for (const key of keys) {
    const row = index ? await readJson(join(index,recordName(binding,key)),24 * 1024) : undefined;
    if (row !== undefined) {
      if (!validRow(row) || row.binding !== binding || row.key !== key) throw Error('Invalid delivery record');
      result.push(row);
    } else {
      const old = fallback.find(item => item.binding === binding && item.key === key);
      if (old) result.push(old);
    }
  }
  return result;
}

// Under the platform writer fence. Imports never replace an already published row.
// A crash before the marker is published leaves the legacy journal readable.
export async function writeDeliveryRow(root: string, row: RecordRow) {
  const history = await checkedTaskRoot(join(await checkedTaskRoot(root),'history'));
  const directory = join(history,indexDir);
  await mkdir(directory,{recursive:true,mode:0o700});
  await checkedTaskRoot(directory);
  if (await readJson(join(directory,migrated),64) !== true) {
    for (const old of await legacyRows(history)) {
      const tmp = randomUUID()+'.import';
      await writeTaskJson(directory,tmp,old);
      try {
        await link(join(directory,tmp),join(directory,recordName(old.binding,old.key)));
      } catch(error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      finally { await rm(join(directory,tmp),{force:true}); }
    }
    await writeTaskJson(directory,migrated,true);
  }
  await writeTaskJson(directory,recordName(row.binding,row.key),row);
}
