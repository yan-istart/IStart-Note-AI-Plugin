# IStart-Note-AI

<p align="center">
  <strong>Turn your Obsidian vault into a personal knowledge system and writing studio.</strong>
</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="#feature-list">Feature list</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#entry-point-and-feature-consolidation-plan">Consolidation plan</a> ·
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
- Writing: turn ideas into works — web novels, papers, long-form articles — with shared and work-specific writing skills
- Auxiliary: AI assistant, sidebar annotations, typo checking, document beautification, model settings, IStart Data Sync

> Documentation reflects the current source tree. `package.json` and `manifest.json` declare version **2.7.1**; minimum Obsidian version: **1.7.2**. The UI currently uses Chinese labels; English names below describe those controls.

---

## Feature list

Implemented features are grouped below by capability. AI capabilities run as tools inside the assistant, using inline shortcuts, existing commands or natural-language requests. Items marked **Agent conversation** are available through natural-language requests in the assistant.

### Workspace and shortcuts

- **Unified workspace** — one ribbon icon with assistant, annotations, and data-sync pages.
- **Inline task shortcuts** — expand common writing, document, knowledge, and import tasks in the assistant.
- **Contextual shortcuts** — available actions reflect the current note, chapter type, selection, and cursor.
- **Commands and context menus** — use Obsidian commands, editor menus, and selected file-menu actions.
- **Selection toolbar** — annotate, polish, expand, or explain selected text.
- **Cursor-idle entry** — optionally expand continuation, insertion, summary, and other cursor actions.
- **Writing status bar** — continue or generate the next chapter from chapter notes.

### Agent conversations and tasks

- **Ask mode** — read, search, summarize, and explain without creating file-change proposals.
- **Agent mode** — combine tools for knowledge, writing, reading, annotations, and templates.
- **Independent sessions** — separate messages, input drafts, references, and execution modes.
- **Session management** — search, pin, rename, archive, delete, branch, and export Markdown.
- **Context references** — attach notes with `@` or capture source text, selections, and cursor positions.
- **Task shortcuts** — continuation, polish, summary, and other action buttons invoke their tools directly.
- **Shared task cards** — enter question, project, template, and writing parameters inside the assistant.
- **Follow-up draft revision** — shorten, rewrite, or restructure generated content before saving it.
- **Preview and apply** — inspect paths and content changes before writing; changed source text blocks overwrites.
- **Execution records** — inspect tool steps, status, results, and source references.
- **Task recovery** — stop generation, regenerate, or continue from saved tool checkpoints.
- **Persistent history** — save sessions and task cards locally; optionally share history without model or Baidu credentials.
- **Streaming replies** — optionally display incremental answers, with a full-response fallback when browser CORS prevents streaming.

### Knowledge and reading

- **Vault QA** — retrieve related vault notes and answer with `[[source]]` references.
- **Question classification** — distinguish new, refinement, and expansion questions.
- **Structured Q&A and graphs** — preview Q&A, concept placeholders, follow-ups, indexes, and Mermaid question-evolution graphs.
- **Empty-concept scanning** — list pages needing completion and specify what to process next.
- **Concept completion** — preview definitions, explanations, examples, and links, individually or in batches of up to five.
- **Reading-project planning** — generate a reading map, chapter templates, and concept placeholders from a book and optional contents.
- **Pre-reading questions and project continuation (Agent conversation)** — fill chapters incrementally while preserving handwritten notes and updating progress.
- **Chapter summaries (Agent conversation)** — organize chapter content from reading material.
- **Feynman checks (Agent conversation)** — generate questions to test chapter understanding.
- **Knowledge-debt check (Agent)** — review empty concepts, orphan questions, unfinished reading, and stale drafts.
- **Knowledge-index management** — update the index incrementally or rebuild it from settings.
- **Practical templates** — create checklists, SOPs, routines, action plans, reviews, question lists, decisions, and custom templates.
- **Template usage and daily records** — choose one-off, template, or recurring use, optionally generate today's record, and select an evidence policy.

### Writing and fiction

- **New works** — create novel, paper, or general-article projects.
- **Project planning** — preview the home page, outline, chapter synopses, and templates; novels also include character and world-setting cards.
- **Manuscript import** — import pasted text, the current note, vault files/folders, or desktop `.md`/`.txt` sources while preserving originals.
- **Import preparation** — split, preview, merge, classify, clean, and infer style/settings from existing material.
- **Continuation** — write at the cursor or document end with current prose and relevant project material.
- **Insertion** — bridge existing passages using the text on both sides of the cursor.
- **Next chapter** — generate prose from the outline and preview the new chapter file.
- **Polish and expansion** — revise selected text while preserving facts, plot, and voice.
- **Generation parameters** — set independent continuation/insertion lengths, context scope, continuation position, and instructions.
- **Character extraction** — preview new character cards from a writing-project chapter.
- **Story enactment** — choose one to four characters and one to three rounds; characters generate their own lines and a narrator adds transitions.
- **Scene confirmation** — revise and approve a scene before using it in later enactment or character analysis.
- **Character evolution** — preview evidence-backed card updates from confirmed scenes and feed applied changes into later enactment.

### Writing skills

- **Standard skill files** — discover local `SKILL.md` bodies as writing rules.
- **Three-layer matching** — select shared craft, genre, and current-work guidance.
- **Project detection** — use `_作品.md` to identify the work, directory, and genre.
- **Skill management** — configure roots, rescan, enable individual skills, and bound injected content.
- **File reuse** — share skill files with Codex/OpenCode; see [Writing skills quick setup](#writing-skills-quick-setup).

### Annotations and documents

- **Local highlights and comments** — add `==highlights==`, inline comments, or footnotes to a selection.
- **Annotation overview** — browse the current note or whole vault, including Obsidian comments.
- **Annotation maintenance** — search, filter, navigate to source, edit, copy, and remove entries.
- **AI annotation** — preview a comment drafted from a selection and nearby context.
- **Annotation suggestions** — request AI suggestions for an existing comment or continue discussing it in Agent.
- **Summary and explanation** — keep note summaries and selection explanations in the conversation.
- **Document beautification** — preview structure, Callouts, links, and optional Mermaid diagrams before replacement.
- **Typo checking** — check a note or selection, review corrections, and click to locate the source; no automatic replacement.
- **Diagrams and formulas (Agent conversation)** — generate Mermaid diagrams or LaTeX and preview insertion.

### IStart Data Sync

- **Dedicated settings** — manage sync mode, shared rules, storage, and configuration transfer separately.
- **Baidu Pan storage** — configure your application, authorization, and remote path; currently the supported storage service.
- **Whole-vault Git sync** — synchronize included notes, attachments, and deletions with a shared desktop/mobile JavaScript Git engine.
- **Incremental transfer and conflicts** — exchange version bundles, merge text, and resolve conflicts.
- **Version history** — browse vault versions, file lists, and changes between adjacent versions.
- **History restore** — restore a file or preview a whole-vault restore while retaining later history.
- **Local changes** — inspect added/modified/deleted summaries, path/type filters, badges, and line diffs.
- **Offline comparison** — compare with the latest local Git commit without network requests or new commits.
- **Legacy file mode** — retain backup, restore, status scanning, bidirectional sync, and per-file conflict choices.
- **Optional automation** — foreground Git sync and startup configuration pull are off by default and controlled per device.
- **Configuration transfer** — push/pull supported settings without model or Baidu credentials.

### Settings and platform support

- **AI service settings** — configure the API key, Base URL, and built-in model choices.
- **Output styles** — knowledge-base, technical, minimal, product, academic, story, and dashboard.
- **Directory settings** — configure Q&A, question indexes, concepts, and writing roots.
- **Agent preferences** — adjust streaming, tool steps, context budget, and shared history.
- **Mobile layout** — sidebar drawers, touch controls, source navigation, keyboard sizing, and an optional floating toolbar.
- **Local data and privacy** — Markdown notes, separate session/settings storage, no telemetry or plugin-operated server; see [Privacy](#privacy) for data flows.

---

## Agent task shortcuts

AI actions in assistant shortcuts, existing commands, editor menu, floating toolbar, and writing status bar share the assistant's conversations, tool execution, progress, and change previews.

- **Run directly** — continuation, insertion, polish, expansion, explanation, summary, next chapter, character extraction, AI annotation, and concept completion capture their source and invoke a tool. Explanation and summary use read-only Ask mode.
- **Fill parameters first** — questions, reading projects, new works, and practical templates use a shared inline card; click **开始任务** when ready.
- **Adjust this generation** — writing settings and quantity actions configure length, context scope, and continuation position, starting from saved defaults.
- **Scan before processing** — empty-concept scanning shows a list; specify pages or request batches in the conversation.

Explicit action buttons skip model-based planning. Follow up to revise an unsaved draft, then apply the latest preview. Regeneration preserves the task parameters and captured positions; stale selections/cursors cannot redirect a write. Task cards persist with the session across page switches and restarts.

Beautification, proofreading, knowledge-debt checks, annotation rewriting/suggestions and manuscript classification/analysis now use Agent tools. File preparation/import, ordinary annotation editing, sync and proofreading navigation retain native interfaces. The separate All features panel is removed; its command and both old AI quick-dialog commands open the assistant. See [Agent task shortcuts (Chinese)](./docs/agent-sidebar.md#任务快捷入口).

## Current limitations

- Vault QA searches titles, tags, headings, links, concepts, and domains using an in-memory metadata index. The sidebar search returns up to eight notes with 1,800-character snippets and can read longer excerpts on demand. There are no embeddings or full-text semantic search.
- Reading project tasks first generate a map and chapter templates. Continue the conversation to fill pre-reading questions. Dedicated commands for resuming a project, generating chapter summaries, and Feynman tests are not registered; use the assistant for these tasks.
- Ordinary notes support continuation and insertion between existing passages. Insertion reads both sides of the cursor and previews a connecting passage before writing; chapter notes also use the outline, characters, and settings. Next-chapter generation requires an open chapter note. New projects create chapter templates, not complete prose.
- Full context is the default: the complete current document, complete project outline, and every complete character/setting card. Other chapters' prose is not included automatically. Project sources still use `_作品.md`, `_大纲.md`, `_角色/`, and `_设定/` in the chapter's parent directory. Explicit nearby mode restores context clipping and name matching with three characters/two settings.
- Generation quantities are approximate prose-length targets. Legacy quick-dialog previews show actual character counts, excluding whitespace and including punctuation.
- Typo checking requires a configured AI provider and starts in editing mode. It checks the current note or selection, not the entire vault. AI suggestions can contain false positives or miss errors; there is no one-click replacement. Editing the source, moving it, or deleting it invalidates existing results and requires a fresh check.
- Git sync has automated engine and adapter tests. Actual Baidu authorization/network behavior and Android/iOS device behavior still require installation testing; see the sync documentation.
- Creating an annotation requires a text selection in editing mode. Text selection in reading mode is not supported for creation, though sidebar navigation works in both modes. There is no custom highlight-color picker; existing `<mark>` colors are displayed. The vault tab reads every Markdown note on first scan and lists at most 300 results, so use search and filters in large vaults. Selections crossing blank lines, heading/list blocks, or code blocks must be annotated in smaller parts.
- Writing skills inject only the `SKILL.md` body; `references/` and `scripts/` are not read or executed by the plugin. Codex/OpenCode auto-invocation depends on the description and is not guaranteed. `.agents` is hidden and the plugin's Git sync excludes hidden paths by default, so keep `Skills/` as the visible canonical root.
- The floating toolbar currently covers editing mode only; reading mode uses Obsidian's native menu. It is off on mobile by default to avoid overlapping the native selection menu, handles, and keyboard toolbar. The cursor-idle trigger is off by default.

---

## Quick Start

1. Install the plugin (see [Installation](#installation)).
2. Go to **Settings → IStart-Note-AI → Auxiliary → AI Service** and enter your API key.
3. Click the single **IStart 工作台** ribbon icon to open the AI assistant, or run **打开 IStart 工作台** from Obsidian's command palette.
4. Type a request in natural language, or expand **任务快捷入口** in the assistant composer.
5. To take reading notes, select text and run **Add annotation** or **AI annotation**; switch to **批注** in the workspace to browse them.
6. To standardize writing rules, add a `SKILL.md` under `Skills/`, then open **Settings → Skill → Rescan**.
7. To check spelling, run **错别字甄别** in editing mode and click a sidebar suggestion to locate its source. A non-empty selection limits the check to that text. See the [walkthrough](#typo-checking-walkthrough).

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

The model dropdown offers `deepseek-v4-flash` and `deepseek-v4-pro`. Compatible endpoints must accept the selected model name; there is no custom-model input or provider manager.

Settings are organized into seven tabs:

| Tab | Key settings |
| --- | --- |
| **Knowledge** | Q&A path, Concepts path, Questions index path, index status + rebuild |
| **Writing** | Works path (`Writing`), full document/project context by default; nearby mode uses 2,000 characters per side, continuation target (800 Chinese characters), insertion target (200 Chinese characters) |
| **Skill** | Enable auto-attach, writing-only scope, skill roots, maximum injected characters, discovered skill list |
| **Annotations** | Default inline/footnote comment style, collapse sidebar after mobile navigation, open annotation sidebar |
| **Interface** | Floating toolbar toggle, show on selection, cursor-idle trigger, mobile enable |
| **Data Sync** | IStart Data Sync toggle, sync mode and rules, Baidu Pan configuration, cross-device configuration transfer |
| **Auxiliary** | API key, Base URL, model, output style |

**IStart Data Sync** is the feature name; Baidu Pan is its currently supported storage service. **Settings → Data Sync** separates:

- **Shared sync options**: Git/file mode, automatic behavior, ignore rules, and per-file size limits.
- **Baidu Pan configuration**: App ID, App Secret, account authorization, and remote path.
- **Cross-device configuration transfer**: credential-free push/pull and optional startup pull.

Git/file mode determines how data is synchronized; the storage service determines where it is stored. Only Baidu Pan is implemented today. Existing sync settings, authorization, command hotkeys, and saved sync sidebar layouts continue to work.

---

## Writing skills quick setup

Writing skills use the standard Agent Skills `SKILL.md` format and are matched in three layers:

| Scope | Use | Auto-attached when |
| --- | --- | --- |
| `global` | Shared craft rules, revision checklists, general conventions | A writing AI request runs |
| `genre` | Web-novel, paper, or article-specific rules | The current work's genre matches |
| `project` | One work's voice, taboos, pacing, and continuity checklist | The current file belongs to that work |

Recommended layout:

```text
Skills/
  writing-craft/SKILL.md       # shared craft rules
  writing-webnovel/SKILL.md    # genre guidance
  work-<work>/SKILL.md         # work-specific rules
.agents/skills/                # Codex/OpenCode bridge
```

Work-skill frontmatter example:

```yaml
---
name: Example Work · Writing Rules
description: Use only when writing or editing the work "Example Work".
metadata:
  istart/scope: project
  istart/project: Example Work
  istart/project-path: Writing/Novels/Example Work
  istart/genre: novel
  istart/priority: 30
---
```

The plugin walks up from the chapter file to `_作品.md`, then infers the work title, folder, and genre. Injection order is global → genre → project, with the most specific rules taking precedence. Keep plot, characters, and worldbuilding in `_作品.md`, `_大纲.md`, `_角色/`, and `_设定/`; put only procedural writing guidance in the skill. Skill files are excluded from the Vault QA index.

Codex/OpenCode can read the same files:

```bash
cd <vault>
mkdir -p .agents/skills
ln -s ../../Skills/writing-craft .agents/skills/writing-craft
ln -s ../../Skills/work-example .agents/skills/work-example
```

OpenCode can also use `"skills": ["./Skills"]`. Then open **Settings → Skill → Rescan** to review and toggle skills. See [Writing skills](./docs/skills.md) for the full guide and examples.

---

## Usage

### Desktop

- One workspace icon opens assistant, annotations and data sync in the same sidebar.
- Expand **任务快捷入口** for common tasks. Existing commands, hotkeys, editor menus and chapter status actions remain available. The floating toolbar's **助手** button opens the assistant.
- Beautification and AI annotation rewriting/suggestions produce Agent previews; ordinary annotation editing remains local.
- File-menu tasks capture the clicked note. Git badges, diffs and version history remain in the file explorer and sync page.
- The import wizard handles source selection, splitting, cleanup and import. Classification and metadata analysis are recorded Agent tasks; closing/cancelling the wizard stops requests.

### Mobile

- The workspace uses shared navigation in a sidebar drawer. Common tasks expand inside the assistant.
- Annotation cards support touch menus and long press; source navigation can collapse the drawer. AI tasks use Agent previews.
- Proofreading runs in a conversation. **查看校对定位** opens source locations; tapping selects the original text.
- Existing commands can be added to Obsidian's mobile toolbar. Writing settings open inline task cards; long-term defaults remain in plugin settings.
- Task cards scroll within the composer and support Ctrl/Cmd+Enter. Fields do not automatically receive focus. Keyboard sizing uses Obsidian insets and the visible viewport.
- The floating toolbar is off by default on mobile. External manuscript files/folders require desktop; pasted text and vault sources work on mobile.

---

### Typo checking walkthrough

1. Configure your API key under **Settings → IStart-Note-AI → Auxiliary → AI Service**, open a Markdown note, and switch to editing mode.
2. Clear the selection to check the whole note, or select the passage you want to check.
3. Run **错别字甄别** from Obsidian's command palette, the editor context menu, or the assistant's **校对** shortcut. Long notes are checked in chunks; the conversation shows task status and supports stopping.
4. Click **查看校对定位** in the conversation to review the original text → correction list, for example `再接再励 → 再接再厉`, with its source line and column. Click a suggestion to open the original note and select the text. If that note is now in reading mode, navigation switches it back to editing mode.

Repeated words are located using their line and occurrence number. Suggestions that cannot be matched to the source are omitted with a notice. Editing the source or moving the file disables old entries. Return to the target note and click **检查当前笔记全文** (Check the whole current note) to run a fresh check; to check only a selection again, reselect the passage and rerun the command.

The check focuses on Chinese typos, homophone misuse, and obvious missing or extra characters without rewriting style. Metadata, code, comments, URLs, Markdown link destinations, and wiki-links are masked before sending. Only the selected passage or current note is sent to your configured AI provider; other notes and writing skills are not attached. Review suggestions manually: clicking only locates the source and never replaces text.

---

## Entry point and feature consolidation

- **Workspace** — one icon and shared assistant, annotations and sync pages; old duplicate sidebars are consolidated.
- **Agent tasks** — writing, knowledge, reading, templates, beautification, proofreading, annotation AI and manuscript AI analysis share execution and conversation history.
- **Native operations** — sync/conflicts, ordinary annotation editing, proofreading navigation and manuscript preparation retain dedicated interfaces.
- **Compatibility** — the separate All features panel is removed. Its command and both old AI quick-dialog commands open the assistant, preserving IDs and hotkeys.
- **Future work** — project-material aggregation, context-menu submenus and additional storage providers remain planned.

## Copying and insertion positions

- Select and copy message text, references, tool results and file previews. Buttons copy messages, complete messages, tool details, original/revised files and inserted text; the session menu can copy the whole conversation.
- Source positions are captured before leaving the editor. Agent actions reuse their conversation's target even when the editor no longer has focus.
- Click **设置插入位置** to choose a location in a readonly source preview. This also supports notes attached through @ without a cursor.
- **保存或写入回答 → 插入到已设置位置** stages an existing answer at that location without regenerating it. Apply the preview to write; source edits invalidate old snapshots. After applying, the saved cursor advances to the end of the change.

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
Skills/                    # visible writing-skill root (syncable)
  writing-craft/SKILL.md   # shared craft rules
  work-<work>/SKILL.md     # work-specific rules
.agents/skills/            # optional Codex/OpenCode bridge
```

Frontmatter types: `concept` / `question` / `reading-project` / `reading-note` / `writing-project` / `chapter` / `outline` / `character` / `setting` / `reference`; practical templates use `execution-artifact-*` types.

Writing projects live under the configurable `Writing/` root. Vault QA excludes `chapter`, `writing-project`, `character`, `setting`, `outline`, and `snippet` frontmatter types. This filter has no settings toggle and does not exclude an entire directory; untyped notes and imported `reference` notes may still be retrieved.

Annotations do not create a separate folder or index. They live inside the source note as standard Markdown and are parsed live by the sidebar. Removing an annotation deletes its markers and comment text while keeping the annotated prose.

---

## Architecture

```
src/
  core/
    llm/              Unified LLM client + JSON extractor
    knowledge/        Metadata knowledge index
    artifact/         Practical template types, prompt, validation, rendering
    sync/             JavaScript Git engine, bundle exchange, merge and recovery
    annotations/      Annotation parsing, deletion ranges and navigation lookup
    skills/           Agent Skills parsing, discovery, scope selection and prompt injection
    schema.ts         SCHEMA_VERSION + helpers
  ai/                 AI feature modules (assistant, annotation drafting, typo checking, classifier, reading planner, writing planner, continuer, ...)
  features/
    agent/            Multi-session Agent sidebar and controller
    assistant/        AI assistant modals
    annotation/       Add/delete dialogs and annotation sidebar view
    proofreading/     Typo suggestions, check progress, and source navigation
    writing/          New work, plan preview, continue, import, project/context management
    reading/          Reading project manager
    concept/          Concept completion
    question/         Question classify + graph
    artifact/         Practical template builder
    dashboard/        Legacy dashboard component (entry moved to Agent)
    sync/             Baidu sync
    command-panel/    Legacy component (no active entry)
    toolbar/          Floating editor toolbar (CodeMirror 6 ViewPlugin)
  vault/              Q&A and concept-note writer
  settings/           Settings tab (Knowledge / Writing / Skill / Annotations / Interface / Auxiliary)
  actions/            Action registry + definitions
  main.ts
```

---

## Privacy

AI features send your selection and partial note context to the configured chat-completions endpoint. AI annotations only use the network when you explicitly click **AI draft**, **AI rewrite**, run **AI annotation**, or request **AI suggestions**; ordinary highlights, annotation editing, and sidebar parsing are local. Sync features upload to your own Baidu Pan. Git sync excludes hidden paths, the Obsidian config directory, credentials, and Git metadata. History retains past content after deletion and has no additional encryption. Separate configuration sync excludes API keys and Baidu credentials. In file mode, enabling plugin backup uploads the plugin `data.json` (including credentials) and selected Obsidian configuration files. No telemetry. No plugin-operated servers. Full details in [PRIVACY.md](./PRIVACY.md).

---

## Sync and configuration transfer

Enable **IStart Data Sync** under **Settings → Data Sync**, enter your Baidu App ID and App Secret under **Baidu Pan configuration**, authorize your account, choose **Git version sync**, then use **Open sync** or **Manual sync** in the sidebar. Automatic sync and startup configuration pull are off by default. Desktop and mobile use the same JavaScript Git engine; optional automatic sync runs only while the app is in the foreground.

Sync is disabled by default. New installations default to Git mode; older configurations without a mode retain file sync until you select Git explicitly. All devices must use Git mode with the same remote path. Existing cloud backups are preserved; restore any old backup in file mode before your first Git sync if needed. See [Git sync documentation](./docs/git-sync.md).

File mode retains backup, restore, status scanning, bidirectional sync, per-file conflict choices, and optional plugin backup. Its “automatic backup” setting is retained, but current note-generation flows do not trigger it; use manual backup.

Git mode syncs ordinary vault files, including attachments and deletions, with configured ignore rules and size limits (100 MB per file by default). It saves commits, exchanges incremental Git bundles, merges text, allows conflict resolution, and restores individual files or the whole vault after a restore preview. It needs no system Git. Automatic sync is off by default; when enabled it runs at startup and every minute while the app is visible.

Configuration push/pull transfers Base URL, model, the three knowledge paths, automatic graph opening, remote path, ignore rules, and file size limit. Writing settings, output style, skill settings, annotation settings, credentials, sync mode, and automatic behavior stay local. Startup configuration pull is off by default. See [Git sync documentation](./docs/git-sync.md) (Chinese) for migration, history storage, and recovery details.

### View local file changes

Enable **IStart Data Sync** and select **Git version sync** to use these entry points:

| Entry point | Behavior |
| --- | --- |
| File explorer | Added and modified files show text badges. A local scan runs about one second after editing, creating, deleting, or renaming stops |
| File context menu / command palette | Choose **查看本地 Git 差异**, or run **查看当前文件的本地 Git 差异**, for a line-by-line comparison with line numbers, colors, and addition/deletion signs |
| Sync sidebar: **本地文件改动** | See added, modified, and deleted counts, filter by path or type, and click a path to view its diff, including old content for deleted files |
| Desktop status bar | See the current file's Git change status and click to open its diff |

The comparison baseline is the **latest local Git commit**. Scanning and viewing diffs use no network and create no commits; existing local history works offline. The first scan may initialize an empty local Git repository. A failed sync may already have saved a local commit, so “no local changes” does not confirm upload or agreement with the cloud; run sync to check.

Renames currently appear as deletion of the old path and addition of the new path. Binary attachments show byte sizes. Large text files are not expanded; documents with many lines use a side-by-side text comparison. Ignore rules and size protections match Git sync. See [local changes documentation (Chinese)](./docs/git-sync.md#查看本地文件改动).

---

## Contributing

PRs and issues welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md). Security issues: [SECURITY.md](./SECURITY.md).

## License

MIT. See [LICENSE](./LICENSE).
