import { beforeEach, describe, expect, it, vi } from "vitest";
import { App, TFile } from "obsidian";
import { FileConflictService } from "./FileConflictService";
import { BaiduSyncService } from "./BaiduSyncService";
import { withFileSyncLock } from "./FileSyncLock";
import { SyncResolution } from "../../core/sync/SyncConflict";
import { DEFAULT_BAIDU_SYNC_CONFIG } from "../../types";

const cloud = vi.hoisted(() => ({
  files: new Map<string, ArrayBuffer>(), times: new Map<string, number>(), failedUploads: new Set<string>(),
  failedDownloads: new Set<string>(), failList: false, clock: 100,
  onUpload: undefined as ((path: string) => void) | undefined,
}));
vi.mock("./BaiduPanClient", () => ({ BaiduPanClient: class {
  isTokenExpired() { return false; }
  async mkdir() { return true; }
  async listAllFiles(root: string) {
    if (cloud.failList) throw new Error("Offline");
    return [...cloud.files].filter(([path]) => path.startsWith(root + "/")).map(([path, bytes]) => ({
      path, server_filename: path.split("/").pop(), size: bytes.byteLength, isdir: 0, server_mtime: cloud.times.get(path) ?? 100,
    }));
  }
  async uploadFile(bytes: ArrayBuffer, path: string) {
    cloud.onUpload?.(path);
    if (cloud.failedUploads.has(path)) return false;
    cloud.files.set(path, bytes.slice(0)); cloud.times.set(path, ++cloud.clock); return true;
  }
  async downloadFile(path: string) { return cloud.failedDownloads.has(path) ? null : cloud.files.get(path)?.slice(0) ?? null; }
  async deleteFile(path: string) { cloud.files.delete(path); cloud.times.delete(path); return true; }
} }));

const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;
const text = (value?: ArrayBuffer): string | undefined => value === undefined ? undefined : new TextDecoder().decode(value);
function device() {
  const files = new Map<string, ArrayBuffer>(), times = new Map<string, number>(), folders = new Set<string>();
  let clock = 10000, failRecovery = false;
  const fileAt = (path: string) => {
    const value = files.get(path); if (value === undefined) return null;
    const file = new TFile(); file.path = path; file.stat = { size: value.byteLength, mtime: times.get(path) ?? 10000, ctime: 1 }; return file;
  };
  const write = (path: string, value: ArrayBuffer) => {
    if (failRecovery && path.includes("file-sync-recovery")) throw new Error("Backup disk full");
    files.set(path, value.slice(0)); times.set(path, clock += 2000);
  };
  const app = {
    vault: {
      configDir: ".obsidian",
      adapter: {
        exists: async (path: string) => files.has(path) || folders.has(path),
        mkdir: async (path: string) => { folders.add(path); },
        writeBinary: async (path: string, value: ArrayBuffer) => write(path, value),
        write: async (path: string, value: string) => write(path, bytes(value)),
      },
      getFiles: () => [...files.keys()].map(path => fileAt(path)!), getAbstractFileByPath: fileAt,
      readBinary: async (file: TFile) => files.get(file.path)!.slice(0),
      modifyBinary: async (file: TFile, value: ArrayBuffer) => write(file.path, value),
      createBinary: async (path: string, value: ArrayBuffer) => write(path, value),
    },
    fileManager: { trashFile: async (file: TFile) => { files.delete(file.path); } },
  } as unknown as App;
  const config = { ...DEFAULT_BAIDU_SYNC_CONFIG, enabled: true, syncEngine: "files" as const, accessToken: "token", remotePath: "/notes" };
  return {
    app, config, files, service: () => new FileConflictService(app, config),
    note: (path: string, value: string) => write(path, bytes(value)),
    content: (path: string) => text(files.get(path)),
    failBackup: () => { failRecovery = true; },
  };
}
function remote(path: string, value: string) { cloud.files.set(`/notes/${path}`, bytes(value)); cloud.times.set(`/notes/${path}`, ++cloud.clock); }

beforeEach(() => {
  cloud.files.clear(); cloud.times.clear(); cloud.failedUploads.clear(); cloud.failedDownloads.clear(); cloud.failList = false;
  cloud.onUpload = undefined; cloud.clock = 100;
});

describe("legacy file conflict application", () => {
  it("defaults to deferred conflicts without renaming or overwriting either side", async () => {
    const a = device(); a.note("folder/a.md", "local"); remote("folder/a.md", "remote");
    const result = await new BaiduSyncService(a.app, a.config).sync("folder");
    expect(result.conflicts).toEqual(["folder/a.md"]);
    expect(a.content("folder/a.md")).toBe("local"); expect(text(cloud.files.get("/notes/folder/a.md"))).toBe("remote");
    expect([...a.files.keys()]).toEqual(["folder/a.md"]);
  });

  it("applies mixed choices, deletion, attachment bytes and empty manual merges after saving both versions", async () => {
    const a = device();
    a.note("local.md", "local wins"); remote("local.md", "old remote");
    a.note("deleted.md", "delete me");
    remote("remote-only.md", "delete remotely");
    a.note("empty.md", "old local"); remote("empty.md", "old cloud");
    a.files.set("photo.png", new Uint8Array([0, 1, 2]).buffer); cloud.files.set("/notes/photo.png", new Uint8Array([0, 3, 4]).buffer);
    const service = a.service(), conflicts = await service.prepare(["local.md", "deleted.md", "remote-only.md", "empty.md", "photo.png"]);
    expect(conflicts[4]).toMatchObject({ localExists: true, remoteExists: true, binary: true, localSize: 3 });
    const choices = new Map<string, SyncResolution>(conflicts.map(c => [c.key, c.path === "empty.md" ? { choice: "text", text: "" } : { choice: c.path === "deleted.md" ? "remote" : "local" }]));
    const result = await service.apply(conflicts, choices);
    expect(result.errors).toEqual([]); expect(result.resolvedKeys).toHaveLength(5);
    expect(text(cloud.files.get("/notes/local.md"))).toBe("local wins");
    expect(a.files.has("deleted.md")).toBe(false); expect(cloud.files.has("/notes/remote-only.md")).toBe(false);
    expect(a.content("empty.md")).toBe(""); expect(text(cloud.files.get("/notes/empty.md"))).toBe("");
    expect(new Uint8Array(cloud.files.get("/notes/photo.png")!)).toEqual(new Uint8Array([0, 1, 2]));
    expect(a.content(`${result.recoveryPath}/0.remote.bin`)).toBe("old remote");
    expect(a.content(`${result.recoveryPath}/3.local.bin`)).toBe("old local");
    expect(JSON.parse(a.content(`${result.recoveryPath}/manifest.json`)!).files).toHaveLength(5);
    expect((await new BaiduSyncService(a.app, a.config).scan()).filter(p => p.action === "conflict")).toEqual([]);
  });

  it.each(["local", "remote"])("rejects a stale %s snapshot before any file write", async side => {
    const a = device(); a.note("a.md", "local"); remote("a.md", "cloud");
    const service = a.service(), conflicts = await service.prepare(["a.md"]);
    if (side === "local") a.note("a.md", "new local"); else remote("a.md", "new cloud");
    await expect(service.apply(conflicts, new Map([[conflicts[0].key, { choice: "remote" }]]))).rejects.toThrow("发生变化");
    expect(a.content("a.md")).toBe(side === "local" ? "new local" : "local");
    expect(text(cloud.files.get("/notes/a.md"))).toBe(side === "remote" ? "new cloud" : "cloud");
  });

  it("fails closed on cloud listing and download failures", async () => {
    const a = device(); a.note("a.md", "local"); remote("a.md", "cloud");
    cloud.failList = true; await expect(a.service().prepare(["a.md"])).rejects.toThrow("Offline");
    cloud.failList = false; cloud.failedDownloads.add("/notes/a.md");
    await expect(a.service().prepare(["a.md"])).rejects.toThrow("读取云端文件失败");
    expect(a.content("a.md")).toBe("local");
  });

  it("aborts the whole batch when backups cannot be saved", async () => {
    const a = device(); a.note("a.md", "local"); remote("a.md", "cloud");
    const service = a.service(), conflicts = await service.prepare(["a.md"]); a.failBackup();
    await expect(service.apply(conflicts, new Map([[conflicts[0].key, { choice: "remote" }]]))).rejects.toThrow("Backup disk full");
    expect(a.content("a.md")).toBe("local"); expect(text(cloud.files.get("/notes/a.md"))).toBe("cloud");
  });

  it("reports completed and failed files separately, so retry can exclude completed files", async () => {
    const a = device(); for (const path of ["a.md", "b.md"]) { a.note(path, "local"); remote(path, "cloud"); }
    const service = a.service(), conflicts = await service.prepare(["a.md", "b.md"]);
    cloud.failedUploads.add("/notes/b.md");
    const result = await service.apply(conflicts, new Map(conflicts.map(c => [c.key, { choice: "local" }])));
    expect(result.resolvedKeys).toEqual([conflicts[0].key]); expect(result.errors).toHaveLength(1);
    expect(text(cloud.files.get("/notes/a.md"))).toBe("local"); expect(text(cloud.files.get("/notes/b.md"))).toBe("cloud");
    cloud.failedUploads.clear();
    const remaining = await service.prepare(["b.md"]);
    expect((await service.apply(remaining, new Map([[remaining[0].key, { choice: "local" }]]))).errors).toEqual([]);
  });

  it("preserves edits made during an upload instead of overwriting them with the manual result", async () => {
    const a = device(); a.note("a.md", "local"); remote("a.md", "cloud");
    const service = a.service(), conflicts = await service.prepare(["a.md"]);
    cloud.onUpload = path => { if (path === "/notes/a.md") a.note("a.md", "typed while uploading"); };
    const result = await service.apply(conflicts, new Map([[conflicts[0].key, { choice: "text", text: "merged" }]]));
    expect(result.errors[0]).toContain("新内容已保留"); expect(result.resolvedKeys).toEqual([]);
    expect(a.content("a.md")).toBe("typed while uploading");
  });

  it("retains both originals and exposes the recovery directory if metadata saving fails after application", async () => {
    const a = device(); a.note("a.md", "local"); remote("a.md", "cloud");
    const service = a.service(), conflicts = await service.prepare(["a.md"]);
    cloud.failedUploads.add("/notes/istart-sync-meta.json");
    await expect(service.apply(conflicts, new Map([[conflicts[0].key, { choice: "remote" }]]))).rejects.toThrow("恢复副本：");
    expect(a.content("a.md")).toBe("cloud");
    const original = [...a.files].find(([path]) => path.endsWith("0.local.bin"));
    expect(text(original?.[1])).toBe("local");
  });

  it("keeps unconfirmed deletion records across repeated syncs instead of recreating deleted files", async () => {
    const a = device(); a.note("remote-deleted.md", "unchanged"); remote("local-deleted.md", "unchanged");
    const file = a.app.vault.getAbstractFileByPath("remote-deleted.md") as TFile;
    remote("istart-sync-meta.json", JSON.stringify({
      "remote-deleted.md": { localMtime: file.stat.mtime, remoteMtime: 100, size: 9 },
      "local-deleted.md": { localMtime: 10000, remoteMtime: cloud.times.get("/notes/local-deleted.md"), size: 9 },
    }));
    const service = new BaiduSyncService(a.app, a.config);
    for (let round = 0; round < 2; round++) {
      const result = await service.sync();
      expect(result.conflicts.sort()).toEqual(["local-deleted.md", "remote-deleted.md"]);
      expect(a.files.has("local-deleted.md")).toBe(false); expect(cloud.files.has("/notes/remote-deleted.md")).toBe(false);
    }
  });

  it("shares a vault lock with backup and restore and rejects changed sync settings", async () => {
    const a = device(); a.note("a.md", "local"); remote("a.md", "cloud");
    const service = a.service(), conflicts = await service.prepare(["a.md"]);
    let release!: () => void;
    const locked = withFileSyncLock(a.app, () => new Promise<void>(resolve => { release = resolve; }));
    await expect(new BaiduSyncService(a.app, a.config).backup()).rejects.toThrow("正在进行文件同步");
    await expect(service.apply(conflicts, new Map([[conflicts[0].key, { choice: "local" }]]))).rejects.toThrow("正在进行文件同步");
    release(); await locked;
    a.config.remotePath = "/different";
    await expect(service.apply(conflicts, new Map([[conflicts[0].key, { choice: "local" }]]))).rejects.toThrow("同步设置已变化");
  });
});


describe("file restore boundaries", () => {
  it("backs up only notes even when an old installation enabled plugin backup", async () => {
    const a = device(); Object.assign(a.config, { backupPlugin: true });
    a.note("note.md", "note");
    a.note(".obsidian/plugins/istart-note-ai/main.js", "installed code");
    a.note(".obsidian/plugins/istart-note-ai/data.json", "credentials");
    a.note(".obsidian/app.json", "settings");
    const read = vi.spyOn(a.app.vault, "readBinary");
    expect(await new BaiduSyncService(a.app, a.config).backup()).toMatchObject({ uploaded: 1, failed: 0 });
    expect(read.mock.calls.map(([file]) => file.path)).toEqual(["note.md"]);
    expect([...cloud.files.keys()].sort()).toEqual(["/notes/istart-sync-meta.json", "/notes/note.md"]);
  });
  it.each([false, true])("restores notes with overwrite=%s without installing legacy plugin backups or hidden files", async overwrite => {
    const a = device(); Object.assign(a.config, { backupPlugin: true });
    a.note(".obsidian/plugins/istart-note-ai/main.js", "installed code");
    a.note(".obsidian/plugins/istart-note-ai/manifest.json", "installed manifest");
    a.note(".obsidian/app.json", "local settings");
    const excluded = ["_plugin/main.js", "_plugin/manifest.json", "_plugin/data.json", "_obsidian-config/app.json", "_istart-git/pack", ".obsidian/plugins/istart-note-ai/main.js", ".obsidian/app.json", "folder/../../.obsidian/plugins/istart-note-ai/main.js", "folder\\..\\main.js", "istart-config.json", "istart-sync-meta.json"];
    excluded.forEach(path => remote(path, "untrusted")); remote("folder/note.md", "restored note");
    const result = await new BaiduSyncService(a.app, a.config).restore("", overwrite);
    expect(result).toMatchObject({ downloaded: 1, skipped: excluded.length, failed: 0 });
    expect(a.content("folder/note.md")).toBe("restored note");
    expect(a.content(".obsidian/plugins/istart-note-ai/main.js")).toBe("installed code");
    expect(a.content(".obsidian/plugins/istart-note-ai/manifest.json")).toBe("installed manifest");
    expect(a.content(".obsidian/app.json")).toBe("local settings"); expect(a.files.size).toBe(4);
  });

  it("keeps the selected folder in restored paths and respects overwrite and ignore rules", async () => {
    const a = device(); a.config.ignorePattern = "ignored";
    a.note("folder/existing.md", "local"); remote("folder/existing.md", "cloud");
    remote("folder/new.md", "new note"); remote("folder/ignored.md", "ignored");
    const service = new BaiduSyncService(a.app, a.config);
    expect(await service.restore("folder/")).toMatchObject({ downloaded: 1, skipped: 2, failed: 0 });
    expect(a.content("folder/existing.md")).toBe("local"); expect(a.content("folder/new.md")).toBe("new note");
    expect(await service.restore("folder", true)).toMatchObject({ downloaded: 2, skipped: 1, failed: 0 });
    expect(a.content("folder/existing.md")).toBe("cloud"); expect(a.files.has("new.md")).toBe(false);
  });

  it.each([".obsidian/plugins/istart-note-ai", "_plugin", "../notes", "folder/../notes", "/notes", "folder\\notes"])("rejects excluded restore scope %s", async folder => {
    const a = device();
    await expect(new BaiduSyncService(a.app, a.config).restore(folder, true)).rejects.toThrow("目录超出笔记同步范围");
    expect(a.files.size).toBe(0);
  });

  it("excludes a custom Obsidian config directory and protects it during force-restore selection", async () => {
    const a = device(); Object.assign(a.app.vault, { configDir: "custom-config" });
    a.note("custom-config/plugins/istart-note-ai/main.js", "installed"); a.note("note.md", "note");
    remote("custom-config/plugins/istart-note-ai/main.js", "untrusted");
    const service = new BaiduSyncService(a.app, a.config);
    expect(a.app.vault.getFiles().filter(file => service.isSyncableFile(file)).map(file => file.path)).toEqual(["note.md"]);
    expect(() => service.assertSyncFolder("custom-config")).toThrow("目录超出笔记同步范围");
    expect(await service.restore("", true)).toMatchObject({ downloaded: 0, skipped: 1 });
    expect(a.content("custom-config/plugins/istart-note-ai/main.js")).toBe("installed");
  });
});
