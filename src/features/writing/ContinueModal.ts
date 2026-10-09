import { App, Modal, Setting } from "obsidian";
import { ContinueMode, ContinueRequest } from "./types";

/**
 * 续写弹窗 — 选择模式,可选附加指令与目标字数。
 */
export class ContinueModal extends Modal {
  private mode: ContinueMode = "cursor";
  private instruction = "";
  private targetWords: number;

  constructor(
    app: App,
    defaultWords: number,
    private chapterTitle: string,
    private onSubmit: (request: ContinueRequest) => void
  ) {
    super(app);
    this.targetWords = defaultWords;
    this.titleEl.setText(`续写：${chapterTitle}`);
  }

  onOpen() {
    const { contentEl } = this;

    new Setting(contentEl)
      .setName("续写方式")
      .addDropdown((drop) =>
        drop
          .addOption("cursor", "光标续写（接住当前段落）")
          .addOption("chapter", "章节续写（文末写完本章）")
          .setValue(this.mode)
          .onChange((v) => { this.mode = v as ContinueMode; })
      );

    new Setting(contentEl)
      .setName("附加指令")
      .setDesc("可选，如：推进感情线 / 收束本章悬念 / 引入新反派")
      .addText((text) =>
        text.setPlaceholder("留空则自然续写").onChange((v) => { this.instruction = v.trim(); })
      );

    new Setting(contentEl)
      .setName("目标字数")
      .addText((text) =>
        text.setValue(String(this.targetWords)).onChange((v) => {
          const n = parseInt(v);
          if (!isNaN(n) && n > 0) this.targetWords = n;
        })
      );

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("开始续写").setCta().onClick(() => {
          this.close();
          this.onSubmit({ mode: this.mode, instruction: this.instruction, targetWords: this.targetWords });
        })
      )
      .addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));
  }

  onClose() {
    this.contentEl.empty();
  }
}
