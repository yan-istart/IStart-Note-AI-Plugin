import { Component, FuzzySuggestModal, ItemView, MarkdownRenderer, MarkdownView, Menu, Notice, Platform, Setting, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type DeepSeekPlugin from "../../main";
import { AgentController } from "./AgentController";
import type { AgentMessage, AgentSession, ChangeProposal } from "../../core/agent/types";
import { ActionModal } from "../../ui/ActionModal";
import { changedRange } from "../../core/agent/Changes";
import { getMobileViewport } from "../../ui/MobileViewport";

export const AGENT_VIEW_TYPE = "istart-agent-view";
export class AgentView extends ItemView {
  private controller: AgentController;
  private unsubscribe?: () => void;
  private titleButton!: HTMLButtonElement;
  private contextEl!: HTMLElement;
  private messagesEl!: HTMLElement;
  private historyEl!: HTMLElement;
  private historyList!: HTMLElement;
  private conversationEl!: HTMLElement;
  private input!: HTMLTextAreaElement;
  private mode!: HTMLSelectElement;
  private search!: HTMLInputElement;
  private sendButton!: HTMLButtonElement;
  private statusEl!: HTMLElement;
  private modelEl!: HTMLElement;
  private historyOpen = false;
  private query = "";
  private showArchived = false;
  private activeId = "";
  private frame?: number;
  private markdown?: Component;
  private renderedMessages = "";
  private openDetails = new Set<string>();
  private cleanupViewport?: () => void;
  constructor(leaf: WorkspaceLeaf, private plugin: DeepSeekPlugin) { super(leaf); this.controller = plugin.agent; }
  getViewType(): string { return AGENT_VIEW_TYPE; }
  getDisplayText(): string { return "IStart AI 助手"; }
  getIcon(): string { return "messages-square"; }
  async onOpen(): Promise<void> {
    this.activeId = ""; this.renderedMessages = ""; this.frame = undefined;
    const root = this.contentEl; root.empty(); root.addClass("istart-agent-root");
    if (Platform.isMobile) root.addClass("istart-agent-mobile");
    const header = root.createDiv({ cls: "istart-agent-header" });
    const brand = header.createDiv({ cls: "istart-agent-brand", text: "AI 助手" }); setIcon(brand.createSpan(), "sparkles");
    this.button(header, "新建会话", "plus", () => { this.controller.create(); this.historyOpen = false; this.render(); this.input.focus(); });
    const top = root.createDiv({ cls: "istart-agent-sessionbar" });
    this.titleButton = this.button(top, "会话列表", "messages-square", () => { this.historyOpen = !this.historyOpen; this.render(); }); this.titleButton.addClass("istart-agent-session-title");
    this.button(top, "会话操作", "more-horizontal", event => this.sessionMenu(event));
    this.historyEl = root.createDiv({ cls: "istart-agent-history" });
    const historyControls = this.historyEl.createDiv({ cls: "istart-agent-history-controls" });
    const historySearch = historyControls.createEl("input", { type: "search", placeholder: "搜索会话标题或消息…", attr: { "aria-label": "搜索会话" } });
    historySearch.addEventListener("input", () => { this.query = historySearch.value; this.renderHistory(); });
    const archivedLabel = historyControls.createEl("label");
    const archived = archivedLabel.createEl("input", { type: "checkbox" }); archivedLabel.appendText("显示已归档");
    archived.addEventListener("change", () => { this.showArchived = archived.checked; this.renderHistory(); });
    this.historyList = this.historyEl.createDiv({ cls: "istart-agent-history-list" });
    this.conversationEl = root.createDiv({ cls: "istart-agent-conversation" });
    this.contextEl = this.conversationEl.createDiv({ cls: "istart-agent-context" });
    this.messagesEl = this.conversationEl.createDiv({ cls: "istart-agent-messages", attr: { "aria-label": "对话消息" } });
    const composer = this.conversationEl.createDiv({ cls: "istart-agent-composer" });
    this.input = composer.createEl("textarea", { attr: { placeholder: "描述任务，或输入 @ 引用笔记…", rows: "3", "aria-label": "发送给 AI 助手" } });
    this.input.addEventListener("input", () => { const s = this.controller.active; if (s) this.controller.updateDraft(s.id, this.input.value); });
    this.input.addEventListener("keydown", event => {
      if (!event.isComposing && (event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); this.send(); }
      if (!event.isComposing && event.key === "@") { event.preventDefault(); this.pickNote(); }
    });
    const actions = composer.createDiv({ cls: "istart-agent-composer-actions" });
    this.button(actions, "引用笔记", "at-sign", () => this.pickNote());
    this.button(actions, "引用当前笔记或选区", "text-select", () => { const ref = this.controller.captureCurrent(); if (!ref) throw new Error("请先打开一篇笔记"); this.controller.attach(ref); });
    this.sendButton = this.button(actions, "发送", "arrow-up", () => this.send()); this.sendButton.addClass("mod-cta");
    const meta = composer.createDiv({ cls: "istart-agent-composer-meta" });
    this.mode = meta.createEl("select", { attr: { "aria-label": "执行模式" } });
    this.mode.createEl("option", { value: "agent", text: "Agent" }); this.mode.createEl("option", { value: "ask", text: "问答 · 只读" });
    this.mode.addEventListener("change", () => this.perform(() => { const s = this.controller.active; if (s) this.controller.update(s.id, { mode: this.mode.value === "ask" ? "ask" : "agent" }); }));
    const searchLabel = meta.createEl("label"); this.search = searchLabel.createEl("input", { type: "checkbox" }); searchLabel.appendText("检索知识库");
    this.search.addEventListener("change", () => this.perform(() => { const s = this.controller.active; if (s) this.controller.update(s.id, { searchVault: this.search.checked }); }));
    this.modelEl = meta.createSpan({ cls: "istart-agent-model", text: this.plugin.settings.model });
    this.statusEl = root.createDiv({ cls: "istart-agent-status", attr: { role: "status", "aria-live": "polite" } });
    this.unsubscribe = this.controller.subscribe(() => this.scheduleRender());
    if (Platform.isMobile) this.bindViewport();
    this.render();
  }
  async onClose(): Promise<void> {
    this.unsubscribe?.(); this.unsubscribe = undefined;
    this.cleanupViewport?.();
    if (this.frame !== undefined) window.clearTimeout(this.frame);
    this.frame = undefined;
    if (this.markdown) { this.removeChild(this.markdown); this.markdown = undefined; }
  }
  private scheduleRender(): void {
    if (this.frame !== undefined) return;
    this.frame = window.setTimeout(() => { this.frame = undefined; this.render(); }, 60);
  }
  private perform(callback: () => unknown): void {
    try { const task = callback(); if (task instanceof Promise) void task.catch(error => new Notice(error instanceof Error ? error.message : String(error))); }
    catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
  }
  private button(parent: HTMLElement, label: string, icon: string, action: (event: MouseEvent) => unknown, text = false): HTMLButtonElement {
    const button = parent.createEl("button", { cls: text ? "istart-agent-text-button" : "istart-agent-icon-button", attr: { type: "button", "aria-label": label, "data-tooltip-position": "top" } });
    if (icon) setIcon(button.createSpan(), icon);
    if (text) button.createSpan({ text: label }); else button.setAttribute("title", label);
    button.addEventListener("click", event => this.perform(() => action(event)));
    return button;
  }
  private render(): void {
    if (!this.input) return;
    const s = this.controller.active;
    this.statusEl.setText(this.controller.error || this.controller.saveError || (s && this.controller.isRunning(s.id) ? "正在处理…可切换到其他会话" : "上下文按本轮固定 · Ctrl/Cmd+Enter 发送"));
    if (this.controller.error) {
      this.conversationEl.hide(); this.historyEl.hide();
      this.button(this.statusEl, "重新加载", "refresh-cw", () => this.controller.load(), true); return;
    }
    if (!s) return;
    this.titleButton.empty(); setIcon(this.titleButton.createSpan(), "messages-square"); this.titleButton.createSpan({ text: s.title }); setIcon(this.titleButton.createSpan(), "chevron-down");
    this.titleButton.setAttribute("aria-expanded", String(this.historyOpen));
    this.historyEl.toggle(this.historyOpen); this.conversationEl.toggle(!this.historyOpen);
    if (this.activeId !== s.id) { this.activeId = s.id; this.input.value = s.draft; this.renderedMessages = ""; }
    else if (this.contentEl.ownerDocument.activeElement !== this.input && this.input.value !== s.draft) this.input.value = s.draft;
    const busy = this.controller.isRunning(s.id);
    this.modelEl.setText(this.plugin.settings.model);
    this.sendButton.disabled = s.archived;
    if (s.archived) this.statusEl.setText("会话已归档，可在会话操作中恢复后继续");
    this.mode.value = s.mode; this.mode.disabled = busy; this.search.checked = s.searchVault; this.search.disabled = busy;
    this.sendButton.empty(); setIcon(this.sendButton.createSpan(), busy ? "square" : "arrow-up"); this.sendButton.setAttribute("aria-label", busy ? "停止生成" : "发送");
    this.contextEl.empty();
    for (const ref of s.references) {
      const chip = this.contextEl.createDiv({ cls: "istart-agent-context-chip" });
      this.button(chip, `${ref.path}${ref.selection ? " · 选区" : ""}`, ref.selection ? "text-select" : "file-text", () => this.openSource(ref.path), true);
      const remove = this.button(chip, `移除引用 ${ref.path}`, "x", () => this.controller.detach(ref.path)); remove.disabled = busy;
    }
    if (!s.references.length) this.contextEl.createSpan({ cls: "istart-agent-muted", text: "未引用笔记 · @ 添加上下文" });
    if (this.historyOpen) this.renderHistory();
    this.renderMessages(s);
  }
  private renderHistory(): void {
    this.historyList.empty();
    const query = this.query.toLowerCase();
    const sessions = this.controller.sessions.filter(s => (this.showArchived || !s.archived) && (!query || `${s.title}\n${s.messages.map(m => m.content).join("\n")}`.toLowerCase().includes(query))).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
    for (const s of sessions) {
      const row = this.historyList.createDiv({ cls: `istart-agent-history-row${s.id === this.activeId ? " is-active" : ""}` });
      const select = this.button(row, s.title, s.pinned ? "pin" : "message-square", () => { this.controller.select(s.id); this.historyOpen = false; this.render(); }, true);
      select.createSpan({ cls: "istart-agent-history-meta", text: `${s.archived ? "已归档 · " : ""}${this.controller.isRunning(s.id) ? "生成中 · " : ""}${new Date(s.updatedAt).toLocaleDateString()} · ${s.messages.length} 条消息` });
      this.button(row, `管理会话 ${s.title}`, "more-horizontal", event => this.sessionMenu(event, s));
    }
    if (!sessions.length) this.historyList.createDiv({ cls: "istart-agent-empty", text: "没有匹配的会话" });
  }
  private sessionMenu(event: MouseEvent, s = this.controller.active): void {
    if (!s) return; const menu = new Menu();
    menu.addItem(i => i.setTitle("重命名").setIcon("pencil").onClick(() => this.textModal("重命名会话", s.title, title => this.controller.update(s.id, { title: title.trim() || "新会话" }))));
    menu.addItem(i => i.setTitle(s.pinned ? "取消置顶" : "置顶会话").setIcon("pin").onClick(() => this.controller.update(s.id, { pinned: !s.pinned })));
    menu.addItem(i => i.setTitle("创建会话分支").setIcon("git-branch").onClick(() => this.perform(() => this.controller.fork(s.id))));
    menu.addItem(i => i.setTitle("导出 Markdown").setIcon("download").onClick(() => this.perform(() => this.controller.export(s))));
    menu.addItem(i => i.setTitle(s.archived ? "恢复会话" : "归档会话").setIcon("archive").onClick(() => this.perform(() => this.controller.archive(s.id))));
    menu.addSeparator();
    menu.addItem(i => i.setTitle("删除会话").setIcon("trash-2").onClick(() => new AgentConfirmModal(this.plugin, "删除会话", `删除「${s.title}」及其消息记录？已保存的笔记会保留。`, () => this.perform(() => this.controller.remove(s.id))).open()));
    menu.showAtMouseEvent(event);
  }
  private renderMessages(s: AgentSession): void {
    // Full source/checkpoint snapshots are durable data, not a rendering dependency.
    const signature = JSON.stringify([s.summary, s.messages.map(m => ({
      id: m.id, role: m.role, content: m.content, status: m.status, error: m.error, skills: m.skills, sources: m.sources, steps: m.steps,
      resumable: !!m.checkpoint, references: m.references?.map(ref => ({ path: ref.path, selection: ref.selection?.text })),
      proposals: m.proposals?.map(p => ({ id: p.id, title: p.title, status: p.status, files: p.changes.map(c => [c.path, c.before?.length, c.after.length]) })),
    })), this.controller.isRunning(s.id), this.controller.isApplying]);
    if (signature === this.renderedMessages) return; this.renderedMessages = signature;
    const scrollTop = this.messagesEl.scrollTop;
    const atBottom = this.messagesEl.scrollHeight - this.messagesEl.clientHeight - scrollTop < 90;
    if (this.markdown) this.removeChild(this.markdown);
    this.markdown = new Component(); this.addChild(this.markdown);
    this.messagesEl.empty();
    if (s.summary) { const details = this.details(this.messagesEl, `summary-${s.id}`, "较早对话已整理为摘要"); details.createEl("p", { text: s.summary.content }); }
    if (!s.messages.length) {
      const empty = this.messagesEl.createDiv({ cls: "istart-agent-empty" }); empty.createEl("h3", { text: "从一个问题开始" }); empty.createEl("p", { text: "围绕笔记提问，或让 Agent 帮你完成具体任务。" });
      for (const prompt of ["总结引用笔记，并指出值得继续研究的问题", "基于引用笔记和知识库生成一份可执行的检查表", "续写当前章节，保持原有文风", "根据选区草拟一条阅读批注"]) this.button(empty, prompt, "arrow-up-right", () => { this.input.value = prompt; this.input.focus(); this.controller.update(s.id, { draft: prompt }); }, true);
    }
    for (const message of s.messages) this.renderMessage(s, message);
    if (this.controller.isRunning(s.id) && s.messages[s.messages.length - 1]?.role === "user") this.messagesEl.createDiv({ cls: "istart-agent-muted", text: "正在读取本轮上下文…" });
    window.requestAnimationFrame(() => { if (atBottom) this.messagesEl.scrollTop = this.messagesEl.scrollHeight; else this.messagesEl.scrollTop = scrollTop; });
  }
  private details(parent: HTMLElement, id: string, title: string): HTMLDetailsElement {
    const details = parent.createEl("details", { cls: "istart-agent-details" }); details.open = this.openDetails.has(id); details.createEl("summary", { text: title });
    details.addEventListener("toggle", () => { if (!details.isConnected) return; if (details.open) this.openDetails.add(id); else this.openDetails.delete(id); });
    return details;
  }
  private renderMessage(s: AgentSession, message: AgentMessage): void {
    const row = this.messagesEl.createDiv({ cls: `istart-agent-message is-${message.role}` });
    row.createDiv({ cls: "istart-agent-message-author", text: message.role === "user" ? "我" : "IStart" });
    if (message.role === "user") {
      row.createDiv({ cls: "istart-agent-user-text", text: message.content });
      if (message.references?.length) { const context = this.details(row, `refs-${message.id}`, `本轮引用 ${message.references.length} 篇笔记`); for (const ref of message.references) { this.button(context, ref.path, "file-text", () => this.openSource(ref.path), true); if (ref.selection) context.createEl("blockquote", { text: ref.selection.text }); } }
      return;
    }
    if (message.skills?.length) row.createDiv({ cls: "istart-agent-skills", text: `技能：${message.skills.join(" · ")}` });
    if (message.steps?.length) {
      const steps = this.details(row, `steps-${message.id}`, `${message.status === "running" ? "正在执行" : "执行记录"} · ${message.steps.length} 步`);
      for (const step of message.steps) {
        const item = steps.createDiv({ cls: `istart-agent-step is-${step.status}` }); setIcon(item.createSpan(), step.status === "completed" ? "check" : step.status === "error" ? "circle-alert" : "loader"); item.createSpan({ text: step.label });
        if (step.detail) { const detail = this.details(item, step.id, "查看结果"); detail.createEl("pre", { text: step.detail }); }
      }
    }
    const body = row.createDiv({ cls: "istart-agent-message-body" });
    if (message.status === "running") body.createDiv({ cls: "istart-agent-stream-text", text: message.content || "正在处理…" });
    else if (message.content) void MarkdownRenderer.render(this.app, message.content, body, s.references[0]?.path ?? "", this.markdown!).catch(() => body.setText(message.content));
    if (message.error) row.createDiv({ cls: "istart-agent-error", text: message.error, attr: { role: "alert" } });
    if (message.sources?.length) {
      const sources = row.createDiv({ cls: "istart-agent-sources" });
      for (const path of message.sources) this.button(sources, path.replace(/\.md$/, "").split("/").pop() || path, "file-text", () => this.openSource(path), true);
    }
    for (const proposal of message.proposals ?? []) this.renderProposal(row, s, proposal);
    const actions = row.createDiv({ cls: "istart-agent-message-actions" });
    if (message.content) {
      this.button(actions, "复制回答", "copy", () => navigator.clipboard.writeText(message.content));
      this.button(actions, "保存或写入回答", "file-output", event => {
        const menu = new Menu();
        menu.addItem(i => i.setTitle("保存为新笔记").onClick(() => this.textModal("保存为新笔记", s.title, title => this.controller.offerAnswer(s, message, "save", title))));
        menu.addItem(i => i.setTitle("追加到本轮引用笔记").onClick(() => this.perform(() => this.controller.offerAnswer(s, message, "append"))));
        menu.addItem(i => i.setTitle("插入本轮原光标位置").onClick(() => this.perform(() => this.controller.offerAnswer(s, message, "insert"))));
        menu.showAtMouseEvent(event);
      });
    }
    if (!this.controller.isRunning(s.id)) {
      if (this.controller.canResume(s, message)) this.button(actions, "继续任务", "play", () => this.controller.resume(s.id, message.id), true);
      if (s.messages[s.messages.length - 1]?.id === message.id) this.button(actions, "重新生成", "refresh-cw", () => this.controller.retry(s.id, message.id));
      this.button(actions, "从此处分支", "git-branch", () => this.controller.fork(s.id, message.id));
    }
  }
  private renderProposal(parent: HTMLElement, s: AgentSession, p: ChangeProposal): void {
    const box = parent.createDiv({ cls: "istart-agent-proposal" });
    box.createDiv({ cls: "istart-agent-proposal-title", text: p.title });
    box.createDiv({ cls: "istart-agent-muted", text: `${p.changes.length} 个文件 · ${({ pending: "待应用", applying: "正在应用", applied: "已应用", rejected: "已放弃", superseded: "已由后续草稿替代" })[p.status]}` });
    const preview = this.details(box, p.id, "查看修改");
    for (const c of p.changes) {
      preview.createDiv({ cls: "istart-agent-change-path", text: c.path });
      const range = changedRange(c.before ?? "", c.after);
      const before = c.before?.slice(range.start, range.end);
      if (before) preview.createEl("pre", { cls: "istart-agent-diff-before", text: `− ${before}` });
      preview.createEl("pre", { cls: "istart-agent-diff-after", text: `+ ${range.text}` });
    }
    if (p.status === "pending") {
      const actions = box.createDiv({ cls: "istart-agent-proposal-actions" });
      const apply = this.button(actions, "应用修改", "check", () => this.controller.apply(p, s), true); apply.addClass("mod-cta"); apply.disabled = this.controller.isRunning(s.id) || this.controller.isApplying;
      const reject = this.button(actions, "放弃", "x", () => this.controller.reject(p, s), true); reject.disabled = this.controller.isRunning(s.id) || this.controller.isApplying;
    }
  }
  private send(): void {
    const s = this.controller.active; if (!s) return;
    if (this.controller.isRunning(s.id)) { this.controller.stop(s.id); return; }
    const text = this.input.value; if (!text.trim()) return;
    this.perform(async () => { const task = this.controller.send(s.id, text); if (this.controller.isRunning(s.id)) this.input.value = ""; await task; });
  }
  private pickNote(): void {
    const owner = this;
    new class extends FuzzySuggestModal<TFile> {
      getItems(): TFile[] { return owner.app.vault.getMarkdownFiles().filter(f => !owner.plugin.skillRegistry.isSkillPath(f.path) && !f.path.split("/").some(p => p.startsWith("."))); }
      getItemText(file: TFile): string { return file.path; }
      onChooseItem(file: TFile): void { owner.perform(() => owner.controller.attach({ path: file.path })); owner.input.focus(); }
    }(this.app).open();
  }
  private async openSource(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path); if (!(file instanceof TFile)) throw new Error("来源文件已被移动或删除");
    const leaf = this.app.workspace.getLeavesOfType("markdown").find(l => l.view instanceof MarkdownView && l.view.file === file) ?? this.app.workspace.getLeaf("tab");
    await leaf.openFile(file, { active: true });
  }
  private textModal(title: string, initial: string, callback: (value: string) => unknown): void { new AgentTextModal(this.plugin, title, initial, value => this.perform(() => callback(value))).open(); }
  private bindViewport(): void {
    const win = this.contentEl.ownerDocument.defaultView;
    if (!win) return;
    const doc = this.contentEl.ownerDocument;
    let layoutHeight = Math.max(win.innerHeight, doc.documentElement.clientHeight), layoutWidth = win.innerWidth;
    const resize = () => {
      const keyboard = parseFloat(win.getComputedStyle(doc.documentElement).getPropertyValue("--keyboard-height")) || 0;
      const currentHeight = Math.max(win.innerHeight, doc.documentElement.clientHeight);
      const focused = doc.activeElement === this.input;
      layoutHeight = layoutWidth !== win.innerWidth || (!focused && keyboard === 0) ? currentHeight : Math.max(layoutHeight, currentHeight);
      layoutWidth = win.innerWidth;
      const viewport = getMobileViewport(layoutHeight, layoutWidth, keyboard, win.visualViewport);
      const available = Math.max(120, viewport.top + viewport.height - this.contentEl.getBoundingClientRect().top);
      this.contentEl.style.maxHeight = `${available}px`;
    };
    win.visualViewport?.addEventListener("resize", resize); win.visualViewport?.addEventListener("scroll", resize); win.addEventListener("resize", resize);
    const keyboardEvents = ["keyboardWillShow", "keyboardDidShow", "keyboardWillHide", "keyboardDidHide"];
    for (const event of keyboardEvents) win.addEventListener(event, resize);
    const observer = new win.MutationObserver(resize);
    observer.observe(doc.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    resize();
    this.cleanupViewport = () => { observer.disconnect(); for (const event of keyboardEvents) win.removeEventListener(event, resize); win.visualViewport?.removeEventListener("resize", resize); win.visualViewport?.removeEventListener("scroll", resize); win.removeEventListener("resize", resize); this.contentEl.style.removeProperty("max-height"); };
  }
}
class AgentTextModal extends ActionModal {
  constructor(plugin: DeepSeekPlugin, title: string, private initial: string, private submit: (value: string) => void) { super(plugin.app); this.titleEl.setText(title); }
  onOpen(): void {
    super.onOpen(); const input = this.bodyEl.createEl("input", { type: "text", value: this.initial, cls: "istart-agent-name-input", attr: { "aria-label": this.titleEl.textContent ?? "名称" } });
    const save = () => { if (!input.value.trim()) return; this.submit(input.value.trim().slice(0, 100)); this.close(); };
    input.addEventListener("keydown", e => { if (!e.isComposing && e.key === "Enter") save(); });
    new Setting(this.actionsEl).addButton(b => b.setButtonText("保存").setCta().onClick(save)).addButton(b => b.setButtonText("取消").onClick(() => this.close())); this.focusOnDesktop(input);
  }
}
class AgentConfirmModal extends ActionModal {
  constructor(plugin: DeepSeekPlugin, title: string, private message: string, private confirm: () => void) { super(plugin.app); this.titleEl.setText(title); }
  onOpen(): void { super.onOpen(); this.bodyEl.createEl("p", { text: this.message }); new Setting(this.actionsEl).addButton(b => b.setButtonText("删除").setWarning().onClick(() => { this.confirm(); this.close(); })).addButton(b => b.setButtonText("取消").onClick(() => this.close())); }
}
