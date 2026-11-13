import { App, Modal, Notice, Setting } from "obsidian";
import {
  ConflictComparison, ConflictSession, SyncConflict, SyncResolution, compareVersions,
  conflictKind, conflictVersion, differenceSummary, resolvedVersion,
} from "../../core/sync/SyncConflict";

export interface ConflictApplyResult { resolvedKeys: string[]; errors: string[] }
interface ConflictModalOptions {
  mode: "git" | "file";
  conflicts: readonly SyncConflict[];
  previous?: Map<string, SyncResolution>;
  initialPath?: string;
  apply: (choices: Map<string, SyncResolution>) => Promise<ConflictApplyResult | void>;
  reload?: () => Promise<readonly SyncConflict[]>;
}

const choiceLabel = (resolution?: SyncResolution): string => resolution?.choice === "text" ? "手动合并"
  : resolution?.choice === "local" ? "保留本地" : resolution?.choice === "remote" ? "保留云端" : "待选择";

export class SyncConflictModal extends Modal {
  private session: ConflictSession;
  private active: string;
  private comparison: ConflictComparison = "pair";
  private preview = false;
  private busy = false;
  private opened = false;
  private limit = 100;
  private message = "";
  private readonly drafts = new Map<string, string>();

  constructor(app: App, private readonly options: ConflictModalOptions) {
    super(app);
    this.session = new ConflictSession(options.conflicts, options.previous);
    this.active = (options.conflicts.find(c => c.path === options.initialPath) ?? options.conflicts[0])?.key ?? "";
  }

  onOpen(): void {
    this.opened = true;
    this.modalEl.addClass("istart-conflict-modal");
    this.titleEl.setText("处理同步冲突");
    this.render();
  }

  private button(parent: HTMLElement, label: string, action: () => void, disabled = false, cta = false): HTMLButtonElement {
    const button = parent.createEl("button", { text: label, cls: cta ? "mod-cta" : "" });
    button.disabled = disabled || this.busy;
    button.addEventListener("click", action);
    return button;
  }

  private render(): void {
    if (!this.opened) return;
    const root = this.contentEl;
    root.empty();
    root.createEl("p", {
      text: this.options.mode === "git"
        ? "Git 版本同步 · 选择只保存方案，当前批次全部分配后，预览并应用。关闭窗口可稍后重新同步。"
        : "文件同步 · 比较当前两份内容，无共同内容快照。选择只保存方案，应用前会备份冲突双方内容。",
      cls: "istart-sync-hint",
    });
    if (this.message) root.createEl("p", { text: this.message, cls: "istart-conflict-message", attr: { role: "status", "aria-live": "polite" } });
    if (this.preview) this.renderPreview(root);
    else this.renderWorkbench(root);
  }

  private renderWorkbench(root: HTMLElement): void {
    const session = this.session;
    const toolbar = root.createDiv({ cls: "istart-conflict-toolbar" });
    const label = toolbar.createEl("label");
    const all = label.createEl("input", { type: "checkbox" });
    const selectedCount = label.createSpan();
    const batch = [
      this.button(toolbar, "所选保留本地", () => { session.assignSelected("local"); this.render(); }),
      this.button(toolbar, "所选保留云端", () => { session.assignSelected("remote"); this.render(); }),
      this.button(toolbar, "清除所选方案", () => { session.assignSelected(""); this.render(); }),
    ];
    const refreshSelection = () => {
      all.checked = session.selected.size === session.conflicts.length && session.conflicts.length > 0;
      all.indeterminate = session.selected.size > 0 && !all.checked;
      selectedCount.setText(`全选当前批次（${session.conflicts.length} 项）· 已选 ${session.selected.size}`);
      for (const button of batch) button.disabled = this.busy || session.selected.size === 0;
    };
    all.disabled = this.busy;
    all.addEventListener("change", () => {
      session.selected.clear();
      if (all.checked) for (const conflict of session.conflicts) session.selected.add(conflict.key);
      this.render();
    });
    refreshSelection();
    root.createEl("p", { text: "列表比较：本地 → 云端。新增表示云端多出的行，移除表示本地多出的行。", cls: "istart-sync-hint" });
    const list = root.createDiv({ cls: "istart-conflict-list" });
    const table = list.createEl("table", { cls: "istart-conflict-table" });
    const header = table.createEl("thead").createEl("tr");
    for (const title of ["选择", "文件 / 冲突类型", "差异", "处理方案"]) header.createEl("th", { text: title, attr: { scope: "col" } });
    const body = table.createEl("tbody");
    for (const conflict of session.conflicts.slice(0, this.limit)) {
      const row = body.createEl("tr", { cls: conflict.key === this.active ? "is-active" : "" });
      const checkbox = row.createEl("td").createEl("input", { type: "checkbox", attr: { "aria-label": `选择 ${conflict.path}` } });
      checkbox.checked = session.selected.has(conflict.key);
      checkbox.disabled = this.busy;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) session.selected.add(conflict.key); else session.selected.delete(conflict.key);
        refreshSelection();
      });
      const file = row.createEl("td");
      const path = this.button(file, conflict.path, () => { this.active = conflict.key; this.render(); });
      path.addClass("istart-git-file-path");
      path.setAttribute("aria-pressed", String(conflict.key === this.active));
      file.createDiv({ text: conflictKind(conflict), cls: "istart-sync-hint" });
      row.createEl("td", { text: session.summary(conflict) });
      row.createEl("td", { text: choiceLabel(session.choices.get(conflict.key)) });
    }
    if (session.conflicts.length > this.limit) {
      this.button(root, `显示更多（共 ${session.conflicts.length} 项）`, () => { this.limit += 100; this.render(); });
    }
    const active = session.conflicts.find(conflict => conflict.key === this.active);
    if (active) this.renderDetail(root.createDiv({ cls: "istart-conflict-detail" }), active);
    const footer = root.createDiv({ cls: "istart-conflict-footer" });
    footer.createSpan({ text: `已分配 ${session.assigned} / ${session.conflicts.length} 项 · 待处理 ${session.conflicts.length - session.assigned} 项`, attr: { "aria-live": "polite" } });
    this.button(footer, "预览应用结果", () => { this.preview = true; this.render(); }, !session.ready, true);
    if (this.options.reload) this.button(footer, "重新读取冲突", () => { void this.reload(); });
    this.button(footer, "稍后处理", () => this.close());
  }

  private renderDetail(parent: HTMLElement, conflict: SyncConflict): void {
    parent.createEl("h4", { text: conflict.path });
    parent.createDiv({ text: conflictKind(conflict), cls: "istart-sync-hint" });
    if (this.comparison === "result" && !this.session.choices.has(conflict.key)) this.comparison = "pair";
    if ((this.comparison === "local" || this.comparison === "remote") && conflict.baseExists === undefined) this.comparison = "pair";
    new Setting(parent).setName("比较方向").addDropdown(drop => {
      drop.addOption("pair", "本地 → 云端");
      if (conflict.baseExists !== undefined) drop.addOption("local", "共同版本 → 本地").addOption("remote", "共同版本 → 云端");
      if (this.session.choices.has(conflict.key)) drop.addOption("result", "本地 → 处理结果");
      drop.setDisabled(this.busy).setValue(this.comparison).onChange(value => { this.comparison = value as ConflictComparison; this.render(); });
    });
    const diff = parent.createDiv();
    this.renderDiff(diff, conflict, this.comparison);
    const existing = this.session.choices.get(conflict.key);
    new Setting(parent).setName("此文件处理").addDropdown(drop => {
      drop.addOption("", "待选择")
        .addOption("local", conflict.localExists ? "保留本地" : "保留本地删除")
        .addOption("remote", conflict.remoteExists ? "保留云端" : "保留云端删除");
      if (!conflict.binary) drop.addOption("text", "编辑合并内容");
      drop.setDisabled(this.busy).setValue(existing?.choice ?? "").onChange(value => {
        this.session.choose(conflict, value as "local" | "remote" | "text" | "", this.drafts.get(conflict.key) ?? (existing?.choice === "text" ? existing.text : conflict.local ?? ""));
        this.render();
      });
    });
    const effect = parent.createEl("p", { text: this.effect(conflict), cls: "istart-sync-hint" });
    if (existing?.choice === "text") {
      parent.createEl("label", { text: "合并后的完整文件内容（留空会保存为空文件）", attr: { for: "istart-conflict-editor" } });
      const editor = parent.createEl("textarea", { cls: "istart-git-editor", attr: { id: "istart-conflict-editor" } });
      editor.value = existing.text;
      editor.disabled = this.busy;
      editor.addEventListener("input", () => {
        this.drafts.set(conflict.key, editor.value);
        this.session.choose(conflict, "text", editor.value);
        effect.setText(this.effect(conflict));
        if (this.comparison === "result") { diff.empty(); this.renderDiff(diff, conflict, this.comparison); }
      });
    }
  }

  private renderDiff(parent: HTMLElement, conflict: SyncConflict, mode: ConflictComparison): void {
    const { before, after, label } = this.session.comparison(conflict, mode);
    parent.createEl("p", { text: `${label}：${differenceSummary(before, after)}` });
    parent.createEl("p", { text: "左侧行号对应比较起点，右侧行号对应比较终点；＋ 新增，− 移除。", cls: "istart-sync-hint" });
    if (!before.exists) parent.createEl("p", { text: "比较起点中不存在此文件。", cls: "istart-sync-hint" });
    if (!after.exists) parent.createEl("p", { text: "比较终点中不存在此文件；若保留此版本，将删除文件。", cls: "istart-sync-hint" });
    const lines = compareVersions(before, after);
    if (!lines) {
      if (conflict.binary || before.size > 1_000_000 || after.size > 1_000_000) {
        parent.createEl("p", { text: "附件或大文件不展开文本差异。大小不能说明内容包含关系。" });
      } else {
        parent.createEl("p", { text: "行数较多，使用双栏原文比较。" });
        const columns = parent.createDiv({ cls: "istart-git-comparison" });
        for (const [name, version] of [["比较起点", before], ["比较终点", after]] as const) {
          const column = columns.createDiv(); column.createEl("strong", { text: name });
          column.createEl("pre", { text: version.exists ? version.text ?? "（附件内容）" : "（文件不存在）", cls: "istart-git-preview" });
        }
      }
      return;
    }
    if (lines.every(line => line.kind === "equal")) { parent.createEl("p", { text: "文本内容无变化" }); return; }
    const diff = parent.createDiv({ cls: "istart-git-diff", attr: { "aria-label": `${label}逐行差异` } });
    for (const line of lines) {
      const row = diff.createDiv({ cls: `istart-git-diff-line is-${line.kind}` });
      row.createSpan({ cls: "istart-git-diff-number", text: String(line.oldLine ?? "") });
      row.createSpan({ cls: "istart-git-diff-number", text: String(line.newLine ?? "") });
      row.createSpan({ cls: "istart-git-diff-sign", text: line.kind === "added" ? "+" : line.kind === "deleted" ? "−" : " " });
      row.createSpan({ cls: "istart-git-diff-text", text: line.text.replace(/\n$/, "") || " " });
      if (!line.text.endsWith("\n")) row.createSpan({ cls: "istart-sync-hint", text: " ↵ 无末尾换行" });
    }
  }

  private effect(conflict: SyncConflict): string {
    const resolution = this.session.choices.get(conflict.key);
    if (!resolution) return "尚未分配处理方案。";
    const target = resolvedVersion(conflict, resolution);
    if (!target.exists) return "结果：删除此文件，包括云端版本。";
    if (!conflict.localExists) return "结果：恢复本地文件，并同步此版本。";
    if (resolution.choice === "text") return target.text === "" ? "结果：保存为空文本文件，并同步到两端。" : "结果：合并后的内容同步到两端。";
    return resolution.choice === "local" ? "结果：本地版本同步到云端。" : "结果：云端版本写入本地。";
  }

  private renderPreview(parent: HTMLElement): void {
    parent.createEl("h4", { text: "应用结果预览" });
    parent.createEl("p", { text: "应用前将重新校验两端版本；预览后发生变化时，需要重新读取并确认。", cls: "istart-sync-hint" });
    for (const conflict of this.session.conflicts) {
      const row = parent.createDiv({ cls: "istart-conflict-impact" });
      const resolution = this.session.choices.get(conflict.key)!;
      row.createEl("strong", { text: conflict.path });
      row.createDiv({ text: `${choiceLabel(resolution)} · ${this.effect(conflict)}` });
      row.createDiv({ text: `相对当前本地：${differenceSummary(conflictVersion(conflict, "local"), resolvedVersion(conflict, resolution))}`, cls: "istart-sync-hint" });
      this.button(row, "查看最终差异", () => { this.active = conflict.key; this.comparison = "result"; this.preview = false; this.render(); });
    }
    const footer = parent.createDiv({ cls: "istart-conflict-footer" });
    this.button(footer, "稍后处理", () => this.close());
    this.button(footer, "返回调整", () => { this.preview = false; this.render(); });
    this.button(footer, this.busy ? "正在应用…" : this.options.mode === "git" ? "应用并继续同步" : "应用冲突方案", () => { void this.apply(); }, !this.session.ready, true);
  }

  private async apply(): Promise<void> {
    if (this.busy || !this.session.ready) return;
    this.busy = true; this.render();
    try {
      const result = await this.options.apply(new Map(this.session.choices));
      if (result?.errors.length) {
        const resolved = new Set(result.resolvedKeys);
        const remaining = this.session.conflicts.filter(conflict => !resolved.has(conflict.key));
        this.session = new ConflictSession(remaining, this.session.choices);
        this.active = remaining[0]?.key ?? "";
        this.message = result.errors.join("；");
        this.preview = false;
      } else this.close();
    } catch (error) {
      this.message = (error as Error).message;
      new Notice(`冲突处理未完成：${this.message}`);
    } finally { this.busy = false; this.render(); }
  }

  private async reload(): Promise<void> {
    if (this.busy || !this.options.reload) return;
    this.busy = true; this.render();
    try {
      const conflicts = await this.options.reload();
      this.session = new ConflictSession(conflicts, this.session.choices);
      this.active = conflicts[0]?.key ?? "";
      this.comparison = "pair";
      this.message = conflicts.length ? "已重新读取；内容变化的文件需要重新分配方案。" : "当前已无冲突，请关闭窗口并重新扫描同步状态。";
    } catch (error) { this.message = (error as Error).message; }
    finally { this.busy = false; this.render(); }
  }

  onClose(): void { this.opened = false; this.contentEl.empty(); }
}
