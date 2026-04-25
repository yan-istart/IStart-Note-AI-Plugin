import { App, Modal, Setting } from "obsidian";

export class QuestionModal extends Modal {
  private question = "";
  private onSubmit: (question: string) => void;

  constructor(app: App, onSubmit: (question: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "向 DeepSeek 提问" });

    const textArea = contentEl.createEl("textarea", {
      attr: {
        placeholder: "输入你的问题...",
        rows: "4",
        style: "width:100%; resize:vertical; padding:8px; font-size:14px;",
      },
    });

    textArea.addEventListener("input", () => {
      this.question = textArea.value;
    });

    // 支持 Ctrl/Cmd + Enter 提交
    textArea.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        this.submit();
      }
    });

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("提问 (Ctrl+Enter)")
          .setCta()
          .onClick(() => this.submit())
      )
      .addButton((btn) =>
        btn.setButtonText("取消").onClick(() => this.close())
      );

    // 自动聚焦
    setTimeout(() => textArea.focus(), 50);
  }

  private submit() {
    const q = this.question.trim();
    if (!q) return;
    this.close();
    this.onSubmit(q);
  }

  onClose() {
    this.contentEl.empty();
  }
}
