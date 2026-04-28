import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { BaiduSyncService } from "./BaiduSyncService";
import { BaiduSyncMeta, SyncAction, SyncPlan } from "./BaiduSyncMeta";
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

  async onOpen() {
    this.render();
  }

  async onClose() {}

  // ── 渲染 ───────────────────────────────────────────────────

  private render() {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.style.cssText = "padding: 12px; overflow-y: auto; height: 100%;";

    // 标题栏
    const header = root.createDiv({ attr: { style: "display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;" } });
    header.createEl("h4", { text: "百度云同步状态", attr: { style: "margin:0; font-size:14px;" } });

    const cfg = this.plugin.settings.baiduSync;
    if (!cfg.enabled || !cfg.accessToken) {
      root.createEl("p", {
        text: "请先在设置中启用百度云同步并完成授权。",
        attr: { style: "color: var(--text-muted); font-size: 13px;" },
      });
      return;
    }

    // 操作按钮行
    const btnRow = root.createDiv({ attr: { style: "display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px;" } });

    this.makeBtn(btnRow, "🔍 扫描状态", "default", () => this.scan());
    this.makeBtn(btnRow, "⬆ 强制备份", "default", () => this.forceBackup());
    this.makeBtn(btnRow, "⬇ 强制更新", "default", () => this.forceUpdate());
    this.makeBtn(btnRow, "⇄ 双向同步", "cta", () => this.runSync());

    // 上次扫描时间
    if (this.lastScanTime) {
      root.createEl("p", {
        text: `上次扫描：${this.lastScanTime.toLocaleTimeString()}`,
        attr: { style: "font-size: 11px; color: var(--text-faint); margin-bottom: 8px;" },
      });
    }

    if (this.isScanning) {
      root.createEl("p", { text: "⏳ 扫描中...", attr: { style: "color: var(--text-muted);" } });
      return;
    }

    if (this.statusList.length === 0 && this.lastScanTime) {
      root.createEl("p", { text: "✅ 已是最新，无需同步", attr: { style: "color: var(--text-success);" } });
      return;
    }

    if (this.statusList.length === 0) {
      root.createEl("p", { text: "点击「扫描状态」查看同步情况", attr: { style: "color: var(--text-muted); font-size: 13px;" } });
      return;
    }

    // 统计摘要
    const counts = this.countByAction();
    const summaryEl = root.createDiv({ attr: { style: "display:flex; gap:12px; flex-wrap:wrap; margin-bottom:12px; font-size:12px;" } });
    if (counts.upload) this.makeBadge(summaryEl, `↑ ${counts.upload} 待上传`, "#4caf50");
    if (counts.download) this.makeBadge(summaryEl, `↓ ${counts.download} 待下载`, "#2196f3");
    if (counts.conflict) this.makeBadge(summaryEl, `⚠ ${counts.conflict} 冲突`, "#ff9800");
    if (counts.unchanged) this.makeBadge(summaryEl, `✓ ${counts.unchanged} 已同步`, "#9e9e9e");

    // 文件列表（只显示需要操作的）
    const actionItems = this.statusList.filter((s) => s.action !== SyncAction.Unchanged);
    if (actionItems.length === 0) {
      root.createEl("p", { text: "✅ 所有文件已同步", attr: { style: "color: var(--text-success);" } });
      return;
    }

    const listEl = root.createDiv();
    for (const item of actionItems) {
      this.renderFileRow(listEl, item);
    }
  }

  private renderFileRow(container: HTMLElement, item: FileStatus) {
    const row = container.createDiv({
      attr: {
        style: [
          "display:flex",
          "align-items:center",
          "justify-content:space-between",
          "padding:6px 4px",
          "border-bottom:1px solid var(--background-modifier-border)",
          "font-size:12px",
          "gap:8px",
        ].join(";"),
      },
    });

    // 状态图标 + 文件名
    const left = row.createDiv({ attr: { style: "display:flex; align-items:center; gap:6px; min-width:0; flex:1;" } });
    left.createSpan({ text: this.actionIcon(item.action), attr: { style: "flex-shrink:0;" } });
    left.createSpan({
      text: item.path.split("/").pop() ?? item.path,
      attr: {
        title: item.path,
        style: "overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color: var(--text-normal);",
      },
    });

    // 操作按钮
    const right = row.createDiv({ attr: { style: "display:flex; gap:4px; flex-shrink:0;" } });

    if (item.action === SyncAction.Upload || item.action === SyncAction.LocalOnly) {
      this.makeSmallBtn(right, "上传", () => this.uploadOne(item.path));
    }
    if (item.action === SyncAction.Download || item.action === SyncAction.RemoteOnly) {
      this.makeSmallBtn(right, "下载", () => this.downloadOne(item));
    }
    if (item.action === SyncAction.Conflict) {
      this.makeSmallBtn(right, "用本地", () => this.resolveConflict(item, "local"));
      this.makeSmallBtn(right, "用远端", () => this.resolveConflict(item, "remote"));
    }
    if (item.action === SyncAction.LocalDeleted) {
      this.makeSmallBtn(right, "删远端", () => this.deleteRemote(item.path));
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

      // 直接复用 BaiduSyncMeta 的计划逻辑
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
      new Notice("扫描失败：" + e.message);
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
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) return;
    const client = new BaiduPanClient(cfg);
    const content = await this.app.vault.readBinary(file as any);
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
    if (existing) await this.app.vault.modifyBinary(existing as any, content);
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
    const btn = container.createEl("button", { text });
    btn.style.cssText = `
      padding: 4px 10px; font-size: 12px; border-radius: 4px; cursor: pointer;
      background: ${type === "cta" ? "var(--interactive-accent)" : "var(--background-modifier-border)"};
      color: ${type === "cta" ? "var(--text-on-accent)" : "var(--text-normal)"};
      border: none;
    `;
    btn.addEventListener("click", onClick);
  }

  private makeSmallBtn(container: HTMLElement, text: string, onClick: () => void) {
    const btn = container.createEl("button", { text });
    btn.style.cssText = "padding: 2px 6px; font-size: 11px; border-radius: 3px; cursor: pointer; background: var(--background-modifier-border); border: none; color: var(--text-normal);";
    btn.addEventListener("click", onClick);
  }

  private makeBadge(container: HTMLElement, text: string, color: string) {
    container.createSpan({
      text,
      attr: { style: `color: ${color}; font-weight: 500;` },
    });
  }
}
