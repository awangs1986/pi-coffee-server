import { constants, type Stats } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, open, opendir } from 'node:fs/promises';
import { join } from 'node:path';
import type { JsonValue } from '../shared/protocol.js';
import { runLifecycle } from '../shared/run-lifecycle.js';
import { checkedTaskRoot, writeTaskJson } from './task-storage.js';
import type { Conversation, Workspaces } from './workspaces.js';

const JOURNAL = 'answer-deliveries.json';
const MAX_JOURNAL = 160 * 1024;
const MAX_FILES = 8;
const MAX_ANSWERS = 40;
const MAX_ACTIVE = 24;
export const DELIVERY_MESSAGE_KEY = /^(?:pi-message:[0-9]{1,16}|native-message:[a-zA-Z0-9_.:-]{1,200})$/;
type Snapshot = Map<string, string>;
type FileRecord = { path: string; fingerprint: string };
type RecordRow = { binding: string; key: string; files: FileRecord[] };
type Turn = { requestId: string; binding: string; before: Map<string, Snapshot>; started: boolean; key?: string };

const roots = ['../artifacts', '../images', ''];
const excluded = /^(?:node_modules|venv|attachments|inbox|__pycache__|\.git)$/i;
const privateName = /secret|credential|token|password|auth\.json/i;

function deliveryPath(path: string) {
  const relative = path.replace(/^\.\.\/(?:artifacts|images)\//, '');
  return path.length <= 320 && !/[\\\x00-\x1f\x7f]/.test(path)
    && relative.split('/').every(part => part && !part.startsWith('.') && !excluded.test(part) && !privateName.test(part))
    && /\.(?:html?|docx?|pdf|png|jpe?g|gif|webp|svg|zip)$/i.test(relative);
}
function taskBinding(task: Conversation | undefined) {
  if (!task?.taskRoot || task.archived || task.workspaceRemoved || task.cleanupStarted) return;
  return JSON.stringify([task.engine ?? 'pi', task.nativeBinding?.id ?? task.id, task.recoveryReceipt?.operationId ?? null]);
}
export function deliveryFingerprint(info: Stats) {
  if (info.isFile() && info.nlink === 1) return [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(':');
}
export function deliveryVersion(task: Conversation | undefined, path: string, fingerprint?: string) {
  const binding = taskBinding(task);
  if (binding && fingerprint) return createHash('sha256').update(JSON.stringify([task!.id,binding,path,fingerprint])).digest('hex');
}
function answerKey(event: Record<string, JsonValue>) {
  const message = event.message;
  if (event.type === 'message_end' && message && typeof message === 'object' && !Array.isArray(message)) {
    if (message.role !== 'assistant' || message.stopReason === 'error') return;
    const hasText = typeof event.text === 'string' ? Boolean(event.text.trim())
      : Array.isArray(message.content) && message.content.some(block => block && typeof block === 'object'
        && !Array.isArray(block) && block.type === 'text' && typeof block.text === 'string' && block.text.trim());
    if (!hasText) return;
    if (typeof message.timestamp === 'number' && Number.isSafeInteger(message.timestamp)) return 'pi-message:' + message.timestamp;
    if (typeof event.id === 'string') return 'native-message:' + event.id;
  }
  if (event.type === 'message_completed' && typeof event.id === 'string' && typeof event.text === 'string' && event.text.trim()) {
    return 'native-message:' + event.id;
  }
}

/** Metadata only. Native message identity and the two task-file observations travel together. */
export class AnswerDeliveries {
  private readonly active = new Map<string, Turn>();
  private readonly finishing = new Map<string, Promise<boolean>>();

  constructor(private readonly workspaces: Workspaces, private readonly changed: (id: string) => void) {}

  async begin(id: string, requestId: string) {
    await this.finishing.get(id);
    if (this.active.size + this.finishing.size >= MAX_ACTIVE) return;
    const task = await this.workspaces.lookup(id);
    // These three adapters have native message identities available in both
    // their live event stream and persisted history.
    if (!['pi','codex','claude'].includes(task?.engine ?? 'pi')) return;
    const binding = taskBinding(task);
    if (!binding) return;
    const before = await this.snapshot(id);
    if (this.active.size + this.finishing.size >= MAX_ACTIVE || !before.size) return;
    if (taskBinding(await this.workspaces.lookup(id)) !== binding) return;
    this.active.set(id, { requestId, binding, before, started: false });
  }

  cancel(id: string, requestId: string) {
    if (this.active.get(id)?.requestId === requestId) this.active.delete(id);
  }

  observe(id: string, value: JsonValue): Promise<boolean> | undefined {
    const turn = this.active.get(id);
    if (!turn || !value || typeof value !== 'object' || Array.isArray(value)) return;
    const phase = runLifecycle(value.type);
    if (phase === 'running') turn.started = true;
    if (turn.started) {
      const key = answerKey(value);
      if (key && DELIVERY_MESSAGE_KEY.test(key)) turn.key = key;
    }
    if (phase !== 'settled' && phase !== 'interrupted') return;
    this.active.delete(id);
    if (phase !== 'settled' || value.aborted === true || (value.status && value.status !== 'completed') || !turn.key) return;
    const work = this.finish(id, turn, turn.key).catch(() => false).then(saved => {
      if (saved) this.changed(id);
      return saved;
    }).finally(() => this.finishing.delete(id));
    this.finishing.set(id, work);
    return work;
  }

  async list(id: string, keys: Set<string>) {
    const task = await this.workspaces.lookup(id);
    const binding = taskBinding(task);
    if (!binding || !task?.taskRoot) return;
    const rows = (await this.read(task.taskRoot)).filter(row => row.binding === binding && keys.has(row.key));
    const result = [];
    // A bounded response and availability reads. A second access check occurs
    // at the existing file grant when the user clicks the link.
    for (const row of rows) {
      const files = [];
      for (const {path, fingerprint} of row.files) {
        const evidence = await this.fileEvidence(id, path);
        const available = evidence === fingerprint;
        files.push({ path, available, ...(available ? {version:deliveryVersion(task,path,fingerprint)} : {}) });
      }
      result.push({ key: row.key, files });
    }
    if (taskBinding(await this.workspaces.lookup(id)) === binding) return result;
  }

  private async finish(id: string, turn: Turn, key: string) {
    const after = await this.snapshot(id);
    const produced = new Map<string,string>();
    for (const [root, files] of after) {
      const before = turn.before.get(root);
      if (!before) continue;
      for (const [path, fingerprint] of files) if (before.get(path) !== fingerprint) produced.set(path,fingerprint);
    }
    if (!produced.size) return false;
    const publish = async () => {
      const task = await this.workspaces.lookup(id);
      if (!task?.taskRoot || taskBinding(task) !== turn.binding) return false;
      const data = await checkedTaskRoot(task.taskRoot);
      const rows = await this.read(data);
      if (taskBinding(await this.workspaces.lookup(id)) !== turn.binding) return false;
      await writeTaskJson(join(data, 'history'), JOURNAL, [
        ...rows.filter(row => row.binding !== turn.binding || row.key !== key).slice(-MAX_ANSWERS + 1),
        { binding: turn.binding, key, files: [...produced].sort(([left],[right])=>left.localeCompare(right))
          .slice(0, MAX_FILES).map(([path,fingerprint])=>({path,fingerprint})) },
      ]);
      return true;
    };
    const fence = this.workspaces.backupWriterFence;
    return fence ? fence.runWriter('platform', publish) : publish();
  }

  private async read(root: string): Promise<RecordRow[]> {
    try {
      const directory = await checkedTaskRoot(join(await checkedTaskRoot(root), 'history'));
      const handle = await open(join(directory, JOURNAL), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > MAX_JOURNAL) return [];
        const buffer = Buffer.alloc(info.size + 1);
        const { bytesRead } = await handle.read(buffer);
        const value: unknown = JSON.parse(buffer.toString('utf8', 0, bytesRead));
        if (!Array.isArray(value)) return [];
        return value.slice(-MAX_ANSWERS).filter((row): row is RecordRow => Boolean(row
          && typeof row.binding === 'string' && row.binding.length <= 1024
          && typeof row.key === 'string' && DELIVERY_MESSAGE_KEY.test(row.key)
          && Array.isArray(row.files) && row.files.length <= MAX_FILES
          && row.files.every((item: FileRecord) => item && typeof item.path === 'string' && deliveryPath(item.path)
            && typeof item.fingerprint === 'string' && /^[\d.:]+$/.test(item.fingerprint) && item.fingerprint.length <= 110)));
      } finally { await handle.close(); }
    } catch { return []; }
  }

  private async snapshot(id: string) {
    const result = new Map<string, Snapshot>();
    for (const root of roots) {
      try {
        const files = await this.scan(id, root);
        if (files) result.set(root, files);
      } catch { /* An incomplete subtree cannot establish a new deliverable. */ }
    }
    return result;
  }

  private async scan(id: string, root: string) {
    const files: Snapshot = new Map();
    const directories = [root];
    const deadline = Date.now() + 300;
    let visited = 0;
    for (const path of directories) {
      const directory = await opendir(await this.workspaces.file(id, path));
      for await (const entry of directory) {
        if (++visited > 1800 || Date.now() >= deadline) return;
        if (entry.name.startsWith('.') || excluded.test(entry.name) || privateName.test(entry.name)) continue;
        const child = path ? path + '/' + entry.name : entry.name;
        if (entry.isDirectory() && child.length <= 280) directories.push(child);
        if (!entry.isFile() || !deliveryPath(child)) continue;
        const evidence = await this.fileEvidence(id, child);
        if (evidence) files.set(child, evidence);
      }
    }
    return files;
  }

  private async fileEvidence(id: string, path: string) {
    try {
      const task = await this.workspaces.lookup(id);
      if (!task?.taskRoot || !taskBinding(task)) return;
      const intended = join(task.cwd, path);
      const full = await this.workspaces.file(id, path);
      // Resolved aliases are intentionally omitted even within the same task.
      if (full !== intended) return;
      const info = await lstat(full);
      return deliveryFingerprint(info);
    } catch { return; }
  }
}
