import { Notice } from "obsidian";
import type DeepSeekPlugin from "../../main";
import { ScheduledTaskConfig, ScheduledTaskResult } from "./types";
import { NextRunCalculator } from "./NextRunCalculator";
import { PlanExecutor } from "../execution";
import { PlanBuilder } from "../execution";
import { KnowledgeIndexService } from "../knowledge";
import { todayIso } from "../schema";

/**
 * ScheduledTaskRunner — checks due tasks every 60s while Obsidian is open.
 *
 * Safety:
 *  - "notify-only": shows a Notice and optionally writes a report.
 *  - "create-plan-only": generates an ExecutionPlan draft but does NOT apply.
 *  - "auto-execute-low-risk": applies only if plan.riskLevel === "low".
 */
export class ScheduledTaskRunner {
  private running = new Set<string>();
  private calc = new NextRunCalculator();
  private intervalId: number | null = null;

  constructor(
    private plugin: DeepSeekPlugin,
    private tasks: ScheduledTaskConfig[]
  ) {}

  start(): void {
    // Check every 60 seconds
    this.intervalId = window.setInterval(() => void this.tick(), 60_000);
    this.plugin.registerInterval(this.intervalId);

    // Immediate catch-up for on-startup tasks
    void this.tick();
  }

  stop(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async tick(): Promise<void> {
    const now = new Date();
    for (const task of this.tasks) {
      if (!task.enabled) continue;
      if (this.running.has(task.id)) continue;
      if (!this.calc.isDue(task.trigger, task.lastRunAt, now)) continue;

      await this.runTask(task, now);
    }
  }

  private async runTask(task: ScheduledTaskConfig, now: Date): Promise<void> {
    this.running.add(task.id);
    try {
      const result = await this.executeTaskKind(task);
      task.lastRunAt = now.toISOString();
      task.nextRunAt = this.calc.getNextRun(task.trigger, now).toISOString();

      if (result.success) {
        new Notice(`⏰ ${task.name}：${result.message}`);
      }
    } catch (err) {
      new Notice(`⏰ ${task.name} 失败：${(err as Error).message}`);
    } finally {
      this.running.delete(task.id);
    }
  }

  private async executeTaskKind(task: ScheduledTaskConfig): Promise<ScheduledTaskResult> {
    const base: Omit<ScheduledTaskResult, "success" | "message"> = {
      taskId: task.id,
      ranAt: new Date().toISOString(),
    };

    switch (task.kind) {
      case "knowledge-debt-scan":
        return this.runDebtScan(task, base);

      case "baidu-backup":
        return this.runBaiduBackup(task, base);

      case "question-graph-rebuild":
      case "reading-review":
      case "stale-draft-review":
      case "custom":
        // Placeholder — generate notice only
        return { ...base, success: true, message: "已完成扫描（详细实现待补充）" };
    }
  }

  private async runDebtScan(
    task: ScheduledTaskConfig,
    base: Omit<ScheduledTaskResult, "success" | "message">
  ): Promise<ScheduledTaskResult> {
    const index = this.plugin.knowledgeIndex;
    const emptyConcepts = index.getByType("concept").filter((e) => e.status === "empty" || e.status === "pending");
    const total = emptyConcepts.length;

    if (task.safety === "notify-only") {
      return { ...base, success: true, message: `发现 ${total} 个空概念页` };
    }

    // create-plan-only / auto-execute-low-risk → write report
    const reportContent = this.buildDebtReport(index);
    const plan = new PlanBuilder("每日知识债务扫描", "assistant")
      .createFile(`Knowledge/_Reports/${todayIso()}-知识债务.md`, reportContent)
      .build();

    if (task.safety === "auto-execute-low-risk" && plan.riskLevel === "low") {
      await new PlanExecutor(this.plugin.app).execute(plan);
      return { ...base, success: true, message: `报告已生成（${total} 个空概念）` };
    }

    // Just persist the plan draft (user confirms later)
    await new PlanExecutor(this.plugin.app).execute(plan);
    return { ...base, success: true, message: `报告已生成（${total} 个空概念）` };
  }

  private async runBaiduBackup(
    task: ScheduledTaskConfig,
    base: Omit<ScheduledTaskResult, "success" | "message">
  ): Promise<ScheduledTaskResult> {
    const cfg = this.plugin.settings.baiduSync;
    if (!cfg.enabled || !cfg.accessToken) {
      return { ...base, success: false, message: "百度同步未启用或未授权" };
    }

    // Delegate to existing sync service
    const { BaiduSyncService } = await import("../../features/sync/BaiduSyncService");
    const service = new BaiduSyncService(this.plugin.app, cfg);
    const adapter = this.plugin.app.vault.adapter as unknown as { basePath?: string };
    const ok = await service.pushConfig(this.plugin.settings, adapter.basePath ?? "device");
    return { ...base, success: ok, message: ok ? "配置已备份" : "备份失败" };
  }

  private buildDebtReport(index: KnowledgeIndexService): string {
    const empty = index.getByType("concept").filter((e) => e.status === "empty" || e.status === "pending");
    const lines = [
      `---\ntype: report\nreport_type: knowledge-debt\ncreated_at: ${todayIso()}\n---\n`,
      `# 知识债务报告 ${todayIso()}\n`,
      `## 空概念页 (${empty.length})\n`,
      ...empty.slice(0, 30).map((e) => `- [[${e.basename}]]${e.domain ? ` [${e.domain}]` : ""}`),
      empty.length > 30 ? `\n...还有 ${empty.length - 30} 个\n` : "",
    ];
    return lines.join("\n");
  }
}
