import { App, ButtonComponent, Notice, Setting } from "obsidian";
import { ActionModal } from "../../ui/ActionModal";
import type { AnnotationCommentStyle, AnnotationRecord } from "../../core/annotations/AnnotationParser";

export type AnnotationModalMode = "create" | "edit";

export interface AnnotationModalOptions {
  selection: string;
  fileName: string;
  heading: string;
  defaultStyle: AnnotationCommentStyle;
  autoDraft: boolean;
  mode?: AnnotationModalMode;
  initialComment?: string;
  allowStyle?: boolean;
  /** When false, an empty textarea cannot be submitted (used when adding a comment to an existing highlight). */
  allowEmptyComment?: boolean;
  onAgentDraft: (currentComment: string) => void | Promise<void>;
  onSubmit: (comment: string, style: AnnotationCommentStyle) => void | Promise<void>;
}

/**
 * Create or edit a highlight/comment. Creation captures the selection before the modal opens,
 * so changing focus cannot redirect the write; editing targets the annotation snapshot.
 */
export class AnnotationModal extends ActionModal {
  private textareaEl!: HTMLTextAreaElement;
  private style: AnnotationCommentStyle;
  private draftButton: HTMLButtonElement | null = null;
  private saveButton: ButtonComponent | null = null;
  private submitting = false;

  constructor(app: App, private options: AnnotationModalOptions) {
    super(app);
    this.style = options.defaultStyle;
    this.titleEl.setText(options.mode === "edit"
      ? "编辑批注"
      : options.autoDraft ? "AI 批注" : "添加批注");
  }

  onOpen() {
    super.onOpen();
    this.modalEl.addClass("istart-annotation-modal");
    const contentEl = this.bodyEl;

    const context = [this.options.fileName, this.options.heading].filter(Boolean).join(" · ");
    if (context) contentEl.createEl("p", { text: context, cls: "istart-assistant-context" });
    contentEl.createDiv({ text: this.options.selection, cls: "istart-annotation-selection" });

    const draftRow = contentEl.createDiv({ cls: "istart-annotation-draft-row" });
    this.draftButton = draftRow.createEl("button", {
      cls: "istart-annotation-draft-button",
      attr: { type: "button" },
    });
    this.draftButton.setText(this.options.mode === "edit" ? "AI 重写批注" : "AI 草拟批注");
    this.draftButton.addEventListener("click", () => { void this.generateDraft(false); });
    draftRow.createSpan({
      text: "在 Agent 中生成，预览后应用",
      cls: "istart-annotation-draft-hint",
    });

    this.textareaEl = contentEl.createEl("textarea", {
      cls: "istart-annotation-textarea",
      attr: {
        placeholder: this.options.mode === "edit"
          ? "修改这条批注…（留空则移除批注文字）"
          : "写下你的理解、疑问或联想…（留空则只添加高亮）",
        rows: "4",
        "aria-label": "批注内容",
      },
    });
    this.textareaEl.value = this.options.initialComment ?? "";
    if (this.textareaEl.value) {
      this.textareaEl.setSelectionRange(this.textareaEl.value.length, this.textareaEl.value.length);
    }
    this.textareaEl.addEventListener("keydown", (event) => {
      if (!event.isComposing && (event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void this.submit();
      }
    });
    this.textareaEl.addEventListener("input", () => this.updateSaveLabel());

    if (this.options.allowStyle !== false) {
      new Setting(contentEl)
        .setName("批注形式")
        .setDesc("行内批注紧跟在文字后；脚注批注集中到文末，适合长批注。")
        .addDropdown((dropdown) => dropdown
          .addOption("inline", "行内批注（推荐）")
          .addOption("footnote", "脚注批注（文末集中）")
          .setValue(this.style)
          .onChange((value) => { this.style = value as AnnotationCommentStyle; }));
    }

    new Setting(this.actionsEl)
      .addButton((button) => {
        this.saveButton = button;
        button.setButtonText("添加批注").setCta().onClick(() => { void this.submit(); });
        return button;
      })
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()));

    this.addMobileHeaderAction(this.options.mode === "edit" ? "保存" : "添加", () => { void this.submit(); });
    this.updateSaveLabel();
    this.focusOnDesktop(this.textareaEl);

    if (this.options.autoDraft) window.setTimeout(() => { void this.generateDraft(true); }, 80);
  }

  private updateSaveLabel(): void {
    if (!this.saveButton) return;
    if (this.options.allowEmptyComment === false) {
      this.saveButton.setButtonText("添加批注");
      return;
    }
    this.saveButton.setButtonText(this.options.mode === "edit"
      ? "保存修改"
      : this.textareaEl.value.trim() ? "添加批注" : "仅添加高亮");
  }

  private async generateDraft(onlyWhenEmpty: boolean): Promise<void> {
    if (onlyWhenEmpty && this.textareaEl.value.trim()) return;
    const comment = this.textareaEl.value.trim();
    this.close();
    try { await this.options.onAgentDraft(comment); }
    catch (error) { new Notice(`无法打开助手：${(error as Error).message}`); }
  }

  private async submit(): Promise<void> {
    if (this.submitting) return;
    const comment = this.textareaEl.value.trim();
    if (this.options.allowEmptyComment === false && !comment) {
      new Notice("请输入批注内容");
      return;
    }
    this.submitting = true;
    this.saveButton?.setDisabled(true);
    try {
      await this.options.onSubmit(comment, this.style);
      this.close();
      if (this.options.mode === "edit") new Notice(comment ? "已保存批注" : "已移除批注文字");
      else new Notice(comment ? "已添加批注" : "已添加高亮");
    } catch (error) {
      new Notice(`${this.options.mode === "edit" ? "保存" : "添加"}失败：${(error as Error).message}`);
    } finally {
      this.submitting = false;
      this.saveButton?.setDisabled(false);
    }
  }

  onClose() {
    this.modalEl.removeClass("istart-annotation-modal");
    super.onClose();
  }
}

export interface AnnotationDeleteOptions {
  annotation: AnnotationRecord;
  onConfirm: () => void;
}

/** Confirm removing annotation syntax while explaining what happens to the source text. */
export class AnnotationDeleteModal extends ActionModal {
  constructor(app: App, private options: AnnotationDeleteOptions) {
    super(app);
    this.titleEl.setText("移除批注");
  }

  onOpen() {
    super.onOpen();
    const { annotation } = this.options;
    const contentEl = this.bodyEl;
    contentEl.createDiv({ text: annotation.text, cls: "istart-annotation-selection" });

    const detail = annotation.source === "obsidian-comment"
      ? "这是 Obsidian 注释。移除后注释内容会一并删除，且不可在阅读视图中恢复。"
      : annotation.footnoteDefinitions.length > 0
      ? "将移除高亮标记和脚注引用；若该脚注没有其他引用，也会移除定义。正文文字会保留。"
      : "将移除高亮标记或行内批注；正文文字会保留。";
    contentEl.createEl("p", { text: detail, cls: "istart-annotation-delete-hint" });

    new Setting(this.actionsEl)
      .addButton((button) => button.setButtonText("移除批注").setWarning().onClick(() => this.confirm()))
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()));

    this.addMobileHeaderAction("移除", () => this.confirm());
  }

  private confirm(): void {
    this.close();
    this.options.onConfirm();
  }

  onClose() {
    super.onClose();
  }
}
