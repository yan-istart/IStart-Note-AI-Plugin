import obsidianmd from "eslint-plugin-obsidianmd";

// Official Obsidian recommended checks, including manifest/package/license checks.
// The companion service runs in Node, separately from the Obsidian plugin runtime.
export default [
  { ignores: ["node_modules/**", "dist/**", "**/*.test.*", "tests/**", "scripts/**", "service/**", "**/*.mjs", "**/*.mts"] },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: { parserOptions: { project: "./tsconfig.json", tsconfigRootDir: import.meta.dirname } },
  },
];
