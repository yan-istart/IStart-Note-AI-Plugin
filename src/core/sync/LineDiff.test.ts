import { describe, expect, it } from "vitest";
import { lineDiff } from "./LineDiff";

describe("line diff", () => {
  it("preserves unchanged context and numbers additions/deletions", () => {
    expect(lineDiff("a\nb\nc\n", "a\nnew\nc\n")).toEqual([
      { kind: "equal", text: "a\n", oldLine: 1, newLine: 1 },
      { kind: "deleted", text: "b\n", oldLine: 2 },
      { kind: "added", text: "new\n", newLine: 2 },
      { kind: "equal", text: "c\n", oldLine: 3, newLine: 3 },
    ]);
  });
  it("reconstructs both versions including CRLF, blank lines, and final newline changes", () => {
    for (const [before, after] of [["", "新增\n"], ["old", ""], ["a\n", "a"], ["a\r\n\r\nb", "a\r\n新\r\n\r\nb"], ["repeat\nrepeat\n", "repeat\n"]]) {
      const result = lineDiff(before, after)!;
      expect(result.filter(l => l.kind !== "added").map(l => l.text).join("")).toBe(before);
      expect(result.filter(l => l.kind !== "deleted").map(l => l.text).join("")).toBe(after);
    }
  });
  it("bounds memory for long documents", () => {
    expect(lineDiff("a\n".repeat(1500), "b\n".repeat(1500))).toBeNull();
  });
});
