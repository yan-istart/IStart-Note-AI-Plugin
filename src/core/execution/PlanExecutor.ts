import { App, TFile, normalizePath, parseYaml, stringifyYaml } from "obsidian";
import { ExecutionPlan, ExecutionRecord, VaultOperation } from "./types";
import { SCHEMA_VERSION, todayIso } from "../schema";

/**
 * PlanExecutor — applies an ExecutionPlan to the vault and records the result.
 *
 * Current scope (v1):
 *  - Executes operations sequentially.
 *  - Records the result as a markdown note in `Knowledge/_Executions/`.
 *  - Does NOT support rollback yet (planned for v3).
 */
export class PlanExecutor {
  constructor(private app: App) {}

  /**
   * Apply all operations in a plan.
   * Returns an ExecutionRecord with the outcome.
   */
  async execute(plan: ExecutionPlan): Promise<ExecutionRecord> {
    const affectedPaths: string[] = [];
    let error: string | undefined;

    try {
      for (const op of plan.operations) {
        await this.applyOp(op);
        affectedPaths.push(this.getPath(op));
      }
    } catch (err) {
      error = (err as Error).message;
    }

    const record: ExecutionRecord = {
      plan,
      executedAt: new Date().toISOString(),
      success: !error,
      affectedPaths: [...new Set(affectedPaths)],
      error,
    };

    await this.persistRecord(record);
    return record;
  }

  // ── Apply individual operations ────────────────────────────

  private async applyOp(op: VaultOperation): Promise<void> {
    switch (op.type) {
      case "create-file":
        await this.ensureParentFolder(op.path);
        await this.app.vault.create(op.path, op.content);
        break;

      case "modify-file": {
        const file = this.getFile(op.path);
        await this.app.vault.modify(file, op.content);
        break;
      }

      case "append-section": {
        const file = this.getFile(op.path);
        const content = await this.app.vault.read(file);
        const updated = this.appendToSection(content, op.section, op.content);
        await this.app.vault.modify(file, updated);
        break;
      }

      case "replace-selection": {
        const file = this.getFile(op.path);
        const content = await this.app.vault.read(file);
        const updated = content.replace(op.oldText, op.newText);
        await this.app.vault.modify(file, updated);
        break;
      }

      case "move-file": {
        const file = this.getFile(op.from);
        await this.ensureParentFolder(op.to);
        await this.app.vault.rename(file, op.to);
        break;
      }

      case "create-link": {
        const file = this.getFile(op.path);
        const content = await this.app.vault.read(file);
        const link = `[[${op.target}]]`;
        if (content.includes(link)) break; // no duplicates

        if (op.location === "end") {
          await this.app.vault.modify(file, content.trimEnd() + `\n- ${link}\n`);
        } else {
          // Append under section heading
          const updated = this.appendToSection(content, op.location, `- ${link}`);
          await this.app.vault.modify(file, updated);
        }
        break;
      }

      case "update-frontmatter": {
        const file = this.getFile(op.path);
        const content = await this.app.vault.read(file);
        const updated = this.patchFrontmatter(content, op.fields);
        await this.app.vault.modify(file, updated);
        break;
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────

  private getFile(path: string): TFile {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!f || !(f instanceof TFile)) {
      throw new Error(`文件不存在：${path}`);
    }
    return f;
  }

  private async ensureParentFolder(filePath: string): Promise<void> {
    const parts = filePath.split("/");
    parts.pop(); // remove filename
    if (parts.length === 0) return;
    const folder = normalizePath(parts.join("/"));
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder);
    }
  }

  private appendToSection(content: string, sectionName: string, text: string): string {
    const regex = new RegExp(`(^##\\s+${this.escapeRegex(sectionName)}\\s*\\n)`, "m");
    const match = content.match(regex);
    if (match && match.index !== undefined) {
      const insertPos = match.index + match[0].length;
      return content.slice(0, insertPos) + text + "\n" + content.slice(insertPos);
    }
    // Section not found — append at end
    return content.trimEnd() + `\n\n## ${sectionName}\n${text}\n`;
  }

  private patchFrontmatter(content: string, fields: Record<string, unknown>): string {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!fmMatch) {
      // No frontmatter — create one
      const fm = stringifyYaml(fields);
      return `---\n${fm}---\n\n${content}`;
    }
    try {
      const existing = parseYaml(fmMatch[1]) as Record<string, unknown> ?? {};
      const merged = { ...existing, ...fields };
      return `---\n${stringifyYaml(merged)}---\n\n${fmMatch[2]}`;
    } catch {
      return content;
    }
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // ── Persist execution log ──────────────────────────────────

  private async persistRecord(record: ExecutionRecord): Promise<void> {
    const folder = normalizePath("Knowledge/_Executions");
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder);
    }

    const date = todayIso();
    const safeName = record.plan.title.replace(/[\\/:*?"<>|#[\]]/g, "-").slice(0, 40);
    const fileName = `${date}-${safeName}.md`;
    let path = normalizePath(`${folder}/${fileName}`);

    // Conflict-safe
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${folder}/${date}-${safeName}-${suffix}.md`);
      suffix++;
    }

    const content = this.renderRecord(record);
    await this.app.vault.create(path, content);
  }

  private renderRecord(record: ExecutionRecord): string {
    const { plan } = record;
    const statusEmoji = record.success ? "✅" : "❌";
    return `---
type: execution
schema_version: ${SCHEMA_VERSION}
status: ${record.success ? "done" : "failed"}
source: ${plan.source}
plan_id: ${plan.id}
risk_level: ${plan.riskLevel}
operations_count: ${plan.operations.length}
affected_files: ${record.affectedPaths.length}
executed_at: ${record.executedAt}
created_at: ${plan.createdAt}
---

# ${statusEmoji} ${plan.title}

## 执行计划

${plan.previewMarkdown}

## 影响文件

${record.affectedPaths.map((p) => `- [[${p}]]`).join("\n")}
${record.error ? `\n## 错误\n\n\`\`\`\n${record.error}\n\`\`\`\n` : ""}
`;
  }

  private getPath(op: VaultOperation): string {
    switch (op.type) {
      case "move-file": return op.from;
      default: return (op as { path: string }).path;
    }
  }
}
