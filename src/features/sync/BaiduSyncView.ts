import { ItemView, Modal, Notice, Platform, Setting, TFile, WorkspaceLeaf } from "obsidian";
import { BaiduSyncService } from "./BaiduSyncService";
import { SyncAction } from "./BaiduSyncMeta";
import { BaiduPanClient } from "./BaiduPanClient";
import { BaiduGitSyncService } from "./BaiduGitSyncService";
import { runGitSync, GitHistoryModal } from "./BaiduGitSyncModal";
import type DeepSeekPlugin from "../../main";
import { mountGitChangesPanel } from "./GitChangesPanel";
import { renderWorkbenchNav } from "../workbench/WorkbenchNav";
import { WORKBENCH_VIEWS } from "../workbench/WorkbenchController";
import { destructiveButton } from "../../ui/compat";
import { openFileConflicts } from "./FileConflictModal";
import { bindSidebarViewport } from "../../ui/SidebarViewport";

export const SYNC_VIEW_TYPE = WORKBENCH_VIEWS.sync;

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
  private viewIsOpen = false;
  private renderedSettingsKey = "";
  private renderGeneration = 0;
  private unmountChanges?: () => void;
  private cleanupViewport?: () => void;
  private advancedOpen = false;
  private historyOpen = !Platform.isMobile;
  private scopeOpen = !Platform.isMobile;

  constructor(leaf: WorkspaceLeaf, plugin: DeepSeekPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return SYNC_VIEW_TYPE; }
  getDisplayText(): string { return "IStart 工作台"; }
  getIcon(): string { return "istart-assistant"; }

  onOpen(): Promise<void> {
    this.viewIsOpen = true;
    this.render();
    this.cleanupViewport = bindSidebarViewport(this.contentEl);
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    this.unmountChanges?.();
    this.cleanupViewport?.();
    this.viewIsOpen = false;
    this.renderGeneration++;
    return Promise.resolve();
  }

  private settingsKey(): string {
    const cfg = this.plugin.settings.baiduSync;
    return JSON.stringify([cfg.enabled, !!cfg.accessToken, cfg.syncEngine, cfg.autoSync, cfg.remotePath, cfg.ignorePattern, cfg.fileSizeLimitMB]);
  }

  /** Update open views when sync settings change without reloading the plugin. */
  refreshSettings(): void {
    if (!this.viewIsOpen || this.renderedSettingsKey === this.settingsKey()) return;
    this.statusList = [];
    this.lastScanTime = null;
    this.render();
  }

  // ── 渲染 ───────────────────────────────────────────────────

  private render() {
    if (!this.viewIsOpen) return;
    this.unmountChanges?.();
    const generation = ++this.renderGeneration;
    this.renderedSettingsKey = this.settingsKey();
    const container = this.contentEl;
    const scrollTop = container.querySelector(".istart-workbench-body")?.scrollTop ?? 0;
    container.empty();
    container.addClass("istart-sync-root");
    renderWorkbenchNav(container, this.plugin, "sync");
    const root = container.createDiv({ cls: "istart-workbench-body" });
    queueMicrotask(() => { if (root.isConnected) root.scrollTop = scrollTop; });

    // 标题栏
    const header = root.createDiv({ cls: "istart-sync-header" });
    header.createEl("h4", { text: "数据同步" });

    const cfg = this.plugin.settings.baiduSync;
    header.createSpan({
      text: cfg.syncEngine === "git" ? "Git 版本同步" : "文件同步",
      cls: "istart-sync-mode",
    });
    root.createEl("p", { text: "存储服务：百度网盘", cls: "istart-sync-hint" });
    if (!cfg.enabled || !cfg.accessToken) {
      root.createEl("p", {
        text: "请先在设置 → 数据同步中启用 IStart 数据同步，并在百度网盘配置中完成授权。",
        cls: "istart-sync-hint",
      });
      if (cfg.enabled && cfg.syncEngine === "git") this.unmountChanges = mountGitChangesPanel(root.createDiv(), this.plugin.gitChanges);
      return;
    }

    if (cfg.syncEngine === "git") {
      const service = new BaiduGitSyncService(this.app, cfg);
      root.createEl("p", { text: cfg.autoSync ? "前台自动同步已开启" : "自动同步已关闭", cls: "istart-sync-hint" });
      const buttons = root.createDiv({ cls: "istart-sync-btn-row" });
      this.makeBtn(buttons, "手动同步整库", "cta", () => {
        void runGitSync(this.app, cfg, () => this.plugin.saveSettings()).then(() => this.render());
      });
      this.makeBtn(buttons, "整库版本历史", "default", () => new GitHistoryModal(this.app, cfg, () => this.render()).open());
      const scope = root.createEl("details", { cls: "istart-sync-scope" });
      scope.open = this.scopeOpen;
      scope.createEl("summary", { text: "同步范围与说明" });
      scope.addEventListener("toggle", () => { if (scope.isConnected) this.scopeOpen = scope.open; });
      scope.createEl("p", { text: `同步范围：整个笔记库「${this.app.vault.getName()}」，包括所有子目录的笔记与附件。`, cls: "istart-sync-hint" });
      try {
        const counts = service.scope();
        scope.createEl("p", { text: `本地可同步 ${counts.included} 个文件，按规则排除 ${counts.excluded} 个文件。配置与隐藏文件不参与同步。`, cls: "istart-sync-hint" });
      } catch (error) { scope.createEl("p", { text: (error as Error).message }); }
      this.unmountChanges = mountGitChangesPanel(root.createDiv(), this.plugin.gitChanges);
      const history = root.createEl("details", { cls: "istart-sync-history" });
      history.open = this.historyOpen;
      history.createEl("summary", { text: "最近版本" });
      history.addEventListener("toggle", () => { if (history.isConnected) this.historyOpen = history.open; });
      void service.history().then((entries) => {
        if (!this.viewIsOpen || generation !== this.renderGeneration) return;
        if (!entries.length) history.createEl("p", { text: "尚无提交，点击手动同步整库保存第一个版本。" });
        for (const entry of entries.slice(0, 10)) {
          history.createDiv({ cls: "istart-sync-file-row", text: `${entry.oid.slice(0, 8)} · ${entry.message} · ${new Date(entry.timestamp).toLocaleString()}` });
        }
      }).catch((error: Error) => {
        if (this.viewIsOpen && generation === this.renderGeneration) history.createEl("p", { text: error.message });
      });
      return;
    }

    root.createEl("p", {
      text: "当前使用原有文件同步。需要提交历史与文本合并时，可在插件设置的「同步方式」中选择「Git 版本同步」。",
      cls: "istart-sync-hint",
    });

    // 操作按钮行
    const btnRow = root.createDiv({ cls: "istart-sync-btn-row" });

    this.makeBtn(btnRow, "双向同步", "cta", () => { void this.runSync(); });
    this.makeBtn(btnRow, "扫描状态", "default", () => { void this.scan(); });
    const advanced = root.createEl("details", { cls: "istart-sync-advanced" });
    advanced.open = this.advancedOpen;
    advanced.createEl("summary", { text: "备份与恢复" });
    advanced.addEventListener("toggle", () => { if (advanced.isConnected) this.advancedOpen = advanced.open; });
    const advancedButtons = advanced.createDiv({ cls: "istart-sync-btn-row" });
    this.makeBtn(advancedButtons, "强制备份", "default", () => { void this.forceBackup(); });
    this.makeBtn(advancedButtons, "强制更新", "default", () => { void this.forceUpdate(); });
    this.makeBtn(advancedButtons, "强制覆盖", "default", () => { void this.forceOverwrite(); });

    // 上次扫描时间
    if (this.lastScanTime) {
      root.createEl("p", {
        text: `上次扫描：${this.lastScanTime.toLocaleTimeString()}`,
        cls: "istart-sync-scan-time",
      });
    }

    if (this.isScanning) {
      root.createEl("p", { text: "扫描中...", cls: "istart-sync-status-msg" });
      return;
    }

    if (this.statusList.length === 0 && this.lastScanTime) {
      root.createEl("p", { text: "已是最新，无需同步", cls: "istart-sync-success" });
      return;
    }

    if (this.statusList.length === 0) {
      root.createEl("p", { text: "点击「扫描状态」查看同步情况", cls: "istart-sync-hint" });
      return;
    }

    // 统计摘要
    const counts = this.countByAction();
    const summaryEl = root.createDiv({ cls: "istart-sync-summary" });
    if (counts.upload) this.makeBadge(summaryEl, `待上传 ${counts.upload}`, "istart-sync-badge-upload");
    if (counts.download) this.makeBadge(summaryEl, `待下载 ${counts.download}`, "istart-sync-badge-download");
    if (counts.conflict) {
      this.makeBadge(summaryEl, `冲突 ${counts.conflict}`, "istart-sync-badge-conflict");
      this.makeSmallBtn(summaryEl, "批量处理冲突", () => { void this.openConflicts(); });
    }
    if (counts.unchanged) this.makeBadge(summaryEl, `已同步 ${counts.unchanged}`, "istart-sync-badge-unchanged");

    // 文件列表（只显示需要操作的）
    const actionItems = this.statusList.filter((s) => s.action !== SyncAction.Unchanged);
    if (actionItems.length === 0) {
      root.createEl("p", { text: "所有文件已同步", cls: "istart-sync-success" });
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
    const name = left.createDiv({ cls: "istart-sync-file-info" });
    name.createSpan({
      text: item.path.split("/").pop() ?? item.path,
      cls: "istart-sync-file-name",
      attr: { title: item.path },
    });
    if (item.path.includes("/")) name.createSpan({ cls: "istart-sync-file-folder", text: item.path.slice(0, item.path.lastIndexOf("/")) });

    // 操作按钮
    const right = row.createDiv({ cls: "istart-sync-file-actions" });

    if (item.action === SyncAction.Upload || item.action === SyncAction.LocalOnly) {
      this.makeSmallBtn(right, "上传", () => { void this.uploadOne(item.path); });
    }
    if (item.action === SyncAction.Download || item.action === SyncAction.RemoteOnly) {
      this.makeSmallBtn(right, "下载", () => { void this.downloadOne(item); });
    }
    if ([SyncAction.Conflict, SyncAction.LocalDeleted, SyncAction.RemoteDeleted].includes(item.action)) {
      this.makeSmallBtn(right, "查看差异与处理", () => { void this.openConflicts(item.path); });
    }
  }

  // ── 操作 ───────────────────────────────────────────────────

  async scan() {
    const cfg = this.plugin.settings.baiduSync;
    if (!cfg.enabled || !cfg.accessToken || cfg.syncEngine === "git") return;
    const scanSettingsKey = this.settingsKey();

    this.isScanning = true;
    this.render();

    try {
      const service = new BaiduSyncService(this.app, cfg);
      const tokenOk = await service.ensureValidToken();
      if (!tokenOk) { new Notice("Token 已过期，请重新授权"); return; }
      await this.plugin.saveSettings();

      const plans = await service.scan();
      if (scanSettingsKey !== this.settingsKey()) return;
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

    const notice = new Notice("强制备份中...", 0);
    const result = await service.backup("", (c, t, f) =>
      notice.setMessage(`备份 (${c}/${t})：${f.split("/").pop()}`)
    );
    notice.hide();
    new Notice(`备份完成：上传 ${result.uploaded}，跳过 ${result.skipped}，失败 ${result.failed}`);
    await this.scan();
  }

  async forceUpdate() {
    const cfg = this.plugin.settings.baiduSync;
    const service = new BaiduSyncService(this.app, cfg);
    const tokenOk = await service.ensureValidToken();
    if (!tokenOk) { new Notice("Token 已过期，请重新授权"); return; }

    const notice = new Notice("强制更新中...", 0);
    const result = await service.restore("", true, (c, t, f) =>
      notice.setMessage(`更新 (${c}/${t})：${f.split("/").pop()}`)
    );
    notice.hide();
    new Notice(`更新完成：下载 ${result.downloaded}，跳过 ${result.skipped}，失败 ${result.failed}`);
    await this.scan();
  }

  async runSync() {
    const cfg = this.plugin.settings.baiduSync;
    const service = new BaiduSyncService(this.app, cfg);
    const tokenOk = await service.ensureValidToken();
    if (!tokenOk) { new Notice("Token 已过期，请重新授权"); return; }

    const notice = new Notice("同步中...", 0);
    try {
      const result = await service.sync("", { conflictStrategy: "ask" }, (msg) =>
        notice.setMessage(`${msg}`)
      );

      const parts = [
        result.uploaded && `上传 ${result.uploaded}`,
        result.downloaded && `下载 ${result.downloaded}`,
        result.conflicts.length && `冲突 ${result.conflicts.length}`,
        result.failed && `失败 ${result.failed}`,
      ].filter(Boolean).join("  ");
      new Notice(parts ? `同步完成：${parts}` : "已是最新");
      await this.scan();
      if (result.conflicts.length) await this.openConflicts();
    } catch (error) { new Notice(`同步失败：${(error as Error).message}`); }
    finally { notice.hide(); }
  }

  async forceOverwrite() {
    const cfg = this.plugin.settings.baiduSync;
    const service = new BaiduSyncService(this.app, cfg);
    const tokenOk = await service.ensureValidToken();
    if (!tokenOk) { new Notice("Token 已过期，请重新授权"); return; }

    // 二次确认
    const confirmed = await new Promise<boolean>((resolve) => {
      class OverwriteConfirmModal extends Modal {
        onOpen() {
          this.titleEl.setText("确认强制覆盖");
          this.contentEl.createEl("p", {
            text: "此操作将删除本地所有同步文件，然后从云端完整恢复。不可撤销！",
            cls: "istart-sync-modal-warning",
          });
          new Setting(this.contentEl)
            .addButton((btn) => destructiveButton(btn.setButtonText("确认覆盖")).onClick(() => { this.close(); resolve(true); }))
            .addButton((btn) => btn.setButtonText("取消").onClick(() => { this.close(); resolve(false); }));
        }
        onClose() { this.contentEl.empty(); resolve(false); }
      }
      const modal = new OverwriteConfirmModal(this.app);
      modal.open();
    });

    if (!confirmed) return;

    const notice = new Notice("强制覆盖：清理本地...", 0);

    // 删除本地文件(走回收站,尊重用户删除偏好)
    const files = this.app.vault.getFiles().filter(
      (f) => !f.path.split("/").some((p) => p.startsWith("."))
    );
    for (const f of files) {
      try { await this.app.fileManager.trashFile(f); } catch { /* ignore */ }
    }

    // 从云端恢复
    notice.setMessage("强制覆盖：从云端恢复...");
    const result = await service.restore("", true, (c, t, file) => {
      notice.setMessage(`恢复中 (${c}/${t})：${file.split("/").pop()}`);
    });
    notice.hide();

    new Notice(`强制覆盖完成：恢复 ${result.downloaded} 个文件`);
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
    new Notice(ok ? `已上传：${path.split("/").pop()}` : `上传失败：${path}`);
    if (ok) await this.scan();
  }

  private async downloadOne(item: FileStatus) {
    const cfg = this.plugin.settings.baiduSync;
    const client = new BaiduPanClient(cfg);
    const remotePath = `${cfg.remotePath}/${item.path}`.replace(/\/+/g, "/");
    const content = await client.downloadFile(remotePath);
    if (!content) { new Notice(`下载失败：${item.path}`); return; }

    const dir = item.path.substring(0, item.path.lastIndexOf("/"));
    if (dir && !(await this.app.vault.adapter.exists(dir))) await this.app.vault.adapter.mkdir(dir);

    const existing = this.app.vault.getAbstractFileByPath(item.path);
    if (existing instanceof TFile) await this.app.vault.modifyBinary(existing, content);
    else await this.app.vault.createBinary(item.path, content);

    new Notice(`已下载：${item.path.split("/").pop()}`);
    await this.scan();
  }

  private async openConflicts(initialPath?: string): Promise<void> {
    const paths = this.statusList.filter(item => [SyncAction.Conflict, SyncAction.LocalDeleted, SyncAction.RemoteDeleted].includes(item.action)).map(item => item.path);
    await openFileConflicts(this.app, this.plugin.settings.baiduSync, paths, () => this.scan(), initialPath, () => this.plugin.saveSettings());
  }

  // ── 工具方法 ───────────────────────────────────────────────

  private countByAction() {
    const counts = { upload: 0, download: 0, conflict: 0, unchanged: 0 };
    for (const s of this.statusList) {
      if (s.action === SyncAction.Upload || s.action === SyncAction.LocalOnly) counts.upload++;
      else if (s.action === SyncAction.Download || s.action === SyncAction.RemoteOnly) counts.download++;
      else if ([SyncAction.Conflict, SyncAction.LocalDeleted, SyncAction.RemoteDeleted].includes(s.action)) counts.conflict++;
      else counts.unchanged++;
    }
    return counts;
  }

  private actionIcon(action: SyncAction): string {
    switch (action) {
      case SyncAction.Upload:
      case SyncAction.LocalOnly: return "上传";
      case SyncAction.Download:
      case SyncAction.RemoteOnly: return "下载";
      case SyncAction.Conflict: return "冲突";
      case SyncAction.LocalDeleted: return "删除";
      case SyncAction.RemoteDeleted: return "删除";
      default: return "已同步";
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
