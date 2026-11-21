/** Recent terminal input used to detect duplicate IME commits. */
export interface RecentTerminalData {
  text: string;
  at: number;
}

/**
 * xterm sends a composed CJK text twice when a keydown (e.g. Enter) finalizes
 * the composition before `compositionend` fires: once immediately, once from
 * the deferred composition handler (xterm issues #5778/#6140). Decide whether
 * the compositionend commit still needs to be forwarded.
 */
export function imeCommitAction(
  recent: RecentTerminalData[],
  data: string,
  now: number,
  windowMs = 200,
): "send" | "skip" {
  if (!data) return "send";
  return recent.some(entry =>
    now - entry.at <= windowMs && (entry.text === data || entry.text.endsWith(data))
  ) ? "skip" : "send";
}
