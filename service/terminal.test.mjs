import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { buildTerminalServiceRuntime } from '../scripts/build-terminal-service.mjs';

async function freePort() {
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}

function request(path, port, token, method = 'GET') {
  return fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
}

test('bundled terminal service spawns an interactive PTY over WebSocket', { timeout: 30000 }, async t => {
  const runtime = await buildTerminalServiceRuntime();
  const directory = await mkdtemp(join(tmpdir(), 'istart-terminal-'));
  await writeFile(join(directory, 'terminal-service.cjs'), runtime.code);
  // Deploy layout mirrors the runtime zip: the node-pty package sits next to the bundle.
  await cp('node_modules/@homebridge/node-pty-prebuilt-multiarch', join(directory, 'node_modules', '@homebridge', 'node-pty-prebuilt-multiarch'), { recursive: true });

  const port = await freePort();
  const token = 'terminal-test-token-1234567890';
  const child = spawn(process.execPath, [join(directory, 'terminal-service.cjs')], {
    env: { ...process.env, ISTART_TERMINAL_TOKEN: token, ISTART_TERMINAL_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  t.after(async () => {
    if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    await rm(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', data => { if (data.toString().includes('ISTART_TERMINAL_READY')) resolve(); });
    child.once('exit', code => reject(new Error(`Terminal service exited ${code}: ${stderr}`)));
    child.once('error', reject);
  });

  // Health is public; everything else needs the token.
  const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.service, 'istart-terminal');
  assert.equal((await request('/shutdown', port, 'bad-token', 'POST')).status, 401);

  const socket = new WebSocket(`ws://127.0.0.1:${port}/terminal?token=${token}`);
  await once(socket, 'open');
  t.after(() => socket.terminate());
  const messages = [];
  socket.on('message', data => messages.push(JSON.parse(data.toString())));
  const until = (type, timeout = 10000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = setInterval(() => {
      const found = messages.find(message => message.type === type);
      if (found) { clearInterval(tick); resolve(found); }
      else if (Date.now() - started > timeout) { clearInterval(tick); reject(new Error(`No ${type} message: ${JSON.stringify(messages)}`)); }
    }, 20);
  });

  socket.send(JSON.stringify({ type: 'spawn', cwd: directory, cols: 80, rows: 24 }));
  await until('ready');
  socket.send(JSON.stringify({ type: 'input', data: 'echo istart-$((40+2))\n' }));
  // Login shells can be slow to start; poll for the full echo result.
  await new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = setInterval(() => {
      const text = messages.filter(message => message.type === 'data').map(message => message.data).join('');
      if (text.includes('istart-42')) { clearInterval(tick); resolve(); }
      else if (Date.now() - started > 10000) { clearInterval(tick); reject(new Error(`No echo result: ${JSON.stringify(text.slice(-300))}`)); }
    }, 20);
  });
  socket.send(JSON.stringify({ type: 'resize', cols: 100, rows: 30 }));

  // Closing the socket kills the shell; a second session still works afterwards.
  socket.close();
  await once(socket, 'close');
  const second = new WebSocket(`ws://127.0.0.1:${port}/terminal?token=${token}`);
  await once(second, 'open');
  t.after(() => second.terminate());
  second.send(JSON.stringify({ type: 'spawn', cwd: directory, cols: 80, rows: 24 }));
  const secondMessages = [];
  second.on('message', data => secondMessages.push(JSON.parse(data.toString())));
  const secondReady = new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = setInterval(() => {
      if (secondMessages.some(message => message.type === 'ready')) { clearInterval(tick); resolve(); }
      else if (Date.now() - started > 10000) { clearInterval(tick); reject(new Error('Second session did not become ready')); }
    }, 20);
  });
  await secondReady;
  second.close();
  await once(second, 'close');

  // Shutdown requires the token and stops the service.
  assert.equal((await request('/shutdown', port, token, 'POST')).status, 200);
  await once(child, 'exit');
});
