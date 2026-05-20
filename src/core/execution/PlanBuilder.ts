import { ExecutionPlan, VaultOperation, RiskLevel, PlanSource } from "./types";

/**
 * Fluent builder for constructing an ExecutionPlan.
 *
 * Usage:
 * ```
 *   const plan = new PlanBuilder("从会议纪要生成行动计划", "assistant")
 *     .createFile("Projects/xxx.md", content)
 *     .appendSection("Meeting/2024-01-01.md", "执行计划", link)
 *     .build();
 * ```
 */
export class PlanBuilder {
  private ops: VaultOperation[] = [];

  constructor(
    private title: string,
    private source: PlanSource
  ) {}

  createFile(path: string, content: string): this {
    this.ops.push({ type: "create-file", path, content });
    return this;
  }

  modifyFile(path: string, content: string, description?: string): this {
    this.ops.push({ type: "modify-file", path, content, description });
    return this;
  }

  appendSection(path: string, section: string, content: string): this {
    this.ops.push({ type: "append-section", path, section, content });
    return this;
  }

  replaceSelection(path: string, oldText: string, newText: string): this {
    this.ops.push({ type: "replace-selection", path, oldText, newText });
    return this;
  }

  moveFile(from: string, to: string): this {
    this.ops.push({ type: "move-file", from, to });
    return this;
  }

  createLink(path: string, target: string, location = "end"): this {
    this.ops.push({ type: "create-link", path, target, location });
    return this;
  }

  updateFrontmatter(path: string, fields: Record<string, unknown>): this {
    this.ops.push({ type: "update-frontmatter", path, fields });
    return this;
  }

  build(): ExecutionPlan {
    return {
      id: this.generateId(),
      title: this.title,
      source: this.source,
      operations: this.ops,
      previewMarkdown: this.renderPreview(),
      riskLevel: this.assessRisk(),
      createdAt: new Date().toISOString(),
    };
  }

  // ── Internals ──────────────────────────────────────────────

  private generateId(): string {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 6);
    return `exec-${ts}-${rand}`;
  }

  private assessRisk(): RiskLevel {
    const fileCount = new Set(this.ops.map((op) => this.getPath(op))).size;
    const hasMoves = this.ops.some((op) => op.type === "move-file");
    const hasModifies = this.ops.some((op) => op.type === "modify-file");

    if (fileCount >= 5 || hasMoves) return "high";
    if (fileCount >= 3 || hasModifies) return "medium";
    return "low";
  }

  private renderPreview(): string {
    const lines: string[] = [`## 执行计划：${this.title}\n`];
    const grouped = this.groupByPath();

    for (const [path, ops] of grouped) {
      lines.push(`### \`${path}\``);
      for (const op of ops) {
        lines.push(`- ${this.describeOp(op)}`);
      }
      lines.push("");
    }

    lines.push(`---`);
    lines.push(`影响文件：${grouped.size} 个 | 操作数：${this.ops.length} | 风险等级：${this.assessRisk()}`);
    return lines.join("\n");
  }

  private groupByPath(): Map<string, VaultOperation[]> {
    const map = new Map<string, VaultOperation[]>();
    for (const op of this.ops) {
      const key = this.getPath(op);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(op);
    }
    return map;
  }

  private getPath(op: VaultOperation): string {
    switch (op.type) {
      case "move-file": return op.from;
      default: return (op as { path: string }).path;
    }
  }

  private describeOp(op: VaultOperation): string {
    switch (op.type) {
      case "create-file": return `创建文件`;
      case "modify-file": return op.description ?? `修改文件内容`;
      case "append-section": return `追加到 §${op.section}`;
      case "replace-selection": return `替换选中文本`;
      case "move-file": return `移动到 \`${op.to}\``;
      case "create-link": return `添加链接 → [[${op.target}]]`;
      case "update-frontmatter": return `更新 frontmatter: ${Object.keys(op.fields).join(", ")}`;
    }
  }
}
