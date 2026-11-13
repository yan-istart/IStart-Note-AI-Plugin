import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ExtensionBridge } from './bridge.mjs';

async function main() {
const bridge = new ExtensionBridge({ token: process.env.EXTENSION_TOKEN, host: process.env.BRIDGE_HOST || '127.0.0.1', port: Number(process.env.BRIDGE_PORT || 27125) });
await bridge.start();
const server = new Server({ name: 'istart-wechatsync', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: 'status', description: 'Bridge status', inputSchema: { type: 'object' } },
  { name: 'list_platforms', description: 'Browser accounts', inputSchema: { type: 'object' } },
  { name: 'check_auth', description: 'Platform login', inputSchema: { type: 'object', properties: { platform: { type: 'string' } }, required: ['platform'] } },
  { name: 'sync_article', description: 'Save article drafts', inputSchema: { type: 'object', properties: { platforms: { type: 'array', items: { type: 'string' } }, article: { type: 'object' } }, required: ['platforms', 'article'] } },
] }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  const { name, arguments: args = {} } = request.params;
  try {
    let result;
    if (name === 'status') result = { extensionConnected: bridge.connected };
    else if (name === 'list_platforms') result = await bridge.request('listPlatforms', { forceRefresh: true });
    else if (name === 'check_auth') result = await bridge.request('checkAuth', { platform: args.platform });
    else if (name === 'sync_article') result = await bridge.request('syncArticle', { platforms: args.platforms, article: args.article });
    else throw new Error('Unsupported tool');
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch {
    // Never send token-bearing upstream errors or raw HTML into logs/records.
    return { isError: true, content: [{ type: 'text', text: 'Bridge request failed; check browser connection and platform drafts.' }] };
  }
});
await server.connect(new StdioServerTransport());
let closing = false;
async function close() { if (closing) return; closing = true; await bridge.close(); await server.close(); process.exit(0); }
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
process.stdin.once('end', () => void close());
}
main().catch(() => { console.error('MCP bridge could not start; check extension port and token'); process.exit(1); });
