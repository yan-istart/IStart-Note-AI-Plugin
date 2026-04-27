# IStart-Note-AI

Generate structured knowledge notes from questions and selected text using DeepSeek AI, with automatic concept pages, bidirectional links, and a question graph.

---

## Features

| Feature | Description |
|---------|-------------|
| Ask a question | Input a question, get a DeepSeek answer, and generate a structured note automatically. |
| Context Q&A | Select text in any note, ask a question based on it, and generate a note with source reference and backlink. |
| Question classification | Automatically classify questions as new, refinement, or expansion, and link them to related questions. |
| Concept completion | Fill in empty concept pages on demand, with light or standard depth. |
| Section append | Add more items to any existing section (e.g. Examples) without overwriting existing content. |
| Batch scan | Scan all empty concept pages in the vault and complete them in bulk. |
| Question index | Automatically maintain a question graph index page. |

---

## Requirements

- Obsidian 1.4.0 or later.
- A [DeepSeek API key](https://platform.deepseek.com).

---

## Installation

### From the community plugin directory (recommended)

1. Open Obsidian settings → Community plugins → Browse.
2. Search for **IStart-Note-AI**.
3. Click Install, then Enable.

### Manual installation

1. Build the plugin (see [Development](#development)).
2. Copy the contents of `dist/` to your vault's `.obsidian/plugins/istart-note-ai/` folder.
3. Enable the plugin in Obsidian settings → Community plugins.

---

## Configuration

Open Obsidian settings → IStart-Note-AI.

| Setting | Description | Default |
|---------|-------------|---------|
| API key | Your DeepSeek API key from [platform.deepseek.com](https://platform.deepseek.com). | — |
| Base URL | API endpoint. | `https://api.deepseek.com` |
| Model | `deepseek-chat` or `deepseek-reasoner`. | `deepseek-chat` |
| Q&A folder | Folder for question-and-answer notes. | `Knowledge/Q&A` |
| Concepts folder | Folder for concept pages. | `Knowledge/Concepts` |
| Questions folder | Folder for the question graph index. | `Knowledge/Questions` |
| Open graph view | Open the graph view automatically after generating a note. | Off |

The plugin creates these folders automatically on first use.

---

## Usage

### Ask a question

- Hotkey: `Cmd/Ctrl + Shift + D`
- Ribbon icon (brain icon in the left sidebar)
- Command palette: `Ask DeepSeek and generate a knowledge note`

After submitting a question, the plugin:

1. Calls DeepSeek and generates an answer.
2. Shows a classification dialog to confirm the question type (new, refinement, or expansion).
3. Creates a structured Markdown note with Answer, Concepts, Relations, and suggested follow-up questions.
4. Creates empty concept pages for all extracted concepts.
5. Updates the question index page.

### Context Q&A

1. Select any text in a note.
2. Right-click → **IStart-Note-AI: Ask based on selection**, or use `Cmd/Ctrl + Shift + Q`.
3. Enter your question in the dialog.
4. The generated note includes the source quote and a backlink is added to the original note.

### Section append

Add more items to any section that already has content:

1. Place the cursor inside a section (e.g. below `## Examples`).
2. Right-click → **IStart-Note-AI: Append to "Examples"**, or use the command palette: `Append content to current section`.
3. Choose how many items to generate (2, 3, 5, or 8).
4. Review the preview, then confirm to append or regenerate.

DeepSeek reads the existing section content as context and avoids duplicating items.

### Concept completion

**Single page:**

- Open a concept page → command palette: `Complete current concept page`.
- Select `[[concept name]]` in the editor → right-click → `IStart-Note-AI: Complete concept "..."`.
- Right-click any `.md` file in the file list → `IStart-Note-AI: Complete this concept page`.

**Batch:**

- Command palette: `Scan empty concept pages`.
- Select up to 5 pages, choose a depth, and confirm.

Completion depth options:

- **Light**: Definition and related concepts.
- **Standard**: Definition, explanation, examples, related concepts, and related questions.

All generated content is shown in a preview before being written to the file.

### Question index

- Command palette: `Open question index`.
- The index is updated automatically after each question.

---

## Note structure

### Q&A note

```markdown
---
type: question
question: What are the five elements?
category: new
parent: null
related: []
concepts: [Five elements, Wood, Fire, Earth, Metal, Water]
status: linked
created_at: 2026-04-25
---

# What are the five elements?

## Question
## Answer
## Concepts
## Relations
## Tags
## Suggested questions
### Refinement
### Expansion
```

### Context Q&A note

```markdown
# Why does yin-yang balance affect system stability?

## Source
> Yin-yang balance determines system stability.

Source: [[path/to/original-note]]

## Question
## Answer
## Concepts
## Relations
## Suggested questions
## Tags
```

### Concept page

```markdown
---
type: concept
name: Five elements
status: completed
completion_status: completed
created_from: Q&A
created_at: 2026-04-25
updated_at: 2026-04-25
---

# Five elements

## Definition
## Explanation
## Examples
## Related concepts
## Related questions
## Sources
```

---

## Development

### Requirements

- Node.js 16 or later.
- npm 8 or later.

### Setup

```bash
cd obsidian-deepseek-plugin
npm install
```

### Build

```bash
npm run dev      # Watch mode, outputs to dist/main.js
npm run build    # Production build, outputs to dist/
```

### Project structure

```
src/
├── main.ts                   # Plugin entry point: commands, menus, settings
├── types.ts                  # Shared type definitions
├── DeepSeekClient.ts         # API client for standard Q&A
├── ContextQAClient.ts        # API client for context-aware Q&A
├── VaultWriter.ts            # Note creation and backlink management
├── QuestionModal.ts          # Question input dialog
├── ContextQAModal.ts         # Context Q&A input dialog
├── QuestionClassifier.ts     # Question classification (new / refinement / expansion)
├── QuestionClassifyModal.ts  # Classification confirmation dialog
├── QuestionGraphManager.ts   # Question graph: frontmatter, index page, suggestions
├── ConceptCompleter.ts       # API client for concept completion
├── ConceptPageManager.ts     # Concept page analysis, incremental write, batch scan
├── ConceptCompletionModal.ts # Depth selection, preview, and batch scan dialogs
├── SectionAppender.ts        # Section extraction, append generation, and write
├── SectionAppendModal.ts     # Count selection and preview dialogs
└── SettingsTab.ts            # Settings tab UI
```

### Extending the plugin

- To add a new AI feature, follow the pattern in `ContextQAClient.ts`: implement an `ask()` method that returns structured JSON.
- To add a command, call `this.addCommand()` in `main.ts` `onload()`.
- To add a context menu item, add `menu.addItem()` inside the `editor-menu` or `file-menu` event listener in `main.ts`.
- To change a note template, edit `buildNoteContent()` or `buildContextNoteContent()` in `VaultWriter.ts`.
- To change a prompt, edit the prompt constant in the corresponding client file.

---

## Changelog

### 1.4.0

- Added section append: add more items to any existing section without overwriting content.
- Context menu automatically detects the section at the cursor position.
- Generated items avoid duplicating existing content.

### 1.3.0

- Added context Q&A: ask questions based on selected text.
- Context Q&A includes source quote, backlink to the original note.
- Renamed plugin to IStart-Note-AI.

### 1.2.0

- Added question graph: automatic classification (new, refinement, expansion).
- Added question index page.
- Added suggested follow-up questions.

### 1.1.0

- Added concept completion (light and standard depth).
- Added batch scan for empty concept pages.
- Added preview dialog before writing.
- Added context menu support.

### 1.0.0

- Basic Q&A note generation.
- Automatic concept page creation and bidirectional links.
- DeepSeek API configuration.

---

## License

MIT. See [LICENSE](LICENSE).
