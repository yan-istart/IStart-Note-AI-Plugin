import { App, Notice, TFile, MarkdownView } from "obsidian";
import type DeepSeekPlugin from "../../main";
import { SessionStore, parseSessionData } from "../../core/agent/SessionStore";
import { AgentRunner } from "../../core/agent/AgentRunner";
import { AgentTools } from "../../core/agent/AgentTools";
import { LLMClient } from "../../core/llm";
import { abortable } from "../../core/llm/LLMClient";
import { selectSkills } from "../../core/skills/SkillSelector";
import { resolveWritingScope } from "../../core/skills/WritingScope";
import { applyChanges, changedRange, noteName } from "../../core/agent/Changes";
import { WritingProjectManager } from "../writing/WritingProjectManager";
import { readNote, snapshotReference, writeChange, ensureNoteFolder } from "../../core/agent/Context";
import { AgentSession, AgentMessage, AgentRunContext, ChangeProposal, NoteReference, NoteSnapshot, newSession, agentId } from "../../core/agent/types";

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
  private lastMarkdown: MarkdownView | null = null;
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
  trackView(view: MarkdownView): void { this.lastMarkdown = view; }
  captureCurrent(): NoteReference | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView) ?? this.lastMarkdown;
    if (!view?.file) return null;
    if (view.getMode() !== "source") return { path: view.file.path };
    const editor = view.editor, content = editor.getValue();
    const start = editor.posToOffset(editor.getCursor("from")), end = editor.posToOffset(editor.getCursor("to"));
    return { path: view.file.path, cursor: { offset: editor.posToOffset(editor.getCursor()), content }, ...(start !== end ? { selection: { start, end, text: content.slice(start, end), content } } : {}) };
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
    fresh.messages = copy.messages.slice(0, index + 1);
    fresh.summary = copy.summary && fresh.messages.some(m => m.id === copy.summary?.through) ? copy.summary : undefined;
    for (const m of fresh.messages) {
      delete m.checkpoint;
      if (m.status === "running") { m.status = "interrupted"; m.error = "从运行中的会话分支，请继续提问"; }
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
  private async runTurn(id: string, text: string, resume?: AgentMessage): Promise<void> {
    this.ready(); const s = this.sessions.find(s => s.id === id); if (!s || (!text.trim() && !resume)) return;
    if (text.length > 20000) throw new Error("消息过长，请拆分任务");
    if (s.archived) throw new Error("请先恢复会话");
    if (this.running.has(id)) throw new Error("本会话正在生成，请等待或停止后重试");
    if (this.running.size >= 2) throw new Error("已有两个会话正在生成，请稍候再发送");
    const abort = new AbortController(); this.running.set(id, abort);
    const user: AgentMessage | undefined = resume ? [...s.messages.slice(0, s.messages.indexOf(resume))].reverse().find(m => m.role === "user") : { id: agentId(), role: "user", content: text.trim(), createdAt: Date.now() };
    if (!user) { this.running.delete(id); throw new Error("任务缺少原始用户消息"); }
    if (!resume) {
      s.messages.push(user); s.draft = "";
      if (s.messages.filter(m => m.role === "user").length === 1) s.title = text.trim().slice(0, 24);
    }
    this.touch(s);
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; abort.abort(); }, 300000);
    try {
      await this.persist();
      const saved = resume?.checkpoint;
      const references = saved ? saved.notes : JSON.parse(JSON.stringify(s.references)) as NoteReference[];
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
      const writing = saved ? saved.writing : scope && file instanceof TFile ? await abortable(new WritingProjectManager(this.app, this.plugin.settings).loadContext(file), abort.signal) : null;
      const skills = selectSkills(await abortable(this.plugin.skillRegistry.ensureLoaded(), abort.signal), { feature: scope ? "writing" : "assistant", userPrompt: user.content, writingScope: scope }, this.plugin.settings.skills);
      const context: AgentRunContext = { sessionId: id, mode: saved?.mode ?? s.mode, notes, primary, scope, writing, searchVault: saved?.searchVault ?? s.searchVault, signal: abort.signal, sources: new Set(saved ? resume?.sources ?? [] : (user.references ?? []).map(n => n.path)) };
      const settings = { ...this.plugin.settings, agent: { ...this.plugin.settings.agent } };
      const client = new LLMClient(settings, { signal: abort.signal, skills, skillContext: { ...scope, useActiveFile: false } });
      const tools = new AgentTools(this.app, settings, this.plugin.knowledgeIndex, client);
      let checkpoint = "";
      const result = await new AgentRunner(client, tools.registry).run(s, context, settings.agent, () => {
        const reply = s.messages[s.messages.length - 1]; reply.skills = skills.map(skill => skill.name);
        const next = `${reply.status}/${reply.steps?.map(step => step.status).join(",")}/${reply.proposals?.length}`;
        if (next !== checkpoint) { checkpoint = next; this.saveSoon(); }
        this.emit();
      }, { resume, save: () => this.persist() });
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
    const user = [...s.messages.slice(0, index)].reverse().find(m => m.role === "user");
    if (user) await this.send(s.id, user.content);
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
  offerAnswer(session: AgentSession, message: AgentMessage, mode: "save" | "append" | "insert", title = "AI 笔记"): void {
    if (this.isRunning(session.id)) throw new Error("请等待本轮结束");
    let change;
    if (mode === "save") {
      const path = `${this.plugin.settings.savePath}/${noteName(title)}.md`;
      change = { path, before: null, after: `# ${title}\n\n${message.content}\n` };
    } else {
      const index = session.messages.indexOf(message);
      const user = [...session.messages.slice(0, index)].reverse().find(m => m.role === "user");
      const note = user?.references?.[0];
      if (!note) throw new Error("本轮没有引用目标笔记，请添加引用后重新生成");
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
