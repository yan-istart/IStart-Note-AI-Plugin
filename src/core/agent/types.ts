import type { WritingScopeInfo } from "../skills/types";
import type { WritingContext } from "../../features/writing/types";

export type AgentMode = "ask" | "agent" | "story";
export interface StoryConfig {
  /** Empty means all project characters, up to four. */
  characterPaths: string[];
  rounds: number;
  maxTurns?: number;
  openingTarget?: string;
}
export interface StoryBlock {
  id: string;
  turnId: string;
  seq: number;
  kind: "dialogue" | "narration";
  characterPath?: string;
  text: string;
  status: "streaming" | "completed" | "interrupted";
  visibility: "public" | "private";
  ownerPath?: string;
  omitted?: boolean;
}
/** A cast note path, or the reserved scene/end targets. */
export type StoryTarget = string;
export type StoryState = "running" | "paused" | "review" | "confirmed" | "interrupted";
export interface StoryDirective { id: string; text: string; target?: StoryTarget; applied?: boolean }
export interface StoryRuntime {
  task: string;
  notes: NoteSnapshot[];
  primaryPath: string;
  scope: WritingScopeInfo;
  writing?: WritingContext | null;
  config: StoryConfig;
  completedTurns: number;
  next?: StoryTarget;
  pendingTurn?: { id: string; target: StoryTarget; raw: string };
  failures?: { id: string; target: StoryTarget; raw: string; error: string }[];
  directives: StoryDirective[];
  pauseRequested?: boolean;
  transport?: "streaming" | "buffered";
}
export interface StoryTurn {
  name: string;
  path?: string;
  round: number;
  content: string;
}
export interface StoryScene {
  projectPath: string;
  chapterPath: string;
  cast: NoteSnapshot[];
  turns: StoryTurn[];
  confirmedAt?: number;
  evolution?: { status: "running" | "completed" | "error"; content: string; error?: string };
  version?: 2;
  blocks?: StoryBlock[];
  state?: StoryState;
  runtime?: StoryRuntime;
  confirmedBlocks?: StoryBlock[];
  dismissed?: boolean;
}
export interface LiveStoryScene extends StoryScene {
  version: 2;
  blocks: StoryBlock[];
  state: StoryState;
  runtime: StoryRuntime;
}
export function isLiveStory(scene?: StoryScene): scene is LiveStoryScene { return scene?.version === 2; }
export type RunStatus = "idle" | "running" | "completed" | "cancelled" | "error" | "interrupted";
export interface NoteReference {
  path: string;
  /** Capture selection/cursor before the sidebar takes focus. */
  selection?: { start: number; end: number; text: string; content: string };
  cursor?: { offset: number; content: string };
  annotation?: string;
}
export interface NoteSnapshot extends NoteReference { content: string }
export interface AgentTask {
  actionId: string;
  tool: string;
  args: Record<string, string | number | boolean>;
  mode: "ask" | "agent";
}
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
  task?: AgentTask;
  taskResult?: string;
}
export interface ProofreadingReport {
  path: string;
  content: string;
  selected: boolean;
  result: import("../../ai/TypoChecker").TypoCheckResult;
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
  story?: StoryScene;
  proofreading?: ProofreadingReport;
  task?: AgentTask;
  taskReferences?: NoteReference[];
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
  storyConfig?: StoryConfig;
  pendingTask?: AgentTask;
}
export interface SessionData { version: 1 | 2; activeId: string | null; sessions: AgentSession[]; deleted?: Record<string, number> }
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
