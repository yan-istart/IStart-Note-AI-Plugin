import { describe, expect, it, vi } from "vitest";
import type { App, Editor, EditorPosition } from "obsidian";
import { TFile } from "obsidian";
import type { EditorTarget } from "../../editor/EditorTarget";
import { AnnotationService, applyTextEdits, escapeInlineComment, findCurrentAnnotation, nextFootnoteId } from "./AnnotationService";
import { parseAnnotations } from "../../core/annotations/AnnotationParser";
import { locateSourceRange } from "../../core/annotations/AnnotationNavigation";

function fixture(content: string, from: EditorPosition, to: EditorPosition) {
  let text = content;
  let selectionFrom = { ...from };
  let selectionTo = { ...to };
  const offset = (position: EditorPosition) =>
    text.split("\n").slice(0, position.line).reduce((total, line) => total + line.length + 1, 0) + position.ch;
  const position = (value: number): EditorPosition => {
    const lines = text.slice(0, value).split("\n");
    return { line: lines.length - 1, ch: lines[lines.length - 1].length };
  };
  const editor = {
    getValue: () => text,
    getCursor: (side?: string) => (side === "from" ? selectionFrom : selectionTo),
    getSelection: () => text.slice(offset(selectionFrom), offset(selectionTo)),
    posToOffset: offset,
    offsetToPos: position,
    setCursor: (value: EditorPosition) => { selectionFrom = { ...value }; selectionTo = { ...value }; },
    setSelection: (start: EditorPosition, end: EditorPosition) => { selectionFrom = { ...start }; selectionTo = { ...end }; },
    scrollIntoView: vi.fn(),
    transaction: (tx: { changes?: { from: EditorPosition; to: EditorPosition; text: string }[] }) => {
      const changes = (tx.changes ?? []).slice().sort((a, b) => offset(b.from) - offset(a.from));
      for (const change of changes) {
        text = text.slice(0, offset(change.from)) + change.text + text.slice(offset(change.to));
      }
    },
  } as unknown as Editor;
  const file = new TFile();
  file.path = "note.md";
  const app = {
    workspace: {
      activeEditor: { editor, file },
      getActiveFile: () => file,
      getLeavesOfType: () => [],
    },
    vault: {
      getAbstractFileByPath: () => file,
      read: async () => text,
      modify: async (_file: TFile, value: string) => { text = value; },
    },
  } as unknown as App;
  const target: EditorTarget = {
    editor,
    file,
    path: file.path,
    content,
    cursor: { ...from },
    from: { ...from },
    to: { ...to },
    selection: content.slice(offset(from), offset(to)),
  };
  return { app, editor, target, text: () => text };
}

describe("annotation writing", () => {
  it("wraps a selection in a highlight and appends the inline comment", () => {
    const doc = fixture("前文 重点 后文", { line: 0, ch: 3 }, { line: 0, ch: 5 });
    new AnnotationService(doc.app).add({ target: doc.target, comment: "我的批注", style: "inline" });
    expect(doc.text()).toBe("前文 ==重点==^[我的批注] 后文");
  });

  it("adds a comment to an existing highlight without nesting markers", () => {
    const doc = fixture("前 ==重点== 后", { line: 0, ch: 4 }, { line: 0, ch: 6 });
    new AnnotationService(doc.app).add({ target: doc.target, comment: "补充", style: "inline" });
    expect(doc.text()).toBe("前 ==重点==^[补充] 后");
  });

  it("adds a comment to an existing HTML mark without nesting markers", () => {
    const doc = fixture("<mark>重点</mark>", { line: 0, ch: 6 }, { line: 0, ch: 8 });
    new AnnotationService(doc.app).add({ target: doc.target, comment: "批注", style: "inline" });
    expect(doc.text()).toBe("<mark>重点</mark>^[批注]");
  });

  it("refuses a partial selection inside an existing highlight", () => {
    const doc = fixture("==重点==", { line: 0, ch: 2 }, { line: 0, ch: 3 });
    expect(() => new AnnotationService(doc.app).add({ target: doc.target, comment: "批注", style: "inline" }))
      .toThrow("与已有高亮重叠");
  });

  it("creates a footnote reference and definition in footnote mode", () => {
    const doc = fixture("前文 重点 后文", { line: 0, ch: 3 }, { line: 0, ch: 5 });
    new AnnotationService(doc.app).add({ target: doc.target, comment: "脚注批注", style: "footnote" });
    expect(doc.text()).toBe("前文 ==重点==[^1] 后文\n\n[^1]: 脚注批注\n");
  });

  it("trims surrounding whitespace before wrapping", () => {
    const doc = fixture("前文  重点  后文", { line: 0, ch: 2 }, { line: 0, ch: 8 });
    new AnnotationService(doc.app).add({ target: doc.target, comment: "", style: "inline" });
    expect(doc.text()).toBe("前文  ==重点==  后文");
  });

  it("escapes brackets and backslashes in inline comments", () => {
    expect(escapeInlineComment("包含 ] 和 \\ 的批注")).toBe("包含 \\] 和 \\\\ 的批注");
    const doc = fixture("重点", { line: 0, ch: 0 }, { line: 0, ch: 2 });
    new AnnotationService(doc.app).add({ target: doc.target, comment: "包含 ] 和 \\ 的批注", style: "inline" });
    const parsed = parseAnnotations(doc.text())[0];
    expect(parsed.comment).toBe("包含 ] 和 \\ 的批注");
  });

  it("refuses an empty selection and an already-highlighted text without a comment", () => {
    const empty = fixture("文本", { line: 0, ch: 1 }, { line: 0, ch: 1 });
    expect(() => new AnnotationService(empty.app).add({ target: empty.target, comment: "x", style: "inline" }))
      .toThrow("请先选中");
    const highlighted = fixture("==重点==", { line: 0, ch: 2 }, { line: 0, ch: 4 });
    expect(() => new AnnotationService(highlighted.app).add({ target: highlighted.target, comment: "", style: "inline" }))
      .toThrow("已经是高亮");
  });

  it("refuses multi-line selections that cross list blocks", () => {
    const doc = fixture("- 第一条\n- 第二条", { line: 0, ch: 0 }, { line: 1, ch: 5 });
    expect(() => new AnnotationService(doc.app).add({ target: doc.target, comment: "批注", style: "inline" }))
      .toThrow("以标题、列表或引用块开头");
  });
});

describe("annotation editing", () => {
  it("updates an inline comment in place", async () => {
    const content = "前 ==重点==^[旧批注] 后";
    const doc = fixture(content, { line: 0, ch: 2 }, { line: 0, ch: 4 });
    const annotation = parseAnnotations(content)[0];
    await new AnnotationService(doc.app).updateComment("note.md", annotation, "新批注", "inline");
    expect(doc.text()).toBe("前 ==重点==^[新批注] 后");
  });

  it("adds a comment to a highlight that has none", async () => {
    const content = "前 ==重点== 后";
    const doc = fixture(content, { line: 0, ch: 2 }, { line: 0, ch: 4 });
    const annotation = parseAnnotations(content)[0];
    await new AnnotationService(doc.app).updateComment("note.md", annotation, "新批注", "inline");
    expect(doc.text()).toBe("前 ==重点==^[新批注] 后");
  });

  it("normalizes multiple attached comments into one when editing", async () => {
    const content = "==重点==^[第一条]^[第二条]";
    const doc = fixture(content, { line: 0, ch: 2 }, { line: 0, ch: 4 });
    const annotation = parseAnnotations(content)[0];
    expect(annotation.commentParts).toHaveLength(2);
    await new AnnotationService(doc.app).updateComment("note.md", annotation, "合并批注", "inline");
    expect(doc.text()).toBe("==重点==^[合并批注]");
  });

  it("updates a footnote comment without changing its reference", async () => {
    const content = "前 ==重点==[^1] 后\n\n[^1]: 旧批注\n";
    const doc = fixture(content, { line: 0, ch: 2 }, { line: 0, ch: 4 });
    const annotation = parseAnnotations(content).find((item) => item.source === "highlight")!;
    await new AnnotationService(doc.app).updateComment("note.md", annotation, "新批注", "footnote");
    expect(doc.text()).toBe("前 ==重点==[^1] 后\n\n[^1]: 新批注\n");
  });

  it("adds a footnote comment to a bare highlight", async () => {
    const content = "前 ==重点== 后";
    const doc = fixture(content, { line: 0, ch: 2 }, { line: 0, ch: 4 });
    const annotation = parseAnnotations(content)[0];
    await new AnnotationService(doc.app).updateComment("note.md", annotation, "脚注批注", "footnote");
    expect(doc.text()).toBe("前 ==重点==[^1] 后\n\n[^1]: 脚注批注\n");
  });

  it("clears a footnote comment and its orphaned definition", async () => {
    const content = "前 ==重点==[^1] 后\n\n[^1]: 旧批注\n";
    const doc = fixture(content, { line: 0, ch: 2 }, { line: 0, ch: 4 });
    const annotation = parseAnnotations(content).find((item) => item.source === "highlight")!;
    await new AnnotationService(doc.app).updateComment("note.md", annotation, "", "footnote");
    expect(doc.text()).toBe("前 ==重点== 后\n\n");
  });

  it("keeps a shared footnote definition when only this reference is removed", async () => {
    const content = "==重点==[^1]\n\n另见[^1]\n\n[^1]: 共享批注\n";
    const doc = fixture(content, { line: 0, ch: 2 }, { line: 0, ch: 4 });
    const annotation = parseAnnotations(content).find((item) => item.source === "highlight")!;
    await new AnnotationService(doc.app).updateComment("note.md", annotation, "", "footnote");
    const result = doc.text();
    expect(result).toContain("==重点==\n\n");
    expect(result).toContain("另见[^1]");
    expect(result).toContain("[^1]: 共享批注");
  });

  it("clears a comment while keeping the highlight", async () => {
    const content = "前 ==重点==^[旧批注] 后";
    const doc = fixture(content, { line: 0, ch: 2 }, { line: 0, ch: 4 });
    const annotation = parseAnnotations(content)[0];
    await new AnnotationService(doc.app).updateComment("note.md", annotation, "   ", "inline");
    expect(doc.text()).toBe("前 ==重点== 后");
  });

  it("edits Obsidian comments", async () => {
    const content = "正文 %%旧注释%% 结束";
    const doc = fixture(content, { line: 0, ch: 0 }, { line: 0, ch: 1 });
    const annotation = parseAnnotations(content)[0];
    await new AnnotationService(doc.app).updateComment("note.md", annotation, "新注释", "inline");
    expect(doc.text()).toBe("正文 %%新注释%% 结束");
  });

  it("detaches a footnote that is shared with another reference", async () => {
    const content = "==重点==[^1]\n\n另见[^1]\n\n[^1]: 共享批注\n";
    const doc = fixture(content, { line: 0, ch: 2 }, { line: 0, ch: 4 });
    const annotation = parseAnnotations(content).find((item) => item.source === "highlight")!;
    await new AnnotationService(doc.app).updateComment("note.md", annotation, "独立批注", "footnote");
    const result = doc.text();
    expect(result).toContain("==重点==[^2]");
    expect(result).toContain("另见[^1]");
    expect(result).toContain("[^1]: 共享批注");
    expect(result).toContain("[^2]: 独立批注");
  });
});

describe("annotation lookup helpers", () => {
  it("applies an insertion at the same end boundary as a deletion", () => {
    expect(applyTextEdits("abc", [
      { start: 1, end: 3, text: "" },
      { start: 3, end: 3, text: "X" },
    ])).toBe("aX");
  });

  it("chooses the next unused numeric footnote id", () => {
    expect(nextFootnoteId("a[^1] b[^3]")).toBe("2");
    expect(nextFootnoteId("a[^1] b[^2]")).toBe("3");
  });

  it("relocates a stale annotation by its source text", () => {
    const content = "新增开头\n\n原 ==重点== 内容";
    const annotation = parseAnnotations("原 ==重点== 内容")[0];
    expect(locateSourceRange(content, annotation)).toEqual({
      start: content.indexOf("重点"),
      end: content.indexOf("重点") + 2,
    });
  });

  it("finds the same annotation after text is inserted before it", () => {
    const before = parseAnnotations("前文 ==重点==^[批注]")[0];
    const content = "插入的新段落\n\n前文 ==重点==^[批注]";
    const current = findCurrentAnnotation(content, before);
    expect(current?.comment).toBe("批注");
    expect(content.slice(current!.contentStart, current!.contentEnd)).toBe("重点");
  });
});
