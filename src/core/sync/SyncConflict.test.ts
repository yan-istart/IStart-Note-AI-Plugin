import { describe, expect, it } from "vitest";
import { ConflictSession, SyncConflict, conflictKind, conflictVersion, differenceSummary, resolvedVersion } from "./SyncConflict";

const conflict = (overrides: Partial<SyncConflict> = {}): SyncConflict => ({
  path: "note.md", key: "note:base:local:remote", local: "one\nold\n", remote: "one\nnew\nmore\n", base: "one\nbase\n",
  binary: false, localExists: true, remoteExists: true, baseExists: true, localSize: 8, remoteSize: 13, baseSize: 9, ...overrides,
});

describe("conflict plans and comparisons", () => {
  it("assigns only selected files, supports mixed choices, and clears assignments without applying", () => {
    const a = conflict(), b = conflict({ key: "b", path: "b.md" }), c = conflict({ key: "c", path: "c.md" });
    const session = new ConflictSession([a, b, c]);
    session.selected.add(a.key); session.selected.add(b.key); session.assignSelected("local");
    expect(session.assigned).toBe(2); expect(session.ready).toBe(false); expect(session.choices.has(c.key)).toBe(false);
    session.choose(b, "remote"); session.choose(c, "text", "");
    expect(session.ready).toBe(true); expect(session.choices.get(b.key)).toEqual({ choice: "remote" });
    expect(session.choices.get(c.key)).toEqual({ choice: "text", text: "" });
    session.assignSelected(""); expect(session.assigned).toBe(1); expect(a.local).toBe("one\nold\n");
  });

  it("counts replacements as both removed and added, with an explicit comparison direction", () => {
    const file = conflict(), session = new ConflictSession([file]);
    expect(session.summary(file)).toBe("新增 2 行 / 移除 1 行");
    expect(session.comparison(file, "pair").label).toBe("本地 → 云端");
    expect(session.comparison(file, "local").before.text).toBe(file.base);
    expect(session.comparison(file, "remote").after.text).toBe(file.remote);
    session.choose(file, "local");
    expect(session.comparison(file, "result").after.text).toBe(file.local);
  });

  it("distinguishes deletion, empty files, unknown bases, and same-name additions", () => {
    const file = conflict({ localExists: false, local: undefined, localSize: 0 });
    expect(resolvedVersion(file, { choice: "local" }).exists).toBe(false);
    expect(resolvedVersion(file, { choice: "text", text: "" })).toEqual({ exists: true, text: "", size: 0 });
    expect(conflictKind(file)).toBe("本地删除 / 云端修改");
    expect(conflictKind(conflict({ baseExists: false }))).toBe("同名新增");
    const legacy = conflict({ baseExists: undefined, base: undefined });
    expect(() => new ConflictSession([legacy]).comparison(legacy, "local")).toThrow("没有共同内容快照");
    expect(conflictKind({ ...legacy, localExists: false })).toBe("本地不存在 / 云端存在");
  });

  it("never confuses undecodable attachments with missing files or allows binary text merges", () => {
    const file = conflict({ binary: true, local: undefined, remote: undefined });
    const session = new ConflictSession([file], new Map([[file.key, { choice: "text", text: "bad" }]]));
    expect(session.ready).toBe(false);
    expect(conflictVersion(file, "local").exists).toBe(true);
    expect(() => session.choose(file, "text", "bad")).toThrow("不能使用文本合并");
    expect(differenceSummary(conflictVersion(file, "local"), conflictVersion(file, "remote"))).toContain("字节");
  });

  it("does not reuse choices when a refreshed conflict has a new content key", () => {
    const a = conflict();
    const session = new ConflictSession([{ ...a, key: "changed" }], new Map([[a.key, { choice: "remote" }]]));
    expect(session.assigned).toBe(0); expect(session.ready).toBe(false);
  });
});
