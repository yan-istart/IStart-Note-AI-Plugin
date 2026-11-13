# Privacy Policy

_Last updated: 2026-11-13. [简体中文版本 →](./PRIVACY.zh-CN.md)_

This document describes what data IStart-Note-AI handles, where it goes, and how to control it. The plugin runs inside your Obsidian client and can launch a companion publishing service on desktop. There are no developer-operated servers, analytics, or telemetry.

## Summary

- The plugin sends prompts to **the AI provider you configure** (default: DeepSeek).
- The plugin uploads files to **your own Baidu Pan storage** when you enable Baidu sync.
- Explicit article distribution sends article text, images and selected account identifiers to **your configured publishing service**, then through your browser's Wechatsync extension to selected platforms.
- AI API keys and Baidu OAuth tokens are stored locally in your vault's plugin data file (`<your-vault>/.obsidian/plugins/istart-note-ai/data.json`). Publishing tokens use Obsidian SecretStorage when available, with session-only fallback.
- The plugin does not phone home or send analytics.

## Article distribution

Distribution is initiated by an explicit send action, independently of AI requests. The destination is the companion service URL configured on that device: a loopback HTTP service on desktop or a remote HTTPS service. It receives the complete prepared article, inline image data, optional cover, request identifier and selected browser account names/identifiers. Browser platform cookies stay in the browser extension; the plugin does not collect them.

Connection preferences use device-local vault storage where supported; publishing access tokens and extension tokens use SecretStorage on Obsidian 1.11.4+, or memory for the current session. They are not added to plugin `data.json` or publishing records. The local service scripts and task results live under `~/.istart-publishing/<device-ID>/`; tokens are passed to child processes through environment variables. Local installation unpacks bundled scripts and does not download runtime packages. Node.js installation and browser extension installation are separate user actions.

Article snapshots, copied attachments, source paths, content hashes, account labels and per-attempt results are stored under configurable `IStart/Publishing/`. This ordinary vault directory can be included by enabled sync/backup tools. Returned draft URLs have credential-like query parameters removed. The companion service persists job IDs, content hashes, account labels and results, not full article text or image data. Requests remain in memory during processing, and browser extensions/platforms may maintain their own history.

Disconnects and uncertain outcomes do not automatically resubmit articles. Querying an existing task reads status from the configured service. Remote service operators and selected platforms can access submitted content; use a service you control or trust. Details: [publishing setup](./docs/publishing.md).

## What is sent to the AI provider

When you trigger an AI feature, the plugin makes an HTTPS request to the chat completions endpoint configured under **Settings → IStart-Note-AI → Base URL** (default: `https://api.deepseek.com/v1/chat/completions`).

The request body may include:

| Source | Data | When |
| --- | --- | --- |
| Selection | The currently selected text | Whenever you trigger the AI assistant with a non-empty selection |
| Annotation context | The highlighted text, current annotation comment, and up to ~600 characters before/after | Annotation drafting, rewriting, or requesting AI suggestions |
| Typo check | Selected prose or the whole note, in overlapping chunks of up to 6,000 UTF-16 code units; metadata, code, comments, and link destinations are masked | Only when you run typo checking; no writing skills or other notes are attached |
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

Manuscript classification and metadata analysis are also recorded Agent tasks. History includes excerpts from user-selected sources, task parameters and analysis results, without external source paths. Proofreading reports retain source snapshots and verified corrections; chosen insertion positions are saved with the session. Opt-in shared history includes this data. Copy actions write only the selected content to the system clipboard.

Task parameters, unsubmitted task cards, and captured selections/cursors are saved with conversations and included in opt-in shared history. Explicit task actions invoke their tools directly; required source text and parameters are sent to the configured AI service according to that tool's behavior.

Conversations, drafts, source snapshots, tool records, and proposed changes are stored separately from settings in `<vault.configDir>/plugins/istart-note-ai/agent/sessions.json`. Snapshots and previews can include complete note contents. Conversation files do not store provider keys or Baidu credentials; external vault/system backups can still copy the plugin directory.

Task checkpoints in that file include pending tool requests, returned observations, source snapshots, and project context. They are included when shared history is enabled. Continuing a task sends the required restored history to the currently configured model service and checks whether source notes changed.

Agent requests send budgeted history or summaries, references, tool results, and selected skills to the configured model service. Retrieved sources can include notes other than the open document. Optional streaming uses browser HTTPS requests and falls back to Obsidian transport when CORS prevents access, using the same endpoint.

Shared history is off by default. Enabling it writes `IStart/Agent Sessions/history.json`, a regular vault file that Git-mode or other vault sync services can synchronize. Disabling sharing stops updates but does not delete existing shared files or remote versions. Markdown exports are also vault notes. Deleting a conversation preserves notes already created and does not remove backup copies.

## What is sent to Baidu Cloud

IStart Data Sync is **disabled by default**. Baidu Pan is the currently supported storage service. When you enable sync under **Settings → IStart-Note-AI → Data Sync** and authorize it under **Baidu Pan configuration**, you supply:

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

General plugin settings, including the DeepSeek API key, the Baidu App Secret, and the Baidu access/refresh tokens, are stored in:

```
<your-vault>/.obsidian/plugins/istart-note-ai/data.json
```

Anything inside your vault — including this file — is local to your machine unless you sync it elsewhere yourself. The plugin never transmits this file.

If you sync your vault via iCloud, Obsidian Sync, Git, or another mechanism, **you are responsible for whether `data.json` is included in that sync**. The Obsidian default is to include it. To exclude it, configure an exclusion rule in your sync tool.

## What is **not** collected

- No telemetry, usage analytics, or crash reporting.
- Network destinations are the configured AI provider, Baidu Pan, and the publishing service/platforms when explicitly used.
- Automatic vault sync is disabled by default; an explicitly submitted publishing job may continue after closing its view.
- No personal information beyond what your prompts and notes already contain.

## Mobile

The plugin runs on Obsidian Mobile and follows the same rules. AI requests go to the same endpoint over the device's network. Baidu sync on mobile uses the same OAuth credentials.

## Data retention and deletion

- **Local data**: delete `<your-vault>/.obsidian/plugins/istart-note-ai/data.json` to remove general settings and AI/Baidu credentials. Clear publishing secrets in Obsidian SecretStorage and remove publishing snapshots/device preferences separately. Stop the local service before removing `~/.istart-publishing/<device-ID>/`.
- **Baidu Pan**: open the Baidu Pan web UI or app and delete the folder you configured (default: `/apps/istart-note-ai`) to remove uploaded notes.
- **AI provider**: refer to the provider's data retention policy. The plugin does not retain anything itself.

## Reporting concerns

For security or privacy issues, follow [SECURITY.md](./SECURITY.md). For other concerns, open an issue on GitHub.
