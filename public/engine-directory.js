// Availability is observed per engine. Scope changes invalidate all late responses.
export function createEngineDirectory({fetch: request = globalThis.fetch, ids, onChange}) {
  let scope, generation = 0, rows = new Map(), pending = new Map(), individual = false;
  let abort = new AbortController();
  const publish = metadata => onChange([...rows.values()], metadata);
  const current = epoch => epoch === generation;
  const read = async path => {
    const response = await request(path, {cache:'no-store',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(18000)])});
    if (!response.ok) throw Error('Agent metadata unavailable');
    return response.json();
  };
  function observed(id, row, previous) {
    if (!row || row.id !== id || typeof row.available !== 'boolean') throw Error('Invalid Agent observation');
    if (row.status === 'unverified' && previous?.available) {
      rows.set(id, {...previous, checking:false, stale:true, retry:true});
      return;
    }
    rows.set(id, {...row, checking:false, retry:!row.available});
  }
  function failed(id, previous, legacy = false) {
    rows.set(id, previous?.available
      ? {...previous,checking:false,stale:true,retry:true}
      : {id,available:legacy && id==='pi',status:'unverified',retry:true});
  }
  function refresh(id, force = false) {
    if (!ids.includes(id) || scope === undefined) return Promise.resolve();
    if (pending.has(id)) return pending.get(id);
    if (!individual) return refreshLegacy(generation);
    const epoch = generation, previous = rows.get(id);
    rows.set(id, {...previous,id,checking:true});
    const work = read('/api/engines/' + id + (force ? '/retry' : '')).then(data => {
      if (current(epoch)) observed(id, data.engine, previous);
    }).catch(() => { if (current(epoch)) failed(id, previous); }).finally(() => {
      if (current(epoch)) { pending.delete(id); publish(); }
    });
    pending.set(id, work);
    publish();
    return work;
  }
  function refreshLegacy(epoch) {
    if (pending.has('legacy')) return pending.get('legacy');
    const work = read('/api/engines').then(data => {
      if (!current(epoch)) return;
      if (!Array.isArray(data.engines)) throw Error('Invalid Agent directory');
      for (const id of ids) {
        const row = data.engines.find(row => row?.id === id);
        if (row) observed(id, row, rows.get(id));
        else failed(id, rows.get(id), true);
      }
      publish(data);
    }).catch(() => {
      if (current(epoch)) { for (const id of ids) failed(id, rows.get(id), true); publish(); }
    }).finally(() => { if (current(epoch)) pending.delete('legacy'); });
    pending.set('legacy', work);
    return work;
  }
  function setScope(next) {
    if (next === scope) return;
    generation++;
    abort.abort();
    abort = new AbortController();
    scope = next;
    rows = new Map();
    pending = new Map();
    individual = false;
    publish(null);
    if (scope === undefined) return;
    const epoch = generation;
    void read('/api/engines/directory').then(data => {
      if (!current(epoch)) return;
      if (data.independentReadiness !== true || !Array.isArray(data.engines)) throw Error('Legacy Agent directory');
      individual = true;
      publish(data);
      for (const id of ids) void refresh(id);
    }).catch(() => { if (current(epoch)) void refreshLegacy(epoch); });
  }
  return {setScope, retry:id=>refresh(id,true)};
}
