import { readBoundedJSON, SyncError } from '../sync-worker.js';
const pending = new Map();
self.onmessage = async ({ data }) => {
  if (data?.type === 'cancel') { pending.get(data.requestId)?.abort(); return; }
  if (data?.type !== 'read') return;
  const { requestId, context, url } = data;
  const controller = new AbortController(); pending.set(requestId, controller);
  try {
    if (typeof url !== 'string' || !/^\/api\/conversations\/[^/]+\/(meta|page|changes|content)(\?|$)/.test(url) || !context?.userScope) throw new SyncError('invalid_request');
    const value = await readBoundedJSON(self.fetch.bind(self), url, { signal: controller.signal, maxBytes: Math.min(80 * 1024, data.maxBytes || 80 * 1024) });
    self.postMessage({ requestId, ...context, value });
  } catch (error) {
    self.postMessage({ requestId, ...context, error: { code: error.code || (error.name === 'AbortError' ? 'cancelled' : 'network_error'), message: error.message, status: error.status } });
  } finally { pending.delete(requestId); }
};
