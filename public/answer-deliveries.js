import {addFilePreviewActions} from './task-file-reference.js';
const KEY = /^(?:pi-message:[0-9]{1,16}|native-message:[a-zA-Z0-9_.:-]{1,200})$/;

export function setAnswerDeliveryKey(node, answer) {
  const key = answer.sourceMessageKey || (answer.id ? 'native-message:'+answer.id : '');
  if (answer.status !== 'inProgress' && KEY.test(key)) node.dataset.deliveryKey = key;
}

export function createAnswerDeliveries({root, context, load, endpoint,canonical=path=>path}) {
  let scope = null, read = null, timer = null, status = null;
  const checked=new Set();
  let records = new Map();
  const rendered = new WeakMap();
  const selector='.msg.assistant[data-delivery-key]';
  const visible=new Set();
  function answers(){
    for(const node of visible)if(!root.contains(node))visible.delete(node);
    return [...visible];
  }
  const document = root.ownerDocument;
  function paint(nodes) {
    for (const node of nodes) paintRow(node);
    for (const node of nodes) addFilePreviewActions(node,canonical,Boolean(scope));
  }
  function paintRow(node) {
      const row = records.get(node.dataset.deliveryKey);
      const explicit = new Set();
      for(const link of node.querySelectorAll('.body [data-workspace-path],.body a[data-document-path],.answer-references [data-workspace-path]')){
        const path=canonical(link.dataset.workspacePath??link.dataset.documentPath);explicit.add(path);
        const file=row?.files.find(f=>f.path===path);
        if(!file)continue;
        if(!file.available){
          link.dataset.deliveryUnavailable='true';link.removeAttribute(link.tagName==='IMG'?'src':'href');link.setAttribute('aria-disabled','true');continue;
        }
        delete link.dataset.deliveryUnavailable;link.removeAttribute('aria-disabled');
        if(!file.version)continue;
        link.dataset.deliveryVersion=file.version;
        const image=link.tagName==='IMG',preview=image||Boolean(link.querySelector('img[data-workspace-path]'));
        const url=endpoint(path,file.version,preview?'preview':'workspace-download'),attribute=image?'src':'href';
        if(url && link.getAttribute(attribute)!==url)link.setAttribute(attribute,url);
      }
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
        return;
      }
      rendered.set(node,state);
      existing?.remove();
      if (!files.length) return;
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
  function refresh(force = false, dirty) {
    const wanted = context();
    if (wanted !== scope) {
      scope = wanted; records = new Map(); checked.clear();
      read?.controller.abort(); read = null; clearTimeout(timer); clearStatus();
    }
    const changed=dirty??Array.from(root.querySelectorAll(selector));
    for(const node of changed)if(node.matches(selector)&&root.contains(node))visible.add(node);
    const nodes=answers();
    paint(dirty?changed.filter(node=>root.contains(node)):nodes);
    if (!scope || !nodes.length) return;
    const activeKeys=new Set(nodes.map(node=>node.dataset.deliveryKey));
    for(const key of checked)if(!activeKeys.has(key)){checked.delete(key);records.delete(key);}
    const keys = [...activeKeys].filter(key=>force || !checked.has(key)).sort();
    if(!keys.length)return;
    const next = JSON.stringify(keys);
    if (!force && read?.key===next) return;
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
        const updated = new Set(keys);
        for(const key of keys){checked.add(key);records.delete(key);}
        for(const row of rows)if(updated.has(row.key))records.set(row.key,row);
        read = null; clearStatus(); paint(answers().filter(node=>updated.has(node.dataset.deliveryKey)));
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
