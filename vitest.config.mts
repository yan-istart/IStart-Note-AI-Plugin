import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

export default defineConfig({
  resolve: { alias: { obsidian: fileURLToPath(new URL("./tests/obsidian.ts", import.meta.url)) } },
});
