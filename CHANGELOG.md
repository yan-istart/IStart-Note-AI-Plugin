# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Resolve community scorecard warnings: load ES2019 library types, validate untrusted Agent/import data, type Git filesystem calls, use Obsidian DOM helpers and cross-window checks, and remove unnecessary assertions, escapes, unused code, and CSS `!important`.
- Make settings sections discoverable through Obsidian 1.13+ settings search while retaining the existing settings UI on older versions. Keep realtime SSE streaming with a documented, single-line `fetch` lint exception and the existing `requestUrl` fallback.
- Preserve the repository manifest in builds and publish release assets only through CI, using the committed lockfile, Node.js 22, and artifact attestations. Use an English root README with the complete Chinese guide in `README.zh-CN.md`.
- Add community scorecard lint checks to local/CI validation and update development dependencies with a vulnerability-free lockfile.

### Added
- Complete Agent migration for document beautification, readonly proofreading with durable source locations, knowledge-debt statistics, existing annotation rewriting/suggestions, and manuscript classification/analysis. Remove the separate All features panel; keep existing command IDs as assistant aliases and provide inline task shortcuts.
- Copy messages, tool results, role turns, complete previews and entire conversations; preserve text selection while streaming. Stable editor snapshots and an inline source-position picker keep insertion usable after switching focus, including inserting an existing answer at an explicitly chosen location.
- AI typo checking for the current note or selection, with a right-sidebar original/correction list, verified source positions, click-to-select navigation, chunked long-note checking, cancellation, and stale-result protection. Available in the command palette, editor menu, and Agent shortcuts; suggestions do not modify notes.
- Durable Agent task continuation from saved tool checkpoints, with explicit Continue versus Regenerate actions, restored source/project snapshots, and protection when source content or execution scope changes. Completed tool steps and drafts are reused after interruption.
- Cross-turn draft revision and coalesced shared-index changes; full reading project continuation with preserved handwritten questions and progress; shared Mermaid question graph rendering; paged long-note reads; and template-plus-daily-run previews with usage/evidence options.
- Persistent multi-session Agent sidebar with independent drafts, explicit references, Ask / Agent modes, bounded tool execution, source citations, previewed changes, cancellation, retry, branching, searchable/pinned/archived conversations, and Markdown export. Reuses existing AI generators and can continue quick-dialog results in the sidebar.
- Multi-turn LLM transport, opt-in SSE with CORS fallback, fixed per-turn skills, conversation summaries, conflict-safe and idempotent writes, interrupted-task recovery, opt-in credential-free shared history, and regression coverage.
- Sidebar annotations: turn selections into `==highlights==` with inline `^[...]` or footnote `[^n]` comments, browse current-note or whole-vault highlights, comments and `%%Obsidian comments%%` from a right-sidebar view, click to jump back to the source, and search/filter/edit/copy/remove entries. Annotations use plain Markdown and remain readable without the plugin.
- AI annotation drafting from a selection plus nearby context, with an editable preview before anything is written.
- AI suggestions for an existing annotation: analyze the highlighted text, current comment and nearby context, preview Markdown suggestions, and optionally append them to the annotation. Editing preserves the original highlight and inline/footnote/Obsidian-comment format, including shared footnote handling.
- Mobile annotation layout with larger touch targets, always-visible card menus, long-press actions, keyboard-safe dialog, and optional automatic sidebar collapse after jumping to the source. New settings tab for default comment style and mobile behavior.
- Writing skills: discover standard Agent Skills from `Skills/` and `.agents/skills`, parse `SKILL.md` metadata, and automatically attach global craft rules, genre guidance, and the current work's rules to writing AI requests. Includes a shared runtime injection in `LLMClient`, project detection via `_作品.md`, per-skill enable switches, token limits, and a new Skill settings tab.
- Floating editor toolbar: a CodeMirror 6 ViewPlugin shows actions for the current selection, filters them through the existing action conditions, and exposes a full command-panel fallback. Optional idle cursor trigger, desktop defaults, mobile opt-in, multi-cursor/IME/scroll handling, and an Interface settings tab.
- Codex/OpenCode-compatible skill examples and documentation under `examples/skills/` and `docs/skills.md`.
- Baidu Pan Git synchronization with a shared desktop/mobile JavaScript engine, immutable full/incremental Git bundles, three-way text merging, conflict resolution, commit history, and per-file restore.
- Whole-vault version browsing with complete file lists, change summaries, scope counts, and project-wide restore previews. Restores preserve current changes in history, create a forward commit, and recover through the existing journal after interruption.
- Opt-in foreground Git auto-sync and startup configuration pull, both disabled by default. Existing installations keep file sync until manually switched.
- Durable interrupted-sync recovery, protection for edits during transfer, and Vitest coverage including native Git bundle compatibility and a browser runtime without Node globals.
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
- Agent response parsing tolerates literal newlines inside JSON strings and redundant closing braces, preserves embedded Markdown code fences, and limits format correction to two retries without consuming tool steps. Tool arguments and mode permissions remain validated.
- Generation actions now launch existing Agent tools directly from the feature panel, commands, editor menus, floating toolbar, and writing status bar. Shared inline task cards replace separate parameter flows for projects, questions, templates, and writing settings; previews, follow-up draft revisions, regeneration, and interrupted-task recovery stay in the conversation.
- Consolidated the panel, AI assistant, annotations, and sync ribbon entries into one IStart workbench. Assistant/Agent, annotations, and sync share one sidebar with persistent navigation; duplicate legacy sidebars are merged while existing commands and hotkeys remain available.
- Renamed the synchronization feature to IStart Data Sync, with a dedicated settings tab separating shared sync options from Baidu Pan storage configuration. Existing saved settings, credentials, command IDs, and workspace views remain compatible.
- The Baidu sync sidebar shows the active synchronization mode and refreshes immediately when sync settings change, including switching between file and Git modes.
- Git sync preserves existing special-character filenames instead of applying Windows filename restrictions to every device. Windows checks incompatible names before applying any note changes.
- Baidu directory traversal now paginates; Git operations fail on listing errors instead of treating an unavailable cloud as empty. File sync excludes the separate Git bundle directory.
- Remote configuration never enables local automatic behavior.
- All nine LLM call sites (`AIAssistant`, `DeepSeekClient`, `QuestionClassifier`, `ConceptCompleter`, `ContextQAClient`, `ReadingPlanner`, `SectionAppender`, `DiagramGenerator`, `SmartCompleter`) now go through `LLMClient` and `extractJson`.
- `tsconfig.json`: enabled full strict mode (`strict: true`) and scoped `include` to `src/**/*.ts`.
- `package.json`: pinned `obsidian` to `^1.7.2` (was `latest`), added `homepage`, `repository`, `bugs`, `keywords`, and `author` fields, added `typecheck`, `test`, and `ci` scripts.
- Release workflow uses `npm ci` instead of `npm install` for reproducible builds.
- Action definitions now use appropriate groups (`concept`, `reading`, `sync`, `document`) instead of all being `general`.

### Removed
- Stale committed `main.js` build artifact at the repository root. The runtime bundle is now produced into `dist/` only and shipped exclusively via GitHub Releases.

## Older versions

Historical entries prior to this changelog were not maintained. See [the versions.json](./versions.json) for the version-to-minimum-Obsidian map and the [GitHub Releases page](https://github.com/yan-istart/IStart-Note-AI-Plugin/releases) for prior release notes.
