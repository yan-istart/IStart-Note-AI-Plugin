import { SessionData } from "./types";

export interface SessionStorage {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<unknown>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<unknown>;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): boolean => Array.isArray(v) && v.every(x => typeof x === "string");
function validReference(v: unknown): boolean {
  if (!object(v) || typeof v.path !== "string") return false;
  if (v.selection !== undefined && (!object(v.selection) || typeof v.selection.text !== "string" || typeof v.selection.content !== "string" || !Number.isInteger(v.selection.start) || !Number.isInteger(v.selection.end) || Number(v.selection.start) < 0 || Number(v.selection.end) < Number(v.selection.start) || (v.selection.content as string).slice(Number(v.selection.start), Number(v.selection.end)) !== v.selection.text)) return false;
  if (v.cursor !== undefined && (!object(v.cursor) || typeof v.cursor.content !== "string" || !Number.isInteger(v.cursor.offset) || Number(v.cursor.offset) < 0 || Number(v.cursor.offset) > (v.cursor.content as string).length)) return false;
  return v.annotation === undefined || typeof v.annotation === "string";
}
function validCheckpoint(v: unknown): boolean {
  if (!object(v) || v.version !== 1 || !["ask", "agent"].includes(String(v.mode)) || typeof v.searchVault !== "boolean" || !Array.isArray(v.messages) || !v.messages.every(m => object(m) && ["user", "assistant"].includes(String(m.role)) && typeof m.content === "string")) return false;
  if (!Array.isArray(v.notes) || v.notes.length > 25 || !v.notes.every(n => object(n) && validReference(n) && typeof n.content === "string" && (n.selection === undefined || (object(n.selection) && n.selection.content === n.content)))) return false;
  if (new Set(v.notes.map(n => n.path)).size !== v.notes.length || (v.primaryPath !== undefined && (typeof v.primaryPath !== "string" || !v.notes.some(n => n.path === v.primaryPath)))) return false;
  const scope = v.scope;
  if (scope !== null && (!object(scope) || !["genre", "projectTitle", "projectPath"].every(k => typeof scope[k] === "string"))) return false;
  if (v.writing !== undefined && v.writing !== null) {
    const w = v.writing;
    if (!object(w) || !["projectTitle", "oneLiner", "styleProfile", "chapterTitle", "chapterSynopsis", "prevSynopsis", "nextSynopsis"].every(k => typeof w[k] === "string") || !["novel", "paper", "article"].includes(String(w.genre)) || !Number.isFinite(w.chapterNumber) || (w.projectPath !== undefined && typeof w.projectPath !== "string") || (w.outlineContent !== undefined && typeof w.outlineContent !== "string") || (w.projectContent !== undefined && typeof w.projectContent !== "string") || !Array.isArray(w.characters) || !w.characters.every(c => object(c) && typeof c.name === "string" && typeof c.role === "string" && typeof c.summary === "string") || !Array.isArray(w.worldSettings) || !w.worldSettings.every(s => object(s) && typeof s.category === "string" && typeof s.name === "string" && typeof s.content === "string")) return false;
  }
  return v.pendingTool === undefined || (object(v.pendingTool) && typeof v.pendingTool.stepId === "string" && typeof v.pendingTool.name === "string" && Object.prototype.hasOwnProperty.call(v.pendingTool, "args"));
}
function validMessage(v: unknown): boolean {
  if (!object(v) || typeof v.id !== "string" || !["user", "assistant"].includes(String(v.role)) || typeof v.content !== "string" || !Number.isFinite(v.createdAt)) return false;
  if (v.status !== undefined && !["idle", "running", "completed", "cancelled", "error", "interrupted"].includes(String(v.status))) return false;
  if (v.error !== undefined && typeof v.error !== "string") return false;
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
  if (!object(data) || data.version !== 1 || !(data.activeId === null || typeof data.activeId === "string") || !Array.isArray(data.sessions)) throw new Error("会话文件版本或格式无法识别，原文件已保留");
  const ids = new Set<string>();
  for (const s of data.sessions) {
    if (!object(s) || typeof s.id !== "string" || !/^[a-zA-Z0-9-]+$/.test(s.id) || ids.has(s.id) || typeof s.title !== "string" || !Number.isFinite(s.createdAt) || !Number.isFinite(s.updatedAt) || typeof s.archived !== "boolean" || typeof s.pinned !== "boolean" || !["agent", "ask"].includes(String(s.mode)) || typeof s.draft !== "string" || typeof s.searchVault !== "boolean" || !Array.isArray(s.references) || !s.references.every(validReference) || !Array.isArray(s.messages) || !s.messages.every(validMessage) || (s.summary !== undefined && (!object(s.summary) || typeof s.summary.content !== "string" || typeof s.summary.through !== "string")) || (s.parentId !== undefined && typeof s.parentId !== "string")) throw new Error("会话数据损坏，原文件已保留");
    ids.add(s.id);
  }
  if (data.deleted !== undefined && (!object(data.deleted) || !Object.values(data.deleted).every(x => typeof x === "number" && Number.isFinite(x)))) throw new Error("会话删除记录损坏");
  return data as unknown as SessionData;
}

/** A separate serialized writer prevents conversation saves from overwriting plugin settings. */
export class SessionStore {
  data: SessionData = { version: 1, activeId: null, sessions: [] };
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private storage: SessionStorage, private directory: string) {}
  async load(): Promise<void> {
    const path = `${this.directory}/sessions.json`;
    if (await this.storage.exists(path)) this.data = parseSessionData(await this.storage.read(path));
    for (const s of this.data.sessions) for (const m of s.messages) {
      if (m.status === "running") { m.status = "interrupted"; m.error = m.checkpoint ? "上次任务被中断，可点击「继续任务」接着处理" : "上次生成被中断，可重试或从此处分支继续"; }
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
      for (const step of m.steps ?? []) if (step.status === "running") step.status = "error";
      for (const p of m.proposals ?? []) if (p.status === "applying") p.status = "pending";
    }
    this.data.sessions = [...sessions.values()].filter(s => !deleted[s.id] || s.updatedAt > deleted[s.id]);
    this.data.deleted = deleted;
  }
}
