import type { WritingScopeInfo } from "../skills/types";
import type { WritingContext } from "../../features/writing/types";

export type AgentMode = "ask" | "agent";
export type RunStatus = "idle" | "running" | "completed" | "cancelled" | "error" | "interrupted";
export interface NoteReference {
  path: string;
  /** Capture selection/cursor before the sidebar takes focus. */
  selection?: { start: number; end: number; text: string; content: string };
  cursor?: { offset: number; content: string };
  annotation?: string;
}
export interface NoteSnapshot extends NoteReference { content: string }
export interface AgentStep {
  id: string;
  tool: string;
  label: string;
  status: "running" | "completed" | "error";
  detail?: string;
}
export interface FileChange {
  path: string;
  before: string | null;
  after: string;
}
export interface ChangeProposal {
  id: string;
  title: string;
  changes: FileChange[];
  status: "pending" | "applying" | "applied" | "rejected" | "superseded";
}
/** Serializable protocol state. Credentials and live editor handles never enter a checkpoint. */
export interface AgentCheckpoint {
  version: 1;
  messages: { role: "user" | "assistant"; content: string }[];
  notes: NoteSnapshot[];
  primaryPath?: string;
  mode: AgentMode;
  searchVault: boolean;
  scope: WritingScopeInfo | null;
  writing?: WritingContext | null;
  pendingTool?: { stepId: string; name: string; args: unknown };
}
export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  status?: RunStatus;
  steps?: AgentStep[];
  sources?: string[];
  proposals?: ChangeProposal[];
  references?: NoteSnapshot[];
  skills?: string[];
  error?: string;
  checkpoint?: AgentCheckpoint;
}
export interface AgentSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  pinned: boolean;
  mode: AgentMode;
  draft: string;
  references: NoteReference[];
  searchVault: boolean;
  messages: AgentMessage[];
  summary?: { content: string; through: string };
  parentId?: string;
}
export interface SessionData { version: 1; activeId: string | null; sessions: AgentSession[]; deleted?: Record<string, number> }
export interface AgentSettings { streaming: boolean; maxSteps: number; contextChars: number; syncHistory: boolean }
export const DEFAULT_AGENT_SETTINGS: AgentSettings = { streaming: false, maxSteps: 8, contextChars: 30000, syncHistory: false };
export function loadAgentSettings(value?: Partial<AgentSettings>): AgentSettings {
  const bounded = (n: unknown, fallback: number, min: number, max: number) => typeof n === "number" && Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
  return { streaming: value?.streaming === true, maxSteps: bounded(value?.maxSteps, 8, 2, 20), contextChars: bounded(value?.contextChars, 30000, 8000, 100000), syncHistory: value?.syncHistory === true };
}
export interface AgentRunContext {
  sessionId: string;
  mode: AgentMode;
  notes: Map<string, NoteSnapshot>;
  primary?: NoteSnapshot;
  scope: WritingScopeInfo | null;
  writing?: WritingContext | null;
  searchVault: boolean;
  signal: AbortSignal;
  sources: Set<string>;
  drafts?: Map<string, FileChange>;
}
export function agentId(): string { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`; }
export function newSession(references: NoteReference[] = []): AgentSession {
  const now = Date.now();
  return { id: agentId(), title: "新会话", createdAt: now, updatedAt: now, archived: false, pinned: false, mode: "agent", draft: "", references, searchVault: true, messages: [] };
}
