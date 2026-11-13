import type { ChangeProposal, FileChange } from "./types";

export function validateNotePath(path: string): string {
  if (!path || path.length > 500 || !path.endsWith(".md") || /[\\:*?"<>|]/.test(path) || Array.from(path).some(char => char.charCodeAt(0) < 32) || path.split("/").some(p => !p || p.startsWith(".") || p.trim() !== p)) throw new Error("只能读写 Vault 中有效的 Markdown 笔记路径");
  return path;
}
export function noteName(title: string): string {
  const name = Array.from(title, char => char.charCodeAt(0) < 32 ? "-" : char).join("").replace(/[\\/:*?"<>|#[\]]/g, "-").replace(/^\.+/, "").trim().slice(0, 80);
  return name || "AI 笔记";
}
export interface ChangeIO {
  read(path: string): Promise<string | null>;
  /** Must compare before again at the point of writing. */
  write(change: FileChange): Promise<void>;
}
/** Combine overlapping drafts while retaining the original compare-and-write baseline. */
export function coalesceProposal(existing: ChangeProposal[], incoming: ChangeProposal): { proposal: ChangeProposal; superseded: ChangeProposal[] } {
  const paths = new Set(incoming.changes.map(c => c.path));
  const superseded: ChangeProposal[] = [];
  for (let changed = true; changed;) {
    changed = false;
    for (const p of existing) if (p.status === "pending" && !superseded.includes(p) && p.changes.some(c => paths.has(c.path))) {
      superseded.push(p); p.changes.forEach(c => paths.add(c.path)); changed = true;
    }
  }
  const files = new Map<string, FileChange>();
  for (const p of [...superseded, incoming]) for (const c of p.changes) {
    const previous = files.get(c.path);
    if (previous && previous.before !== c.before && previous.after !== c.before) throw new Error(`草稿基准冲突：${c.path}。请应用或放弃已有草稿后重新生成。`);
    files.set(c.path, { ...c, before: previous ? previous.before : c.before });
  }
  return { proposal: { ...incoming, changes: [...files.values()] }, superseded };
}
export async function applyChanges(proposal: ChangeProposal, io: ChangeIO): Promise<void> {
  if (proposal.status === "applied") return;
  if (proposal.status !== "pending") throw new Error("这份修改当前无法应用");
  if (!proposal.changes.length || new Set(proposal.changes.map(c => c.path)).size !== proposal.changes.length) throw new Error("修改列表为空或包含重复路径");
  const pending: FileChange[] = [];
  for (const c of proposal.changes) {
    validateNotePath(c.path);
    const actual = await io.read(c.path);
    if (actual === c.after) continue; // Recover after a crash or partially completed multi-file write.
    if (actual !== c.before) throw new Error(`原文已发生变化或文件名已被占用：${c.path}。请基于新原文重新生成。`);
    pending.push(c);
  }
  proposal.status = "applying";
  try {
    for (const c of pending) await io.write(c);
    proposal.status = "applied";
  } catch (error) {
    proposal.status = "pending";
    throw error;
  }
}
export function changedRange(before: string, after: string): { start: number; end: number; text: string } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let oldEnd = before.length, newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  return { start, end: oldEnd, text: after.slice(start, newEnd) };
}
