# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `src/core/llm/`: unified LLM client (`LLMClient`) and JSON extractor (`extractJson`, `parseJsonSafe`, `parseJsonStrict`) shared by every AI feature.
- `src/core/schema.ts`: `SCHEMA_VERSION` constant (starts at `1`) and `todayIso()` helper. All plugin-managed frontmatter now includes `schema_version: 1`.
- Bilingual documentation: `README.md`, `README.zh-CN.md`, `PRIVACY.md`, `PRIVACY.zh-CN.md`.
- `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, GitHub issue and pull request templates.
- `.github/workflows/ci.yml`: type-check and build on push/PR.
- `.github/dependabot.yml`: weekly npm and monthly GitHub Actions updates.
- Conflict-safe file creation in `VaultWriter` and the AI assistant's concept-page flow (auto-suffixes `-2`, `-3`, ... when paths collide).
- **Concept page completion** actions wired into the command panel:
  - "补全当前概念页" — opens depth select → AI completion → preview → write.
  - "扫描并补全空概念页" — batch scan → select → sequential completion.
- **Knowledge Q&A with question graph** action:
  - "知识提问" — ask → auto-classify (new/refinement/expansion) → user confirm → generate Q&A → attach classification frontmatter → update question index → append recommended follow-ups → rebuild Mermaid evolution graph.
- **Vault-aware Q&A** action ("知识库问答"):
  - Searches the in-memory vault index for related notes, builds a context window from up to 8 relevant entries, sends to the LLM with instructions to cite `[[sources]]`, and renders the answer with a "依据来源" section.
- `src/core/knowledge/KnowledgeIndexService.ts` — in-memory vault index built from metadataCache. Rebuilt on load, incrementally updated on file change/delete/rename. Three-layer scoring: exact match → structural (links/backlinks/domain) → keyword substring. No embedding, no external DB.
- `src/core/execution/` — ExecutionPlan infrastructure:
  - `types.ts`: `VaultOperation` union (create-file, modify-file, append-section, replace-selection, move-file, create-link, update-frontmatter), `ExecutionPlan`, `ExecutionRecord`.
  - `PlanBuilder.ts`: fluent builder with automatic risk assessment and preview markdown generation.
  - `PlanExecutor.ts`: applies plans to the vault and persists execution logs under `Knowledge/_Executions/`.

### Changed
- All nine LLM call sites (`AIAssistant`, `DeepSeekClient`, `QuestionClassifier`, `ConceptCompleter`, `ContextQAClient`, `ReadingPlanner`, `SectionAppender`, `DiagramGenerator`, `SmartCompleter`) now go through `LLMClient` and `extractJson`.
- `tsconfig.json`: enabled full strict mode (`strict: true`) and scoped `include` to `src/**/*.ts`.
- `package.json`: pinned `obsidian` to `^1.7.2` (was `latest`), added `homepage`, `repository`, `bugs`, `keywords`, and `author` fields, added `typecheck`, `test`, and `ci` scripts.
- Release workflow uses `npm ci` instead of `npm install` for reproducible builds.
- Action definitions now use appropriate groups (`concept`, `reading`, `sync`, `document`) instead of all being `general`.

### Removed
- Stale committed `main.js` build artifact at the repository root. The runtime bundle is now produced into `dist/` only and shipped exclusively via GitHub Releases.

## Older versions

Historical entries prior to this changelog were not maintained. See [the versions.json](./versions.json) for the version-to-minimum-Obsidian map and the [GitHub Releases page](https://github.com/yan-istart/IStart-Note-AI-Plugin/releases) for prior release notes.
