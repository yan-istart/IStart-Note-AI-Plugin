import { expect, it } from "vitest";
import { build } from "esbuild";

it("bundles the complete plugin for browsers without Node builtins or companion service code", async () => {
  const bundled = await build({
    entryPoints: ["src/main.ts"],
    inject: ["src/core/sync/browserBuffer.ts"],
    bundle: true, platform: "browser", format: "cjs", write: false,
    external: ["obsidian", "@codemirror/*", "@lezer/*"],
    target: "es2018", metafile: true,
  });
  const imports = Object.values(bundled.metafile!.outputs).flatMap(output => output.imports.map(item => item.path));
  expect(imports.every(path => path === "obsidian" || path.startsWith("@codemirror/") || path.startsWith("@lezer/"))).toBe(true);
  expect(Object.keys(bundled.metafile!.inputs).some(path => path.startsWith("service/"))).toBe(false);
  expect(bundled.outputFiles[0].text).not.toMatch(/ISTART_PUBLISHING_(GATEWAY|WORKER)/);
});
