import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { equalToken } from './bridge.mjs';

export const PLATFORMS = ['weixin', 'zhihu', 'bilibili'];
const LIMIT = 26 * 1024 * 1024;
function safeUrl(value) {
  try {
    if (typeof value !== 'string' || value.length > 4096) return undefined;
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    url.username = ''; url.password = ''; url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/token|ticket|secret|auth|key|session|cookie/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch { return undefined; }
}
function account(raw, id) {
  return { id, name: String(raw?.name || id).slice(0, 80), isAuthenticated: raw?.isAuthenticated === true,
    ...(typeof raw?.username === 'string' ? { username: raw.username.slice(0, 100) } : {}),
    ...(typeof raw?.userId === 'string' ? { userId: raw.userId.slice(0, 100) } : {}) };
}
async function bodyJson(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > LIMIT) throw Object.assign(new Error('Request exceeds 26 MB'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}
function validate(request) {
  const article = request?.article;
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(request?.id || '') || !article || typeof article.title !== 'string' || !article.title.trim() || article.title.length > 200 || typeof article.markdown !== 'string' || !article.markdown.trim() || article.markdown.length > LIMIT || article.cover !== undefined && (typeof article.cover !== 'string' || !/^(https?:\/\/|data:image\/)/.test(article.cover))) throw Object.assign(new Error('Invalid article or request ID'), { status: 400 });
  if (!Array.isArray(request.accounts) || !request.accounts.length || request.accounts.length > 3 || new Set(request.accounts.map(a => a?.id)).size !== request.accounts.length || request.accounts.some(a => !PLATFORMS.includes(a?.id) || typeof a.username !== 'string' || !a.username)) throw Object.assign(new Error('Select supported, identified browser accounts'), { status: 400 });
  // The article is produced by our compiler; reject active media/HTML sent by other clients.
  if (/<(?:script|iframe)\b/i.test(article.markdown)) throw Object.assign(new Error('Active content is unsupported'), { status: 400 });
}

/** Persistent jobs make POST idempotent and let mobile clients reconnect after network loss. */
export async function createPublishingService({ provider, token, dataDir, host = '127.0.0.1', port = 27123 }) {
  if (!token || token.length < 24) throw new Error('PUBLISHING_TOKEN must contain at least 24 characters');
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  let serverId;
  try { serverId = (await readFile(join(dataDir, 'server-id'), 'utf8')).trim(); }
  catch { serverId = randomUUID(); await writeFile(join(dataDir, 'server-id'), serverId, { mode: 0o600 }); }
  const jobs = new Map();
  const persist = async entry => {
    const path = join(dataDir, `${entry.job.id}.json`);
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(entry), { mode: 0o600 }); await rename(temporary, path);
  };
  for (const file of await readdir(dataDir)) if (/^[a-zA-Z0-9-]{8,80}\.json$/.test(file)) {
    const entry = JSON.parse(await readFile(join(dataDir, file), 'utf8'));
    if (entry.job.state === 'sending') {
      entry.job.results.forEach(result => { if (['sending', 'pending'].includes(result.state)) { result.state = 'unknown'; result.error = '服务曾中断，请检查平台草稿后再操作'; } });
      entry.job.state = 'complete'; await persist(entry);
    }
    jobs.set(entry.job.id, entry);
  }
  let busy = false;
  let operation = Promise.resolve();
  async function run(entry, request) {
    const results = entry.job.results;
    try {
      // Check all account identities before the first remote side effect.
      for (const expected of request.accounts) {
        const actual = account(await provider.call('check_auth', { platform: expected.id }), expected.id);
        if (!actual.isAuthenticated || actual.username !== expected.username || expected.userId && actual.userId !== expected.userId) {
          results.forEach(r => { r.state = 'failed'; r.error = '账号已变化或登录失效，请刷新账号后重试'; });
          return;
        }
      }
      for (const result of results) {
        const expected = request.accounts.find(a => a.id === result.platform);
        const actual = account(await provider.call('check_auth', { platform: result.platform }), result.platform);
        if (!actual.isAuthenticated || actual.username !== expected.username || expected.userId && actual.userId !== expected.userId) {
          result.state = 'failed'; result.error = '账号已变化或登录失效，请刷新账号后重试'; await persist(entry); continue;
        }
        result.state = 'sending'; await persist(entry);
        try {
          const raw = await provider.call('sync_article', { platforms: [result.platform], article: request.article });
          const list = Array.isArray(raw) ? raw : raw?.results;
          const item = Array.isArray(list) && list.find(r => r.platform === result.platform);
          if (!item || typeof item.success !== 'boolean') throw new Error('Missing platform result');
          if (item.success && item.draftOnly === true) {
            result.state = 'draft'; result.postUrl = safeUrl(item.postUrl); result.postId = typeof item.postId === 'string' ? item.postId.slice(0, 200) : undefined;
          } else if (!item.success) { result.state = 'failed'; result.error = '平台保存失败，请检查登录状态、正文及图片后重试'; }
          else { result.state = 'unknown'; result.error = '返回结果未确认保存为草稿，请打开平台核对'; }
        } catch { result.state = 'unknown'; result.error = '未收到确定结果，请检查平台草稿，勿直接重复发送'; }
        await persist(entry);
      }
    } catch {
      results.forEach(r => { if (r.state === 'pending') { r.state = 'failed'; r.error = '发送前检查失败，请重新测试连接'; } });
    } finally {
      entry.job.state = 'complete';
      try { await persist(entry); } finally { busy = false; }
    }
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
    try {
      if (!equalToken(req.headers.authorization, `Bearer ${token}`)) { send(401, { error: 'Access token is invalid' }); return; }
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/v1/status') {
        const state = await provider.call('status');
        send(200, { protocol: 'istart-publishing-v1', serverId, extensionConnected: state.extensionConnected === true }); return;
      }
      if (req.method === 'GET' && path === '/v1/platforms') {
        const raw = await provider.call('list_platforms');
        if (!Array.isArray(raw)) throw new Error('Invalid account response');
        send(200, PLATFORMS.map(id => account(raw.find(p => p.id === id), id))); return;
      }
      if (req.method === 'GET' && /^\/v1\/jobs\/[a-zA-Z0-9-]{8,80}$/.test(path)) {
        const entry = jobs.get(path.split('/').pop()); send(entry ? 200 : 404, entry ? entry.job : { error: 'Job not found; inspect platform drafts before sending again' }); return;
      }
      if (req.method === 'POST' && path === '/v1/jobs') {
        if (!req.headers['content-type']?.startsWith('application/json')) { send(415, { error: 'JSON required' }); return; }
        const request = await bodyJson(req); validate(request);
        const fingerprint = createHash('sha256').update(JSON.stringify({ article: request.article, accounts: request.accounts })).digest('hex');
        const existing = jobs.get(request.id);
        if (existing) { send(existing.fingerprint === fingerprint ? 200 : 409, existing.fingerprint === fingerprint ? existing.job : { error: 'Request ID already has different content' }); return; }
        if (busy) { send(409, { error: 'Another delivery is running; wait for completion' }); return; }
        busy = true;
        const job = { id: request.id, serverId, createdAt: new Date().toISOString(), state: 'sending', results: request.accounts.map(a => ({ platform: a.id, username: a.username, state: 'pending' })) };
        const entry = { job, fingerprint };
        try { await persist(entry); jobs.set(job.id, entry); }
        catch (error) { busy = false; throw error; }
        send(202, job);
        operation = run(entry, request).catch(() => { busy = false; }); return;
      }
      send(404, { error: 'Unknown endpoint' });
    } catch (error) { send(error.status || 503, { error: error.status ? error.message : 'Service unavailable; check connection and inspect existing job results' }); }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { server, serverId, async close() { await new Promise(resolve => server.close(resolve)); await operation; } };
}
