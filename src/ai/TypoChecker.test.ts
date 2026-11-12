import { describe, expect, it, vi } from "vitest";
import type { Editor } from "obsidian";
import { DEFAULT_SETTINGS } from "../types";
import { buildTypoChunks, checkTypos, maskTypoNonProse, parseTypoResponse, selectTypoIssue } from "./TypoChecker";

const typo = { line: 1, original: "再接再励", correction: "再接再厉", occurrence: 1, reason: "成语用字" };
const response = (...issues: unknown[]) => JSON.stringify({ issues });

describe("typo result locations", () => {
  it("resolves line numbers, repeated occurrences and selection-relative offsets", () => {
    const chunk = { start: 12, text: "😀第一句\r\n再接再励，再接再励。" };
    const result = parseTypoResponse(response({ ...typo, line: 2, occurrence: 2 }), chunk);
    const expected = chunk.start + chunk.text.lastIndexOf(typo.original);
    expect(result.issues).toEqual([{ original: typo.original, correction: typo.correction, reason: typo.reason,
      start: expected, end: expected + 4 }]);
    expect(result.unlocatedCount).toBe(0);
  });

  it("rejects ambiguous, invented, out-of-range and unchanged suggestions", () => {
    const { occurrence, ...ambiguous } = typo;
    const result = parseTypoResponse(response(ambiguous, { ...typo, occurrence: 3 },
      { ...typo, line: 3 }, { ...typo, original: "凭空出现" }, { ...typo, correction: typo.original }, null),
    { text: "再接再励，再接再励", start: 0 });
    expect(result.issues).toEqual([]);
    expect(result.unlocatedCount).toBe(6);
  });

  it("accepts fenced JSON, deduplicates and distinguishes malformed output from no findings", () => {
    const chunk = { start: 0, text: "再接再励" };
    expect(parseTypoResponse("```json\n" + response(typo, typo) + "\n```", chunk).issues).toHaveLength(1);
    expect(parseTypoResponse(response(), chunk)).toEqual({ issues: [], unlocatedCount: 0 });
    for (const raw of ["没有错字", "{}", "null", '{"issues":null}', '{"issues":[']) {
      expect(() => parseTypoResponse(raw, chunk)).toThrow("格式无效");
    }
  });

  it("selects the exact original range without modifying the note and refuses stale content", () => {
    const content = "前文😀\n再接再励，再接再励。";
    const issue = parseTypoResponse(response({ ...typo, line: 2, occurrence: 2 }), { text: content, start: 0 }).issues[0];
    const setSelection = vi.fn(), scrollIntoView = vi.fn();
    const editor = { getValue: () => content, setSelection, scrollIntoView,
      offsetToPos: (offset: number) => {
        const lines = content.slice(0, offset).split("\n");
        return { line: lines.length - 1, ch: lines[lines.length - 1].length };
      },
    } as unknown as Editor;
    selectTypoIssue(editor, content, issue);
    expect(setSelection).toHaveBeenCalledWith({ line: 1, ch: 5 }, { line: 1, ch: 9 });
    expect(scrollIntoView).toHaveBeenCalledWith({ from: { line: 1, ch: 5 }, to: { line: 1, ch: 9 } }, true);
    expect(() => selectTypoIssue(editor, "旧的正文", issue)).toThrow("原文已变化");
    expect(() => selectTypoIssue(editor, content, { ...issue, start: 0 })).toThrow("原文已变化");
    expect(setSelection).toHaveBeenCalledTimes(1);
  });
});

describe("typo check input and lifecycle", () => {
  it("masks metadata, code, comments and link destinations while retaining source offsets", () => {
    const content = ["---", "title: 再接再励", "---", "正文再接再励😀", "```ts", "再接再励", "```",
      "行内`再接再励`与[正文](再接再励.md)以及[[再接再励]]", "<!-- 再接再励 -->", "%% 再接再励 %%",
      "https://example.com/再接再励", "    再接再励", "结尾再接再励"].join("\r\n");
    const masked = maskTypoNonProse(content);
    expect(masked.length).toBe(content.length);
    expect(masked.split("\n").length).toBe(content.split("\n").length);
    const occurrences: number[] = [];
    const pattern = /再接再励/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(masked))) occurrences.push(match.index);
    expect(occurrences).toEqual([content.indexOf("正文再接再励") + 2, content.lastIndexOf("再接再励")]);
  });

  it("covers long text and single lines with bounded overlapping chunks and intact emoji", () => {
    const content = ("中😀文".repeat(50) + "。\n").repeat(5);
    const chunks = buildTypoChunks(content, 3, content.length - 3, 41);
    expect(chunks.length).toBeGreaterThan(5);
    let covered = 3;
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(41);
      expect(chunk.start).toBeLessThanOrEqual(covered);
      expect(chunk.text).toBe(content.slice(chunk.start, chunk.start + chunk.text.length));
      expect(chunk.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
      covered = chunk.start + chunk.text.length;
    }
    expect(covered).toBe(content.length - 3);
  });

  it("only sends selected prose and keeps global positions", async () => {
    const content = "前文再接再励\n😀中间再接再励\n后文再接再励";
    const from = content.indexOf("😀"), to = content.lastIndexOf("\n");
    const chat = vi.fn().mockResolvedValue(response(typo));
    const progress = vi.fn();
    const result = await checkTypos(DEFAULT_SETTINGS, content, { from, to, onProgress: progress }, { chat });
    expect(chat.mock.calls[0][0].userPrompt).toBe("1: 😀中间再接再励");
    expect(result.issues[0].start).toBe(content.indexOf("再接再励", from));
    expect(progress).toHaveBeenLastCalledWith(1, 1);
  });

  it("does not send code-only input, propagates errors and ignores cancelled late responses", async () => {
    const chat = vi.fn();
    await expect(checkTypos(DEFAULT_SETTINGS, "```\n再接再励\n```", {}, { chat }))
      .resolves.toEqual({ issues: [], unlocatedCount: 0 });
    expect(chat).not.toHaveBeenCalled();
    chat.mockRejectedValueOnce(new Error("服务不可用"));
    await expect(checkTypos(DEFAULT_SETTINGS, "再接再励", {}, { chat })).rejects.toThrow("服务不可用");
    const controller = new AbortController();
    chat.mockImplementationOnce(async () => { controller.abort(); return response(typo); });
    await expect(checkTypos(DEFAULT_SETTINGS, "再接再励".repeat(2000), { signal: controller.signal }, { chat }))
      .rejects.toThrow("已停止");
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("finds a typo straddling a forced chunk boundary and deduplicates overlapping suggestions", async () => {
    const content = "甲".repeat(5998) + "再接再励" + "乙".repeat(6200) + "再接再励";
    const chat = vi.fn().mockImplementation(async ({ userPrompt }: { userPrompt: string }) => {
      const lines = userPrompt.split("\n").map(line => line.replace(/^\d+: /, ""));
      const issues: unknown[] = [];
      lines.forEach((line, i) => {
        const count = line.split(typo.original).length - 1;
        for (let occurrence = 1; occurrence <= count; occurrence++) issues.push({ ...typo, line: i + 1, occurrence });
      });
      return response(...issues);
    });
    const result = await checkTypos(DEFAULT_SETTINGS, content, {}, { chat });
    expect(result.issues.map(issue => issue.start)).toEqual([5998, content.lastIndexOf("再接再励")]);
  });
});
