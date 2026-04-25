import { App, Modal, Setting } from "obsidian";

export class SectionAppendModal extends Modal {
  private count = 3;

  constructor(
    app: App,
    private sectionName: string,
    private existingCount: number,
    private onConfirm: (count: number) => void
  ) {
    super(app);
    this.titleEl.setText(`补充章节：${sectionName}`);
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.createEl("p", {
      text: `当前已有 ${this.existingCount} 条内容，选择本次新增数量：`,
      attr: { style: "color: var(--text-muted); margin-bottom: 12px;" },
    });

    new Setting(contentEl)
      .setName("新增条目数")
      .addDropdown((drop) =>
        drop
          .addOption("2", "2 条")
          .addOption("3", "3 条（推荐）")
          .addOption("5", "5 条")
          .addOption("8", "8 条")
          .setValue(String(this.count))
          .onChange((v) => (this.count = parseInt(v)))
      );

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("生成").setCta().onClick(() => {
          this.close();
          this.onConfirm(this.count);
        })
      )
      .addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class SectionPreviewModal extends Modal {
  constructor(
    app: App,
    private sectionName: string,
    private newItems: string[],
    private onConfirm: () => void,
    private onRegenerate: () => void
  ) {
    super(app);
    this.titleEl.setText(`预览新增内容：${sectionName}`);
  }

  onOpen() {
    const { contentEl } = this;

    const listEl = contentEl.createDiv({
      attr: {
        style: [
          "border: 1px solid var(--background-modifier-border)",
          "border-radius: 4px",
          "padding: 12px",
          "margin-bottom: 16px",
          "max-height: 50vh",
          "overflow-y: auto",
        ].join(";"),
      },
    });

    for (const item of this.newItems) {
      listEl.createEl("div", {
        text: `• ${item}`,
        attr: { style: "padding: 3px 0; font-size: 14px;" },
      });
    }

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("追加写入").setCta().onClick(() => {
          this.close();
          this.onConfirm();
        })
      )
      .addButton((btn) =>
        btn.setButtonText("重新生成").onClick(() => {
          this.close();
          this.onRegenerate();
        })
      )
      .addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));
  }

  onClose() {
    this.contentEl.empty();
  }
}
