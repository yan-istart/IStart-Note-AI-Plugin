import type { SkillSettings } from "../../types";
import type { SkillDefinition, SkillScope, SkillSelectionRequest } from "./types";

const SCOPE_ORDER: Record<SkillScope, number> = { project: 3, genre: 2, global: 1 };

/**
 * Select the skills that should accompany one AI request.
 * Specificity order is project > genre > global; the project skill owns the token budget first.
 */
export function selectSkills(
  skills: SkillDefinition[],
  request: SkillSelectionRequest,
  settings: SkillSettings
): SkillDefinition[] {
  if (!settings.enabled) return [];

  const writingScope = request.writingScope ?? null;
  const genre = (request.genre || writingScope?.genre || "").trim().toLowerCase();
  const writingFeature = request.feature === "writing" || request.feature === "assistant" || request.feature === "annotation";
  const writingContext = request.feature === "writing" || (writingFeature && !!writingScope);
  if (settings.writingOnly && !writingContext) return [];

  const disabled = new Set(settings.disabledSkillIds);
  const matched = skills.filter((skill) => {
    if (disabled.has(skill.id)) return false;
    if (!skill.body.trim()) return false;

    if (skill.scope === "global") {
      return writingContext || skill.apply === "all";
    }
    if (!writingContext) return false;
    if (skill.scope === "genre") {
      return !skill.genre || (!!genre && skill.genre.toLowerCase() === genre);
    }
    return matchesProject(skill, writingScope);
  });

  matched.sort((a, b) =>
    b.priority - a.priority
    || SCOPE_ORDER[b.scope] - SCOPE_ORDER[a.scope]
    || a.name.localeCompare(b.name)
  );

  const selected: SkillDefinition[] = [];
  let used = 0;
  const limit = Math.max(0, settings.maxChars);
  for (const skill of matched) {
    if (used >= limit) break;
    const remaining = limit - used;
    if (skill.body.length <= remaining) {
      selected.push(skill);
      used += skill.body.length;
      continue;
    }
    if (selected.length === 0 && remaining > 0) {
      selected.push({ ...skill, body: `${skill.body.slice(0, Math.max(0, remaining - 12)).trimEnd()}\n\n[已截断]` });
      used = limit;
    }
    break;
  }
  return selected;
}

function matchesProject(skill: SkillDefinition, scope: { projectTitle: string; projectPath: string } | null): boolean {
  if (!scope) return false;
  if (skill.projectPath) {
    const target = normalizeSkillPath(skill.projectPath);
    const current = normalizeSkillPath(scope.projectPath);
    return !!target && !!current && (current === target || current.startsWith(`${target}/`));
  }
  if (skill.project) {
    return skill.project.trim().toLowerCase() === scope.projectTitle.trim().toLowerCase();
  }
  return false;
}

function normalizeSkillPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}
