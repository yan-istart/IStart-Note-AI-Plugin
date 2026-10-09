<!-- Thanks for the PR. Please fill in the sections that apply. -->

## Summary

<!-- What does this PR change, in one or two sentences? -->

## Why

<!-- Link an issue if there is one, or describe the motivation. -->

## How was it tested?

<!-- Manual test steps, or commands run. -->

- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] Tested manually in Obsidian

## User-facing impact

<!--
Mark "none" for refactors / internal changes.
For changes that affect vault contents (frontmatter, paths, sync layout), describe migration impact and add a note to CHANGELOG.md.
-->

## Checklist

- [ ] PR is focused on a single change
- [ ] Updated `CHANGELOG.md` under "Unreleased" if user-visible
- [ ] Updated `README.md` / `README.zh-CN.md` if behavior or setup changed
- [ ] No new direct `requestUrl` calls to LLM endpoints (use `core/llm` instead)
