const captions = {
  healthy: '正常',
  running: '备份中',
  retrying: '等待重试',
  waiting: '等待备份',
  warning: '异常',
  stale: '监控超时',
  unavailable: '暂不可用',
};

const beijingTime = new Intl.DateTimeFormat('sv-SE', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Shanghai',
  hourCycle: 'h23',
});

export function appendDiskBackupStatus(container, status) {
  if (!status || !Object.hasOwn(captions, status.state)) return;

  const checked = typeof status.lastBackupAt === 'string' ? Date.parse(status.lastBackupAt) : NaN;
  const date = Number.isFinite(checked) ? beijingTime.format(new Date(checked)) + '（北京时间）' : '暂无成功记录';

  const section = document.createElement('div');
  section.className = 'brand-backup-status';
  const health = document.createElement('div');
  health.textContent = '备份状态 · ' + captions[status.state];
  const lastBackup = document.createElement('div');
  lastBackup.textContent = '最后备份 · ' + date;
  section.append(health, lastBackup);
  container.append(section);
}
