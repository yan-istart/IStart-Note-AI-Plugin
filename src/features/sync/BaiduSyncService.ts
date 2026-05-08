import { App, Notice, TFile } from "obsidian";
import { BaiduSyncConfig, DeepSeekSettings, SyncableConfig } from "../../types";
import { BaiduPanClient } from "./BaiduPanClient";
import { BaiduSyncMeta, SyncAction, SyncPlan } from "./BaiduSyncMeta";

const META_FILENAME = "istart-sync-meta.json";
const CONFIG_FILENAME = "istart-config.json";

export interface SyncResult {
  uploaded: number;
  downloaded: number;
  conflicts: string[];
  deleted: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export class BaiduSyncService {
  private client: BaiduPanClient;

  constructor(private app: App, private config: BaiduSyncConfig) {
    this.client = new BaiduPanClient(config);
  }

  // ── 双向同步（核心） ───────────────────────────────────────

  async sync(
    localFolder = "",
    options: { conflictStrategy?: "local" | "remote" | "keep-both"; deleteRemoteOnLocalDelete?: boolean } = {},
    onProgress?: (msg: string) => void
  ): Promise<SyncResult> {
    const result: SyncResult = { uploaded: 0, downloaded: 0, conflicts: [], deleted: 0, skipped: 0, failed: 0, errors: [] };
    const { conflictStrategy = "keep-both", deleteRemoteOnLocalDelete = false } = options;

    onProgress?.("读取同步元数据...");
    const meta = await this.loadMeta();

    onProgress?.("扫描本地文件...");
    const localFiles = this.buildLocalFileMap(localFolder);

    onProgress?.("扫描远端文件...");
    const remoteRoot = this.remoteRoot(localFolder);
    await this.client.mkdir(remoteRoot);
    const remoteFiles = await this.buildRemoteFileMap(remoteRoot);

    onProgress?.("计算同步计划...");
    const plans = meta.buildSyncPlan(localFiles, remoteFiles);

    const total = plans.filter((p) => p.action !== SyncAction.Unchanged).length;
    let done = 0;

    for (const plan of plans) {
      if (plan.action === SyncAction.Unchanged) {
        result.skipped++;
        continue;
      }

      done++;
      onProgress?.(`(${done}/${total}) [${plan.action}] ${plan.path}`);

      try {
        switch (plan.action) {
          case SyncAction.Upload:
          case SyncAction.LocalOnly:
            await this.doUpload(plan, meta, result);
            break;

          case SyncAction.Download:
          case SyncAction.RemoteOnly:
            await this.doDownload(plan, remoteRoot, meta, result);
            break;

          case SyncAction.Conflict:
            await this.handleConflict(plan, remoteRoot, meta, result, conflictStrategy);
            break;

          case SyncAction.LocalDeleted:
            if (deleteRemoteOnLocalDelete) {
              const remotePath = this.toRemotePath(plan.path, localFolder);
              await this.client.deleteFile(remotePath);
              meta.delete(plan.path);
              result.deleted++;
            } else {
              meta.delete(plan.path);
              result.skipped++;
            }
            break;

          case SyncAction.RemoteDeleted:
            meta.delete(plan.path);
            result.skipped++;
            break;
        }
      } catch (err) {
        result.failed++;
        result.errors.push(`${plan.path}: ${(err as Error).message}`);
      }
    }

    onProgress?.("保存同步元数据...");
    await this.saveMeta(meta);

    return result;
  }

  // ── 纯备份（只上传，不下载） ───────────────────────────────

  async backup(
    localFolder = "",
    onProgress?: (current: number, total: number, file: string) => void
  ): Promise<SyncResult> {
    const result: SyncResult = { uploaded: 0, downloaded: 0, conflicts: [], deleted: 0, skipped: 0, failed: 0, errors: [] };

    const meta = await this.loadMeta();
    const localFiles = this.buildLocalFileMap(localFolder);
    const remoteRoot = this.remoteRoot(localFolder);
    await this.client.mkdir(remoteRoot);
    const remoteFiles = await this.buildRemoteFileMap(remoteRoot);

    const plans = meta.buildSyncPlan(localFiles, remoteFiles);
    const uploadPlans = plans.filter((p) =>
      p.action === SyncAction.Upload ||
      p.action === SyncAction.LocalOnly ||
      p.action === SyncAction.Conflict
    );

    let done = 0;
    for (const plan of uploadPlans) {
      done++;
      onProgress?.(done, uploadPlans.length, plan.path);
      try {
        await this.doUpload(plan, meta, result);
      } catch (err) {
        result.failed++;
        result.errors.push(`${plan.path}: ${(err as Error).message}`);
      }
    }

    result.skipped = plans.length - uploadPlans.length;
    await this.saveMeta(meta);

    // 备份插件本身
    if (this.config.backupPlugin) {
      const pluginResult = await this.backupPlugin();
      result.uploaded += pluginResult.uploaded;
      result.failed += pluginResult.failed;
    }

    return result;
  }

  // ── 恢复（只下载） ─────────────────────────────────────────

  async restore(
    localFolder = "",
    overwrite = false,
    onProgress?: (current: number, total: number, file: string) => void
  ): Promise<SyncResult> {
    const result: SyncResult = { uploaded: 0, downloaded: 0, conflicts: [], deleted: 0, skipped: 0, failed: 0, errors: [] };

    const remoteRoot = this.remoteRoot(localFolder);
    const remoteFiles = await this.client.listAllFiles(remoteRoot);
    const total = remoteFiles.filter((f) => !f.isdir).length;

    let done = 0;
    for (const entry of remoteFiles) {
      if (entry.isdir) continue;
      done++;
      const localPath = this.toLocalPath(entry.path, remoteRoot);
      onProgress?.(done, total, localPath);

      if (!overwrite && this.app.vault.getAbstractFileByPath(localPath)) {
        result.skipped++;
        continue;
      }

      try {
        const content = await this.client.downloadFile(entry.path);
        if (!content) { result.failed++; result.errors.push(`Download failed: ${entry.path}`); continue; }
        await this.writeLocalFile(localPath, content);
        result.downloaded++;
      } catch (err) {
        result.failed++;
        result.errors.push(`${localPath}: ${(err as Error).message}`);
      }
    }

    return result;
  }

  // ── Token 管理 ─────────────────────────────────────────────

  async ensureValidToken(): Promise<boolean> {
    if (!this.config.accessToken) return false;
    if (!this.client.isTokenExpired()) return true;
    const refreshed = await this.client.refreshAccessToken();
    if (!refreshed) return false;
    this.config.accessToken = refreshed.accessToken;
    this.config.tokenExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();
    return true;
  }

  // ── 配置同步 ───────────────────────────────────────────────

  async pushConfig(settings: DeepSeekSettings, deviceId: string): Promise<boolean> {
    const syncable: SyncableConfig = {
      baseUrl: settings.baseUrl,
      model: settings.model,
      savePath: settings.savePath,
      conceptsPath: settings.conceptsPath,
      questionsIndexPath: settings.questionsIndexPath,
      autoOpenGraph: settings.autoOpenGraph,
      baiduRemotePath: settings.baiduSync.remotePath,
      baiduAutoBackup: settings.baiduSync.autoBackup,
      baiduIgnorePattern: settings.baiduSync.ignorePattern,
      baiduFileSizeLimitMB: settings.baiduSync.fileSizeLimitMB,
      updatedAt: new Date().toISOString(),
      deviceId,
    };

    const bytes = new TextEncoder().encode(JSON.stringify(syncable, null, 2));
    const remotePath = `${this.config.remotePath}/${CONFIG_FILENAME}`.replace(/\/+/g, "/");
    return this.client.uploadFile(bytes.buffer, remotePath);
  }

  async pullConfig(localUpdatedAt?: string): Promise<SyncableConfig | null> {
    const remotePath = `${this.config.remotePath}/${CONFIG_FILENAME}`.replace(/\/+/g, "/");
    try {
      const buf = await this.client.downloadFile(remotePath);
      if (!buf) return null;

      const remote: SyncableConfig = JSON.parse(new TextDecoder().decode(buf));

      if (localUpdatedAt && new Date(localUpdatedAt) >= new Date(remote.updatedAt)) {
        return null;
      }

      return remote;
    } catch {
      return null;
    }
  }

  static applyRemoteConfig(settings: DeepSeekSettings, remote: SyncableConfig): DeepSeekSettings {
    return {
      ...settings,
      baseUrl: remote.baseUrl,
      model: remote.model,
      savePath: remote.savePath,
      conceptsPath: remote.conceptsPath,
      questionsIndexPath: remote.questionsIndexPath,
      autoOpenGraph: remote.autoOpenGraph,
      baiduSync: {
        ...settings.baiduSync,
        remotePath: remote.baiduRemotePath,
        autoBackup: remote.baiduAutoBackup,
        ignorePattern: remote.baiduIgnorePattern,
        fileSizeLimitMB: remote.baiduFileSizeLimitMB,
      },
    };
  }

  // ── 私有方法 ───────────────────────────────────────────────

  private async doUpload(plan: SyncPlan, meta: BaiduSyncMeta, result: SyncResult) {
    const abstract = this.app.vault.getAbstractFileByPath(plan.path);
    if (!abstract || !(abstract instanceof TFile)) return;
    if (this.shouldIgnore(abstract)) { result.skipped++; return; }

    const remotePath = this.toRemotePath(plan.path, "");
    const remoteDir = remotePath.substring(0, remotePath.lastIndexOf("/"));
    if (remoteDir) await this.client.mkdir(remoteDir);

    const content = await this.app.vault.readBinary(abstract);
    const ok = await this.client.uploadFile(content, remotePath);
    if (ok) {
      meta.recordSync(plan.path, abstract.stat.mtime, Math.floor(Date.now() / 1000), abstract.stat.size);
      result.uploaded++;
    } else {
      result.failed++;
      result.errors.push(`Upload failed: ${plan.path}`);
    }
  }

  private async doDownload(plan: SyncPlan, remoteRoot: string, meta: BaiduSyncMeta, result: SyncResult) {
    const remotePath = `${remoteRoot}/${plan.path}`.replace(/\/+/g, "/");
    const content = await this.client.downloadFile(remotePath);
    if (!content) { result.failed++; result.errors.push(`Download failed: ${plan.path}`); return; }

    await this.writeLocalFile(plan.path, content);
    const abstract = this.app.vault.getAbstractFileByPath(plan.path);
    const mtime = (abstract instanceof TFile) ? abstract.stat.mtime : Date.now();
    meta.recordSync(plan.path, mtime, plan.remoteMtime ?? 0, content.byteLength);
    result.downloaded++;
  }

  private async handleConflict(
    plan: SyncPlan,
    remoteRoot: string,
    meta: BaiduSyncMeta,
    result: SyncResult,
    strategy: "local" | "remote" | "keep-both"
  ) {
    result.conflicts.push(plan.path);

    if (strategy === "local") {
      await this.doUpload(plan, meta, result);
    } else if (strategy === "remote") {
      await this.doDownload(plan, remoteRoot, meta, result);
    } else {
      const conflictPath = plan.path.replace(/(\.\w+)?$/, `.conflict$1`);
      const abstract = this.app.vault.getAbstractFileByPath(plan.path);
      if (abstract instanceof TFile) await this.app.vault.rename(abstract, conflictPath);

      await this.doDownload(plan, remoteRoot, meta, result);
      new Notice(`⚠️ 冲突：${plan.path}，本地版本已保存为 ${conflictPath}`);
    }
  }

  // ── Meta 持久化 ────────────────────────────────────────────

  private metaRemotePath(): string {
    return `${this.config.remotePath}/${META_FILENAME}`.replace(/\/+/g, "/");
  }

  private async loadMeta(): Promise<BaiduSyncMeta> {
    try {
      const content = await this.client.downloadFile(this.metaRemotePath());
      if (content) {
        const text = new TextDecoder().decode(content);
        return new BaiduSyncMeta(text);
      }
    } catch {
      // 首次同步，meta 不存在
    }
    return new BaiduSyncMeta();
  }

  private async saveMeta(meta: BaiduSyncMeta) {
    const bytes = new TextEncoder().encode(meta.toJSON());
    await this.client.uploadFile(bytes.buffer, this.metaRemotePath());
  }

  // ── 文件映射构建 ───────────────────────────────────────────

  private buildLocalFileMap(folder: string): Map<string, number> {
    const map = new Map<string, number>();
    const files = this.app.vault.getFiles();
    for (const f of files) {
      if (folder && !f.path.startsWith(folder)) continue;
      if (this.shouldIgnore(f)) continue;
      map.set(f.path, f.stat.mtime);
    }
    return map;
  }

  private async buildRemoteFileMap(remoteRoot: string): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    try {
      const entries = await this.client.listAllFiles(remoteRoot);
      for (const e of entries) {
        if (e.isdir) continue;
        const rel = e.path.replace(remoteRoot + "/", "").replace(/^\//, "");
        if (rel === META_FILENAME) continue;
        map.set(rel, e.server_mtime);
      }
    } catch {
      // 远端目录不存在
    }
    return map;
  }

  // ── 工具方法 ───────────────────────────────────────────────

  private remoteRoot(localFolder: string): string {
    return `${this.config.remotePath}${localFolder ? "/" + localFolder : ""}`.replace(/\/+/g, "/");
  }

  private toRemotePath(localPath: string, _localFolder: string): string {
    return `${this.config.remotePath}/${localPath}`.replace(/\/+/g, "/");
  }

  private toLocalPath(remotePath: string, remoteRoot: string): string {
    return remotePath.replace(remoteRoot + "/", "").replace(/^\//, "");
  }

  private shouldIgnore(file: TFile): boolean {
    const path = file.path;
    if (path.split("/").some((p) => p.startsWith("."))) return true;
    if (file.stat.size > this.config.fileSizeLimitMB * 1024 * 1024) return true;
    if (this.config.ignorePattern) {
      try { if (new RegExp(this.config.ignorePattern).test(path)) return true; } catch { /* ignore */ }
    }
    return false;
  }

  /**
   * 备份插件本身和 Obsidian 关键配置到百度云。
   * 插件文件存储在 {remotePath}/_plugin/
   * 配置文件存储在 {remotePath}/_obsidian-config/
   */
  async backupPlugin(): Promise<{ uploaded: number; failed: number }> {
    if (!this.config.backupPlugin) return { uploaded: 0, failed: 0 };

    let uploaded = 0;
    let failed = 0;

    // 备份插件文件
    const pluginDir = ".obsidian/plugins/istart-note-ai";
    const pluginFiles = ["main.js", "manifest.json", "styles.css", "data.json"];
    const remotePluginDir = `${this.config.remotePath}/_plugin`.replace(/\/+/g, "/");
    await this.client.mkdir(remotePluginDir);

    for (const fileName of pluginFiles) {
      const result = await this.uploadConfigFile(`${pluginDir}/${fileName}`, `${remotePluginDir}/${fileName}`);
      if (result === "ok") uploaded++;
      else if (result === "failed") failed++;
    }

    // 备份 Obsidian 关键配置
    const configFiles = [
      ".obsidian/app.json",                // 全局设置（含移动端工具栏）
      ".obsidian/hotkeys.json",            // 快捷键
      ".obsidian/community-plugins.json",  // 已安装插件列表
      ".obsidian/appearance.json",         // 外观设置
    ];
    const remoteConfigDir = `${this.config.remotePath}/_obsidian-config`.replace(/\/+/g, "/");
    await this.client.mkdir(remoteConfigDir);

    for (const filePath of configFiles) {
      const fileName = filePath.split("/").pop()!;
      const result = await this.uploadConfigFile(filePath, `${remoteConfigDir}/${fileName}`);
      if (result === "ok") uploaded++;
      else if (result === "failed") failed++;
    }

    return { uploaded, failed };
  }

  private async uploadConfigFile(localPath: string, remotePath: string): Promise<"ok" | "failed" | "skipped"> {
    try {
      const exists = await this.app.vault.adapter.exists(localPath);
      if (!exists) return "skipped";
      const content = await this.app.vault.adapter.readBinary(localPath);
      const ok = await this.client.uploadFile(content, remotePath);
      return ok ? "ok" : "failed";
    } catch {
      return "skipped";
    }
  }

  /**
   * 从百度云恢复插件文件和 Obsidian 配置到本地。
   */
  async restorePlugin(): Promise<{ downloaded: number; failed: number }> {
    let downloaded = 0;
    let failed = 0;

    // 恢复插件文件
    const remotePluginDir = `${this.config.remotePath}/_plugin`.replace(/\/+/g, "/");
    const pluginDir = ".obsidian/plugins/istart-note-ai";
    const dirExists = await this.app.vault.adapter.exists(pluginDir);
    if (!dirExists) await this.app.vault.adapter.mkdir(pluginDir);

    const pluginFiles = await this.client.listFiles(remotePluginDir);
    for (const entry of pluginFiles) {
      if (entry.isdir) continue;
      const result = await this.downloadConfigFile(entry.path, `${pluginDir}/${entry.server_filename}`);
      if (result === "ok") downloaded++;
      else if (result === "failed") failed++;
    }

    // 恢复 Obsidian 配置
    const remoteConfigDir = `${this.config.remotePath}/_obsidian-config`.replace(/\/+/g, "/");
    const configFiles = await this.client.listFiles(remoteConfigDir);
    for (const entry of configFiles) {
      if (entry.isdir) continue;
      const result = await this.downloadConfigFile(entry.path, `.obsidian/${entry.server_filename}`);
      if (result === "ok") downloaded++;
      else if (result === "failed") failed++;
    }

    return { downloaded, failed };
  }

  private async downloadConfigFile(remotePath: string, localPath: string): Promise<"ok" | "failed"> {
    try {
      const content = await this.client.downloadFile(remotePath);
      if (!content) return "failed";
      // 确保目录存在
      const dir = localPath.substring(0, localPath.lastIndexOf("/"));
      if (dir) {
        const exists = await this.app.vault.adapter.exists(dir);
        if (!exists) await this.app.vault.adapter.mkdir(dir);
      }
      await this.app.vault.adapter.writeBinary(localPath, content);
      return "ok";
    } catch {
      return "failed";
    }
  }

  private async writeLocalFile(localPath: string, content: ArrayBuffer) {
    const dir = localPath.substring(0, localPath.lastIndexOf("/"));
    if (dir) {
      const exists = await this.app.vault.adapter.exists(dir);
      if (!exists) await this.app.vault.adapter.mkdir(dir);
    }
    const existing = this.app.vault.getAbstractFileByPath(localPath);
    if (existing instanceof TFile) {
      await this.app.vault.modifyBinary(existing, content);
    } else {
      await this.app.vault.createBinary(localPath, content);
    }
  }
}
