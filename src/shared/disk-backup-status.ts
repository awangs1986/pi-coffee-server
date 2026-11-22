const states = ['healthy', 'running', 'retrying', 'waiting', 'warning', 'stale', 'unavailable'] as const;
export type DiskBackupState = typeof states[number];

export interface DiskBackupStatus {
  state: DiskBackupState;
  lastBackupAt: string | null;
}

export function backupTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function publicDiskBackupStatus(value: unknown): DiskBackupStatus | undefined {
  if (!value || typeof value !== 'object') return;
  const backup = value as Partial<DiskBackupStatus>;
  const state = states.find(candidate => candidate === backup.state);
  if (state) return {state, lastBackupAt: backupTimestamp(backup.lastBackupAt)};
}
