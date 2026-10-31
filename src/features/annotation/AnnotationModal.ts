import { App, ButtonComponent, Notice, Platform, Setting } from "obsidian";
import { ActionModal } from "../../ui/ActionModal";
import type { AnnotationCommentStyle, AnnotationRecord } from "../../core/annotations/AnnotationParser";

export interface AnnotationModalOptions {
  selection: string;
  fileName: string;
  heading: string;
  defaultStyle: AnnotationCommentStyle;
  autoDraft: boolean;
  draft: () => Promise<string>;
  onSubmit: (comment: string, style: AnnotationCommentStyle) => void;
}

/**
 * Create a highlight or comment on the current selection.
 * The selection was captured before the modal opened, so changing focus cannot redirect the write.
 */
export class AnnotationModal extends ActionModal {
  private textareaEl!: HTMLTextAreaElement;
  private style: AnnotationCommentStyle;
  private draftButton: HTMLButtonElement | null = null;
  private saveButton: ButtonComponent | null = null;
  private drafting = false;

  constructor(app: App, private options: AnnotationModalOptions) {
    super(app);
    this.style = options.defaultStyle;
    this.titleEl.setText(options.autoDraft ? "AI 批注" : "添加批注");
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
    this.draftButton.setText("AI 草拟批注");
    this.draftButton.addEventListener("click", () => { void this.generateDraft(false); });
    draftRow.createSpan({
      text: "会发送选中文字和少量上下文",
      cls: "istart-annotation-draft-hint",
    });

    this.textareaEl = contentEl.createEl("textarea", {
      cls: "istart-annotation-textarea",
      attr: {
        placeholder: "写下你的理解、疑问或联想…（留空则只添加高亮）",
        rows: "4",
        "aria-label": "批注内容",
      },
    });
    this.textareaEl.addEventListener("keydown", (event) => {
      if (!event.isComposing && (event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        this.submit();
      }
    });
    this.textareaEl.addEventListener("input", () => this.updateSaveLabel());

    new Setting(contentEl)
      .setName("批注形式")
      .setDesc("行内批注紧跟在文字后；脚注批注集中到文末，适合长批注。")
      .addDropdown((dropdown) => dropdown
        .addOption("inline", "行内批注（推荐）")
        .addOption("footnote", "脚注批注（文末集中）")
        .setValue(this.style)
        .onChange((value) => { this.style = value as AnnotationCommentStyle; }));

    new Setting(this.actionsEl)
      .addButton((button) => {
        this.saveButton = button;
        button.setButtonText("添加批注").setCta().onClick(() => this.submit());
        return button;
      })
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()));

    this.addMobileHeaderAction("添加", () => this.submit());
    this.updateSaveLabel();
    this.focusOnDesktop(this.textareaEl);

    if (this.options.autoDraft) window.setTimeout(() => { void this.generateDraft(true); }, 80);
  }

  private updateSaveLabel(): void {
    if (!this.saveButton) return;
    this.saveButton.setButtonText(this.textareaEl.value.trim() ? "添加批注" : "仅添加高亮");
  }

  private async generateDraft(onlyWhenEmpty: boolean): Promise<void> {
    if (this.drafting) return;
    if (onlyWhenEmpty && this.textareaEl.value.trim()) return;
    this.drafting = true;
    if (this.draftButton) {
      this.draftButton.disabled = true;
      this.draftButton.setText("AI 正在草拟…");
    }
    try {
      const draft = await this.options.draft();
      if (!this.textareaEl.value.trim() || !onlyWhenEmpty) {
        this.textareaEl.value = draft;
        this.updateSaveLabel();
        this.textareaEl.setSelectionRange(draft.length, draft.length);
        if (!Platform.isMobile) this.textareaEl.focus();
      }
    } catch (error) {
      new Notice(`AI 草拟失败：${(error as Error).message}`);
    } finally {
      this.drafting = false;
      if (this.draftButton) {
        this.draftButton.disabled = false;
        this.draftButton.setText("AI 草拟批注");
      }
    }
  }

  private submit(): void {
    const comment = this.textareaEl.value.trim();
    try {
      this.options.onSubmit(comment, this.style);
      this.close();
      new Notice(comment ? "已添加批注" : "已添加高亮");
    } catch (error) {
      new Notice(`添加失败：${(error as Error).message}`);
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
