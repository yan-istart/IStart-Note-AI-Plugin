import { lineDiff, DiffLine } from "./LineDiff";

export interface SyncConflict {
  path: string;
  key: string;
  local?: string;
  remote?: string;
  base?: string;
  binary: boolean;
  localExists: boolean;
  remoteExists: boolean;
  baseExists?: boolean;
  localSize: number;
  remoteSize: number;
  baseSize?: number;
}

export type SyncResolution = { choice: "local" | "remote" } | { choice: "text"; text: string };
export interface ConflictVersion { exists: boolean; text?: string; size: number }
export type ConflictComparison = "pair" | "local" | "remote" | "result";

export function conflictVersion(conflict: SyncConflict, side: "local" | "remote" | "base"): ConflictVersion {
  return { exists: conflict[`${side}Exists`] === true, text: conflict.binary ? undefined : conflict[side], size: conflict[`${side}Size`] ?? 0 };
}

export function conflictKind(conflict: SyncConflict): string {
  if (!conflict.localExists && !conflict.remoteExists) return "两端均不存在";
  if (!conflict.localExists) return conflict.baseExists === undefined ? "本地不存在 / 云端存在" : "本地删除 / 云端修改";
  if (!conflict.remoteExists) return conflict.baseExists === undefined ? "本地存在 / 云端不存在" : "本地修改 / 云端删除";
  if (conflict.binary) return "附件或大文件冲突";
  return conflict.baseExists === false ? "同名新增" : conflict.baseExists === true ? "双方修改" : "两端内容冲突";
}

export function resolvedVersion(conflict: SyncConflict, resolution: SyncResolution): ConflictVersion {
  if (resolution.choice === "text") {
    if (conflict.binary) throw new Error("附件或大文件不能使用文本合并");
    return { exists: true, text: resolution.text, size: new TextEncoder().encode(resolution.text).length };
  }
  return conflictVersion(conflict, resolution.choice);
}

export function compareVersions(before: ConflictVersion, after: ConflictVersion): DiffLine[] | null {
  if (before.size > 1_000_000 || after.size > 1_000_000) return null;
  if ((before.exists && before.text === undefined) || (after.exists && after.text === undefined)) return null;
  return lineDiff(before.text ?? "", after.text ?? "");
}

export function differenceSummary(before: ConflictVersion, after: ConflictVersion): string {
  const lines = compareVersions(before, after);
  if (!lines) return `大小 ${before.size} → ${after.size} 字节 · 不展开逐行差异`;
  return `新增 ${lines.filter(line => line.kind === "added").length} 行 / 移除 ${lines.filter(line => line.kind === "deleted").length} 行`;
}

export class ConflictSession {
  readonly selected = new Set<string>();
  readonly choices: Map<string, SyncResolution>;
  readonly summaries = new Map<string, string>();

  constructor(readonly conflicts: readonly SyncConflict[], previous = new Map<string, SyncResolution>()) {
    this.choices = new Map(previous);
    for (const conflict of conflicts) {
      if (conflict.binary && this.choices.get(conflict.key)?.choice === "text") this.choices.delete(conflict.key);
    }
  }

  summary(conflict: SyncConflict): string {
    let summary = this.summaries.get(conflict.key);
    if (summary === undefined) {
      summary = differenceSummary(conflictVersion(conflict, "local"), conflictVersion(conflict, "remote"));
      this.summaries.set(conflict.key, summary);
    }
    return summary;
  }

  get assigned(): number { return this.conflicts.filter(conflict => this.choices.has(conflict.key)).length; }
  get ready(): boolean { return this.conflicts.length > 0 && this.assigned === this.conflicts.length; }

  choose(conflict: SyncConflict, choice: "local" | "remote" | "text" | "", draft = conflict.local ?? ""): void {
    if (!choice) this.choices.delete(conflict.key);
    else if (choice === "text") {
      if (conflict.binary) throw new Error("附件或大文件不能使用文本合并");
      this.choices.set(conflict.key, { choice, text: draft });
    } else this.choices.set(conflict.key, { choice });
  }

  assignSelected(choice: "local" | "remote" | ""): void {
    for (const conflict of this.conflicts) if (this.selected.has(conflict.key)) this.choose(conflict, choice);
  }

  comparison(conflict: SyncConflict, mode: ConflictComparison): { before: ConflictVersion; after: ConflictVersion; label: string } {
    const local = conflictVersion(conflict, "local");
    if (mode === "local" || mode === "remote") {
      if (conflict.baseExists === undefined) throw new Error("文件模式没有共同内容快照");
      return { before: conflictVersion(conflict, "base"), after: conflictVersion(conflict, mode), label: `共同版本 → ${mode === "local" ? "本地" : "云端"}` };
    }
    if (mode === "result") {
      const resolution = this.choices.get(conflict.key);
      if (!resolution) throw new Error("请先为此文件选择处理方式");
      return { before: local, after: resolvedVersion(conflict, resolution), label: "本地 → 处理结果" };
    }
    return { before: local, after: conflictVersion(conflict, "remote"), label: "本地 → 云端" };
  }
}
