import { App, Modal, Setting } from "obsidian";
import { QuestionClassification, QuestionCategory } from "./types";

const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  new: "🆕 新问题",
  refinement: "🔍 深化问题",
  expansion: "🌐 扩展问题",
};

export class QuestionClassifyModal extends Modal {
  private classification: QuestionClassification;
  private onConfirm: (classification: QuestionClassification) => void;

  constructor(
    app: App,
    private question: string,
    initialClassification: QuestionClassification,
    onConfirm: (classification: QuestionClassification) => void
  ) {
    super(app);
    this.classification = { ...initialClassification };
    this.onConfirm = onConfirm;
    this.titleEl.setText("问题分类确认");
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.createEl("p", {
      text: `"${this.question}"`,
      attr: { style: "font-weight: bold; margin-bottom: 12px;" },
    });

    const confidence = Math.round(this.classification.confidence * 100);
    contentEl.createEl("p", {
      text: `AI 判断置信度：${confidence}%`,
      attr: { style: "color: var(--text-muted); font-size: 12px; margin-bottom: 16px;" },
    });

    new Setting(contentEl)
      .setName("问题类型")
      .addDropdown((drop) =>
        drop
          .addOption("new", CATEGORY_LABELS.new)
          .addOption("refinement", CATEGORY_LABELS.refinement)
          .addOption("expansion", CATEGORY_LABELS.expansion)
          .setValue(this.classification.category)
          .onChange((v: QuestionCategory) => {
            this.classification.category = v;
          })
      );

    if (this.classification.parent) {
      new Setting(contentEl)
        .setName("关联父问题")
        .setDesc(this.classification.parent)
        .addExtraButton((btn) =>
          btn.setIcon("x").setTooltip("清除").onClick(() => {
            this.classification.parent = null;
            this.display();
          })
        );
    }

    if (this.classification.related.length > 0) {
      const relatedEl = contentEl.createDiv({ attr: { style: "margin-bottom: 12px;" } });
      relatedEl.createEl("div", {
        text: "相关问题",
        attr: { style: "font-size: 12px; color: var(--text-muted); margin-bottom: 4px;" },
      });
      for (const r of this.classification.related) {
        relatedEl.createEl("div", {
          text: `• ${r}`,
          attr: { style: "font-size: 13px; padding: 2px 0;" },
        });
      }
    }

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("确认并生成笔记").setCta().onClick(() => {
          this.close();
          this.onConfirm(this.classification);
        })
      )
      .addButton((btn) =>
        btn.setButtonText("跳过分类").onClick(() => {
          this.close();
          this.onConfirm({ ...this.classification, category: "new", parent: null, related: [] });
        })
      );
  }

  private display() {
    this.contentEl.empty();
    this.onOpen();
  }

  onClose() {
    this.contentEl.empty();
  }
}
