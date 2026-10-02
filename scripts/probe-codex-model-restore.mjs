// Built adapter + installed native Codex + loopback Responses fixture.
// No production Host, account, transcript or paid provider is used.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexSessionFactory } from '../dist/src/host/codex-adapter.js';

const root = await mkdtemp(join(tmpdir(), 'coffee-model-restore-'));
const requests = [];
const endpoint = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  requests.push({ model: body.model, effort: body.reasoning?.effort });
  const response = { id: 'resp_fixture', object: 'response', created_at: 1, status: 'in_progress', model: body.model, output: [] };
  const item = { id: 'msg_fixture', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'fixture complete', annotations: [] }] };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  let sequence = 0;
  const emit = (type, payload) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...payload })}\n\n`);
  emit('response.created', { response });
  emit('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
  emit('response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
  emit('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: 'fixture complete' });
  emit('response.output_text.done', { item_id: item.id, output_index: 0, content_index: 0, text: 'fixture complete' });
  emit('response.output_item.done', { output_index: 0, item });
  emit('response.completed', { response: { ...response, status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } });
  res.end();
});
await new Promise(resolve => endpoint.listen(0, '127.0.0.1', resolve));
const config = {
  model: 'gpt-6-luna', model_reasoning_effort: 'low', model_provider: 'fixture',
  'model_providers.fixture.name': 'fixture',
  'model_providers.fixture.base_url': `http://127.0.0.1:${endpoint.address().port}/v1`,
  'model_providers.fixture.wire_api': 'responses',
  'model_providers.fixture.requires_openai_auth': false,
};
const options = {
  cliPath: process.argv[2] ?? 'codex', cwd: root, codexHome: join(root, 'codex'),
  sandbox: 'read-only', approvalPolicy: 'never',
  args: Object.entries(config).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`]),
};
const run = async session => {
  let off, timer;
  const completed = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(Error('Native fixture turn timed out')), 20000);
    off = session.onEvent(event => { if (event.type === 'agent_settled') resolve(); });
  });
  // Attach rejection handling before prompt delivery, including delivery errors.
  const result = completed.then(() => null, error => error);
  try {
    await session.prompt('Synthetic model persistence fixture.');
    const error = await result;
    if (error) throw error;
  } finally { clearTimeout(timer); off(); }
};
let factory;
try {
  await mkdir(options.codexHome, { recursive: true, mode: 0o700 });
  factory = new CodexSessionFactory(options);
  const first = await factory.create({ sessionId: 'model-fixture' });
  await run(first);
  await first.setModel('codex', 'gpt-6.1-sol');
  await first.setThinkingLevel('high');
  await factory.close();
  for (let restart = 1; restart <= 2; restart++) {
    factory = new CodexSessionFactory(options);
    const session = await factory.create({ sessionId: 'model-fixture' });
    const choices = await session.getModels();
    assert.equal(choices.current?.id, 'gpt-6.1-sol');
    assert.equal(choices.thinkingLevel, 'high');
    await run(session);
    assert.deepEqual(requests.at(-1), { model: 'gpt-6.1-sol', effort: 'high' });
    console.log(JSON.stringify({ restart, ...requests.at(-1), verdict: 'PASS' }));
    await factory.close();
  }
} finally {
  try { await factory?.close(); }
  finally { await new Promise(resolve => endpoint.close(resolve)); await rm(root, { recursive: true, force: true }); }
}
