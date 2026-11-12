import { App, Notice, TFile, MarkdownView } from "obsidian";
import type DeepSeekPlugin from "../../main";
import { SessionStore, parseSessionData } from "../../core/agent/SessionStore";
import { AgentRunner } from "../../core/agent/AgentRunner";
import { StoryRunner } from "../../core/agent/StoryRunner";
import { AgentTools } from "../../core/agent/AgentTools";
import { LLMClient } from "../../core/llm";
import { abortable } from "../../core/llm/LLMClient";
import { selectSkills } from "../../core/skills/SkillSelector";
import { resolveWritingScope } from "../../core/skills/WritingScope";
import { applyChanges, changedRange, noteName } from "../../core/agent/Changes";
import { WritingProjectManager } from "../writing/WritingProjectManager";
import { readNote, snapshotReference, writeChange, ensureNoteFolder } from "../../core/agent/Context";
import { AgentSession, AgentMessage, AgentRunContext, ChangeProposal, NoteReference, NoteSnapshot, StoryConfig, AgentTask, newSession, agentId } from "../../core/agent/types";
import { AGENT_TASKS, validateTaskFields, taskDescription } from "../../core/agent/AgentTasks";

export const SYNC_HISTORY_PATH = "IStart/Agent Sessions/history.json";
export class AgentController {
  readonly store: SessionStore;
  error = "";
  saveError = "";
  private listeners = new Set<() => void>();
  private running = new Map<string, AbortController>();
  private pending = new Set<Promise<void>>();
  private applying = false;
  private disposed = false;
  private lastReference: NoteReference | null = null;
  private syncQueue: Promise<unknown> = Promise.resolve();
  private saveTimer: number | undefined;
  constructor(private plugin: DeepSeekPlugin, private app: App = plugin.app) {
    this.store = new SessionStore(app.vault.adapter, `${plugin.manifest.dir ?? `${app.vault.configDir}/plugins/${plugin.manifest.id}`}/agent`);
  }
  async load(): Promise<void> {
    try {
      await this.store.load();
      await this.pullSharedHistory();
      if (!this.store.data.sessions.some(s => !s.archived)) this.store.data.sessions.push(newSession());
      if (!this.store.data.sessions.some(s => s.id === this.store.data.activeId && !s.archived)) this.store.data.activeId = this.store.data.sessions.find(s => !s.archived)!.id;
      this.error = "";
      await this.store.save();
    } catch (error) { this.error = error instanceof Error ? error.message : "无法加载会话"; }
    this.emit();
  }
  get sessions(): AgentSession[] { return this.store.data.sessions; }
  get active(): AgentSession | undefined { return this.sessions.find(s => s.id === this.store.data.activeId); }
  refreshSettings(): void { this.emit(); }
  trackView(view: MarkdownView): void {
    this.lastReference = this.referenceFromView(view);
  }
  rememberEditor(editor: import("obsidian").Editor, file: TFile): void {
    const content = editor.getValue();
    const start = editor.posToOffset(editor.getCursor("from")), end = editor.posToOffset(editor.getCursor("to"));
    this.lastReference = { path: file.path, cursor: { offset: editor.posToOffset(editor.getCursor()), content },
      ...(start !== end ? { selection: { start, end, text: content.slice(start, end), content } } : {}) };
  }
  private referenceFromView(view: MarkdownView): NoteReference | null {
    if (!view.file) return null;
    if (view.getMode() !== "source") return { path: view.file.path };
    this.rememberEditor(view.editor, view.file);
    return this.lastReference;
  }
  captureCurrent(): NoteReference | null {
    const foreground = this.app.workspace.getActiveViewOfType(MarkdownView);
    const reference = foreground ? this.referenceFromView(foreground) : this.lastReference;
    return reference ? JSON.parse(JSON.stringify(reference)) : null;
  }
  /** An Agent action uses its conversation's primary target after focus leaves the editor. */
  captureTaskReference(): NoteReference | null {
    if (this.app.workspace.getActiveViewOfType(MarkdownView)) return this.captureCurrent();
    const reference = this.active?.references[0];
    return reference ? JSON.parse(JSON.stringify(reference)) : this.captureCurrent();
  }
  setInsertionReference(id: string, reference: NoteReference): void {
    const s = this.sessions.find(s => s.id === id);
    if (!s || s.archived) throw new Error("会话不可用");
    if (this.isRunning(id)) throw new Error("请在生成结束后调整插入位置");
    if (s.references.length >= 8 && !s.references.some(r => r.path === reference.path)) throw new Error("每个会话最多引用8篇笔记，请先移除一个引用");
    if (!reference.cursor || !Number.isInteger(reference.cursor.offset) || reference.cursor.offset < 0 || reference.cursor.offset > reference.cursor.content.length) throw new Error("插入位置无效");
    const captured = JSON.parse(JSON.stringify(reference)) as NoteReference;
    delete captured.selection;
    s.references = [captured, ...s.references.filter(r => r.path !== captured.path)];
    this.touch(s);
  }
  get isApplying(): boolean { return this.applying; }
  isRunning(id: string): boolean { return this.running.has(id); }
  subscribe(callback: () => void): () => void { this.listeners.add(callback); return () => this.listeners.delete(callback); }
  private emit(): void { if (!this.disposed) for (const listener of this.listeners) listener(); }
  private ready(): void { if (this.error) throw new Error(this.error); if (this.disposed) throw new Error("助手已关闭"); }
  async persist(): Promise<void> {
    try { await this.store.save(); this.saveError = ""; }
    catch (error) { this.saveError = `会话保存失败：${error instanceof Error ? error.message : String(error)}`; this.emit(); throw error; }
  }
  private saveSoon(): void {
    if (this.disposed) return;
    if (this.saveTimer !== undefined) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => { this.saveTimer = undefined; void this.persist().catch(() => {}); }, 250);
  }
  private touch(session: AgentSession): void { session.updatedAt = Date.now(); this.emit(); this.saveSoon(); }
  select(id: string): void {
    this.ready(); const session = this.sessions.find(s => s.id === id); if (!session) return;
    this.store.data.activeId = id; this.emit(); this.saveSoon();
  }
  create(references: NoteReference[] = []): AgentSession {
    this.ready(); const session = newSession(references);
    this.sessions.push(session); this.store.data.activeId = session.id; this.touch(session); return session;
  }
  update(id: string, change: Partial<Pick<AgentSession, "title" | "draft" | "mode" | "searchVault" | "pinned">>): void {
    const s = this.sessions.find(s => s.id === id); if (!s) return;
    if (this.isRunning(id) && (change.mode !== undefined || change.searchVault !== undefined)) throw new Error("请在本轮生成结束后修改执行模式和检索范围");
    Object.assign(s, change); this.touch(s);
  }
  updateDraft(id: string, draft: string): void { const s = this.sessions.find(s => s.id === id); if (s) { s.draft = draft; s.updatedAt = Date.now(); this.saveSoon(); } }
  prepareTask(task: AgentTask, references: NoteReference[]): AgentSession {
    this.ready();
    // A button starts an isolated task; preserve any existing draft or running conversation.
    const current = this.active;
    const s = current && !current.archived && !current.messages.length && !current.draft && !current.pendingTask && !this.isRunning(current.id) ? current : this.create();
    s.references = JSON.parse(JSON.stringify(references));
    s.mode = task.mode;
    s.pendingTask = JSON.parse(JSON.stringify(task));
    s.title = AGENT_TASKS[task.actionId].label;
    this.touch(s);
    return s;
  }
  updateTaskArgs(id: string, key: string, value: string | number | boolean): void {
    const s = this.sessions.find(s => s.id === id), task = s?.pendingTask;
    if (!s || !task || this.isRunning(id)) return;
    if (!AGENT_TASKS[task.actionId].fields.some(field => field.key === key)) throw new Error("不支持的任务参数");
    task.args[key] = value;
    this.touch(s);
  }
  cancelTask(id: string): void {
    const s = this.sessions.find(s => s.id === id);
    if (s && !this.isRunning(id)) { delete s.pendingTask; this.touch(s); }
  }
  submitTask(id: string): Promise<void> {
    const s = this.sessions.find(s => s.id === id), task = s?.pendingTask;
    if (!s || !task) return Promise.reject(new Error("没有待执行的助手任务"));
    validateTaskFields(task);
    if (this.isRunning(id)) throw new Error("本会话正在生成，请等待或停止后重试");
    s.mode = task.mode;
    return this.track(this.runTurn(id, taskDescription(task), undefined, JSON.parse(JSON.stringify(task))));
  }
  /** Native wizards call a recorded task and consume its result, without a second LLM workflow. */
  async executeTask(task: AgentTask, sessionId?: string, signal?: AbortSignal): Promise<{ sessionId: string; message: AgentMessage }> {
    this.ready();
    if (signal?.aborted) throw new Error("任务已停止");
    validateTaskFields(task);
    let session = sessionId ? this.sessions.find(s => s.id === sessionId) : undefined;
    if (sessionId && (!session || session.archived)) throw new Error("导入会话已关闭，请重新打开导入向导");
    if (session && (session.draft || session.pendingTask || this.isRunning(session.id))) throw new Error("导入会话中已有未完成任务，请稍候重试");
    if (!session) session = this.prepareTask(task, []);
    else { session.pendingTask = JSON.parse(JSON.stringify(task)); session.mode = task.mode; this.touch(session); }
    const id = session.id;
    const stop = () => this.stop(id);
    signal?.addEventListener("abort", stop, { once: true });
    try {
      await this.submitTask(id);
      const message = session.messages[session.messages.length - 1];
      if (signal?.aborted || message?.status !== "completed") throw new Error(message?.error || "Agent 任务未完成");
      return { sessionId: id, message };
    } finally { signal?.removeEventListener("abort", stop); }
  }

  updateStoryConfig(id: string, config: StoryConfig): void {
    this.ready(); const s = this.sessions.find(s => s.id === id); if (!s) return;
    if (this.isRunning(id)) throw new Error("请等待本轮结束后修改参演设置");
    if (![1, 2, 3].includes(config.rounds) || config.characterPaths.length > 4 || new Set(config.characterPaths).size !== config.characterPaths.length) throw new Error("请选择1–4名角色，演绎1–3轮");
    s.storyConfig = { rounds: config.rounds, characterPaths: [...config.characterPaths] }; this.touch(s);
  }
  async storyCharacters(id: string): Promise<{ path: string; name: string }[]> {
    this.ready(); const s = this.sessions.find(s => s.id === id);
    const file = s?.references[0] && this.app.vault.getAbstractFileByPath(s.references[0].path);
    if (!(file instanceof TFile)) throw new Error("请先将小说章节作为第一篇引用");
    const scope = await resolveWritingScope(this.app, file);
    if (scope?.genre !== "novel" || file.parent?.path !== scope.projectPath) throw new Error("请引用小说项目内的章节，再设置参演角色");
    return new WritingProjectManager(this.app, this.plugin.settings).getProjectCharacters(file);
  }
  attach(reference: NoteReference, replace = false): void {
    const s = this.active; if (!s) return;
    if (this.isRunning(s.id)) throw new Error("请等待本轮结束后修改引用");
    if (replace) s.references = [];
    const index = s.references.findIndex(r => r.path === reference.path);
    if (index >= 0) s.references[index] = reference;
    else { if (s.references.length >= 8) throw new Error("每个会话最多引用8篇笔记"); s.references.push(reference); }
    this.touch(s);
  }
  detach(path: string): void { const s = this.active; if (!s || this.isRunning(s.id)) return; s.references = s.references.filter(r => r.path !== path); this.touch(s); }
  archive(id: string): void {
    if (this.applying) throw new Error("请等待当前修改应用完成后归档会话");
    const s = this.sessions.find(s => s.id === id); if (!s) return;
    this.stop(id); s.archived = !s.archived;
    if (s.archived && this.active?.id === id) {
      const next = this.sessions.find(x => !x.archived);
      if (next) this.store.data.activeId = next.id; else this.create();
    }
    this.touch(s);
  }
  remove(id: string): void {
    if (this.applying) throw new Error("请等待当前修改应用完成后删除会话");
    this.stop(id);
    this.store.data.sessions = this.sessions.filter(s => s.id !== id);
    this.store.data.deleted = { ...this.store.data.deleted, [id]: Date.now() };
    if (!this.active || this.active.archived) {
      const next = this.sessions.find(s => !s.archived);
      if (next) this.store.data.activeId = next.id; else this.create();
    }
    this.emit(); this.saveSoon();
  }
  fork(sessionId: string, throughId?: string): AgentSession {
    const source = this.sessions.find(s => s.id === sessionId); if (!source) throw new Error("会话不存在");
    const index = throughId ? source.messages.findIndex(m => m.id === throughId) : source.messages.length - 1;
    if (index < 0 && throughId) throw new Error("消息不存在");
    const copy: AgentSession = JSON.parse(JSON.stringify(source));
    const fresh = newSession(copy.references);
    fresh.title = `${source.title} · 分支`; fresh.parentId = source.id; fresh.mode = source.mode; fresh.searchVault = source.searchVault;
    fresh.storyConfig = copy.storyConfig;
    fresh.messages = copy.messages.slice(0, index + 1);
    fresh.summary = copy.summary && fresh.messages.some(m => m.id === copy.summary?.through) ? copy.summary : undefined;
    for (const m of fresh.messages) {
      delete m.checkpoint;
      if (m.status === "running") { m.status = "interrupted"; m.error = "从运行中的会话分支，请继续提问"; }
      if (m.story?.evolution?.status === "running") m.story.evolution = { status: "error", content: "", error: "分支未继承运行中的角色推演，可重试推演" };
      for (const p of m.proposals ?? []) if (p.status === "pending" || p.status === "applying") p.status = "rejected";
    }
    this.sessions.push(fresh); this.store.data.activeId = fresh.id; this.touch(fresh); return fresh;
  }
  stop(id: string): void { this.running.get(id)?.abort(); }
  send(id: string, text: string): Promise<void> {
    return this.track(this.runTurn(id, text));
  }
  canResume(session: AgentSession, message: AgentMessage): boolean {
    return message.role === "assistant" && !!message.checkpoint && ["cancelled", "error", "interrupted"].includes(message.status ?? "") && session.messages[session.messages.length - 1] === message && !session.archived && !this.isRunning(session.id);
  }
  resume(sessionId: string, messageId: string): Promise<void> {
    const session = this.sessions.find(s => s.id === sessionId);
    const message = session?.messages.find(m => m.id === messageId);
    if (!session || !message || !this.canResume(session, message)) return Promise.reject(new Error("此消息没有可继续的任务断点；较早的任务请重新发起"));
    if (message.checkpoint!.mode !== session.mode || message.checkpoint!.searchVault !== session.searchVault) return Promise.reject(new Error("执行模式或检索范围已改变，请切回原设置后继续任务，或按当前设置重新生成"));
    return this.track(this.runTurn(sessionId, "", message));
  }
  private track(task: Promise<void>): Promise<void> {
    this.pending.add(task);
    void task.then(() => this.pending.delete(task), () => this.pending.delete(task));
    return task;
  }
  private async runTurn(id: string, text: string, resume?: AgentMessage, task?: AgentTask): Promise<void> {
    this.ready(); const s = this.sessions.find(s => s.id === id); if (!s || (!text.trim() && !resume)) return;
    if (text.length > 20000) throw new Error("消息过长，请拆分任务");
    if (s.archived) throw new Error("请先恢复会话");
    if (this.running.has(id)) throw new Error("本会话正在生成，请等待或停止后重试");
    if (this.running.size >= 2) throw new Error("已有两个会话正在生成，请稍候再发送");
    const abort = new AbortController(); this.running.set(id, abort);
    const user: AgentMessage | undefined = resume ? [...s.messages.slice(0, s.messages.indexOf(resume))].reverse().find(m => m.role === "user") : { id: agentId(), role: "user", content: text.trim(), createdAt: Date.now(), task, taskReferences: task ? JSON.parse(JSON.stringify(s.references)) : undefined };
    if (!user) { this.running.delete(id); throw new Error("任务缺少原始用户消息"); }
    if (!resume) {
      s.messages.push(user); s.draft = "";
      if (task) delete s.pendingTask;
      if (s.messages.filter(m => m.role === "user").length === 1) s.title = text.trim().slice(0, 24);
    }
    this.touch(s);
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; abort.abort(); }, 300000);
    try {
      await this.persist();
      const saved = resume?.checkpoint;
      const references = saved ? saved.notes : user.taskReferences ?? JSON.parse(JSON.stringify(s.references)) as NoteReference[];
      const notes = new Map<string, NoteSnapshot>();
      for (const reference of references) {
        if (saved) {
          const snapshot = saved.notes.find(n => n.path === reference.path)!;
          const current = await abortable(readNote(this.app, snapshot.path), abort.signal);
          if (current !== snapshot.content) throw new Error(`任务来源已变化：${snapshot.path}。请基于新原文重新生成，已有草稿仍然保留。`);
          notes.set(snapshot.path, snapshot);
        } else {
          const snapshot = await abortable(snapshotReference(this.app, reference), abort.signal); notes.set(reference.path, snapshot);
        }
      }
      if (abort.signal.aborted) throw new Error("生成已停止");
      if (!saved) user.references = [...notes.values()];
      const primary = saved ? (saved.primaryPath ? notes.get(saved.primaryPath) : undefined) : user.references?.[0];
      const file = primary ? this.app.vault.getAbstractFileByPath(primary.path) : null;
      const scope = saved ? saved.scope : await abortable(resolveWritingScope(this.app, file instanceof TFile ? file : null), abort.signal);
      const contextScope = task?.args.contextScope === "nearby" ? "nearby" : task?.args.contextScope === "full" ? "full" : this.plugin.settings.writingContextScope;
      const writing = saved ? saved.writing : scope && file instanceof TFile ? await abortable(new WritingProjectManager(this.app, this.plugin.settings).loadContext(file, contextScope), abort.signal) : null;
      const skills = selectSkills(await abortable(this.plugin.skillRegistry.ensureLoaded(), abort.signal), { feature: scope ? "writing" : "assistant", userPrompt: user.content, writingScope: scope }, this.plugin.settings.skills);
      const context: AgentRunContext = { sessionId: id, mode: saved?.mode ?? s.mode, notes, primary, scope, writing, searchVault: saved?.searchVault ?? s.searchVault, signal: abort.signal, sources: new Set(saved ? resume?.sources ?? [] : (user.references ?? []).map(n => n.path)) };
      const settings = { ...this.plugin.settings, agent: { ...this.plugin.settings.agent } };
      const client = new LLMClient(settings, { signal: abort.signal, skills, skillContext: { ...scope, useActiveFile: false } });
      const tools = new AgentTools(this.app, settings, this.plugin.knowledgeIndex, client);
      if (context.mode === "story") {
        if (!context.primary || !context.scope || context.writing?.genre !== "novel") throw new Error("小说演绎需要作品角色卡。请将小说项目的章节作为第一篇引用，并在「参演设置」中选择角色。");
        if (s.messages.some(m => m.story?.confirmedAt !== undefined && m.story.projectPath === context.scope!.projectPath && m.story.evolution?.status !== "completed")) throw new Error("已有已确认剧情尚未完成角色推演，请先点击「重试角色推演」");
        const available = await abortable(this.storyCharacters(id), abort.signal);
        const config = s.storyConfig ?? { characterPaths: [], rounds: 1 };
        const paths = config.characterPaths.length ? config.characterPaths : available.map(c => c.path);
        if (!paths.length || paths.length > 4) throw new Error("请在「参演设置」中选择1–4名角色；没有角色卡时，请先提取或创建角色卡。");
        if (paths.some(path => !available.some(c => c.path === path))) throw new Error("参演角色不属于当前小说项目，请重新选择角色");
        this.checkStoryDrafts(s, paths);
        const cast: NoteSnapshot[] = [];
        for (const path of paths) { cast.push(await abortable(snapshotReference(this.app, { path }), abort.signal)); context.sources.add(path); }
        const result = await new StoryRunner(client, settings.agent.contextChars).run(s, context, settings.agent, cast, config, () => {
          s.messages[s.messages.length - 1].skills = skills.map(skill => skill.name); this.emit(); this.saveSoon();
        }, () => this.persist());
        if (timedOut) { result.status = "error"; result.error = "本轮演绎超过5分钟，已停止。请减少参演角色或演绎轮数后重试。"; }
        return;
      }
      let checkpoint = "";
      const result = await new AgentRunner(client, tools.registry).run(s, context, settings.agent, () => {
        const reply = s.messages[s.messages.length - 1]; reply.skills = skills.map(skill => skill.name);
        const next = `${reply.status}/${reply.steps?.map(step => step.status).join(",")}/${reply.proposals?.length}`;
        if (next !== checkpoint) { checkpoint = next; this.saveSoon(); }
        this.emit();
      }, { resume, task: user.task, save: () => this.persist() });
      if (timedOut) { result.status = "error"; result.error = "本轮任务超过5分钟，已停止。可缩小任务范围后重试。"; }
    } catch (error) {
      const failed: AgentMessage = resume ?? { id: agentId(), role: "assistant", content: "", createdAt: Date.now() };
      failed.status = abort.signal.aborted ? "cancelled" : "error"; failed.error = error instanceof Error ? error.message : "生成失败";
      if (!resume) s.messages.push(failed);
    } finally {
      window.clearTimeout(timer); this.running.delete(id); s.updatedAt = Date.now(); this.emit();
      await this.persist(); await this.pushSharedHistory();
    }
  }
  async retry(sessionId: string, messageId: string): Promise<void> {
    const s = this.sessions.find(s => s.id === sessionId); if (!s) return;
    const index = s.messages.findIndex(m => m.id === messageId);
    if (index !== s.messages.length - 1) throw new Error("较早的消息请使用「从此处分支」");
    if (s.messages[index]?.story?.confirmedAt !== undefined) throw new Error("已确认剧情请通过新一轮演绎继续，角色推演失败可单独重试");
    const user = [...s.messages.slice(0, index)].reverse().find(m => m.role === "user");
    if (user?.task) {
      if (this.isRunning(s.id)) throw new Error("本会话正在生成，请等待或停止后重试");
      // Regeneration uses the original task, references and fixed editor positions.
      if (user.taskReferences) s.references = JSON.parse(JSON.stringify(user.taskReferences));
      else if (user.references) s.references = user.references.map(({ content: _content, ...ref }) => ref);
      s.mode = user.task.mode;
      await this.track(this.runTurn(s.id, user.content, undefined, user.task));
    } else if (user) await this.send(s.id, user.content);
  }
  private checkStoryDrafts(session: AgentSession, paths: string[]): void {
    if (session.messages.some(m => m.proposals?.some(p => ["pending", "applying"].includes(p.status) && p.changes.some(c => paths.includes(c.path))))) throw new Error("参演角色还有待处理的修改，请先应用或放弃角色卡更新，再继续演绎或推演");
  }
  confirmStory(sessionId: string, messageId: string, content?: string): Promise<void> {
    return this.track(this.evolveStory(sessionId, messageId, content));
  }
  private async evolveStory(sessionId: string, messageId: string, content?: string): Promise<void> {
    this.ready(); const s = this.sessions.find(s => s.id === sessionId);
    const message = s?.messages.find(m => m.id === messageId), story = message?.story;
    if (!s || !message || !story) throw new Error("演绎场景不存在");
    if (s.archived || s.mode !== "story") throw new Error("请恢复会话并切回小说演绎与进化模式");
    if (this.applying || this.isRunning(s.id)) throw new Error("请等待当前任务完成");
    if (this.running.size >= 2) throw new Error("已有两个会话正在生成，请稍后再试");
    if (story.confirmedAt === undefined && (s.messages[s.messages.length - 1] !== message || message.status !== "completed")) throw new Error("只能确认最新一轮已完成的演绎，较早的剧情请先创建会话分支");
    if (story.evolution?.status === "completed") throw new Error("本场角色推演已完成，请检查角色卡更新预览");
    const scene = story.confirmedAt === undefined ? (content ?? message.content).trim() : message.content;
    if (!scene || scene.length > 24000) throw new Error("请确认1–24,000字符的场景正文");
    this.checkStoryDrafts(s, story.cast.map(c => c.path));
    const abort = new AbortController(); this.running.set(s.id, abort);
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; abort.abort(); }, 300000);
    try {
      // Persist canon before any role analysis. Failed saves must not start a model request.
      const previousContent = message.content;
      const previousConfirmedAt = story.confirmedAt;
      message.content = scene; story.confirmedAt = story.confirmedAt ?? Date.now(); s.updatedAt = Date.now();
      try { await this.persist(); }
      catch (error) { message.content = previousContent; story.confirmedAt = previousConfirmedAt; throw error; }
      story.evolution = { status: "running", content: "" }; message.status = "running"; message.error = undefined; this.emit();
      const cards: NoteSnapshot[] = [];
      for (const card of story.cast) cards.push(await abortable(snapshotReference(this.app, { path: card.path }), abort.signal));
      const scope = { genre: "novel", projectPath: story.projectPath, projectTitle: s.title };
      const skills = selectSkills(await abortable(this.plugin.skillRegistry.ensureLoaded(), abort.signal), { feature: "writing", userPrompt: "根据已确认剧情推演角色变化", writingScope: scope }, this.plugin.settings.skills);
      const client = new LLMClient(this.plugin.settings, { signal: abort.signal, skills, skillContext: { ...scope, useActiveFile: false } });
      const context: AgentRunContext = { sessionId: s.id, mode: "story", notes: new Map(), scope, searchVault: false, signal: abort.signal, sources: new Set(cards.map(c => c.path)) };
      await new StoryRunner(client, this.plugin.settings.agent.contextChars).evolve(message, cards, context, () => this.emit());
      message.status = "completed";
    } catch (error) {
      const detail = timedOut ? "角色推演超过5分钟，请重试" : abort.signal.aborted ? "角色推演已停止，可重试" : error instanceof Error ? error.message : "角色推演失败";
      if (story.confirmedAt !== undefined) story.evolution = { status: "error", content: "", error: detail };
      message.status = story.confirmedAt === undefined ? "completed" : abort.signal.aborted ? "cancelled" : "error"; message.error = detail;
    } finally {
      window.clearTimeout(timer); this.running.delete(s.id); s.updatedAt = Date.now(); this.emit();
      await this.persist(); await this.pushSharedHistory();
    }
  }
  async apply(proposal: ChangeProposal, session: AgentSession): Promise<void> {
    if (this.applying) throw new Error("正在应用另一份修改，请稍候");
    if (this.isRunning(session.id)) throw new Error("请等待本轮生成结束后应用修改");
    this.applying = true;
    this.emit();
    try {
      await applyChanges(proposal, {
        read: path => readNote(this.app, path),
        write: async change => { await this.persist(); await writeChange(this.app, change); },
      });
      // Refresh anchors only for files changed by this proposal; other stale selections still need reattachment.
      for (const ref of session.references) {
        const change = proposal.changes.find(c => c.path === ref.path);
        if (!change) continue;
        const range = changedRange(change.before ?? "", change.after);
        ref.selection = undefined; ref.cursor = { offset: range.start + range.text.length, content: change.after };
      }
      session.updatedAt = Date.now(); await this.persist(); await this.pushSharedHistory();
      new Notice("修改已应用");
    } finally { this.applying = false; this.emit(); }
  }
  reject(proposal: ChangeProposal, session: AgentSession): void {
    if (this.applying || this.isRunning(session.id)) throw new Error("请等待本轮处理结束后放弃修改");
    if (proposal.status === "pending") { proposal.status = "rejected"; this.touch(session); }
  }
  offerAnswer(session: AgentSession, message: AgentMessage, mode: "save" | "append" | "insert" | "insert-target", title = "AI 笔记"): void {
    if (this.isRunning(session.id)) throw new Error("请等待本轮结束");
    let change;
    if (mode === "save") {
      const path = `${this.plugin.settings.savePath}/${noteName(title)}.md`;
      change = { path, before: null, after: `# ${title}\n\n${message.content}\n` };
    } else {
      const index = session.messages.indexOf(message);
      const user = [...session.messages.slice(0, index)].reverse().find(m => m.role === "user");
      const target = session.references[0];
      const note = mode === "insert-target" && target?.cursor ? { ...target, content: target.cursor.content } : mode === "insert-target" ? undefined : user?.references?.[0];
      if (!note) throw new Error(mode === "insert-target" ? "请先点击「设置插入位置」确认目标" : "本轮没有引用目标笔记，请添加引用后重新生成，或设置插入位置后使用「插入到已设置位置」");
      const offset = mode === "append" ? note.content.length : note.cursor?.offset;
      if (offset === undefined) throw new Error("本轮没有固定的光标位置");
      change = { path: note.path, before: note.content, after: note.content.slice(0, offset) + `\n\n${message.content}\n` + note.content.slice(offset) };
    }
    message.proposals = [...(message.proposals ?? []), { id: agentId(), title: mode === "save" ? "保存为新笔记" : mode === "append" ? "追加到引用笔记" : "插入原光标位置", changes: [change], status: "pending" }];
    this.touch(session);
  }
  importResult(content: string, reference?: NoteReference): AgentSession {
    const s = this.create(reference ? [reference] : []);
    s.title = "继续讨论生成结果";
    s.messages.push({ id: agentId(), role: "user", content: "围绕这份生成结果继续讨论。", createdAt: Date.now() }, { id: agentId(), role: "assistant", content, status: "completed", createdAt: Date.now() });
    this.touch(s); return s;
  }
  async export(session: AgentSession): Promise<void> {
    const content = `# ${session.title}\n\n${session.messages.map(m => `## ${m.role === "user" ? "我" : "AI 助手"}\n\n${m.content}${m.error ? `\n\n> ${m.error}` : ""}${m.sources?.length ? `\n\n来源：${m.sources.map(p => `[[${p}]]`).join("、")}` : ""}${m.proposals?.length ? `\n\n${m.proposals.map(p => `### ${p.title} · ${p.status}\n\n${p.changes.map(c => `文件：${c.path}\n\n\`\`\`markdown\n${c.after}\n\`\`\``).join("\n\n")}`).join("\n\n")}` : ""}`).join("\n\n---\n\n")}`;
    let path = `IStart/Conversations/${noteName(session.title)}.md`, index = 2;
    while (this.app.vault.getAbstractFileByPath(path)) path = `IStart/Conversations/${noteName(session.title)}-${index++}.md`;
    await ensureNoteFolder(this.app, path);
    const file = await this.app.vault.create(path, content); await this.app.workspace.getLeaf("tab").openFile(file);
  }
  async pullSharedHistory(): Promise<void> {
    if (!this.plugin.settings.agent.syncHistory || this.running.size || this.applying) return;
    if (await this.app.vault.adapter.exists(SYNC_HISTORY_PATH)) {
      const previous = JSON.stringify(this.store.data);
      this.store.merge(parseSessionData(await this.app.vault.adapter.read(SYNC_HISTORY_PATH)));
      if (!this.active) {
        const next = this.sessions.find(s => !s.archived) ?? newSession();
        if (!this.sessions.includes(next)) this.sessions.push(next);
        this.store.data.activeId = next.id;
      }
      if (JSON.stringify(this.store.data) !== previous) { await this.persist(); this.emit(); }
    }
  }
  async pushSharedHistory(): Promise<void> {
    if (!this.plugin.settings.agent.syncHistory || this.error || this.disposed) return;
    const task = this.syncQueue.catch(() => {}).then(async () => {
      await this.pullSharedHistory();
      await this.persist();
      const content = JSON.stringify(this.store.data);
      await ensureNoteFolder(this.app, SYNC_HISTORY_PATH);
      const file = this.app.vault.getAbstractFileByPath(SYNC_HISTORY_PATH);
      if (file instanceof TFile) { if (await this.app.vault.read(file) !== content) await this.app.vault.modify(file, content); }
      else await this.app.vault.create(SYNC_HISTORY_PATH, content);
    });
    this.syncQueue = task;
    try { await task; } catch (error) { this.saveError = `会话共享失败：${error instanceof Error ? error.message : String(error)}`; this.emit(); }
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    for (const abort of this.running.values()) abort.abort();
    if (this.saveTimer !== undefined) window.clearTimeout(this.saveTimer);
    this.listeners.clear();
    await Promise.allSettled([...this.pending]);
    if (!this.error) await this.persist();
  }
}
