const KEY = /^(?:pi-message:[0-9]{1,16}|native-message:[a-zA-Z0-9_.:-]{1,200})$/;

export function setAnswerDeliveryKey(node, answer) {
  const key = answer.sourceMessageKey || (answer.id ? 'native-message:'+answer.id : '');
  if (answer.status !== 'inProgress' && KEY.test(key)) node.dataset.deliveryKey = key;
}

export function createAnswerDeliveries({root, context, load, endpoint}) {
  let scope = null, read = null, signature = '', timer = null;
  let records = new Map();
  const rendered = new WeakMap();
  const answers = () => Array.from(root.querySelectorAll('.msg.assistant[data-delivery-key]')).slice(-40);
  const document = root.ownerDocument;
  function paint(nodes) {
    for (const node of nodes) {
      const row = records.get(node.dataset.deliveryKey);
      const explicit = new Set(Array.from(node.querySelectorAll('.body a[data-workspace-path], .body a[data-document-path]'),
        link => link.dataset.workspacePath ?? link.dataset.documentPath));
      const files = (row?.files ?? []).filter(file => !explicit.has(file.path)).map(file => ({
        path:file.path, url:file.available ? endpoint(file.path) : null,
      }));
      // Renewed grants only change hrefs. Keep the existing row and its open
      // state so a workspace poll cannot move the conversation while reading.
      const state = JSON.stringify(files.map(({path,url}) => [path, Boolean(url)]));
      const existing = node.querySelector(':scope > .answer-deliveries');
      if (rendered.get(node) === state && (existing || !files.length)) {
        const links = existing?.querySelectorAll('a') ?? [];
        const urls = files.flatMap(file => file.url ? [file.url] : []);
        links.forEach((link, index) => {
          if (link.getAttribute('href') !== urls[index]) link.href = urls[index];
        });
        continue;
      }
      rendered.set(node,state);
      existing?.remove();
      if (!files.length) continue;
      const group = document.createElement(files.length > 1 ? 'details' : 'div');
      group.className = 'answer-deliveries';
      if (files.length > 1) {
        const summary = document.createElement('summary');
        summary.textContent = files.length + ' 个交付文件';
        group.append(summary);
        group.open = existing?.open === true;
      }
      for (const {path,url} of files) {
        const item = document.createElement(url ? 'a' : 'span');
        item.className = 'answer-delivery';
        const name = path.split('/').at(-1);
        item.textContent = url ? '下载 '+name : name+' · 文件不可用';
        if (url) { item.href=url;item.target='_blank';item.rel='noopener noreferrer'; }
        group.append(item);
      }
      const body = node.querySelector('.body');
      if (body) body.after(group);
    }
  }
  function refresh(force = false) {
    const wanted = context();
    if (wanted !== scope) {
      scope = wanted;
      records = new Map();
      signature = '';
      read?.abort();
      read = null;
      clearTimeout(timer);
    }
    const nodes = answers();
    paint(nodes);
    if (!scope || !nodes.length) return;
    const keys = [...new Set(nodes.map(node=>node.dataset.deliveryKey))].sort();
    const next = JSON.stringify(keys);
    if (!force && next===signature) return;
    signature = next;
    read?.abort();
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const controller = new AbortController();
      read = controller;
      try {
        const rows = await load(keys,controller.signal);
        if (read!==controller || controller.signal.aborted || context()!==wanted) return;
        records = new Map(rows.map(row=>[row.key,row]));
        paint(answers());
      } catch { /* Keep already checked links. A later answer or refresh can retry. */ }
      finally {if(read===controller)read=null;}
    }, 60);
  }
  return {refresh};
}
