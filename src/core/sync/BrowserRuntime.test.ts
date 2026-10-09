import { expect, it } from "vitest";
import { build } from "esbuild";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runInNewContext } from "vm";
import type { GitSyncEngine } from "./GitSyncEngine";

it("runs the browser bundle without Node globals or external builtins", async () => {
  const bundled = await build({
    entryPoints: [join(process.cwd(), "src/core/sync/GitSyncEngine.ts")],
    inject: [join(process.cwd(), "src/core/sync/browserBuffer.ts")],
    bundle: true, platform: "browser", format: "iife", globalName: "GitSync", write: false,
    target: "es2018", metafile: true,
  });
  expect(Object.values(bundled.metafile!.outputs).every((output) => output.imports.length === 0)).toBe(true);
  const sandbox: Record<string, unknown> = { TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, setTimeout, clearTimeout };
  runInNewContext(bundled.outputFiles[0].text, sandbox);
  expect(sandbox.require).toBeUndefined();
  expect(sandbox.process).toBeUndefined();
  expect(sandbox.Buffer).toBeUndefined();
  const BrowserGit = (sandbox.GitSync as { GitSyncEngine: typeof GitSyncEngine }).GitSyncEngine;
  const dir = await fs.mkdtemp(join(tmpdir(), "istart-browser-"));
  try {
    const a = new BrowserGit({ promises: fs }, join(dir, "a"));
    const b = new BrowserGit({ promises: fs }, join(dir, "b"));
    await a.initialize(); await b.initialize();
    await a.snapshot(new Map([["笔记.md", new TextEncoder().encode("手机端版本\n")]]));
    const head = await a.head();
    expect(await b.importBundle(await a.bundle(head), head)).toBe(true);
    await b.setHead(head);
    expect(new TextDecoder().decode(await b.restoreFile("笔记.md", head))).toBe("手机端版本\n");
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
