/** SQLite work stays off the Host control/event loop. Never opens native runtimes. */
import { parentPort } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, lstatSync, realpathSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { HistoryEntry } from '../shared/protocol.js';

const databases = new Map<string, DatabaseSync>();
const MAX_BYTES = 65536, BLOCK_BYTES = 8192;
function hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function dbAt(path: string) {
  let db = databases.get(path);
  if (db) { databases.delete(path); databases.set(path, db); return db; }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (lstatSync(dirname(path)).isSymbolicLink() || realpathSync(dirname(path)) !== resolve(dirname(path))) throw new Error('Unsafe index directory');
  try { if (lstatSync(path).isSymbolicLink()) throw new Error('Unsafe index file'); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
  db = new DatabaseSync(path); chmodSync(path, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;
    CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS entities (id TEXT PRIMARY KEY, position INTEGER NOT NULL, revision TEXT NOT NULL, signature TEXT NOT NULL, entry TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS entity_order ON entities(position);
    CREATE TABLE IF NOT EXISTS changes (revision INTEGER PRIMARY KEY, body TEXT NOT NULL, bytes INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tombstones (id TEXT PRIMARY KEY, revision TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, body TEXT NOT NULL);`);
  databases.set(path, db);
  while (databases.size > 24) { const [key, old] = databases.entries().next().value!; old.close(); databases.delete(key); }
  return db;
}
function initial() { return { bindingEpoch: randomUUID(), headRevision: '0', oldestAvailableRevision: '0', snapshotId: randomUUID(), sourceFreshness: 'unknown', lastSourceCheckAt: null, runState: 'unknown', binding: null, sourceGeneration: null, pendingRequests: [], metadata: {}, deleted: false }; }
function state(db: DatabaseSync): any { const row = db.prepare('SELECT value FROM state WHERE id=1').get(); return row ? JSON.parse(String(row.value)) : initial(); }
function save(db: DatabaseSync, s: any) { db.prepare('INSERT INTO state(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(s)); }
function identity(s: any, id: string) { return { syncProtocol: 2, conversationId: id, bindingEpoch: s.bindingEpoch, headRevision: s.headRevision, oldestAvailableRevision: s.oldestAvailableRevision, snapshotId: s.snapshotId, sourceFreshness: s.sourceFreshness, lastSourceCheckAt: s.lastSourceCheckAt, runState: s.runState }; }
function fail(code: string, s?: any, id?: string): never { throw Object.assign(new Error(code), { code, meta: s && id ? identity(s, id) : undefined }); }
function assertEpoch(s: any, args: any) { if (args.bindingEpoch !== s.bindingEpoch) fail('reset_required', s, args.id); }
function bytes(value: unknown) { return Buffer.byteLength(JSON.stringify(value)); }
function textPrefix(text: string, budget: number) {
  let end = Math.min(text.length, Math.max(0, budget));
  while (Buffer.byteLength(JSON.stringify(text.slice(0, end))) > budget && end) end = Math.floor(end * .8);
  if (end && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
  return text.slice(0, end);
}
function textSuffix(text:string,budget:number) {
  let count=Math.min(text.length,Math.max(0,budget));
  while(Buffer.byteLength(JSON.stringify(text.slice(text.length-count)))>budget&&count)count=Math.floor(count*.8);
  let start=text.length-count;if(start<text.length&&/[\uDC00-\uDFFF]/.test(text[start]))start++;
  return text.slice(start);
}
function contentText(value:any):string {if(typeof value==='string')return value;if(Array.isArray(value))return value.filter(part=>part?.type==='text').map(part=>String(part.text??'')).join('\n');return contentText(value?.content??'');}
function boundedEntry(entry: any, revision: string, budget = BLOCK_BYTES): any {
  const fields: Record<string, string> = {};
  const result: any = { kind: entry.kind, id: entry.id, entityRevision: revision, contentOffset:0 };
  if (entry.at) result.at = String(entry.at).slice(0, 80);
  if (entry.kind === 'tool') { result.name = String(entry.name || 'tool').slice(0, 200); result.isError = !!entry.isError; result.status = entry.status ?? 'completed'; result.args = {}; fields.args = JSON.stringify(entry.args ?? {}); fields.result = String(entry.result ?? ''); if (entry.diff) fields.diff = entry.diff; }
  else { fields.text = String(entry.text ?? ''); if (entry.imageCount) result.imageCount = entry.imageCount; }
  result.contentLengths = Object.fromEntries(Object.entries(fields).map(([k,v]) => [k,v.length]));
  for (const [field, text] of Object.entries(fields)) {
    if (field === 'args' || field === 'diff') { if (text.length > 2) result.contentTruncated = true; continue; }
    const available = Math.max(0, budget - bytes(result) - 180);
    result[field] = textSuffix(text, available);
    result.contentOffset=text.length-result[field].length;
    if (result[field].length < text.length) result.contentTruncated = true;
  }
  result.contentLength = (fields.text ?? fields.result ?? '').length;
  return result;
}
function operation(db: DatabaseSync, s: any, type: string, entityId: string, entityRevision: string, payload: any) {
  const rev = BigInt(s.headRevision) + 1n;
  if (rev > 9223372036854775807n) fail('revision_exhausted');
  s.headRevision = String(rev); s.snapshotId = `${s.bindingEpoch}:${s.headRevision}`;
  const op = { opId: `${s.bindingEpoch}:${rev}`, revision: String(rev), entityId, entityRevision, type, payload };
  const body = JSON.stringify(op);
  db.prepare('INSERT INTO changes(revision,body,bytes) VALUES(?,?,?)').run(rev, body, Buffer.byteLength(body));
}
function upsert(db: DatabaseSync, s: any, entry: any, position?: number) {
  if (!entry || typeof entry.id !== 'string' || entry.id.length > 1024 || !['user','assistant','tool','note'].includes(entry.kind)) fail('invalid_entity');
  const prior = db.prepare('SELECT * FROM entities WHERE id=?').get(entry.id);
  const signature = hash(entry);
  const order = position ?? (prior ? Number(prior.position) : Number(db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS n FROM entities').get()!.n));
  if (prior?.signature === signature) { if (Number(prior.position) !== order) db.prepare('UPDATE entities SET position=? WHERE id=?').run(order, entry.id); return; }
  const revision = String(BigInt(prior ? String(prior.revision) : String(db.prepare('SELECT revision FROM tombstones WHERE id=?').get(entry.id)?.revision ?? '0')) + 1n);
  db.prepare('INSERT INTO entities(id,position,revision,signature,entry) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET position=excluded.position,revision=excluded.revision,signature=excluded.signature,entry=excluded.entry').run(entry.id, order, revision, signature, JSON.stringify(entry));
  db.prepare('DELETE FROM tombstones WHERE id=?').run(entry.id);
  operation(db, s, entry.kind === 'tool' ? 'upsertTool' : 'replaceText', entry.id, revision, {entry: boundedEntry(entry, revision),isNew:!prior});
}
function remove(db: DatabaseSync, s: any, id: string) {
  const prior = db.prepare('SELECT revision FROM entities WHERE id=?').get(id); if (!prior) return;
  const revision = String(BigInt(String(prior.revision)) + 1n);
  db.prepare('DELETE FROM entities WHERE id=?').run(id);
  db.prepare('INSERT INTO tombstones(id,revision) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision').run(id, revision);
  operation(db, s, 'deleteEntity', id, revision, {});
}
function trim(db: DatabaseSync, s: any, retainBytes: number) {
  let total = Number(db.prepare('SELECT COALESCE(SUM(bytes),0) AS n FROM changes').get()!.n);
  if (total <= retainBytes) return;
  const rows = db.prepare('SELECT body,bytes FROM changes ORDER BY revision').all();
  for (const row of rows) { if (total <= retainBytes) break; const op = JSON.parse(String(row.body)); db.prepare('DELETE FROM changes WHERE revision=?').run(BigInt(op.revision)); total -= Number(row.bytes); s.oldestAvailableRevision = op.revision; }
}
function mutate(db: DatabaseSync, action: (s: any) => void, retainBytes: number) {
  db.exec('BEGIN IMMEDIATE');
  try { const s = state(db); action(s); trim(db, s, retainBytes); save(db, s); db.exec('COMMIT'); return s; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
function run(path: string, action: string, a: any): any {
  const db = dbAt(path);
  // Initialization and ownership recovery use the same writer transaction as updates.
  const ownerRow=db.prepare('SELECT value FROM state WHERE id=1').get();
  if(!ownerRow||JSON.parse(String(ownerRow.value)).ownerGeneration!==a.ownerGeneration)mutate(db,current=>{
    if(current.ownerGeneration!==a.ownerGeneration){
      if(current.runState==='running'){current.runState='unknown';operation(db,current,'setRunState','$run',current.headRevision,{runState:'unknown'});}
      for(const row of db.prepare('SELECT id,body FROM commands').all()) {const command=JSON.parse(String(row.body));if(['accepted','delivering','running'].includes(command.state)){command.state='uncertain';command.updatedAt=new Date().toISOString();db.prepare('UPDATE commands SET body=? WHERE id=?').run(JSON.stringify(command),String(row.id));operation(db,current,'setMetadata','$command',current.headRevision,{command});}}
      current.ownerGeneration=a.ownerGeneration;current.sourceFreshness='unknown';
    }
  },a.retainBytes);
  const reading=['meta','page','changes','content','commands'].includes(action);
  if(reading)db.exec('BEGIN');
  try {const result=dispatch(db,action,a);if(reading)db.exec('COMMIT');return result;}
  catch(error){if(reading)db.exec('ROLLBACK');throw error;}
}
function dispatch(db:DatabaseSync,action:string,a:any):any {
  let s = state(db);
  if (s.deleted && action !== 'delete') fail('conversation_deleted', s, a.id);
  if (action === 'meta') return identity(s, a.id);
  if(action==='commands') {const rows=a.requestId?db.prepare('SELECT body FROM commands WHERE id=?').all(a.requestId):db.prepare('SELECT body FROM commands ORDER BY rowid DESC LIMIT 20').all();return {...identity(s,a.id),commands:rows.map(row=>JSON.parse(String(row.body)))};}
  if(action==='command') {
    let command:any;
    const current=mutate(db,c=>{
      if(typeof a.requestId!=='string'||!a.requestId||a.requestId.length>256)fail('invalid_request_id');
      const previous=db.prepare('SELECT body FROM commands WHERE id=?').get(a.requestId);const now=new Date().toISOString();
      if(a.state==='accepted') {
        if(previous)fail('request_already_accepted',c,a.id);
        const usage=db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(LENGTH(body)),0) AS bytes FROM commands').get()!;
        if(Number(usage.count)>=4096||Number(usage.bytes)>1024*1024-1024)fail('command_ledger_full',c,a.id);
        command={requestId:a.requestId,bindingEpoch:c.bindingEpoch,state:'accepted',mode:a.mode??'prompt',acceptedAt:now,updatedAt:now};
        db.prepare('INSERT INTO commands(id,body) VALUES(?,?)').run(a.requestId,JSON.stringify(command));
      }else {
        if(!previous)fail('unknown_command');command=JSON.parse(String(previous.body));
        if(command.bindingEpoch!==c.bindingEpoch)fail('reset_required',c,a.id);
        if(!['delivering','running','settled','uncertain','cancelled'].includes(a.state))fail('invalid_command_state');
        // Late native starts cannot undo an already observed settlement.
        if(['settled','cancelled'].includes(command.state)&&command.state!==a.state)return;
        command.state=a.state;command.updatedAt=now;db.prepare('UPDATE commands SET body=? WHERE id=?').run(JSON.stringify(command),a.requestId);
      }
      operation(db,c,'setMetadata','$command',c.headRevision,{command});
    },a.retainBytes);return {...identity(current,a.id),command};
  }

  if (action === 'reconcile') {
    return identity(mutate(db, current => {
      if (a.expectedEpoch && a.expectedEpoch !== current.bindingEpoch || a.expectedRevision && a.expectedRevision !== current.headRevision) fail('stale_audit');
      if (a.binding && current.binding && current.binding !== a.binding) { db.exec('DELETE FROM entities; DELETE FROM changes; DELETE FROM tombstones;'); Object.assign(current, initial()); }
      current.binding = a.binding ?? current.binding;
      const beforeOrder=db.prepare('SELECT id FROM entities ORDER BY position').all().map(row=>String(row.id));
      const seen = new Set<string>();
      for (let i = 0; i < a.entries.length; i++) { const entry = a.entries[i]; if (seen.has(entry.id)) fail('duplicate_entity'); seen.add(entry.id); upsert(db,current,entry,i); }
      for (const row of db.prepare('SELECT id FROM entities').all()) if (!seen.has(String(row.id))) remove(db,current,String(row.id));
      const afterOrder=a.entries.map((entry:any)=>entry.id);
      if(JSON.stringify(beforeOrder)!==JSON.stringify(afterOrder)&&beforeOrder.length)operation(db,current,'setMetadata','$metadata',current.headRevision,{pagesInvalidated:true});
      current.sourceGeneration = a.sourceGeneration ?? null; current.sourceFreshness = a.sourceFreshness ?? 'unknown'; current.lastSourceCheckAt = a.checkedAt ?? null;
    }, a.retainBytes), a.id);
  }
  if (action === 'event') {
    return identity(mutate(db, current => {
      const e = a.event;
      if (a.expectedEpoch && a.expectedEpoch !== current.bindingEpoch) fail('stale_event');
      current.sourceFreshness = 'unknown';
      if (e.type === 'run_started' || e.type === 'agent_start') { current.runId = e.runId ?? randomUUID(); current.liveMessage = null; }
      if (['run_started','agent_start','run_completed','agent_settled','run_interrupted','agent_interrupted'].includes(e.type)) {
        current.runState = e.type.endsWith('started') || e.type === 'agent_start' ? 'running' : e.type.endsWith('interrupted') ? 'interrupted' : 'settled';
        operation(db,current,'setRunState','$run',current.headRevision,{runState:current.runState});
        if (current.runState !== 'running') {current.pendingRequests=[]; operation(db,current,'setPendingRequest','$pending',current.headRevision,{requests:[]});}
      }
      if (e.type === 'message_delta' && typeof e.id === 'string' && typeof e.delta === 'string') {
        const prior = db.prepare('SELECT entry FROM entities WHERE id=?').get(e.id);
        const entry = prior ? JSON.parse(String(prior.entry)) : {kind:'assistant',id:e.id,text:''}; entry.text += e.delta; upsert(db,current,entry);
      } else if (e.type === 'message_completed' && typeof e.id === 'string') upsert(db,current,{kind:'assistant',id:e.id,text:String(e.text ?? '')});
      else if (e.type === 'tool_update' && typeof e.id === 'string') {
        const prior = db.prepare('SELECT entry FROM entities WHERE id=?').get(e.id);
        upsert(db,current,{...(prior ? JSON.parse(String(prior.entry)) : {kind:'tool',id:e.id,name:'tool',args:{}}),...(e.name ? {name:e.name} : {}),...(e.args ? {args:e.args} : {}),...(e.result !== undefined ? {result:String(e.result)} : {}),...(e.status ? {status:e.status} : {}),...(e.isError !== undefined ? {isError:!!e.isError} : {})});
      } else if (e.type === 'sync_entity' && e.entry) upsert(db,current,e.entry);
      else if (['tool_execution_start','tool_execution_update','tool_execution_end'].includes(e.type)&&typeof e.toolCallId==='string') {
        const prior=db.prepare('SELECT entry FROM entities WHERE id=?').get(e.toolCallId);
        const entry=prior?JSON.parse(String(prior.entry)):{kind:'tool',id:e.toolCallId,name:e.toolName??'tool',args:e.args??{}};
        if(e.args)entry.args=e.args;if(e.toolName)entry.name=e.toolName;
        if(e.result!==undefined||e.partialResult!==undefined)entry.result=contentText(e.result??e.partialResult);
        entry.status=e.type==='tool_execution_end'?(e.isError?'failed':'completed'):'inProgress';if(e.isError!==undefined)entry.isError=!!e.isError;upsert(db,current,entry);
      } else if(e.type==='message_start'&&e.message?.role==='user') {
        current.liveUser=e.id??`live:${current.runId??(current.runId=randomUUID())}:user:${randomUUID()}`;
        upsert(db,current,{kind:'user',id:current.liveUser,text:contentText(e.message.content)});
      } else if (e.type === 'message_update' && e.assistantMessageEvent?.type === 'text_delta') {
        if(typeof e.id==='string')current.liveMessage=e.id;
        current.liveMessage ??= `live:${current.runId ?? (current.runId=randomUUID())}:${randomUUID()}`;
        const prior = db.prepare('SELECT entry FROM entities WHERE id=?').get(current.liveMessage);
        upsert(db,current,{kind:'assistant',id:current.liveMessage,text:(prior ? JSON.parse(String(prior.entry)).text : '') + String(e.assistantMessageEvent.delta ?? '')});
      } else if (e.type === 'message_end') {
        const role=e.message?.role;
        if(role==='user'&&(e.id||current.liveUser))upsert(db,current,{kind:'user',id:e.id??current.liveUser,text:contentText(e.message.content)});
        else if(role==='assistant'&&(e.id||current.liveMessage)&&(e.text!==undefined||e.message?.content))upsert(db,current,{kind:'assistant',id:e.id??current.liveMessage,text:e.text??contentText(e.message.content)});
        current.liveMessage=null;
      }
      else if ((e.type === 'native_request' || e.type === 'extension_ui_request') && typeof e.id === 'string') {
        current.pendingRequests = [...current.pendingRequests.filter((r:any)=>r.id!==e.id),{id:e.id,title:String(e.title??'').slice(0,512),method:String(e.method??'').slice(0,40)}].slice(-20);
        operation(db,current,'setPendingRequest','$pending',current.headRevision,{requests:current.pendingRequests});
      } else if (e.type === 'sync_pending') {current.pendingRequests=e.requests;operation(db,current,'setPendingRequest','$pending',current.headRevision,{requests:e.requests});}
      else if (e.type === 'sync_metadata') {current.metadata=e.metadata;operation(db,current,'setMetadata','$metadata',current.headRevision,e.metadata);}
    }, a.retainBytes),a.id);
  }
  if(action==='ingest_loss')return identity(mutate(db,current=>{current.sourceFreshness='unknown';if(current.runState==='running'){current.runState='unknown';operation(db,current,'setRunState','$run',current.headRevision,{runState:'unknown'});}},a.retainBytes),a.id);
  if (action === 'freshness') return identity(mutate(db,current=>{current.sourceFreshness=a.freshness;},a.retainBytes),a.id);
  if (action === 'delete') { s = mutate(db,c=>{c.deleted=true;c.bindingEpoch=randomUUID();c.sourceFreshness='unknown';c.pendingRequests=[];db.exec('DELETE FROM entities; DELETE FROM changes; DELETE FROM tombstones;');},a.retainBytes);return identity(s,a.id); }
  const limit = Math.max(1024,Math.min(MAX_BYTES,Number(a.limitBytes)||MAX_BYTES));
  if (action === 'page') {
    let before: number | undefined;let anchorAdjusted=false;
    if(a.anchorEntityId){if(typeof a.anchorEntityId!=='string'||a.anchorEntityId.length>1024)fail('invalid_anchor');const anchor=db.prepare('SELECT position FROM entities WHERE id=?').get(a.anchorEntityId);if(anchor)before=Number(anchor.position)+1;else anchorAdjusted=true;}
    if (a.cursor) { let cursor:any;try{cursor=JSON.parse(Buffer.from(a.cursor,'base64url').toString());}catch{fail('invalid_cursor');}
      if(cursor.epoch!==s.bindingEpoch||cursor.snapshotId!==s.snapshotId)fail('reset_required',s,a.id);
      const row=db.prepare('SELECT position FROM entities WHERE id=?').get(cursor.beforeId);if(!row)fail('reset_required',s,a.id);before=Number(row.position);
    }
    const rows = before === undefined ? db.prepare('SELECT * FROM entities ORDER BY position DESC LIMIT 41').all() : db.prepare('SELECT * FROM entities WHERE position<? ORDER BY position DESC LIMIT 41').all(before);
    const result:any={...identity(s,a.id),baseRevision:s.headRevision,entries:[],olderCursor:null,pendingRequests:s.pendingRequests,...(a.anchorEntityId?{anchorEntityId:a.anchorEntityId,anchorAdjusted}:{})};
    for(const row of rows.slice(0,40)) { const entry=boundedEntry(JSON.parse(String(row.entry)),String(row.revision),Math.min(BLOCK_BYTES,limit-bytes(result)-650)); if(bytes({...result,entries:[entry,...result.entries]})+650>limit)break;result.entries.unshift(entry); }
    if (rows.length && !result.entries.length) fail('limit_too_small');
    const first=result.entries[0];if(first && (rows.length>result.entries.length))result.olderCursor=Buffer.from(JSON.stringify({epoch:s.bindingEpoch,snapshotId:s.snapshotId,beforeId:first.id})).toString('base64url');
    return result;
  }
  if (action === 'changes') {
    assertEpoch(s,a);if(!/^(0|[1-9][0-9]{0,18})$/.test(a.afterRevision ?? ''))fail('invalid_revision');const after=BigInt(a.afterRevision);
    if(after>BigInt(s.headRevision)||after<BigInt(s.oldestAvailableRevision))fail('reset_required',s,a.id);
    const result:any={...identity(s,a.id),fromExclusive:String(after),throughRevision:String(after),hasMore:false,operations:[]};
    for(const row of db.prepare('SELECT body FROM changes WHERE revision>? ORDER BY revision LIMIT 100').all(after)) { const op=JSON.parse(String(row.body));if(bytes({...result,operations:[...result.operations,op]})>limit)break; result.operations.push(op);result.throughRevision=op.revision; }
    if(result.throughRevision===String(after)&&after<BigInt(s.headRevision))fail('limit_too_small');result.hasMore=BigInt(result.throughRevision)<BigInt(s.headRevision);return result;
  }
  if(action==='content') {
    assertEpoch(s,a);const row=db.prepare('SELECT * FROM entities WHERE id=?').get(a.entityId);if(!row)fail('entity_deleted',s,a.id);if(String(row.revision)!==a.entityRevision)fail('entity_changed',s,a.id);
    const entry=JSON.parse(String(row.entry));const field=a.field ?? (entry.kind==='tool'?'result':'text');if(!['text','result','args','diff'].includes(field))fail('invalid_field');
    const text=field==='args'?JSON.stringify(entry.args??{}):String(entry[field]??'');const offset=Number(a.offset??0);if(!Number.isSafeInteger(offset)||offset<0||offset>text.length)fail('invalid_offset');
    const result:any={...identity(s,a.id),entityId:a.entityId,entityRevision:String(row.revision),field,encoding:'utf-16',offset,totalLength:text.length,text:'',nextOffset:offset,hasMore:offset<text.length};
    result.text=textPrefix(text.slice(offset),Math.min(BLOCK_BYTES,limit-bytes(result)-100));result.nextOffset=offset+result.text.length;result.hasMore=result.nextOffset<text.length;return result;
  }
  fail('unknown_index_operation');
}
parentPort!.on('message',({requestId,path,action,args})=>{try{parentPort!.postMessage({requestId,value:run(path,action,args)});}catch(error:any){parentPort!.postMessage({requestId,error:{code:error.code??'index_unavailable',message:error.message,meta:error.meta}});}});
