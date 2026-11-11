# Privacy Policy

_Last updated: 2026-11-01. [简体中文版本 →](./PRIVACY.zh-CN.md)_

This document describes what data IStart-Note-AI handles, where it goes, and how to control it. The plugin runs entirely inside your Obsidian client — there are no plugin-operated servers, no analytics, and no telemetry.

## Summary

- The plugin sends prompts to **the AI provider you configure** (default: DeepSeek). Nothing else.
- The plugin uploads files to **your own Baidu Pan storage** when you enable Baidu sync. Nothing else.
- API keys, Baidu OAuth tokens, and other secrets are stored locally in your vault's plugin data file (`<your-vault>/.obsidian/plugins/istart-note-ai/data.json`).
- The plugin does not phone home, send analytics, or contact any third party other than the providers above.

## What is sent to the AI provider

When you trigger an AI feature, the plugin makes an HTTPS request to the chat completions endpoint configured under **Settings → IStart-Note-AI → Base URL** (default: `https://api.deepseek.com/v1/chat/completions`).

The request body may include:

| Source | Data | When |
| --- | --- | --- |
| Selection | The currently selected text | Whenever you trigger the AI assistant with a non-empty selection |
| Annotation context | The highlighted text, current annotation comment, and up to ~600 characters before/after | Annotation drafting, rewriting, or requesting AI suggestions |
| Writing skill | The body of enabled local `SKILL.md` files, selected by global/genre/project scope | Writing AI requests while skills are enabled |
| Active file | The active document content (truncated, typically up to ~2,000 characters) | When the assistant needs context (most actions) |
| Active file metadata | File name, frontmatter `type` field | Most actions |
| Cursor context | Up to ~500 characters before the cursor | Continue / fill-empty-section actions |
| Concept name list | The list of file basenames under your Concepts folder | All actions, used to drive auto-linking |
| Question history | Up to the last 20 question titles in your Q&A folder | Question classification |
| Reading notes | The notes for a specific chapter (truncated to ~3,000 characters) | Reading project: chapter summary, Feynman test |
| Your instruction | The natural-language prompt you type into the assistant | Always |

During a task, the Agent can read Markdown notes explicitly attached or discovered by its tools inside the current vault. Other features read their configured context. The Agent does not read outside the vault; desktop manuscript import reads only local sources explicitly selected by the user. API keys are sent only to the configured provider endpoint.

You are subject to the privacy policy of whichever provider you configure. Review:

- DeepSeek: <https://platform.deepseek.com>
- For other providers, consult their own documentation.

## Agent conversation history

Conversations, drafts, source snapshots, tool records, and proposed changes are stored separately from settings in `<vault.configDir>/plugins/istart-note-ai/agent/sessions.json`. Snapshots and previews can include complete note contents. Conversation files do not store provider keys or Baidu credentials; external vault/system backups can still copy the plugin directory.

Task checkpoints in that file include pending tool requests, returned observations, source snapshots, and project context. They are included when shared history is enabled. Continuing a task sends the required restored history to the currently configured model service and checks whether source notes changed.

Agent requests send budgeted history or summaries, references, tool results, and selected skills to the configured model service. Retrieved sources can include notes other than the open document. Optional streaming uses browser HTTPS requests and falls back to Obsidian transport when CORS prevents access, using the same endpoint.

Shared history is off by default. Enabling it writes `IStart/Agent Sessions/history.json`, a regular vault file that Git-mode or other vault sync services can synchronize. Disabling sharing stops updates but does not delete existing shared files or remote versions. Markdown exports are also vault notes. Deleting a conversation preserves notes already created and does not remove backup copies.

## What is sent to Baidu Cloud

Baidu Cloud sync is **disabled by default**. When you enable it under **Settings → IStart-Note-AI → Baidu Cloud Sync**, you supply:

- An **App ID** and **App Secret** from the [Baidu Pan Open Platform](https://pan.baidu.com/union).
- An OAuth authorization code that the plugin exchanges for an `accessToken` and `refreshToken`.

After enabling sync, the plugin can upload to your own Baidu Pan account at the path you configure (default: `/apps/istart-note-ai`). The data uploaded depends on your settings:

- **Notes**: the markdown files in the folders you choose to sync.
- **Git mode**: version bundles containing included notes, attachments, and earlier versions (including deleted content), under `_istart-git/v1/`. Hidden files, the vault configuration directory, and plugin credentials are excluded from Git note synchronization.
- **Plugin config (optional)**: a small JSON file containing non-secret plugin settings.
- **Plugin itself (optional)**: the compiled plugin files in `.obsidian/plugins/istart-note-ai/`.
- **Obsidian config (optional)**: a curated set of files from `.obsidian/` (toolbar, hotkeys, appearance, community-plugins).

Files are uploaded over HTTPS using the Baidu Pan REST API. The plugin **does not encrypt files end-to-end**; treat your Baidu Pan account security as the boundary.

Automatic Git sync and startup configuration pull are off by default. With automatic sync disabled, Git versions are uploaded only when you trigger sync. Git history is also stored locally under `<vault.configDir>/plugins/istart-note-ai/git-sync/`; deleting a note does not delete its past versions. Incremental bundles depend on earlier bundles, so individual history bundles should not be removed while continuing to use the same remote history.

You can disable sync at any time. Removing the local plugin data file (or running Settings → Community plugins → Reset) clears stored Baidu tokens.

## Where credentials are stored

All settings, including the DeepSeek API key, the Baidu App Secret, and the Baidu access/refresh tokens, are stored in:

```
<your-vault>/.obsidian/plugins/istart-note-ai/data.json
```

Anything inside your vault — including this file — is local to your machine unless you sync it elsewhere yourself. The plugin never transmits this file.

If you sync your vault via iCloud, Obsidian Sync, Git, or another mechanism, **you are responsible for whether `data.json` is included in that sync**. The Obsidian default is to include it. To exclude it, configure an exclusion rule in your sync tool.

## What is **not** collected

- No telemetry, usage analytics, or crash reporting.
- No outbound requests to addresses other than the configured AI provider and Baidu Pan.
- No background uploads when sync is disabled.
- No personal information beyond what your prompts and notes already contain.

## Mobile

The plugin runs on Obsidian Mobile and follows the same rules. AI requests go to the same endpoint over the device's network. Baidu sync on mobile uses the same OAuth credentials.

## Data retention and deletion

- **Local data**: delete `<your-vault>/.obsidian/plugins/istart-note-ai/data.json` to remove all locally stored settings and tokens.
- **Baidu Pan**: open the Baidu Pan web UI or app and delete the folder you configured (default: `/apps/istart-note-ai`) to remove uploaded notes.
- **AI provider**: refer to the provider's data retention policy. The plugin does not retain anything itself.

## Reporting concerns

For security or privacy issues, follow [SECURITY.md](./SECURITY.md). For other concerns, open an issue on GitHub.
