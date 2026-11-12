import { ItemView, MarkdownView, Notice, Platform, TFile, WorkspaceLeaf } from "obsidian";
import type DeepSeekPlugin from "../../main";
import type { ProofreadingReport } from "../../core/agent/types";
import { captureEditorTarget } from "../../editor/EditorTarget";
import { selectTypoIssue, TypoCheckResult, TypoIssue } from "../../ai/TypoChecker";

export const TYPO_CHECK_VIEW_TYPE = "istart-typo-check-view";

export class TypoCheckView extends ItemView {
  private target: (ProofreadingReport & { file: TFile }) | null = null;
  private result: TypoCheckResult | null = null;
  private status = "运行「错别字甄别」检查当前笔记或选中文字。";
  private stale = false;
  private opened = false;
  private statusEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: DeepSeekPlugin) { super(leaf); }

  getViewType(): string { return TYPO_CHECK_VIEW_TYPE; }
  getDisplayText(): string { return "IStart 错别字甄别"; }
  getIcon(): string { return "spell-check"; }

  async onOpen(): Promise<void> {
    this.opened = true;
    this.registerEvent(this.app.workspace.on("editor-change", (editor, info) => {
      if (info.file === this.target?.file && editor.getValue() !== this.target.content) this.markStale();
    }));
    this.registerEvent(this.app.vault.on("modify", file => {
      if (file !== this.target?.file) return;
      const target = this.target;
      void this.app.vault.read(target.file).then(content => {
        if (this.opened && this.target === target && content !== target.content) this.markStale();
      }).catch(() => { if (this.target === target) this.markStale(); });
    }));
    this.registerEvent(this.app.vault.on("rename", file => {
      if (file === this.target?.file) this.markStale();
    }));
    this.registerEvent(this.app.vault.on("delete", file => {
      if (file === this.target?.file) this.markStale();
    }));
    this.render();
  }

  async onClose(): Promise<void> {
    this.opened = false;
    this.statusEl = null;
    this.contentEl.empty();
  }

  async showResult(report: ProofreadingReport): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(report.path);
    if (!(file instanceof TFile)) throw new Error("找不到原文件，请重新校对");
    this.target = { ...report, file };
    this.result = report.result;
    this.stale = false;
    this.status = report.result.issues.length ? `发现 ${report.result.issues.length} 处疑似错别字，点击定位原文。` : "本次检查未发现明确的错别字。";
    if (report.result.unlocatedCount) this.status += ` ${report.result.unlocatedCount} 条无法核对的建议已忽略。`;
    const view = this.app.workspace.getLeavesOfType("markdown").map(l => l.view).find(v => v instanceof MarkdownView && v.file === file) as MarkdownView | undefined;
    const content = view ? view.editor.getValue() : await this.app.vault.read(file);
    if (content !== report.content) this.markStale();
    this.render();
  }

  private markStale(): void {
    if (!this.opened || this.stale) return;
    this.stale = true;
    this.status = "原文已变化或文件已移动，请重新检查后再定位。";
    this.render();
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("istart-typo-root");
    root.createEl("h4", { text: "错别字甄别" });
    const toolbar = root.createDiv({ cls: "istart-typo-toolbar" });
    const check = toolbar.createEl("button", { text: "检查当前笔记全文", attr: { type: "button" } });
    check.addEventListener("click", () => {
      const target = captureEditorTarget(this.app);
      if (!target) { new Notice("请先打开 Markdown 笔记并切换到编辑模式"); return; }
      void this.plugin.checkCurrentNoteTypos({ ...target, selection: "" });
    });
    const assistant = toolbar.createEl("button", { text: "返回 AI 助手", attr: { type: "button" } });
    assistant.addEventListener("click", () => this.plugin.openAssistant(null));
    if (this.target) root.createDiv({ cls: "istart-typo-source",
      text: `${this.target.path} · ${this.target.selected ? "选中文字" : "全文"}` });
    this.statusEl = root.createDiv({ cls: "istart-typo-status", text: this.status,
      attr: { role: "status", "aria-live": "polite" } });
    root.createDiv({ cls: "istart-typo-hint", text: "AI 校对建议仅供参考，不会自动修改原文。选中文字后运行此命令可只检查选区。" });
    const list = root.createDiv({ cls: "istart-typo-list" });
    for (const issue of this.result?.issues ?? []) {
      const button = list.createEl("button", { cls: "istart-typo-item", attr: { type: "button" } });
      button.disabled = this.stale;
      button.createSpan({ cls: "istart-typo-original", text: issue.original });
      button.createSpan({ cls: "istart-typo-arrow", text: " → " });
      button.createSpan({ cls: "istart-typo-correction", text: issue.correction });
      const lines = this.target!.content.slice(0, issue.start).split("\n");
      button.createSpan({ cls: "istart-typo-location", text: `第 ${lines.length} 行 · 第 ${lines[lines.length - 1].length + 1} 列` });
      if (issue.reason) button.createSpan({ cls: "istart-typo-reason", text: issue.reason });
      button.addEventListener("click", () => { void this.navigate(issue); });
    }
  }

  private async navigate(issue: TypoIssue): Promise<void> {
    const target = this.target;
    if (!target || this.stale) return;
    try {
      const file = this.app.vault.getAbstractFileByPath(target.path);
      if (!(file instanceof TFile) || file !== target.file) throw new Error("找不到原文件，请重新检查");
      const workspace = this.app.workspace;
      let leaf = workspace.getLeavesOfType("markdown").find(candidate =>
        candidate.view instanceof MarkdownView && candidate.view.file === file);
      if (!leaf) {
        leaf = workspace.getLeaf("tab");
        await leaf.openFile(file, { active: true, state: { mode: "source" } });
      } else if ((leaf.view as MarkdownView).getMode() === "preview") {
        await leaf.setViewState({ type: "markdown", state: { ...leaf.getViewState().state, file: file.path, mode: "source" } });
      }
      if (this.target !== target || this.stale || !this.opened) return;
      if (!(leaf.view instanceof MarkdownView) || leaf.view.file !== file) throw new Error("无法打开原笔记");
      selectTypoIssue(leaf.view.editor, target.content, issue);
      workspace.setActiveLeaf(leaf, { focus: false });
      if (Platform.isMobile) workspace.rightSplit.collapse();
      else leaf.view.editor.focus();
    } catch (error) {
      this.markStale();
      new Notice(`定位失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
