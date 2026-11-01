export type SkillScope = "global" | "genre" | "project";
export type SkillApply = "writing" | "all";
export type SkillFeature = "writing" | "assistant" | "annotation" | "knowledge" | "other";

export interface WritingScopeInfo {
  projectTitle: string;
  projectPath: string;
  genre: string;
}

/** A parsed Agent Skills `SKILL.md` file. */
export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  body: string;
  scope: SkillScope;
  apply: SkillApply;
  genre?: string;
  project?: string;
  projectPath?: string;
  priority: number;
  /** Vault-relative path to `SKILL.md` or a flat skill file. */
  path: string;
  /** Root configured in plugin settings. */
  root: string;
}

export interface SkillSelectionRequest {
  feature: SkillFeature;
  systemPrompt?: string;
  userPrompt: string;
  writingScope?: WritingScopeInfo | null;
  genre?: string;
}
