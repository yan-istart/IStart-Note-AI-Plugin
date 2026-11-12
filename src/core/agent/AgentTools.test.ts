import { afterEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import { AgentTools } from "./AgentTools";
import { DEFAULT_SETTINGS } from "../../types";
import { LLMClient } from "../llm";
import type { KnowledgeIndexService } from "../knowledge";
import type { AgentRunContext, NoteSnapshot } from "./types";
import { WritingPlanner } from "../../ai/WritingPlanner";
import { ReadingPlanner } from "../../ai/ReadingPlanner";
import { ConceptCompleter } from "../../ai/ConceptCompleter";
import { DeepSeekClient } from "../../ai/DeepSeekClient";
import { QuestionClassifier } from "../../ai/QuestionClassifier";
import { buildWritingProjectDraft } from "./ProjectDraft";
import { AgentRunner } from "./AgentRunner";
import { newSession } from "./types";
import { applyChanges } from "./Changes";

function fixture(note: NoteSnapshot = { path: "note.md", content: "first paragraph", selection: { start: 0, end: 5, text: "first", content: "first paragraph" } }) {
  const write = vi.fn();
  const file = (path: string) => Object.assign(new TFile(), { path, basename: path.split("/").pop()!.replace(/\.md$/, "") });
  const app = { vault: { getAbstractFileByPath: (path: string) => path === note.path ? file(path) : null, getMarkdownFiles: () => [file(note.path)], read: async () => note.content, create: write, modify: write }, workspace: { getLeavesOfType: () => [] } } as unknown as App;
  const client = new LLMClient({ ...DEFAULT_SETTINGS, apiKey: "test" }, { skills: [] });
  const registry = new AgentTools(app, DEFAULT_SETTINGS, { getByType: () => [], search: () => [] } as unknown as KnowledgeIndexService, client).registry;
  const context: AgentRunContext = { sessionId: "s", mode: "agent", notes: new Map([[note.path, note]]), primary: note, scope: null, searchVault: true, signal: new AbortController().signal, sources: new Set() };
  return { client, context, registry, write, execute: async (name: string, args: object) => { const request = registry.get(name, args, context.mode); return request.tool.execute(request.args, context); } };
}
afterEach(() => vi.restoreAllMocks());
describe("existing AI capabilities as Agent tools", () => {
  it("refines the generated selection in an unsaved draft without changing surrounding prose", async () => {
    const f = fixture(); const chat = vi.spyOn(f.client, "chat").mockResolvedValueOnce("expanded words").mockResolvedValueOnce("short");
    const first = await f.execute("document.generate", { task: "expand" });
    f.context.drafts = new Map(first.proposals![0].changes.map(change => [change.path, change]));
    const refined = await f.execute("document.generate", { task: "rewrite", instruction: "缩短刚才扩写的内容" });
    expect(chat.mock.calls[1][0].userPrompt).toContain("选区：expanded words");
    expect(refined.proposals?.[0].changes[0].after).toBe("short paragraph"); expect(f.write).not.toHaveBeenCalled();
  });
  it("honors end-of-document continuation, exact length targets and context scope", async () => {
    const f = fixture({ path: "note.md", content: "开头\n\n末尾", cursor: { offset: 2, content: "开头\n\n末尾" } });
    f.context.writing = null;
    const chat = vi.spyOn(f.client, "chat").mockResolvedValue("新增正文");
    const result = await f.execute("writing.generate", { task: "continue", mode: "chapter", targetWords: 1, contextScope: "full" });
    expect(chat.mock.calls[0][0].userPrompt).toContain("上文：开头\n\n末尾");
    expect(chat.mock.calls[0][0].userPrompt).toContain("约1字"); expect(chat.mock.calls[0][0].thinking).toBe("disabled");
    expect(result.proposals?.[0].changes[0].after).toBe("开头\n\n末尾\n\n新增正文\n"); expect(f.write).not.toHaveBeenCalled();
  });
  it("rejects insertion at the document end before making a generation request", async () => {
    const f = fixture({ path: "note.md", content: "只有上文", cursor: { offset: 4, content: "只有上文" } });
    f.context.writing = null;
    const chat = vi.spyOn(f.client, "chat");
    await expect(f.execute("writing.generate", { task: "insert" })).rejects.toThrow("两段正文之间"); expect(chat).not.toHaveBeenCalled();
  });
  it("finishes a reading project in consecutive tool steps with one coherent, applicable preview", async () => {
    const f = fixture();
    vi.spyOn(ReadingPlanner.prototype, "planSkeleton").mockResolvedValue({ bookTitle: "Book", author: "Author", oneLiner: "summary", coreQuestions: ["why?"], prerequisites: ["Basics"], keyConcepts: [], chapterRelations: ["A --> B"], chapters: [{ number: 1, title: "One", summary: "intro", importance: "core", keyConcepts: [] }, { number: 2, title: "Two", summary: "more", importance: "recommended", keyConcepts: [] }] });
    const questions = vi.spyOn(ReadingPlanner.prototype, "generateChapterQuestions").mockImplementation(async (_book, chapter) => ({ number: chapter.number, title: chapter.title, questions: [`Why ${chapter.title}?`] }));
    const replies = ['{"type":"tool","name":"reading.plan","args":{"book":"Book"}}', '{"type":"tool","name":"reading.resume","args":{"path":"Knowledge/Reading/Book/_索引.md"}}', '{"type":"tool","name":"reading.resume","args":{"path":"Knowledge/Reading/Book/_索引.md"}}', '{"type":"answer","content":"ready"}'];
    const session = newSession(); session.messages.push({ id: "user", role: "user", content: "build the entire reading project", createdAt: 1 });
    const result = await new AgentRunner({ chatMessages: vi.fn(async () => replies.shift()!) }, f.registry).run(session, f.context, DEFAULT_SETTINGS.agent, () => {});
    expect(result.status).toBe("completed"); expect(questions).toHaveBeenCalledTimes(2); expect(f.write).not.toHaveBeenCalled();
    const pending = result.proposals!.filter(p => p.status === "pending"); expect(pending).toHaveLength(1);
    const index = pending[0].changes.find(c => c.path.endsWith("_索引.md"))!;
    expect(index.before).toBeNull(); expect(index.after).toContain("generation_status: complete"); expect(index.after).toContain("chapters_generated: 2"); expect(index.after).toContain("A --> B");
    const files = new Map<string, string>(); await applyChanges(pending[0], { read: async path => files.get(path) ?? null, write: async c => { files.set(c.path, c.after); } });
    expect(files.size).toBe(3); expect(files.get("Knowledge/Reading/Book/01-One.md")).toContain("Why One?"); expect(files.get("Knowledge/Reading/Book/02-Two.md")).toContain("Why Two?");
  });
  it("revises an unsaved draft across turns and keeps only the latest version applicable", async () => {
    const f = fixture(), session = newSession(); session.messages.push({ id: "u1", role: "user", content: "draft", createdAt: 1 });
    const first = ['{"type":"tool","name":"note.create","args":{"title":"Draft","content":"first"}}', '{"type":"answer","content":"ready"}'];
    const old = await new AgentRunner({ chatMessages: vi.fn(async () => first.shift()!) }, f.registry).run(session, f.context, DEFAULT_SETTINGS.agent, () => {});
    session.messages.push({ id: "u2", role: "user", content: "append to that draft", createdAt: 2 });
    const next = ['{"type":"tool","name":"note.read","args":{"path":"Knowledge/Q&A/Draft.md"}}', '{"type":"tool","name":"note.propose","args":{"path":"Knowledge/Q&A/Draft.md","mode":"append","content":"second"}}', '{"type":"answer","content":"revised"}'];
    const revised = await new AgentRunner({ chatMessages: vi.fn(async () => next.shift()!) }, f.registry).run(session, f.context, DEFAULT_SETTINGS.agent, () => {});
    expect(old.proposals![0].status).toBe("superseded"); expect(revised.proposals![0].changes[0]).toMatchObject({ before: null, after: "first\n\nsecond\n" }); expect(f.write).not.toHaveBeenCalled();
  });
  it("reads later pages without skipping content truncated by the observation budget", async () => {
    const f = fixture({ path: "long.md", content: "a".repeat(18000) + "ending" });
    const first = await f.execute("note.read", { path: "long.md", offset: 0, length: 18000 });
    const next = Number(/下一段 offset=(\d+)/.exec(first.content)![1]); expect(next).toBeLessThan(18000); expect(first.content.length).toBeLessThan(DEFAULT_SETTINGS.agent.contextChars * .25);
    const final = await f.execute("note.read", { path: "long.md", offset: 18000, length: 100 }); expect(final.content).toContain("ending"); expect(final.content).toContain("已读到结尾");
    await expect(f.execute("note.read", { path: "long.md", offset: -1 })).rejects.toThrow("范围");
  });
  it("turns rewrite and annotation output into exact selection changes without writing", async () => {
    const f = fixture(); vi.spyOn(f.client, "chat").mockResolvedValue("new words");
    const rewrite = await f.execute("document.generate", { task: "rewrite" });
    expect(rewrite.proposals![0].changes[0].after).toBe("new words paragraph");
    const annotation = await f.execute("annotation.assist", { task: "draft" });
    expect(annotation.proposals![0].changes[0].after).toBe("==first==^[new words] paragraph");
    expect(f.write).not.toHaveBeenCalled();
    f.context.mode = "ask";
    expect((await f.execute("document.generate", { task: "summarize" })).proposals).toBeUndefined();
  });
  it("creates project previews compatible with the writing frontmatter protocol", async () => {
    const f = fixture();
    vi.spyOn(WritingPlanner.prototype, "plan").mockResolvedValue({ title: "Story", oneLiner: "premise", styleProfile: "short paragraphs", chapters: [{ number: 1, title: "Start", synopsis: "Meet the hero" }], characters: [{ name: "Hero", role: "protagonist", summary: "driven" }], worldSettings: [{ name: "City", category: "world", content: "rainy" }] });
    const result = await f.execute("writing.plan", { genre: "novel", title: "Story", premise: "premise" });
    const changes = result.proposals![0].changes;
    expect(changes.map(c => c.path)).toContain("Writing/Novels/Story/_作品.md");
    expect(changes.find(c => c.path.endsWith("01-Start.md"))?.after).toContain('type: "chapter"');
    expect(changes.find(c => c.path.endsWith("_角色/Hero.md"))?.after).toContain('role: "protagonist"');
    expect(changes.every(c => c.before === null)).toBe(true); expect(f.write).not.toHaveBeenCalled();
  });
  it("creates reading notes that the existing resume workflow recognizes", async () => {
    const f = fixture();
    vi.spyOn(ReadingPlanner.prototype, "planSkeleton").mockResolvedValue({ bookTitle: "Book", author: "Author", oneLiner: "summary", coreQuestions: ["why?"], prerequisites: [], keyConcepts: ["concept"], chapterRelations: [], chapters: [{ number: 1, title: "One", summary: "intro", importance: "core", keyConcepts: [] }] });
    const result = await f.execute("reading.plan", { book: "Book" });
    expect(result.proposals![0].changes[0].path).toBe("Knowledge/Reading/Book/_索引.md");
    expect(result.proposals![0].changes[1].after).toContain("type: reading-note");
    expect(result.proposals![0].changes[1].after).toContain("questions_generated: false"); expect(f.write).not.toHaveBeenCalled();
  });
  it("uses the existing concept renderer to preserve filled sections", async () => {
    const f = fixture({ path: "term.md", content: "# Term\n\n## 定义\n\n## 我的理解\n\nPreserve this\n" });
    vi.spyOn(ConceptCompleter.prototype, "complete").mockResolvedValue({ definition: "definition", explanation: "explanation", examples: [], related_concepts: [], related_questions: [], tags: [] });
    const result = await f.execute("concept.complete", { path: "term.md", depth: "standard" });
    const change = result.proposals![0].changes[0]; expect(change.after).toContain("Preserve this"); expect(change.after).toContain("definition"); expect(f.write).not.toHaveBeenCalled();
  });
  it("generates Q&A, concept placeholders, and a question index as one preview", async () => {
    const f = fixture();
    vi.spyOn(QuestionClassifier.prototype, "classify").mockResolvedValue({ category: "new", parent: null, related: [], confidence: 1, refinements: ["next?"], expansions: [] });
    vi.spyOn(DeepSeekClient.prototype, "ask").mockResolvedValue({ answer: "answer", concepts: ["Term"], tags: ["tag"], relations: [] });
    const result = await f.execute("question.generate", { question: "Why?" });
    const changes = result.proposals![0].changes;
    expect(changes).toHaveLength(3); expect(changes[0].after).toContain('type: "question"'); expect(changes[1].path).toBe("Knowledge/Questions/问题索引.md"); expect(changes[2].path).toContain("_未分类/Term.md"); expect(f.write).not.toHaveBeenCalled();
  });
  it("validates template content before rendering a saved template preview", async () => {
    const f = fixture(); vi.spyOn(f.client, "chat").mockResolvedValue(JSON.stringify({ title: "Checklist", sourceLinks: ["note.md"], items: [{ title: "Do it", sourceLinks: ["note.md"] }] }));
    const result = await f.execute("artifact.generate", { type: "checklist", target: "Practice" });
    expect(result.proposals![0].changes[0].path).toBe("Knowledge/Artifacts/Checklist.md"); expect(result.content).toContain("Do it"); expect(f.write).not.toHaveBeenCalled();
  });
  it("previews a template and today's run together, honoring usage mode and evidence policy", async () => {
    const f = fixture(); vi.spyOn(f.client, "chat").mockResolvedValue(JSON.stringify({ title: "Checklist", sourceLinks: ["note.md"], items: [{ title: "Practice", sourceLinks: ["note.md"] }] }));
    const result = await f.execute("artifact.generate", { type: "checklist", target: "Practice", createRun: true, usageMode: "recurring", evidencePolicy: "strict" });
    expect(result.proposals![0].changes).toHaveLength(2); expect(result.proposals![0].changes[0].after).toContain("usage_mode: recurring");
    expect(result.proposals![0].changes[1].after).toContain("type: execution-artifact-run"); expect(result.proposals![0].changes[1].after).toContain("- [ ] Practice"); expect(f.write).not.toHaveBeenCalled();
    vi.mocked(f.client.chat).mockResolvedValue(JSON.stringify({ title: "Invalid", items: [{ title: "guess", inferred: true }] }));
    await expect(f.execute("artifact.generate", { type: "checklist", target: "Practice", evidencePolicy: "strict" })).rejects.toThrow("严格来源");
  });
  it("rejects invalid project structure and duplicate filenames before proposing changes", () => {
    const plan = { title: "x", oneLiner: "", styleProfile: "", chapters: [{ number: 1, title: "A", synopsis: "a" }, { number: 1, title: "A", synopsis: "b" }], characters: [], worldSettings: [] };
    expect(() => buildWritingProjectDraft(plan, "article", "Writing")).toThrow("重复");
    plan.chapters[0].number = NaN; expect(() => buildWritingProjectDraft(plan, "article", "Writing")).toThrow("格式");
  });
});

describe("remaining capabilities use Agent previews and readonly results", () => {
  it("beautifies the captured whole document and never writes during generation", async () => {
    const f = fixture();
    const chat = vi.spyOn(f.client, "chat").mockResolvedValue("<!-- mode:replace -->\n# 整理\n\n保留内容");
    const result = await f.execute("document.beautify", {});
    expect(chat).toHaveBeenCalledOnce();
    expect(result.proposals![0].changes[0]).toMatchObject({ path: "note.md", before: "first paragraph" });
    expect(result.proposals![0].changes[0].after).toContain("保留内容");
    expect(f.write).not.toHaveBeenCalled();
    f.context.mode = "ask";
    await expect(f.execute("document.beautify", {})).rejects.toThrow("不可用");
  });
  it.each(["rewrite", "suggest"])("%s an existing shared footnote without changing another reference", async task => {
    const { parseAnnotations } = await import("../annotations/AnnotationParser");
    const content = "==甲==[^1] 和 ==乙==[^1]\n\n[^1]: 原批注\n";
    const annotation = parseAnnotations(content)[0];
    const f = fixture({ path: "note.md", content, annotation: "原批注", selection: { start: annotation.contentStart, end: annotation.contentEnd, text: content.slice(annotation.contentStart, annotation.contentEnd), content } });
    vi.spyOn(f.client, "chat").mockResolvedValue("新建议");
    const result = await f.execute("annotation.assist", { task, annotationId: annotation.id });
    const after = result.proposals![0].changes[0].after;
    expect(after).toContain("==乙==[^1]"); expect(after).toContain("[^1]: 原批注");
    const parsed = parseAnnotations(after);
    expect(parsed[0].comment).toContain("新建议"); expect(parsed[1].comment).toBe("原批注");
    if (task === "suggest") expect(parsed[0].comment).toContain("原批注");
    expect(f.write).not.toHaveBeenCalled();
    await expect(f.execute("annotation.assist", { task, annotationId: "stale" })).rejects.toThrow("位置已变化");
  });
  it("validates import samples before calling a model and ignores indices outside the submitted batch", async () => {
    const f = fixture();
    const chat = vi.spyOn(f.client, "chat").mockResolvedValue('{"classifications":[{"index":0,"kind":"setting"},{"index":999,"kind":"skip"}]}');
    await expect(f.execute("import.classify", { units: JSON.stringify([{ index: -1, title: "x", head: "x" }]) })).rejects.toThrow("样本无效");
    expect(chat).not.toHaveBeenCalled();
    const result = await f.execute("import.classify", { units: JSON.stringify([{ index: 0, title: "设定", head: "世界观" }]) });
    expect(JSON.parse(result.content).classifications).toEqual([{ index: 0, kind: "setting" }]);
    expect(result.proposals).toBeUndefined(); expect(f.write).not.toHaveBeenCalled();
  });
  it("returns import metadata through the existing analyzer without creating project files", async () => {
    const f = fixture();
    vi.spyOn(f.client, "chat").mockResolvedValue('{"one_liner":"故事","style_profile":"克制","characters":[],"world_settings":[]}');
    const result = await f.execute("import.analyze", { title: "原稿", genre: "novel", chapters: JSON.stringify([{ number: 1, title: "开篇", content: "故事正文" }]) });
    expect(JSON.parse(result.content)).toMatchObject({ oneLiner: "故事", styleProfile: "克制" });
    expect(result.proposals).toBeUndefined(); expect(f.write).not.toHaveBeenCalled();
  });
  it.each(["insert", "continue"])("preserves full prose on both sides for %s with the original cursor", async task => {
    const before = "开头事实。" + "上文。".repeat(1500), after = "下文。".repeat(1500) + "章末事实。";
    const content = "---\ntype: chapter\n---\n" + before + after;
    const f = fixture({ path: "note.md", content, cursor: { offset: content.indexOf(after), content } });
    f.context.writing = null;
    const chat = vi.spyOn(f.client, "chat").mockResolvedValue("衔接正文");
    const result = await f.execute("writing.generate", { task, contextScope: "full", mode: "cursor", targetWords: 123 });
    expect(chat.mock.calls[0][0].userPrompt).toContain(before);
    expect(chat.mock.calls[0][0].userPrompt).toContain(after);
    expect(chat.mock.calls[0][0].userPrompt).not.toContain("type: chapter");
    expect(result.proposals![0].changes[0].after).toContain(before + "\n衔接正文\n" + after);
    expect(f.write).not.toHaveBeenCalled();
  });
});

it("does not turn invalid manuscript metadata into a successful import analysis", async () => {
  const f = fixture();
  vi.spyOn(f.client, "chat").mockResolvedValue('{"one_liner":{},"style_profile":42}');
  await expect(f.execute("import.analyze", { title: "原稿", genre: "article", chapters: '[{"number":1,"title":"正文","content":"正文内容"}]' })).rejects.toThrow("格式无效");
  expect(f.write).not.toHaveBeenCalled();
});
