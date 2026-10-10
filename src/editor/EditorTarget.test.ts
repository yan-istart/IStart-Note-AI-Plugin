import { describe, expect, it, vi } from "vitest";
import type { App, Editor, EditorPosition, TFile } from "obsidian";
import { captureEditorTarget, writeEditorResult } from "./EditorTarget";

function document(content = "原文\n第二段") {
  let text = content;
  let from = { line: 0, ch: 2 }, to = { ...from };
  const offset = (pos: EditorPosition) => text.split("\n").slice(0, pos.line).reduce((n, line) => n + line.length + 1, 0) + pos.ch;
  const position = (n: number) => {
    const lines = text.slice(0, n).split("\n");
    return { line: lines.length - 1, ch: lines[lines.length - 1].length };
  };
  const editor = {
    getValue: () => text,
    getCursor: (side?: string) => side === "from" ? from : to,
    getSelection: () => text.slice(offset(from), offset(to)),
    posToOffset: offset, offsetToPos: position,
    replaceRange: (insert: string, start: EditorPosition, end = start) => { text = text.slice(0, offset(start)) + insert + text.slice(offset(end)); },
    setCursor: (pos: EditorPosition) => { from = { ...pos }; to = { ...pos }; },
    scrollIntoView: vi.fn(),
  } as unknown as Editor;
  const file = { path: "chapter.md" } as TFile;
  let activeFile = file;
  const app = { workspace: { activeEditor: { editor }, getActiveFile: () => activeFile } } as unknown as App;
  return {
    app, editor, file, text: () => text,
    select: (a: EditorPosition, b: EditorPosition) => { from = a; to = b; },
    changeText: (value: string) => { text = value; },
    switchFile: () => { activeFile = { path: "other.md" } as TFile; },
  };
}

describe("writes bound to the original editor context", () => {
  it("uses the captured cursor after UI moves the live cursor", () => {
    const doc = document();
    const target = captureEditorTarget(doc.app)!;
    doc.editor.setCursor({ line: 1, ch: 3 });
    writeEditorResult(doc.app, target, { mode: "insert", content: "续文" });
    expect(doc.text()).toBe("原文\n续文\n\n第二段");
  });

  it("replaces the captured selection even when the live selection changes", () => {
    const doc = document();
    doc.select({ line: 0, ch: 0 }, { line: 0, ch: 2 });
    const target = captureEditorTarget(doc.app)!;
    doc.select({ line: 1, ch: 0 }, { line: 1, ch: 3 });
    writeEditorResult(doc.app, target, { mode: "replace", content: "润色" });
    expect(doc.text()).toBe("润色\n第二段");
  });

  it("returns an updated target after insertion so continuation includes the accepted text", () => {
    const doc = document("上文");
    const next = writeEditorResult(doc.app, captureEditorTarget(doc.app)!, { mode: "insert", content: "第一段续文" });
    expect(next.content.slice(0, doc.editor.posToOffset(next.cursor))).toContain("第一段续文");
    writeEditorResult(doc.app, next, { mode: "insert", content: "第二段续文" });
    expect(doc.text()).toBe("上文\n第一段续文\n\n第二段续文\n");
  });

  it("appends at the document end regardless of the captured cursor", () => {
    const doc = document();
    writeEditorResult(doc.app, captureEditorTarget(doc.app)!, { mode: "append", content: "文末续写" });
    expect(doc.text()).toBe("原文\n第二段\n\n文末续写\n");
  });

  it("refuses a changed document, including a duplicate write", () => {
    const doc = document();
    const target = captureEditorTarget(doc.app)!;
    const result = { mode: "insert" as const, content: "续文" };
    writeEditorResult(doc.app, target, result);
    const accepted = doc.text();
    expect(() => writeEditorResult(doc.app, target, result)).toThrow("原文已发生变化");
    expect(doc.text()).toBe(accepted);
  });

  it("refuses switched, rebound, or renamed files", () => {
    const doc = document();
    const target = captureEditorTarget(doc.app)!;
    doc.switchFile();
    expect(() => writeEditorResult(doc.app, target, { mode: "insert", content: "续文" })).toThrow("原文档");
    expect(doc.text()).toBe(target.content);
    const renamed = document();
    const original = captureEditorTarget(renamed.app)!;
    renamed.file.path = "renamed.md";
    expect(() => writeEditorResult(renamed.app, original, { mode: "insert", content: "续文" })).toThrow("原文档");
    const rebound = document();
    const bound = captureEditorTarget(rebound.app)!;
    rebound.app.workspace.activeEditor!.editor = {} as Editor;
    expect(() => writeEditorResult(rebound.app, bound, { mode: "insert", content: "续文" })).toThrow("原文档");
  });
});
