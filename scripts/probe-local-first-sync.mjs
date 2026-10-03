// Actual app.js browser regression using synthetic transport fixtures.
// No production account, credential, native CLI or model call. Run:
//   npm run build && node scripts/probe-local-first-sync.mjs
// Open printed URL in a supported browser. ?protocol=legacy&syncProtocol=1 covers fallback;
// ?protocol=2 covers read-only meta/page/changes/content. ?seconds=60 is default.
// Save screenshots/Performance trace in the browser runner separately. This
// script never treats JSDOM measurements as browser evidence.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
const root = resolve('public');
const evidenceDir = process.env.EVIDENCE_DIR || join(tmpdir(), `verify-local-first-${Date.now()}`);
await mkdir(evidenceDir, { recursive: true });
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const synthetic = new Map();
let holdSyncRequests = false, servedProtocol = '2';
const heldResponses = new Set();
const states = Array.from({ length: 10 }, (_, i) => ({ id: `probe-${i}`, name: `Live probe ${i}`, engine: ['pi', 'codex', 'claude'][i % 3], workspaceKind: i % 3 ? 'work' : 'chat', createdAt: '2026-10-03T00:00:00Z' }));
for (const item of states) synthetic.set(item.id, { revision: 1, operations: [], runState: 'running', entries: [{ id: `${item.id}-history`, kind: 'user', text: `HISTORY-${item.id}`, entityRevision: '1' }] });
const boundedEntry = entry => {
  const field = entry.kind === 'tool' ? 'result' : 'text', text = String(entry[field] || '');
  return { ...entry, [field]: text.slice(0, 8192), ...(text.length > 8192 ? { contentTruncated: true, contentLength: text.length } : {}) };
};
function snapshot(id) {
  const state = synthetic.get(id), entries = []; let remaining = 60000;
  for (const entry of state.entries.slice(-40).reverse()) {
    const item = boundedEntry(entry), size = JSON.stringify(item).length;
    if (size > remaining) break; remaining -= size; entries.unshift(item);
  }
  return { syncProtocol: 2, userScope: 'synthetic-browser-probe', conversationId: id, sessionId: id, bindingEpoch: 'fixture-' + id, snapshotId: 's-' + state.revision, baseRevision: String(state.revision), headRevision: String(state.revision), entries, olderCursor: null, runState: state.runState, sourceFreshness: 'current' };
}
function updateFixture(id, event) {
  const state = synthetic.get(id); if (!state) throw Error('unknown fixture');
  const idOf = event.id || event.toolCallId || 'live'; let entry = state.entries.find(item => item.id === idOf), type;
  const delta = event.assistantMessageEvent;
  if (event.type === 'message_delta' || delta?.type === 'text_delta' || event.type === 'message_completed' || event.type === 'message_end') {
    if (!entry) { entry = { kind: 'assistant', id: idOf, text: '' }; state.entries.push(entry); }
    entry.text = event.type === 'message_completed' ? event.text : event.type === 'message_end' ? (event.message?.content || []).filter(block => block.type === 'text').map(block => block.text).join('') : entry.text + (event.delta || delta?.delta || ''); type = 'replaceText';
  } else if (['tool_update', 'tool_execution_start', 'tool_execution_update', 'tool_execution_end'].includes(event.type)) {
    if (!entry) { entry = { kind: 'tool', id: idOf, name: event.name || event.toolName || 'bash', result: '' }; state.entries.push(entry); }
    const output = event.result ?? event.partialResult;
    if (output !== undefined) entry.result = typeof output === 'string' ? output : (output.content || []).filter(block => block.type === 'text').map(block => block.text).join('');
    entry.name = event.name || event.toolName || entry.name; type = 'upsertTool';
  } else {
    state.runState = ['agent_start', 'run_started'].includes(event.type) ? 'running' : ['agent_settled', 'run_completed'].includes(event.type) ? 'idle' : state.runState; type = 'setRunState';
  }
  const revision = String(++state.revision); if (entry) entry.entityRevision = revision;
  state.operations.push({ opId: id + '-' + revision, revision, entityId: entry?.id || 'run-state', entityRevision: revision, type, payload: entry ? { entry: boundedEntry(entry) } : { runState: state.runState } });
  return snapshot(id);
}
const json = (res, value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
const fixture = String.raw`
const originalFetch = window.fetch.bind(window);
const params = new URLSearchParams(location.search), protocol = params.get('protocol') || 'legacy';
const seconds = Math.max(1, Number(params.get('seconds') || 60));
if(protocol==='legacy'&&!params.has('syncProtocol')){params.set('syncProtocol','1');window.history.replaceState(null,'',location.pathname+'?'+params);}
const NativeWorker=window.Worker;let liveWorkers=0,peakWorkers=0,workerStarts=0;
if(NativeWorker)window.Worker=class extends NativeWorker{constructor(...args){super(...args);workerStarts++;liveWorkers++;peakWorkers=Math.max(peakWorkers,liveWorkers);}terminate(){if(!this.fixtureTerminated){liveWorkers--;this.fixtureTerminated=true;}return super.terminate();}};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const started = performance.now(), errors = [], longTasks = [], measurements = [], checks = [], sent = [], sockets = [];
let frameCount = 0, historyFrameCount = 0, frameDuringSwitch = 0, switching = false, hung = false, cursor = 0;
const conversations = Array.from({ length: 10 }, (_, i) => ({ id: 'probe-' + i, name: 'Live probe ' + i, engine: ['pi','codex','claude'][i % 3], workspaceKind: i % 3 ? 'work' : 'chat', createdAt: '2026-10-03T00:00:00Z' }));
window.addEventListener('error', event => errors.push(event.message));
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
if (PerformanceObserver.supportedEntryTypes.includes('longtask')) new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => ({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
const output = document.createElement('pre');output.id='probe-result';output.style='position:fixed;top:2px;right:2px;max-width:440px;max-height:30vh;overflow:auto;z-index:99999;background:white;color:black;border:1px solid;padding:8px;font:11px monospace';document.body.append(output);
const report = value => { output.textContent=JSON.stringify(value,null,2);window.__localFirstProbe=value; };
const check = (name, pass, detail={}) => { checks.push({name,pass,...detail});report({stage:name,checks,frames:frameCount}); };
const ready = async predicate => {const end=performance.now()+10000;while(!predicate()){if(performance.now()>end)throw Error('readiness timeout');await wait(5);}};
let fixtureTail = Promise.resolve();
const emit = (ws, id, event) => {frameCount++;if(switching)frameDuringSwitch++;ws.receive({type:'event',sessionId:id,cursor:++cursor,event});
 if(protocol==='2')fixtureTail=fixtureTail.then(()=>originalFetch('/fixture-event',{method:'POST',body:JSON.stringify({id,event})})).then(response=>response.json()).then(snapshot=>ws.receive({type:'sync_changed',sessionId:id,conversationId:id,bindingEpoch:snapshot.bindingEpoch,headRevision:snapshot.headRevision,sourceFreshness:'current'}));
};
const drain=async()=>{await fixtureTail;if(protocol==='2')await wait(250);await paint();};
class Socket {
 static OPEN=1;readyState=1;
 constructor(){sockets.push(this);queueMicrotask(()=>this.onopen?.());}
 send(text){sent.push(JSON.parse(text));} close(){this.readyState=3;}
 receive(frame){if(frame.type==='history')historyFrameCount++;this.onmessage?.({data:JSON.stringify(frame)});}
}
window.WebSocket=Socket;
window.fetch=async (input, init) => {
 const url=typeof input==='string'?input:input.url;
 if(url.includes('/api/conversations/')){
  if(hung)return new Promise(()=>{});
  if(protocol==='legacy')return new Response(JSON.stringify({error:'not_found'}),{status:404});
 }
 return originalFetch(input, init);
};
const thread=()=>document.querySelector('#thread'), prompt=()=>document.querySelector('#prompt'), scroller=()=>document.querySelector('#scroller');
const type=text=>{prompt().value=text;prompt().dispatchEvent(new Event('input'));};
const choose=i=>{const row=document.querySelector('#session-list [data-session-id="probe-'+i+'"]');if(!row)throw Error('missing sidebar row '+i);row.click();};
const history=i=>[{kind:'user',id:'probe-'+i+'-history',text:'HISTORY-probe-'+i}];
const open=async(i, entries=history(i), streaming=true)=>{
 choose(i);await wait(25);const ws=sockets.at(-1);
 ws.receive({type:'opened',sessionId:'probe-'+i,engine:conversations[i].engine,capabilities:{stop:true,steer:true,followUp:true,tools:true,questions:true},state:{isStreaming:streaming}});
 const frame=protocol==='2'?await (await originalFetch('/fixture-reset',{method:'POST',body:JSON.stringify({id:'probe-'+i,entries})})).json():{sessionId:'probe-'+i,entries};
 ws.receive({type:'history',...frame});await drain();return ws;
};
const giant=(size,marker)=>marker+'\n\x60\x60\x60typescript\n'+'const safe = "<img src=x onerror=alert(1)>";\n'.repeat(Math.ceil(size/30)).slice(0,size)+'\nEND-'+marker;
const delta=(engine,text)=>engine==='pi'?{type:'message_update',assistantMessageEvent:{type:'text_delta',delta:text}}:{type:'message_delta',id:'live',delta:text};
const complete=(engine,text)=>engine==='pi'?{type:'message_end',message:{role:'assistant',content:[{type:'text',text}]}}:{type:'message_completed',id:'live',text};
try {
 await import('/app.js');await ready(()=>sockets.length&&document.querySelectorAll('#session-list [data-session-id]').length===10);await paint();
 if(!params.has('anchorOnly')){
 for(let i=0;i<10;i++)await open(i);
 for(let i=0;i<3;i++)for(const size of [45000,225000]){
  const ws=await open(i),engine=conversations[i].engine,text=giant(size,'LIVE-'+engine+'-'+size);
  emit(ws,'probe-'+i,{type:engine==='pi'?'agent_start':'run_started'});
  emit(ws,'probe-'+i,delta(engine,text));await drain();
  check(engine+' '+size+' live bounded',thread().textContent.length<20000,{visibleCharacters:thread().textContent.length});
  for(let n=0;n<20;n++)emit(ws,'probe-'+i,delta(engine,' chunk-'+n));
  const inputStart=performance.now();type('draft '+i);await paint();measurements.push({kind:'input',ms:performance.now()-inputStart});
  emit(ws,'probe-'+i,complete(engine,text+' FINAL'));
  if(engine==='pi'){
   emit(ws,'probe-'+i,{type:'tool_execution_start',toolCallId:'t',toolName:'bash',args:{command:'synthetic'}});
   emit(ws,'probe-'+i,{type:'tool_execution_update',toolCallId:'t',partialResult:{content:[{type:'text',text}]}});
   emit(ws,'probe-'+i,{type:'tool_execution_end',toolCallId:'t',result:{content:[{type:'text',text}]}});
  }else{emit(ws,'probe-'+i,{type:'tool_update',id:'t',name:'bash',args:{command:'synthetic'},result:text,status:'inProgress'});emit(ws,'probe-'+i,{type:'tool_update',id:'t',result:text,status:'completed'});}
  await drain();check(engine+' '+size+' completion and tool bounded',thread().textContent.length<40000&&thread().querySelectorAll('img,script,iframe').length===0,{visibleCharacters:thread().textContent.length});
 }
 // Real incoming frames continue during each measured switch, rather than
 // measuring a static warm cache with transport paused.
 const rapidStart=performance.now(),previousHistoryFrames=historyFrameCount;
 let n=0;
 while(performance.now()-rapidStart<seconds*1000){
  const i=n++%5,id='probe-'+i,engine=conversations[i].engine;
  const old=sockets.at(-1),oldHandler=old.onmessage;
  emit(old,'probe-'+((i+4)%5),delta(conversations[(i+4)%5].engine,'before-switch'));
  switching=true;const t=performance.now();choose(i);await paint();
  measurements.push({kind:'cached-switch',ms:performance.now()-t});
  const ws=sockets.at(-1);ws.receive({type:'opened',sessionId:id,engine,capabilities:{stop:true,steer:true,followUp:true},state:{isStreaming:true}});const h=protocol==='2'?await(await originalFetch('/fixture-reset',{method:'POST',body:JSON.stringify({id,entries:history(i)})})).json():{sessionId:id,entries:history(i)};ws.receive({type:'history',...h});
  emit(ws,id,delta(engine,giant(225000,'CONTINUOUS-'+i)));
  oldHandler?.({data:JSON.stringify({type:'event',sessionId:'probe-'+((i+4)%5),cursor:++cursor,event:{type:'message_completed',id:'live',text:'STALE-POISON'}})});
  type('draft '+i);await paint();switching=false;
  if(thread().textContent.includes('STALE-POISON'))throw Error('obsolete socket changed selected transcript');
  await wait(Math.max(0,200-(performance.now()-t)));
 }
 check('5Hz switches include live frames and fresh history',frameDuringSwitch>0&&historyFrameCount>previousHistoryFrames,{switches:n,liveFrames:frameDuringSwitch,historyFrames:historyFrameCount-previousHistoryFrames});
 }
 // Scroll restoration must survive leaving and returning without a new history.
 await open(0,Array.from({length:10000},(_,i)=>({kind:i%2?'assistant':'user',id:'h'+i,text:'HISTORY-'+i+' '+ 'x'.repeat(2000)})),false);
 check('10000-history DOM is bounded',thread().querySelectorAll('.msg').length<=40&&thread().textContent.length<66536,{rows:thread().querySelectorAll('.msg').length,characters:thread().textContent.length});
 scroller().scrollTop=200;scroller().dispatchEvent(new Event('scroll'));const saved=scroller().scrollTop;type('preserved A');
 await open(1);type('preserved B');hung=true;await originalFetch('/fixture-hang',{method:'POST'});
 const hangStart=performance.now();choose(0);await paint();
 check('hung reads preserve draft and anchor',prompt().value==='preserved A'&&Math.abs(scroller().scrollTop-saved)<=2,{ms:performance.now()-hangStart,anchorError:Math.abs(scroller().scrollTop-saved),draft:prompt().value});
 await wait(3500);const cat=document.querySelector('.conversation-sync-status');
 check('selected sync feedback does not falsely report success',!!cat&&['syncing','timeout','error','offline'].includes(cat.dataset.state),{state:cat?.dataset.state});
 check('bounded sync worker count',peakWorkers<=2,{workerStarts,peakWorkers});
 check('switching never stops or resends a task',sent.filter(f=>f.type==='abort'||f.type==='prompt').length===0);
 const values=kind=>measurements.filter(x=>x.kind===kind).map(x=>x.ms).sort((a,b)=>a-b);
 const stats=kind=>{const a=values(kind);return {samples:a.length,p95:a[Math.floor(a.length*.95)],p99:a[Math.floor(a.length*.99)],max:Math.max(...a)};};
 const result={pass:checks.every(x=>x.pass)&&errors.length===0,protocol,browser:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,deviceMemory:navigator.deviceMemory,viewport:{width:innerWidth,height:innerHeight,devicePixelRatio},seconds,elapsedMs:performance.now()-started,fixture:'Synthetic public DOM/WebSocket/HTTP fixtures; actual app.js; no native engine/model calls',frameCount,historyFrameCount,frameDuringSwitch,workerStarts,peakWorkers,checks,errors,switchTiming:stats('cached-switch'),inputTiming:stats('input'),longTasks,domNodes:document.querySelectorAll('*').length,heap:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null,measurements};
 report(result);await originalFetch('/probe-result',{method:'POST',body:JSON.stringify(result)});
}catch(error){const result={pass:false,error:error.stack||String(error),errors,checks,frameCount,historyFrameCount,measurements,longTasks};report(result);await originalFetch('/probe-result',{method:'POST',body:JSON.stringify(result)});}
`;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if(url.pathname==='/')servedProtocol=url.searchParams.get('protocol')||'legacy';
    if(servedProtocol==='legacy'&&url.pathname.startsWith('/api/conversations/')){json(res,{error:'not_found'},404);return;}
    const body = async () => { let text = ''; for await (const part of req) { text += part; if (text.length > 1024 * 1024) throw Error('body limit'); } return text ? JSON.parse(text) : {}; };
    if (url.pathname === '/fixture-hang') { holdSyncRequests = true; json(res, { held: true }); return; }
    if (url.pathname === '/fixture-event' && req.method === 'POST') { const b = await body(); json(res, updateFixture(b.id, b.event)); return; }
    if (url.pathname === '/fixture-reset' && req.method === 'POST') { const b = await body(), state = synthetic.get(b.id); state.revision++; state.entries = b.entries.map((entry, i) => ({ ...entry, id: entry.id || b.id + '-h-' + i, entityRevision: String(state.revision) })); json(res, snapshot(b.id)); return; }
    if (url.pathname === '/probe-result' && req.method === 'POST') { const result = { sha, timestamp: new Date().toISOString(), ...await body() }; await writeFile(join(evidenceDir, 'browser-result.json'), JSON.stringify(result, null, 2)); json(res, { saved: true }); console.log(`Evidence: ${evidenceDir}/browser-result.json; pass=${result.pass}`); return; }
    if (url.pathname === '/probe.js') { res.setHeader('content-type', 'text/javascript'); res.end(fixture); return; }
    if (url.pathname === '/auth/me') { json(res, { auth: true, user: 'synthetic-browser-probe' }); return; }
    if (url.pathname === '/api/me') { json(res, null); return; }
    if (url.pathname === '/api/engines') { json(res, { engines: ['pi', 'codex', 'claude'].map(id => ({ id, available: true })) }); return; }
    if (url.pathname === '/api/workspace') { const b = await body(); json(res, ['files', 'changes'].includes(b.action) ? { files: [], state: 'local' } : { projects: [], conversations: states, sidebar: { assignments: {}, collapsed: [] }, capabilities: { chatWorkspaces: true } }); return; }
    const match = url.pathname.match(/^\/api\/conversations\/([^/]+)\/(meta|page|changes|content)$/);
    if (match) {
      if (holdSyncRequests) { heldResponses.add(res); res.on('close', () => heldResponses.delete(res)); return; }
      const [_, id, action] = match, state = synthetic.get(id);
      if (!state) { json(res, { error: 'not_found' }, 404); return; }
      const common = { syncProtocol: 2, userScope: 'synthetic-browser-probe', conversationId: id, bindingEpoch: 'fixture-' + id, snapshotId: 's-' + state.revision, runState: state.runState };
      if (action === 'meta') json(res, { ...common, headRevision: String(state.revision), oldestAvailableRevision: '0', sourceFreshness: 'current', lastSourceCheckAt: new Date().toISOString() });
      else if (action === 'page') json(res, snapshot(id));
      else if (action === 'changes') {
        const after = url.searchParams.get('afterRevision') || '1', operations = []; let bytes = 0;
        for (const op of state.operations.filter(op => BigInt(op.revision) > BigInt(after))) { const size = JSON.stringify(op).length; if (bytes + size > 60000) break; bytes += size; operations.push(op); }
        const through = operations.at(-1)?.revision || after;
        json(res, { ...common, fromExclusive: after, throughRevision: through, headRevision: String(state.revision), hasMore: through !== String(state.revision), operations });
      } else {
        const entity = state.entries.find(entry => entry.id === url.searchParams.get('entityId')), offset = Number(url.searchParams.get('offset') || 0), content = String(entity?.text ?? entity?.result ?? ''), text = content.slice(offset, offset + 8192);
        json(res, { ...common, entityId: entity?.id, entityRevision: entity?.entityRevision, offset, text, nextOffset: offset + text.length, hasMore: offset + text.length < content.length });
      }
      return;
    }
    if (url.pathname.startsWith('/api/')) { json(res, {}); return; }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!file || file.includes('..') || file.startsWith('/')) { res.writeHead(400); res.end(); return; }
    let content = await readFile(resolve(root, file));
    if (file === 'index.html') content = content.toString().replace(/<script[^>]+src=["']\/?app\.js["'][^>]*><\/script>/, '<script type="module" src="/probe.js"></script>');
    res.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream'); res.end(content);
  } catch (error) { json(res, { error: String(error) }, 500); }
});
server.listen(Number(process.env.PORT || 8899), '127.0.0.1', () => console.log(`Local-first app probe: http://localhost:${server.address().port}/?protocol=legacy&syncProtocol=1\nEvidence directory: ${evidenceDir}\nSource SHA: ${sha}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { for (const res of heldResponses) res.destroy(); server.close(() => process.exit(0)); });
