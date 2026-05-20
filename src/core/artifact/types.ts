/**
 * Execution Artifact — the universal "knowledge-to-action" output.
 *
 * An artifact is a structured, reusable, trackable deliverable generated
 * from knowledge sources. It can be a checklist, routine, SOP, plan,
 * review template, question list, decision record, or custom format.
 */

export type ArtifactType =
  | "checklist"
  | "routine"
  | "sop"
  | "plan"
  | "review"
  | "question-list"
  | "decision"
  | "custom";

export type ArtifactUsageMode =
  | "one-off"
  | "template"
  | "recurring";

export type ArtifactSourceScope =
  | "selection"
  | "current-note"
  | "reading-project"
  | "related-vault"
  | "freeform";

export type EvidencePolicy =
  | "strict"
  | "balanced"
  | "freeform";

export interface ArtifactRecordField {
  name: string;
  type: "text" | "number" | "boolean" | "choice";
  options?: string[];
}

export interface ArtifactItem {
  id: string;
  title: string;
  description?: string;
  category?: string;
  required?: boolean;
  sourceLinks: string[];
  inferred?: boolean;
  recordFields?: ArtifactRecordField[];
  riskLevel?: "normal" | "watch" | "high";
}

export interface ExecutionArtifact {
  title: string;
  artifactType: ArtifactType;
  usageMode: ArtifactUsageMode;
  sourceScope: ArtifactSourceScope;
  evidencePolicy: EvidencePolicy;
  target?: string;
  frequency?: string;
  sourceLinks: string[];
  items: ArtifactItem[];
}

/** Parameters collected from the user via Builder modal or natural language. */
export interface ArtifactBuildParams {
  artifactType: ArtifactType;
  target: string;
  usageMode: ArtifactUsageMode;
  sourceScope: ArtifactSourceScope;
  evidencePolicy: EvidencePolicy;
  /** Additional context / instruction from the user. */
  instruction?: string;
}

export const ARTIFACT_TYPE_LABELS: Record<ArtifactType, string> = {
  checklist: "检查表",
  routine: "例行流程",
  sop: "标准操作流程",
  plan: "执行计划",
  review: "复盘表",
  "question-list": "问题清单",
  decision: "决策记录",
  custom: "自定义",
};

export const USAGE_MODE_LABELS: Record<ArtifactUsageMode, string> = {
  "one-off": "一次性",
  template: "可复用模板",
  recurring: "每日/每周例行",
};

export const SOURCE_SCOPE_LABELS: Record<ArtifactSourceScope, string> = {
  selection: "当前选中内容",
  "current-note": "当前笔记",
  "reading-project": "当前阅读项目",
  "related-vault": "相关知识库",
  freeform: "自由草稿",
};

export const EVIDENCE_POLICY_LABELS: Record<EvidencePolicy, string> = {
  strict: "严格依据来源",
  balanced: "允许少量推断",
  freeform: "自由生成草稿",
};
