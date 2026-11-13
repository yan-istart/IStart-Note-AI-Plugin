import { SessionData } from "./types";
import { validAgentTask } from "./AgentTasks";
import { isLiveStory } from "./types";
import { serializeStory } from "./StoryContent";

export interface SessionStorage {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<unknown>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<unknown>;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): boolean => Array.isArray(v) && v.every(x => typeof x === "string");
function validStoryConfig(v: unknown): boolean {
  return object(v) && [1, 2, 3].includes(Number(v.rounds)) && typeof v.rounds === "number" && Array.isArray(v.characterPaths) && v.characterPaths.length <= 4 && strings(v.characterPaths) && new Set(v.characterPaths).size === v.characterPaths.length && (v.maxTurns === undefined || (Number.isInteger(v.maxTurns) && Number(v.maxTurns) >= 1 && Number(v.maxTurns) <= 24)) && (v.openingTarget === undefined || typeof v.openingTarget === "string" && (v.openingTarget === "auto" || v.openingTarget === "scene" || v.characterPaths.includes(v.openingTarget)));
}
function validLiveStory(v: Record<string, unknown>, paths: Set<unknown>): boolean {
  if (v.dismissed !== undefined && typeof v.dismissed !== "boolean") return false;
  const target = (t: unknown) => t === "scene" || t === "end" || paths.has(t);
  const block = (b: unknown): b is Record<string, unknown> => object(b) && typeof b.id === "string" && typeof b.turnId === "string" && Number.isInteger(b.seq) && typeof b.text === "string" && ["streaming", "completed", "interrupted"].includes(String(b.status)) && ["dialogue", "narration"].includes(String(b.kind)) && ["public", "private"].includes(String(b.visibility)) && (b.omitted === undefined || typeof b.omitted === "boolean") && (b.kind === "dialogue" ? paths.has(b.characterPath) && b.visibility === "public" && b.ownerPath === undefined : b.characterPath === undefined && (b.visibility === "private" ? paths.has(b.ownerPath) : b.ownerPath === undefined));
  if (!Array.isArray(v.blocks) || v.blocks.length > 512 || !v.blocks.every(block) || new Set(v.blocks.map(b => b.id)).size !== v.blocks.length || !v.blocks.every((b, index) => b.seq === index) || v.blocks.reduce((n, b) => n + String(b.text).length, 0) > 300000 || !["running", "paused", "review", "confirmed", "interrupted"].includes(String(v.state))) return false;
  const blocks = v.blocks, r = v.runtime;
  if (!object(r) || typeof r.task !== "string" || r.task.length > 20000 || !validStoryConfig(r.config) || !Number.isInteger(r.completedTurns) || Number(r.completedTurns) < 0 || (r.next !== undefined && !target(r.next)) || (r.pauseRequested !== undefined && typeof r.pauseRequested !== "boolean") || (r.transport !== undefined && (typeof r.transport !== "string" || !["streaming", "buffered"].includes(r.transport)))) return false;
  if (!validCheckpoint({ version: 1, mode: "agent", messages: [], notes: r.notes, primaryPath: r.primaryPath, scope: r.scope, writing: r.writing, searchVault: false }) || !object(r.scope) || r.scope.projectPath !== v.projectPath || r.primaryPath !== v.chapterPath) return false;
  if (!Array.isArray(r.directives) || r.directives.length > 100 || !r.directives.every(d => object(d) && typeof d.id === "string" && typeof d.text === "string" && d.text.length <= 20000 && (d.target === undefined || target(d.target)) && (d.applied === undefined || typeof d.applied === "boolean"))) return false;
  const request = (p: unknown) => object(p) && typeof p.id === "string" && target(p.target) && typeof p.raw === "string" && p.raw.length <= 200000;
  if (r.pendingTurn !== undefined && !request(r.pendingTurn)) return false;
  if (r.failures !== undefined && (!Array.isArray(r.failures) || r.failures.length > 32 || !r.failures.every(f => request(f) && object(f) && typeof f.error === "string"))) return false;
  if (v.confirmedAt !== undefined && v.state !== "confirmed") return false;
  if (v.state === "confirmed" && v.confirmedAt === undefined) return false;
  if (v.confirmedBlocks !== undefined) {
    const revision = v.confirmedBlocks;
    if (!Array.isArray(revision) || !revision.every(block)) return false;
    if (v.confirmedAt === undefined || !revision.length || !revision.every(b => b.status === "completed" && !b.omitted && blocks.some(source => source.id === b.id && source.kind === b.kind && source.visibility === b.visibility && source.ownerPath === b.ownerPath && source.characterPath === b.characterPath)) || new Set(revision.map(b => b.id)).size !== revision.length || revision.reduce((sum, b) => sum + String(b.text).length, 0) > 200000) return false;
  }
  return v.confirmedAt === undefined || Array.isArray(v.confirmedBlocks);
}
function validStory(v: unknown): boolean {
  if (!object(v) || typeof v.projectPath !== "string" || typeof v.chapterPath !== "string" || !Array.isArray(v.cast) || !v.cast.length || v.cast.length > 4 || !v.cast.every((c: unknown): c is Record<string, unknown> => object(c) && validReference(c) && typeof c.content === "string" && String(c.path).startsWith(`${String(v.projectPath)}/_角色/`)) || new Set(v.cast.map(c => c.path)).size !== v.cast.length) return false;
  const cast = v.cast;
  if (v.version !== undefined && v.version !== 2) return false;
  if (v.version === 2 && !validLiveStory(v, new Set(cast.map(c => c.path)))) return false;
  if (!Array.isArray(v.turns) || v.turns.length > 15 || !v.turns.every(t => object(t) && typeof t.name === "string" && typeof t.content === "string" && [1, 2, 3].includes(Number(t.round)) && typeof t.round === "number" && (t.path === undefined || cast.some(c => c.path === t.path)))) return false;
  if (v.confirmedAt !== undefined && (typeof v.confirmedAt !== "number" || !Number.isFinite(v.confirmedAt))) return false;
  return v.evolution === undefined || (v.confirmedAt !== undefined && object(v.evolution) && ["running", "completed", "error"].includes(String(v.evolution.status)) && typeof v.evolution.content === "string" && (v.evolution.error === undefined || typeof v.evolution.error === "string"));
}
function validReference(v: unknown): boolean {
  if (!object(v) || typeof v.path !== "string") return false;
  if (v.selection !== undefined && (!object(v.selection) || typeof v.selection.text !== "string" || typeof v.selection.content !== "string" || !Number.isInteger(v.selection.start) || !Number.isInteger(v.selection.end) || Number(v.selection.start) < 0 || Number(v.selection.end) < Number(v.selection.start) || v.selection.content.slice(Number(v.selection.start), Number(v.selection.end)) !== v.selection.text)) return false;
  if (v.cursor !== undefined && (!object(v.cursor) || typeof v.cursor.content !== "string" || !Number.isInteger(v.cursor.offset) || Number(v.cursor.offset) < 0 || Number(v.cursor.offset) > v.cursor.content.length)) return false;
  return v.annotation === undefined || typeof v.annotation === "string";
}
function validCheckpoint(v: unknown): boolean {
  if (!object(v) || v.version !== 1 || !["ask", "agent"].includes(String(v.mode)) || typeof v.searchVault !== "boolean" || !Array.isArray(v.messages) || !v.messages.every(m => object(m) && ["user", "assistant"].includes(String(m.role)) && typeof m.content === "string")) return false;
  if ((v.task !== undefined && !validAgentTask(v.task)) || (v.taskResult !== undefined && (typeof v.taskResult !== "string" || v.task === undefined))) return false;
  if (!Array.isArray(v.notes) || v.notes.length > 25 || !v.notes.every((n: unknown): n is Record<string, unknown> => object(n) && validReference(n) && typeof n.content === "string" && (n.selection === undefined || (object(n.selection) && n.selection.content === n.content)))) return false;
  if (new Set(v.notes.map(n => n.path)).size !== v.notes.length || (v.primaryPath !== undefined && (typeof v.primaryPath !== "string" || !v.notes.some(n => n.path === v.primaryPath)))) return false;
  const scope = v.scope;
  if (scope !== null && (!object(scope) || !["genre", "projectTitle", "projectPath"].every(k => typeof scope[k] === "string"))) return false;
  if (v.writing !== undefined && v.writing !== null) {
    const w = v.writing;
    if (!object(w) || !["projectTitle", "oneLiner", "styleProfile", "chapterTitle", "chapterSynopsis", "prevSynopsis", "nextSynopsis"].every(k => typeof w[k] === "string") || !["novel", "paper", "article"].includes(String(w.genre)) || !Number.isFinite(w.chapterNumber) || (w.projectPath !== undefined && typeof w.projectPath !== "string") || (w.outlineContent !== undefined && typeof w.outlineContent !== "string") || (w.projectContent !== undefined && typeof w.projectContent !== "string") || !Array.isArray(w.characters) || !w.characters.every(c => object(c) && typeof c.name === "string" && typeof c.role === "string" && typeof c.summary === "string") || !Array.isArray(w.worldSettings) || !w.worldSettings.every(s => object(s) && typeof s.category === "string" && typeof s.name === "string" && typeof s.content === "string")) return false;
  }
  return v.pendingTool === undefined || (object(v.pendingTool) && typeof v.pendingTool.stepId === "string" && typeof v.pendingTool.name === "string" && Object.prototype.hasOwnProperty.call(v.pendingTool, "args"));
}
function validProofreading(v: unknown): boolean {
  if (!object(v) || typeof v.path !== "string" || typeof v.content !== "string" || typeof v.selected !== "boolean" || !object(v.result) || !Array.isArray(v.result.issues) || !Number.isInteger(v.result.unlocatedCount) || Number(v.result.unlocatedCount) < 0) return false;
  const content = v.content;
  return v.result.issues.every(i => object(i) && typeof i.original === "string" && !!i.original && typeof i.correction === "string" && typeof i.reason === "string" && Number.isInteger(i.start) && Number.isInteger(i.end) && Number(i.start) >= 0 && Number(i.end) <= content.length && Number(i.end) > Number(i.start) && content.slice(Number(i.start), Number(i.end)) === i.original);
}
function validMessage(v: unknown): boolean {
  if (!object(v) || typeof v.id !== "string" || !["user", "assistant"].includes(String(v.role)) || typeof v.content !== "string" || !Number.isFinite(v.createdAt)) return false;
  if (v.task !== undefined && (v.role !== "user" || !validAgentTask(v.task))) return false;
  if (v.taskReferences !== undefined && (v.task === undefined || !Array.isArray(v.taskReferences) || v.taskReferences.length > 8 || !v.taskReferences.every(validReference))) return false;
  if (v.status !== undefined && (typeof v.status !== "string" || !["idle", "running", "completed", "cancelled", "error", "interrupted"].includes(v.status))) return false;
  if (v.error !== undefined && typeof v.error !== "string") return false;
  if (v.proofreading !== undefined && (v.role !== "assistant" || !validProofreading(v.proofreading))) return false;
  if (v.story !== undefined && (v.role !== "assistant" || !validStory(v.story))) return false;
  if (v.sources !== undefined && !strings(v.sources)) return false;
  if (v.skills !== undefined && !strings(v.skills)) return false;
  if (v.references !== undefined && (!Array.isArray(v.references) || !v.references.every(x => validReference(x) && object(x) && typeof x.content === "string"))) return false;
  if (v.steps !== undefined && (!Array.isArray(v.steps) || !v.steps.every(x => object(x) && typeof x.id === "string" && typeof x.tool === "string" && typeof x.label === "string" && ["running", "completed", "error"].includes(String(x.status)) && (x.detail === undefined || typeof x.detail === "string")))) return false;
  if (v.checkpoint !== undefined) {
    const checkpoint = v.checkpoint;
    if (v.role !== "assistant" || !validCheckpoint(checkpoint)) return false;
    if (object(checkpoint) && object(checkpoint.pendingTool)) {
      const stepId = checkpoint.pendingTool.stepId;
      if (!Array.isArray(v.steps) || !v.steps.some(step => object(step) && step.id === stepId)) return false;
    }
  }
  return v.proposals === undefined || (Array.isArray(v.proposals) && v.proposals.every(p => object(p) && typeof p.id === "string" && typeof p.title === "string" && ["pending", "applying", "applied", "rejected", "superseded"].includes(String(p.status)) && Array.isArray(p.changes) && p.changes.every(c => object(c) && typeof c.path === "string" && (c.before === null || typeof c.before === "string") && typeof c.after === "string")));
}
export function parseSessionData(raw: string): SessionData {
  const data: unknown = JSON.parse(raw);
  if (!object(data) || ![1, 2].includes(Number(data.version)) || typeof data.version !== "number" || !(data.activeId === null || typeof data.activeId === "string") || !Array.isArray(data.sessions)) throw new Error("会话文件版本或格式无法识别，原文件已保留");
  const ids = new Set<string>();
  for (const s of data.sessions) {
    if (object(s) && s.pendingTask !== undefined && !validAgentTask(s.pendingTask)) throw new Error("助手任务数据损坏，原文件已保留");
    if (!object(s) || typeof s.id !== "string" || !/^[a-zA-Z0-9-]+$/.test(s.id) || ids.has(s.id) || typeof s.title !== "string" || !Number.isFinite(s.createdAt) || !Number.isFinite(s.updatedAt) || typeof s.archived !== "boolean" || typeof s.pinned !== "boolean" || !["agent", "ask", "story"].includes(String(s.mode)) || typeof s.draft !== "string" || typeof s.searchVault !== "boolean" || !Array.isArray(s.references) || !s.references.every(validReference) || !Array.isArray(s.messages) || !s.messages.every(validMessage) || (s.summary !== undefined && (!object(s.summary) || typeof s.summary.content !== "string" || typeof s.summary.through !== "string")) || (s.parentId !== undefined && typeof s.parentId !== "string") || (s.storyConfig !== undefined && !validStoryConfig(s.storyConfig))) throw new Error("会话数据损坏，原文件已保留");
    ids.add(s.id);
  }
  if (data.deleted !== undefined && (!object(data.deleted) || !Object.values(data.deleted).every(x => typeof x === "number" && Number.isFinite(x)))) throw new Error("会话删除记录损坏");
  return { ...data as unknown as SessionData, version: 2 };
}

/** A separate serialized writer prevents conversation saves from overwriting plugin settings. */
export class SessionStore {
  data: SessionData = { version: 2, activeId: null, sessions: [] };
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private storage: SessionStorage, private directory: string) {}
  async load(): Promise<void> {
    const path = `${this.directory}/sessions.json`;
    if (await this.storage.exists(path)) {
      const raw = await this.storage.read(path);
      this.data = parseSessionData(raw);
      const header = JSON.parse(raw) as { version: number };
      const backup = `${this.directory}/sessions.v1.backup.json`;
      if (header.version === 1 && !await this.storage.exists(backup)) await this.storage.write(backup, raw);
    }
    for (const s of this.data.sessions) for (const m of s.messages) {
      if (m.status === "running") { m.status = "interrupted"; m.error = m.checkpoint ? "上次任务被中断，可点击「继续任务」接着处理" : "上次生成被中断，可重试或从此处分支继续"; }
      this.recoverStory(m);
      if (m.story?.evolution?.status === "running") m.story.evolution = { status: "error", content: "", error: "角色推演被中断，可重试推演" };
      for (const step of m.steps ?? []) if (step.status === "running") step.status = "error";
      for (const p of m.proposals ?? []) if (p.status === "applying") p.status = "pending";
    }
    this.loaded = true;
  }
  save(): Promise<void> {
    if (!this.loaded) return Promise.reject(new Error("会话尚未成功加载，停止保存以保留原文件"));
    const snapshot = JSON.stringify(this.data);
    const task = this.queue.catch(() => {}).then(async () => {
      let path = "";
      for (const part of this.directory.split("/")) {
        path = path ? `${path}/${part}` : part;
        if (!await this.storage.exists(path)) await this.storage.mkdir(path);
      }
      await this.storage.write(`${this.directory}/sessions.json`, snapshot);
    });
    this.queue = task;
    return task;
  }
  flush(): Promise<unknown> { return this.queue; }
  private recoverStory(message: import("./types").AgentMessage): void {
    if (!isLiveStory(message.story)) return;
    const scene = message.story;
    if (scene.state === "running") { scene.state = "interrupted"; message.status = "interrupted"; message.error = "演绎被中断，已完成内容保留，可继续同一场景"; }
    for (const b of scene.blocks) if (b.status === "streaming") b.status = "interrupted";
    const pending = scene.runtime.pendingTurn;
    if (pending && !(scene.runtime.failures ?? []).some(f => f.id === pending.id)) (scene.runtime.failures ??= []).push({ ...pending, error: "上次请求被中断，保留原始返回" });
    scene.runtime.pauseRequested = false;
    message.content = scene.confirmedAt !== undefined ? serializeStory(scene.confirmedBlocks ?? []) : serializeStory(scene.blocks);
  }
  merge(incoming: SessionData): void {
    const deleted = { ...this.data.deleted };
    for (const [id, time] of Object.entries(incoming.deleted ?? {})) deleted[id] = Math.max(deleted[id] ?? 0, time);
    const sessions = new Map(this.data.sessions.map(s => [s.id, s]));
    for (const s of incoming.sessions) {
      const local = sessions.get(s.id);
      if (!local) sessions.set(s.id, s);
      else {
        const newer = local.updatedAt >= s.updatedAt ? local : s;
        const older = newer === local ? s : local;
        const messages = new Map(older.messages.map(m => [m.id, m]));
        for (const message of newer.messages) messages.set(message.id, message);
        sessions.set(s.id, { ...newer, summary: messages.size === newer.messages.length ? newer.summary : undefined, messages: [...messages.values()].sort((a, b) => a.createdAt - b.createdAt) });
      }
    }
    for (const s of sessions.values()) for (const m of s.messages) {
      if (m.status === "running") { m.status = "interrupted"; m.error = "另一设备的生成已中断，可继续提问"; }
      this.recoverStory(m);
      if (m.story?.evolution?.status === "running") m.story.evolution = { status: "error", content: "", error: "另一设备的角色推演已中断，可重试推演" };
      for (const step of m.steps ?? []) if (step.status === "running") step.status = "error";
      for (const p of m.proposals ?? []) if (p.status === "applying") p.status = "pending";
    }
    this.data.sessions = [...sessions.values()].filter(s => !deleted[s.id] || s.updatedAt > deleted[s.id]);
    this.data.deleted = deleted;
  }
}
