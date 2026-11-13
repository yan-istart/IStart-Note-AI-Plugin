import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export class McpProvider {
  async start(workerPath) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string'));
    this.transport = new StdioClientTransport({ command: process.execPath, args: [workerPath], env, stderr: 'pipe' });
    // Consume stderr without recording secrets or unbounded output.
    this.transport.stderr?.on('data', () => {});
    this.client = new Client({ name: 'istart-publishing', version: '1.0.0' });
    await this.client.connect(this.transport);
  }
  async call(name, args = {}) {
    const response = await this.client.callTool({ name, arguments: args }, undefined, { timeout: 390000 });
    if (response.isError) throw new Error('MCP request failed; check extension and platform drafts');
    const block = response.content?.find(item => item.type === 'text');
    if (!block) throw new Error('Invalid MCP response');
    return JSON.parse(block.text);
  }
  async close() { await this.client?.close(); }
}
