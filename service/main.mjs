import { dirname, join } from 'node:path';
import { McpProvider } from './provider.mjs';
import { createPublishingService } from './server.mjs';

async function main() {
const provider = new McpProvider();
// Bundled release files are placed next to each other; source mode uses .mjs.
const directory = dirname(process.argv[1]);
const worker = join(directory, process.argv[1].endsWith('.cjs') ? 'publishing-mcp.cjs' : 'mcp-worker.mjs');
await provider.start(worker);
const service = await createPublishingService({ provider, token: process.env.PUBLISHING_TOKEN, dataDir: process.env.PUBLISHING_DATA || join(directory, 'jobs'), host: process.env.PUBLISHING_HOST || '127.0.0.1', port: Number(process.env.PUBLISHING_PORT || 27123) });
console.log('ISTART_PUBLISHING_READY');
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  const timer = setTimeout(() => process.exit(1), 5000);
  // Close the worker first: outstanding deliveries become unknown, never auto-retried.
  await provider.close(); await service.close(); clearTimeout(timer); process.exit(0);
}
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
}
main().catch(() => { console.error('Publishing service could not start; check ports, Node version and tokens'); process.exit(1); });
