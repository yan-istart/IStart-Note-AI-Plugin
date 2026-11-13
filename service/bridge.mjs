import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID, timingSafeEqual } from 'node:crypto';

export function equalToken(a, b) {
  const x = Buffer.from(a || ''), y = Buffer.from(b || '');
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

/** Wechatsync extension's request/response protocol; no platform cookies leave the browser. */
export class ExtensionBridge {
  pending = new Map();
  client = null;
  constructor({ token, host = '127.0.0.1', port = 27125, timeout = 360000 }) {
    if (!token || token.length < 24) throw new Error('EXTENSION_TOKEN must contain at least 24 characters');
    this.token = token; this.host = host; this.port = port; this.timeout = timeout;
  }
  async start() {
    this.server = new WebSocketServer({ host: this.host, port: this.port, maxPayload: 32 * 1024 * 1024, perMessageDeflate: false,
      verifyClient: info => {
        try { return equalToken(new URL(info.req.url, 'http://localhost').searchParams.get('key'), this.token); }
        catch { return false; }
      } });
    this.server.on('connection', socket => {
      // A browser profile is deliberately the only account source for this service.
      if (this.client?.readyState === WebSocket.OPEN) { socket.close(1013, 'Another extension is connected'); return; }
      this.client = socket;
      socket.on('error', () => {});
      socket.on('close', () => {
        if (this.client !== socket) return;
        this.client = null;
        for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(new Error('Extension disconnected; delivery may have completed')); }
        this.pending.clear();
      });
      socket.on('message', data => {
        try {
          const message = JSON.parse(data.toString());
          const entry = this.pending.get(message.id);
          if (!entry) return;
          clearTimeout(entry.timer); this.pending.delete(message.id);
          if (message.error) entry.reject(new Error('Extension request failed'));
          else entry.resolve(message.result);
        } catch { /* Ignore unrelated extension notifications. */ }
      });
    });
    await new Promise((resolve, reject) => { this.server.once('listening', resolve); this.server.once('error', reject); });
  }
  get connected() { return this.client?.readyState === WebSocket.OPEN; }
  request(method, params) {
    if (!this.connected) return Promise.reject(new Error('Browser extension is not connected'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Extension timeout; delivery may have completed')); }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.client.send(JSON.stringify({ id, method, params, token: this.token }), error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(new Error('Extension send failed')); }
      });
    });
  }
  async close() {
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(new Error('Bridge stopped')); }
    this.pending.clear();
    this.client?.terminate();
    if (this.server) await new Promise(resolve => this.server.close(resolve));
  }
}
