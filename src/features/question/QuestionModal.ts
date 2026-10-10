import { App, Setting, Platform } from "obsidian";
import { ActionModal } from "../../ui/ActionModal";

export class QuestionModal extends ActionModal {
  private question = "";
  private onSubmit: (question: string) => void;

  constructor(app: App, onSubmit: (question: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    super.onOpen();
    const contentEl = this.bodyEl;
    this.titleEl.setText("知识提问");

    const textArea = contentEl.createEl("textarea", {
      attr: {
        placeholder: "输入你的问题...",
        rows: "4",
      },
      cls: "istart-question-textarea",
    });

    textArea.addEventListener("input", () => {
      this.question = textArea.value;
    });

    // 支持 Ctrl/Cmd + Enter 提交
    textArea.addEventListener("keydown", (e) => {
      if (!e.isComposing && (e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        this.submit();
      }
    });

    new Setting(this.actionsEl)
      .addButton((btn) =>
        btn
          .setButtonText(Platform.isMobile ? "提问" : "提问 (Ctrl+Enter)")
          .setCta()
          .onClick(() => this.submit())
      )
      .addButton((btn) =>
        btn.setButtonText("取消").onClick(() => this.close())
      );

    // 自动聚焦
    this.focusOnDesktop(textArea);
  }

  private submit() {
    const q = this.question.trim();
    if (!q) return;
    this.close();
    this.onSubmit(q);
  }

  onClose() {
    super.onClose();
  }
}
