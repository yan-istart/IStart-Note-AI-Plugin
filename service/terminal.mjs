import http from 'node:http';
import os from 'node:os';
import { spawn as spawnPty } from '@homebridge/node-pty-prebuilt-multiarch';
import { WebSocketServer } from 'ws';
import { equalToken } from './bridge.mjs';

const VERSION = typeof ISTART_TERMINAL_VERSION === 'string' ? ISTART_TERMINAL_VERSION : 'dev';
const TOKEN = process.env.ISTART_TERMINAL_TOKEN || '';
const HOST = process.env.ISTART_TERMINAL_HOST || '127.0.0.1';
const PORT = Number(process.env.ISTART_TERMINAL_PORT || 27126);

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

function safeCwd(value) {
  if (typeof value !== 'string' || value.length > 2048 || value.includes('\0')) return '';
  return value;
}

function shellCommand() {
  if (process.platform === 'win32') return { file: 'powershell.exe', args: [] };
  return { file: process.env.SHELL || '/bin/bash', args: ['-l'] };
}

function send(socket, message) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

/** One WebSocket connection is one PTY session; closing the socket kills the shell. */
function attachSession(socket) {
  let proc = null;
  let resizeTimer = null;
  const queue = [];
  socket.on('message', raw => {
    let message;
    try { message = JSON.parse(String(raw)); } catch { socket.close(1003, 'Invalid JSON'); return; }
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'spawn' && !proc) {
      const { file, args } = shellCommand();
      try {
        proc = spawnPty(file, args, {
          name: 'xterm-256color',
          cols: clampInt(message.cols, 2, 1000, 80),
          rows: clampInt(message.rows, 2, 500, 24),
          cwd: safeCwd(message.cwd) || os.homedir(),
          env: { ...process.env, TERM: 'xterm-256color' },
        });
      } catch (error) {
        send(socket, { type: 'error', message: `无法启动 shell:${error instanceof Error ? error.message : String(error)}` });
        socket.close(1011, 'spawn failed');
        return;
      }
      proc.onData(data => send(socket, { type: 'data', data }));
      proc.onExit(({ exitCode }) => {
        send(socket, { type: 'exit', code: exitCode });
        socket.close();
      });
      for (const queued of queue) { if (proc) proc.write(queued); }
      queue.length = 0;
      send(socket, { type: 'ready' });
    } else if (message.type === 'input' && typeof message.data === 'string') {
      if (proc) proc.write(message.data); else if (queue.length < 200) queue.push(message.data);
    } else if (message.type === 'resize') {
      const cols = clampInt(message.cols, 2, 1000, null);
      const rows = clampInt(message.rows, 2, 500, null);
      if (!proc || cols === null || rows === null) return;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        try { proc.resize(cols, rows); } catch { /* Session already closed. */ }
      }, 30);
    }
  });
  socket.on('close', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    try { proc?.kill(); } catch { /* Already exited. */ }
  });
}

const wss = new WebSocketServer({ noServer: true });
const sessions = new Set();

wss.on('connection', socket => {
  sessions.add(socket);
  socket.on('close', () => sessions.delete(socket));
  attachSession(socket);
});

const server = http.createServer((req, res) => {
  const sendJson = (status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(value));
  };
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(200, { ok: true, service: 'istart-terminal', version: VERSION, sessions: sessions.size });
      return;
    }
    if (!equalToken(req.headers.authorization, `Bearer ${TOKEN}`)) { sendJson(401, { error: 'Access token is invalid' }); return; }
    if (req.method === 'POST' && url.pathname === '/shutdown') {
      sendJson(200, { ok: true });
      setTimeout(() => {
        for (const socket of sessions) socket.close(1001, 'shutdown');
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 500).unref();
      }, 50);
      return;
    }
    sendJson(404, { error: 'Not found' });
  } catch {
    try { sendJson(500, { error: 'Internal error' }); } catch { /* Response already sent. */ }
  }
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/terminal') { socket.destroy(); return; }
  const token = url.searchParams.get('token') || '';
  if (!TOKEN || !equalToken(token, TOKEN)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

if (!TOKEN || TOKEN.length < 16) {
  console.error('ISTART_TERMINAL_TOKEN must contain at least 16 characters');
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  console.log(`ISTART_TERMINAL_READY ${PORT}`);
});
