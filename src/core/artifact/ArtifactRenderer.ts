import { ExecutionArtifact, ArtifactItem, ARTIFACT_TYPE_LABELS, USAGE_MODE_LABELS } from "./types";
import { SCHEMA_VERSION, todayIso } from "../schema";

/**
 * Renders an ExecutionArtifact into Markdown for template or run files.
 */
export class ArtifactRenderer {
  /** Render as a reusable template note. */
  renderTemplate(artifact: ExecutionArtifact): string {
    const fm = this.buildFrontmatter(artifact, "template");
    const body = this.buildBody(artifact, false);
    return `${fm}\n${body}`;
  }

  /** Render as a concrete execution run for a given date. */
  renderRun(artifact: ExecutionArtifact, date: string): string {
    const fm = this.buildRunFrontmatter(artifact, date);
    const body = this.buildBody(artifact, true);
    const context = this.buildRunContext(artifact);
    return `${fm}\n${context}\n${body}\n${this.buildRunFooter()}`;
  }

  private buildFrontmatter(artifact: ExecutionArtifact, docType: "template" | "run"): string {
    const lines = [
      "---",
      `type: execution-artifact-${docType}`,
      `schema_version: ${SCHEMA_VERSION}`,
      `artifact_type: ${artifact.artifactType}`,
      `title: ${this.yamlStr(artifact.title)}`,
      `usage_mode: ${artifact.usageMode}`,
      `source_scope: ${artifact.sourceScope}`,
      `evidence_policy: ${artifact.evidencePolicy}`,
    ];
    if (artifact.target) lines.push(`target: ${this.yamlStr(artifact.target)}`);
    if (artifact.frequency) lines.push(`frequency: ${artifact.frequency}`);
    lines.push(`status: draft`);
    lines.push(`created_at: ${todayIso()}`);
    lines.push("---");
    return lines.join("\n");
  }

  private buildRunFrontmatter(artifact: ExecutionArtifact, date: string): string {
    const lines = [
      "---",
      `type: execution-artifact-run`,
      `schema_version: ${SCHEMA_VERSION}`,
      `artifact_type: ${artifact.artifactType}`,
      `template: ${this.yamlStr(artifact.title)}`,
      `date: ${date}`,
      `status: open`,
      "---",
    ];
    return lines.join("\n");
  }

  private buildBody(artifact: ExecutionArtifact, isRun: boolean): string {
    const title = isRun
      ? `# ${todayIso()} ${artifact.title}`
      : `# ${artifact.title}`;

    const meta = [
      `> [!info] ${isRun ? "今日执行" : "执行资产模板"}`,
      `> 类型：${ARTIFACT_TYPE_LABELS[artifact.artifactType]}`,
      `> 使用方式：${USAGE_MODE_LABELS[artifact.usageMode]}`,
      artifact.target ? `> 对象：${artifact.target}` : null,
      artifact.frequency ? `> 频率：${artifact.frequency}` : null,
      artifact.sourceLinks.length > 0
        ? `> 来源：${artifact.sourceLinks.map((l) => this.wikiLink(l)).join("、")}`
        : null,
    ].filter(Boolean).join("\n");

    // Safety disclaimer for sensitive domains
    const disclaimer = this.needsSafetyDisclaimer(artifact)
      ? `\n> [!warning] 使用边界\n> 该执行资产用于记录、观察和复盘，不构成医学、法律或投资建议。出现异常情况请咨询专业人士。\n`
      : "";

    // Group items by category
    const grouped = this.groupByCategory(artifact.items);
    const sections: string[] = [];

    for (const [category, items] of grouped) {
      sections.push(`\n### ${category}\n`);
      for (const item of items) {
        sections.push(this.renderItem(item, isRun));
      }
    }

    // Inferred items warning
    const inferredItems = artifact.items.filter((i) => i.inferred);
    let inferredSection = "";
    if (inferredItems.length > 0 && !isRun) {
      inferredSection = `\n## 未验证项\n\n> [!warning]\n> 以下 ${inferredItems.length} 个条目由 AI 推断生成，未找到明确来源，建议人工确认。\n\n${inferredItems.map((i) => `- ${i.title}`).join("\n")}\n`;
    }

    return `${title}\n\n${meta}${disclaimer}\n${sections.join("\n")}${inferredSection}`;
  }

  private renderItem(item: ArtifactItem, isRun: boolean): string {
    const lines: string[] = [];
    const checkbox = isRun ? "- [ ]" : "-";
    const riskMark = item.riskLevel === "high" ? " ⚠️" : item.riskLevel === "watch" ? " 👀" : "";

    lines.push(`${checkbox} ${item.title}${riskMark}`);

    if (item.sourceLinks.length > 0) {
      lines.push(`  - 依据：${item.sourceLinks.map((l) => this.wikiLink(l)).join("、")}`);
    } else if (item.inferred) {
      lines.push(`  - 依据：*AI 推断，建议确认*`);
    }

    if (isRun && item.recordFields) {
      for (const field of item.recordFields) {
        lines.push(`  - ${field.name}：`);
      }
    }

    return lines.join("\n");
  }

  private buildRunContext(artifact: ExecutionArtifact): string {
    return `\n## 今日上下文\n\n- 对象：${artifact.target ?? ""}\n- 特殊情况：\n`;
  }

  private buildRunFooter(): string {
    return `\n## 今日问题\n\n- \n\n## 明日调整\n\n- \n`;
  }

  /** Safely encode a string for YAML (uses JSON quoting). */
  private yamlStr(value: string): string {
    return JSON.stringify(value);
  }

  private needsSafetyDisclaimer(artifact: ExecutionArtifact): boolean {
    const sensitiveKeywords = [
      "婴儿", "母亲", "健康", "医疗", "诊断", "症状", "用药", "治疗",
      "法律", "合同", "诉讼", "投资", "理财", "基金", "股票",
      "baby", "infant", "health", "medical", "diagnosis", "legal", "investment",
    ];
    const text = `${artifact.title} ${artifact.target ?? ""}`.toLowerCase();
    const hasHighRisk = artifact.items.some((i) => i.riskLevel === "high" || i.riskLevel === "watch");
    const hasSensitiveKeyword = sensitiveKeywords.some((k) => text.includes(k));
    return hasHighRisk || hasSensitiveKeyword;
  }

  private groupByCategory(items: ArtifactItem[]): Map<string, ArtifactItem[]> {
    const map = new Map<string, ArtifactItem[]>();
    for (const item of items) {
      const cat = item.category || "通用";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    }
    return map;
  }

  /** Ensure a link string becomes a proper [[wikilink]] without double-wrapping. */
  private wikiLink(link: string): string {
    const trimmed = link.trim();
    if (trimmed.startsWith("[[") && trimmed.endsWith("]]")) return trimmed;
    // Strip accidental [[ ]] if partially wrapped
    const cleaned = trimmed.replace(/^\[\[/, "").replace(/\]\]$/, "");
    return `[[${cleaned}]]`;
  }
}
