const LABELS = {
  'pi-coffee-harness': 'Harness',
  'pi-coffee-lsp': 'LSP',
  'context-handoff': 'Handoff',
  'pi-coffee-mishu': 'MISHU',
};
const STATES = {
  selected: 'Host 已选用',
  disabled: '已安装 · 未启用',
  conditional: '符合条件的对话可启用',
  missing: '未安装',
  override: '使用本地覆盖',
};

export function appendPluginVersions(target, plugins) {
  const document = target.ownerDocument;
  const details = document.createElement('details');
  details.className = 'plugin-versions';
  const summary = document.createElement('summary');
  summary.textContent = 'Host 插件';
  details.append(summary);
  if (!Array.isArray(plugins) || !plugins.length) {
    const empty = document.createElement('p');
    empty.textContent = '当前 Host 未提供插件版本明细';
    details.append(empty);
  } else {
    for (const plugin of plugins) {
      if (!Object.hasOwn(LABELS,plugin.name) || !Object.hasOwn(STATES,plugin.state)) continue;
      const row = document.createElement('section');
      const name = document.createElement('strong');
      name.textContent = LABELS[plugin.name] + ' · ' + STATES[plugin.state];
      row.append(name);
      const append = text => {
        const line = document.createElement('div');
        line.textContent = text;
        row.append(line);
      };
      append('安装 '+(plugin.installedVersion||'未知')+' · 选用 '+(plugin.effectiveVersion||'—'));
      append('锁定制品 '+(plugin.artifactVersion||'未知'));
      if (plugin.source) {
        append('源码 '+plugin.source.repository);
        append(plugin.source.tag+' · '+plugin.source.commit);
      } else append('源码来源未核实');
      if (plugin.integrity) append('制品摘要 '+plugin.integrity);
      details.append(row);
    }
  }
  target.append(details);
}
