import {
  EventRef,
  ItemView,
  MarkdownView,
  Menu,
  Notice,
  Platform,
  TFile,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";
import type DeepSeekPlugin from "../../main";
import type { AnnotationRecord } from "../../core/annotations/AnnotationParser";
import { parseAnnotations } from "../../core/annotations/AnnotationParser";
import { locateSourceRange } from "../../core/annotations/AnnotationNavigation";
import { AnnotationDeleteModal } from "./AnnotationModal";
import { AnnotationService } from "./AnnotationService";

export const ANNOTATION_VIEW_TYPE = "istart-annotations-view";

type AnnotationScope = "current" | "vault";
type AnnotationTypeFilter = "all" | "highlight" | "note";

interface AnnotationItem extends AnnotationRecord {
  path: string;
  title: string;
}

interface EventBinding {
  emitter: { offref(ref: EventRef): void };
  ref: EventRef;
}

const LIST_LIMIT = 300;

/**
 * Right-sidebar reading notes: highlights and comments for the current note or the whole vault.
 * Selection creation lives in main.ts; this view is read/navigate/delete oriented.
 */
export class AnnotationView extends ItemView {
  private viewScope: AnnotationScope = "current";
  private typeFilter: AnnotationTypeFilter = "all";
  private query = "";
  private items: AnnotationItem[] = [];
  private loading = false;
  private scanGeneration = 0;
  private refreshTimer: number | undefined;
  private searchTimer: number | undefined;
  private fileTimers = new Map<string, number>();
  private events: EventBinding[] = [];
  private pendingVaultReload = false;
  private listEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private opened = false;

  constructor(leaf: WorkspaceLeaf, private plugin: DeepSeekPlugin) {
    super(leaf);
  }

  getViewType(): string { return ANNOTATION_VIEW_TYPE; }
  getDisplayText(): string { return "IStart 批注"; }
  getIcon(): string { return "highlighter"; }

  onOpen(): Promise<void> {
    this.opened = true;
    this.contentEl.empty();
    this.contentEl.addClass("istart-annotations-root");
    this.listEl = null;
    this.statusEl = null;
    this.countEl = null;
    if (Platform.isMobile) this.contentEl.addClass("istart-annotations-mobile");
    this.bindEvents();
    void this.reload();
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    this.teardown();
    return Promise.resolve();
  }

  onunload(): void {
    this.teardown();
    super.onunload();
  }

  private teardown(): void {
    if (!this.opened && this.events.length === 0) return;
    this.opened = false;
    this.scanGeneration++;
    this.loading = false;
    if (this.refreshTimer !== undefined) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    if (this.searchTimer !== undefined) {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = undefined;
    }
    for (const timer of this.fileTimers.values()) window.clearTimeout(timer);
    this.fileTimers.clear();
    this.pendingVaultReload = false;
    for (const binding of this.events) binding.emitter.offref(binding.ref);
    this.events = [];
    this.listEl = null;
    this.statusEl = null;
    this.countEl = null;
    this.contentEl.empty();
  }

  /** Called by the plugin after adding an annotation. */
  refresh(): void {
    if (!this.opened) return;
    if (this.viewScope === "vault") {
      if (this.loading) {
        this.pendingVaultReload = true;
        return;
      }
      const active = this.app.workspace.getActiveFile();
      if (active) { void this.refreshFile(active.path); return; }
    }
    this.scheduleReload(0);
  }

  private bindEvents(): void {
    if (this.events.length > 0) return;
    const add = (emitter: EventBinding["emitter"], ref: EventRef) => this.events.push({ emitter, ref });

    add(this.app.workspace, this.app.workspace.on("active-leaf-change", () => {
      if (this.viewScope === "current") this.scheduleReload(200);
    }));

    add(this.app.workspace, this.app.workspace.on("editor-change", () => {
      const active = this.app.workspace.getActiveFile();
      if (active) this.scheduleFileUpdate(active);
    }));

    add(this.app.metadataCache, this.app.metadataCache.on("changed", (file: TFile) => {
      if (file.extension === "md") this.scheduleFileUpdate(file);
    }));

    const reload = () => this.scheduleReload(500);
    add(this.app.vault, this.app.vault.on("create", reload));
    add(this.app.vault, this.app.vault.on("delete", reload));
    add(this.app.vault, this.app.vault.on("rename", reload));
  }

  private scheduleReload(delay: number): void {
    if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = undefined;
      void this.reload();
    }, delay);
  }

  private scheduleFileUpdate(file: TFile): void {
    if (this.viewScope === "current") {
      const active = this.app.workspace.getActiveFile();
      if (!active || active.path === file.path) this.scheduleReload(300);
      return;
    }
    if (this.loading) {
      this.pendingVaultReload = true;
      return;
    }
    const existing = this.fileTimers.get(file.path);
    if (existing !== undefined) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      this.fileTimers.delete(file.path);
      void this.refreshFile(file.path);
    }, 350);
    this.fileTimers.set(file.path, timer);
  }

  private async reload(): Promise<void> {
    if (!this.opened) return;
    const generation = ++this.scanGeneration;
    if (this.viewScope === "current") {
      this.loading = false;
      const file = this.app.workspace.getActiveFile();
      if (!file || file.extension !== "md") {
        this.items = [];
        this.renderResults();
        return;
      }
      try {
        const content = await this.readFile(file);
        if (generation !== this.scanGeneration) return;
        this.items = this.parseContent(file, content);
      } catch {
        if (generation !== this.scanGeneration) return;
        this.items = [];
      }
      this.renderResults();
      return;
    }

    this.loading = true;
    this.items = [];
    this.renderResults();
    await this.scanVault(generation);
  }

  private async scanVault(generation: number): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    const items: AnnotationItem[] = [];
    let done = 0;
    for (let index = 0; index < files.length; index += 8) {
      if (generation !== this.scanGeneration) return;
      const batch = files.slice(index, index + 8);
      const parsed = await Promise.all(batch.map(async (file) => {
        try {
          return this.parseContent(file, await this.readFile(file));
        } catch {
          return [];
        }
      }));
      for (const group of parsed) {
        for (const item of group) items.push(item);
      }
      done += batch.length;
      if (this.statusEl) this.statusEl.setText(`正在扫描 ${done}/${files.length} 篇笔记…`);
    }
    if (generation !== this.scanGeneration) return;
    items.sort(compareItems);
    this.items = items;
    this.loading = false;
    this.renderList();
    if (this.pendingVaultReload) {
      this.pendingVaultReload = false;
      this.scheduleReload(250);
    }
  }

  private async refreshFile(path: string): Promise<void> {
    if (this.viewScope !== "vault" || this.loading) return;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== "md") return;
    let fresh: AnnotationItem[] = [];
    try {
      fresh = this.parseContent(file, await this.readFile(file));
    } catch {
      return;
    }
    if (!this.opened || this.viewScope !== "vault" || this.loading) return;
    this.items = this.items.filter((item) => item.path !== path);
    for (const item of fresh) this.items.push(item);
    this.items.sort(compareItems);
    this.renderList();
  }

  private parseContent(file: TFile, content: string): AnnotationItem[] {
    return parseAnnotations(content).map((annotation) => ({
      ...annotation,
      path: file.path,
      title: file.basename,
    }));
  }

  private readFile(file: TFile): Promise<string> | string {
    const active = this.app.workspace.activeEditor;
    if (active?.editor && active.file?.path === file.path) return active.editor.getValue();
    return this.app.vault.cachedRead(file);
  }

  // ── Rendering ─────────────────────────────────────────────

  private render(): void {
    this.contentEl.empty();
    this.contentEl.addClass("istart-annotations-root");
    if (Platform.isMobile) this.contentEl.addClass("istart-annotations-mobile");

    const header = this.contentEl.createDiv({ cls: "istart-annotations-header" });
    const tabs = header.createDiv({ cls: "istart-annotations-tabs" });
    this.createTab(tabs, "当前笔记", "current");
    this.createTab(tabs, "全库", "vault");

    const refreshButton = header.createEl("button", {
      cls: "istart-annotations-icon-btn",
      attr: { type: "button", "aria-label": "刷新批注" },
    });
    setIcon(refreshButton, "refresh-cw");
    refreshButton.addEventListener("click", () => { void this.reload(); });

    const searchWrap = this.contentEl.createDiv({ cls: "istart-annotations-search" });
    const search = searchWrap.createEl("input", {
      type: "search",
      attr: { placeholder: "搜索文字、批注或文件名", "aria-label": "搜索批注" },
    });
    search.value = this.query;
    search.addEventListener("input", () => {
      this.query = search.value;
      if (this.searchTimer !== undefined) window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => {
        this.searchTimer = undefined;
        this.renderList();
      }, 120);
    });

    const filters = this.contentEl.createDiv({ cls: "istart-annotations-filters" });
    this.createFilter(filters, "全部", "all");
    this.createFilter(filters, "高亮", "highlight");
    this.createFilter(filters, "批注", "note");
    this.countEl = filters.createSpan({ cls: "istart-annotations-count" });

    this.statusEl = this.contentEl.createDiv({ cls: "istart-annotations-status" });
    this.listEl = this.contentEl.createDiv({ cls: "istart-annotations-list" });
    this.renderList();
  }

  private renderResults(): void {
    if (this.listEl) this.renderList();
    else this.render();
  }

  private createTab(container: HTMLElement, label: string, scope: AnnotationScope): void {
    const button = container.createEl("button", {
      text: label,
      cls: `istart-annotations-tab${this.viewScope === scope ? " is-active" : ""}`,
      attr: { type: "button", "aria-pressed": String(this.viewScope === scope) },
    });
    button.addEventListener("click", () => {
      if (this.viewScope === scope) return;
      this.viewScope = scope;
      this.items = [];
      this.loading = scope === "vault";
      this.pendingVaultReload = false;
      this.render();
      void this.reload();
    });
  }

  private createFilter(container: HTMLElement, label: string, filter: AnnotationTypeFilter): void {
    const button = container.createEl("button", {
      text: label,
      cls: `istart-annotations-chip${this.typeFilter === filter ? " is-active" : ""}`,
      attr: { type: "button", "aria-pressed": String(this.typeFilter === filter) },
    });
    button.addEventListener("click", () => {
      if (this.typeFilter === filter) return;
      this.typeFilter = filter;
      this.render();
    });
  }

  private renderList(): void {
    if (!this.listEl) return;
    const scrollTop = this.listEl.scrollTop;
    this.listEl.empty();

    const filtered = this.filteredItems();
    if (this.countEl) this.countEl.setText(`${filtered.length} 条`);

    if (this.loading) {
      if (this.statusEl) this.statusEl.setText("正在扫描全库，请稍候…");
      this.renderEmpty("正在扫描…", "笔记较多时首次扫描需要一点时间。");
      return;
    }

    if (!this.listEl) return;
    if (this.statusEl) {
      const fileCount = new Set(this.items.map((item) => item.path)).size;
      const active = this.app.workspace.getActiveFile();
      this.statusEl.setText(this.viewScope === "vault"
        ? `${fileCount} 篇有批注 · ${this.items.length} 条批注与高亮`
        : active
        ? `${active.basename} · ${this.items.length} 条批注与高亮`
        : `${this.items.length} 条批注与高亮`);
    }

    if (filtered.length === 0) {
      if (this.items.length > 0) {
        this.renderEmpty("没有匹配的批注", "试试更换关键词或筛选条件。", "清除筛选", () => {
          this.query = "";
          this.typeFilter = "all";
          this.render();
        });
      } else if (this.viewScope === "current") {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== "md") {
          this.renderEmpty("没有打开的笔记", "打开一篇 Markdown 笔记后，这里会显示它的高亮与批注。");
        } else {
          this.renderEmpty(
            "当前笔记还没有批注",
            "选中一段文字，运行「添加批注」或「AI 批注」，就会出现在这里。",
            "添加批注",
            () => this.plugin.addAnnotation()
          );
        }
      } else {
        this.renderEmpty("全库还没有批注", "在任意笔记中选中文字并添加批注后，会自动汇总到这里。");
      }
      this.listEl.scrollTop = 0;
      return;
    }

    const shown = filtered.slice(0, LIST_LIMIT);
    let lastPath = "";
    for (const annotation of shown) {
      if (this.viewScope === "vault" && annotation.path !== lastPath) {
        this.renderGroupTitle(annotation);
        lastPath = annotation.path;
      }
      this.renderCard(annotation);
    }

    if (filtered.length > shown.length) {
      this.listEl.createDiv({
        cls: "istart-annotations-limit",
        text: `仅显示前 ${LIST_LIMIT} 条，请用搜索缩小范围。`,
      });
    }
    this.listEl.scrollTop = scrollTop;
  }

  private filteredItems(): AnnotationItem[] {
    const tokens = this.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return this.items.filter((item) => {
      if (this.typeFilter === "highlight" && item.source !== "highlight" && item.source !== "mark") return false;
      if (this.typeFilter === "note" && !isNoteAnnotation(item)) return false;
      if (tokens.length === 0) return true;
      const haystack = `${item.text} ${item.comment} ${item.title} ${item.path} ${item.heading}`.toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
  }

  private renderGroupTitle(annotation: AnnotationItem): void {
    if (!this.listEl) return;
    const group = this.listEl.createDiv({ cls: "istart-annotations-group-title" });
    const icon = group.createSpan({ cls: "istart-annotations-group-icon" });
    setIcon(icon, "file-text");
    group.createSpan({ text: annotation.title, cls: "istart-annotations-group-name" });
    const folder = annotation.path.includes("/")
      ? annotation.path.slice(0, annotation.path.lastIndexOf("/"))
      : "";
    if (folder) group.createSpan({ text: folder, cls: "istart-annotations-group-folder" });
  }

  private renderCard(annotation: AnnotationItem): void {
    if (!this.listEl) return;
    const card = this.listEl.createDiv({
      cls: "istart-annotation-card",
      attr: { role: "button", tabindex: "0", "aria-label": `跳转到批注：${annotation.text}` },
    });
    card.dataset.annotationId = annotation.id;

    const top = card.createDiv({ cls: "istart-annotation-card-top" });
    const kind = top.createSpan({ cls: "istart-annotation-kind" });
    setIcon(kind, annotationIcon(annotation));

    const color = safeCssColor(annotation.color);
    if (color) {
      const dot = top.createSpan({ cls: "istart-annotation-color" });
      dot.style.background = color;
      dot.setAttribute("aria-label", "高亮颜色");
    }

    const meta = top.createDiv({ cls: "istart-annotation-meta" });
    meta.createSpan({ text: annotation.heading || "正文", cls: "istart-annotation-meta-title" });
    const kindLabel = annotation.kind === "note" && (annotation.source === "highlight" || annotation.source === "mark")
      ? "批注"
      : sourceLabel(annotation.source);
    meta.createSpan({ text: `第 ${annotation.line + 1} 行 · ${kindLabel}` });

    const moreButton = top.createEl("button", {
      cls: "istart-annotation-more",
      attr: { type: "button", "aria-label": "批注操作" },
    });
    setIcon(moreButton, "more-horizontal");
    moreButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.showMenu(annotation, event);
    });

    card.createDiv({ text: annotation.text, cls: "istart-annotation-excerpt" });
    if (annotation.comment) {
      card.createDiv({ text: annotation.comment, cls: "istart-annotation-comment" });
    }

    let longPressed = false;
    let pressTimer: number | undefined;
    let pressStartX = 0;
    let pressStartY = 0;
    card.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("button")) return;
      longPressed = false;
      pressStartX = event.clientX;
      pressStartY = event.clientY;
      pressTimer = window.setTimeout(() => {
        pressTimer = undefined;
        longPressed = true;
        this.showMenu(annotation, event);
        window.setTimeout(() => { longPressed = false; }, 800);
      }, 500);
    });
    const cancelPress = () => {
      if (pressTimer !== undefined) {
        window.clearTimeout(pressTimer);
        pressTimer = undefined;
      }
    };
    card.addEventListener("pointerup", cancelPress);
    card.addEventListener("pointercancel", cancelPress);
    card.addEventListener("pointerleave", cancelPress);
    card.addEventListener("pointermove", (event) => {
      if (pressTimer === undefined) return;
      if (Math.abs(event.clientX - pressStartX) > 10 || Math.abs(event.clientY - pressStartY) > 10) cancelPress();
    });
    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (pressTimer !== undefined) {
        window.clearTimeout(pressTimer);
        pressTimer = undefined;
      }
      if (!longPressed) this.showMenu(annotation, event);
    });
    card.addEventListener("click", () => {
      if (longPressed) {
        longPressed = false;
        return;
      }
      void this.navigate(annotation);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      void this.navigate(annotation);
    });
  }

  private renderEmpty(title: string, detail: string, actionLabel?: string, action?: () => void): void {
    if (!this.listEl) return;
    const empty = this.listEl.createDiv({ cls: "istart-annotations-empty" });
    empty.createDiv({ text: title, cls: "istart-annotations-empty-title" });
    empty.createDiv({ text: detail, cls: "istart-annotations-empty-detail" });
    if (actionLabel && action) {
      const button = empty.createEl("button", {
        text: actionLabel,
        cls: "istart-annotations-empty-action",
        attr: { type: "button" },
      });
      button.addEventListener("click", action);
    }
  }

  private showMenu(annotation: AnnotationItem, event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("跳转到批注").setIcon("corner-down-right").onClick(() => {
      void this.navigate(annotation);
    }));
    menu.addItem((item) => item.setTitle("复制文字与批注").setIcon("copy").onClick(() => {
      void this.copy(annotation);
    }));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("移除批注").setIcon("trash-2").onClick(() => {
      this.confirmDelete(annotation);
    }));
    const target = event.currentTarget as HTMLElement | null;
    const rect = target?.getBoundingClientRect();
    const x = event.clientX || (rect ? rect.right - 8 : 0);
    const y = event.clientY || (rect ? rect.top + 8 : 0);
    menu.showAtPosition({ x, y }, this.contentEl.ownerDocument);
  }

  // ── Actions ───────────────────────────────────────────────

  private async navigate(annotation: AnnotationItem): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(annotation.path);
    if (!(file instanceof TFile)) {
      new Notice("找不到原文件，可能已被移动或删除");
      return;
    }

    try {
      let leaf: WorkspaceLeaf | null = null;
      for (const candidate of this.app.workspace.getLeavesOfType("markdown")) {
        if (candidate.view instanceof MarkdownView && candidate.view.file?.path === file.path) {
          leaf = candidate;
          break;
        }
      }
      if (!leaf) {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        leaf = activeView?.leaf ?? this.app.workspace.getLeaf("tab");
        await leaf.openFile(file, { active: true });
      }
      this.app.workspace.setActiveLeaf(leaf, { focus: false });
      this.locateInLeaf(leaf, annotation);

      if (Platform.isMobile && this.plugin.settings.annotationCollapseSidebarOnMobile) {
        window.setTimeout(() => this.app.workspace.rightSplit.collapse(), 120);
      }
    } catch (error) {
      new Notice(`跳转失败：${(error as Error).message}`);
    }
  }

  private locateInLeaf(leaf: WorkspaceLeaf, annotation: AnnotationItem): void {
    if (!(leaf.view instanceof MarkdownView) || leaf.view.file?.path !== annotation.path) return;
    const view = leaf.view;
    if (view.getMode() === "preview") {
      view.previewMode.applyScroll(annotation.line);
      return;
    }

    const editor = view.editor;
    const content = editor.getValue();
    const range = locateSourceRange(content, annotation);
    let from = editor.offsetToPos(range ? range.start : 0);
    let to = editor.offsetToPos(range ? range.end : 0);
    if (range) {
      editor.setSelection(from, to);
    } else {
      from = { line: annotation.line, ch: annotation.ch };
      to = { ...from };
      editor.setCursor(from);
    }
    editor.scrollIntoView({ from, to }, true);
    if (!Platform.isMobile) editor.focus();
  }

  private async copy(annotation: AnnotationItem): Promise<void> {
    const text = annotation.comment ? `${annotation.text}\n\n${annotation.comment}` : annotation.text;
    try {
      await navigator.clipboard.writeText(text);
      new Notice("已复制批注");
    } catch {
      new Notice("复制失败");
    }
  }

  private confirmDelete(annotation: AnnotationItem): void {
    new AnnotationDeleteModal(this.app, {
      annotation,
      onConfirm: () => { void this.deleteAnnotation(annotation); },
    }).open();
  }

  private async deleteAnnotation(annotation: AnnotationItem): Promise<void> {
    try {
      const removed = await new AnnotationService(this.app).remove(annotation.path, annotation);
      if (!removed) {
        new Notice("没有可移除的批注标记");
        return;
      }
      new Notice("已移除批注");
      if (this.viewScope === "current") {
        await this.reload();
      } else {
        this.items = this.items.filter((item) => !(item.path === annotation.path && item.id === annotation.id));
        this.renderList();
      }
    } catch (error) {
      new Notice(`移除失败：${(error as Error).message}`);
    }
  }
}

function compareItems(a: AnnotationItem, b: AnnotationItem): number {
  return a.path.localeCompare(b.path) || a.contentStart - b.contentStart;
}

function isNoteAnnotation(annotation: AnnotationItem): boolean {
  if (annotation.source === "inline-comment" || annotation.source === "footnote" || annotation.source === "obsidian-comment") {
    return true;
  }
  return annotation.kind === "note";
}

function annotationIcon(annotation: AnnotationRecord): string {
  if (annotation.kind === "note" && (annotation.source === "highlight" || annotation.source === "mark")) {
    return "message-square-text";
  }
  return sourceIcon(annotation.source);
}

function sourceIcon(source: AnnotationRecord["source"]): string {
  if (source === "inline-comment" || source === "footnote") return "message-square-text";
  if (source === "obsidian-comment") return "eye-off";
  return "highlighter";
}

function sourceLabel(source: AnnotationRecord["source"]): string {
  if (source === "inline-comment") return "行内批注";
  if (source === "footnote") return "脚注";
  if (source === "obsidian-comment") return "注释";
  if (source === "mark") return "高亮";
  return "高亮";
}

function safeCssColor(value?: string): string | undefined {
  if (!value) return undefined;
  const color = value.trim();
  if (!/^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([^)]*\)|[a-z]{3,20})$/i.test(color)) return undefined;
  if (/url|var|expression|javascript/i.test(color)) return undefined;
  return color;
}
