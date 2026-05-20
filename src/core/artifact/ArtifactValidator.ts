import { ExecutionArtifact, ArtifactItem } from "./types";

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  stats: {
    totalItems: number;
    withSource: number;
    inferred: number;
    highRisk: number;
  };
}

/**
 * Validates a parsed ExecutionArtifact for completeness and safety.
 */
export class ArtifactValidator {
  validate(artifact: ExecutionArtifact): ValidationResult {
    const warnings: string[] = [];
    const items = artifact.items ?? [];

    if (!artifact.title) warnings.push("缺少标题");
    if (items.length === 0) warnings.push("没有生成任何条目");

    const withSource = items.filter((i) => i.sourceLinks && i.sourceLinks.length > 0).length;
    const inferred = items.filter((i) => i.inferred).length;
    const highRisk = items.filter((i) => i.riskLevel === "high").length;

    // Evidence policy enforcement
    if (artifact.evidencePolicy === "strict" && inferred > 0) {
      warnings.push(`严格来源模式下有 ${inferred} 个推断条目，建议确认或移除`);
    }

    if (highRisk > 0) {
      warnings.push(`${highRisk} 个条目标为高风险，请仔细审阅`);
    }

    return {
      valid: items.length > 0 && !!artifact.title,
      warnings,
      stats: {
        totalItems: items.length,
        withSource,
        inferred,
        highRisk,
      },
    };
  }

  /** Normalize an AI-parsed artifact: ensure IDs, defaults. */
  normalize(raw: Partial<ExecutionArtifact>): ExecutionArtifact {
    const items: ArtifactItem[] = (raw.items ?? []).map((item, i) => ({
      id: item.id || `item-${i + 1}`,
      title: item.title || `条目 ${i + 1}`,
      description: item.description,
      category: item.category,
      required: item.required ?? true,
      sourceLinks: item.sourceLinks ?? [],
      inferred: item.inferred ?? false,
      recordFields: item.recordFields,
      riskLevel: item.riskLevel ?? "normal",
    }));

    return {
      title: raw.title || "未命名执行资产",
      artifactType: raw.artifactType || "checklist",
      usageMode: raw.usageMode || "one-off",
      sourceScope: raw.sourceScope || "freeform",
      evidencePolicy: raw.evidencePolicy || "balanced",
      target: raw.target,
      frequency: raw.frequency,
      sourceLinks: raw.sourceLinks ?? [],
      items,
    };
  }
}
