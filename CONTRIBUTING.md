# Contributing to IStart-Note-AI

Thanks for your interest in improving IStart-Note-AI. This document covers how to set up the project, the conventions we follow, and how to send a change.

## Setup

```bash
git clone https://github.com/yan-istart/IStart-Note-AI-Plugin.git
cd IStart-Note-AI-Plugin
npm ci
```

Always use `npm ci` rather than `npm install` so the lockfile is respected and builds are reproducible.

## Common commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Watch mode build to `dist/` |
| `npm run typecheck` | Run `tsc --noEmit` against `tsconfig.json` (strict mode) |
| `npm run build` | Type-check, then production build to `dist/` |
| `npm run ci` | Full type-check + build (mirrors GitHub Actions) |
| `npm run release` | Interactive release (build, tag, GitHub release) — maintainers only |
| `npm run submit` | Helper for submitting to community plugin store |

To run the plugin locally, symlink or copy `dist/` into your test vault's `.obsidian/plugins/istart-note-ai/` folder, then enable the plugin in Obsidian.

## Project layout

```
src/
  core/           # cross-feature infrastructure (LLM client, future vault index, ...)
  ai/             # AI feature modules (assistant, classifier, planner, ...)
  features/       # UI and per-feature managers
  vault/          # vault read/write helpers
  settings/
  actions/        # unified action registry + command panel
  main.ts
```

### Working with the LLM

All AI features must use `src/core/llm/LLMClient.ts` instead of calling `requestUrl` directly:

```typescript
import { LLMClient, parseJsonSafe } from "../core/llm";

const llm = new LLMClient(settings);
const raw = await llm.chat({ userPrompt: prompt, temperature: 0.5 });
const parsed = parseJsonSafe<MyShape>(raw, defaultShape);
```

This keeps error handling, header construction, and provider-swapping in one place.

### Vault writes

Use `VaultWriter` for the standard QA / context-QA / concept patterns. When you need a unique file path, use `VaultWriter`'s conflict-safe helper rather than calling `app.vault.create` directly.

When introducing new file types, plan for migration: include `schema_version` in the frontmatter and document the schema in the PR.

## Coding conventions

- TypeScript strict mode is on. New code must pass `npm run typecheck` without `any` (use proper types or `unknown` + narrowing).
- Avoid `console.log` in shipped code. Use `Notice` for user-visible messages.
- Keep modules small and single-purpose. Cross-feature utilities live in `src/core/`.
- Mirror existing language usage. UI strings are Chinese; code comments are mixed Chinese/English. Pick whichever fits the surrounding code.
- Prefer pure functions in `core/` and side-effect-bearing classes (modal, manager, ...) in `features/`.

## Testing

A formal test framework is not wired in yet. The `npm test` script is a placeholder so CI passes. When you add tests, use [vitest](https://vitest.dev) and put them next to the unit under test as `*.test.ts`. We will switch the placeholder script over once the first tests land.

If your change is non-trivial, please describe how you manually verified it in the PR description.

## Pull requests

1. Fork the repo and create a topic branch (`feat/...`, `fix/...`, `docs/...`).
2. Run `npm run ci` locally — PRs failing CI are not reviewed.
3. Keep PRs focused. Unrelated cleanups belong in separate PRs.
4. Update [CHANGELOG.md](./CHANGELOG.md) under the "Unreleased" section.
5. If your change affects user data — frontmatter, vault paths, sync layout — mention migration impact in the PR description.

## Releasing (maintainers)

Releases are tag-driven. Pushing a tag triggers `.github/workflows/release.yml`, which builds `dist/` and creates a draft release.

Recommended flow:

```bash
npm run release        # interactive: bump version, build, tag, push, draft release
```

The release workflow uses `npm ci`, so any change that requires a new lockfile must be committed first.

## Reporting bugs

Open an issue with:

- Obsidian version, plugin version, OS.
- Reproduction steps. A short snippet of the affected note (with secrets removed) helps a lot.
- Anything visible in the developer console (`Ctrl/Cmd+Shift+I` → Console).

For security issues, follow [SECURITY.md](./SECURITY.md) instead.

## Code of conduct

Be respectful. Stay on topic. Disagreements about technical direction are fine; personal attacks aren't.
