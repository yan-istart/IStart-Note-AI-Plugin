# IStart-Note-AI

AI-powered knowledge management plugin for Obsidian. One unified AI assistant that helps you build structured notes, read books effectively, and visualize knowledge — all through natural language.

---

## Features

### AI Assistant (unified entry)

One input handles everything. Select text or place your cursor, then tell the AI what you want:

- **Expand** — select text, ask to expand or rewrite
- **Explain** — select a term, ask to explain
- **Diagrams** — describe what you want (flowchart, sequence, state, class, ER, Gantt)
- **Formulas** — describe a math expression, get LaTeX
- **Complete** — fill empty sections based on context
- **Continue** — write more from cursor position
- **Summarize** — summarize the current document
- **Beautify** — restructure existing content with callouts, links, and visual breaks
- **Anything else** — just describe it in natural language

Quick tags for common actions: `[扩写]` `[解释]` `[画图]` `[补全]` `[续写]` `[总结]` `[公式]` `[时序图]`

### Structured Output

AI generates content in professional knowledge-base style:

- Short paragraphs with visual breaks
- Obsidian Callouts (`> [!summary]`, `> [!warning]`, `> [!tip]`)
- Automatic Mermaid diagrams where appropriate
- Auto-linked `[[concepts]]` to existing pages
- Configurable output style (technical, minimal, academic, etc.)

### Reading Projects

Turn any book into a structured study plan:

1. Enter book title (optionally paste table of contents)
2. AI generates reading roadmap, chapter relationships, and pre-reading questions
3. Record notes as you read
4. Generate chapter summaries and take Feynman tests
5. Supports resume if generation is interrupted

### Knowledge Organization

- Concepts auto-organized into domain subdirectories after completion
- Domain MOC index pages with Mermaid overview graphs
- Relationship diagrams in concept pages
- Question evolution graphs in question index

### Baidu Cloud Sync

- Incremental backup / bidirectional sync / force overwrite
- Plugin and Obsidian config backup (toolbar, hotkeys, appearance)
- Auto backup after note generation

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
| Model | `deepseek-v4-flash` or `deepseek-v4-pro` | `deepseek-v4-flash` |
| Output style | Knowledge-base, technical, minimal, product, academic, story, dashboard | Knowledge-base |
| Q&A folder | Where Q&A notes are saved | `Knowledge/Q&A` |
| Concepts folder | Where concept pages are saved | `Knowledge/Concepts` |

---

## Usage

### Desktop

- **🧠 Ribbon icon** → Opens command panel
- **Right-click in editor** → "IStart-Note-AI: AI 助手"
- **Right-click file in sidebar** → "IStart-Note-AI: AI 助手"

### Mobile

- **🧠 Ribbon icon** → Opens command panel
- Add `AI 助手` to mobile toolbar for one-tap access

### Workflow

1. Select text (optional)
2. Click 🧠 or right-click → AI 助手
3. Type your request (or tap a quick tag, or leave blank for auto-detect)
4. Preview result → Confirm

---

## License

MIT. See [LICENSE](LICENSE).
