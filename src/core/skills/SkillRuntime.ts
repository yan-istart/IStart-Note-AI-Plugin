import type { SkillDefinition, SkillFeature } from "./types";

export interface SkillRuntimeRequest {
  systemPrompt?: string;
  userPrompt: string;
  feature: SkillFeature;
  genre?: string;
  projectTitle?: string;
  projectPath?: string;
  useActiveFile?: boolean;
}

type SkillProvider = (request: SkillRuntimeRequest) => SkillDefinition[] | Promise<SkillDefinition[]>;

let provider: SkillProvider | null = null;

/** The plugin installs one provider so every LLMClient call shares the same skill selection. */
export function setSkillProvider(next: SkillProvider | null): void {
  provider = next;
}

export async function resolveActiveSkills(request: SkillRuntimeRequest): Promise<SkillDefinition[]> {
  if (!provider) return [];
  return await provider(request);
}
