import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

export default defineConfig({
  test: { exclude: [...configDefaults.exclude, "service/**"] },
  resolve: { alias: { obsidian: fileURLToPath(new URL("./tests/obsidian.ts", import.meta.url)) } },
});
