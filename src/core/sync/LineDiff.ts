export interface DiffLine { kind: "equal" | "added" | "deleted"; text: string; oldLine?: number; newLine?: number }

/** Bounded LCS; callers fall back to side-by-side text for very large inputs. */
export function lineDiff(before: string, after: string): DiffLine[] | null {
  const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const a = lines(before), b = lines(after);
  if (a.length + b.length > 5000 || (a.length + 1) * (b.length + 1) > 1_000_000) return null;
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1
      : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  }
  const result: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      result.push({ kind: "equal", text: a[i], oldLine: ++i, newLine: ++j });
    } else if (i < a.length && (j === b.length || table[(i + 1) * width + j] >= table[i * width + j + 1])) {
      result.push({ kind: "deleted", text: a[i], oldLine: ++i });
    } else result.push({ kind: "added", text: b[j], newLine: ++j });
  }
  return result;
}
