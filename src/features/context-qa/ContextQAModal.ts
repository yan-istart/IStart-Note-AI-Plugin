import { App, Modal, Setting } from "obsidian";

export class ContextQAModal extends Modal {
  private question = "";

  constructor(
    app: App,
    private selectedText: string,
    private onSubmit: (question: string) => void
  ) {
    super(app);
    this.titleEl.setText("基于选中内容提问");
  }

  onOpen() {
    const { contentEl } = this;

    // 显示选中内容预览
    const preview = contentEl.createDiv({
      attr: {
        style: [
          "background: var(--background-secondary)",
          "border-left: 3px solid var(--interactive-accent)",
          "padding: 8px 12px",
          "margin-bottom: 14px",
          "border-radius: 4px",
          "font-size: 13px",
          "color: var(--text-muted)",
          "max-height: 80px",
          "overflow-y: auto",
          "white-space: pre-wrap",
          "word-break: break-word",
        ].join(";"),
      },
    });
    preview.setText(
      this.selectedText.length > 200
        ? this.selectedText.slice(0, 200) + "…"
        : this.selectedText
    );

    const textArea = contentEl.createEl("textarea", {
      attr: {
        placeholder: "针对上方内容，输入你的问题...",
        rows: "3",
        style: "width:100%; resize:vertical; padding:8px; font-size:14px;",
      },
    });

    textArea.addEventListener("input", () => (this.question = textArea.value));
    textArea.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") this.submit();
    });

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("提问 (Ctrl+Enter)").setCta().onClick(() => this.submit())
      )
      .addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));

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
