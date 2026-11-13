import { App, TFile } from "obsidian";
import { SyncConflict, SyncResolution } from "../../core/sync/SyncConflict";
import { assertNotePath, textOf } from "../../core/sync/GitSyncEngine";
import { md5 } from "../../util/md5";
import { BaiduSyncConfig } from "../../types";
import { BaiduPanClient, BaiduFileEntry } from "./BaiduPanClient";
import { BaiduSyncMeta } from "./BaiduSyncMeta";
import { ensureDirectory } from "./ObsidianGitFs";
import { withFileSyncLock } from "./FileSyncLock";

export interface FileConflict extends SyncConflict {
  localBytes?: ArrayBuffer;
  remoteBytes?: ArrayBuffer;
}
export interface FileConflictResult { resolvedKeys: string[]; errors: string[]; recoveryPath: string }
const fingerprint = (bytes?: ArrayBuffer): string => bytes === undefined ? "-" : md5(new Uint8Array(bytes));

/** Current-content comparisons for the legacy engine, without inventing a common ancestor. */
export class FileConflictService {
  private readonly client: BaiduPanClient;
  private readonly scope: string;
  private readonly root: string;

  constructor(private readonly app: App, private readonly config: BaiduSyncConfig) {
    this.client = new BaiduPanClient(config);
    this.scope = this.settingsKey();
    this.root = config.remotePath.replace(/\/+$/, "");
  }

  private settingsKey(): string {
    return JSON.stringify([this.config.enabled, this.config.syncEngine, this.config.remotePath, this.config.ignorePattern, this.config.fileSizeLimitMB]);
  }

  private assertScope(path: string, size = 0): void {
    if (this.scope !== this.settingsKey() || !this.config.enabled || this.config.syncEngine === "git") throw new Error("同步设置已变化，请重新扫描冲突");
    assertNotePath(path);
    if (path === this.app.vault.configDir || path.startsWith(`${this.app.vault.configDir}/`)
      || /^(?:_istart-git|_plugin|_obsidian-config)(?:\/|$)/.test(path)
      || path === "istart-sync-meta.json" || path === "istart-config.json"
      || size > this.config.fileSizeLimitMB * 1024 * 1024
      || (this.config.ignorePattern && new RegExp(this.config.ignorePattern).test(path))) {
      throw new Error(`文件超出同步范围：${path}`);
    }
  }

  private async readLocal(path: string): Promise<ArrayBuffer | undefined> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file && !(file instanceof TFile)) throw new Error(`文件与目录冲突：${path}`);
    if (!(file instanceof TFile)) return undefined;
    this.assertScope(path, file.stat.size);
    return this.app.vault.readBinary(file);
  }

  private async entries(): Promise<Map<string, BaiduFileEntry>> {
    const entries = await this.client.listAllFiles(this.root, true);
    return new Map(entries.filter(entry => !entry.isdir).map(entry => [entry.path, entry]));
  }

  async prepare(paths: readonly string[]): Promise<FileConflict[]> {
    const entries = await this.entries();
    const conflicts: FileConflict[] = [];
    for (const path of new Set(paths)) {
      this.assertScope(path);
      const entry = entries.get(`${this.root}/${path}`);
      if (entry) this.assertScope(path, entry.size);
      const localBytes = await this.readLocal(path);
      const remoteBytes = entry ? await this.client.downloadFile(entry.path) : undefined;
      if (remoteBytes === null) throw new Error(`读取云端文件失败：${path}`);
      const decode = (bytes?: ArrayBuffer) => bytes && bytes.byteLength <= 1_000_000 ? textOf(new Uint8Array(bytes)) : undefined;
      const local = decode(localBytes), remote = decode(remoteBytes);
      const binary = !/\.(md|markdown|txt|canvas|json|csv|tsv|yaml|yml)$/i.test(path)
        || (localBytes !== undefined && local === undefined) || (remoteBytes !== undefined && remote === undefined);
      conflicts.push({
        path, key: `${path}:${fingerprint(localBytes)}:${fingerprint(remoteBytes)}`,
        localBytes, remoteBytes, local, remote, binary,
        localExists: localBytes !== undefined, remoteExists: remoteBytes !== undefined,
        localSize: localBytes?.byteLength ?? 0, remoteSize: remoteBytes?.byteLength ?? 0,
      });
    }
    return conflicts;
  }

  async apply(expected: readonly FileConflict[], choices: Map<string, SyncResolution>): Promise<FileConflictResult> {
    if (!expected.length) throw new Error("当前没有待应用的冲突方案");
    return withFileSyncLock(this.app, () => this.applyLocked(expected, choices));
  }

  private async applyLocked(expected: readonly FileConflict[], choices: Map<string, SyncResolution>): Promise<FileConflictResult> {
    const plans = expected.map(conflict => {
      this.assertScope(conflict.path);
      const resolution = choices.get(conflict.key);
      if (!resolution) throw new Error(`尚未分配方案：${conflict.path}`);
      if (resolution.choice === "text" && conflict.binary) throw new Error(`附件或大文件不能使用文本合并：${conflict.path}`);
      const bytes = resolution.choice === "text" ? new TextEncoder().encode(resolution.text).buffer
        : resolution.choice === "local" ? conflict.localBytes : conflict.remoteBytes;
      this.assertScope(conflict.path, bytes?.byteLength ?? 0);
      return { conflict, resolution, bytes };
    });
    const verify = async () => {
      const current = await this.prepare(expected.map(conflict => conflict.path));
      for (const conflict of current) if (!expected.some(previous => previous.key === conflict.key)) {
        throw new Error(`预览后文件发生变化，请重新读取冲突并确认：${conflict.path}`);
      }
    };
    await verify();
    // Save BOTH sides, including attachments, before any overwrite or deletion.
    const recoveryPath = `${this.app.vault.configDir}/plugins/istart-note-ai/file-sync-recovery/${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await ensureDirectory(this.app.vault.adapter, recoveryPath);
    const manifest = [];
    for (let index = 0; index < plans.length; index++) {
      const { conflict, resolution } = plans[index];
      const localFile = conflict.localBytes === undefined ? undefined : `${index}.local.bin`;
      const remoteFile = conflict.remoteBytes === undefined ? undefined : `${index}.remote.bin`;
      if (localFile) await this.app.vault.adapter.writeBinary(`${recoveryPath}/${localFile}`, conflict.localBytes!);
      if (remoteFile) await this.app.vault.adapter.writeBinary(`${recoveryPath}/${remoteFile}`, conflict.remoteBytes!);
      manifest.push({ path: conflict.path, key: conflict.key, choice: resolution.choice, localFile, remoteFile });
    }
    await this.app.vault.adapter.write(`${recoveryPath}/manifest.json`, JSON.stringify({ createdAt: new Date().toISOString(), remotePath: this.root, files: manifest }, null, 2));
    // Backup I/O can take time; check the whole batch again before starting writes.
    await verify();
    const metaPath = `${this.root}/istart-sync-meta.json`;
    const metaEntries = await this.entries();
    const metaBytes = metaEntries.has(metaPath) ? await this.client.downloadFile(metaPath) : undefined;
    if (metaBytes === null) throw new Error("读取同步元数据失败，未应用冲突方案");
    const meta = new BaiduSyncMeta(metaBytes ? new TextDecoder().decode(metaBytes) : undefined);
    const resolvedKeys: string[] = [], errors: string[] = [];
    const completed: { conflict: FileConflict; bytes?: ArrayBuffer; mtime: number }[] = [];
    for (const { conflict, bytes } of plans) {
      try {
        this.assertScope(conflict.path, bytes?.byteLength ?? 0);
        const currentConflict = (await this.prepare([conflict.path]))[0];
        if (currentConflict.key !== conflict.key) throw new Error("文件发生变化，请重新读取冲突");
        const path = `${this.root}/${conflict.path}`;
        if (fingerprint(bytes) !== fingerprint(conflict.remoteBytes)) {
          if (bytes === undefined) {
            if (!await this.client.deleteFile(path)) throw new Error("云端删除失败");
          } else {
            if (!await this.client.mkdir(path.slice(0, path.lastIndexOf("/")))) throw new Error("创建云端目录失败");
            if (!await this.client.uploadFile(bytes, path)) throw new Error("云端上传失败");
          }
        }
        if (fingerprint(bytes) !== fingerprint(conflict.localBytes)) {
          // An editor can change the file while the upload above is in flight.
          if (fingerprint(await this.readLocal(conflict.path)) !== fingerprint(conflict.localBytes)) throw new Error("上传期间本地文件发生变化，新内容已保留，请重新读取冲突");
          const existing = this.app.vault.getAbstractFileByPath(conflict.path);
          if (bytes === undefined) {
            if (existing instanceof TFile) await this.app.fileManager.trashFile(existing);
          } else {
            const slash = conflict.path.lastIndexOf("/");
            await ensureDirectory(this.app.vault.adapter, slash < 0 ? "" : conflict.path.slice(0, slash));
            if (existing instanceof TFile) await this.app.vault.modifyBinary(existing, bytes);
            else await this.app.vault.createBinary(conflict.path, bytes);
          }
        }
        const current = this.app.vault.getAbstractFileByPath(conflict.path);
        completed.push({ conflict, bytes, mtime: current instanceof TFile ? current.stat.mtime : 0 });
      } catch (error) { errors.push(`${conflict.path}：${(error as Error).message}`); }
    }
    try {
      const updatedEntries = await this.entries();
      for (const { conflict, bytes, mtime } of completed) {
        const entry = updatedEntries.get(`${this.root}/${conflict.path}`);
        const currentRemote = entry ? await this.client.downloadFile(entry.path) : undefined;
        if (currentRemote === null || fingerprint(currentRemote) !== fingerprint(bytes)) {
          errors.push(`${conflict.path}：云端文件发生变化，请重新读取冲突`); continue;
        }
        if (bytes === undefined) meta.delete(conflict.path);
        else if (entry) meta.recordSync(conflict.path, mtime, entry.server_mtime, bytes.byteLength);
        resolvedKeys.push(conflict.key);
      }
      const saved = await this.client.uploadFile(new TextEncoder().encode(meta.toJSON()).buffer, metaPath);
      if (!saved) throw new Error("冲突内容已写入，但同步元数据保存失败，请重新读取冲突并确认");
    } catch (error) { throw new Error(`${(error as Error).message}。恢复副本：${recoveryPath}`); }

    return { resolvedKeys, errors: errors.map(error => `${error}（恢复副本：${recoveryPath}）`), recoveryPath };
  }
}
