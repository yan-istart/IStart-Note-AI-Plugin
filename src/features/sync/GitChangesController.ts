import { Component, Notice, TFile } from "obsidian";
import type DeepSeekPlugin from "../../main";
import { BaiduGitSyncService, GitLocalStatus, onGitLocalChange } from "./BaiduGitSyncService";
import { GitDiffModal } from "./GitDiffModal";

export const CHANGE_LABELS = { added: "新增", modified: "修改", deleted: "删除" };

/** One debounced status scan shared by explorer decorations and open sync views. */
export class GitChangesController extends Component {
  status: GitLocalStatus | null = null;
  error = "";
  scanning = false;
  private timer?: number;
  private running = false;
  private again = false;
  private disposed = false;
  private listeners = new Set<() => void>();
  constructor(private plugin: DeepSeekPlugin) { super(); }
  get enabled() { const cfg = this.plugin.settings.baiduSync; return cfg.enabled && cfg.syncEngine === "git"; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); listener(); return () => { this.listeners.delete(listener); }; }
  private emit() { this.listeners.forEach(listener => listener()); }
  onload() {
    const { app } = this.plugin;
    const schedule = () => this.schedule();
    this.registerEvent(app.vault.on("modify", schedule));
    this.registerEvent(app.vault.on("create", schedule));
    this.registerEvent(app.vault.on("delete", schedule));
    this.registerEvent(app.vault.on("rename", schedule));
    this.registerEvent(app.workspace.on("layout-change", () => this.decorate()));
    this.register(onGitLocalChange(app, schedule));
    // File explorer mounts/recycles rows when folders expand and views reopen.
    const observer = new MutationObserver(records => {
      if (records.some(record => record.type === "childList" && [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)]
        .some(node => node.instanceOf(HTMLElement) && (node.matches(".nav-file, .nav-folder, .nav-file-title") || !!node.querySelector(".nav-file-title"))))) this.decorate();
    });
    observer.observe(app.workspace.containerEl, { childList: true, subtree: true });
    this.register(() => observer.disconnect());
    this.registerEvent(app.workspace.on("file-menu", (menu, file) => {
      if (!this.enabled || !(file instanceof TFile)) return;
      menu.addItem(item => item.setTitle("查看本地 Git 差异").setIcon("git-compare").onClick(() => this.openDiff(file.path)));
    }));
    this.plugin.addCommand({ id: "git-current-file-diff", name: "查看当前文件的本地 Git 差异", callback: () => {
      const file = app.workspace.getActiveFile();
      if (file && this.enabled) this.openDiff(file.path);
      else new Notice("请启用 Git 版本同步并打开文件");
    } });
    const bar = this.plugin.addStatusBarItem();
    bar.addClass("istart-git-status-bar");
    bar.addEventListener("click", () => {
      const file = app.workspace.getActiveFile(); if (file) this.openDiff(file.path);
    });
    const updateBar = () => {
      const path = app.workspace.getActiveFile()?.path;
      const change = this.status?.changes.find(change => change.path === path);
      bar.setText(this.enabled && change ? `Git · ${CHANGE_LABELS[change.status]}` : "");
    };
    this.register(this.subscribe(updateBar));
    this.registerEvent(app.workspace.on("active-leaf-change", updateBar));
    app.workspace.onLayoutReady(schedule);
  }
  schedule() {
    if (this.disposed) return;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.timer = undefined; void this.refresh(); }, 1000);
  }
  async refresh() {
    if (this.disposed) return;
    if (this.running) { this.again = true; return; }
    this.running = true;
    this.scanning = true;
    this.emit();
    const cfg = this.plugin.settings.baiduSync;
    const key = JSON.stringify(cfg);
    try {
      const status = this.enabled ? await new BaiduGitSyncService(this.plugin.app, cfg).localStatus() : null;
      if (this.disposed) return;
      if (key !== JSON.stringify(this.plugin.settings.baiduSync)) { this.again = true; return; }
      this.status = status; this.error = "";
    } catch (error) { this.status = null; this.error = (error as Error).message; }
    finally {
      this.running = false; this.scanning = false;
      if (!this.disposed) { this.decorate(); this.emit(); if (this.again) { this.again = false; this.schedule(); } }
    }
  }
  openDiff(path: string) { new GitDiffModal(this.plugin.app, new BaiduGitSyncService(this.plugin.app, this.plugin.settings.baiduSync), path).open(); }
  private decorate() {
    const changes = new Map(this.enabled ? this.status?.changes.map(change => [change.path, change.status]) : []);
    this.plugin.app.workspace.containerEl.querySelectorAll<HTMLElement>(".nav-file-title[data-path]").forEach(el => {
      const status = changes.get(el.dataset.path ?? "");
      const old = el.querySelector<HTMLElement>(".istart-git-file-badge");
      if (!status) { old?.remove(); return; }
      const badge = old ?? el.createSpan({ cls: "istart-git-file-badge" });
      if (badge.dataset.status !== status) {
        badge.dataset.status = status;
        badge.setText(CHANGE_LABELS[status]);
        badge.setAttribute("aria-label", `相对最近本地 Git 版本：${CHANGE_LABELS[status]}`);
      }
    });
  }
  onunload() {
    this.disposed = true;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.plugin.app.workspace.containerEl.querySelectorAll(".istart-git-file-badge").forEach(el => el.remove());
    this.listeners.clear();
  }
}
