import obsidianQuality from "./eslint.obsidian.config.mjs";

// The official Obsidian recommended rules plus the project's stricter source checks.
export default [
  ...obsidianQuality,
  {
    files: ["src/**/*.ts"],
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
      "obsidianmd/prefer-create-el": "error",
      "obsidianmd/prefer-instanceof": "error",
      "obsidianmd/settings-tab/prefer-setting-definitions": "error",
      // Obsidian and CodeMirror are supplied by the host and declared for development.
      "import/no-extraneous-dependencies": ["error", { devDependencies: true }],
    },
  },
];
