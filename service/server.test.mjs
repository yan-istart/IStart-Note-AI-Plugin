import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPublishingService } from './server.mjs';

const token = 'test-only-token-12345678901234567890';
const article = { title: 'Test', markdown: '正文 ![image](data:image/png;base64,AQID)' };
const accounts = [{ id: 'zhihu', username: 'writer', isAuthenticated: true }];
async function fixture(t, sync) {
  const directory = await mkdtemp(join(tmpdir(), 'istart-publishing-'));
  let syncCount = 0;
  const provider = { async call(name, args) {
    if (name === 'status') return { extensionConnected: true };
    if (name === 'list_platforms') return accounts;
    if (name === 'check_auth') return { isAuthenticated: true, username: 'writer' };
    syncCount++; return sync ? sync(args) : { results: [{ platform: 'zhihu', success: true, draftOnly: true, postUrl: 'https://example.com/edit?id=1&token=secret' }] };
  } };
  let service = await createPublishingService({ provider, token, dataDir: directory, port: 0 });
  const request = async (path, data, auth = token) => {
    const address = service.server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method: data === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, data: await response.json() };
  };
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  return { request, directory, count: () => syncCount, async restart() {
    await service.close(); service = await createPublishingService({ provider, token, dataDir: directory, port: 0 });
  } };
}
async function complete(request, id) {
  for (let i = 0; i < 100; i++) {
    const result = await request(`/v1/jobs/${id}`);
    if (result.data.state === 'complete') return result.data;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Job did not complete');
}
test('authenticated API saves drafts once, strips URL credentials, and recovers jobs after restart', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/v1/status', undefined, 'wrong')).status, 401);
  assert.equal((await f.request('/v1/status')).data.protocol, 'istart-publishing-v1');
  const request = { id: 'request-0001', article, accounts };
  assert.equal((await f.request('/v1/jobs', request)).status, 202);
  const job = await complete(f.request, request.id);
  assert.equal(job.results[0].state, 'draft');
  assert.equal(job.results[0].postUrl, 'https://example.com/edit?id=1');
  assert.equal((await f.request('/v1/jobs', request)).status, 200);
  assert.equal((await f.request('/v1/jobs', { ...request, article: { ...article, title: 'changed' } })).status, 409);
  await f.restart();
  assert.equal((await f.request('/v1/jobs', request)).data.state, 'complete');
  assert.equal(f.count(), 1);
  const contents = await Promise.all((await readdir(f.directory)).map(file => readFile(join(f.directory, file), 'utf8')));
  assert.ok(contents.every(content => !content.includes('base64') && !content.includes('token=secret') && !content.includes(token)));
});
test('changed browser identities fail before sending; unsupported platforms are rejected', async t => {
  const f = await fixture(t);
  const request = { id: 'request-0002', article, accounts: [{ ...accounts[0], username: 'someone-else' }] };
  await f.request('/v1/jobs', request);
  assert.equal((await complete(f.request, request.id)).results[0].state, 'failed');
  assert.equal(f.count(), 0);
  assert.equal((await f.request('/v1/jobs', { ...request, id: 'request-0003', accounts: [{ id: 'xiaohongshu', username: 'writer' }] })).status, 400);
});
test('ambiguous or lost upstream results are unknown and never automatically retried', async t => {
  const f = await fixture(t, () => { throw new Error('network failed with token=secret'); });
  const request = { id: 'request-0004', article, accounts };
  await f.request('/v1/jobs', request);
  const job = await complete(f.request, request.id);
  assert.equal(job.results[0].state, 'unknown');
  assert.ok(!JSON.stringify(job).includes('secret'));
  await f.request('/v1/jobs', request);
  assert.equal(f.count(), 1);
});
test('missing draft confirmation stays unknown, while explicit platform failure permits manual retry', async t => {
  let count = 0;
  const f = await fixture(t, () => ({ results: [{ platform: 'zhihu', success: ++count === 1 }] }));
  await f.request('/v1/jobs', { id: 'request-0005', article, accounts });
  assert.equal((await complete(f.request, 'request-0005')).results[0].state, 'unknown');
  await f.request('/v1/jobs', { id: 'request-0006', article, accounts });
  assert.equal((await complete(f.request, 'request-0006')).results[0].state, 'failed');
});
test('a persisted interrupted job recovers as unknown without executing again', async t => {
  const f = await fixture(t);
  await writeFile(join(f.directory, 'interrupted-001.json'), JSON.stringify({ fingerprint: 'test', job: {
    id: 'interrupted-001', serverId: 'test-server', state: 'sending', createdAt: new Date().toISOString(), results: [{ platform: 'zhihu', state: 'sending' }],
  } }));
  await f.restart();
  const result = await f.request('/v1/jobs/interrupted-001');
  assert.equal(result.data.state, 'complete'); assert.equal(result.data.results[0].state, 'unknown');
  assert.equal(f.count(), 0);
});
