# Privacy Policy

_Last updated: 2026-05-20. [简体中文版本 →](./PRIVACY.zh-CN.md)_

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
| Active file | The active document content (truncated, typically up to ~2,000 characters) | When the assistant needs context (most actions) |
| Active file metadata | File name, frontmatter `type` field | Most actions |
| Cursor context | Up to ~500 characters before the cursor | Continue / fill-empty-section actions |
| Concept name list | The list of file basenames under your Concepts folder | All actions, used to drive auto-linking |
| Question history | Up to the last 20 question titles in your Q&A folder | Question classification |
| Reading notes | The notes for a specific chapter (truncated to ~3,000 characters) | Reading project: chapter summary, Feynman test |
| Your instruction | The natural-language prompt you type into the assistant | Always |

The plugin never reads files outside the configured paths unless you explicitly point it at them. The plugin never sends your API key to anything other than the provider's endpoint.

You are subject to the privacy policy of whichever provider you configure. Review:

- DeepSeek: <https://platform.deepseek.com>
- For other providers, consult their own documentation.

## What is sent to Baidu Cloud

Baidu Cloud sync is **disabled by default**. When you enable it under **Settings → IStart-Note-AI → Baidu Cloud Sync**, you supply:

- An **App ID** and **App Secret** from the [Baidu Pan Open Platform](https://pan.baidu.com/union).
- An OAuth authorization code that the plugin exchanges for an `accessToken` and `refreshToken`.

After enabling sync, the plugin can upload to your own Baidu Pan account at the path you configure (default: `/apps/istart-note-ai`). The data uploaded depends on your settings:

- **Notes**: the markdown files in the folders you choose to sync.
- **Plugin config (optional)**: a small JSON file containing non-secret plugin settings.
- **Plugin itself (optional)**: the compiled plugin files in `.obsidian/plugins/istart-note-ai/`.
- **Obsidian config (optional)**: a curated set of files from `.obsidian/` (toolbar, hotkeys, appearance, community-plugins).

Files are uploaded over HTTPS using the Baidu Pan REST API. The plugin **does not encrypt files end-to-end**; treat your Baidu Pan account security as the boundary.

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
