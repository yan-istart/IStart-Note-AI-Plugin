import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { zipSync, strToU8 } from 'fflate';

const NODE_PTY = 'node_modules/@homebridge/node-pty-prebuilt-multiarch';
const PREFIX = 'node_modules/@homebridge/node-pty-prebuilt-multiarch/';

async function licenses(metafile) {
  const packages = new Map();
  for (const input of Object.keys(metafile.inputs).filter(path => path.startsWith('node_modules/'))) {
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
    for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md']) {
      try { license = await readFile(join(directory, file), 'utf8'); break; } catch { /* Try the next conventional name. */ }
    }
    if (!license) throw new Error(`License text missing for bundled ${meta.name}`);
    notices.push(`${meta.name} ${meta.version}\n${license}`);
  }
  // node-pty ships as an external package folder next to the bundle.
  const ptyMeta = JSON.parse(await readFile(join(NODE_PTY, 'package.json'), 'utf8'));
  const ptyLicense = await readFile(join(NODE_PTY, 'LICENSE'), 'utf8');
  notices.push(`${ptyMeta.name} ${ptyMeta.version}\n${ptyLicense}`);
  return notices.join('\n\n----------------------------------------\n\n');
}

export async function buildTerminalServiceRuntime() {
  const version = JSON.parse(await readFile('manifest.json', 'utf8')).version;
  const bundle = await build({
    entryPoints: ['service/terminal.mjs'],
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', write: false, minify: true,
    logLevel: 'warning', metafile: true,
    external: ['@homebridge/node-pty-prebuilt-multiarch', 'bufferutil', 'utf-8-validate'],
    define: { ISTART_TERMINAL_VERSION: JSON.stringify(version) },
  });
  const notices = await licenses(bundle.metafile);
  const banner = `/* Third-party terminal service licenses\n${notices.replace(/\*\//g, '* /')}\n*/\n`;
  const code = banner + bundle.outputFiles[0].text;
  return { code, notices, version };
}

/** Include node-pty's runtime files (JS + per-platform prebuilds) in the deploy zip. */
async function packageNodePty(entries) {
  const addFile = async (relative, base = NODE_PTY) => {
    const full = join(base, ...relative.split('/'));
    entries[PREFIX + relative] = new Uint8Array(await readFile(full));
  };
  await addFile('package.json');
  await addFile('LICENSE');
  const walk = async (dir, prefix) => {
    for (const entry of await readdir(join(dir, prefix), { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await walk(dir, `${relative}/`);
      else if (!entry.name.endsWith('.pdb')) await addFile(relative, dir);
    }
  };
  await walk(NODE_PTY, 'lib/');
  await walk(NODE_PTY, 'prebuilds/');
}

export async function writeTerminalServiceAssets() {
  const { code, notices, version } = await buildTerminalServiceRuntime();
  await mkdir('dist', { recursive: true });
  const entries = {
    'terminal-service.cjs': strToU8(code),
    'TERMINAL_SERVICE_NOTICES.txt': strToU8(notices),
  };
  await packageNodePty(entries);
  const zip = zipSync(entries, { level: 6 });
  const zipPath = `dist/terminal-service-${version}.zip`;
  await writeFile(zipPath, zip);
  await writeFile('dist/TERMINAL_SERVICE_NOTICES.txt', notices);
  const sizeKB = Math.round((await stat(zipPath)).size / 1024);
  console.log(`Terminal service built: ${zipPath} (${sizeKB} KB)`);
}

if (process.argv.includes('--write')) {
  await writeTerminalServiceAssets();
}
