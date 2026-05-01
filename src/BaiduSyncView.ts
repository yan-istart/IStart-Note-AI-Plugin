import { ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { BaiduSyncService } from "./BaiduSyncService";
import { BaiduSyncMeta, SyncAction } from "./BaiduSyncMeta";
import { BaiduPanClient } from "./BaiduPanClient";
import type DeepSeekPlugin from "./main";

export const SYNC_VIEW_TYPE = "istart-baidu-sync-view";

interface FileStatus {
  path: string;
  action: SyncAction;
  localMtime?: number;
  remoteMtime?: number;
}

export class BaiduSyncView extends ItemView {
  private plugin: DeepSeekPlugin;
  private statusList: FileStatus[] = [];
  private isScanning = false;
  private lastScanTime: Date | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: DeepSeekPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return SYNC_VIEW_TYPE; }
  getDisplayText(): string { return "百度云同步状态"; }
  getIcon(): string { return "cloud"; }

  onOpen(): Promise<void> {
    this.render();
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    return Promise.resolve();
  }

  // ── 渲染 ───────────────────────────────────────────────────

  private render() {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("istart-sync-root");

    // 标题栏
    const header = root.createDiv({ cls: "istart-sync-header" });
    header.createEl("h4", { text: "百度云同步状态" });

    const cfg = this.plugin.settings.baiduSync;
    if (!cfg.enabled || !cfg.accessToken) {
      root.createEl("p", {
        text: "请先在设置中启用百度云同步并完成授权。",
        cls: "istart-sync-hint",
      });
      return;
    }

    // 操作按钮行
    const btnRow = root.createDiv({ cls: "istart-sync-btn-row" });

    this.makeBtn(btnRow, "🔍 扫描状态", "default", () => { void this.scan(); });
    this.makeBtn(btnRow, "⬆ 强制备份", "default", () => { void this.forceBackup(); });
    this.makeBtn(btnRow, "⬇ 强制更新", "default", () => { void this.forceUpdate(); });
    this.makeBtn(btnRow, "⇄ 双向同步", "cta", () => { void this.runSync(); });

    // 上次扫描时间
    if (this.lastScanTime) {
      root.createEl("p", {
        text: `上次扫描：${this.lastScanTime.toLocaleTimeString()}`,
        cls: "istart-sync-scan-time",
      });
    }

    if (this.isScanning) {
      root.createEl("p", { text: "⏳ 扫描中...", cls: "istart-sync-status-msg" });
      return;
    }

    if (this.statusList.length === 0 && this.lastScanTime) {
      root.createEl("p", { text: "✅ 已是最新，无需同步", cls: "istart-sync-success" });
      return;
    }

    if (this.statusList.length === 0) {
      root.createEl("p", { text: "点击「扫描状态」查看同步情况", cls: "istart-sync-hint" });
      return;
    }

    // 统计摘要
    const counts = this.countByAction();
    const summaryEl = root.createDiv({ cls: "istart-sync-summary" });
    if (counts.upload) this.makeBadge(summaryEl, `↑ ${counts.upload} 待上传`, "istart-sync-badge-upload");
    if (counts.download) this.makeBadge(summaryEl, `↓ ${counts.download} 待下载`, "istart-sync-badge-download");
    if (counts.conflict) this.makeBadge(summaryEl, `⚠ ${counts.conflict} 冲突`, "istart-sync-badge-conflict");
    if (counts.unchanged) this.makeBadge(summaryEl, `✓ ${counts.unchanged} 已同步`, "istart-sync-badge-unchanged");

    // 文件列表（只显示需要操作的）
    const actionItems = this.statusList.filter((s) => s.action !== SyncAction.Unchanged);
    if (actionItems.length === 0) {
      root.createEl("p", { text: "✅ 所有文件已同步", cls: "istart-sync-success" });
      return;
    }

    const listEl = root.createDiv();
    for (const item of actionItems) {
      this.renderFileRow(listEl, item);
    }
  }

  private renderFileRow(container: HTMLElement, item: FileStatus) {
    const row = container.createDiv({ cls: "istart-sync-file-row" });

    // 状态图标 + 文件名
    const left = row.createDiv({ cls: "istart-sync-file-left" });
    left.createSpan({ text: this.actionIcon(item.action), cls: "istart-sync-file-icon" });
    left.createSpan({
      text: item.path.split("/").pop() ?? item.path,
      cls: "istart-sync-file-name",
      attr: { title: item.path },
    });

    // 操作按钮
    const right = row.createDiv({ cls: "istart-sync-file-actions" });

    if (item.action === SyncAction.Upload || item.action === SyncAction.LocalOnly) {
      this.makeSmallBtn(right, "上传", () => { void this.uploadOne(item.path); });
    }
    if (item.action === SyncAction.Download || item.action === SyncAction.RemoteOnly) {
      this.makeSmallBtn(right, "下载", () => { void this.downloadOne(item); });
    }
    if (item.action === SyncAction.Conflict) {
      this.makeSmallBtn(right, "用本地", () => { void this.resolveConflict(item, "local"); });
      this.makeSmallBtn(right, "用远端", () => { void this.resolveConflict(item, "remote"); });
    }
    if (item.action === SyncAction.LocalDeleted) {
      this.makeSmallBtn(right, "删远端", () => { void this.deleteRemote(item.path); });
    }
  }

  // ── 操作 ───────────────────────────────────────────────────

  async scan() {
    const cfg = this.plugin.settings.baiduSync;
    if (!cfg.enabled || !cfg.accessToken) return;

    this.isScanning = true;
    this.render();

    try {
      const service = new BaiduSyncService(this.app, cfg);
      const tokenOk = await service.ensureValidToken();
      if (!tokenOk) { new Notice("Token 已过期，请重新授权"); return; }
      await this.plugin.saveSettings();

      const client = new BaiduPanClient(cfg);
      const remoteRoot = cfg.remotePath;

      // 获取 meta
      const metaPath = `${cfg.remotePath}/istart-sync-meta.json`;
      let meta = new BaiduSyncMeta();
      try {
        const metaBuf = await client.downloadFile(metaPath);
        if (metaBuf) meta = new BaiduSyncMeta(new TextDecoder().decode(metaBuf));
      } catch { /* 首次 */ }

      // 本地文件
      const localMap = new Map<string, number>();
      for (const f of this.app.vault.getFiles()) {
        if (!f.path.split("/").some((p) => p.startsWith("."))) {
          localMap.set(f.path, f.stat.mtime);
        }
      }

      // 远端文件
      const remoteMap = new Map<string, number>();
      const remoteEntries = await client.listAllFiles(remoteRoot);
      for (const e of remoteEntries) {
        if (!e.isdir && !e.path.endsWith("istart-sync-meta.json")) {
          const rel = e.path.replace(remoteRoot + "/", "").replace(/^\//, "");
          remoteMap.set(rel, e.server_mtime);
        }
      }

      const plans = meta.buildSyncPlan(localMap, remoteMap);
      this.statusList = plans.map((p) => ({
        path: p.path,
        action: p.action,
        localMtime: p.localMtime,
        remoteMtime: p.remoteMtime,
      }));
      this.lastScanTime = new Date();
    } catch (e) {
      new Notice("扫描失败：" + (e as Error).message);
    } finally {
      this.isScanning = false;
      this.render();
    }
  }

  async forceBackup() {
    const cfg = this.plugin.settings.baiduSync;
    const service = new BaiduSyncService(this.app, cfg);
    const tokenOk = await service.ensureValidToken();
    if (!tokenOk) { new Notice("Token 已过期，请重新授权"); return; }

    const notice = new Notice("⏳ 强制备份中...", 0);
    const result = await service.backup("", (c, t, f) =>
      notice.setMessage(`⏳ 备份 (${c}/${t})：${f.split("/").pop()}`)
    );
    notice.hide();
    new Notice(`✅ 备份完成，↑ ${result.uploaded}，跳过 ${result.skipped}，失败 ${result.failed}`);
    await this.scan();
  }

  async forceUpdate() {
    const cfg = this.plugin.settings.baiduSync;
    const service = new BaiduSyncService(this.app, cfg);
    const tokenOk = await service.ensureValidToken();
    if (!tokenOk) { new Notice("Token 已过期，请重新授权"); return; }

    const notice = new Notice("⏳ 强制更新中...", 0);
    const result = await service.restore("", true, (c, t, f) =>
      notice.setMessage(`⏳ 更新 (${c}/${t})：${f.split("/").pop()}`)
    );
    notice.hide();
    new Notice(`✅ 更新完成，↓ ${result.downloaded}，跳过 ${result.skipped}，失败 ${result.failed}`);
    await this.scan();
  }

  async runSync() {
    const cfg = this.plugin.settings.baiduSync;
    const service = new BaiduSyncService(this.app, cfg);
    const tokenOk = await service.ensureValidToken();
    if (!tokenOk) { new Notice("Token 已过期，请重新授权"); return; }

    const notice = new Notice("⏳ 同步中...", 0);
    const result = await service.sync("", { conflictStrategy: "keep-both" }, (msg) =>
      notice.setMessage(`⏳ ${msg}`)
    );
    notice.hide();

    const parts = [
      result.uploaded && `↑ ${result.uploaded}`,
      result.downloaded && `↓ ${result.downloaded}`,
      result.conflicts.length && `⚠ 冲突 ${result.conflicts.length}`,
      result.failed && `❌ ${result.failed}`,
    ].filter(Boolean).join("  ");
    new Notice(parts ? `✅ 同步完成  ${parts}` : "✅ 已是最新");
    await this.scan();
  }

  private async uploadOne(path: string) {
    const cfg = this.plugin.settings.baiduSync;
    const abstract = this.app.vault.getAbstractFileByPath(path);
    if (!abstract || !(abstract instanceof TFile)) return;
    const client = new BaiduPanClient(cfg);
    const content = await this.app.vault.readBinary(abstract);
    const remotePath = `${cfg.remotePath}/${path}`.replace(/\/+/g, "/");
    const ok = await client.uploadFile(content, remotePath);
    new Notice(ok ? `✅ 已上传：${path.split("/").pop()}` : `❌ 上传失败：${path}`);
    if (ok) await this.scan();
  }

  private async downloadOne(item: FileStatus) {
    const cfg = this.plugin.settings.baiduSync;
    const client = new BaiduPanClient(cfg);
    const remotePath = `${cfg.remotePath}/${item.path}`.replace(/\/+/g, "/");
    const content = await client.downloadFile(remotePath);
    if (!content) { new Notice(`❌ 下载失败：${item.path}`); return; }

    const dir = item.path.substring(0, item.path.lastIndexOf("/"));
    if (dir && !(await this.app.vault.adapter.exists(dir))) await this.app.vault.adapter.mkdir(dir);

    const existing = this.app.vault.getAbstractFileByPath(item.path);
    if (existing instanceof TFile) await this.app.vault.modifyBinary(existing, content);
    else await this.app.vault.createBinary(item.path, content);

    new Notice(`✅ 已下载：${item.path.split("/").pop()}`);
    await this.scan();
  }

  private async resolveConflict(item: FileStatus, strategy: "local" | "remote") {
    if (strategy === "local") await this.uploadOne(item.path);
    else await this.downloadOne(item);
  }

  private async deleteRemote(path: string) {
    const cfg = this.plugin.settings.baiduSync;
    const client = new BaiduPanClient(cfg);
    const remotePath = `${cfg.remotePath}/${path}`.replace(/\/+/g, "/");
    const ok = await client.deleteFile(remotePath);
    new Notice(ok ? `✅ 已删除远端：${path.split("/").pop()}` : `❌ 删除失败`);
    if (ok) await this.scan();
  }

  // ── 工具方法 ───────────────────────────────────────────────

  private countByAction() {
    const counts = { upload: 0, download: 0, conflict: 0, unchanged: 0 };
    for (const s of this.statusList) {
      if (s.action === SyncAction.Upload || s.action === SyncAction.LocalOnly) counts.upload++;
      else if (s.action === SyncAction.Download || s.action === SyncAction.RemoteOnly) counts.download++;
      else if (s.action === SyncAction.Conflict) counts.conflict++;
      else counts.unchanged++;
    }
    return counts;
  }

  private actionIcon(action: SyncAction): string {
    switch (action) {
      case SyncAction.Upload:
      case SyncAction.LocalOnly: return "↑";
      case SyncAction.Download:
      case SyncAction.RemoteOnly: return "↓";
      case SyncAction.Conflict: return "⚠";
      case SyncAction.LocalDeleted: return "🗑";
      case SyncAction.RemoteDeleted: return "🗑";
      default: return "✓";
    }
  }

  private makeBtn(container: HTMLElement, text: string, type: "default" | "cta", onClick: () => void) {
    const btn = container.createEl("button", {
      text,
      cls: type === "cta" ? "istart-sync-btn-cta" : "istart-sync-btn",
    });
    btn.addEventListener("click", onClick);
  }

  private makeSmallBtn(container: HTMLElement, text: string, onClick: () => void) {
    const btn = container.createEl("button", { text, cls: "istart-sync-small-btn" });
    btn.addEventListener("click", onClick);
  }

  private makeBadge(container: HTMLElement, text: string, cls: string) {
    container.createSpan({ text, cls: `istart-sync-badge ${cls}` });
  }
}
