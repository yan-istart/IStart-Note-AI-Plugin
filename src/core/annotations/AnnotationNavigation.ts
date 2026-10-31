import type { AnnotationRecord } from "./AnnotationParser";

/** Find an annotation's source range, preferring parsed offsets and falling back to nearby matching text. */
export function locateSourceRange(
  content: string,
  annotation: Pick<AnnotationRecord, "contentStart" | "contentEnd" | "rawText">
): { start: number; end: number } | null {
  const { contentStart, contentEnd, rawText } = annotation;
  if (rawText && content.slice(contentStart, contentEnd) === rawText) {
    return { start: contentStart, end: contentEnd };
  }
  if (!rawText) return null;

  const positions: number[] = [];
  let index = content.indexOf(rawText);
  while (index !== -1 && positions.length < 30) {
    positions.push(index);
    index = content.indexOf(rawText, index + 1);
  }
  if (positions.length === 0) return null;
  positions.sort((a, b) => Math.abs(a - contentStart) - Math.abs(b - contentStart));
  return { start: positions[0], end: positions[0] + rawText.length };
}
