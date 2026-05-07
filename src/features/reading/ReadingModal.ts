import { App, Modal, Setting, Notice } from "obsidian";

/**
 * 新建阅读项目弹窗 — 输入书名和可选目录
 */
export class NewReadingModal extends Modal {
  private bookInfo = "";
  private toc = "";

  constructor(
    app: App,
    private onSubmit: (bookInfo: string, toc?: string) => void
  ) {
    super(app);
    this.titleEl.setText("新建阅读项目");
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.createEl("p", {
      text: "输入书名（和作者），AI 会生成阅读地图。如果是小众书籍，可以粘贴目录帮助 AI 理解。",
      cls: "istart-diagram-hint",
    });

    new Setting(contentEl)
      .setName("书名 / 作者")
      .setDesc("如：分布式系统：概念与设计 - George Coulouris")
      .addText((text) =>
        text
          .setPlaceholder("书名 - 作者")
          .onChange((v) => { this.bookInfo = v.trim(); })
      );

    contentEl.createEl("p", {
      text: "目录（可选，粘贴书籍目录可以让 AI 更准确）：",
      cls: "istart-diagram-hint",
    });

    const tocArea = contentEl.createEl("textarea", {
      attr: {
        placeholder: "第1章 概述\n第2章 系统模型\n第3章 ...\n\n（留空则由 AI 基于书名推断）",
        rows: "8",
      },
      cls: "istart-question-textarea",
    });
    tocArea.addEventListener("input", () => { this.toc = tocArea.value; });

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("生成阅读地图").setCta().onClick(() => {
          if (!this.bookInfo) {
            new Notice("请输入书名");
            return;
          }
          this.close();
          this.onSubmit(this.bookInfo, this.toc.trim() || undefined);
        })
      )
      .addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * 费曼检验弹窗 — 显示问题列表
 */
export class FeynmanModal extends Modal {
  constructor(
    app: App,
    private chapter: string,
    private questions: { question: string; difficulty: string; hint: string }[]
  ) {
    super(app);
    this.titleEl.setText(`费曼检验：${chapter}`);
  }

  onOpen() {
    const { contentEl } = this;

    if (this.questions.length === 0) {
      contentEl.createEl("p", { text: "暂无检验问题，请先在章节中记录笔记。" });
      new Setting(contentEl).addButton((btn) => btn.setButtonText("关闭").onClick(() => this.close()));
      return;
    }

    const difficultyLabels: Record<string, string> = {
      basic: "🟢 基础",
      intermediate: "🟡 进阶",
      advanced: "🔴 深入",
    };

    for (const q of this.questions) {
      const row = contentEl.createDiv({ cls: "istart-smart-suggestion-row" });
      const header = row.createDiv({ cls: "istart-smart-suggestion-header" });
      header.createEl("span", { text: difficultyLabels[q.difficulty] || "❓" });
      header.createEl("strong", { text: q.question });

      const details = row.createEl("details");
      details.createEl("summary", { text: "💡 提示" });
      details.createEl("p", { text: q.hint, cls: "istart-smart-suggestion-reason" });
    }

    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText("关闭").onClick(() => this.close()));
  }

  onClose() {
    this.contentEl.empty();
  }
}
