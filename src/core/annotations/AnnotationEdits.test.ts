import { describe, expect, it } from "vitest";
import { parseAnnotations } from "./AnnotationParser";
import { applyTextRanges, buildDeletionRanges, mergeRanges } from "./AnnotationEdits";

describe("annotation deletion", () => {
  it("removes highlight markers and an inline comment while keeping the text", () => {
    const content = "前文 ==重点==^[批注]\n";
    const [annotation] = parseAnnotations(content);
    const ranges = buildDeletionRanges(content, annotation);
    expect(applyTextRanges(content, ranges)).toBe("前文 重点\n");
  });

  it("removes a footnote reference and its unique definition", () => {
    const content = "前文 ==重点==[^1]\n\n[^1]: 批注\n";
    const [annotation] = parseAnnotations(content);
    const ranges = buildDeletionRanges(content, annotation);
    expect(applyTextRanges(content, ranges)).toBe("前文 重点\n\n");
  });

  it("keeps a footnote definition that still has another reference", () => {
    const content = "==重点==[^1]\n\n另见[^1]\n\n[^1]: 共享批注\n";
    const annotation = parseAnnotations(content).find((item) => item.source === "highlight")!;
    const ranges = buildDeletionRanges(content, annotation);
    const result = applyTextRanges(content, ranges);
    expect(result).toContain("[^1]: 共享批注");
    expect(result).toContain("另见[^1]");
  });

  it("removes an Obsidian comment entirely", () => {
    const content = "正文 %%隐藏批注%% 结束";
    const [annotation] = parseAnnotations(content);
    expect(applyTextRanges(content, buildDeletionRanges(content, annotation))).toBe("正文  结束");
  });

  it("merges overlapping ranges", () => {
    expect(mergeRanges([
      { start: 5, end: 9 },
      { start: 1, end: 3 },
      { start: 3, end: 6 },
      { start: 12, end: 14 },
    ])).toEqual([
      { start: 1, end: 9 },
      { start: 12, end: 14 },
    ]);
  });
});
