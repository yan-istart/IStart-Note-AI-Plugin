import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { TFile } from "obsidian";
import type DeepSeekPlugin from "../../main";
import { readNote } from "../../core/agent/Context";
import { PublishingController } from "./PublishingController";
import { PublishingClient, PublishingHttpError } from "../../core/publishing/PublishingClient";
import { PublishingDeviceConfig } from "./DeviceConfig";
import type { CompiledArticle, PublishingJob } from "../../core/publishing/types";
import type { App } from "obsidian";

vi.mock("../../core/agent/Context", () => ({ readNote: vi.fn(), ensureNoteFolder: vi.fn() }));
beforeEach(() => { vi.stubGlobal("window", { setTimeout, clearTimeout }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  const note = Object.assign(new TFile(), { path: "notes/article.md", basename: "article", extension: "md" });
  const image = Object.assign(new TFile(), { path: "images/cover.png", extension: "png" });
  const app = { vault: { readBinary: vi.fn(async () => new Uint8Array([1, 2]).buffer),
    getAbstractFileByPath: vi.fn((path: string) => path === image.path ? image : note) },
    metadataCache: { getFirstLinkpathDest: vi.fn(() => image) } } as unknown as App;
  const controller = new PublishingController({ app, settings: { publishing: { folder: "IStart/Publishing" } } } as unknown as DeepSeekPlugin);
  vi.mocked(readNote).mockResolvedValue("# 标题\n\n正文 ![[cover.png]]");
  controller.device.value.url = "https://publishing.example.com";
  controller.device.token = "test-only-access-token-1234567890123";
  controller.connection = { protocol: "istart-publishing-v1", serverId: "server-1", extensionConnected: true };
  controller.accounts = [{ id: "zhihu", name: "知乎", username: "writer", isAuthenticated: true }];
  controller.selected.add("zhihu");
  vi.spyOn(controller.store, "saveRecord").mockResolvedValue();
  vi.spyOn(controller.store, "snapshot").mockImplementation(async (article: CompiledArticle, sourcePath: string) => ({ ...article, sourcePath, folder: "IStart/Publishing/test", fingerprint: "snapshot-hash", noteContent: "snapshot" }));
  vi.spyOn(controller.store, "assertSnapshot").mockResolvedValue();
  vi.spyOn(PublishingClient.prototype, "status").mockResolvedValue(controller.connection);
  return { controller, note, image, app };
}

describe("publishing task orchestration", () => {
  it("uses the selected file, persists intent before POST, and transmits image bytes rather than vault paths", async () => {
    const { controller, note } = setup();
    const send = vi.spyOn(PublishingClient.prototype, "send").mockImplementation(async request => {
      expect(controller.store.saveRecord).toHaveBeenCalled();
      expect(request.article.markdown).toContain("data:image/png;base64,AQI=");
      expect(request.article.markdown).not.toContain("assets/");
      return { id: request.id, serverId: "server-1", createdAt: new Date().toISOString(), state: "complete", results: [{ platform: "zhihu", username: "writer", state: "draft" }] };
    });
    await controller.prepare(note); expect(readNote).toHaveBeenCalledWith(expect.anything(), note.path);
    await controller.send(); expect(send).toHaveBeenCalledTimes(1);
    await expect(controller.send()).rejects.toThrow("已有草稿");
    controller.dispose();
  });
  it("blocks changed source text and attachments before creating a remote task", async () => {
    const { controller, note, app } = setup();
    const send = vi.spyOn(PublishingClient.prototype, "send");
    await controller.prepare(note);
    vi.mocked(readNote).mockResolvedValue("changed");
    await expect(controller.send()).rejects.toThrow("原文已变化");
    vi.mocked(readNote).mockResolvedValue("# 标题\n\n正文 ![[cover.png]]");
    vi.mocked(app.vault.readBinary).mockResolvedValue(new Uint8Array([9]).buffer);
    await expect(controller.send()).rejects.toThrow("图片已变化");
    expect(send).not.toHaveBeenCalled(); controller.dispose();
  });
  it("keeps a lost response unknown and recovers the same task ID through status queries", async () => {
    const { controller, note } = setup();
    vi.spyOn(PublishingClient.prototype, "send").mockRejectedValue(new Error("connection lost"));
    await controller.prepare(note); await controller.send();
    const record = controller.records[0]; expect(record.job.results[0].state).toBe("unknown");
    await expect(controller.send()).rejects.toThrow("已有草稿或结果待核对");
    vi.spyOn(PublishingClient.prototype, "job").mockResolvedValue({ ...record.job, state: "complete", results: [{ platform: "zhihu", username: "writer", state: "draft" }] });
    await controller.refresh(); expect(PublishingClient.prototype.job).toHaveBeenCalledWith(record.job.id);
    expect(record.job.results[0].state).toBe("draft"); controller.dispose();
  });
  it("makes known HTTP rejections retryable and refuses job results from a different server", async () => {
    const { controller, note } = setup();
    const send = vi.spyOn(PublishingClient.prototype, "send").mockRejectedValue(new PublishingHttpError("invalid token", 401));
    await controller.prepare(note); await controller.send();
    expect(controller.records[0].job.state).toBe("complete"); expect(controller.records[0].job.results[0].state).toBe("failed");
    send.mockImplementation(async request => ({ id: request.id, serverId: "other-server", state: "complete", createdAt: "today", results: [{ platform: "zhihu", state: "draft" }] } as PublishingJob));
    await controller.send(); expect(controller.records[0].job.results[0].state).toBe("unknown"); controller.dispose();
  });
  it("isolates mode credentials and does not save tokens in device preferences", () => {
    const app = { saveLocalStorage: vi.fn(), loadLocalStorage: vi.fn(() => null) } as unknown as App;
    const config = new PublishingDeviceConfig(app);
    config.token = "remote-secret"; config.value.mode = "local"; expect(config.token).toBe("");
    config.token = "local-secret"; config.value.mode = "remote"; expect(config.token).toBe("remote-secret");
    config.save(); expect(JSON.stringify(vi.mocked(app.saveLocalStorage).mock.calls)).not.toContain("secret");
  });
});
