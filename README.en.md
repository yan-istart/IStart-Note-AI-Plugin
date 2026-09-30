# IStart-Note-AI

<p align="center">
  <strong>Turn your Obsidian vault into a personal knowledge system and writing studio.</strong>
</p>

<p align="center">
  <a href="./README.md">简体中文</a> ·
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

IStart-Note-AI is an Obsidian plugin built around three business scenarios: **Knowledge** (read in), **Writing** (write out), and **Auxiliary** (cross-device support).

- Knowledge: turn scattered notes into a searchable, interlinked knowledge system
- Writing: turn ideas into works — web novels, papers, long-form articles
- Auxiliary: multi-provider LLM, Baidu Pan sync

> [!warning] Beta
> v3.0 introduces the Writing scenario and removes the execution module. The frontmatter schema is still evolving. Back up your vault before upgrading.

---

## Core Modules

### 1. Knowledge

Build and maintain a structured knowledge base.

- **Ask questions** — classify, generate Q&A notes, and update the question graph
- **Concept pages** — auto-create, scan empty ones, batch-complete (definition / explanation / examples / relations)
- **Reading projects** — book skeleton, per-chapter pre-reading questions, summaries, Feynman tests
- **Vault QA** — metadata-index retrieval with `[[source]]` references, no embeddings
- **Knowledge debt dashboard** — empty concepts, orphan questions, unfinished readings, stale drafts
- **Practical templates** — checklists, SOPs, routines, action plans, review sheets generated from your knowledge

### 2. Writing

Create and grow your works. Three genres: **web novel / paper / article**.

- **New work** — from a one-line premise, AI generates the project home page, chapter outline (with synopses), and chapter files; novels also get character cards and world settings
- **Continue writing** (core) — pick up from the cursor or the end of the chapter, automatically carrying in preceding text, chapter/adjacent synopses, style profile, and relevant character/world settings
- **Generate next chapter** — from the outline synopsis, preview before writing
- **Polish** — rewrite a selection while keeping the work's voice
- **Extract characters** — scan a chapter and write character cards into `_角色/`

Data boundary: writing artifacts live under `Writing/`; Vault QA excludes them by default (one-way reference from writing to knowledge, configurable).

### 3. Auxiliary

- **OpenAI-compatible LLM** — DeepSeek by default; change the Base URL for other providers
- **Configurable output styles** — knowledge-base, technical, minimal, product, academic, story, dashboard
- **Optional Baidu Pan sync** — incremental backup, bidirectional sync, plugin and Obsidian config backup

---

## Status

| Module | Feature | Status | Notes |
| --- | --- | --- | --- |
| Knowledge | AI Assistant | Stable | Insert / replace / append / show |
| Knowledge | Reading Projects | Stable | Skeleton, chapter questions, summaries, Feynman |
| Knowledge | Vault QA | Experimental | Metadata index, no embeddings |
| Knowledge | Concept Completion | Experimental | Preview before write |
| Knowledge | Question Graph | Experimental | Classification + index + Mermaid |
| Knowledge | Knowledge Debt | Experimental | Dashboard statistics |
| Knowledge | Practical Templates | Experimental | Checklist / SOP / review generator |
| Writing | New Work | Experimental | Outline + characters + world settings |
| Writing | Continue Writing | Experimental | Cursor / chapter modes, setting injection |
| Writing | Next Chapter | Experimental | Generated from outline synopsis |
| Auxiliary | Baidu Sync | Stable | Manual/auto backup and config sync |
| Auxiliary | Multi-provider LLM | Partial | OpenAI-compatible Base URL |

---

## Quick Start

1. Install the plugin (see [Installation](#installation)).
2. Go to **Settings → IStart-Note-AI → Auxiliary → AI Service** and enter your API key.
3. Click the ribbon icon, or press `Cmd/Ctrl+Shift+A` for the AI assistant.
4. Type a request in natural language — or create a work and continue writing in the **Writing** group.

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
| **Knowledge** | Q&A path, Concepts path, Questions index path, index status + rebuild |
| **Writing** | Works path (Writing/), continue context length, default continue word count |
| **Auxiliary** | API key, Base URL, model, output style, Baidu sync |

---

## Usage

### Desktop

- **Command panel** — ribbon icon; three domain groups (Knowledge / Writing / Auxiliary); the Writing group is pinned first inside chapter files
- **Default hotkeys** (remappable in settings):

  | Hotkey | Action |
  | --- | --- |
  | `Cmd/Ctrl+Shift+A` | AI assistant |
  | `Cmd/Ctrl+Shift+J` | Continue current chapter |
  | `Cmd/Ctrl+Shift+N` | Generate next chapter |
  | `Cmd/Ctrl+Shift+W` | New work |

- **Status bar** — "Continue" / "Next chapter" buttons appear when a chapter file is open
- **Editor right-click** — continue / polish / extract characters / AI assistant
- **File right-click** — AI assistant / beautify

### Mobile

- Ribbon icon → command panel, same domain groups.
- Add frequent commands to the mobile toolbar for one-tap access.

---

## Data Layout

Plugin-managed notes live under two roots (paths configurable in settings):

```
Knowledge/                 # knowledge domain (read in)
  Q&A/
  Questions/
  Concepts/
  Reading/
  Artifacts/
Writing/                   # writing domain (write out)
  Novels/<work>/
    _作品.md               # type: writing-project
    _大纲.md               # type: outline (per-chapter synopsis)
    _角色/                 # type: character
    _设定/                 # type: setting (worldbuilding)
    01-chapter.md          # type: chapter
  Papers/<paper>/
  Articles/<article>/
```

Frontmatter types: `concept` / `question` / `reading-project` / `reading-note` / `writing-project` / `chapter` / `outline` / `character` / `setting`.

---

## Architecture

```
src/
  core/
    llm/              Unified LLM client + JSON extractor
    knowledge/        Metadata knowledge index
    artifact/         Practical template types, prompt, validation, rendering
    schema.ts         SCHEMA_VERSION + helpers
  ai/                 AI feature modules (assistant, classifier, reading planner, writing planner, continuer, ...)
  features/
    assistant/        AI assistant modals
    writing/          Writing scenario (new work, continue, project/context management)
    reading/          Reading project manager
    concept/          Concept completion
    question/         Question classify + graph
    artifact/         Practical template builder
    dashboard/        Knowledge debt modal
    sync/             Baidu sync
    command-panel/    Unified command panel
  vault/              Vault writer (conflict-safe)
  settings/           Settings tab (Knowledge / Writing / Auxiliary)
  actions/            Action registry + definitions
  main.ts
```

---

## Privacy

AI features send your selection and partial note context to the configured chat-completions endpoint. Sync features upload to your own Baidu Pan. No telemetry. No plugin-operated servers. Full details in [PRIVACY.md](./PRIVACY.md).

---

## Roadmap

### v3.0 — Writing Scenario (in development)

- Three business scenarios: Knowledge / Writing / Auxiliary; broken execution module removed
- Writing: new work (outline + characters + world settings), continue, next chapter, polish, character extraction
- Data boundary: writing artifacts isolated from knowledge; Vault QA excludes them by default
- Quick entries: default hotkeys, status bar buttons, context menus
- All emoji removed; icons use Obsidian-native Lucide

### v3.1 — Writing Studio

- Sidebar writing studio view: outline tree, word counts and chapter status, settings lookup
- Idea snippets collection and expansion
- Character alias/nickname recognition for better setting injection
- Style learning from the first three chapters

### v3.2 — Integrations

- Tasks / Periodic Notes integration
- Optional local vector index for richer Vault QA
- Multi-vault support

---

## Contributing

PRs and issues welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md). Security issues: [SECURITY.md](./SECURITY.md).

## License

MIT. See [LICENSE](./LICENSE).
