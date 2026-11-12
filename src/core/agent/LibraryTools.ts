import { App } from "obsidian";
import type { DeepSeekSettings } from "../../types";
import { LLMClient } from "../llm";
import type { KnowledgeIndexService } from "../knowledge";
import { AIAssistant } from "../../ai/AIAssistant";
import { checkTypos } from "../../ai/TypoChecker";
import { ImportAnalyzer, ImportClassifier, ClassifyUnit } from "../../features/writing/import/ImportAnalyzer";
import type { RawChapter } from "../../features/writing/import/ChapterSplitter";
import type { WritingGenre } from "../../features/writing/types";
import type { AgentRunContext, NoteSnapshot } from "./types";
import { ToolRegistry, ToolResult } from "./ToolRegistry";

/** Specialized generators participate in the same run, cancellation and history as every Agent tool. */
export function registerLibraryTools(registry: ToolRegistry, app: App, settings: DeepSeekSettings, index: KnowledgeIndexService, client: LLMClient,
  note: (ctx: AgentRunContext, path?: string) => Promise<NoteSnapshot>,
  output: (ctx: AgentRunContext, note: NoteSnapshot, text: string, mode: string, title: string) => ToolResult): void {
  registry.add({ name: "document.beautify", label: "美化文档", draft: true, description: "整理全文结构、Callout、图表和概念双链，生成替换全文的预览。", fields: { instruction: { type: "string" } }, execute: async (a, c) => {
    const n = await note(c);
    if (!n.content.trim()) throw new Error("文档为空");
    const concepts = app.vault.getMarkdownFiles().filter(f => f.path.startsWith(`${settings.conceptsPath}/`)).map(f => f.basename);
    const result = await new AIAssistant(settings, settings.outputStyle, concepts, client).run(
      `美化并重新组织这篇文档，顶部添加摘要 Callout，拆分长段落，按需使用 Callout、Mermaid 与概念双链。保持全部原有信息和 frontmatter。${a.instruction ?? ""}`,
      { selection: "", fileContent: n.content, fileName: n.path, fileType: undefined, cursorLineBefore: "", sectionName: null, sectionEmpty: false });
    return output(c, n, result.content, "replace-note", "美化文档");
  }});
  registry.add({ name: "document.proofread", label: "错别字甄别", description: "只读校对固定选区或全文。保留可核对的原文位置，结果可打开定位列表，不自动修改。", fields: { path: { type: "string" } }, execute: async (a, c) => {
    const n = await note(c, typeof a.path === "string" ? a.path : undefined);
    const result = await checkTypos(settings, n.content, { from: n.selection?.start ?? 0, to: n.selection?.end ?? n.content.length, signal: c.signal }, new LLMClient(settings, { signal: c.signal, skills: [] }));
    const content = result.issues.length ? `发现 ${result.issues.length} 处疑似错别字：\n\n${result.issues.map(i => `- ${i.original} → ${i.correction}：${i.reason}`).join("\n")}\n\n点击「查看校对定位」核对原文。` : "本次检查未发现明确的错别字。";
    return { content: content + (result.unlocatedCount ? `\n\n${result.unlocatedCount} 条无法核对原文的建议已忽略。` : ""), proofreading: { path: n.path, content: n.content, selected: !!n.selection, result } };
  }});
  registry.add({ name: "knowledge.debt", label: "检查知识债务", description: "列出空概念、孤立问题、未完成阅读和超过90天的草稿。只读统计；补全请切到 Agent，使用 concept.complete 或 concept.complete_batch 生成修改预览。", fields: {}, execute: async () => {
    const groups = [
      ["空概念", index.getByType("concept").filter(e => ["empty", "pending"].includes(e.status ?? ""))],
      ["孤立问题", index.getByType("question").filter(e => !e.backlinks.length && !e.concepts.length)],
      ["未完成阅读", index.getAll().filter(e => e.path.includes("Reading/") && e.type !== "domain-index" && e.status !== "completed" && e.headings.some(h => /笔记|问题/.test(h)))],
      ["长期草稿", index.getAll().filter(e => e.status === "draft" && Date.now() - e.mtime > 90 * 86400000)],
    ] as const;
    return { content: groups.map(([label, entries]) => `## ${label}（${entries.length}）\n\n${entries.slice(0, 30).map(e => `- [[${e.path}]]`).join("\n") || "暂无"}${entries.length > 30 ? "\n仅列出前30项。" : ""}`).join("\n\n") + "\n\n可切换到 Agent，指定概念页补全，或每批补全最多5页；所有修改先预览再应用。" };
  }});
  registry.add({ name: "import.classify", label: "原稿智能分类", description: "对导入向导明确提供的原稿节选分类，units 是 JSON 数组 [{index,title,head}]，每批最多50项；返回 JSON 分类，不读写原稿文件。", fields: { units: { type: "string", required: true } }, execute: async a => {
    const units: unknown = JSON.parse(String(a.units));
    if (!Array.isArray(units) || !units.length || units.length > 50 || !units.every(u => u && Number.isInteger(u.index) && u.index >= 0 && typeof u.title === "string" && u.title.length <= 200 && typeof u.head === "string" && u.head.length <= 300) || new Set(units.map(u => u.index)).size !== units.length) throw new Error("原稿分类样本无效");
    const result = await new ImportClassifier(settings, client).classifyUnits(units as ClassifyUnit[]);
    return { content: JSON.stringify({ classifications: [...result].map(([index, kind]) => ({ index, kind })) }) };
  }});
  registry.add({ name: "import.analyze", label: "分析原稿元数据", description: "从导入向导提供的采样章节推断简介、文风、角色和设定。chapters 是 JSON 数组 [{number,title,content}]，最多8章；只返回 JSON 元数据，不创建项目。", fields: { title: { type: "string", required: true }, genre: { type: "string", required: true, choices: ["novel", "paper", "article"] }, chapters: { type: "string", required: true } }, execute: async a => {
    const chapters: unknown = JSON.parse(String(a.chapters));
    if (!Array.isArray(chapters) || chapters.length > 8 || !chapters.every(ch => ch && Number.isInteger(ch.number) && ch.number > 0 && typeof ch.title === "string" && ch.title.length <= 200 && typeof ch.content === "string" && ch.content.length <= 2500)) throw new Error("原稿分析样本无效");
    const result = await new ImportAnalyzer(settings, client).analyze(String(a.title), a.genre as WritingGenre, chapters as RawChapter[]);
    return { content: JSON.stringify(result) };
  }});
}
