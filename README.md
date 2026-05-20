# IStart-Note-AI

<p align="center">
  <strong>Turn your Obsidian vault into a knowledge-to-action system.</strong>
</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#privacy">Privacy</a> ·
  <a href="#roadmap">Roadmap</a>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/github/v/release/yan-istart/IStart-Note-AI-Plugin?include_prereleases">
  <img alt="License" src="https://img.shields.io/github/license/yan-istart/IStart-Note-AI-Plugin">
  <img alt="CI" src="https://img.shields.io/github/actions/workflow/status/yan-istart/IStart-Note-AI-Plugin/ci.yml?branch=main">
  <img alt="Obsidian" src="https://img.shields.io/badge/Obsidian-1.7.2%2B-7C3AED">
</p>

---

IStart-Note-AI is an Obsidian plugin built around three modules — **Knowledge**, **Execution**, and **Auxiliary** — that help you turn scattered notes into a searchable, interlinked, and actionable personal knowledge system.

One unified AI entry point connects all three: ask questions, generate structured notes, build execution plans, and keep everything synced — all through natural language.

> [!warning] Beta
> v2.0.0 introduces significant architectural changes. The frontmatter schema and scheduled-task model are not yet stable. Back up your vault before upgrading.

---

## Core Modules

### 1. Knowledge

Build and maintain a structured knowledge base.

- **Ask questions** and generate Q&A notes with automatic concept extraction.
- **Classify questions** into new / refinement / expansion and maintain a question evolution graph.
- **Create and complete concept pages** with definitions, examples, relations, and domain MOC indexes.
- **Build reading projects** — generate a book skeleton, chapter pre-reading questions, summaries, and Feynman tests.
- **Search your vault** and get answers with `[[source]]` references (metadata-based index, no embeddings).
- **Detect knowledge debt** — empty concepts, orphan questions, unfinished readings, stale drafts.

### 2. Execution

Turn knowledge into reviewable actions.

- **Execution plan data model** — PlanBuilder + PlanExecutor + PlanDraftStore for multi-op vault changes.
- **Execution logs** recorded under `Knowledge/_Executions/` after each plan is applied.
- **Plan drafts** stored under `Knowledge/_ExecutionPlans/` for `create-plan-only` tasks (user reviews before applying).
- **Scheduler foundation** — ScheduledTask types and runner exist; runtime is disabled by default in v2.0 (enabled in v2.1).
- **Safety by default** — `create-plan-only` never auto-executes; `auto-execute-low-risk` only applies plans with `riskLevel: "low"`.
- Most AI write flows (assistant, beautify, concept completion) still use direct editor writes; migration to plan-first is in progress.
- Future: diff preview, rollback, batch-op caps, task-plugin integrations.

### 3. Auxiliary

Keep the system usable across devices and providers.

- **OpenAI-compatible LLM provider** — DeepSeek default; change Base URL for others.
- **Configurable output styles** — knowledge-base, technical, minimal, product, academic, story, dashboard.
- **Optional Baidu Cloud sync** — incremental backup, bidirectional sync, plugin and Obsidian config backup.
- **Diagnostics** — privacy overview, config export, index rebuild, log cleanup.

---

## Status

| Module | Feature | Status | Notes |
| --- | --- | --- | --- |
| Knowledge | AI Assistant | Stable | Insert / replace / append / show via unified entry |
| Knowledge | Reading Projects | Stable | Skeleton, chapter questions, summaries, Feynman |
| Knowledge | Concept Completion | Experimental | Exposed in command panel, preview before write |
| Knowledge | Question Graph | Experimental | Classification + index + Mermaid evolution graph |
| Knowledge | Vault QA | Experimental | Metadata-index retrieval, cited answers, no embeddings |
| Knowledge | Knowledge Debt | Experimental | Dashboard with empty/orphan/unfinished/stale stats |
| Execution | Execution Plan | Experimental | PlanBuilder + PlanExecutor + PlanDraftStore, no rollback yet |
| Execution | Execution Artifact Builder | Experimental | Generic checklist/routine/SOP/plan/review generator from any knowledge context |
| Execution | Scheduled Tasks | Foundation | Types + runner exist; runtime disabled by default in v2.0 |
| Auxiliary | Baidu Sync | Stable | Manual/auto backup and config sync |
| Auxiliary | Multi-provider LLM | Partial | OpenAI-compatible base URL supported |

---

## Quick Start

1. Install the plugin (see [Installation](#installation)).
2. Go to **Settings → IStart-Note-AI → Auxiliary → AI Service** and enter your API key.
3. Click the 🧠 ribbon icon or press the command palette → **IStart-Note-AI: AI 助手**.
4. Type a request in natural language.

---

## Installation

### From community plugins (once available)

1. Settings → Community plugins → Browse.
2. Search **IStart-Note-AI**.
3. Install → Enable.

### Manual (recommended during beta)

Download `main.js`, `manifest.json`, `styles.css` from a [GitHub Release](https://github.com/yan-istart/IStart-Note-AI-Plugin/releases) and place them in `<vault>/.obsidian/plugins/istart-note-ai/`.

> Don't clone the source repo — the bundle lives in `dist/` and is not committed. Use release assets.

### Build from source

```bash
npm ci
npm run build
# → dist/main.js, dist/manifest.json, dist/styles.css
```

---

## Configuration

Settings are organized into three tabs:

| Tab | Key settings |
| --- | --- |
| **Knowledge** | Q&A path, Concepts path, Questions index path, knowledge index status + rebuild |
| **Execution** | Execution log path (read-only), scheduled tasks status (v2.1) |
| **Auxiliary** | API key, Base URL, model, output style, Baidu sync (App ID/Secret, remote path, auto-backup) |

---

## Usage

### Desktop

- 🧠 **Ribbon icon** → command panel (Knowledge / Execution / Auxiliary).
- **Right-click in editor** → `IStart-Note-AI: AI 助手` or `知识库问答`.
- **Right-click file** → `IStart-Note-AI: AI 助手`.

### Mobile

- 🧠 **Ribbon icon** → command panel.
- Add commands to the mobile toolbar for one-tap access.

---

## Architecture

```
src/
  core/
    llm/              Unified LLM client + JSON extractor
    knowledge/        KnowledgeIndexService (metadata index)
    execution/        ExecutionPlan, PlanBuilder, PlanExecutor, PlanDraftStore
    artifact/         ExecutionArtifact types, prompt, validation, rendering
    scheduler/        ScheduledTask types + runner (disabled in v2.0)
    schema.ts         SCHEMA_VERSION + helpers
  ai/                 AI feature modules (assistant, classifier, planner, ...)
  features/
    assistant/        AI assistant modals
    artifact/         Artifact builder, preview, feature controller
    concept/          Concept completion + page manager
    question/         Question classify + graph manager
    reading/          Reading project manager
    dashboard/        Knowledge debt modal
    sync/             Baidu sync
    command-panel/    Unified command panel
  vault/              Vault writer (conflict-safe)
  settings/           Settings tab (tabbed layout)
  actions/            Action registry + definitions
  main.ts
```

---

## Privacy

AI features send your selection and partial note context to the configured chat-completions endpoint. Sync features upload to your own Baidu Pan. No telemetry. No plugin-operated servers. Full details in [PRIVACY.md](./PRIVACY.md).

---

## Roadmap

### v2.0 — Knowledge System Foundation (current)

- Three-module product structure: Knowledge / Execution / Auxiliary.
- Vault-wide lightweight knowledge index.
- Concept completion and question graph in command panel.
- Knowledge debt dashboard.
- Basic execution plan and execution logs.
- Settings page with tabbed navigation.
- Open-source governance and privacy docs.

### v2.1 — Execution MVP

- Scheduled tasks runtime (knowledge-debt scan, auto-backup).
- Execution plan preview modal with diff.
- Safer policy: AI writes always produce plan-only by default.
- Execution history view.

### v2.2 — Trust & Control

- Rollback for recent executions.
- More granular privacy controls.
- Optional local vector index for richer vault QA.

### v3.0 — Integrations

- Tasks plugin / Periodic Notes integration.
- GitHub Issues / Linear / Todoist export.
- Multi-vault support.

---

## Contributing

PRs and issues welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md). Security issues: [SECURITY.md](./SECURITY.md).

## License

MIT. See [LICENSE](./LICENSE).
