import { App, ButtonComponent, Modal, Notice, Setting, TFile } from "obsidian";
import type { BaiduSyncConfig } from "../../types";
import { GitConflict, GitResolution, GitVersionFile, textOf } from "../../core/sync/GitSyncEngine";
import { BaiduGitSyncService, GitRestorePreview, GitVaultResult } from "./BaiduGitSyncService";

export async function runGitSync(
  app: App, config: BaiduSyncConfig, saveSettings: () => Promise<void>,
  resolutions = new Map<string, GitResolution>()
): Promise<void> {
  const notice = new Notice("Git 整库同步中...", 0);
  try {
    const result = await new BaiduGitSyncService(app, config).sync(resolutions, (message) => notice.setMessage(message));
    await saveSettings();
    showResult(result);
    if (result.conflicts.length) new GitConflictModal(app, result.conflicts, resolutions, async (choices) => {
      await runGitSync(app, config, saveSettings, choices);
    }).open();
  } catch (error) { new Notice(`Git 同步失败：${(error as Error).message}`); }
  finally { notice.hide(); }
}

function showResult(result: GitVaultResult): void {
  if (result.conflicts.length) {
    new Notice(`发现 ${result.conflicts.length} 个冲突，本地文件和提交已保留`);
  } else {
    new Notice(`Git 整库同步完成：版本含 ${result.tracked} 个文件，上传 ${result.uploaded} 个版本包，下载 ${result.downloaded} 个版本包，更新 ${result.changed} 个文件${result.skipped ? `，排除 ${result.skipped} 个本地文件` : ""}`);
  }
}

export class BaiduGitSyncModal extends Modal {
  constructor(app: App, private readonly config: BaiduSyncConfig, private readonly saveSettings: () => Promise<void>) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText("百度网盘 Git 整库同步");
    this.contentEl.createEl("p", { text: `同步范围：整个笔记库「${this.app.vault.getName()}」，包括所有子目录中的笔记与附件。每个提交保存整个同步范围的版本。` });
    try {
      const scope = new BaiduGitSyncService(this.app, this.config).scope();
      this.contentEl.createEl("p", { text: `本地可同步 ${scope.included} 个文件，按规则排除 ${scope.excluded} 个文件。` });
    } catch (error) { this.contentEl.createEl("p", { text: (error as Error).message }); }
    this.contentEl.createEl("p", { text: "同步前保存本地提交，再合并其他设备的修改。删除也会同步，并可从历史中恢复。" });
    this.contentEl.createEl("p", { text: "首次 Git 同步从本地笔记开始；需要旧云端备份时，请先使用原有文件模式恢复。", cls: "istart-sync-hint" });
    this.contentEl.createEl("p", {
      text: this.config.autoSync ? "已开启前台自动同步。" : "自动同步已关闭；点击按钮后才同步。",
      cls: "istart-sync-hint",
    });
    new Setting(this.contentEl)
      .addButton((btn) => btn.setButtonText("同步整个笔记库").setCta().onClick(() => {
        this.close(); void runGitSync(this.app, this.config, this.saveSettings);
      }))
      .addButton((btn) => btn.setButtonText("整库版本历史").onClick(() => {
        this.close(); new GitHistoryModal(this.app, this.config).open();
      }));
  }

  onClose() { this.contentEl.empty(); }
}

class GitConflictModal extends Modal {
  private readonly choices: Map<string, GitResolution>;

  constructor(app: App, private readonly conflicts: GitConflict[], previous: Map<string, GitResolution>,
    private readonly resolve: (choices: Map<string, GitResolution>) => Promise<void>) {
    super(app); this.choices = new Map(previous);
  }

  onOpen() {
    this.titleEl.setText("处理同步冲突");
    this.contentEl.createEl("p", { text: "本地内容尚未被覆盖。为每个文件选择处理方式，关闭窗口可稍后再同步。" });
    for (const conflict of this.conflicts) {
      const box = this.contentEl.createDiv({ cls: "istart-git-conflict" });
      box.createEl("h4", { text: conflict.path });
      if (conflict.binary) box.createEl("p", { text: "附件内容冲突，请选择保留哪个版本。" });
      else {
        const previews = box.createDiv({ cls: "istart-git-comparison" });
        this.preview(previews, "本地版本", conflict.local);
        this.preview(previews, "云端版本", conflict.remote);
      }
      const manual = box.createEl("textarea", { cls: "istart-git-editor" });
      manual.value = conflict.local ?? "";
      manual.hidden = true;
      manual.addEventListener("input", () => this.choices.set(conflict.key, { choice: "text", text: manual.value }));
      new Setting(box).setName("处理方式").addDropdown((drop) => {
        drop.addOption("", "请选择").addOption("local", "保留本地（本地已删除时保留删除）")
          .addOption("remote", "保留云端（云端已删除时保留删除）");
        if (!conflict.binary) drop.addOption("text", "编辑合并内容");
        drop.onChange((value) => {
          manual.hidden = value !== "text";
          if (value === "text") this.choices.set(conflict.key, { choice: "text", text: manual.value });
          else if (value === "local" || value === "remote") this.choices.set(conflict.key, { choice: value });
          else this.choices.delete(conflict.key);
        });
      });
    }
    new Setting(this.contentEl).addButton((btn) => btn.setButtonText("应用并继续同步").setCta().onClick(() => {
      if (this.conflicts.some((conflict) => !this.choices.has(conflict.key))) {
        new Notice("请为所有冲突选择处理方式"); return;
      }
      this.close(); void this.resolve(this.choices);
    }));
  }

  private preview(parent: HTMLElement, label: string, content?: string) {
    const column = parent.createDiv();
    column.createEl("strong", { text: label });
    column.createEl("pre", { text: content ?? "（此版本中不存在该文件）", cls: "istart-git-preview" });
  }

  onClose() { this.contentEl.empty(); }
}

export class GitHistoryModal extends Modal {
  private readonly service: BaiduGitSyncService;
  private path = "";
  private selected = "";
  private generation = 0;
  private previewGeneration = 0;
  private isOpen = false;
  private operations: Promise<unknown> = Promise.resolve();

  constructor(app: App, config: BaiduSyncConfig, private readonly changed: () => void = () => {}) {
    super(app);
    this.service = new BaiduGitSyncService(app, config);
  }

  private queued<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation);
    this.operations = result.then(() => undefined, () => undefined);
    return result;
  }

  onOpen() {
    this.isOpen = true;
    this.renderHistory();
  }

  private renderHistory() {
    const generation = ++this.generation;
    this.previewGeneration++;
    this.contentEl.empty();
    this.titleEl.setText("整个笔记库的 Git 版本历史");
    this.contentEl.createEl("p", { text: `项目：${this.app.vault.getName()}。每个版本包含整个同步范围的文件；选择版本后查看全库文件和相对上一版本的增删改。`, cls: "istart-sync-hint" });
    this.contentEl.createEl("p", { text: "恢复在本地完成，当前内容会先保存到历史，下次手动同步时上传。配置、隐藏文件和按规则排除的文件保持原样。", cls: "istart-sync-hint" });
    const details = this.contentEl.createDiv();
    details.createEl("p", { text: "读取整库版本历史..." });
    void this.queued(() => this.service.history()).then((entries) => {
      if (!this.isOpen || generation !== this.generation) return;
      details.empty();
      if (!entries.length) { details.createEl("p", { text: "暂无提交，请先执行一次 Git 同步。" }); return; }
      const version = details.createDiv();
      const content = details.createDiv();
      new Setting(version).setName("整个笔记库的历史版本").addDropdown((drop) => {
        for (const entry of entries) drop.addOption(entry.oid, `${new Date(entry.timestamp).toLocaleString()} · ${entry.message} · ${entry.oid.slice(0, 8)}`);
        this.selected = entries[0].oid;
        drop.setValue(this.selected).onChange((oid) => { this.selected = oid; void this.loadVersion(content); });
      });
      void this.loadVersion(content);
    }).catch((error: Error) => {
      if (this.isOpen && generation === this.generation) { details.empty(); details.createEl("p", { text: error.message }); }
    });
  }

  private async loadVersion(container: HTMLElement) {
    const generation = ++this.generation;
    this.previewGeneration++;
    this.path = "";
    const selected = this.selected;
    container.empty();
    container.createEl("p", { text: "读取此版本的全部文件..." });
    try {
      const version = await this.queued(() => this.service.versionDetails(selected));
      if (!this.isOpen || generation !== this.generation) return;
      container.empty();
      container.createEl("p", { text: `版本含 ${version.total} 个文件；相较上一版本：新增 ${version.added}，修改 ${version.modified}，删除 ${version.deleted}。` });
      new Setting(container).setName("恢复整个笔记库到此版本")
        .setDesc("先预览整库增删改，再确认恢复。恢复会生成新提交，保留后续历史。")
        .addButton((btn) => btn.setButtonText("预览整库恢复").onClick(async () => {
          btn.setDisabled(true);
          try {
            const plan = await this.queued(() => this.service.previewRestoreVersion(selected));
            if (this.isOpen && generation === this.generation) {
              new GitRestoreVersionModal(this.app, this.service, plan, () => {
                this.changed();
                if (this.isOpen) this.renderHistory();
              }).open();
            }
          } catch (error) { new Notice((error as Error).message); }
          finally { btn.setDisabled(false); }
        }));
      container.createEl("h4", { text: "此版本的全库文件（含本次删除记录）" });
      const filter = container.createDiv();
      const list = container.createDiv({ cls: "istart-git-file-list" });
      const preview = container.createDiv();
      let restoreButton: ButtonComponent;
      new Setting(preview).setName("单个文件操作（可选）").addButton((btn) => {
        restoreButton = btn.setButtonText("恢复选中文件").setDisabled(true).onClick(async () => {
          const path = this.path;
          btn.setDisabled(true);
          try {
            await this.queued(() => this.service.restoreFile(path, selected));
            new Notice("已恢复选中文件，当前内容已保存到历史");
            this.changed();
            if (this.isOpen) this.renderHistory();
          } catch (error) { new Notice((error as Error).message); }
          finally { btn.setDisabled(false); }
        });
      });
      const comparison = preview.createDiv();
      comparison.createEl("p", { text: "选择上面的任意文件查看内容；默认展示整个笔记库，不依赖当前打开的文档。", cls: "istart-sync-hint" });
      const select = (file: GitVersionFile) => {
        this.path = file.path;
        restoreButton.setDisabled(file.status === "deleted");
        void this.loadPreview(comparison, selected, file);
      };
      let query = "", limit = 200;
      const renderFiles = () => {
        list.empty();
        const files = version.files.filter((file) => file.path.toLowerCase().includes(query.toLowerCase()));
        if (!files.length) { list.createEl("p", { text: "没有匹配的文件。" }); return; }
        for (const file of files.slice(0, limit)) {
          const row = list.createDiv({ cls: "istart-git-file-row" });
          row.createSpan({ text: fileStatusLabel(file.status), cls: "istart-git-file-status" });
          row.createEl("button", { text: file.path, cls: "istart-git-file-path" }).addEventListener("click", () => select(file));
        }
        if (files.length > limit) list.createEl("button", { text: `显示更多（共 ${files.length} 个）` }).addEventListener("click", () => { limit += 200; renderFiles(); });
      };
      new Setting(filter).setName("筛选文件路径").addText((text) => text.setPlaceholder("文件夹或文件名").onChange((value) => { query = value; limit = 200; renderFiles(); }));
      renderFiles();
    } catch (error) {
      if (this.isOpen && generation === this.generation) { container.empty(); container.createEl("p", { text: (error as Error).message }); }
    }
  }

  private async loadPreview(container: HTMLElement, selected: string, entry: GitVersionFile) {
    const generation = ++this.previewGeneration;
    container.empty();
    container.createEl("p", { text: `读取 ${entry.path}...` });
    try {
      const bytes = entry.status === "deleted" ? undefined : await this.queued(() => this.service.version(entry.path, selected));
      const historical = bytes ? textOf(bytes) : "（此版本中不存在该文件）";
      const file = this.app.vault.getAbstractFileByPath(entry.path);
      const current = file instanceof TFile ? textOf(new Uint8Array(await this.app.vault.readBinary(file))) : "（本地已删除）";
      if (!this.isOpen || generation !== this.previewGeneration) return;
      container.empty();
      container.createEl("h4", { text: entry.path });
      if (historical === undefined) { container.createEl("p", { text: `附件版本，大小 ${bytes!.length} 字节` }); return; }
      container.createEl("p", { text: historical === current ? "内容一致" : "内容有差异，可对照查看" });
      const columns = container.createDiv({ cls: "istart-git-comparison" });
      for (const [label, text] of [["历史版本", historical], ["当前版本", current ?? "（附件内容）"]]) {
        const column = columns.createDiv();
        column.createEl("strong", { text: label });
        column.createEl("pre", { text, cls: "istart-git-preview" });
      }
    } catch (error) {
      if (!this.isOpen || generation !== this.previewGeneration) return;
      container.empty(); container.createEl("p", { text: (error as Error).message });
    }
  }

  onClose() { this.isOpen = false; this.generation++; this.previewGeneration++; this.contentEl.empty(); }
}

function fileStatusLabel(status: GitVersionFile["status"]): string {
  return { added: "新增", modified: "修改", deleted: "删除", unchanged: "未改" }[status];
}

class GitRestoreVersionModal extends Modal {
  constructor(app: App, private readonly service: BaiduGitSyncService, private readonly plan: GitRestorePreview,
    private readonly restored: () => void) { super(app); }

  onOpen() {
    this.titleEl.setText("确认恢复整个笔记库");
    this.contentEl.createEl("p", { text: `恢复至版本 ${this.plan.version.slice(0, 8)}：新增 ${this.plan.details.added}，修改 ${this.plan.details.modified}，删除 ${this.plan.details.deleted} 个文件。` });
    this.contentEl.createEl("p", { text: "当前内容已保存到历史。删除的文件会移至 Obsidian 回收站；此次恢复生成新提交，下次手动同步时上传。" });
    if (this.plan.skipped) this.contentEl.createEl("p", { text: `按同步规则保留 ${this.plan.skipped} 个已记录文件的当前状态。` });
    const files = this.contentEl.createDiv({ cls: "istart-git-file-list" });
    const changes = this.plan.details.files.filter((file) => file.status !== "unchanged");
    if (!changes.length) files.createEl("p", { text: "整个同步范围已与此版本一致，无需恢复。" });
    for (const file of changes) files.createDiv({ text: `${fileStatusLabel(file.status)} · ${file.path}`, cls: "istart-git-restore-path" });
    new Setting(this.contentEl).addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()))
      .addButton((btn) => btn.setButtonText("确认恢复整个笔记库").setCta().setDisabled(!changes.length).onClick(async () => {
        btn.setDisabled(true);
        try {
          const result = await this.service.restoreVersion(this.plan.version, this.plan.before);
          new Notice(`整库恢复完成：更新 ${result.changed} 个文件，恢复前的版本已保留`);
          this.close(); this.restored();
        }
        catch (error) { new Notice((error as Error).message); }
        finally { btn.setDisabled(false); }
      }));
  }

  onClose() { this.contentEl.empty(); }
}
