import { App, TFile, normalizePath } from "obsidian";
import { ExecutionPlan } from "./types";
import { SCHEMA_VERSION, todayIso } from "../schema";

/**
 * PlanDraftStore — persists an ExecutionPlan as a "pending" draft note.
 *
 * The draft is NOT executed; it's stored for the user to review and manually confirm.
 * This is the correct behavior for `create-plan-only` safety level.
 */
export class PlanDraftStore {
  private folder = "Knowledge/_ExecutionPlans";

  constructor(private app: App) {}

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
    return await this.app.vault.create(path, content);
  }

  private renderDraft(plan: ExecutionPlan): string {
    const ops = plan.operations.map((op, i) => {
      const type = op.type;
      const target = "path" in op ? (op as { path: string }).path : (op as { from: string }).from;
      return `${i + 1}. \`${type}\` → \`${target}\``;
    }).join("\n");

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
> 请审阅后手动确认执行，或删除此文件取消。

## 风险等级

${plan.riskLevel === "high" ? "🔴 高" : plan.riskLevel === "medium" ? "🟡 中" : "🟢 低"}

## 操作列表

${ops}

## 预览

${plan.previewMarkdown}
`;
  }

  private async ensureFolder(path: string): Promise<void> {
    if (!this.app.vault.getAbstractFileByPath(path)) {
      await this.app.vault.createFolder(path);
    }
  }
}
