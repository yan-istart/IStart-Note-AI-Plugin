import { App, Setting } from "obsidian";
import { ContinueMode, ContinueRequest } from "./types";
import { ActionModal } from "../../ui/ActionModal";
import { addWritingFields } from "./WritingFields";

/**
 * 续写弹窗 — 选择模式,可选附加指令与目标字数。
 */
export class ContinueModal extends ActionModal {
  constructor(
    app: App,
    private defaultWords: number,
    private chapterTitle: string,
    private onSubmit: (request: ContinueRequest) => void,
    private mode: ContinueMode = "cursor"
  ) {
    super(app);
    this.titleEl.setText(`续写：${chapterTitle}`);
  }

  onOpen() {
    super.onOpen();
    const contentEl = this.bodyEl;

    new Setting(contentEl)
      .setName("续写方式")
      .addDropdown((drop) =>
        drop
          .addOption("cursor", "光标续写（接住当前段落）")
          .addOption("chapter", "文末续写（追加到文档末尾）")
          .setValue(this.mode)
          .onChange((v) => { this.mode = v as ContinueMode; })
      );

    const readRequest = addWritingFields(contentEl, this.defaultWords, [300, 800, 1500], "如：推进感情线 / 收束本章悬念");

    new Setting(this.actionsEl)
      .addButton((btn) =>
        btn.setButtonText("开始续写").setCta().onClick(() => {
          const request = readRequest();
          if (!request) return;
          this.close();
          this.onSubmit({ ...request, mode: this.mode });
        })
      )
      .addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));
  }

  onClose() {
    super.onClose();
  }
}
