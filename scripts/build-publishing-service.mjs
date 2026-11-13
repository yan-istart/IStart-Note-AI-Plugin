import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';

async function licenses(inputs) {
  const packages = new Map();
  for (const input of inputs.filter(path => path.startsWith('node_modules/'))) {
    let directory = resolve(dirname(input));
    while (directory.includes('node_modules')) {
      try {
        const meta = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
        if (meta.name && meta.version) { packages.set(directory, meta); break; }
      } catch { /* Continue to the owning package. */ }
      directory = dirname(directory);
    }
  }
  const notices = [];
  for (const [directory, meta] of packages) {
    let license;
    for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md', 'LICENSE-MIT', 'License']) {
      try { license = await readFile(join(directory, file), 'utf8'); break; } catch { /* Try the next conventional name. */ }
    }
    if (!license) throw new Error(`License text missing for bundled ${meta.name}`);
    notices.push(`${meta.name} ${meta.version}\n${license}`);
  }
  return notices.join('\n\n----------------------------------------\n\n');
}

export async function buildPublishingRuntime() {
  const options = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', write: false,
    external: ['bufferutil', 'utf-8-validate'], minify: true, logLevel: 'warning', metafile: true };
  const gateway = await build({ ...options, entryPoints: ['service/main.mjs'] });
  const worker = await build({ ...options, entryPoints: ['service/mcp-worker.mjs'] });
  const notices = await licenses([...new Set([...Object.keys(gateway.metafile.inputs), ...Object.keys(worker.metafile.inputs)])]);
  const banner = `/* Third-party publishing runtime licenses\n${notices.replace(/\*\//g, '* /')}\n*/\n`;
  return { gateway: banner + gateway.outputFiles[0].text, worker: banner + worker.outputFiles[0].text, notices };
}
if (process.argv.includes('--write')) {
  const runtime = await buildPublishingRuntime();
  await mkdir('dist', { recursive: true });
  await writeFile('dist/publishing-service.cjs', runtime.gateway);
  await writeFile('dist/publishing-mcp.cjs', runtime.worker);
  await writeFile('dist/THIRD_PARTY_PUBLISHING_NOTICES.txt', runtime.notices);
}
