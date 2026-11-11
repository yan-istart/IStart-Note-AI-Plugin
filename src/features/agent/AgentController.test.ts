import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import type DeepSeekPlugin from "../../main";
import { AgentController, SYNC_HISTORY_PATH } from "./AgentController";
import { DEFAULT_SETTINGS } from "../../types";
import { LLMClient } from "../../core/llm";

function fixture() {
  const files = new Map<string, string>([["a.md", "original A"], ["b.md", "original B"]]);
  const folders = new Set<string>();
  const tfile = (path: string) => Object.assign(new TFile(), { path, basename: path.replace(/\.md$/, ""), extension: "md", name: path.split("/").pop()!, parent: { path: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "" } });
  const writes: string[] = [];
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
  const app = { vault, workspace: { getLeavesOfType: () => [], getActiveViewOfType: () => null }, metadataCache: { getFileCache: () => null } } as unknown as App;
  const plugin = { app, manifest: { id: "istart-note-ai", dir: ".obsidian/plugins/istart-note-ai" }, settings: { ...DEFAULT_SETTINGS, agent: { ...DEFAULT_SETTINGS.agent }, apiKey: "secret-test-key" }, skillRegistry: { ensureLoaded: async () => [] }, knowledgeIndex: { search: () => [], getByType: () => [] } } as unknown as DeepSeekPlugin;
  const controller = new AgentController(plugin);
  return { controller, plugin, files, writes };
}
beforeEach(() => vi.stubGlobal("window", { setTimeout, clearTimeout }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("agent sidebar workflow", () => {
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
});
