/**
 * ExecutionPlan — the core data structure for the "knowledge → action" pipeline.
 *
 * Every vault-modifying batch that the plugin performs (from AI or user request)
 * should first produce an ExecutionPlan, present a preview to the user, and only
 * apply changes after confirmation.
 *
 * Future: add rollback, dry-run, and diff rendering.
 */

/** A single atomic vault operation. */
export type VaultOperation =
  | CreateFileOp
  | ModifyFileOp
  | AppendSectionOp
  | ReplaceSelectionOp
  | MoveFileOp
  | CreateLinkOp
  | UpdateFrontmatterOp;

export interface CreateFileOp {
  type: "create-file";
  path: string;
  content: string;
}

export interface ModifyFileOp {
  type: "modify-file";
  path: string;
  /** The full new content. */
  content: string;
  /** Optional description of what changed. */
  description?: string;
}

export interface AppendSectionOp {
  type: "append-section";
  path: string;
  section: string;
  content: string;
}

export interface ReplaceSelectionOp {
  type: "replace-selection";
  path: string;
  /** The text to be replaced (used for display; actual replacement is cursor-based). */
  oldText: string;
  newText: string;
}

export interface MoveFileOp {
  type: "move-file";
  from: string;
  to: string;
}

export interface CreateLinkOp {
  type: "create-link";
  /** The file where the link is added. */
  path: string;
  /** The target to link to. */
  target: string;
  /** Where in the file to add (section heading, or "end"). */
  location: string;
}

export interface UpdateFrontmatterOp {
  type: "update-frontmatter";
  path: string;
  /** Fields to set or overwrite. */
  fields: Record<string, unknown>;
}

/** Risk level — determined by how many files are touched and the nature of ops. */
export type RiskLevel = "low" | "medium" | "high";

/** Source feature that generated this plan. */
export type PlanSource =
  | "assistant"
  | "reading"
  | "question"
  | "concept"
  | "sync"
  | "beautify"
  | "manual";

/**
 * An ExecutionPlan groups one or more VaultOperations that logically belong
 * together and should be previewed/confirmed as a unit.
 */
export interface ExecutionPlan {
  id: string;
  title: string;
  source: PlanSource;
  operations: VaultOperation[];
  /** Markdown preview shown to the user before apply. */
  previewMarkdown: string;
  riskLevel: RiskLevel;
  createdAt: string;  // ISO datetime
}

/**
 * Record of a completed execution, persisted as a note
 * in `Knowledge/_Executions/`.
 */
export interface ExecutionRecord {
  plan: ExecutionPlan;
  executedAt: string;
  success: boolean;
  /** Paths that were actually modified (subset of plan if partial failure). */
  affectedPaths: string[];
  error?: string;
}
