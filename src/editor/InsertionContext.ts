import type { WritingContextScope } from "../features/writing/types";

export interface InsertionContext {
  before: string;
  after: string;
}

/** Read both sides of the insertion point; YAML metadata is not preceding prose. */
export function getWritingPassages(content: string, cursorOffset: number, contextChars = 2000, scope: WritingContextScope = "full"): InsertionContext | null {
  const frontmatter = content.match(/^---\r?\n(?:[\s\S]*?\r?\n)?---(?:\r?\n|$)/);
  const bodyStart = frontmatter?.[0].length ?? 0;
  if (cursorOffset < bodyStart) return null;
  const before = content.slice(bodyStart, cursorOffset).trimEnd();
  const after = content.slice(cursorOffset).trimStart();
  if (scope === "full") return { before, after };
  const limit = Math.max(1, Math.floor(Number.isFinite(contextChars) ? contextChars : 2000));
  return { before: before.slice(-limit), after: after.slice(0, limit) };
}
export function getInsertionContext(content: string, cursorOffset: number, contextChars = 2000, scope: WritingContextScope = "full"): InsertionContext | null {
  const context = getWritingPassages(content, cursorOffset, contextChars, scope);
  return context?.before.trim() && context.after.trim() ? context : null;
}
