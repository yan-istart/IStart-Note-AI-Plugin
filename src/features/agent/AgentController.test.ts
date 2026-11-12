import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import type DeepSeekPlugin from "../../main";
import { AgentController, SYNC_HISTORY_PATH } from "./AgentController";
import { DEFAULT_SETTINGS } from "../../types";
import { LLMClient } from "../../core/llm";
import { createAgentTask } from "../../core/agent/AgentTasks";

function fixture() {
  const files = new Map<string, string>([["a.md", "original A"], ["b.md", "original B"]]);
  const folders = new Set<string>();
  const tfile = (path: string) => Object.assign(new TFile(), { path, basename: path.replace(/\.md$/, ""), extension: "md", name: path.split("/").pop()!, parent: { path: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "" } });
  const writes: string[] = [];
  const metadata = new Map<string, Record<string, unknown>>();
  const vault = {
    configDir: ".obsidian",
    adapter: { exists: async (p: string) => files.has(p) || folders.has(p), mkdir: async (p: string) => { folders.add(p); }, read: async (p: string) => files.get(p)!, write: async (p: string, text: string) => { files.set(p, text); } },
    getAbstractFileByPath: (p: string) => files.has(p) ? tfile(p) : folders.has(p) ? { path: p } : null,
    getMarkdownFiles: () => [...files.keys()].filter(p => p.endsWith(".md")).map(tfile),
    read: async (f: TFile) => files.get(f.path)!, cachedRead: async (f: TFile) => files.get(f.path)!,
    createFolder: async (p: string) => { folders.add(p); },
    create: async (p: string, text: string) => { if (files.has(p)) throw new Error("exists"); writes.push(p); files.set(p, text); return tfile(p); },
    modify: async (f: TFile, text: string) => { writes.push(f.path); files.set(f.path, text); },
    process: async (f: TFile, callback: (text: string) => string) => { const text = callback(files.get(f.path)!); writes.push(f.path); files.set(f.path, text); },
  };
  const app = { vault, workspace: { getLeavesOfType: () => [], getActiveViewOfType: () => null }, metadataCache: { getFileCache: (file: TFile) => metadata.has(file.path) ? { frontmatter: metadata.get(file.path) } : null } } as unknown as App;
  const plugin = { app, manifest: { id: "istart-note-ai", dir: ".obsidian/plugins/istart-note-ai" }, settings: { ...DEFAULT_SETTINGS, agent: { ...DEFAULT_SETTINGS.agent }, apiKey: "secret-test-key" }, skillRegistry: { ensureLoaded: async () => [] }, knowledgeIndex: { search: () => [], getByType: () => [] } } as unknown as DeepSeekPlugin;
  const controller = new AgentController(plugin);
  return { controller, plugin, files, writes, metadata };
}
async function storyFixture() {
  const f = fixture();
  f.files.set("作品/_作品.md", "---\ntype: writing-project\ngenre: novel\ntitle: 重逢\n---\n# 重逢");
  f.metadata.set("作品/_作品.md", { type: "writing-project", genre: "novel", title: "重逢" });
  f.files.set("作品/01-重逢.md", "# 重逢\n\n雨夜，两人在门口重逢。");
  f.metadata.set("作品/01-重逢.md", { type: "chapter", genre: "novel", title: "重逢", number: 1 });
  for (const name of ["林川", "阿宁"]) {
    f.files.set(`作品/_角色/${name}.md`, `---\ntype: character\nname: ${name}\nrole: support\n---\n# ${name}\n\n谨慎，有自己的原则。`);
    f.metadata.set(`作品/_角色/${name}.md`, { type: "character", name, role: "support" });
  }
  await f.controller.load(); f.controller.attach({ path: "作品/01-重逢.md" });
  f.controller.update(f.controller.active!.id, { mode: "story" });
  return f;
}
beforeEach(() => vi.stubGlobal("window", { setTimeout, clearTimeout }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("agent sidebar workflow", () => {
  it("executes a selected action as a real tool and keeps its result available for conversation", async () => {
    const { controller, plugin, writes, files } = fixture(); await controller.load();
    const source = { path: "a.md", selection: { start: 0, end: 8, text: "original", content: "original A" } };
    const task = createAgentTask("expand-selection", plugin.settings, source);
    const s = controller.prepareTask(task, [source]);
    const generation = vi.spyOn(LLMClient.prototype, "chat").mockResolvedValue("expanded");
    const planning = vi.spyOn(LLMClient.prototype, "chatMessages").mockResolvedValue('{"type":"answer","content":"follow-up explanation"}');
    await controller.submitTask(s.id);
    expect(generation).toHaveBeenCalledOnce(); expect(planning).not.toHaveBeenCalled(); expect(s.pendingTask).toBeUndefined();
    expect(s.messages[0].task?.actionId).toBe("expand-selection");
    expect(s.messages[1].steps?.[0]).toMatchObject({ tool: "document.generate", status: "completed" });
    expect(s.messages[1].proposals?.[0].changes[0].after).toBe("expanded A");
    expect(writes).toEqual([]); expect(files.get("a.md")).toBe("original A");
    await controller.send(s.id, "解释一下你做了什么调整");
    expect(s.messages[3].content).toBe("follow-up explanation");
    expect(JSON.stringify(planning.mock.calls[0][0])).toContain("expanded A");
    await controller.dispose();
  });
  it("preserves an existing chat draft and running session when opening a new task", async () => {
    const { controller, plugin } = fixture(); await controller.load();
    const original = controller.active!; controller.updateDraft(original.id, "未发出的讨论");
    const task = createAgentTask("new-reading-project", plugin.settings);
    const s = controller.prepareTask(task, []);
    expect(s.id).not.toBe(original.id); expect(original.draft).toBe("未发出的讨论");
    controller.updateTaskArgs(s.id, "book", "如何阅读一本书");
    controller.updateTaskArgs(s.id, "contents", "第一章：阅读的层次");
    await controller.dispose();
    const restored = new AgentController(plugin); await restored.load();
    expect(restored.active?.pendingTask?.args).toMatchObject({ book: "如何阅读一本书", contents: "第一章：阅读的层次" });
    expect(restored.sessions.find(session => session.id === original.id)?.draft).toBe("未发出的讨论");
    await restored.dispose();
  });
  it("refines an action-generated draft in the same conversation and applies only the latest version", async () => {
    const { controller, plugin, writes, files } = fixture(); await controller.load();
    const source = { path: "a.md", selection: { start: 0, end: 8, text: "original", content: "original A" } };
    const s = controller.prepareTask(createAgentTask("expand-selection", plugin.settings, source), [source]);
    const generation = vi.spyOn(LLMClient.prototype, "chat").mockResolvedValueOnce("expanded").mockResolvedValueOnce("short");
    const planning = vi.spyOn(LLMClient.prototype, "chatMessages")
      .mockResolvedValueOnce('{"type":"tool","name":"document.generate","args":{"task":"rewrite","instruction":"缩短刚才扩写的内容"}}')
      .mockResolvedValueOnce('{"type":"answer","content":"已缩短，等待应用。"}');
    await controller.submitTask(s.id); const first = s.messages[1].proposals![0];
    await controller.send(s.id, "缩短刚才扩写的内容");
    const latest = s.messages[3].proposals![0];
    expect(generation).toHaveBeenCalledTimes(2); expect(planning).toHaveBeenCalledTimes(2);
    expect(latest.changes[0]).toMatchObject({ before: "original A", after: "short A" });
    expect(first.status).toBe("superseded"); expect(writes).toEqual([]);
    await controller.apply(latest, s); expect(files.get("a.md")).toBe("short A"); expect(writes).toEqual(["a.md"]);
    await controller.dispose();
  });
  it("validates missing task parameters without losing the card or making model calls", async () => {
    const { controller, plugin } = fixture(); await controller.load();
    const task = createAgentTask("new-writing-project", plugin.settings), s = controller.prepareTask(task, []);
    const chat = vi.spyOn(LLMClient.prototype, "chatMessages");
    expect(() => controller.submitTask(s.id)).toThrow("作品名");
    expect(s.messages).toEqual([]); expect(s.pendingTask).toBeDefined(); expect(chat).not.toHaveBeenCalled();
    controller.cancelTask(s.id); expect(s.pendingTask).toBeUndefined();
    await controller.dispose();
  });
  it("regenerates the same selected task and refuses stale selections without redirecting the write", async () => {
    const { controller, plugin, files, writes } = fixture(); await controller.load();
    const source = { path: "a.md", selection: { start: 0, end: 8, text: "original", content: "original A" } };
    const task = createAgentTask("polish-writing", plugin.settings, source), s = controller.prepareTask(task, [source]);
    const chat = vi.spyOn(LLMClient.prototype, "chat").mockResolvedValueOnce("first").mockResolvedValueOnce("second");
    await controller.submitTask(s.id);
    await controller.retry(s.id, s.messages[1].id);
    expect(chat).toHaveBeenCalledTimes(2); expect(s.messages[3].content).toBe("second");
    expect(s.messages[1].proposals?.[0].status).toBe("superseded");
    files.set("a.md", "changed content");
    await controller.retry(s.id, s.messages[3].id);
    expect(chat).toHaveBeenCalledTimes(2); expect(s.messages[5].error).toContain("重新选中"); expect(writes).toEqual([]);
    s.references = [{ path: "b.md", selection: { start: 0, end: 8, text: "original", content: "original B" } }];
    await controller.retry(s.id, s.messages[5].id);
    expect(chat).toHaveBeenCalledTimes(2); expect(s.messages[7].error).toContain("重新选中"); expect(files.get("b.md")).toBe("original B");
    await controller.dispose();
  });
  it("continues a restored task without re-generating its completed draft or adding another user turn", async () => {
    const { controller, plugin, files, writes } = fixture(); await controller.load(); controller.attach({ path: "a.md" });
    const s = controller.active!;
    const chat = vi.spyOn(LLMClient.prototype, "chatMessages").mockResolvedValueOnce('{"type":"tool","name":"note.propose","args":{"path":"a.md","content":"draft","mode":"append"}}').mockRejectedValueOnce(new Error("network offline"));
    await controller.send(s.id, "append a paragraph");
    const replyId = s.messages[1].id; expect(s.messages[1].checkpoint).toBeDefined(); await controller.dispose();
    const restored = new AgentController(plugin); await restored.load(); const restoredSession = restored.active!;
    expect(restored.error).toBe(""); chat.mockReset().mockResolvedValue('{"type":"answer","content":"ready to apply"}');
    await restored.resume(restoredSession.id, replyId);
    expect(chat).toHaveBeenCalledOnce(); expect(restoredSession.messages).toHaveLength(2); expect(restoredSession.messages[1].proposals).toHaveLength(1);
    expect(restoredSession.messages[1].checkpoint).toBeUndefined(); expect(files.get("a.md")).toBe("original A"); expect(writes).toEqual([]);
    await restored.dispose();
  });
  it("refuses to resume after source edits and retains the old checkpoint and draft", async () => {
    const { controller, files } = fixture(); await controller.load(); controller.attach({ path: "a.md" }); const s = controller.active!;
    const chat = vi.spyOn(LLMClient.prototype, "chatMessages").mockRejectedValue(new Error("offline")); await controller.send(s.id, "research");
    const reply = s.messages[1]; files.set("a.md", "changed"); chat.mockClear();
    await controller.resume(s.id, reply.id);
    expect(chat).not.toHaveBeenCalled(); expect(reply.error).toContain("来源已变化"); expect(reply.checkpoint).toBeDefined(); expect(s.messages).toHaveLength(2);
    await controller.dispose();
  });
  it("keeps the next writing anchor at the insertion end and locks rejection/deletion while applying", async () => {
    const { controller } = fixture(); await controller.load(); controller.attach({ path: "a.md" });
    const s = controller.active!;
    const proposal = { id: "p", title: "insert", status: "pending" as const, changes: [{ path: "a.md", before: "original A", after: "orNEWiginal A" }] };
    const job = controller.apply(proposal, s);
    expect(() => controller.reject(proposal, s)).toThrow("等待"); expect(() => controller.remove(s.id)).toThrow("等待");
    await job; expect(s.references[0].cursor?.offset).toBe(5); await controller.dispose();
  });
  it("keeps generations as previews and applies to the captured file after switching sessions", async () => {
    const { controller, files, writes } = fixture(); await controller.load();
    controller.attach({ path: "a.md" }); const first = controller.active!;
    const chat = vi.spyOn(LLMClient.prototype, "chatMessages").mockResolvedValueOnce('{"type":"tool","name":"note.propose","args":{"path":"a.md","content":"addition","mode":"append"}}').mockResolvedValueOnce('{"type":"answer","content":"Draft ready"}');
    await controller.send(first.id, "append a paragraph");
    expect(chat).toHaveBeenCalledTimes(2); expect(writes).toEqual([]); expect(files.get("a.md")).toBe("original A");
    controller.create([{ path: "b.md" }]);
    const proposal = first.messages[1].proposals![0]; await controller.apply(proposal, first);
    expect(files.get("a.md")).toContain("addition"); expect(files.get("b.md")).toBe("original B");
    await controller.apply(proposal, first); expect(writes).toEqual(["a.md"]);
    await controller.dispose();
  });
  it("restores independent drafts and preserves stale-selection errors without generating", async () => {
    const { controller, files } = fixture(); await controller.load();
    controller.attach({ path: "a.md", selection: { start: 0, end: 8, text: "original", content: "original A" } });
    const s = controller.active!; controller.update(s.id, { draft: "saved A" });
    const b = controller.create([{ path: "b.md" }]); controller.update(b.id, { draft: "saved B" }); controller.select(s.id);
    expect(controller.active?.draft).toBe("saved A"); files.set("a.md", "external edit");
    const chat = vi.spyOn(LLMClient.prototype, "chatMessages");
    await controller.send(s.id, "rewrite selection");
    expect(chat).not.toHaveBeenCalled(); expect(s.messages[1].error).toContain("重新选中");
    expect(b.draft).toBe("saved B"); await controller.dispose();
  });
  it("cancels in-flight requests without executing their eventual tool calls", async () => {
    const { controller, writes } = fixture(); await controller.load(); controller.attach({ path: "a.md" });
    let finish!: (value: string) => void;
    const chat = vi.spyOn(LLMClient.prototype, "chatMessages").mockImplementation(() => new Promise<string>(resolve => { finish = resolve; }));
    const s = controller.active!; const task = controller.send(s.id, "modify note");
    await vi.waitFor(() => expect(chat).toHaveBeenCalledOnce()); controller.stop(s.id); await task;
    finish('{"type":"tool","name":"note.propose","args":{"path":"a.md","content":"late","mode":"append"}}');
    expect(s.messages[1].status).toBe("cancelled"); expect(s.messages[1].proposals).toEqual([]); expect(writes).toEqual([]);
    await controller.dispose();
  });
  it("creates branches without copying live pending writes and keeps local history out of the sync mirror by default", async () => {
    const { controller, files } = fixture(); await controller.load();
    const s = controller.active!; s.messages.push({ id: "old", role: "assistant", content: "draft", createdAt: 1, status: "completed", proposals: [{ id: "p", title: "edit", status: "pending", changes: [{ path: "a.md", before: "original A", after: "new" }] }] });
    const fork = controller.fork(s.id, "old"); expect(fork.parentId).toBe(s.id); expect(fork.messages[0].proposals![0].status).toBe("rejected");
    expect(s.messages[0].proposals![0].status).toBe("pending"); await controller.pushSharedHistory(); expect(files.has(SYNC_HISTORY_PATH)).toBe(false); await controller.dispose();
  });
  it("writes shared history only when enabled, without provider credentials", async () => {
    const { controller, plugin, files } = fixture(); await controller.load(); plugin.settings.agent.syncHistory = true;
    controller.update(controller.active!.id, { draft: "shared draft" }); await controller.pushSharedHistory();
    const content = files.get(SYNC_HISTORY_PATH)!; expect(content).toContain("shared draft"); expect(content).not.toContain("secret-test-key"); await controller.dispose();
  });
  it("confirms edited story text, stages character feedback, and uses applied cards in the next performance", async () => {
    const { controller, files, writes, plugin } = await storyFixture(); const s = controller.active!;
    controller.updateStoryConfig(s.id, { characterPaths: ["作品/_角色/林川.md", "作品/_角色/阿宁.md"], rounds: 1 });
    const originalCard = files.get("作品/_角色/林川.md")!;
    const chat = vi.spyOn(LLMClient.prototype, "chatMessages").mockResolvedValueOnce("林川攥住钥匙。").mockResolvedValueOnce("阿宁伸手请求同行。").mockResolvedValueOnce(JSON.stringify({ passages: ["", "", "旁白原稿：林川仍有犹豫。"] }));
    await controller.send(s.id, "围绕钥匙发生冲突"); const reply = s.messages[1];
    expect(reply.status).toBe("completed"); expect(reply.story?.turns).toHaveLength(3); expect(writes).toEqual([]);
    const approved = "林川把钥匙交给了阿宁，终于愿意让她同行。";
    chat.mockResolvedValueOnce(JSON.stringify({ updates: [{ path: "作品/_角色/林川.md", insight: "开始试着信任阿宁，依然保持谨慎。", evidence: ["把钥匙交给了阿宁"] }] }));
    await controller.confirmStory(s.id, reply.id, approved);
    expect(reply.content).toBe(approved); expect(reply.story?.confirmedAt).toBeTypeOf("number"); expect(reply.story?.evolution?.status).toBe("completed");
    expect(chat.mock.calls[3][0][0].content).not.toContain("旁白原稿"); expect(files.get("作品/_角色/林川.md")).toBe(originalCard); expect(writes).toEqual([]);
    chat.mockClear(); await controller.send(s.id, "继续演绎"); expect(chat).not.toHaveBeenCalled(); expect(s.messages[s.messages.length - 1].error).toContain("先应用或放弃");
    await controller.apply(reply.proposals![0], s); expect(files.get("作品/_角色/林川.md")).toContain("开始试着信任阿宁");
    chat.mockImplementation(async (_messages, options) => options?.systemPrompt?.includes("你是旁白 Agent") ? JSON.stringify({ passages: ["", "", ""] }) : "新的场景正文。"); await controller.send(s.id, "继续对话");
    expect(chat.mock.calls[0][0][0].content).toContain("开始试着信任阿宁"); expect(chat.mock.calls[0][0][0].content).toContain(approved); expect(chat.mock.calls[0][0][0].content).not.toContain("旁白原稿");
    await controller.dispose();
    const restored = new AgentController(plugin); await restored.load(); expect(restored.error).toBe("");
    expect(restored.active!.mode).toBe("story"); expect(restored.active!.storyConfig?.rounds).toBe(1); expect(restored.active!.messages[1].story?.evolution?.status).toBe("completed");
    await restored.dispose();
  });
  it("retains confirmed canon after evolution failure and retries only the character analysis", async () => {
    const { controller, writes } = await storyFixture(); const s = controller.active!;
    const chat = vi.spyOn(LLMClient.prototype, "chatMessages").mockResolvedValueOnce("林川动作。").mockResolvedValueOnce("阿宁台词。").mockResolvedValueOnce(JSON.stringify({ passages: ["", "", "林川把钥匙交给了阿宁。"] }));
    await controller.send(s.id, "演绎"); const reply = s.messages[1];
    chat.mockResolvedValueOnce(JSON.stringify({ updates: [{ path: "作品/_角色/林川.md", insight: "变得暴躁", evidence: ["不存在的事件"] }] }));
    await controller.confirmStory(s.id, reply.id);
    expect(reply.story?.evolution?.status).toBe("error"); expect(reply.story?.confirmedAt).toBeDefined(); expect(reply.proposals).toEqual([]);
    chat.mockClear().mockResolvedValue('{"updates":[]}'); await controller.confirmStory(s.id, reply.id, "重试时不得修改已确认内容");
    expect(chat).toHaveBeenCalledOnce(); expect(reply.content).toBe("林川动作。\n\n阿宁台词。\n\n林川把钥匙交给了阿宁。"); expect(reply.story?.evolution?.status).toBe("completed"); expect(writes).toEqual([]);
    await expect(controller.confirmStory(s.id, reply.id)).rejects.toThrow("已完成"); await controller.dispose();
  });
  it("keeps a scene unconfirmed when saving confirmation fails and permits another confirmation attempt", async () => {
    const { controller } = await storyFixture(); const s = controller.active!;
    const chat = vi.spyOn(LLMClient.prototype, "chatMessages").mockResolvedValueOnce("林川动作。").mockResolvedValueOnce("阿宁台词。").mockResolvedValueOnce(JSON.stringify({ passages: ["", "", "原始剧情正文。"] }));
    await controller.send(s.id, "演绎"); const reply = s.messages[1];
    chat.mockClear(); vi.spyOn(controller, "persist").mockRejectedValueOnce(new Error("disk full"));
    await controller.confirmStory(s.id, reply.id, "修订后的剧情正文。");
    expect(chat).not.toHaveBeenCalled(); expect(reply.content).toBe("林川动作。\n\n阿宁台词。\n\n原始剧情正文。"); expect(reply.story?.confirmedAt).toBeUndefined(); expect(reply.status).toBe("completed");
    chat.mockResolvedValue('{"updates":[]}'); await controller.confirmStory(s.id, reply.id, "修订后的剧情正文。");
    expect(reply.content).toBe("修订后的剧情正文。"); expect(reply.story?.confirmedAt).toBeDefined(); expect(reply.story?.evolution?.status).toBe("completed");
    await controller.dispose();
  });
  it("cancels character evolution while keeping confirmed text and rejecting late updates", async () => {
    const { controller, writes } = await storyFixture(); const s = controller.active!;
    const chat = vi.spyOn(LLMClient.prototype, "chatMessages").mockResolvedValueOnce("林川动作。").mockResolvedValueOnce("阿宁台词。").mockResolvedValueOnce(JSON.stringify({ passages: ["", "", "林川把钥匙交给了阿宁。"] }));
    await controller.send(s.id, "演绎"); const reply = s.messages[1];
    let finish!: (value: string) => void;
    chat.mockClear().mockImplementation(() => new Promise<string>(resolve => { finish = resolve; }));
    const job = controller.confirmStory(s.id, reply.id); await vi.waitFor(() => expect(chat).toHaveBeenCalledOnce()); controller.stop(s.id); await job;
    finish('{"updates":[]}'); expect(reply.story?.confirmedAt).toBeDefined(); expect(reply.story?.evolution?.status).toBe("error"); expect(reply.proposals).toEqual([]); expect(writes).toEqual([]);
    await controller.dispose();
  });
  it("rejects non-novel contexts and roles outside the referenced project before generating", async () => {
    const f = fixture(); await f.controller.load(); const s = f.controller.active!; f.controller.attach({ path: "a.md" }); f.controller.update(s.id, { mode: "story" });
    const chat = vi.spyOn(LLMClient.prototype, "chatMessages"); await f.controller.send(s.id, "演绎"); expect(chat).not.toHaveBeenCalled(); expect(s.messages[1].error).toContain("小说项目"); await f.controller.dispose();
    const second = await storyFixture(); const ss = second.controller.active!; second.controller.updateStoryConfig(ss.id, { characterPaths: ["另一部小说/_角色/配角.md"], rounds: 1 });
    await second.controller.send(ss.id, "演绎"); expect(chat).not.toHaveBeenCalled(); expect(ss.messages[1].error).toContain("不属于当前小说项目"); await second.controller.dispose();
  });
});

describe("native tasks and stable Agent insertion targets", () => {
  it("records import tasks in one isolated conversation without overwriting the current draft", async () => {
    const f = fixture(); await f.controller.load();
    const original = f.controller.active!; f.controller.updateDraft(original.id, "未发送的内容");
    const classify = createAgentTask("import-classify", f.plugin.settings);
    classify.args.units = JSON.stringify([{ index: 0, title: "设定", head: "世界观" }]);
    const chat = vi.spyOn(LLMClient.prototype, "chat").mockResolvedValueOnce('{"classifications":[{"index":0,"kind":"setting"}]}').mockResolvedValueOnce('{"one_liner":"故事","style_profile":"克制","characters":[],"world_settings":[]}');
    const first = await f.controller.executeTask(classify);
    expect(first.sessionId).not.toBe(original.id); expect(original.draft).toBe("未发送的内容");
    const analyze = createAgentTask("import-analyze", f.plugin.settings);
    Object.assign(analyze.args, { title: "原稿", genre: "novel", chapters: JSON.stringify([{ number: 1, title: "开篇", content: "正文" }]) });
    const second = await f.controller.executeTask(analyze, first.sessionId);
    expect(second.sessionId).toBe(first.sessionId);
    expect(f.controller.active!.messages).toHaveLength(4);
    expect(JSON.parse(second.message.content).styleProfile).toBe("克制");
    expect(chat).toHaveBeenCalledTimes(2); expect(f.writes).toEqual([]);
    await f.controller.dispose();
  });
  it("cancels a wizard task through its signal and rejects late model output", async () => {
    const f = fixture(); await f.controller.load();
    const abort = new AbortController(), task = createAgentTask("import-classify", f.plugin.settings);
    task.args.units = '[{"index":0,"title":"x","head":"x"}]';
    let finish!: (value: string) => void;
    const chat = vi.spyOn(LLMClient.prototype, "chat").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.controller.executeTask(task, undefined, abort.signal);
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(chat).toHaveBeenCalledOnce());
    abort.abort(); await rejected;
    finish('{"classifications":[{"index":0,"kind":"chapter"}]}');
    expect(f.controller.active!.messages[1].status).toBe("cancelled"); expect(f.writes).toEqual([]);
    await f.controller.dispose();
  });
  it("persists verified proofreading positions with a readonly Agent task", async () => {
    const f = fixture(); f.files.set("a.md", "再接再励。"); await f.controller.load();
    vi.spyOn(LLMClient.prototype, "chat").mockResolvedValue('{"issues":[{"line":1,"original":"再接再励","correction":"再接再厉","occurrence":1}]}');
    const task = createAgentTask("check-typos", f.plugin.settings, { path: "a.md" });
    const s = f.controller.prepareTask(task, [{ path: "a.md" }]);
    await f.controller.submitTask(s.id);
    expect(s.messages[1].status).toBe("completed");
    expect(s.messages[1].proofreading?.result.issues[0]).toMatchObject({ start: 0, end: 4 });
    expect(s.messages[1].proposals).toEqual([]); expect(f.writes).toEqual([]);
    await f.controller.dispose(); const restored = new AgentController(f.plugin); await restored.load();
    expect(restored.active!.messages[1].proofreading?.content).toBe("再接再励。");
    await restored.dispose();
  });
  it("keeps an immutable remembered cursor after the editor loses focus", async () => {
    const f = fixture(); await f.controller.load(); let offset = 4;
    const file = Object.assign(new TFile(), { path: "a.md" });
    const editor = { getValue: () => "original A", getCursor: () => ({ line: 0, ch: offset }), posToOffset: (p: { ch: number }) => p.ch } as any;
    f.controller.rememberEditor(editor, file); offset = 0;
    const captured = f.controller.captureCurrent()!;
    expect(captured.cursor?.offset).toBe(4);
    captured.cursor!.offset = 1;
    expect(f.controller.captureCurrent()!.cursor!.offset).toBe(4);
    await f.controller.dispose();
  });
  it("prefers the current conversation target over another editor's remembered location", async () => {
    const f = fixture(); await f.controller.load();
    f.controller.setInsertionReference(f.controller.active!.id, { path: "a.md", cursor: { offset: 3, content: "original A" } });
    f.controller.rememberEditor({ getValue: () => "original B", getCursor: () => ({ line: 0, ch: 1 }), posToOffset: (p: { ch: number }) => p.ch } as any, Object.assign(new TFile(), { path: "b.md" }));
    expect(f.controller.captureCurrent()!.path).toBe("b.md");
    expect(f.controller.captureTaskReference()).toMatchObject({ path: "a.md", cursor: { offset: 3 } });
    await f.controller.dispose();
  });
  it("can insert an existing answer at an explicitly chosen position without regenerating", async () => {
    const f = fixture(); await f.controller.load(); const s = f.controller.active!;
    f.controller.attach({ path: "a.md" });
    vi.spyOn(LLMClient.prototype, "chatMessages").mockResolvedValue('{"type":"answer","content":"新增内容"}');
    await f.controller.send(s.id, "生成一段文字"); const answer = s.messages[1];
    f.controller.setInsertionReference(s.id, { path: "a.md", cursor: { offset: 3, content: "original A" } });
    f.controller.offerAnswer(s, answer, "insert-target");
    expect(f.files.get("a.md")).toBe("original A");
    await f.controller.apply(answer.proposals![0], s);
    expect(f.files.get("a.md")).toBe("ori\n\n新增内容\nginal A");
    expect(f.controller.captureTaskReference()!.cursor?.offset).toBe(10);
    await f.controller.dispose();
  });
  it("refuses stale chosen insertion snapshots even when focus and sessions have changed", async () => {
    const f = fixture(); await f.controller.load(); const s = f.controller.active!;
    const answer = { id: "answer", role: "assistant" as const, content: "新增内容", createdAt: 1 };
    s.messages.push(answer);
    f.controller.setInsertionReference(s.id, { path: "a.md", cursor: { offset: 3, content: "original A" } });
    f.files.set("a.md", "手动修改后的原文");
    f.controller.offerAnswer(s, answer, "insert-target");
    await expect(f.controller.apply(s.messages[0].proposals![0], s)).rejects.toThrow();
    expect(f.files.get("a.md")).toBe("手动修改后的原文"); expect(f.writes).toEqual([]);
    await f.controller.dispose();
  });
});
