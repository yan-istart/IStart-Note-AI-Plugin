# IStart-Note-AI

<p align="center">
  <strong>Turn your Obsidian vault into a personal knowledge system and writing studio.</strong>
</p>

<p align="center">
  <a href="./README.md">简体中文</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#privacy">Privacy</a> ·
  <a href="#current-limitations">Current limitations</a>
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
- Auxiliary: AI assistant, document beautification, model settings, Baidu Pan sync

> Documentation reflects the current source tree. `package.json` and `manifest.json` declare version **2.2.6**; minimum Obsidian version: **1.7.2**. The UI currently uses Chinese labels; English names below describe those controls.

---

## Core Modules

### 1. Knowledge

Build and maintain a structured knowledge base.

- **Ask questions** — classify, confirm or adjust the classification, generate Q&A notes, and update the question graph
- **Concept pages** — auto-create, scan empty ones, batch-complete (definition / explanation / examples / relations); single-page completion has a preview, while batch completion writes selected pages directly
- **Reading projects** — book skeleton (with an optional supplied table of contents), per-chapter pre-reading questions, concept pages, and note templates with a summary section
- **Vault QA** — metadata-index retrieval with `[[source]]` references, no embeddings
- **Knowledge debt dashboard** — empty concepts, orphan questions, unfinished readings, stale drafts
- **Practical templates** — checklists, SOPs, routines, action plans, review sheets, question lists, decision records, and custom formats; preview before saving

### 2. Writing

Create and grow your works. Three genres: **web novel / paper / article**.

- **New work** — from a one-line premise, preview the AI plan before creating the project home page, chapter outline (with synopses), and chapter templates; novels also get character cards and world settings
- **Import manuscript** — turn an existing novel, paper, or article draft (paste / current file / vault file / vault folder / desktop local file / desktop local folder; `.md` and `.txt`) into a writing project: chapter splitting, content classification (rules plus optional AI recognition: chapters / outline / settings / reference / skip), manual classification adjustment and merging adjacent chapters, cleaning, AI metadata inference; the original stays untouched
- **Continue writing** (core) — pick up from the cursor or the end of the chapter, automatically carrying in preceding text, chapter/adjacent synopses, style profile, and relevant character/world settings
- **Generate next chapter** — from the outline synopsis, preview before writing
- **Polish** — rewrite a selection while keeping the work's voice
- **Extract characters** — for novels, analyze up to the first 6,000 characters of the current chapter and write character cards into `_角色/`

Writing projects live under the configurable `Writing/` root. Vault QA excludes `chapter`, `writing-project`, `character`, `setting`, `outline`, and `snippet` frontmatter types. This filter has no settings toggle and does not exclude an entire directory; untyped notes and imported `reference` notes may still be retrieved.

### 3. Auxiliary

- **AI assistant** — process a selection, current note, or cursor context with natural-language instructions; preview before replacing a selection, inserting, or appending, with options to copy results or create a concept page
- **AI service** — DeepSeek by default. API key and Base URL are configurable; requests use `POST {baseUrl}/v1/chat/completions`. The model dropdown only offers `deepseek-v4-flash` (default) and `deepseek-v4-pro`; another endpoint must accept the selected model name. There is no custom-model input or provider manager
- **Beautify current document** — preview AI restructuring, Callouts, links, and optional Mermaid diagrams before replacing the full document
- **Configurable output styles** — knowledge-base, technical, minimal, product, academic, story, dashboard
- **Optional Baidu Pan sync** — Git history, incremental bidirectional sync, text merging, and per-file version restore; the original file-backup mode remains available

Enable Baidu Pan sync, enter your Baidu App ID and App Secret, authorize your account, choose **Git version sync**, then use **Open sync** or **Manual sync** in the sidebar. Automatic sync and startup configuration pull are off by default. Desktop and mobile use the same JavaScript Git engine; optional automatic sync runs only while the app is in the foreground.

Sync is disabled by default. New installations default to Git mode; older configurations without a mode retain file sync until you select Git explicitly. All devices must use Git mode with the same remote path. Existing cloud backups are preserved; restore any old backup in file mode before your first Git sync if needed. See [Git sync documentation](./docs/git-sync.md).

---

## Current limitations

- Vault QA searches titles, tags, headings, links, concepts, and domains using an in-memory metadata index. It sends up to eight matching notes, using the first 600 characters of each, plus any selection. It has no embeddings or full-text semantic search.
- Reading project creation generates pre-reading questions and note templates. Dedicated commands for resuming a project, generating chapter summaries, and Feynman tests are not registered; use the AI assistant for these tasks.
- Ordinary notes support continuation and insertion between existing passages. Insertion reads both sides of the cursor and previews a connecting passage before writing; chapter notes also use the outline, characters, and settings. Next-chapter generation requires an open chapter note. New projects create chapter templates, not complete prose.
- Novel setting injection matches names in the preceding text (both sides for insertion), synopsis, and instruction, including protagonists, with at most three characters and two world settings. It does not recognize aliases automatically.
- Git sync has automated engine and adapter tests. Actual Baidu authorization/network behavior and Android/iOS device behavior still require installation testing; see the sync documentation.

---

## Quick Start

1. Install the plugin (see [Installation](#installation)).
2. Go to **Settings → IStart-Note-AI → Auxiliary → AI Service** and enter your API key.
3. Click the brain ribbon icon → **AI 助手**, or open Obsidian’s command palette and select an IStart-Note-AI command.
4. Type a request in natural language — or create a work and continue writing in the **Writing** group.

---

## Installation

### Community plugins

If **IStart-Note-AI** appears in Settings → Community plugins → Browse, install and enable it there. Otherwise use manual installation or build from source.

### Manual

Download `main.js`, `manifest.json`, `styles.css` from a [GitHub Release](https://github.com/yan-istart/IStart-Note-AI-Plugin/releases) and place them in `<vault>/.obsidian/plugins/istart-note-ai/`.

> Build a source checkout before installation. Use release assets, or copy the files generated in `dist/` after building.

### Build from source

```bash
npm ci
npm run build
# → dist/main.js, dist/manifest.json, dist/styles.css
```

---

## Configuration

Default AI settings: Base URL `https://api.deepseek.com`, model `deepseek-v4-flash`, output style `knowledge-base`. Enter the root URL without a trailing slash or `/v1/chat/completions`, since the client appends that suffix.

Settings are organized into three tabs:

| Tab | Key settings |
| --- | --- |
| **Knowledge** | Q&A path, Concepts path, Questions index path, index status + rebuild |
| **Writing** | Works path (`Writing`), context (2,000 characters before the cursor for continuation, per side for insertion), continuation target (800 Chinese characters), insertion target (200 Chinese characters) |
| **Auxiliary** | API key, Base URL, model, output style, Baidu sync |

---

## Usage

### Desktop

- **Command panel** — ribbon icon; three domain groups (Knowledge / Writing / Auxiliary); the Writing group is pinned first inside chapter files or project home pages
- **Hotkeys** — the plugin does not register default hotkeys. Assign your preferred shortcuts in Settings → Hotkeys to AI assistant, continue writing, insert between passages, next chapter, or new work.
- **Status bar** — "Continue" / "Next chapter" buttons appear when a chapter file is open
- **Editor right-click** — AI assistant, Vault QA, concept completion, practical templates, and document beautification; continuation, insertion, and their settings appear without a selection, while polish/expand/explain appear with a selection. Chapter notes also show character extraction.
- **File right-click** — AI assistant / beautify; these handlers operate on the active editor, so open the target note first
- **Cloud ribbon icon** — opens the Baidu sync sidebar with manual sync and version history in Git mode

### Mobile

- Open the command panel from the IStart-Note-AI icon in the navigation menu or the **Open command panel** command. Contextual shortcuts use Phosphor Duotone icons with short labels; other actions are under **All features**.
- With prose on both sides of the cursor, the panel and assistant prioritize **插写** (insert between passages); at the end, they prioritize continuation. **All features** retains both writing entries.
- Add commands such as continue, insert between passages, polish, expand, explain, and summarize in **Settings → Interface → Configure mobile toolbar → Add a command**. Toolbar commands use matching Phosphor Bold icons; insertion uses arrows converging on the gap.
- Continuation generates a preview directly. **Continuation settings** adjusts cursor/end position, word count (300/800/1500 or custom), and optional instructions; position and word count become the saved defaults.
- Insertion generates a short preview directly, defaulting to 200 Chinese characters. **Insertion settings** offers 100/200/300 or custom length, with bridging, explanation, and transition instructions. Its saved length is independent of continuation. Cancel any selection and place the cursor between existing prose; the beginning, end, and YAML metadata are rejected with guidance.
- Continuation's **Insert and continue** accepts the current result before generating more; insertion only writes the connecting passage. **More → Regenerate** retries without inserting. Writes use the original file, cursor, and selection; switching files or changing the original content blocks insertion while leaving the result available to copy.
- Assistant, continuation, insertion, question, new-work, and result dialogs have a scrolling body and persistent footer sized to the visible keyboard viewport. Mobile dialogs do not explicitly focus text fields.
- Importing files/folders outside the vault requires desktop Obsidian; mobile can use pasted text or vault sources.

---

## Data Layout

Default layout below. Q&A, Questions, Concepts, and Writing paths are configurable; Reading and Artifacts currently use fixed paths:

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
    _资料/                 # imported outlines/reference material, type: reference
    01-chapter.md          # type: chapter
  Papers/<paper>/
  Articles/<article>/
```

Frontmatter types: `concept` / `question` / `reading-project` / `reading-note` / `writing-project` / `chapter` / `outline` / `character` / `setting` / `reference`; practical templates use `execution-artifact-*` types.

---

## Architecture

```
src/
  core/
    llm/              Unified LLM client + JSON extractor
    knowledge/        Metadata knowledge index
    artifact/         Practical template types, prompt, validation, rendering
    sync/             JavaScript Git engine, bundle exchange, merge and recovery
    schema.ts         SCHEMA_VERSION + helpers
  ai/                 AI feature modules (assistant, classifier, reading planner, writing planner, continuer, ...)
  features/
    assistant/        AI assistant modals
    writing/          New work, plan preview, continue, import, project/context management
    reading/          Reading project manager
    concept/          Concept completion
    question/         Question classify + graph
    artifact/         Practical template builder
    dashboard/        Knowledge debt modal
    sync/             Baidu sync
    command-panel/    Unified command panel
  vault/              Q&A and concept-note writer
  settings/           Settings tab (Knowledge / Writing / Auxiliary)
  actions/            Action registry + definitions
  main.ts
```

---

## Privacy

AI features send your selection and partial note context to the configured chat-completions endpoint. Sync features upload to your own Baidu Pan. Git sync excludes hidden paths, the Obsidian config directory, credentials, and Git metadata. History retains past content after deletion and has no additional encryption. Separate configuration sync excludes API keys and Baidu credentials. In file mode, enabling plugin backup uploads the plugin `data.json` (including credentials) and selected Obsidian configuration files. No telemetry. No plugin-operated servers. Full details in [PRIVACY.md](./PRIVACY.md).

---

## Sync and configuration transfer

File mode retains backup, restore, status scanning, bidirectional sync, per-file conflict choices, and optional plugin backup. Its “automatic backup” setting is retained, but current note-generation flows do not trigger it; use manual backup.

Git mode syncs ordinary vault files, including attachments and deletions, with configured ignore rules and size limits (100 MB per file by default). It saves commits, exchanges incremental Git bundles, merges text, allows conflict resolution, and restores individual file versions. It needs no system Git. Automatic sync is off by default; when enabled it runs at startup and every minute while the app is visible.

Configuration push/pull transfers Base URL, model, the three knowledge paths, automatic graph opening, remote path, ignore rules, and file size limit. Writing settings, output style, credentials, sync mode, and automatic behavior stay local. Startup configuration pull is off by default. See [Git sync documentation](./docs/git-sync.md) (Chinese) for migration, history storage, and recovery details.

---

## Contributing

PRs and issues welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md). Security issues: [SECURITY.md](./SECURITY.md).

## License

MIT. See [LICENSE](./LICENSE).
