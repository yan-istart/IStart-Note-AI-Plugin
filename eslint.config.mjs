import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import importPlugin from "eslint-plugin-import";

// Rules reported by the community plugin scorecard, also enforced locally and in CI.
export default [
  { ignores: ["dist/**", "node_modules/**", "**/*.test.ts", "tests/**"] },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: "./tsconfig.json", tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "@typescript-eslint": tseslint.plugin, obsidianmd, import: importPlugin },
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-this-alias": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-useless-escape": "error",
      "no-control-regex": "error",
      "prefer-promise-reject-errors": "error",
      "no-restricted-globals": ["error", { name: "fetch", message: "Use Obsidian requestUrl; streaming requires a documented exception." }],
      "obsidianmd/prefer-create-el": "error",
      "obsidianmd/prefer-instanceof": "error",
      "obsidianmd/settings-tab/prefer-setting-definitions": "error",
      // Obsidian and CodeMirror are supplied by the host and declared for development.
      "import/no-extraneous-dependencies": ["error", { devDependencies: true }],
    },
  },
];
