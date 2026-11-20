const KEY = /^(?:pi-message:[0-9]{1,16}|native-message:[a-zA-Z0-9_.:-]{1,200})$/;

export function setAnswerDeliveryKey(node, answer) {
  const key = answer.sourceMessageKey || (answer.id ? 'native-message:'+answer.id : '');
  if (answer.status !== 'inProgress' && KEY.test(key)) node.dataset.deliveryKey = key;
}

export function createAnswerDeliveries({root, context, load, endpoint}) {
  let scope = null, read = null, signature = '', timer = null, status = null;
  let records = new Map();
  const rendered = new WeakMap();
  const answers = () => Array.from(root.querySelectorAll('.msg.assistant[data-delivery-key]'));
  const document = root.ownerDocument;
  function paint(nodes) {
    for (const node of nodes) {
      const row = records.get(node.dataset.deliveryKey);
      const explicit = new Set(Array.from(node.querySelectorAll('.body a[data-workspace-path], .body a[data-document-path]'),
        link => link.dataset.workspacePath ?? link.dataset.documentPath));
      const files = (row?.files ?? []).filter(file => !explicit.has(file.path)).map(file => ({
        path:file.path, version:file.version, url:file.available ? endpoint(file.path,file.version) : null,
      }));
      // Renewed grants only change hrefs. Keep the existing row and its open
      // state so a workspace poll cannot move the conversation while reading.
      const state = JSON.stringify(files.map(({path,url,version}) => [path, Boolean(url),version]));
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
      for (const {path,url,version} of files) {
        const item = document.createElement(url ? 'a' : 'span');
        item.className = 'answer-delivery';
        const name = path.split('/').at(-1);
        item.textContent = url ? '下载 '+name : name+' · 文件不可用';
        if (url) { item.href=url; item.dataset.deliveryPath=path; if(version)item.dataset.deliveryVersion=version;item.target='_blank';item.rel='noopener noreferrer'; }
        group.append(item);
      }
      const body = node.querySelector('.body');
      if (body) body.after(group);
    }
  }
  function clearStatus() { status?.remove(); status = null; }
  function errorStatus(row, retryable) {
    clearStatus();
    if (!row) return;
    status = document.createElement('div');
    status.className = 'answer-files-status'; status.setAttribute('role','status');
    status.textContent = retryable ? '交付文件暂时无法读取。' : '交付文件不可访问。';
    if (retryable) {
      const retry = document.createElement('button');
      retry.type = 'button'; retry.className = 'msg-tool'; retry.textContent = '重试';
      retry.onclick = () => { if (row.isConnected && scope === context()) refresh(true); };
      status.append(retry);
    }
    row.append(status);
  }
  function refresh(force = false) {
    const wanted = context();
    if (wanted !== scope) {
      scope = wanted; records = new Map(); signature = '';
      read?.controller.abort(); read = null; clearTimeout(timer); clearStatus();
    }
    const nodes = answers();
    paint(nodes);
    if (!scope || !nodes.length) return;
    const keys = [...new Set(nodes.map(node=>node.dataset.deliveryKey))].sort();
    const next = JSON.stringify(keys);
    if (!force && (next===signature || read?.key===next)) return;
    read?.controller.abort(); clearTimeout(timer); clearStatus();
    const job = {key:next,controller:new AbortController(),attempt:0};
    read = job;
    const current = () => read === job && !job.controller.signal.aborted && wanted === context();
    async function run() {
      if (!current()) return;
      try {
        const rows = [];
        for (let i=0;i<keys.length;i+=40) {
          rows.push(...await load(keys.slice(i,i+40),job.controller.signal));
          if (!current()) return;
        }
        records = new Map(rows.map(row=>[row.key,row]));
        signature = next; read = null; clearStatus(); paint(answers());
      } catch(error) {
        if (!current()) return;
        const transient = !error.status || error.status===408 || error.status===429 || error.status>=500;
        if (transient && job.attempt < 2) {
          timer=setTimeout(run,[300,1200][job.attempt++]);
        } else {
          errorStatus(answers().at(-1),transient);
        }
      }
    }
    timer=setTimeout(run,60);
  }
  return {refresh};
}
