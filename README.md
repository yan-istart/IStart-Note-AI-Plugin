# IStart-Note-AI

> [!warning] Beta software
> IStart-Note-AI is under active development. Features marked **experimental** below may change or be removed without notice. The data model and frontmatter schema are not yet stable; back up your vault before trying new features.

[简体中文 README →](./README.zh-CN.md)

An Obsidian plugin that turns your notes into a structured personal knowledge system. One unified AI assistant helps you draft, expand, and organize notes, with automatic concept pages, bidirectional links, reading projects, and optional Baidu Cloud sync.

The plugin is built around an OpenAI-compatible chat completions API. The default provider is [DeepSeek](https://platform.deepseek.com); other compatible endpoints work by changing the Base URL.

---

## Status overview

| Feature | Status | Notes |
| --- | --- | --- |
| AI Assistant (insert / replace / append / show) | stable | Single command panel entry, content classifier + structured prompt + markdown beautifier |
| Reading projects | stable | Generate skeleton, chapter pre-reading questions, summaries, Feynman tests |
| Baidu Cloud sync (notes + plugin config) | stable | Manual and auto modes, conflict strategy, plugin/Obsidian config backup |
| Document beautification | stable | Restructures headings, adds callouts and Mermaid diagrams |
| Concept pages auto-creation | stable | Empty pages created via `[[concept]]` link scan |
| Concept page completion (`ConceptCompleter`) | experimental | Internals exist; not exposed in the unified panel yet |
| Question graph (`QuestionGraphManager`) | experimental | Frontmatter classification + Mermaid evolution graph; not yet wired into the panel |
| Vault-wide knowledge retrieval | not yet | Planned for v2 |
| Execution plan / preview / rollback | not yet | Planned for v3 |

---

## Features

### AI Assistant (unified entry)

Select text or place your cursor, then describe what you want in natural language:

- **Expand / rewrite** selected text
- **Explain** a term
- **Generate diagrams** (flowchart, sequence, state, class, ER, Gantt) and LaTeX formulas
- **Fill empty sections** based on document context
- **Continue writing** from the cursor
- **Summarize** the current document
- **Beautify** existing content with callouts, links, and visual breaks

Quick tags work too: `[扩写]` `[解释]` `[画图]` `[补全]` `[续写]` `[总结]` `[公式]` `[时序图]`.

### Structured output

Model output is post-processed for knowledge-base style: short paragraphs, Obsidian callouts (`> [!summary]`, `> [!warning]`, `> [!tip]`), Mermaid diagrams where appropriate, and automatic `[[concept]]` linking against existing pages. The output style is configurable: technical, minimal, academic, product, story, dashboard.

### Reading projects

Turn any book into a structured study plan:

1. Enter book title (and optionally a table of contents).
2. The plugin generates a reading roadmap, chapter relationships, and pre-reading questions.
3. Take notes per chapter, then generate chapter summaries and Feynman tests.

### Knowledge organization

- New concepts captured under `Knowledge/Concepts/_未分类/`.
- After completion, concepts are reorganized into domain subfolders.
- Domain MOC index pages are generated with Mermaid overview graphs.
- Question evolution graphs live in the question index.

### Baidu Cloud sync (optional)

- Incremental backup, bidirectional sync, or force overwrite.
- Optional backup of the plugin itself and Obsidian config (toolbar, hotkeys, appearance).
- Optional auto-backup after note generation.

> [!info] Privacy
> AI features send your selection and parts of the active note to the configured chat-completions endpoint. Sync features upload selected notes (and optionally Obsidian config) to your own Baidu Pan storage. See [PRIVACY.md](./PRIVACY.md) for the full data flow.

---

## Requirements

- Obsidian 1.7.2 or later.
- A DeepSeek API key (or any OpenAI-compatible endpoint).
- Baidu Cloud sync (optional): a Baidu Pan App ID and App Secret.

---

## Installation

### From community plugins (preferred)

Submission to the community plugin store is in progress. Once available:

1. Settings → Community plugins → Browse.
2. Search **IStart-Note-AI**.
3. Install → Enable.

### Manual install (recommended path during beta)

Download the assets from a published [GitHub Release](https://github.com/yan-istart/IStart-Note-AI-Plugin/releases) — `main.js`, `manifest.json`, `styles.css` — and place them under `<your-vault>/.obsidian/plugins/istart-note-ai/`.

> Don't copy the source repository directly: the runtime bundle is built into `dist/` and is not committed to git. Always use the release assets.

### Build from source

```bash
npm ci
npm run build
# dist/main.js, dist/manifest.json, dist/styles.css are the install artifacts
```

---

## Configuration

Settings → IStart-Note-AI:

| Setting | Description | Default |
| --- | --- | --- |
| API Key | DeepSeek API key (or compatible) | — |
| Base URL | Chat completions endpoint root | `https://api.deepseek.com` |
| Model | `deepseek-v4-flash` or `deepseek-v4-pro` | `deepseek-v4-flash` |
| Output style | Knowledge-base, technical, minimal, product, academic, story, dashboard | Knowledge-base |
| Q&A folder | Where Q&A notes are saved | `Knowledge/Q&A` |
| Concepts folder | Where concept pages are saved | `Knowledge/Concepts` |
| Baidu Cloud sync | Enable, App ID/Secret, remote path, auto-backup, ignore pattern | disabled |

---

## Usage

### Desktop

- 🧠 **Ribbon icon** opens the command panel.
- **Right-click in the editor** → `IStart-Note-AI: AI 助手`.
- **Right-click a file in the sidebar** → `IStart-Note-AI: AI 助手`.

### Mobile

- 🧠 **Ribbon icon** opens the command panel.
- Add `AI 助手` to the mobile toolbar for a one-tap entry.

### Workflow

1. Optionally select text.
2. Click 🧠 or right-click → `AI 助手`.
3. Type a request (or use a quick tag, or leave blank for auto-detect).
4. Preview the result, then choose to insert, replace, append, or show only.

---

## Project layout

```
src/
  core/           # cross-feature infrastructure
    llm/          # unified LLM client + JSON extractor
  ai/             # AI features (assistant, classifier, planner, ...)
  features/       # UI and per-feature managers
  vault/          # vault writers
  settings/
  actions/        # action registry / command panel
  main.ts
```

The `core/llm` module centralizes every chat-completions call. New AI features should depend on it instead of calling `requestUrl` directly.

---

## Roadmap

- v1.9 (in progress): unified LLM client, basic vault retrieval, AI operation preview, full open-source governance.
- v2.0: vault-wide knowledge retrieval with citations, question graph + concept maturity dashboards.
- v3.0: execution engine — turn notes into reviewable, rollback-able plans (tasks, decisions, projects).

See [the analysis writeup](https://github.com/yan-istart/IStart-Note-AI-Plugin/issues) for the longer plan.

---

## Contributing

PRs and issues are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a change. For security reports, see [SECURITY.md](./SECURITY.md).

## License

MIT. See [LICENSE](./LICENSE).
