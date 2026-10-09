import { beforeEach, describe, expect, it, vi } from "vitest";
import { App, DataAdapter, TFile } from "obsidian";
import { BaiduGitSyncService } from "./BaiduGitSyncService";
import { BaiduSyncService } from "./BaiduSyncService";
import { DEFAULT_BAIDU_SYNC_CONFIG, loadBaiduSyncConfig } from "../../types";
import { ObsidianGitFs } from "./ObsidianGitFs";

const cloud = vi.hoisted(() => ({ files: new Map<string, ArrayBuffer>(), failList: false, downloadHook: undefined as (() => void) | undefined }));
vi.mock("./BaiduPanClient", () => ({ BaiduPanClient: class {
  isTokenExpired() { return false; }
  async mkdir() { return true; }
  async listAllFiles(root: string) {
    if (cloud.failList) throw new Error("Offline");
    return [...cloud.files.keys()].filter((path) => path.startsWith(root + "/")).map((path) => ({
      path, server_filename: path.split("/").pop(), isdir: 0,
    }));
  }
  async uploadFile(bytes: ArrayBuffer, path: string) { cloud.files.set(path, bytes.slice(0)); return true; }
  async downloadFile(path: string) {
    const hook = cloud.downloadHook;
    cloud.downloadHook = undefined;
    hook?.();
    return cloud.files.get(path)?.slice(0) ?? null;
  }
} }));

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

class MemoryAdapter {
  readonly files = new Map<string, Uint8Array>();
  readonly folders = new Set<string>([""]);
  private clock = 1;
  readonly times = new Map<string, number>();
  async exists(path: string) { return this.files.has(path) || this.folders.has(path); }
  async mkdir(path: string) { this.folders.add(path); }
  async stat(path: string) {
    if (!await this.exists(path)) return null;
    return { type: this.files.has(path) ? "file" : "folder", size: this.files.get(path)?.length ?? 0, mtime: this.times.get(path) ?? 1, ctime: 1 };
  }
  async readBinary(path: string) {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error("ENOENT");
    return bytes.slice().buffer as ArrayBuffer;
  }
  async read(path: string) { return decode(new Uint8Array(await this.readBinary(path))); }
  async writeBinary(path: string, bytes: ArrayBuffer) { this.files.set(path, new Uint8Array(bytes.slice(0))); this.times.set(path, ++this.clock); }
  async write(path: string, text: string) { await this.writeBinary(path, encode(text).buffer as ArrayBuffer); }
  async remove(path: string) { this.files.delete(path); }
  async rmdir(path: string) { this.folders.delete(path); }
  async list(path: string) {
    const child = (p: string) => p.startsWith(path + "/") && !p.slice(path.length + 1).includes("/");
    return { files: [...this.files.keys()].filter(child), folders: [...this.folders].filter(child) };
  }
}

function device() {
  const adapter = new MemoryAdapter();
  let failWrite = "";
  const fileAt = (path: string) => {
    const bytes = adapter.files.get(path);
    if (!bytes) return null;
    const file = new TFile(); file.path = path;
    file.stat = { size: bytes.length, mtime: adapter.times.get(path) ?? 1, ctime: 1 };
    return file;
  };
  const app = {
    vault: {
      configDir: ".custom-config", adapter,
      getFiles: () => [...adapter.files.keys()].filter((path) => !path.startsWith(".custom-config/")).map((path) => fileAt(path)!),
      getAbstractFileByPath: fileAt,
      readBinary: (file: TFile) => adapter.readBinary(file.path),
      modifyBinary: async (file: TFile, bytes: ArrayBuffer) => {
        if (failWrite === file.path) throw new Error("Write failed");
        await adapter.writeBinary(file.path, bytes);
      },
      createBinary: (path: string, bytes: ArrayBuffer) => adapter.writeBinary(path, bytes),
    },
    fileManager: { trashFile: (file: TFile) => adapter.remove(file.path) },
  } as unknown as App;
  const config = { ...DEFAULT_BAIDU_SYNC_CONFIG, enabled: true, accessToken: "test-token", tokenExpiresAt: "2099-01-01" };
  return {
    adapter, app, config,
    service: () => new BaiduGitSyncService(app, config),
    failOn: (path: string) => { failWrite = path; },
    note: (path: string, text: string) => adapter.write(path, text),
    content: (path: string) => adapter.read(path),
  };
}

beforeEach(() => { cloud.files.clear(); cloud.failList = false; cloud.downloadHook = undefined; });

describe("mobile adapter and live-vault application", () => {
  it("runs two devices using only the Obsidian adapter and preserves versions", async () => {
    const a = device(), b = device();
    await a.note("文件夹/笔记.md", "first");
    await a.service().sync(); await b.service().sync();
    expect(await b.content("文件夹/笔记.md")).toBe("first");
    const first = (await b.service().history())[0].oid;
    await b.note("文件夹/笔记.md", "second"); await b.service().sync();
    await b.service().restoreFile("文件夹/笔记.md", first);
    expect(await b.content("文件夹/笔记.md")).toBe("first");
    expect((await b.service().history()).length).toBeGreaterThan(1);
    expect([...b.adapter.files.keys()].some((path) => path.startsWith(".custom-config/plugins/istart-note-ai/git-sync/"))).toBe(true);
    expect([...cloud.files.keys()].every((path) => path.includes("/_istart-git/v1/"))).toBe(true);
  });

  it("recovers an interrupted application after only some files were written", async () => {
    const a = device(), b = device();
    await a.note("a.md", "old a"); await a.note("b.md", "old b");
    await a.service().sync(); await b.service().sync();
    await a.note("a.md", "new a"); await a.note("b.md", "new b"); await a.service().sync();
    b.failOn("b.md");
    await expect(b.service().sync()).rejects.toThrow("Write failed");
    expect(await b.content("a.md")).toBe("new a");
    expect(await b.content("b.md")).toBe("old b");
    b.failOn(""); await b.service().sync();
    expect(await b.content("a.md")).toBe("new a");
    expect(await b.content("b.md")).toBe("new b");
    expect([...b.adapter.files.keys()].some((path) => path.endsWith("/apply.json"))).toBe(false);
  });

  it("preserves edits made during download and merges them safely on retry", async () => {
    const a = device(), b = device();
    await a.note("note.md", "one\nmiddle\nthree\n");
    await a.service().sync(); await b.service().sync();
    await a.note("note.md", "cloud\nmiddle\nthree\n"); await a.service().sync();
    cloud.downloadHook = () => { b.adapter.files.set("note.md", encode("one\nmiddle\nnew local\n")); };
    await expect(b.service().sync()).rejects.toThrow("同步期间文件发生变化");
    expect(await b.content("note.md")).toBe("one\nmiddle\nnew local\n");
    await b.service().sync();
    expect(await b.content("note.md")).toBe("cloud\nmiddle\nnew local\n");
  });

  it("never modifies notes on a failed cloud listing", async () => {
    const a = device(); await a.note("note.md", "local"); cloud.failList = true;
    await expect(a.service().sync()).rejects.toThrow("Offline");
    expect(await a.content("note.md")).toBe("local");
    expect(cloud.files.size).toBe(0);
  });

  it("rejects simultaneous operations on the same vault", async () => {
    const a = device(); await a.note("note.md", "local");
    const syncing = a.service().sync();
    await expect(a.service().sync()).rejects.toThrow("正在同步");
    await syncing;
  });

  it("excludes configuration, credentials, ignored files, and oversized attachments", async () => {
    const a = device(), b = device(); a.config.ignorePattern = "secret"; a.config.fileSizeLimitMB = 0.00001;
    await a.note("note.md", "ok"); await a.note("secret.md", "secret");
    await a.note(".custom-config/data.json", "token"); await a.note("huge.png", "a".repeat(20));
    await a.service().sync(); await b.service().sync();
    expect(await b.content("note.md")).toBe("ok");
    expect(await b.adapter.exists("secret.md")).toBe(false);
    expect(await b.adapter.exists("huge.png")).toBe(false);
    expect(await b.adapter.exists(".custom-config/data.json")).toBe(false);
  });

  it("blocks invalid ignore rules without deleting tracked files", async () => {
    const a = device(); await a.note("note.md", "local"); await a.service().sync();
    a.config.ignorePattern = "[";
    await expect(a.service().sync()).rejects.toThrow();
    expect(await a.content("note.md")).toBe("local");
  });

  it("keeps Git bundle files out of legacy file restores", async () => {
    const a = device(), b = device();
    await a.note("git-note.md", "git"); await a.service().sync();
    cloud.files.set(`${a.config.remotePath}/old-note.md`, encode("old backup").buffer as ArrayBuffer);
    const restored = await new BaiduSyncService(b.app, b.config).restore();
    expect(restored.downloaded).toBe(1);
    expect(await b.content("old-note.md")).toBe("old backup");
    expect([...b.adapter.files.keys()].some((path) => path.startsWith("_istart-git/"))).toBe(false);
  });

  it("blocks filesystem paths outside its dedicated metadata directory", async () => {
    const fs = new ObsidianGitFs(new MemoryAdapter() as unknown as DataAdapter, ".custom-config/git");
    await expect(fs.promises.writeFile("git/../note.md", "bad")).rejects.toThrow("EACCES");
    await expect(fs.promises.writeFile("somewhere/note.md", "bad")).rejects.toThrow("EACCES");
  });

  it("does not publish a false deletion for an excluded oversized remote file", async () => {
    const a = device(), b = device();
    await a.note("large.md", "content larger than phone limit");
    await a.note("small.md", "ok"); await a.service().sync();
    b.config.fileSizeLimitMB = 0.00001;
    await b.service().sync();
    expect(await b.adapter.exists("large.md")).toBe(false);
    await b.service().sync(); await a.service().sync();
    expect(await a.content("large.md")).toBe("content larger than phone limit");
    expect(await b.content("small.md")).toBe("ok");
  });

  it("defaults all automatic actions to off and preserves device preferences when pulling config", () => {
    expect(DEFAULT_BAIDU_SYNC_CONFIG.autoSync).toBe(false);
    expect(DEFAULT_BAIDU_SYNC_CONFIG.autoPullConfig).toBe(false);
    expect(DEFAULT_BAIDU_SYNC_CONFIG.autoBackup).toBe(false);
    const config = { ...DEFAULT_BAIDU_SYNC_CONFIG };
    const settings = { baiduSync: config } as Parameters<typeof BaiduSyncService.applyRemoteConfig>[0];
    const remote = { baiduAutoBackup: true } as Parameters<typeof BaiduSyncService.applyRemoteConfig>[1];
    const next = BaiduSyncService.applyRemoteConfig(settings, remote);
    expect(next.baiduSync.autoSync).toBe(false);
    expect(next.baiduSync.autoPullConfig).toBe(false);
    expect(next.baiduSync.autoBackup).toBe(false);
  });

  it("uses Git for new installations, keeps old file-sync vaults, and requires explicit automation opt-in", () => {
    expect(loadBaiduSyncConfig().syncEngine).toBe("git");
    expect(loadBaiduSyncConfig({ enabled: true }).syncEngine).toBe("files");
    expect(loadBaiduSyncConfig({ enabled: true }).autoSync).toBe(false);
    expect(loadBaiduSyncConfig({ syncEngine: "git", autoSync: true }).autoSync).toBe(true);
    expect(loadBaiduSyncConfig({ syncEngine: "git" }).autoPullConfig).toBe(false);
  });
});
