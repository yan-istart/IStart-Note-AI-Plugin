import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { ExtensionBridge } from './bridge.mjs';

test('extension bridge authenticates connections, correlates replies and rejects disconnects', async t => {
  const token = 'extension-test-token-1234567890';
  const bridge = new ExtensionBridge({ token, port: 0, timeout: 1000 });
  await bridge.start(); t.after(() => bridge.close());
  const port = bridge.server.address().port;
  const rejected = new WebSocket(`ws://127.0.0.1:${port}/extension?key=wrong`);
  await once(rejected, 'error');
  const socket = new WebSocket(`ws://127.0.0.1:${port}/extension?key=${token}`);
  await once(socket, 'open'); t.after(() => socket.terminate());
  socket.on('message', data => {
    const message = JSON.parse(data.toString());
    assert.equal(message.token, token);
    if (message.method === 'listPlatforms') socket.send(JSON.stringify({ id: message.id, result: [{ id: 'zhihu', username: 'writer' }] }));
  });
  assert.equal((await bridge.request('listPlatforms', {}))[0].username, 'writer');
  const pending = bridge.request('syncArticle', {});
  socket.close();
  await assert.rejects(pending, /disconnected/);
});
