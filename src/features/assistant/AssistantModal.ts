import { App, Modal, Setting, MarkdownRenderer, Component, Notice, normalizePath, TFile } from "obsidian";
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

// ── Result Modal helpers ─────────────────────────────────────

interface ResultAction {
  label: string;
  cta?: boolean;
  callback: () => void;
}

/**
 * Determine the best actions based on mode + content characteristics.
 * Returns [primary, ...secondary] — max 3 actions total (excluding retry/close).
 */
function buildSmartActions(
  app: App,
  result: AssistantResult,
  onWriteToDoc: () => void,
  onRetry: () => void,
  onCreateConcept?: () => void
): { primary: ResultAction; secondary: ResultAction[] } {
  const content = result.content;

  // Heuristics
  const hasCheckboxes = (content.match(/- \[ \]/g) || []).length >= 2;
  const looksLikeConcept = /^#\s+.{2,20}\n\n/.test(content) &&
    (content.includes("## 定义") || content.includes("## 解释") || content.includes("## 核心"));
  const isLong = content.length > 500;

  switch (result.mode) {
    case "replace":
      return {
        primary: { label: "替换选中内容", cta: true, callback: onWriteToDoc },
        secondary: [
          { label: "复制", callback: () => copyToClipboard(content) },
        ],
      };

    case "insert":
      return {
        primary: { label: "插入到光标位置", cta: true, callback: onWriteToDoc },
        secondary: [
          ...(isLong ? [{ label: "保存为新笔记", callback: () => saveAsNote(app, result) }] : []),
          { label: "复制", callback: () => copyToClipboard(content) },
        ],
      };

    case "append":
      return {
        primary: { label: "追加到文档末尾", cta: true, callback: onWriteToDoc },
        secondary: [
          { label: "保存为新笔记", callback: () => saveAsNote(app, result) },
        ],
      };

    case "show":
    default: {
      // For show mode, pick the best primary based on content
      if (hasCheckboxes) {
        return {
          primary: { label: "保存为执行计划", cta: true, callback: () => saveAsPlan(app, result) },
          secondary: [
            { label: "插入到光标位置", callback: onWriteToDoc },
            { label: "复制", callback: () => copyToClipboard(content) },
          ],
        };
      }
      if (looksLikeConcept && onCreateConcept) {
        return {
          primary: { label: "创建为概念页", cta: true, callback: onCreateConcept },
          secondary: [
            { label: "保存为新笔记", callback: () => saveAsNote(app, result) },
            { label: "插入到光标位置", callback: onWriteToDoc },
          ],
        };
      }
      // Default show: save as note
      return {
        primary: { label: "保存为新笔记", cta: true, callback: () => saveAsNote(app, result) },
        secondary: [
          { label: "插入到光标位置", callback: onWriteToDoc },
          ...(onCreateConcept ? [{ label: "创建为概念页", callback: onCreateConcept }] : []),
        ],
      };
    }
  }
}

async function saveAsNote(app: App, result: AssistantResult): Promise<void> {
  const folder = normalizePath("Knowledge/Notes");
  if (!app.vault.getAbstractFileByPath(folder)) {
    await app.vault.createFolder(folder);
  }
  const today = todayIso();
  const title = extractTitle(result.content) || "AI 笔记";
  const safeName = title.replace(/[\\/:*?"<>|#[\]]/g, "-").slice(0, 40);
  let path = normalizePath(`${folder}/${today}-${safeName}.md`);
  let suffix = 2;
  while (app.vault.getAbstractFileByPath(path)) {
    path = normalizePath(`${folder}/${today}-${safeName}-${suffix}.md`);
    suffix++;
  }
  const file = await app.vault.create(path, result.content);
  new Notice(`✅ 已保存到 ${file.path}`);
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file);
}

async function saveAsPlan(app: App, result: AssistantResult): Promise<void> {
  const folder = normalizePath("Knowledge/Plans");
  if (!app.vault.getAbstractFileByPath(folder)) {
    await app.vault.createFolder(folder);
  }
  const today = todayIso();
  const title = extractTitle(result.content) || "执行计划";
  const safeName = title.replace(/[\\/:*?"<>|#[\]]/g, "-").slice(0, 40);
  let path = normalizePath(`${folder}/${today}-${safeName}.md`);
  let suffix = 2;
  while (app.vault.getAbstractFileByPath(path)) {
    path = normalizePath(`${folder}/${today}-${safeName}-${suffix}.md`);
    suffix++;
  }

  const frontmatter = `---\ntype: plan\nstatus: active\ncreated_at: ${today}\n---\n\n`;
  const file = await app.vault.create(path, frontmatter + result.content);
  new Notice(`✅ 执行计划已保存`);
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file);
}

function copyToClipboard(content: string): void {
  navigator.clipboard.writeText(content).then(
    () => new Notice("✅ 已复制到剪贴板"),
    () => new Notice("❌ 复制失败")
  );
}

function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)/m);
  return match ? match[1].trim() : "";
}

/**
 * AI 助手结果预览弹窗
 *
 * Smart actions: system recommends the best action based on mode + content.
 * Mobile-safe: flex layout with fixed bottom action bar.
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

    const { primary, secondary } = buildSmartActions(
      this.app,
      this.result,
      this.onConfirm,
      this.onRetry,
      this.onCreateConcept
    );

    // Primary button
    const primarySetting = new Setting(actionBar);
    primarySetting.addButton((btn) =>
      btn.setButtonText(primary.label).setCta().onClick(() => { this.close(); primary.callback(); })
    );

    // Secondary buttons
    for (const action of secondary.slice(0, 2)) {
      primarySetting.addButton((btn) =>
        btn.setButtonText(action.label).onClick(() => { this.close(); action.callback(); })
      );
    }

    // Retry + close row
    const utilBar = new Setting(actionBar);
    utilBar.addButton((btn) => btn.setButtonText("重新生成").onClick(() => { this.close(); this.onRetry(); }));
    utilBar.addButton((btn) => btn.setButtonText("关闭").onClick(() => this.close()));
  }

  onClose() { this.component.unload(); this.contentEl.empty(); }
}
