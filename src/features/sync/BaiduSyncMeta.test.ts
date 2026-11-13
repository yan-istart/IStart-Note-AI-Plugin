import { describe, expect, it } from "vitest";
import { BaiduSyncMeta, SyncAction } from "./BaiduSyncMeta";

describe("file sync conflict classification", () => {
  it("asks before overwriting same-name files without a shared sync record", () => {
    const plans = new BaiduSyncMeta().buildSyncPlan(new Map([["note.md", 10000]]), new Map([["note.md", 10]]));
    expect(plans[0].action).toBe(SyncAction.Conflict);
  });

  it("treats deletion versus a concurrent modification as a conflict on either side", () => {
    const meta = new BaiduSyncMeta(); meta.recordSync("note.md", 10000, 10, 3);
    expect(meta.buildSyncPlan(new Map(), new Map([["note.md", 11]]))[0].action).toBe(SyncAction.Conflict);
    expect(meta.buildSyncPlan(new Map([["note.md", 12000]]), new Map())[0].action).toBe(SyncAction.Conflict);
    expect(meta.buildSyncPlan(new Map(), new Map([["note.md", 10]]))[0].action).toBe(SyncAction.LocalDeleted);
    expect(meta.buildSyncPlan(new Map([["note.md", 10000]]), new Map())[0].action).toBe(SyncAction.RemoteDeleted);
  });
});
