import { describe, it, expect } from "vitest";
import { SessionStore, parseSessionData } from "./SessionStore";
import { newSession } from "./types";
import { createAgentTask } from "./AgentTasks";
import { DEFAULT_SETTINGS } from "../../types";

function storage() {
  const files = new Map<string, string>();
  return { files, adapter: { exists: async (p: string) => files.has(p), mkdir: async () => {}, read: async (p: string) => files.get(p)!, write: async (p: string, s: string) => { files.set(p, s); } } };
}
describe("agent sessions", () => {
  it("restores task cards and completed direct-tool checkpoints, rejecting incompatible task data", async () => {
    const { adapter } = storage(); const store = new SessionStore(adapter, "agent"); await store.load();
    const s = newSession(); s.pendingTask = createAgentTask("new-reading-project", DEFAULT_SETTINGS); s.pendingTask.args.book = "Book";
    const task = createAgentTask("summarize-note", DEFAULT_SETTINGS, { path: "a.md" });
    s.messages.push({ id: "u", role: "user", content: "summarize", createdAt: 1, task }, {
      id: "reply", role: "assistant", content: "", createdAt: 2, status: "running",
      checkpoint: { version: 1, mode: "ask", searchVault: false, scope: null, notes: [], messages: [], task, taskResult: "retained summary" },
    });
    store.data.sessions.push(s); await store.save();
    const restored = new SessionStore(adapter, "agent"); await restored.load();
    expect(restored.data.sessions[0].pendingTask?.args.book).toBe("Book");
    expect(restored.data.sessions[0].messages[1].checkpoint?.taskResult).toBe("retained summary");
    const invalid = JSON.parse(JSON.stringify(store.data)); invalid.sessions[0].pendingTask.tool = "note.propose";
    expect(() => parseSessionData(JSON.stringify(invalid))).toThrow("损坏");
  });
  it("rejects checkpoint system messages and invalid source anchors without overwriting history", () => {
    const s = newSession();
    s.messages.push({ id: "run", role: "assistant", content: "", status: "interrupted", createdAt: 1, checkpoint: { version: 1, mode: "agent", searchVault: true, scope: null, notes: [], messages: [{ role: "user", content: "task" }] } });
    const raw = JSON.stringify({ version: 1, activeId: s.id, sessions: [s] }); expect(parseSessionData(raw).sessions[0].messages[0].checkpoint).toBeDefined();
    expect(() => parseSessionData(raw.replace('"role":"user"', '"role":"system"'))).toThrow("损坏");
    const modified = JSON.parse(raw); modified.sessions[0].messages[0].checkpoint.primaryPath = "missing.md"; expect(() => parseSessionData(JSON.stringify(modified))).toThrow("损坏");
  });
  it("persists drafts independently and recovers interrupted runs without replaying writes", async () => {
    const { adapter } = storage();
    const store = new SessionStore(adapter, "plugin/agent");
    await store.load();
    const a = newSession(); a.draft = "draft A";
    a.messages.push({ id: "run", role: "assistant", content: "partial", createdAt: 1, status: "running", proposals: [{ id: "p", title: "change", status: "applying", changes: [{ path: "a.md", before: "old", after: "new" }] }] });
    const b = newSession(); b.draft = "draft B";
    store.data.sessions.push(a, b); store.data.activeId = b.id;
    await store.save();
    const recovered = new SessionStore(adapter, "plugin/agent"); await recovered.load();
    expect(recovered.data.activeId).toBe(b.id);
    expect(recovered.data.sessions.map(s => s.draft)).toEqual(["draft A", "draft B"]);
    expect(recovered.data.sessions[0].messages[0]).toMatchObject({ status: "interrupted", proposals: [{ status: "pending" }] });
  });
  it("does not replace corrupt or future-version history with empty data", async () => {
    const { adapter, files } = storage();
    files.set("agent/sessions.json", '{"version":9,"sessions":[]}');
    const store = new SessionStore(adapter, "agent");
    await expect(store.load()).rejects.toThrow();
    await expect(store.save()).rejects.toThrow();
    expect(files.get("agent/sessions.json")).toContain('"version":9');
  });
  it("restores confirmed story scenes, settings, and an interrupted evolution without losing canon", async () => {
    const { adapter } = storage(); const store = new SessionStore(adapter, "agent"); await store.load();
    const s = newSession(); s.mode = "story"; s.storyConfig = { characterPaths: ["作品/_角色/林川.md"], rounds: 2 };
    s.messages.push({ id: "scene", role: "assistant", content: "已经确认的剧情", createdAt: 1, status: "running", story: { projectPath: "作品", chapterPath: "作品/01.md", cast: [{ path: "作品/_角色/林川.md", content: "谨慎" }], turns: [], confirmedAt: 2, evolution: { status: "running", content: "" } } });
    store.data.sessions.push(s); await store.save();
    const restored = new SessionStore(adapter, "agent"); await restored.load();
    const scene = restored.data.sessions[0].messages[0];
    expect(scene.content).toBe("已经确认的剧情"); expect(scene.story?.confirmedAt).toBe(2); expect(scene.story?.evolution?.status).toBe("error");
    expect(restored.data.sessions[0].storyConfig?.rounds).toBe(2);
    const data = JSON.parse(JSON.stringify(store.data));
    data.sessions[0].messages[0].story.cast[0].path = "另一部作品/_角色/林川.md";
    expect(() => parseSessionData(JSON.stringify(data))).toThrow("损坏");
    data.sessions[0].messages[0].story.cast[0].path = "作品/_角色/林川.md"; data.sessions[0].storyConfig.rounds = 20;
    expect(() => parseSessionData(JSON.stringify(data))).toThrow("损坏");
  });
  it("serializes overlapping saves so the latest draft survives", async () => {
    const { adapter } = storage(); const store = new SessionStore(adapter, "agent"); await store.load();
    const s = newSession(); store.data.sessions.push(s);
    s.draft = "one"; const first = store.save(); s.draft = "two"; const second = store.save();
    await Promise.all([first, second]);
    const recovered = new SessionStore(adapter, "agent"); await recovered.load();
    expect(recovered.data.sessions[0].draft).toBe("two");
  });
  it("keeps messages from both devices and respects deletion tombstones", async () => {
    const { adapter } = storage(); const store = new SessionStore(adapter, "agent"); await store.load();
    const local = newSession(); local.messages.push({ id: "a", role: "user", content: "from A", createdAt: 1 });
    store.data.sessions.push(local);
    const remote = { ...local, updatedAt: local.updatedAt + 1, messages: [{ id: "b", role: "user" as const, content: "from B", createdAt: 2 }] };
    store.merge({ version: 1, activeId: null, sessions: [remote] });
    expect(store.data.sessions[0].messages.map(m => m.content)).toEqual(["from A", "from B"]);
    store.merge({ version: 1, activeId: null, sessions: [], deleted: { [local.id]: remote.updatedAt + 1 } });
    store.merge({ version: 1, activeId: null, sessions: [remote] });
    expect(store.data.sessions).toEqual([]);
  });
});

it("rejects corrupted proofreading offsets while restoring a valid report", () => {
  const session = newSession();
  session.messages.push({ id: "proof", role: "assistant", content: "建议", createdAt: 1, proofreading: { path: "a.md", content: "再接再励", selected: false, result: { issues: [{ original: "再接再励", correction: "再接再厉", reason: "成语", start: 0, end: 4 }], unlocatedCount: 0 } } });
  const data = { version: 1, activeId: session.id, sessions: [session] };
  expect(parseSessionData(JSON.stringify(data)).sessions[0].messages[0].proofreading).toBeDefined();
  session.messages[0].proofreading!.result.issues[0].start = 1;
  expect(() => parseSessionData(JSON.stringify(data))).toThrow("损坏");
});
