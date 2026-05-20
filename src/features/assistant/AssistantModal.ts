import { App, Modal, Setting, MarkdownRenderer, Component } from "obsidian";
import { AssistantResult } from "../../ai/AIAssistant";

const QUICK_TAGS = [
  { label: "扩写", value: "扩写这段内容" },
  { label: "解释", value: "解释一下" },
  { label: "深度讲解", value: "深度讲解这个概念，生成结构化知识并创建相关概念链接" },
  { label: "画图", value: "画一个流程图" },
  { label: "补全", value: "补全这个章节" },
  { label: "续写", value: "续写" },
  { label: "总结", value: "总结这篇文档" },
  { label: "公式", value: "用 LaTeX 写出公式" },
  { label: "时序图", value: "画时序图" },
];

/**
 * AI 助手输入弹窗
 */
export class AssistantInputModal extends Modal {
  private instruction = "";
  private inputEl!: HTMLTextAreaElement;

  constructor(
    app: App,
    private contextHint: string,
    private onSubmit: (instruction: string) => void
  ) {
    super(app);
    this.titleEl.setText("AI 助手");
  }

  onOpen() {
    const { contentEl } = this;

    // 上下文提示
    if (this.contextHint) {
      contentEl.createEl("p", { text: this.contextHint, cls: "istart-assistant-context" });
    }

    // 输入框
    this.inputEl = contentEl.createEl("textarea", {
      attr: { placeholder: "输入你的需求...（留空 = AI 智能判断）", rows: "3" },
      cls: "istart-assistant-input",
    });
    this.inputEl.addEventListener("input", () => { this.instruction = this.inputEl.value; });

    // Ctrl/Cmd+Enter 提交
    this.inputEl.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { this.submit(); }
    });

    // 快捷标签
    const tagsEl = contentEl.createDiv({ cls: "istart-assistant-tags" });
    for (const tag of QUICK_TAGS) {
      const btn = tagsEl.createEl("button", { text: tag.label, cls: "istart-assistant-tag" });
      btn.addEventListener("click", () => {
        this.inputEl.value = tag.value;
        this.instruction = tag.value;
        this.inputEl.focus();
      });
    }

    // 按钮
    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText("执行 (Ctrl+Enter)").setCta().onClick(() => this.submit()))
      .addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));

    setTimeout(() => this.inputEl.focus(), 50);
  }

  private submit() {
    this.close();
    this.onSubmit(this.instruction.trim());
  }

  onClose() { this.contentEl.empty(); }
}

/**
 * AI 助手结果预览弹窗
 */
export class AssistantResultModal extends Modal {
  private component: Component;

  constructor(
    app: App,
    private result: AssistantResult,
    private onConfirm: () => void,
    private onRetry: () => void,
    private onCreateConcept?: () => void
  ) {
    super(app);
    this.component = new Component();
  }

  onOpen() {
    const { contentEl } = this;
    this.titleEl.setText(this.result.explanation ?? "AI 助手结果");

    // 渲染预览
    const previewEl = contentEl.createDiv({ cls: "istart-assistant-preview" });
    void MarkdownRenderer.render(this.app, this.result.content, previewEl, "", this.component);

    // 模式提示
    const modeLabels: Record<string, string> = {
      replace: "将替换选中内容",
      insert: "将插入到光标位置",
      append: "将追加到文件末尾",
      show: "仅展示（不修改文件）",
    };
    contentEl.createEl("p", {
      text: `📌 ${modeLabels[this.result.mode] || ""}`,
      cls: "istart-assistant-mode-hint",
    });

    // 按钮
    const btnSetting = new Setting(contentEl);
    btnSetting.addButton((btn) => btn.setButtonText("插入当前文档").setCta().onClick(() => { this.close(); this.onConfirm(); }));
    btnSetting.addButton((btn) => btn.setButtonText("创建为新概念页").onClick(() => { this.close(); this.onCreateConcept?.(); }));
    btnSetting
      .addButton((btn) => btn.setButtonText("重新生成").onClick(() => { this.close(); this.onRetry(); }))
      .addButton((btn) => btn.setButtonText("关闭").onClick(() => this.close()));
  }

  onClose() { this.component.unload(); this.contentEl.empty(); }
}
