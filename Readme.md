# IStart-Note-AI

AI-powered knowledge management plugin for Obsidian. One unified AI assistant that helps you build structured notes, read books effectively, and visualize knowledge — all through natural language.

---

## Core Concept

**One input, infinite possibilities.** Instead of memorizing dozens of commands, just tell the AI what you want:

- Select text → click 🧠 → "画个时序图"
- Cursor in empty section → click 🧠 → (leave blank, AI auto-completes)
- Reading a chapter → click 🧠 → "总结这章"

The AI understands your context (selected text, current file, cursor position) and acts accordingly.

---

## Features

| Feature | How to use |
|---------|-----------|
| **AI Assistant** | 🧠 button or right-click → type any instruction |
| **Reading Projects** | Command panel → "New reading project" → enter book title |
| **Baidu Cloud Sync** | Settings → enable sync → backup/restore/force-overwrite |
| **Knowledge Graph** | Automatic: concepts, relations, and Mermaid diagrams |

### AI Assistant (unified entry)

The AI assistant handles everything through one input:

- **Expand** — select text, ask to expand
- **Explain** — select a term, ask to explain
- **Diagrams** — describe what you want (flowchart, sequence, state, class, ER, Gantt)
- **Formulas** — describe a math expression, get LaTeX
- **Complete** — fill empty sections based on context
- **Continue** — write more from cursor position
- **Summarize** — summarize the current document
- **Answer questions** — ask anything about the content
- **Anything else** — just describe it in natural language

### Reading Projects

Turn any book into a structured study plan:

1. Enter book title (and optionally paste table of contents)
2. AI generates:
   - Reading roadmap with chapter relationships (Mermaid)
   - Pre-reading questions for each chapter
   - Core concepts (auto-linked to concept pages)
3. As you read, record notes in chapter pages
4. Generate chapter summaries and take Feynman tests

**Supports resume:** If generation is interrupted, re-run to complete missing chapters.

### Knowledge Structure

```
Knowledge/
├── Reading/
│   └── Book-Title/
│       ├── _索引.md          ← Overview + progress + relationship graph
│       ├── Chapter-1.md      ← Notes with pre-reading questions
│       └── ...
├── Concepts/
│   ├── _未分类/              ← New concepts (before completion)
│   ├── 技术/                 ← Auto-organized by domain after completion
│   │   ├── TCP.md
│   │   └── _索引.md         ← Domain MOC with Mermaid overview
│   └── ...
└── Q&A/
    └── 2026-05-01-question.md
```

### Baidu Cloud Sync

- **Incremental backup** — only uploads changed files
- **Bidirectional sync** — with conflict resolution
- **Force overwrite** — reset local to match cloud state
- **Plugin backup** — includes plugin files + Obsidian config (toolbar, hotkeys, appearance)
- **Auto backup** — triggers after note generation

---

## Requirements

- Obsidian 1.7.2 or later
- A [DeepSeek API key](https://platform.deepseek.com)

---

## Installation

### From community plugins (recommended)

1. Settings → Community plugins → Browse
2. Search **IStart-Note-AI**
3. Install → Enable

### Manual

1. Build: `npm install && npm run build`
2. Copy `dist/` contents to `.obsidian/plugins/istart-note-ai/`
3. Enable in Settings → Community plugins

---

## Configuration

Settings → IStart-Note-AI:

| Setting | Description | Default |
|---------|-------------|---------|
| API Key | DeepSeek API key | — |
| Base URL | API endpoint | `https://api.deepseek.com` |
| Model | `deepseek-v4-flash` (fast) or `deepseek-v4-pro` (deep reasoning) | `deepseek-v4-flash` |
| Q&A folder | Where Q&A notes are saved | `Knowledge/Q&A` |
| Concepts folder | Where concept pages are saved | `Knowledge/Concepts` |
| Questions folder | Question graph index | `Knowledge/Questions` |

---

## Usage

### Desktop

- **🧠 Ribbon icon** → Opens command panel
- **Right-click in editor** → "IStart-Note-AI: AI 助手"
- **Right-click file in sidebar** → "IStart-Note-AI: AI 助手"
- **Command palette** → Search any command

### Mobile

- **🧠 Ribbon icon** → Opens command panel (recommended)
- Add `AI 助手` to mobile toolbar for quick access
- Select text → tap toolbar button → enter instruction

### Quick tags

The AI assistant input has quick tags for common actions:

`[扩写]` `[解释]` `[画图]` `[补全]` `[续写]` `[总结]` `[公式]` `[时序图]`

Tap a tag to fill the instruction, or type your own.

---

## Development

### Setup

```bash
cd obsidian-deepseek-plugin
npm install
```

### Build

```bash
npm run build    # Production → dist/
npm run dev      # Watch mode
```

### Project Structure

```
src/
├── main.ts                    # Plugin entry (minimal: onload + method implementations)
├── types.ts                   # Shared type definitions
├── actions/                   # Action registry (defines all commands/menus)
│   ├── types.ts
│   ├── definitions.ts         # All actions defined here
│   └── registry.ts            # Auto-registers to commands/menus/panel
├── ai/                        # AI clients (pure API calls, no UI)
│   ├── AIAssistant.ts         # Unified AI assistant
│   ├── ReadingPlanner.ts      # Reading project generation
│   ├── ConceptCompleter.ts    # Concept page completion
│   ├── SmartCompleter.ts      # Section/expand/continue
│   ├── DiagramGenerator.ts    # Mermaid/LaTeX generation
│   ├── SectionAppender.ts     # Section content generation
│   ├── DeepSeekClient.ts      # Basic Q&A
│   ├── ContextQAClient.ts     # Context-aware Q&A
│   └── QuestionClassifier.ts  # Question classification
├── features/                  # Feature modules (UI + logic)
│   ├── assistant/             # Unified AI assistant modal
│   ├── reading/               # Reading project management
│   ├── concept/               # Concept page management
│   ├── question/              # Question graph
│   ├── context-qa/            # Context Q&A modal
│   ├── section/               # Section append modal
│   ├── diagram/               # Diagram type/preview modals
│   ├── sync/                  # Baidu cloud sync
│   ├── smart-complete/        # Document analysis modal
│   └── command-panel/         # Unified command panel
├── vault/                     # Vault file operations
│   └── VaultWriter.ts
├── settings/                  # Settings tab
│   └── SettingsTab.ts
└── util/
    └── md5.ts
```

### Adding a new feature

1. Add AI client in `src/ai/` (if needed)
2. Add UI in `src/features/your-feature/`
3. Add action in `src/actions/definitions.ts`
4. Done — automatically appears in command panel, right-click menu, and command palette

---

## Changelog

### 2.0.0

- **Unified AI Assistant** — one input replaces all previous commands
- **Action Registry** — consistent behavior across panel, right-click, and commands
- **DeepSeek v4 models** — switched to `deepseek-v4-flash` and `deepseek-v4-pro`
- **Reading Projects** — book study with pre-reading questions, chapter summaries, Feynman tests
- **Domain organization** — concepts auto-organized into domain subdirectories
- **Mermaid diagrams** — auto-generated relationship graphs in concept pages
- **Obsidian config backup** — toolbar, hotkeys, appearance synced to cloud
- **Force overwrite** — reset local state from cloud backup
- **Code restructure** — modular architecture for easy extension

### 1.5.x

- Baidu Netdisk sync with incremental backup/restore
- Section append, concept completion, context Q&A
- Question classification and graph

### 1.0.0

- Basic Q&A note generation with DeepSeek
- Automatic concept pages and bidirectional links

---

## License

MIT. See [LICENSE](LICENSE).
