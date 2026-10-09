import { App, Modal, Notice, Setting, TFile } from "obsidian";
import type { BaiduSyncConfig } from "../../types";
import { GitConflict, GitResolution, textOf } from "../../core/sync/GitSyncEngine";
import { BaiduGitSyncService, GitVaultResult } from "./BaiduGitSyncService";

export async function runGitSync(
  app: App, config: BaiduSyncConfig, saveSettings: () => Promise<void>,
  resolutions = new Map<string, GitResolution>()
): Promise<void> {
  const notice = new Notice("Git 同步中...", 0);
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
    new Notice(`Git 同步完成：上传 ${result.uploaded} 个版本包，下载 ${result.downloaded} 个版本包，更新 ${result.changed} 个文件${result.skipped ? `，排除 ${result.skipped} 个文件` : ""}`);
  }
}

export class BaiduGitSyncModal extends Modal {
  constructor(app: App, private readonly config: BaiduSyncConfig, private readonly saveSettings: () => Promise<void>) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText("百度网盘 Git 同步");
    this.contentEl.createEl("p", { text: "同步前保存本地提交，再合并其他设备的修改。删除也会同步，并可从历史中恢复。" });
    this.contentEl.createEl("p", { text: "首次 Git 同步从本地笔记开始；需要旧云端备份时，请先使用原有文件模式恢复。", cls: "istart-sync-hint" });
    this.contentEl.createEl("p", {
      text: this.config.autoSync ? "已开启前台自动同步。" : "自动同步已关闭；点击按钮后才同步。",
      cls: "istart-sync-hint",
    });
    new Setting(this.contentEl)
      .addButton((btn) => btn.setButtonText("开始同步").setCta().onClick(() => {
        this.close(); void runGitSync(this.app, this.config, this.saveSettings);
      }))
      .addButton((btn) => btn.setButtonText("版本历史").onClick(() => {
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
  private path: string;
  private selected = "";
  private generation = 0;

  constructor(app: App, config: BaiduSyncConfig) {
    super(app);
    this.service = new BaiduGitSyncService(app, config);
    this.path = app.workspace.getActiveFile()?.path ?? "";
  }

  onOpen() {
    this.titleEl.setText("Git 版本历史");
    this.contentEl.createEl("p", { text: "历史查看和恢复在本地完成。恢复前会保存当前版本，下次手动同步时上传。", cls: "istart-sync-hint" });
    const details = this.contentEl.createDiv();
    void this.service.history().then((entries) => {
      if (!entries.length) { details.createEl("p", { text: "暂无提交，请先执行一次 Git 同步。" }); return; }
      new Setting(details).setName("文件路径").setDesc("可填写已删除文件的原路径")
        .addText((text) => text.setValue(this.path).onChange((value) => { this.path = value.trim(); void this.loadPreview(preview); }));
      new Setting(details).setName("历史版本").addDropdown((drop) => {
        for (const entry of entries) drop.addOption(entry.oid, `${new Date(entry.timestamp).toLocaleString()} · ${entry.message} · ${entry.oid.slice(0, 8)}`);
        this.selected = entries[0].oid;
        drop.setValue(this.selected).onChange((oid) => { this.selected = oid; void this.loadPreview(preview); });
      });
      const preview = details.createDiv();
      new Setting(details).addButton((btn) => btn.setButtonText("恢复此文件版本").onClick(async () => {
        btn.setDisabled(true);
        try { await this.service.restoreFile(this.path, this.selected); new Notice("已恢复历史版本，当前版本已保存到历史"); await this.loadPreview(preview); }
        catch (error) { new Notice((error as Error).message); }
        finally { btn.setDisabled(false); }
      }));
      void this.loadPreview(preview);
    }).catch((error: Error) => { details.createEl("p", { text: error.message }); });
  }

  private async loadPreview(container: HTMLElement) {
    const generation = ++this.generation;
    try {
      const bytes = await this.service.version(this.path, this.selected);
      const historical = textOf(bytes);
      const file = this.app.vault.getAbstractFileByPath(this.path);
      const current = file instanceof TFile ? textOf(new Uint8Array(await this.app.vault.readBinary(file))) : "（本地已删除）";
      if (generation !== this.generation) return;
      container.empty();
      if (historical === undefined) { container.createEl("p", { text: `附件版本，大小 ${bytes.length} 字节` }); return; }
      container.createEl("p", { text: historical === current ? "内容一致" : "内容有差异，可对照查看" });
      const columns = container.createDiv({ cls: "istart-git-comparison" });
      for (const [label, text] of [["历史版本", historical], ["当前版本", current ?? "（附件内容）"]]) {
        const column = columns.createDiv();
        column.createEl("strong", { text: label });
        column.createEl("pre", { text, cls: "istart-git-preview" });
      }
    } catch (error) {
      if (generation !== this.generation) return;
      container.empty(); container.createEl("p", { text: (error as Error).message });
    }
  }

  onClose() { this.generation++; this.contentEl.empty(); }
}
