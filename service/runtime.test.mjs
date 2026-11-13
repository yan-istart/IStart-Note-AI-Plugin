import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { buildPublishingRuntime } from '../scripts/build-publishing-service.mjs';

async function freePort() {
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
test('bundled service starts its MCP worker and sends an image draft through a simulated browser extension', { timeout: 20000 }, async t => {
  const runtime = await buildPublishingRuntime();
  const directory = await mkdtemp(join(tmpdir(), 'istart-runtime-'));
  await writeFile(join(directory, 'publishing-service.cjs'), runtime.gateway);
  await writeFile(join(directory, 'publishing-mcp.cjs'), runtime.worker);
  const port = await freePort(), bridgePort = await freePort();
  const token = 'runtime-access-token-1234567890123', extensionToken = 'runtime-extension-token-1234567890123';
  const child = spawn(process.execPath, [join(directory, 'publishing-service.cjs')], { env: { ...process.env,
    PUBLISHING_TOKEN: token, EXTENSION_TOKEN: extensionToken, PUBLISHING_PORT: String(port), BRIDGE_PORT: String(bridgePort), PUBLISHING_DATA: join(directory, 'jobs') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', data => { stderr += data; });
  t.after(async () => {
    if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    await rm(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', data => { if (data.toString().includes('ISTART_PUBLISHING_READY')) resolve(); });
    child.once('exit', code => reject(new Error(`Runtime exited ${code}: ${stderr}`)));
    child.once('error', reject);
  });
  const socket = new WebSocket(`ws://127.0.0.1:${bridgePort}/extension?key=${extensionToken}`);
  await once(socket, 'open'); t.after(() => socket.terminate());
  let sends = 0;
  socket.on('message', data => {
    const message = JSON.parse(data.toString());
    assert.equal(message.token, extensionToken);
    let result;
    if (message.method === 'listPlatforms') result = [{ id: 'zhihu', username: 'writer', isAuthenticated: true }];
    else if (message.method === 'checkAuth') result = { isAuthenticated: true, username: 'writer' };
    else if (message.method === 'syncArticle') {
      sends++;
      assert.match(message.params.article.markdown, /data:image\/png;base64,AQID/);
      result = { syncId: 'extension-task', results: [{ platform: 'zhihu', success: true, draftOnly: true, postUrl: 'https://example.com/edit?id=1' }] };
    } else throw new Error('Unexpected extension request');
    socket.send(JSON.stringify({ id: message.id, result }));
  });
  const request = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    assert.ok(response.ok); return response.json();
  };
  assert.equal((await request('/v1/status')).extensionConnected, true);
  const accounts = (await request('/v1/platforms')).filter(a => a.isAuthenticated);
  const payload = { id: 'runtime-test-001', accounts, article: { title: '图文测试', markdown: '正文 ![图](data:image/png;base64,AQID)' } };
  await request('/v1/jobs', payload);
  let job;
  for (let i = 0; i < 100; i++) {
    job = await request('/v1/jobs/runtime-test-001');
    if (job.state === 'complete') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(job.results[0].state, 'draft');
  await request('/v1/jobs', payload); assert.equal(sends, 1);
});
