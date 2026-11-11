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
