import { describe, it, expect } from "vitest";
import { SessionStore, parseSessionData } from "./SessionStore";
import { newSession } from "./types";

function storage() {
  const files = new Map<string, string>();
  return { files, adapter: { exists: async (p: string) => files.has(p), mkdir: async () => {}, read: async (p: string) => files.get(p)!, write: async (p: string, s: string) => { files.set(p, s); } } };
}
describe("agent sessions", () => {
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
