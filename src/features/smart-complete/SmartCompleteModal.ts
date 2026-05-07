import { App, Modal, Setting, MarkdownRenderer, Component } from "obsidian";
import { DocumentSuggestion } from "../../ai/SmartCompleter";

/**
 * 文档分析结果弹窗 — 显示建议补充的内容
 */
export class DocumentAnalysisModal extends Modal {
  private component: Component;
  private selectedIndices = new Set<number>();

  constructor(
    app: App,
    private suggestions: DocumentSuggestion[],
    private onConfirm: (selected: DocumentSuggestion[]) => void
  ) {
    super(app);
    this.component = new Component();
    this.titleEl.setText("文档分析 — 建议补充");
  }

  onOpen() {
    const { contentEl } = this;

    if (this.suggestions.length === 0) {
      contentEl.createEl("p", { text: "文档结构完整，暂无补充建议。" });
      new Setting(contentEl).addButton((btn) => btn.setButtonText("关闭").onClick(() => this.close()));
      return;
    }

    contentEl.createEl("p", {
      text: `发现 ${this.suggestions.length} 处可补充内容，勾选后插入：`,
      cls: "istart-diagram-hint",
    });

    const listEl = contentEl.createDiv({ cls: "istart-smart-suggestions" });

    for (let i = 0; i < this.suggestions.length; i++) {
      const s = this.suggestions[i];
      const row = listEl.createDiv({ cls: "istart-smart-suggestion-row" });

      const header = row.createDiv({ cls: "istart-smart-suggestion-header" });
      const cb = header.createEl("input", { type: "checkbox" });
      header.createEl("strong", { text: `${s.section}` });
      header.createEl("span", { text: ` — ${s.reason}`, cls: "istart-smart-suggestion-reason" });

      // 预览内容
      const previewEl = row.createDiv({ cls: "istart-smart-suggestion-preview" });
      void MarkdownRenderer.render(this.app, s.content, previewEl, "", this.component);

      cb.addEventListener("change", () => {
        if (cb.checked) this.selectedIndices.add(i);
        else this.selectedIndices.delete(i);
      });
    }

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("插入选中").setCta().onClick(() => {
          const selected = [...this.selectedIndices].map((i) => this.suggestions[i]);
          this.close();
          this.onConfirm(selected);
        })
      )
      .addButton((btn) =>
        btn.setButtonText("全部插入").onClick(() => {
          this.close();
          this.onConfirm(this.suggestions);
        })
      )
      .addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));
  }

  onClose() {
    this.component.unload();
    this.contentEl.empty();
  }
}

/**
 * 扩写/续写预览弹窗
 */
export class SmartPreviewModal extends Modal {
  private component: Component;

  constructor(
    app: App,
    private title: string,
    private content: string,
    private onConfirm: () => void,
    private onRegenerate: () => void
  ) {
    super(app);
    this.component = new Component();
  }

  onOpen() {
    const { contentEl } = this;
    this.titleEl.setText(this.title);

    const previewEl = contentEl.createDiv({ cls: "istart-diagram-preview" });
    void MarkdownRenderer.render(this.app, this.content, previewEl, "", this.component);

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("插入").setCta().onClick(() => {
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
    this.component.unload();
    this.contentEl.empty();
  }
}
