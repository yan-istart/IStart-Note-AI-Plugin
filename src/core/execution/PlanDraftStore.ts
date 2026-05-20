import { App, TFile, normalizePath } from "obsidian";
import { ExecutionPlan } from "./types";
import { SCHEMA_VERSION, todayIso } from "../schema";

/**
 * PlanDraftStore — persists an ExecutionPlan as a "pending" draft note
 * and stores the raw plan data separately for programmatic recovery.
 *
 * The draft note is human-readable. The JSON is stored in plugin data
 * (not in the note) so users don't see raw technical payload.
 *
 * Execution flow:
 *   1. persistDraft(plan) → saves note + stores plan in memory/plugin data
 *   2. User reviews the note
 *   3. User triggers "确认执行此计划" → loadPlan(planId) → PlanExecutor.execute()
 *   4. Draft note status updated to "executed" or deleted
 */
export class PlanDraftStore {
  private folder = "Knowledge/_ExecutionPlans";
  /** In-memory plan cache, keyed by plan_id. */
  private planCache: Map<string, ExecutionPlan> = new Map();

  constructor(private app: App) {}

  /** Save a plan draft note and cache the raw plan for later execution. */
  async persistDraft(plan: ExecutionPlan): Promise<TFile> {
    const folder = normalizePath(this.folder);
    await this.ensureFolder(folder);

    const safeName = plan.title.replace(/[\\/:*?"<>|#[\]]/g, "-").slice(0, 40);
    let path = normalizePath(`${folder}/${todayIso()}-${safeName}.md`);
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${folder}/${todayIso()}-${safeName}-${suffix}.md`);
      suffix++;
    }

    const content = this.renderDraft(plan);
    const file = await this.app.vault.create(path, content);

    // Cache plan for later execution
    this.planCache.set(plan.id, plan);

    return file;
  }

  /** Retrieve a cached plan by ID (for "confirm and execute" flow). */
  getPlan(planId: string): ExecutionPlan | undefined {
    return this.planCache.get(planId);
  }

  /** Mark a draft as executed by updating its frontmatter status. */
  async markExecuted(file: TFile): Promise<void> {
    let content = await this.app.vault.read(file);
    content = content.replace("status: pending", "status: executed");
    content = content.replace(
      "> [!warning] 此计划尚未执行\n> 请审阅后在命令面板中选择「确认执行此计划」，或删除此文件取消。",
      "> [!success] 此计划已执行\n> 执行记录已保存到 Knowledge/_Executions/"
    );
    await this.app.vault.modify(file, content);
  }

  /** List all pending plan files. */
  getPendingPlans(): TFile[] {
    const folder = normalizePath(this.folder);
    return this.app.vault.getMarkdownFiles()
      .filter((f) => f.path.startsWith(folder + "/"))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
  }

  private renderDraft(plan: ExecutionPlan): string {
    const riskLabel = plan.riskLevel === "high" ? "🔴 高风险"
      : plan.riskLevel === "medium" ? "🟡 中风险"
      : "🟢 低风险";

    const ops = plan.operations.map((op, i) => {
      const desc = this.describeOp(op);
      return `${i + 1}. ${desc}`;
    }).join("\n");

    const affectedFiles = [...new Set(plan.operations.map((op) => {
      return "path" in op ? (op as { path: string }).path : (op as { from: string }).from;
    }))];

    const fileList = affectedFiles.map((f) => `- \`${f}\``).join("\n");

    return `---
type: execution-plan
schema_version: ${SCHEMA_VERSION}
status: pending
plan_id: ${plan.id}
source: ${plan.source}
risk_level: ${plan.riskLevel}
operations_count: ${plan.operations.length}
created_at: ${plan.createdAt}
---

# 📋 待确认计划：${plan.title}

> [!warning] 此计划尚未执行
> 请审阅后在命令面板中选择「确认执行此计划」，或删除此文件取消。

## 概览

| 项目 | 值 |
| --- | --- |
| 来源 | ${plan.source} |
| 风险等级 | ${riskLabel} |
| 操作数 | ${plan.operations.length} |
| 影响文件数 | ${affectedFiles.length} |
| 创建时间 | ${plan.createdAt} |

## 将执行的操作

${ops}

## 影响文件

${fileList}

## 详细预览

${plan.previewMarkdown}
`;
  }

  private describeOp(op: ExecutionPlan["operations"][number]): string {
    switch (op.type) {
      case "create-file": return `创建文件 \`${op.path}\``;
      case "modify-file": return `修改文件 \`${op.path}\`${op.description ? ` — ${op.description}` : ""}`;
      case "append-section": return `追加到 \`${op.path}\` 的 §${op.section}`;
      case "replace-selection": return `替换 \`${op.path}\` 中的文本`;
      case "move-file": return `移动 \`${op.from}\` → \`${op.to}\``;
      case "create-link": return `在 \`${op.path}\` 中添加链接 → \`${op.target}\``;
      case "update-frontmatter": return `更新 \`${op.path}\` 的 frontmatter（${Object.keys(op.fields).join(", ")}）`;
    }
  }

  private async ensureFolder(path: string): Promise<void> {
    if (!this.app.vault.getAbstractFileByPath(path)) {
      await this.app.vault.createFolder(path);
    }
  }
}
