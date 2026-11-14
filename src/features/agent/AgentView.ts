import { Component, FuzzySuggestModal, ItemView, MarkdownRenderer, MarkdownView, Menu, Notice, Platform, Setting, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type DeepSeekPlugin from "../../main";
import { AgentController } from "./AgentController";
import { isLiveStory } from "../../core/agent/types";
import type { AgentMessage, AgentSession, ChangeProposal, StoryConfig, LiveStoryScene, StoryBlock } from "../../core/agent/types";
import { StorySceneView } from "./StorySceneView";
import { storyName } from "../../core/agent/StoryContent";
import { cloneJson } from "../../util/json";
import { ActionModal } from "../../ui/ActionModal";
import { changedRange } from "../../core/agent/Changes";
import { bindSidebarViewport } from "../../ui/SidebarViewport";
import { renderWorkbenchNav } from "../workbench/WorkbenchNav";
import { WORKBENCH_VIEWS } from "../workbench/WorkbenchController";
import { renderAgentTaskForm } from "./AgentTaskForm";
import { destructiveButton } from "../../ui/compat";
import { AgentPositionModal } from "./AgentPositionModal";
import { messageText, conversationText } from "../../core/agent/ClipboardText";

export const AGENT_VIEW_TYPE = WORKBENCH_VIEWS.assistant;
const AGENT_SHORTCUTS = [
  ["continue-writing-settings", "续写"], ["insert-writing-settings", "插写"], ["polish-writing", "润色"],
  ["summarize-note", "总结"], ["check-typos", "校对"], ["beautify-note", "美化"], ["ai-annotation", "AI 批注"],
  ["question-with-graph", "知识提问"], ["knowledge-debt", "知识债务"], ["scan-empty-concepts", "空概念"],
  ["new-reading-project", "阅读项目"], ["new-writing-project", "新建作品"], ["create-artifact", "实用模板"],
] as const;
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
  private optionsSummary!: HTMLElement;
  private storySettings!: HTMLButtonElement;
  private mobileMode?: HTMLButtonElement;
  private mobileSearch?: HTMLButtonElement;
  private inputObserver?: ResizeObserver;
  private inputSizeKey = "";
  private historyOpen = false;
  private query = "";
  private showArchived = false;
  private activeId = "";
  private frame?: number;
  private markdown?: Component;
  private renderedMessages = "";
  private openDetails = new Set<string>();
  private cleanupViewport?: () => void;
  private taskEl!: HTMLElement;
  private renderedTask = "";
  private storyViews = new Map<string, StorySceneView>();
  constructor(leaf: WorkspaceLeaf, private plugin: DeepSeekPlugin) { super(leaf); this.controller = plugin.agent; }
  getViewType(): string { return AGENT_VIEW_TYPE; }
  getDisplayText(): string { return "IStart 工作台"; }
  getIcon(): string { return "istart-assistant"; }
  async onOpen(): Promise<void> {
    this.renderedTask = "";
    this.inputSizeKey = "";
    this.activeId = ""; this.renderedMessages = ""; this.frame = undefined;
    const root = this.contentEl; root.empty(); root.addClass("istart-agent-root");
    if (Platform.isMobile) root.addClass("istart-agent-mobile");
    renderWorkbenchNav(root, this.plugin, "assistant");
    const top = root.createDiv({ cls: "istart-agent-sessionbar" });
    this.titleButton = this.button(top, "会话列表", "messages-square", () => { this.historyOpen = !this.historyOpen; this.render(); }); this.titleButton.addClass("istart-agent-session-title");
    this.button(top, "新建会话", "plus", () => { this.controller.create(); this.historyOpen = false; this.render(); if (!Platform.isMobile) this.input.focus(); });
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
    this.contextEl = this.conversationEl.createDiv({ cls: "istart-agent-context", attr: { "aria-label": "本轮引用笔记" } });
    this.messagesEl = this.conversationEl.createDiv({ cls: "istart-agent-messages", attr: { "aria-label": "对话消息" } });
    const composer = this.conversationEl.createDiv({ cls: "istart-agent-composer" });
    if (Platform.isMobile) composer.appendChild(this.contextEl);
    const body = composer.createDiv({ cls: "istart-agent-composer-body" });
    const shortcuts = body.createEl("details", { cls: "istart-agent-shortcuts" });
    shortcuts.createEl("summary", { text: "任务快捷入口" });
    const taskChoices = shortcuts.createDiv({ cls: "istart-agent-shortcut-list" });
    for (const [id, label] of AGENT_SHORTCUTS) this.button(taskChoices, label, "sparkles", () => this.plugin.startAgentAction(id, null), true);
    this.button(taskChoices, "导入原稿", "file-input", () => this.plugin.openImportNovel(), true);
    this.taskEl = body.createDiv({ cls: "istart-agent-task" });
    this.taskEl.addEventListener("keydown", event => {
      if (!event.isComposing && (event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); this.send(); }
    });
    const shell = Platform.isMobile ? composer.createDiv({ cls: "istart-agent-input-shell" }) : body;
    const inputRow = shell.createDiv({ cls: "istart-agent-input-row" });
    this.input = inputRow.createEl("textarea", { attr: { placeholder: "描述任务，或输入 @ 引用笔记…", rows: Platform.isMobile ? "1" : "3", "aria-label": "发送给 AI 助手" } });
    this.input.addEventListener("input", () => { const s = this.controller.active; if (s) this.controller.updateDraft(s.id, this.input.value); this.resizeInput(); this.updateSendState(); });
    this.input.addEventListener("keydown", event => {
      if (!event.isComposing && (event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); this.send(); }
      if (!event.isComposing && event.key === "@") { event.preventDefault(); this.pickNote(); }
    });
    const actions = (Platform.isMobile ? shell : composer).createDiv({ cls: "istart-agent-composer-actions" });
    if (Platform.isMobile) {
      this.button(actions, "添加引用与任务快捷入口", "plus", event => this.composerMenu(event));
      this.mobileMode = this.button(actions, "模式与检索设置", "", event => this.modeMenu(event));
      this.mobileMode.addClass("istart-agent-mobile-mode");
      this.mobileSearch = this.button(actions, "检索知识库", "book-open", () => {
        const s = this.controller.active;
        if (s && !this.search.disabled) this.controller.update(s.id, { searchVault: !s.searchVault });
      });
      this.mobileSearch.addClass("istart-agent-mobile-search");
      this.mobileSearch.createSpan({ text: "知识库" });
    } else {
      const reference = this.button(actions, "引用笔记", "at-sign", () => this.pickNote());
      reference.createSpan({ text: "引用", cls: "istart-agent-action-label" });
      const current = this.button(actions, "引用当前笔记或选区", "text-select", () => this.attachCurrent());
      current.createSpan({ text: "当前", cls: "istart-agent-action-label" });
      const position = this.button(actions, "设置插入位置", "text-cursor-input", () => this.choosePosition());
      position.createSpan({ text: "位置", cls: "istart-agent-action-label" });
    }
    const dismiss = this.button(actions, "收起键盘", "keyboard", () => {
      const active = root.ownerDocument.activeElement as HTMLElement | null;
      if (active && root.contains(active)) active.blur();
    });
    dismiss.addClass("istart-sidebar-dismiss-keyboard");
    dismiss.createSpan({ text: "收起", cls: "istart-agent-action-label" });
    this.sendButton = this.button(Platform.isMobile ? inputRow : actions, "发送", "arrow-up", () => this.send()); this.sendButton.addClass("mod-cta", "istart-agent-send");
    this.sendButton.addEventListener("pointerdown", event => { if (Platform.isMobile && root.ownerDocument.activeElement === this.input) event.preventDefault(); });
    const options = shell.createEl("details", { cls: "istart-agent-input-options" });
    options.open = !Platform.isMobile;
    this.optionsSummary = options.createEl("summary", { text: "模式与检索设置" });
    const meta = options.createDiv({ cls: "istart-agent-composer-meta" });
    this.mode = meta.createEl("select", { attr: { "aria-label": "执行模式" } });
    this.mode.createEl("option", { value: "agent", text: "Agent" }); this.mode.createEl("option", { value: "ask", text: "问答 · 只读" });
    this.mode.createEl("option", { value: "story", text: "小说演绎与进化模式" });
    this.mode.addEventListener("change", () => this.perform(() => { const s = this.controller.active; if (s) this.controller.update(s.id, { mode: this.mode.value === "story" ? "story" : this.mode.value === "ask" ? "ask" : "agent" }); }));
    this.storySettings = this.button(meta, "参演设置", "users", async () => {
      const s = this.controller.active; if (!s) return;
      const characters = await this.controller.storyCharacters(s.id);
      if (!characters.length) throw new Error("当前小说没有角色卡，请先提取或创建角色卡");
      new StorySettingsModal(this.plugin, characters, s.storyConfig, config => this.perform(() => this.controller.updateStoryConfig(s.id, config))).open();
    }, true);
    const searchLabel = meta.createEl("label"); this.search = searchLabel.createEl("input", { type: "checkbox" }); searchLabel.appendText("检索知识库");
    this.search.addEventListener("change", () => this.perform(() => { const s = this.controller.active; if (s) this.controller.update(s.id, { searchVault: this.search.checked }); }));
    this.modelEl = meta.createSpan({ cls: "istart-agent-model", text: this.plugin.settings.model });
    this.statusEl = root.createDiv({ cls: "istart-agent-status", attr: { role: "status", "aria-live": "polite" } });
    this.unsubscribe = this.controller.subscribe(() => this.scheduleRender());
    this.registerDomEvent(this.contentEl.ownerDocument, "selectionchange", () => this.scheduleRender());
    this.cleanupViewport = bindSidebarViewport(root);
    this.render();
    if (Platform.isMobile) {
      let width = 0;
      this.inputObserver = new ResizeObserver(() => {
        if (this.input.clientWidth === width) return;
        width = this.input.clientWidth; this.resizeInput();
      });
      this.inputObserver.observe(this.input);
    }
  }
  async onClose(): Promise<void> {
    this.storyViews.clear();
    this.unsubscribe?.(); this.unsubscribe = undefined;
    this.cleanupViewport?.();
    this.inputObserver?.disconnect(); this.inputObserver = undefined;
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
  private resizeInput(): void {
    if (!Platform.isMobile || !this.input) return;
    const key = `${this.input.clientWidth}/${this.input.value}`;
    if (key === this.inputSizeKey) return;
    this.inputSizeKey = key;
    this.input.setCssProps({ "--istart-agent-input-height": "0px" });
    this.input.setCssProps({ "--istart-agent-input-height": `${Math.min(128, Math.max(44, this.input.scrollHeight))}px` });
  }
  private updateSendState(): void {
    const s = this.controller.active;
    this.sendButton.disabled = !s || s.archived || (Platform.isMobile && !s.pendingTask && (!this.controller.isRunning(s.id) || !!this.controller.openStory(s.id)) && !this.input.value.trim());
  }
  private attachCurrent(): void {
    const ref = this.controller.captureCurrent();
    if (!ref) throw new Error("请先打开一篇笔记");
    this.controller.attach(ref);
  }
  private choosePosition(): void {
    const s = this.controller.active; if (!s) return;
    const current = this.controller.captureCurrent();
    new AgentPositionModal(this.plugin, s.id, s.references.length ? s.references : current ? [current] : []).open();
  }
  private composerMenu(event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem(i => i.setTitle("引用笔记").setIcon("at-sign").onClick(() => this.pickNote()));
    menu.addItem(i => i.setTitle("引用当前笔记或选区").setIcon("text-select").onClick(() => this.perform(() => this.attachCurrent())));
    menu.addItem(i => i.setTitle("设置插入位置").setIcon("text-cursor-input").onClick(() => this.choosePosition()));
    menu.addSeparator();
    for (const [id, label] of AGENT_SHORTCUTS) menu.addItem(i => i.setTitle(label).setIcon("sparkles").onClick(() => this.perform(() => this.plugin.startAgentAction(id, null))));
    menu.addItem(i => i.setTitle("导入原稿").setIcon("file-input").onClick(() => this.perform(() => this.plugin.openImportNovel())));
    menu.showAtMouseEvent(event);
  }
  private modeMenu(event: MouseEvent): void {
    const s = this.controller.active; if (!s) return;
    const menu = new Menu();
    for (const [mode, label] of [["agent", "Agent"], ["ask", "问答 · 只读"], ["story", "小说演绎"]] as const) {
      menu.addItem(i => i.setTitle(label).setChecked(s.mode === mode).setDisabled(this.mode.disabled).onClick(() => this.perform(() => this.controller.update(s.id, { mode }))));
    }
    menu.addSeparator();
    menu.addItem(i => i.setTitle("检索知识库").setIcon("book-open").setChecked(s.searchVault).setDisabled(this.search.disabled).onClick(() => this.perform(() => this.controller.update(s.id, { searchVault: !s.searchVault }))));
    if (s.mode === "story") menu.addItem(i => i.setTitle("参演设置").setIcon("users").setDisabled(this.storySettings.disabled).onClick(() => this.storySettings.click()));
    if (s.mode === "story") menu.addItem(i => i.setTitle(`小说章节在首个引用 · ${s.storyConfig?.characterPaths.length ? `${s.storyConfig.characterPaths.length}名角色` : "自动选择角色"} · 最多推进 ${s.storyConfig?.maxTurns ?? 6} 次`).setDisabled(true));
    menu.addItem(i => i.setTitle(`模型：${this.plugin.settings.model}`).setDisabled(true));
    menu.showAtMouseEvent(event);
  }
  private referenceMenu(event: MouseEvent): void {
    const s = this.controller.active; if (!s) return;
    const menu = new Menu();
    for (const ref of s.references) {
      menu.addItem(i => i.setTitle(ref.path).setIcon(ref.selection ? "text-select" : "file-text").onClick(() => this.perform(() => this.openSource(ref.path))));
      menu.addItem(i => i.setTitle(`移除 ${ref.path}`).setIcon("x").setDisabled(this.controller.isRunning(s.id) || !!this.controller.openStory(s.id)).onClick(() => this.perform(() => this.controller.detach(ref.path))));
      menu.addSeparator();
    }
    menu.addItem(i => i.setTitle("引用笔记").setIcon("at-sign").onClick(() => this.pickNote()));
    menu.showAtMouseEvent(event);
  }
  private button(parent: HTMLElement, label: string, icon: string, action: (event: MouseEvent) => unknown, text = false): HTMLButtonElement {
    const button = parent.createEl("button", { cls: text ? "istart-agent-text-button" : "istart-agent-icon-button", attr: { type: "button", "aria-label": label, "data-tooltip-position": "top" } });
    if (icon) setIcon(button.createSpan(), icon);
    if (text) button.createSpan({ text: label });
    else {
      button.setAttribute("title", label);
      if (parent.hasClass("istart-agent-message-actions")) {
        const shortLabel: Record<string, string> = { "保存或写入回答": "保存/写入", "复制完整消息": "完整复制", "复制回答": "复制", "从此处分支": "分支", "重新生成": "重新生成" };
        button.createSpan({ text: shortLabel[label] ?? label, cls: "istart-agent-touch-label" });
      }
    }
    button.addEventListener("click", event => this.perform(() => action(event)));
    return button;
  }
  private render(): void {
    if (!this.input) return;
    const s = this.controller.active;
    this.statusEl.setText(this.controller.error || this.controller.saveError || (s && this.controller.isRunning(s.id) ? "正在处理…可切换到其他会话" : (Platform.isMobile ? s?.references.length ? "本轮使用以上引用 · 可随时调整" : "未引用笔记 · @ 添加上下文" : "上下文按本轮固定 · Ctrl/Cmd+Enter 发送")));
    this.statusEl.toggleClass("is-error", !!(this.controller.error || this.controller.saveError));
    if (this.controller.error) {
      this.conversationEl.hide(); this.historyEl.hide();
      this.button(this.statusEl, "重新加载", "refresh-cw", () => this.controller.load(), true); return;
    }
    if (!s) return;
    if (s.pendingTask) this.statusEl.setText(Platform.isMobile ? "填写参数后点击「开始任务」" : "填写本次任务参数 · Ctrl/Cmd+Enter 开始");
    this.titleButton.empty(); setIcon(this.titleButton.createSpan(), "messages-square"); this.titleButton.createSpan({ text: s.title }); setIcon(this.titleButton.createSpan(), "chevron-down");
    this.titleButton.setAttribute("aria-expanded", String(this.historyOpen));
    this.historyEl.toggle(this.historyOpen); this.conversationEl.toggle(!this.historyOpen);
    if (this.activeId !== s.id) { this.activeId = s.id; this.input.value = s.draft; this.renderedMessages = ""; }
    else if (this.contentEl.ownerDocument.activeElement !== this.input && this.input.value !== s.draft) this.input.value = s.draft;
    const busy = this.controller.isRunning(s.id);
    this.contentEl.classList.toggle("istart-agent-task-active", !!s.pendingTask);
    const taskKey = s.pendingTask ? `${s.id}/${s.pendingTask.actionId}` : "";
    if (taskKey !== this.renderedTask) {
      this.renderedTask = taskKey;
      this.taskEl.empty();
      if (s.pendingTask) renderAgentTaskForm(this.taskEl, s.pendingTask,
        (key, value) => this.perform(() => this.controller.updateTaskArgs(s.id, key, value)),
        () => this.controller.cancelTask(s.id));
    }
    this.taskEl.toggle(!!s.pendingTask);
    this.input.toggle(!s.pendingTask);
    this.modelEl.setText(this.plugin.settings.model);
    this.updateSendState();
    this.resizeInput();
    if (s.archived) this.statusEl.setText("会话已归档，可在会话操作中恢复后继续");
    const openStory = this.controller.openStory(s.id);
    this.optionsSummary.setText(`${s.mode === "story" ? "小说演绎" : s.mode === "ask" ? "问答" : "Agent"} · 模式与检索设置`);
    this.mode.value = s.mode; this.mode.disabled = busy || !!s.pendingTask || !!openStory; this.search.checked = s.searchVault; this.search.disabled = busy || s.mode === "story";
    this.search.parentElement?.toggle(s.mode !== "story");
    this.storySettings.toggle(s.mode === "story"); this.storySettings.disabled = busy || s.archived || !!openStory;
    if (this.mobileMode) {
      this.mobileMode.empty();
      this.mobileMode.createSpan({ text: s.mode === "story" ? "小说演绎" : s.mode === "ask" ? "问答" : "Agent" });
      setIcon(this.mobileMode.createSpan(), "chevron-down");
    }
    if (this.mobileSearch) {
      this.mobileSearch.disabled = this.search.disabled;
      this.mobileSearch.setAttribute("aria-pressed", String(s.searchVault));
      this.mobileSearch.toggle(s.mode !== "story");
    }
    this.input.placeholder = openStory ? "输入导演指令，在下一次回应前生效…" : s.mode === "story" ? "描述场景、冲突和本场目标，让角色开始演绎…" : Platform.isMobile ? "描述任务，@ 引用笔记…" : "描述任务，或输入 @ 引用笔记…";
    this.sendButton.empty(); setIcon(this.sendButton.createSpan(), busy && !openStory ? "square" : "arrow-up"); this.sendButton.setAttribute("aria-label", openStory ? "发送导演指令" : busy ? "停止生成" : s.pendingTask ? "开始任务" : "发送");
    const sendLabel = openStory ? "发送指令" : busy ? "停止" : s.pendingTask ? "开始任务" : "发送";
    this.sendButton.createSpan({ text: sendLabel, cls: "istart-agent-send-label" });
    this.sendButton.title = sendLabel;
    this.contextEl.empty();
    if (Platform.isMobile) {
      const first = s.references[0];
      if (first) {
        const name = first.path.split("/").pop()?.replace(/\.md$/i, "") ?? first.path;
        const chip = this.button(this.contextEl, `${name}${first.selection ? " · 选区" : first.cursor ? " · 位置" : ""}`, first.selection ? "text-select" : "file-text", event => this.referenceMenu(event), true);
        chip.addClass("istart-agent-context-chip"); chip.title = first.path;
        chip.setAttribute("aria-label", `管理引用：${first.path}${first.selection ? " · 选区" : ""}`);
        if (s.references.length > 1) {
          const more = this.button(this.contextEl, `+${s.references.length - 1}`, "", event => this.referenceMenu(event), true);
          more.setAttribute("aria-label", `查看全部 ${s.references.length} 篇引用笔记`);
        }
      }
      const add = this.button(this.contextEl, "引用笔记", "at-sign", () => this.pickNote(), true);
      add.addClass("istart-agent-add-reference");
    } else for (const ref of s.references) {
      const chip = this.contextEl.createDiv({ cls: "istart-agent-context-chip" });
      const position = ref.cursor ? ref.cursor.content.slice(0, ref.cursor.offset).split("\n") : null;
      const location = position ? ` · 第 ${position.length} 行，第 ${position[position.length - 1].length + 1} 列` : "";
      this.button(chip, `${ref.path}${ref.selection ? " · 选区" : location}`, ref.selection ? "text-select" : "file-text", () => this.openSource(ref.path), true);
      const remove = this.button(chip, `移除引用 ${ref.path}`, "x", () => this.controller.detach(ref.path)); remove.disabled = busy || !!openStory;
    }
    if (!Platform.isMobile && !s.references.length) this.contextEl.createSpan({ cls: "istart-agent-muted", text: "未引用笔记 · @ 添加上下文" });
    if (s.mode === "story") this.contextEl.createDiv({ cls: "istart-agent-story-hint", text: `请将小说章节放在首个引用 · ${s.storyConfig?.characterPaths.length ? `${s.storyConfig.characterPaths.length}名角色` : "自动选择角色"} · 每次最多推进${s.storyConfig?.maxTurns ?? 6}次 · 剧情确认后推演角色变化` });
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
  private async copy(text: string): Promise<void> {
    const clipboard = this.contentEl.ownerDocument.defaultView?.navigator.clipboard;
    if (!clipboard) throw new Error("剪贴板不可用，请选中文字后复制");
    await clipboard.writeText(text);
    new Notice("已复制");
  }
  private sessionMenu(event: MouseEvent, s = this.controller.active): void {
    if (!s) return; const menu = new Menu();
    menu.addItem(i => i.setTitle("重命名").setIcon("pencil").onClick(() => this.textModal("重命名会话", s.title, title => this.controller.update(s.id, { title: title.trim() || "新会话" }))));
    menu.addItem(i => i.setTitle(s.pinned ? "取消置顶" : "置顶会话").setIcon("pin").onClick(() => this.controller.update(s.id, { pinned: !s.pinned })));
    menu.addItem(i => i.setTitle("创建会话分支").setIcon("git-branch").onClick(() => this.perform(() => this.controller.fork(s.id))));
    menu.addItem(i => i.setTitle("复制整个会话").setIcon("copy").onClick(() => this.perform(() => this.copy(conversationText(s)))));
    menu.addItem(i => i.setTitle("导出 Markdown").setIcon("download").onClick(() => this.perform(() => this.controller.export(s))));
    menu.addItem(i => i.setTitle(s.archived ? "恢复会话" : "归档会话").setIcon("archive").onClick(() => this.perform(() => this.controller.archive(s.id))));
    menu.addSeparator();
    menu.addItem(i => i.setTitle("删除会话").setIcon("trash-2").onClick(() => new AgentConfirmModal(this.plugin, "删除会话", `删除「${s.title}」及其消息记录？已保存的笔记会保留。`, () => this.perform(() => this.controller.remove(s.id))).open()));
    menu.showAtMouseEvent(event);
  }
  private renderMessages(s: AgentSession): void {
    const selected = this.contentEl.ownerDocument.getSelection();
    const atLiveBottom = this.messagesEl.scrollHeight - this.messagesEl.clientHeight - this.messagesEl.scrollTop < 90;
    const previousHeight = this.messagesEl.scrollHeight;
    for (const message of s.messages) if (isLiveStory(message.story)) this.storyViews.get(message.id)?.patch(message);
    if (atLiveBottom && (!selected || selected.isCollapsed) && this.messagesEl.scrollHeight !== previousHeight) this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    // Streaming must not destroy a selection that the user is copying.
    if (this.renderedMessages && selected && !selected.isCollapsed && selected.anchorNode && this.messagesEl.contains(selected.anchorNode)) return;
    // Full source/checkpoint snapshots are durable data, not a rendering dependency.
    const signature = JSON.stringify([s.mode, s.pendingTask?.actionId, s.summary, s.messages.map(m => ({
      id: m.id, role: m.role, content: isLiveStory(m.story) ? undefined : m.content, status: isLiveStory(m.story) ? undefined : m.status, error: isLiveStory(m.story) ? undefined : m.error, skills: m.skills, sources: m.sources, steps: isLiveStory(m.story) ? undefined : m.steps,
      resumable: !!m.checkpoint, references: m.references?.map(ref => ({ path: ref.path, selection: ref.selection?.text })),
      proposals: m.proposals?.map(p => ({ id: p.id, title: p.title, status: p.status, files: p.changes.map(c => [c.path, c.before?.length, c.after.length]) })),
      proofreading: !!m.proofreading,
      story: isLiveStory(m.story) ? 2 : m.story && { turns: m.story.turns, confirmedAt: m.story.confirmedAt, evolution: m.story.evolution },
    })), this.controller.openStory(s.id) ? undefined : this.controller.isRunning(s.id), this.controller.isApplying]);
    if (signature === this.renderedMessages) return; this.renderedMessages = signature;
    const scrollTop = this.messagesEl.scrollTop;
    const atBottom = this.messagesEl.scrollHeight - this.messagesEl.clientHeight - scrollTop < 90;
    if (this.markdown) this.removeChild(this.markdown);
    this.markdown = new Component(); this.addChild(this.markdown);
    this.messagesEl.empty();
    this.storyViews.clear();
    if (s.summary) { const details = this.details(this.messagesEl, `summary-${s.id}`, "较早对话已整理为摘要"); details.createEl("p", { text: s.summary.content }); }
    if (!s.messages.length) {
      if (s.pendingTask) {
        const empty = this.messagesEl.createDiv({ cls: "istart-agent-empty" });
        empty.createEl("h3", { text: "补充任务参数" });
        empty.createEl("p", { text: "在下方填写本次任务参数，点击「开始任务」。结果会保留在此会话，可继续追问和调整；文件修改先预览再应用。" });
        return;
      }
      const empty = this.messagesEl.createDiv({ cls: "istart-agent-empty" });
      if (Platform.isMobile) setIcon(empty.createDiv({ cls: "istart-agent-welcome-icon" }), "sparkles");
      empty.createEl("h3", { text: s.mode === "story" ? "让角色推动故事" : Platform.isMobile && s.references.length ? "从这篇笔记开始" : "从一个问题开始" });
      empty.createEl("p", { text: s.mode === "story" ? "引用小说章节，选择参演角色，描述场景。完整对白与场景叙述实时交错展开；确认剧情后生成有依据的角色卡更新预览。" : "围绕笔记提问，或让 Agent 帮你完成具体任务。" });
      const prompts = s.mode === "story" ? ["在本章的雨夜重逢场景中，让参演角色围绕一封未寄出的信发生冲突；保留各自的动机，结尾留下一个选择。", "承接已确认剧情，让角色就刚才的决定展开对话，表现信任关系的微妙变化。"] : Platform.isMobile ? ["续写当前章节，保持原有文风", "根据选区草拟一条阅读批注", "总结引用笔记，并指出值得继续研究的问题"] : ["总结引用笔记，并指出值得继续研究的问题", "基于引用笔记和知识库生成一份可执行的检查表", "续写当前章节，保持原有文风", "根据选区草拟一条阅读批注"];
      for (const prompt of prompts) this.button(empty, prompt, "arrow-up-right", () => { this.input.value = prompt; this.resizeInput(); this.input.focus(); this.controller.update(s.id, { draft: prompt }); }, true);
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
    if (isLiveStory(message.story)) {
      const scene = new StorySceneView(row, s, message, this.controller, {
        perform: action => this.perform(action), copy: text => { void this.copy(text); },
        confirm: () => {
          const current = this.controller.sessions.find(session => session.id === s.id)?.messages.find(m => m.id === message.id);
          if (!current || !isLiveStory(current.story)) return;
          new StoryBlocksConfirmModal(this.plugin, current.story, blocks => this.perform(() => this.controller.confirmStory(s.id, message.id, blocks))).open();
        },
      });
      this.storyViews.set(message.id, scene);
      // The same manuscript projection feeds the existing copy/export/save proposal paths.
      for (const proposal of message.proposals ?? []) this.renderProposal(row, s, proposal);
      const actions = row.createDiv({ cls: "istart-agent-message-actions" });
      this.button(actions, "保存或写入回答", "file-output", event => {
        const current = this.controller.sessions.find(session => session.id === s.id)?.messages.find(m => m.id === message.id);
        if (!current) return;
        const menu = new Menu();
        menu.addItem(i => i.setTitle("保存为新笔记").onClick(() => this.textModal("保存为新笔记", s.title, title => this.controller.offerAnswer(s, current, "save", title))));
        menu.addItem(i => i.setTitle("追加到本轮引用笔记").onClick(() => this.perform(() => this.controller.offerAnswer(s, current, "append"))));
        menu.addItem(i => i.setTitle("插入到已设置位置").onClick(() => this.perform(() => this.controller.offerAnswer(s, current, "insert-target"))));
        menu.showAtMouseEvent(event);
      });
      this.button(actions, "从此处分支", "git-branch", () => this.controller.fork(s.id, message.id));
      return;
    }
    row.createDiv({ cls: "istart-agent-message-author", text: message.role === "user" ? "我" : "IStart" });
    if (message.role === "user") {
      row.createDiv({ cls: "istart-agent-user-text", text: message.content });
      if (message.references?.length) { const context = this.details(row, `refs-${message.id}`, `本轮引用 ${message.references.length} 篇笔记`); for (const ref of message.references) { this.button(context, ref.path, "file-text", () => this.openSource(ref.path), true); if (ref.selection) context.createEl("blockquote", { text: ref.selection.text }); } }
      this.button(row, "复制消息", "copy", () => this.copy(message.content), true);
      this.button(row, "复制消息及引用", "clipboard-copy", () => this.copy(messageText(message)));
      return;
    }
    if (message.skills?.length) row.createDiv({ cls: "istart-agent-skills", text: `技能：${message.skills.join(" · ")}` });
    if (message.story) this.renderStory(row, s, message);
    if (message.steps?.length) {
      const steps = this.details(row, `steps-${message.id}`, `${message.status === "running" ? "正在执行" : "执行记录"} · ${message.steps.length} 步`);
      for (const step of message.steps) {
        const item = steps.createDiv({ cls: `istart-agent-step is-${step.status}` }); setIcon(item.createSpan(), step.status === "completed" ? "check" : step.status === "error" ? "circle-alert" : "loader"); item.createSpan({ text: step.label });
        if (step.detail) { const detail = this.details(item, step.id, "查看结果"); detail.createEl("pre", { text: step.detail }); this.button(detail, "复制执行结果", "copy", () => this.copy(step.detail!), true); }
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
    if (message.proofreading) this.button(row, "查看校对定位", "spell-check", () => this.plugin.showProofreading(message.proofreading!), true);
    const actions = row.createDiv({ cls: "istart-agent-message-actions" });
    this.button(actions, "复制完整消息", "clipboard-copy", () => this.copy(messageText(message)));
    if (message.content) {
      this.button(actions, "复制回答", "copy", () => this.copy(message.content));
      this.button(actions, "保存或写入回答", "file-output", event => {
        const menu = new Menu();
        menu.addItem(i => i.setTitle("保存为新笔记").onClick(() => this.textModal("保存为新笔记", s.title, title => this.controller.offerAnswer(s, message, "save", title))));
        menu.addItem(i => i.setTitle("追加到本轮引用笔记").onClick(() => this.perform(() => this.controller.offerAnswer(s, message, "append"))));
        menu.addItem(i => i.setTitle("插入本轮原光标位置").onClick(() => this.perform(() => this.controller.offerAnswer(s, message, "insert"))));
        menu.addItem(i => i.setTitle("插入到已设置位置").onClick(() => this.perform(() => this.controller.offerAnswer(s, message, "insert-target"))));
        menu.showAtMouseEvent(event);
      });
    }
    if (!this.controller.isRunning(s.id)) {
      if (this.controller.canResume(s, message)) this.button(actions, "继续任务", "play", () => this.controller.resume(s.id, message.id), true);
      if (s.messages[s.messages.length - 1]?.id === message.id && message.story?.confirmedAt === undefined) this.button(actions, "重新生成", "refresh-cw", () => this.controller.retry(s.id, message.id));
      this.button(actions, "从此处分支", "git-branch", () => this.controller.fork(s.id, message.id));
    }
  }
  private renderStory(parent: HTMLElement, s: AgentSession, message: AgentMessage): void {
    const story = message.story!;
    const box = parent.createDiv({ cls: "istart-agent-story" });
    box.createDiv({ cls: "istart-agent-muted", text: story.confirmedAt !== undefined ? "已确认剧情 · 将用于后续演绎" : message.status === "completed" ? "剧情草稿 · 确认后才能用于角色进化" : "演绎进行中或未完成 · 尚未确认" });
    if (story.turns.length) {
      const cast = this.details(box, `story-${message.id}`, `分角色演绎 · ${story.turns.length}条记录`);
      for (const turn of story.turns) { cast.createEl("strong", { text: `第${turn.round}轮 · ${turn.name}` }); cast.createEl("pre", { text: turn.content }); this.button(cast, "复制角色发言", "copy", () => this.copy(turn.content), true); }
    }
    const busy = this.controller.isRunning(s.id) || this.controller.isApplying || s.archived || s.mode !== "story";
    if (story.confirmedAt === undefined && message.status === "completed" && s.messages[s.messages.length - 1] === message) {
      const confirm = this.button(box, "确认剧情并推演角色", "check-check", () => new StoryConfirmModal(this.plugin, message.content, content => this.perform(() => this.controller.confirmStory(s.id, message.id, content))).open(), true);
      confirm.disabled = busy;
    }
    if (story.evolution) {
      const evolution = this.details(box, `evolution-${message.id}`, story.evolution.status === "running" ? "正在推演角色变化…" : "角色变化与剧情依据");
      if (story.evolution.content) void MarkdownRenderer.render(this.app, story.evolution.content, evolution, story.chapterPath, this.markdown!).catch(() => evolution.createEl("pre", { text: story.evolution!.content }));
      if (story.evolution.error) evolution.createDiv({ cls: "istart-agent-error", text: story.evolution.error });
      this.button(evolution, "复制角色推演", "copy", () => this.copy([story.evolution!.content, story.evolution!.error].filter(Boolean).join("\n\n")), true);
    }
    if (story.confirmedAt !== undefined && story.evolution?.status !== "completed" && story.evolution?.status !== "running") {
      const retry = this.button(box, "重试角色推演", "refresh-cw", () => this.controller.confirmStory(s.id, message.id), true); retry.disabled = busy;
    }
  }
  private renderProposal(parent: HTMLElement, s: AgentSession, p: ChangeProposal): void {
    const box = parent.createDiv({ cls: "istart-agent-proposal" });
    box.createDiv({ cls: "istart-agent-proposal-title", text: p.title });
    box.createDiv({ cls: "istart-agent-muted", text: `${p.changes.length} 个文件 · ${({ pending: "待应用", applying: "正在应用", applied: "已应用", rejected: "已放弃", superseded: "已由后续草稿替代" })[p.status]}` });
    const preview = this.details(box, p.id, "查看修改");
    for (const c of p.changes) {
      preview.createDiv({ cls: "istart-agent-change-path", text: c.path });
      const copies = preview.createDiv({ cls: "istart-agent-message-actions" });
      this.button(copies, "复制修改后全文", "copy", () => this.copy(c.after), true);
      this.button(copies, "复制原文", "copy", () => this.copy(c.before ?? ""), true);
      const range = changedRange(c.before ?? "", c.after);
      const before = c.before?.slice(range.start, range.end);
      if (before) preview.createEl("pre", { cls: "istart-agent-diff-before", text: `− ${before}` });
      preview.createEl("pre", { cls: "istart-agent-diff-after", text: `+ ${range.text}` });
      this.button(copies, "复制新增或替换内容", "copy-plus", () => this.copy(range.text), true);
    }
    if (p.status === "pending") {
      const actions = box.createDiv({ cls: "istart-agent-proposal-actions" });
      const apply = this.button(actions, "应用修改", "check", () => this.controller.apply(p, s), true); apply.addClass("mod-cta"); apply.disabled = this.controller.isRunning(s.id) || this.controller.isApplying;
      const reject = this.button(actions, "放弃", "x", () => this.controller.reject(p, s), true); reject.disabled = this.controller.isRunning(s.id) || this.controller.isApplying;
    }
  }
  private send(): void {
    const s = this.controller.active; if (!s) return;
    if (this.controller.openStory(s.id)) {
      const text = this.input.value; if (!text.trim()) return;
      this.input.value = ""; this.perform(() => this.controller.send(s.id, text)); return;
    }
    if (this.controller.isRunning(s.id)) { this.controller.stop(s.id); return; }
    if (s.pendingTask) { this.perform(() => this.controller.submitTask(s.id)); return; }
    const text = this.input.value; if (!text.trim()) return;
    this.perform(async () => { const task = this.controller.send(s.id, text); if (this.controller.isRunning(s.id)) this.input.value = ""; await task; });
  }
  private pickNote(): void {
    const items = this.app.vault.getMarkdownFiles().filter(f => !this.plugin.skillRegistry.isSkillPath(f.path) && !f.path.split("/").some(p => p.startsWith(".")));
    const choose = (file: TFile) => { this.perform(() => this.controller.attach({ path: file.path })); this.input.focus(); };
    new class extends FuzzySuggestModal<TFile> {
      getItems(): TFile[] { return items; }
      getItemText(file: TFile): string { return file.path; }
      onChooseItem(file: TFile): void { choose(file); }
    }(this.app).open();
  }
  private async openSource(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path); if (!(file instanceof TFile)) throw new Error("来源文件已被移动或删除");
    const leaf = this.app.workspace.getLeavesOfType("markdown").find(l => l.view instanceof MarkdownView && l.view.file === file) ?? this.app.workspace.getLeaf("tab");
    await leaf.openFile(file, { active: true });
  }
  private textModal(title: string, initial: string, callback: (value: string) => unknown): void { new AgentTextModal(this.plugin, title, initial, value => this.perform(() => callback(value))).open(); }
}
class StorySettingsModal extends ActionModal {
  constructor(plugin: DeepSeekPlugin, private characters: { path: string; name: string }[], private config: StoryConfig | undefined, private submit: (config: StoryConfig) => void) { super(plugin.app); this.titleEl.setText("小说参演设置"); }
  onOpen(): void {
    super.onOpen();
    this.bodyEl.createEl("p", { text: "选择1–4名角色。角色自然接话，对白与场景叙述实时交错展开。达到连续推进上限后暂停，完整台词会保留。" });
    const selected = new Set((this.config?.characterPaths.length ? this.config.characterPaths : this.characters.length <= 4 ? this.characters.map(c => c.path) : []).filter(path => this.characters.some(c => c.path === path)));
    const error = this.bodyEl.createDiv({ cls: "istart-agent-error", attr: { role: "alert" } });
    for (const character of this.characters) new Setting(this.bodyEl).setName(character.name).setDesc(character.path).addToggle(t => t.setValue(selected.has(character.path)).onChange(value => { if (value) selected.add(character.path); else selected.delete(character.path); }));
    let maxTurns = this.config?.maxTurns ?? 6;
    let openingTarget = this.config?.openingTarget ?? "auto";
    new Setting(this.bodyEl).setName("开场方式").addDropdown(d => {
      d.addOption("auto", "根据场景自然开场").addOption("scene", "先展开场景");
      for (const character of this.characters) d.addOption(character.path, `由${character.name}先回应`);
      d.setValue(openingTarget).onChange(value => { openingTarget = value; });
    });
    new Setting(this.bodyEl).setName("每次连续推进上限").addDropdown(d => d.addOption("2", "2次").addOption("4", "4次").addOption("6", "6次").addOption("10", "10次").addOption("20", "20次").setValue(String(maxTurns)).onChange(value => { maxTurns = Number(value); }));
    new Setting(this.actionsEl).addButton(b => b.setButtonText("保存").setCta().onClick(() => {
      if (!selected.size || selected.size > 4) { error.setText("请选择1–4名角色"); return; }
      if (openingTarget !== "auto" && openingTarget !== "scene" && !selected.has(openingTarget)) { error.setText("请将开场角色加入参演列表"); return; }
      this.submit({ rounds: this.config?.rounds ?? 1, maxTurns, openingTarget, characterPaths: this.characters.filter(c => selected.has(c.path)).map(c => c.path) }); this.close();
    })).addButton(b => b.setButtonText("取消").onClick(() => this.close()));
  }
}
class StoryBlocksConfirmModal extends ActionModal {
  private revision: StoryBlock[];
  constructor(plugin: DeepSeekPlugin, private scene: LiveStoryScene, private submit: (blocks: StoryBlock[]) => void) {
    super(plugin.app); this.titleEl.setText("确认本场剧情"); this.revision = cloneJson(scene.blocks.filter(b => !b.omitted && b.status === "completed"));
  }
  onOpen(): void {
    super.onOpen();
    this.bodyEl.createEl("p", { text: "逐段修订或取消纳入剧情。对白角色、叙述类型和私有心理的可见范围保持固定，原始演绎记录会保留。" });
    const error = this.bodyEl.createDiv({ cls: "istart-agent-error", attr: { role: "alert" } });
    for (const block of this.revision) {
      const section = this.bodyEl.createDiv({ cls: "istart-story-revision" });
      const title = block.kind === "dialogue" ? `${storyName(this.scene, block.characterPath!)} · 对白` : block.visibility === "private" ? `${storyName(this.scene, block.ownerPath!)} · 私有心理描写` : "场景／动作叙述";
      const textarea = section.createEl("textarea", { cls: "istart-agent-story-editor", attr: { "aria-label": title, rows: "3" } }); textarea.value = block.text;
      textarea.addEventListener("input", () => { block.text = textarea.value; });
      new Setting(section).setName(title).addToggle(t => t.setValue(true).onChange(value => { block.omitted = !value; textarea.disabled = !value; }));
    }
    new Setting(this.actionsEl).addButton(b => b.setButtonText("确认剧情并推演角色").setCta().onClick(() => {
      const kept = this.revision.filter(block => !block.omitted);
      if (!kept.length || kept.some(block => !block.text.trim()) || kept.reduce((sum, block) => sum + block.text.length, 0) > 200000) { error.setText("请保留有效的正文段落，并将长篇剧情分场确认"); return; }
      this.submit(this.revision); this.close();
    })).addButton(b => b.setButtonText("取消").onClick(() => this.close()));
  }
}
class StoryConfirmModal extends ActionModal {
  constructor(plugin: DeepSeekPlugin, private content: string, private submit: (content: string) => void) { super(plugin.app); this.titleEl.setText("确认本场剧情"); }
  onOpen(): void {
    super.onOpen(); this.bodyEl.createEl("p", { text: "可先修订正文。确认后，这份剧情会作为后续演绎和角色变化的依据；角色卡更新仍需检查预览并应用。正文可通过消息的保存或写入操作另存到章节。" });
    const input = this.bodyEl.createEl("textarea", { cls: "istart-agent-story-editor", attr: { "aria-label": "确认的场景正文" } }); input.value = this.content;
    const error = this.bodyEl.createDiv({ cls: "istart-agent-error", attr: { role: "alert" } });
    new Setting(this.actionsEl).addButton(b => b.setButtonText("确认剧情并推演角色").setCta().onClick(() => {
      if (!input.value.trim() || input.value.length > 24000) { error.setText("请输入1–24,000字符的正文"); return; }
      this.submit(input.value.trim()); this.close();
    })).addButton(b => b.setButtonText("取消").onClick(() => this.close()));
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
  onOpen(): void { super.onOpen(); this.bodyEl.createEl("p", { text: this.message }); new Setting(this.actionsEl).addButton(b => destructiveButton(b.setButtonText("删除")).onClick(() => { this.confirm(); this.close(); })).addButton(b => b.setButtonText("取消").onClick(() => this.close())); }
}
