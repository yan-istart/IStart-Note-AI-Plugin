import { App, Modal, Setting, MarkdownRenderer, Component } from "obsidian";
import { DiagramType, DiagramResult, DiagramGenerator } from "./DiagramGenerator";

/**
 * 图表类型选择弹窗
 */
export class DiagramTypeModal extends Modal {
  private selectedType: DiagramType = "auto";

  constructor(
    app: App,
    private onSubmit: (type: DiagramType) => void
  ) {
    super(app);
    this.titleEl.setText("生成图表 / 公式");
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.createEl("p", {
      text: "选择要生成的类型，或让 AI 自动判断：",
      cls: "istart-diagram-hint",
    });

    const types = DiagramGenerator.getTypeLabels();

    new Setting(contentEl)
      .setName("图表类型")
      .addDropdown((drop) => {
        for (const t of types) {
          drop.addOption(t.value, t.label);
        }
        drop.setValue(this.selectedType);
        drop.onChange((v) => { this.selectedType = v as DiagramType; });
      });

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("生成").setCta().onClick(() => {
          this.close();
          this.onSubmit(this.selectedType);
        })
      )
      .addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * 图表预览弹窗 — 显示渲染后的 Mermaid/LaTeX 和原始代码
 */
export class DiagramPreviewModal extends Modal {
  private component: Component;

  constructor(
    app: App,
    private result: DiagramResult,
    private formattedCode: string,
    private onConfirm: () => void,
    private onRegenerate: () => void,
    private onRefine?: (instruction: string) => void
  ) {
    super(app);
    this.component = new Component();
  }

  onOpen() {
    const { contentEl } = this;
    this.titleEl.setText(`预览：${this.result.typeName}`);

    if (this.result.explanation) {
      contentEl.createEl("p", {
        text: this.result.explanation,
        cls: "istart-diagram-explanation",
      });
    }

    // 渲染预览
    const previewEl = contentEl.createDiv({ cls: "istart-diagram-preview" });
    void MarkdownRenderer.render(this.app, this.formattedCode, previewEl, "", this.component);

    // 原始代码（可折叠）
    const detailsEl = contentEl.createEl("details", { cls: "istart-diagram-code-details" });
    detailsEl.createEl("summary", { text: "查看源代码" });
    const codeEl = detailsEl.createEl("pre");
    codeEl.createEl("code", { text: this.result.code });

    // 优化输入
    if (this.onRefine) {
      const refineContainer = contentEl.createDiv({ cls: "istart-diagram-refine" });
      const refineInput = refineContainer.createEl("input", {
        type: "text",
        attr: { placeholder: "输入优化指令，如：添加错误处理分支..." },
        cls: "istart-diagram-refine-input",
      });

      const refineCallback = this.onRefine;
      const refineBtn = refineContainer.createEl("button", {
        text: "优化",
        cls: "istart-sync-btn",
      });
      refineBtn.addEventListener("click", () => {
        const instruction = refineInput.value.trim();
        if (!instruction) return;
        this.close();
        refineCallback(instruction);
      });
    }

    // 操作按钮
    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("插入到笔记").setCta().onClick(() => {
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
