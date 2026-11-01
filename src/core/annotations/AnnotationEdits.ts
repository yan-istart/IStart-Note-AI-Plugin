import type { AnnotationRecord, TextRange } from "./AnnotationParser";

/** Sort and merge overlapping or touching ranges. */
export function mergeRanges(ranges: TextRange[]): TextRange[] {
  const valid = ranges
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
    .map((range) => ({ start: Math.max(0, range.start), end: Math.max(0, range.end) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: TextRange[] = [];
  for (const range of valid) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/** Ranges that remove an annotation's syntax while preserving the annotated text. */
export function buildDeletionRanges(content: string, annotation: AnnotationRecord): TextRange[] {
  const ranges = annotation.deleteRanges.slice();
  for (const definition of annotation.footnoteDefinitions) {
    // Keep a shared footnote definition when another reference still uses it.
    if (countFootnoteReferences(content, definition, annotation.deleteRanges) === 0) ranges.push(definition.range);
  }
  return mergeRanges(ranges);
}

/** Apply ranges to a string. Ranges may be in any order. */
export function applyTextRanges(content: string, ranges: TextRange[]): string {
  const merged = mergeRanges(ranges).sort((a, b) => b.start - a.start);
  let result = content;
  for (const range of merged) {
    result = result.slice(0, range.start) + result.slice(range.end);
  }
  return result;
}

export function countFootnoteReferences(
  content: string,
  definition: { id: string; range: TextRange },
  excludeRanges: TextRange[] = []
): number {
  const pattern = new RegExp(`\\[\\^${escapeRegExp(definition.id)}\\]`, "g");
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    if (match.index >= definition.range.start && match.index < definition.range.end) continue;
    if (excludeRanges.some((range) => match!.index >= range.start && match!.index < range.end)) continue;
    count++;
  }
  return count;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
