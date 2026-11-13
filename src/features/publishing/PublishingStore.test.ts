import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import { PublishingStore } from "./PublishingStore";
import { readNote } from "../../core/agent/Context";
import type { PublishingSnapshot } from "../../core/publishing/types";

vi.mock("../../core/agent/Context", () => ({ readNote: vi.fn(), ensureNoteFolder: vi.fn() }));
describe("publishing snapshot integrity", () => {
  it("rejects edited draft snapshots and changed copied assets before sending", async () => {
    const file = new TFile();
    const app = { vault: { getAbstractFileByPath: () => file, readBinary: vi.fn(async () => new Uint8Array([1, 2]).buffer) } } as unknown as App;
    const store = new PublishingStore(app, () => "IStart/Publishing");
    const snapshot: PublishingSnapshot = { folder: "IStart/Publishing/test", sourcePath: "source.md", title: "t", markdown: "body", fingerprint: "hash", noteContent: "saved-note",
      assets: [{ name: "image-1.png", source: "original.png", data: new Uint8Array([1, 2]).buffer, mime: "image/png" }] };
    vi.mocked(readNote).mockResolvedValue("edited-note");
    await expect(store.assertSnapshot(snapshot)).rejects.toThrow("稿件已变化");
    vi.mocked(readNote).mockResolvedValue("saved-note");
    await expect(store.assertSnapshot(snapshot)).resolves.toBeUndefined();
    vi.mocked(app.vault.readBinary).mockResolvedValue(new Uint8Array([3, 4]).buffer);
    await expect(store.assertSnapshot(snapshot)).rejects.toThrow("快照图片已变化");
  });
});
