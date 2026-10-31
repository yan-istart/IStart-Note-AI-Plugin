import { describe, expect, it } from "vitest";
import { isUnsupportedAnnotationRange, parseAnnotations } from "./AnnotationParser";

describe("annotation parser", () => {
  it("finds a highlight and exposes its source location", () => {
    const content = "# 标题\n\n这是 ==重点== 内容。";
    const [annotation] = parseAnnotations(content);

    expect(annotation.source).toBe("highlight");
    expect(annotation.kind).toBe("highlight");
    expect(annotation.text).toBe("重点");
    expect(annotation.heading).toBe("标题");
    expect(annotation.line).toBe(2);
    expect(content.slice(annotation.contentStart, annotation.contentEnd)).toBe("重点");
    expect(content.slice(annotation.contentStart, annotation.contentEnd)).toHaveLength(2);
  });

  it("attaches an inline comment to the preceding highlight", () => {
    const [annotation] = parseAnnotations("==重点==^[我的批注]");
    expect(annotation.kind).toBe("note");
    expect(annotation.comment).toBe("我的批注");
    expect(annotation.text).toBe("重点");
    expect(annotation.deleteRanges).toHaveLength(3);
  });

  it("attaches a footnote comment and its definition", () => {
    const content = "==重点==[^1]\n\n[^1]: 脚注里的批注\n";
    const [annotation] = parseAnnotations(content);
    expect(annotation.kind).toBe("note");
    expect(annotation.comment).toBe("脚注里的批注");
    expect(annotation.footnoteDefinitions).toHaveLength(1);
    expect(annotation.footnoteDefinitions[0].id).toBe("1");
  });

  it("keeps standalone inline comments and footnote references", () => {
    const annotations = parseAnnotations("前文 ^[行内批注]\n\n另一段[^note]\n\n[^note]: 脚注内容");
    expect(annotations).toHaveLength(2);
    expect(annotations[0].source).toBe("inline-comment");
    expect(annotations[0].text).toBe("前文");
    expect(annotations[0].comment).toBe("行内批注");
    expect(annotations[1].source).toBe("footnote");
    expect(annotations[1].text).toBe("另一段");
    expect(annotations[1].comment).toBe("脚注内容");
  });

  it("parses Obsidian comments and ignores their contents as markers", () => {
    const annotations = parseAnnotations("正文 %%这里不显示==假高亮==%% 结束");
    expect(annotations).toHaveLength(1);
    expect(annotations[0].source).toBe("obsidian-comment");
    expect(annotations[0].text).toBe("这里不显示==假高亮==");
  });

  it("allows inline code and Obsidian comments inside a highlight", () => {
    const annotations = parseAnnotations("==包含 `code` 与 %%隐藏%% 的高亮==");
    const highlight = annotations.find((item) => item.source === "highlight");
    expect(highlight?.text).toBe("包含 code 与 的高亮");
  });

  it("parses HTML marks with a background color", () => {
    const [annotation] = parseAnnotations('<mark style="background:#835cf5">紫色重点</mark>');
    expect(annotation.source).toBe("mark");
    expect(annotation.text).toBe("紫色重点");
    expect(annotation.color).toBe("#835cf5");
  });

  it("ignores frontmatter, fenced code, inline code and footnote definitions", () => {
    const content = [
      "---",
      "title: ==不是高亮==",
      "---",
      "正文 `==也不是高亮==`",
      "```",
      "==代码块里也不是==",
      "```",
      "[^1]: ==脚注定义里也不显示==",
    ].join("\n");
    expect(parseAnnotations(content)).toHaveLength(0);
  });

  it("supports highlights spanning a soft line break", () => {
    const [annotation] = parseAnnotations("==第一行\n第二行==");
    expect(annotation.text).toBe("第一行 第二行");
    expect(annotation.line).toBe(0);
    expect(annotation.endLine).toBe(1);
  });

  it("does not mistake loose equals signs for highlights", () => {
    expect(parseAnnotations("a == b 与 c == d")).toHaveLength(0);
  });

  it("unescapes brackets inside inline comments", () => {
    const [annotation] = parseAnnotations("==重点==^[包含 \\] 的批注]");
    expect(annotation.comment).toBe("包含 ] 的批注");
  });

  it("handles multiple adjacent comments on one highlight", () => {
    const content = "==重点==^[第一条][^1]\n\n[^1]: 第二条";
    const [annotation] = parseAnnotations(content);
    expect(annotation.comment).toBe("第一条\n第二条");
    expect(annotation.footnoteDefinitions).toHaveLength(1);
  });

  it("uses a footnote definition across indented continuation lines", () => {
    const content = "==重点==[^1]\n\n[^1]: 第一行\n    第二行\n";
    const [annotation] = parseAnnotations(content);
    expect(annotation.comment).toBe("第一行\n第二行");
  });

  it("rejects selections that sit entirely inside code or hidden comments", () => {
    const inline = "正文 `code` 结束";
    const codeStart = inline.indexOf("code");
    expect(isUnsupportedAnnotationRange(inline, codeStart, codeStart + 4)).toBe(true);
    expect(isUnsupportedAnnotationRange(inline, 0, 2)).toBe(false);

    const comment = "正文 %%隐藏内容%% 结束";
    const hiddenStart = comment.indexOf("隐藏");
    expect(isUnsupportedAnnotationRange(comment, hiddenStart, hiddenStart + 4)).toBe(true);

    const inlineText = "正文 ^[行内批注] 结束";
    const inlineStart = inlineText.indexOf("行内");
    expect(isUnsupportedAnnotationRange(inlineText, inlineStart, inlineStart + 2)).toBe(true);

    const fenced = "```\ncode\n```";
    expect(isUnsupportedAnnotationRange(fenced, 4, 8)).toBe(true);
  });
});
