/**
 * Scheduled task types for IStart-Note-AI.
 *
 * Tasks run ONLY while Obsidian is open and the plugin is enabled.
 * If a scheduled run is missed, the runner offers catch-up on next launch.
 */

export type ScheduledTaskKind =
  | "knowledge-debt-scan"
  | "baidu-backup"
  | "question-graph-rebuild"
  | "reading-review"
  | "stale-draft-review"
  | "custom";

export type ScheduleTrigger =
  | { type: "on-startup" }
  | { type: "interval"; minutes: number }
  | { type: "daily"; time: string }         // "22:00" (HH:mm, local)
  | { type: "weekly"; weekday: number; time: string }; // weekday: 0=Sun

export type ScheduledTaskSafety =
  | "notify-only"
  | "create-plan-only"
  | "auto-execute-low-risk";

export interface ScheduledTaskConfig {
  id: string;
  name: string;
  enabled: boolean;
  kind: ScheduledTaskKind;
  trigger: ScheduleTrigger;
  safety: ScheduledTaskSafety;
  lastRunAt?: string;  // ISO
  nextRunAt?: string;  // ISO
  scope?: {
    paths?: string[];
    types?: string[];
    domains?: string[];
  };
}

export interface ScheduledTaskResult {
  taskId: string;
  ranAt: string;
  success: boolean;
  message: string;
}
