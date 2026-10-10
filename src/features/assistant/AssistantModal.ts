import { App, Setting, MarkdownRenderer, Component, Notice, normalizePath, Platform, setIcon, Menu } from "obsidian";
import { AssistantResult } from "../../ai/AIAssistant";
import { todayIso } from "../../core/schema";
import { ActionModal } from "../../ui/ActionModal";
import { panelIcon } from "../../ui/icons";
import type { QuickAction, QuickActionId } from "../../actions/quickActions";

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
export class AssistantInputModal extends ActionModal {
  private instruction = "";
  private inputEl!: HTMLTextAreaElement;

  constructor(
    app: App,
    private contextHint: string,
    private onSubmit: (instruction: string) => void,
    private options: {
      quickActions?: QuickAction[];
      onQuickAction?: (id: QuickActionId) => void;
      showSuggestions?: boolean;
    } = {}
  ) {
    super(app);
    this.titleEl.setText("AI 助手");
  }

  onOpen() {
    super.onOpen();
    const contentEl = this.bodyEl;

    if (this.contextHint) {
      contentEl.createEl("p", { text: this.contextHint, cls: "istart-assistant-context" });
    }

    if (this.options.quickActions?.length) {
      const grid = contentEl.createDiv({ cls: "istart-quick-grid" });
      for (const action of this.options.quickActions) {
        const btn = grid.createEl("button", { cls: "istart-quick-action", attr: { type: "button", "aria-label": action.label } });
        setIcon(btn.createSpan({ cls: "istart-quick-icon" }), panelIcon(action.icon));
        btn.createSpan({ text: action.label });
        btn.addEventListener("click", () => {
          this.close();
          this.options.onQuickAction?.(action.id);
        });
      }
    }

    this.inputEl = contentEl.createEl("textarea", {
      attr: { placeholder: "输入你的需求...（留空 = AI 智能判断）", rows: "3" },
      cls: "istart-assistant-input",
    });
    this.inputEl.addEventListener("input", () => { this.instruction = this.inputEl.value; });
    this.inputEl.addEventListener("keydown", (e) => {
      if (!e.isComposing && (e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); this.submit(); }
    });

    if (this.options.showSuggestions !== false) {
      const details = contentEl.createEl("details", { cls: "istart-assistant-more" });
      details.createEl("summary", { text: "更多操作" });
      const tagsEl = details.createDiv({ cls: "istart-assistant-tags" });
      for (const tag of QUICK_TAGS) {
        const btn = tagsEl.createEl("button", { text: tag.label, cls: "istart-assistant-tag" });
        btn.addEventListener("click", () => {
          this.instruction = tag.value;
          this.submit();
        });
      }
    }

    new Setting(this.actionsEl)
      .addButton((btn) => btn.setButtonText(Platform.isMobile ? "执行" : "执行 (Ctrl+Enter)").setCta().onClick(() => this.submit()))
      .addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));

    this.focusOnDesktop(this.inputEl);
  }

  private submit() {
    this.close();
    this.onSubmit(this.instruction.trim());
  }

  onClose() { super.onClose(); }
}

// ── Result Modal helpers ─────────────────────────────────────

interface ResultAction {
  label: string;
  cta?: boolean;
  callback: () => void | boolean | Promise<void | boolean>;
}

/**
 * Determine the best actions based on mode + content characteristics.
 * Returns [primary, ...secondary] — max 3 actions total (excluding retry/close).
 */
function buildSmartActions(
  app: App,
  result: AssistantResult,
  onWriteToDoc: ResultAction["callback"],
  onRetry: () => void,
  onCreateConcept?: () => void
): { primary: ResultAction; secondary: ResultAction[] } {
  const content = result.content;

  // Heuristics
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
  new Notice(`已保存到 ${file.path}`);
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file);
}

function copyToClipboard(content: string): void {
  navigator.clipboard.writeText(content).then(
    () => new Notice("已复制到剪贴板"),
    () => new Notice("复制失败")
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
export class AssistantResultModal extends ActionModal {
  private component: Component;
  private acting = false;

  constructor(
    app: App,
    private result: AssistantResult,
    private onConfirm: ResultAction["callback"],
    private onRetry: () => void,
    private onCreateConcept?: () => void,
    private extraAction?: { label: string; callback: () => void | boolean },
    private options: { primaryLabel?: string; modeHint?: string } = {}
  ) {
    super(app);
    this.component = new Component();
  }

  onOpen() {
    super.onOpen();
    const contentEl = this.bodyEl;
    this.modalEl.addClass("istart-result-shell");
    this.component.load();
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
      text: this.options.modeHint ?? modeLabels[this.result.mode] ?? "",
      cls: "istart-result-mode-hint",
    });

    // Action bar (fixed at bottom)
    const actionBar = this.actionsEl;
    actionBar.addClass("istart-result-actions");

    let { primary, secondary } = buildSmartActions(
      this.app,
      this.result,
      this.onConfirm,
      this.onRetry,
      this.onCreateConcept
    );
    if (this.options.primaryLabel) {
      primary = { label: this.options.primaryLabel, cta: true, callback: this.onConfirm };
      secondary = [{ label: "复制", callback: () => copyToClipboard(this.result.content) }];
    } else if (Platform.isMobile && this.result.mode !== "show") {
      primary.label = { replace: "替换选中", insert: "插入", append: "追加" }[this.result.mode];
    }

    // Primary button
    const primarySetting = new Setting(actionBar);
    primarySetting.addButton((btn) =>
      btn.setButtonText(primary.label).setCta().onClick(() => { void this.perform(primary.callback); })
    );
    if (this.extraAction) {
      primarySetting.addButton((btn) =>
        btn.setButtonText(this.extraAction!.label).onClick(() => { void this.perform(this.extraAction!.callback); })
      );
    }

    const actions = [...secondary];
    if (!actions.some((action) => action.label === "复制")) actions.push({ label: "复制", callback: () => copyToClipboard(this.result.content) });
    actions.push({ label: "重新生成", callback: this.onRetry });
    primarySetting.addButton((btn) => {
      btn.buttonEl.addClass("istart-overflow-button");
      btn.setButtonText("更多").onClick((event) => {
        const menu = new Menu();
        for (const action of actions) {
          menu.addItem((item) => item.setTitle(action.label).onClick(() => { void this.perform(action.callback); }));
        }
        menu.addSeparator();
        menu.addItem((item) => item.setTitle("关闭").onClick(() => this.close()));
        menu.showAtMouseEvent(event);
      });
    });
  }

  private async perform(callback: ResultAction["callback"]) {
    if (this.acting) return;
    this.acting = true;
    try {
      if (await callback() !== false) this.close();
    } catch (error) {
      new Notice(`操作失败：${(error as Error).message}`);
    } finally {
      this.acting = false;
    }
  }

  onClose() { this.component.unload(); super.onClose(); }
}
