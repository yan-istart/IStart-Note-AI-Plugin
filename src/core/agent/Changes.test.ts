import { describe, it, expect } from "vitest";
import { applyChanges, coalesceProposal, validateNotePath } from "./Changes";
import type { ChangeProposal } from "./types";

describe("agent changes", () => {
  it("coalesces shared-index drafts and preserves the original file baseline", () => {
    const a: ChangeProposal = { id: "a", title: "chapter A", status: "pending", changes: [{ path: "a.md", before: "A", after: "A done" }, { path: "index.md", before: "0", after: "1" }] };
    const b: ChangeProposal = { id: "b", title: "chapter B", status: "pending", changes: [{ path: "b.md", before: "B", after: "B done" }, { path: "index.md", before: "1", after: "2" }] };
    const merged = coalesceProposal([a], b);
    expect(merged.proposal.changes).toHaveLength(3); expect(merged.proposal.changes.find(c => c.path === "index.md")).toEqual({ path: "index.md", before: "0", after: "2" }); expect(merged.superseded).toEqual([a]); expect(a.status).toBe("pending");
  });
  it("rejects stale content before touching any file", async () => {
    const files = new Map([["a.md", "edited"], ["b.md", "old"]]);
    const p: ChangeProposal = { id: "p", title: "test", status: "pending", changes: [{ path: "b.md", before: "old", after: "new" }, { path: "a.md", before: "old", after: "new" }] };
    await expect(applyChanges(p, { read: async p => files.get(p) ?? null, write: async c => { files.set(c.path, c.after); } })).rejects.toThrow("变化");
    expect(files.get("b.md")).toBe("old"); expect(p.status).toBe("pending");
  });
  it("applies once, recovers an already-written proposal, and rejects occupied new paths", async () => {
    const files = new Map<string, string>(); let writes = 0;
    const io = { read: async (p: string) => files.get(p) ?? null, write: async (c: { path: string; after: string }) => { writes++; files.set(c.path, c.after); } };
    const p: ChangeProposal = { id: "p", title: "new", status: "pending", changes: [{ path: "new.md", before: null, after: "content" }] };
    await applyChanges(p, io); await applyChanges(p, io); expect(writes).toBe(1);
    p.status = "pending"; await applyChanges(p, io); expect(writes).toBe(1); expect(p.status).toBe("applied");
    p.status = "pending"; files.set("new.md", "someone else"); await expect(applyChanges(p, io)).rejects.toThrow();
  });
  it.each(["../a.md", "/a.md", ".obsidian/settings.md", "a/../b.md", "a.json", "C:/a.md", "a\\b.md"])("rejects invalid note path %s", path => { expect(() => validateNotePath(path)).toThrow(); });
  it("resumes a partially written multi-file proposal without duplicating completed files", async () => {
    const files = new Map<string, string>(); let fail = true;
    const p: ChangeProposal = { id: "p", title: "project", status: "pending", changes: [{ path: "a.md", before: null, after: "A" }, { path: "b.md", before: null, after: "B" }] };
    const io = { read: async (path: string) => files.get(path) ?? null, write: async (c: { path: string; after: string }) => { if (c.path === "b.md" && fail) throw new Error("disk full"); files.set(c.path, c.after); } };
    await expect(applyChanges(p, io)).rejects.toThrow("disk full"); expect(files.get("a.md")).toBe("A"); expect(p.status).toBe("pending");
    fail = false; await applyChanges(p, io); expect(p.status).toBe("applied"); expect(files.size).toBe(2);
  });
});
