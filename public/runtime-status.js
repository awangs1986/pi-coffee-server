export function renderRuntimeStatus(element, runtime) {
  if (!element) return;
  const emergency = runtime?.mode === 'emergency';
  element.classList.toggle('hidden', !emergency);
  const reason = runtime?.reason === 'operator_requested' ? '管理员已启用' : '可选插件缺失或加载失败';
  element.textContent = emergency ? `Pi 应急模式：${reason}，已停用附加插件，保留原生工具与可用的模型服务。Codex 不受影响。修复插件并重启 Host 后恢复。` : '';
}
