import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {backupTimestamp, type DiskBackupState, type DiskBackupStatus} from '../shared/disk-backup-status.js';

const MAX_BYTES = 4096;
const MAX_AGE = 35 * 60_000;
const statusMap = new Map<string, DiskBackupState>([
  ['verified', 'healthy'],
  ['running', 'running'],
  ['retry_scheduled', 'retrying'],
  ['waiting_for_first_run', 'waiting'],
  ['waiting_for_daily_run', 'waiting'],
  ['timer_configuration_missing', 'warning'],
  ['timer_inactive', 'warning'],
  ['schedule_changed', 'warning'],
  ['backup_disk_missing', 'warning'],
  ['running_over_6h', 'warning'],
  ['success_without_readable_snapshot', 'warning'],
  ['last_attempt_failed', 'warning'],
  ['interrupted_or_no_finish_receipt', 'warning'],
  ['daily_backup_missing', 'warning'],
  ['status_or_repository_unavailable', 'unavailable'],
]);

async function readMonitorFile(directory: string, name: string) {
  try {
    const handle = await open(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > MAX_BYTES) return;
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      const {bytesRead} = await handle.read(buffer);
      if (bytesRead !== metadata.size) return;
      return JSON.parse(buffer.toString('utf8', 0, bytesRead));
    } finally {
      await handle.close();
    }
  } catch {
    // The monitor publishes these files atomically. An unreadable file has no status to report.
  }
}

export async function readDiskBackupStatus(directory: string): Promise<DiskBackupStatus> {
  if (!isAbsolute(directory)) return {state:'unavailable', lastBackupAt:null};
  const [observation, receipt] = await Promise.all([
    readMonitorFile(directory, 'status.json'),
    readMonitorFile(directory, 'receipt.json'),
  ]);
  const now = Date.now();
  const observedAt = backupTimestamp(observation?.at);
  const age = observedAt ? now - Date.parse(observedAt) : null;
  let state: DiskBackupState = 'unavailable';
  if (age !== null && age >= 0 && typeof observation.status === 'string') {
    state = age > MAX_AGE ? 'stale' : statusMap.get(observation.status) ?? 'unavailable';
  }

  const last = receipt?.last_success;
  const finishedAt = last?.result === 'success' && last.exit_status === '0' ? backupTimestamp(last.finished_at) : null;
  const lastBackupAt = finishedAt && Date.parse(finishedAt) <= now ? finishedAt : null;
  if (state === 'healthy' && !lastBackupAt) state = 'unavailable';
  return {state, lastBackupAt};
}
