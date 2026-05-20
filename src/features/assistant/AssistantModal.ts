import { App, Modal, Setting, MarkdownRenderer, Component, Notice, normalizePath } from "obsidian";
import { AssistantResult } from "../../ai/AIAssistant";
import { todayIso } from "../../core/schema";

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

    if (this.contextHint) {
      contentEl.createEl("p", { text: this.contextHint, cls: "istart-assistant-context" });
    }

    this.inputEl = contentEl.createEl("textarea", {
      attr: { placeholder: "输入你的需求...（留空 = AI 智能判断）", rows: "3" },
      cls: "istart-assistant-input",
    });
    this.inputEl.addEventListener("input", () => { this.instruction = this.inputEl.value; });
    this.inputEl.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { this.submit(); }
    });

    const tagsEl = contentEl.createDiv({ cls: "istart-assistant-tags" });
    for (const tag of QUICK_TAGS) {
      const btn = tagsEl.createEl("button", { text: tag.label, cls: "istart-assistant-tag" });
      btn.addEventListener("click", () => {
        this.inputEl.value = tag.value;
        this.instruction = tag.value;
        this.inputEl.focus();
      });
    }

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

// ── Result Modal ─────────────────────────────────────────────

interface ResultAction {
  label: string;
  cta?: boolean;
  callback: () => void | Promise<void>;
}

/**
 * AI 助手结果预览弹窗
 *
 * Smart actions: system recommends the best action based on mode + content.
 * Mobile-safe: flex layout with fixed bottom action bar.
 */
export class AssistantResultModal extends Modal {
  private component: Component;
  private closed = false;

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
    contentEl.addClass("istart-result-modal");
    this.titleEl.setText(this.result.explanation ?? "AI 助手结果");

    // Preview area (scrollable)
    const previewEl = contentEl.createDiv({ cls: "istart-result-preview" });
    void MarkdownRenderer.render(this.app, this.result.content, previewEl, "", this.component);

    // Mode hint
    const modeLabels: Record<string, string> = {
      replace: "将替换选中内容",
      insert: "将插入到光标位置",
      append: "将追加到文件末尾",
      show: "仅展示",
    };
    contentEl.createEl("p", {
      text: modeLabels[this.result.mode] || "",
      cls: "istart-result-mode-hint",
    });

    // Action bar (fixed at bottom)
    const actionBar = contentEl.createDiv({ cls: "istart-result-actions" });
    const { primary, secondary } = this.buildActions();

    const primaryRow = new Setting(actionBar);
    primaryRow.addButton((btn) =>
      btn.setButtonText(primary.label).setCta().onClick(() => this.doAction(primary.callback))
    );
    for (const action of secondary.slice(0, 2)) {
      primaryRow.addButton((btn) =>
        btn.setButtonText(action.label).onClick(() => this.doAction(action.callback))
      );
    }

    const utilRow = new Setting(actionBar);
    utilRow.addButton((btn) => btn.setButtonText("重新生成").onClick(() => { this.close(); this.onRetry(); }));
    utilRow.addButton((btn) => btn.setButtonText("关闭").onClick(() => this.close()));
  }

  /** Close modal then execute action (prevents double-save). */
  private doAction(callback: () => void | Promise<void>): void {
    if (this.closed) return;
    this.closed = true;
    this.close();
    void callback();
  }

  private buildActions(): { primary: ResultAction; secondary: ResultAction[] } {
    const content = this.result.content;
    const hasCheckboxes = (content.match(/- \[ \]/g) || []).length >= 2;
    const looksLikeConcept = /^#\s+.{2,20}\n\n/.test(content) &&
      (content.includes("## 定义") || content.includes("## 解释") || content.includes("## 核心"));
    const isLong = content.length > 500;

    switch (this.result.mode) {
      case "replace":
        return {
          primary: { label: "替换选中内容", callback: () => this.onConfirm() },
          secondary: [{ label: "复制", callback: () => this.copyContent() }],
        };

      case "insert":
        return {
          primary: { label: "插入到光标位置", callback: () => this.onConfirm() },
          secondary: [
            ...(isLong ? [{ label: "保存为新笔记", callback: () => this.saveAsNote() }] : []),
            { label: "复制", callback: () => this.copyContent() },
          ],
        };

      case "append":
        return {
          primary: { label: "追加到文档末尾", callback: () => this.onConfirm() },
          secondary: [{ label: "保存为新笔记", callback: () => this.saveAsNote() }],
        };

      case "show":
      default:
        if (hasCheckboxes) {
          return {
            primary: { label: "保存为执行计划", callback: () => this.saveAsPlan() },
            secondary: [
              { label: "插入到光标位置", callback: () => this.onConfirm() },
              { label: "复制", callback: () => this.copyContent() },
            ],
          };
        }
        if (looksLikeConcept && this.onCreateConcept) {
          return {
            primary: { label: "创建为概念页", callback: () => this.onCreateConcept!() },
            secondary: [
              { label: "保存为新笔记", callback: () => this.saveAsNote() },
              { label: "插入到光标位置", callback: () => this.onConfirm() },
            ],
          };
        }
        return {
          primary: { label: "保存为新笔记", callback: () => this.saveAsNote() },
          secondary: [
            { label: "插入到光标位置", callback: () => this.onConfirm() },
            ...(this.onCreateConcept ? [{ label: "创建为概念页", callback: () => this.onCreateConcept!() }] : []),
          ],
        };
    }
  }

  // ── Save actions ───────────────────────────────────────────

  private async saveAsNote(): Promise<void> {
    const folder = normalizePath("Knowledge/Notes");
    await this.ensureFolder(folder);
    const path = await this.uniquePath(folder, this.extractTitle() || "AI 笔记");
    const file = await this.app.vault.create(path, this.result.content);
    new Notice(`✅ 已保存到 ${file.basename}`);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
  }

  private async saveAsPlan(): Promise<void> {
    const folder = normalizePath("Knowledge/Plans");
    await this.ensureFolder(folder);
    const title = this.extractTitle() || "执行计划";
    const path = await this.uniquePath(folder, title);
    const today = todayIso();
    const activeFile = this.app.workspace.getActiveFile();
    const sourceLink = activeFile ? `[[${activeFile.path}|${activeFile.basename}]]` : "手动创建";

    const planContent = `---
type: plan
schema_version: 1
title: "${title}"
status: active
source: "${sourceLink}"
created_at: ${today}
---

# ${title}

> [!info] 执行计划
> 来源：${sourceLink}
> 创建时间：${today}
> 状态：进行中

## 目标

<!-- 这个计划要达成什么？ -->

## 行动项

${this.result.content}

## 时间线

| 行动项 | 截止时间 | 状态 |
| --- | --- | --- |
| | | |

## 风险与依赖

- 

## 完成标准

- [ ] 

## 复盘

<!-- 执行结束后填写 -->

---

*来源：${sourceLink}*
`;

    const file = await this.app.vault.create(path, planContent);
    new Notice(`✅ 执行计划已保存`);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
  }

  private copyContent(): void {
    navigator.clipboard.writeText(this.result.content).then(
      () => new Notice("✅ 已复制到剪贴板"),
      () => new Notice("❌ 复制失败")
    );
  }

  // ── Helpers ────────────────────────────────────────────────

  private extractTitle(): string {
    const match = this.result.content.match(/^#\s+(.+)/m);
    return match ? match[1].trim() : "";
  }

  private async ensureFolder(path: string): Promise<void> {
    if (!this.app.vault.getAbstractFileByPath(path)) {
      await this.app.vault.createFolder(path);
    }
  }

  private async uniquePath(folder: string, title: string): Promise<string> {
    const today = todayIso();
    const safeName = title.replace(/[\\/:*?"<>|#[\]]/g, "-").slice(0, 40);
    let path = normalizePath(`${folder}/${today}-${safeName}.md`);
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${folder}/${today}-${safeName}-${suffix}.md`);
      suffix++;
    }
    return path;
  }

  onClose() { this.component.unload(); this.contentEl.empty(); }
}
