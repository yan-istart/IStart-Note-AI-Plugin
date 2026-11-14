import { Component, ItemView, MarkdownRenderer, Platform, Setting, TFile, WorkspaceLeaf } from "obsidian";
import type DeepSeekPlugin from "../../main";
import { PUBLISHING_PLATFORMS, sanitizeRemoteUrl } from "../../core/publishing/types";
import type { DeliveryState, PublishingRecord } from "../../core/publishing/types";
import { renderWorkbenchNav } from "../workbench/WorkbenchNav";
import { WORKBENCH_VIEWS } from "../workbench/WorkbenchController";
import { bindSidebarViewport } from "../../ui/SidebarViewport";
import { renderPublishingConnection } from "./PublishingSettings";

export const PUBLISHING_VIEW_TYPE = WORKBENCH_VIEWS.publishing;
const STATE: Record<DeliveryState, string> = { pending: "待发送", sending: "发送中", draft: "草稿已保存", failed: "失败", unknown: "结果未知，请到平台核对" };

export class PublishingView extends ItemView {
  private preview: Component | null = null;
  private settingsOpen = false;
  private previewOpen = !Platform.isMobile;
  private recordsOpen = !Platform.isMobile;
  private opened = false;
  private cleanupViewport?: () => void;
  constructor(leaf: WorkspaceLeaf, private plugin: DeepSeekPlugin) { super(leaf); }
  getViewType(): string { return PUBLISHING_VIEW_TYPE; }
  getDisplayText(): string { return "IStart 内容分发"; }
  getIcon(): string { return "send"; }
  async onOpen(): Promise<void> {
    this.opened = true;
    this.register(this.plugin.publishing.onChange(() => { if (this.opened) this.render(); }));
    this.render();
    this.cleanupViewport = bindSidebarViewport(this.contentEl);
  }
  async onClose(): Promise<void> { this.opened = false; this.cleanupViewport?.(); this.preview?.unload(); this.contentEl.empty(); }
  private button(root: HTMLElement, text: string, work: () => Promise<void>): HTMLButtonElement {
    const button = root.createEl("button", { text, attr: { type: "button" } });
    button.disabled = this.plugin.publishing.busy;
    button.addEventListener("click", () => { void this.plugin.publishing.action(work); });
    return button;
  }
  private render(): void {
    this.preview?.unload(); this.preview = null;
    const container = this.contentEl, controller = this.plugin.publishing;
    const scrollTop = container.querySelector(".istart-workbench-body")?.scrollTop ?? 0;
    container.empty(); container.addClass("istart-publishing-root");
    renderWorkbenchNav(container, this.plugin, "publishing");
    const root = container.createDiv({ cls: "istart-workbench-body" });
    queueMicrotask(() => { if (root.isConnected) root.scrollTop = scrollTop; });
    root.createEl("h4", { text: "图文分发" });
    root.createEl("p", { text: controller.message, cls: "istart-publishing-status", attr: { role: "status", "aria-live": "polite" } });
    const settings = root.createEl("details", { cls: "istart-publishing-connection" }); settings.open = this.settingsOpen || !controller.connection;
    settings.createEl("summary", { text: Platform.isMobile ? "服务连接" : "服务连接与本地安装" });
    settings.addEventListener("toggle", () => { if (settings.isConnected) this.settingsOpen = settings.open; });
    renderPublishingConnection(settings, this.plugin);
    const actions = root.createDiv({ cls: "istart-publishing-actions" });
    this.button(actions, "预览当前笔记", async () => { await controller.prepare(this.app.workspace.getActiveFile()); }).addClass("mod-cta");
    this.button(actions, "刷新发送记录", async () => { await controller.load(); await controller.refresh(); });
    if (controller.article) {
      root.createEl("p", { text: `来源：${controller.sourcePath}`, cls: "istart-publishing-source" });
      new Setting(root).setName("分发标题").addText(input => input.setValue(controller.article!.title).onChange(value => {
        controller.article!.title = value.replace(/[\r\n]/g, " ").trim(); controller.snapshot = null;
      }));
      const previewDetails = root.createEl("details", { cls: "istart-publishing-preview-details" });
      previewDetails.open = this.previewOpen;
      previewDetails.createEl("summary", { text: "稿件预览与封面" });
      previewDetails.addEventListener("toggle", () => { if (previewDetails.isConnected) this.previewOpen = previewDetails.open; });
      new Setting(previewDetails).setName("封面").setDesc("封面支持情况由目标平台决定，保存后需在平台检查。")
        .addDropdown(dropdown => {
          dropdown.addOption("", "由平台处理");
          for (const asset of controller.article!.assets) dropdown.addOption(asset.name, asset.source.split("/").pop() ?? asset.name);
          dropdown.setValue(controller.cover).onChange(value => { controller.cover = value; });
        });
      for (const warning of controller.article.warnings) root.createEl("p", { text: warning, cls: "istart-publishing-warning" });
      const preview = previewDetails.createDiv({ cls: "istart-publishing-preview markdown-rendered" });
      this.preview = new Component(); this.preview.load();
      let markdown = controller.article.markdown;
      for (const asset of controller.article.assets) {
        const file = this.app.vault.getAbstractFileByPath(asset.source);
        if (file instanceof TFile) markdown = markdown.split(`](assets/${asset.name})`).join(`](${this.app.vault.getResourcePath(file)})`);
      }
      void MarkdownRenderer.render(this.app, markdown, preview, controller.sourcePath, this.preview).catch(() => { if (preview.isConnected) preview.setText("预览渲染失败，请检查稿件"); });
      root.createEl("h5", { text: "目标平台与浏览器账号" });
      const platforms = root.createDiv({ cls: "istart-publishing-platforms" });
      for (const platform of PUBLISHING_PLATFORMS) {
        const account = controller.accounts.find(a => a.id === platform.id);
        new Setting(platforms).setName(platform.name).setDesc(account?.isAuthenticated ? account.username || "账号无法识别，请刷新登录" : "未连接或未登录")
          .addToggle(toggle => toggle.setValue(controller.selected.has(platform.id)).setDisabled(controller.busy || !account?.isAuthenticated || !account.username).onChange(value => {
            if (value) controller.selected.add(platform.id); else controller.selected.delete(platform.id);
          }));
      }
      const send = (Platform.isMobile ? container : root).createDiv({ cls: "istart-publishing-actions istart-publishing-send" });
      this.button(send, "保存分发快照", () => controller.saveSnapshot());
      this.button(send, "发送到所选平台草稿", () => controller.send()).addClass("mod-cta");
    }
    const records = root.createEl("details", { cls: "istart-publishing-records" });
    records.open = this.recordsOpen;
    records.createEl("summary", { text: `最近发送记录 · ${controller.records.length}` });
    records.addEventListener("toggle", () => { if (records.isConnected) this.recordsOpen = records.open; });
    if (!controller.records.length) records.createEl("p", { text: "暂无发送记录。" });
    for (const record of controller.records) this.record(records, record);
  }
  private record(root: HTMLElement, record: PublishingRecord): void {
    const box = root.createDiv({ cls: "istart-publishing-record" });
    box.createEl("p", { text: `${record.snapshotFolder} · ${new Date(record.job.createdAt).toLocaleString()}` });
    for (const result of record.job.results) {
      const row = box.createDiv();
      row.createSpan({ text: `${PUBLISHING_PLATFORMS.find(p => p.id === result.platform)?.name ?? result.platform} · ${result.username ?? ""} · ${STATE[result.state]}` });
      const url = result.postUrl && sanitizeRemoteUrl(result.postUrl);
      if (url) row.createEl("a", { text: " 打开平台草稿", href: url, attr: { target: "_blank", rel: "noopener noreferrer" } });
    }
    this.button(box, "打开稿件", async () => {
      const file = this.app.vault.getAbstractFileByPath(`${record.snapshotFolder}/稿件.md`);
      if (!(file instanceof TFile)) throw new Error("找不到稿件快照");
      await this.app.workspace.getLeaf("tab").openFile(file);
    });
    if (record.job.results.some(result => result.state === "failed")) this.button(box, "重试失败平台", () => this.plugin.publishing.retry(record));
    if (record.job.results.some(result => result.state === "unknown")) box.createEl("p", { text: "请先在平台核对。服务未提供确定结果，此记录不会自动重发。" });
  }
}
