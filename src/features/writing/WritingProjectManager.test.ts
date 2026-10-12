import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import { DEFAULT_SETTINGS } from "../../types";
import { WritingProjectManager } from "./WritingProjectManager";
import { StoryContinuer } from "../../ai/StoryContinuer";
import { LLMClient } from "../../core/llm";

vi.mock("obsidian", async (original) => ({ ...await original(), normalizePath: (path: string) => path }));

function project() {
  const entries = new Map<string, { file: TFile; content: string; frontmatter: Record<string, unknown> }>();
  const add = (path: string, content: string, frontmatter: Record<string, unknown> = {}) => {
    const file = Object.assign(new TFile(), { path, basename: path.slice(path.lastIndexOf("/") + 1, -3), parent: { path: "作品" } });
    entries.set(path, { file, content, frontmatter });
    return file;
  };
  const chapter = add("作品/01-第一章.md", "当前章", { type: "chapter", number: 1, synopsis: "旧章节属性里的梗概", project: "作品" });
  add("作品/_作品.md", "---\ntype: writing-project\n---\n# 作品首页\n\n正文里的文风说明", { title: "作品", genre: "novel", style_profile: "简洁" });
  const outline = "# 完整大纲\n\n## 第1章：第一章\n\n> 更新后的本章梗概\n\n## 第8章：很远的章节\n\n> 远期剧情的重要约束";
  add("作品/_大纲.md", outline);
  for (let i = 0; i < 5; i++) add(`作品/_角色/角色${i}.md`, "角色经历。".repeat(150) + `角色${i}结尾的重要约束`, { name: `角色${i}`, role: i === 0 ? "protagonist" : "support" });
  for (let i = 0; i < 4; i++) add(`作品/_设定/设定${i}.md`, "世界规则。".repeat(150) + `设定${i}结尾的重要约束`, { name: `设定${i}`, category: "规则" });
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => entries.get(path)?.file ?? null,
      getMarkdownFiles: () => Array.from(entries.values()).map((entry) => entry.file),
      read: async (file: TFile) => entries.get(file.path)!.content,
      cachedRead: async (file: TFile) => entries.get(file.path)!.content,
    },
    metadataCache: { getFileCache: (file: TFile) => ({ frontmatter: entries.get(file.path)?.frontmatter }) },
  } as unknown as App;
  return { app, chapter, outline, entries };
}

describe("complete writing-project context", () => {
  it("loads the full outline and every complete card, and prefers the updated outline synopsis", async () => {
    const doc = project();
    const context = (await new WritingProjectManager(doc.app, DEFAULT_SETTINGS).loadContext(doc.chapter))!;
    expect(context.genre).toBe("novel");
    expect(context.chapterSynopsis).toBe("更新后的本章梗概");
    expect(context.outlineContent).toBe(doc.outline);
    expect(context.projectContent).toContain("正文里的文风说明");
    expect(context.characters).toHaveLength(5);
    expect(context.worldSettings).toHaveLength(4);
    expect(context.characters[4].summary).toContain("角色4结尾的重要约束");
    expect(context.worldSettings[3].content).toContain("设定3结尾的重要约束");
  });

  it.each(["continue", "insert"])("includes the complete outline and unmentioned cards in %s prompts", async (action) => {
    const doc = project();
    const context = (await new WritingProjectManager(doc.app, DEFAULT_SETTINGS).loadContext(doc.chapter))!;
    const chat = vi.spyOn(LLMClient.prototype, "chat").mockResolvedValue("新增正文。");
    const writer = new StoryContinuer(DEFAULT_SETTINGS);
    const request = { instruction: "", targetWords: 200, contextScope: "full" as const };
    if (action === "insert") await writer.insertStory(context, request, { before: "上文", after: "下文" });
    else await writer.continueStory(context, { ...request, mode: "cursor" }, "上文", "下文");
    const prompt = chat.mock.calls[0][0].userPrompt;
    expect(prompt).toContain(doc.outline);
    expect(prompt).toContain("角色4结尾的重要约束");
    expect(prompt).toContain("设定3结尾的重要约束");
    expect(prompt).toContain("下文");
    chat.mockRestore();
  });

  it("keeps context clipping available only when nearby mode is explicitly chosen", async () => {
    const doc = project();
    const context = (await new WritingProjectManager(doc.app, DEFAULT_SETTINGS).loadContext(doc.chapter, "nearby"))!;
    expect(context.outlineContent).toBeUndefined();
    expect(context.characters[0].summary.length).toBe(600);
    expect(context.worldSettings[0].content.length).toBe(600);
  });
});
