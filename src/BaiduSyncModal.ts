import { App, Modal, Notice, Setting } from "obsidian";
import { BaiduSyncService } from "./BaiduSyncService";
import { BaiduSyncConfig } from "./types";

type SyncMode = "sync" | "backup" | "restore";
type ConflictStrategy = "local" | "remote" | "keep-both";

export class BaiduSyncModal extends Modal {
  private mode: SyncMode = "sync";
  private folder = "";
  private overwrite = false;
  private conflictStrategy: ConflictStrategy = "keep-both";
  private deleteRemoteOnLocalDelete = false;

  constructor(
    app: App,
    private config: BaiduSyncConfig,
    private onSaveToken: (accessToken: string, expiresAt: string) => Promise<void>
  ) {
    super(app);
    this.titleEl.setText("百度网盘同步");
  }

  onOpen() {
    const { contentEl } = this;

    new Setting(contentEl)
      .setName("操作模式")
      .addDropdown((drop) =>
        drop
          .addOption("sync", "双向同步（推荐）")
          .addOption("backup", "仅备份到百度云")
          .addOption("restore", "仅从百度云恢复")
          .setValue(this.mode)
          .onChange((v: SyncMode) => { this.mode = v; this.refresh(); })
      );

    new Setting(contentEl)
      .setName("目录范围")
      .setDesc("留空表示整个 Vault；填写相对路径如 Knowledge/Q&A 则只同步该目录")
      .addText((text) =>
        text
          .setPlaceholder("Knowledge/Q&A")
          .setValue(this.folder)
          .onChange((v) => (this.folder = v.trim()))
      );

    if (this.mode === "sync") {
      new Setting(contentEl)
        .setName("冲突处理")
        .setDesc("两端都修改了同一文件时的处理方式")
        .addDropdown((drop) =>
          drop
            .addOption("keep-both", "保留两份（本地加 .conflict 后缀）")
            .addOption("local", "以本地为准")
            .addOption("remote", "以远端为准")
            .setValue(this.conflictStrategy)
            .onChange((v: ConflictStrategy) => (this.conflictStrategy = v))
        );

      new Setting(contentEl)
        .setName("本地删除时同步删除远端")
        .setDesc("开启后，本地删除的文件也会从百度云删除")
        .addToggle((t) =>
          t.setValue(this.deleteRemoteOnLocalDelete).onChange((v) => (this.deleteRemoteOnLocalDelete = v))
        );
    }

    if (this.mode === "restore") {
      new Setting(contentEl)
        .setName("覆盖本地文件")
        .setDesc("开启后，远端文件将覆盖本地同名文件")
        .addToggle((t) => t.setValue(this.overwrite).onChange((v) => (this.overwrite = v)));
    }

    contentEl.createEl("p", {
      text: `远端路径：${this.config.remotePath}/${this.folder || "(vault root)"}`,
      cls: "istart-sync-modal-remote-path",
    });

    const modeLabels: Record<SyncMode, string> = {
      sync: "开始同步",
      backup: "开始备份",
      restore: "开始恢复",
    };

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText(modeLabels[this.mode]).setCta().onClick(() => this.run())
      )
      .addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));
  }

  private refresh() {
    this.contentEl.empty();
    this.onOpen();
  }

  private async run() {
    this.close();

    const service = new BaiduSyncService(this.app, this.config);
    const tokenOk = await service.ensureValidToken();
    if (!tokenOk) {
      new Notice("❌ Token 已过期，请重新授权");
      return;
    }
    await this.onSaveToken(this.config.accessToken, this.config.tokenExpiresAt);

    if (this.mode === "sync") {
      await this.runSync(service);
    } else if (this.mode === "backup") {
      await this.runBackup(service);
    } else {
      await this.runRestore(service);
    }
  }

  private async runSync(service: BaiduSyncService) {
    const notice = new Notice("⏳ 同步中...", 0);
    const result = await service.sync(
      this.folder,
      { conflictStrategy: this.conflictStrategy, deleteRemoteOnLocalDelete: this.deleteRemoteOnLocalDelete },
      (msg) => notice.setMessage(`⏳ ${msg}`)
    );
    notice.hide();

    const parts = [
      result.uploaded > 0 && `↑ ${result.uploaded}`,
      result.downloaded > 0 && `↓ ${result.downloaded}`,
      result.conflicts.length > 0 && `⚠️ 冲突 ${result.conflicts.length}`,
      result.deleted > 0 && `🗑 ${result.deleted}`,
      result.failed > 0 && `❌ 失败 ${result.failed}`,
    ].filter(Boolean).join("  ");

    new Notice(parts ? `✅ 同步完成  ${parts}` : "✅ 已是最新，无需同步");

    if (result.errors.length > 0) {
      console.error("[IStart-Note-AI] 同步错误：", result.errors);
    }
  }

  private async runBackup(service: BaiduSyncService) {
    const notice = new Notice("⏳ 备份中...", 0);
    const result = await service.backup(this.folder, (c, t, file) => {
      notice.setMessage(`⏳ 备份中 (${c}/${t})：${file.split("/").pop()}`);
    });
    notice.hide();
    new Notice(
      result.failed > 0
        ? `⚠️ 备份完成，↑ ${result.uploaded}，跳过 ${result.skipped}，失败 ${result.failed}`
        : `✅ 备份完成，↑ ${result.uploaded}，跳过 ${result.skipped}`
    );
    if (result.errors.length > 0) console.error("[IStart-Note-AI] 备份错误：", result.errors);
  }

  private async runRestore(service: BaiduSyncService) {
    const notice = new Notice("⏳ 恢复中...", 0);
    const result = await service.restore(this.folder, this.overwrite, (c, t, file) => {
      notice.setMessage(`⏳ 恢复中 (${c}/${t})：${file.split("/").pop()}`);
    });
    notice.hide();
    new Notice(
      result.failed > 0
        ? `⚠️ 恢复完成，↓ ${result.downloaded}，跳过 ${result.skipped}，失败 ${result.failed}`
        : `✅ 恢复完成，↓ ${result.downloaded}，跳过 ${result.skipped}`
    );
    if (result.errors.length > 0) console.error("[IStart-Note-AI] 恢复错误：", result.errors);
  }

  onClose() {
    this.contentEl.empty();
  }
}
