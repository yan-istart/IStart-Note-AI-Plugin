import { App, Editor, EditorChange, MarkdownView, TFile } from "obsidian";
import type { EditorTarget } from "../../editor/EditorTarget";
import { checkEditorTarget } from "../../editor/EditorTarget";
import type { AnnotationCommentStyle, AnnotationRecord, TextRange } from "../../core/annotations/AnnotationParser";
import { isUnsupportedAnnotationRange, parseAnnotations } from "../../core/annotations/AnnotationParser";
import { applyTextRanges, buildDeletionRanges } from "../../core/annotations/AnnotationEdits";

export interface AddAnnotationOptions {
  target: EditorTarget;
  comment: string;
  style: AnnotationCommentStyle;
}

export interface AddAnnotationResult {
  addedHighlight: boolean;
  addedComment: boolean;
}

export interface AnnotationSelectionInspection {
  start: number;
  end: number;
  selected: string;
  alreadyHighlighted: boolean;
  /** Where a comment suffix should be inserted when the selection is already highlighted. */
  insertAt?: number;
  error?: string;
}

/** Validate a selection before opening the dialog or writing, so errors do not waste AI work. */
export function inspectAnnotationSelection(content: string, rawFrom: number, rawTo: number): AnnotationSelectionInspection {
  const rawSelection = content.slice(rawFrom, rawTo);
  if (!rawSelection.trim()) {
    return { start: rawFrom, end: rawTo, selected: "", alreadyHighlighted: false, error: "请先选中要批注的文字" };
  }

  const leading = rawSelection.length - rawSelection.replace(/^\s+/, "").length;
  const trailing = rawSelection.length - rawSelection.replace(/\s+$/, "").length;
  const start = rawFrom + leading;
  const end = rawTo - trailing;
  const selected = content.slice(start, end);
  if (!selected.trim()) {
    return { start, end, selected: "", alreadyHighlighted: false, error: "请先选中要批注的文字" };
  }
  if (/\n[ \t]*\n/.test(selected)) {
    return { start, end, selected, alreadyHighlighted: false, error: "批注暂不支持跨空行选择，请分段添加" };
  }

  const highlightedOutside = content.slice(Math.max(0, start - 2), start) === "=="
    && content.slice(end, end + 2) === "==";
  const highlightedInside = selected.length > 4 && selected.startsWith("==") && selected.endsWith("==");
  if (highlightedOutside) {
    return { start, end, selected, alreadyHighlighted: true, insertAt: end + 2 };
  }
  if (highlightedInside) {
    return { start, end, selected, alreadyHighlighted: true, insertAt: end };
  }

  const enclosing = parseAnnotations(content).find((annotation) =>
    (annotation.source === "highlight" || annotation.source === "mark")
    && start < annotation.contentEnd
    && end > annotation.contentStart
  );
  if (enclosing) {
    const exact = start === enclosing.contentStart && end === enclosing.contentEnd;
    if (!exact) {
      return {
        start,
        end,
        selected,
        alreadyHighlighted: false,
        error: "该文字与已有高亮重叠，请选择完整高亮后再添加批注，或先移除原高亮",
      };
    }
    const closingEnd = enclosing.source === "mark"
      ? content.indexOf("</mark>", enclosing.contentEnd)
      : enclosing.contentEnd;
    const insertAt = enclosing.source === "mark"
      ? (closingEnd === -1 ? enclosing.contentEnd : closingEnd + "</mark>".length)
      : enclosing.contentEnd + 2;
    return { start, end, selected, alreadyHighlighted: true, insertAt };
  }

  if (selected.split("\n").some(startsBlockMarkdown)) {
    return { start, end, selected, alreadyHighlighted: false, error: "以标题、列表或引用块开头的文字无法作为一条高亮，请只选择正文或分段添加" };
  }
  if (isUnsupportedAnnotationRange(content, start, end)) {
    return { start, end, selected, alreadyHighlighted: false, error: "代码块、注释或脚注定义中的文字无法添加高亮批注" };
  }
  if (selected.includes("==")) {
    return { start, end, selected, alreadyHighlighted: false, error: "选中文字包含 ==，无法安全添加高亮，请缩短选区" };
  }
  return { start, end, selected, alreadyHighlighted: false };
}

/** Write annotations in plain Obsidian Markdown and remove them safely. */
export class AnnotationService {
  constructor(private app: App) {}

  add(options: AddAnnotationOptions): AddAnnotationResult {
    const { target } = options;
    checkEditorTarget(this.app, target);

    const editor = target.editor;
    const content = editor.getValue();
    const inspection = inspectAnnotationSelection(
      content,
      editor.posToOffset(target.from),
      editor.posToOffset(target.to)
    );
    if (inspection.error) throw new Error(inspection.error);
    const { start, end, selected, alreadyHighlighted } = inspection;

    const comment = options.comment.trim();
    if (alreadyHighlighted && !comment) throw new Error("这段文字已经是高亮");

    const changes: EditorChange[] = [];
    let commentSuffix = "";
    let footnoteBlock = "";

    if (comment) {
      if (options.style === "footnote") {
        const id = nextFootnoteId(content);
        commentSuffix = `[^${id}]`;
        footnoteBlock = buildFootnoteBlock(content, id, comment);
      } else {
        commentSuffix = `^[${escapeInlineComment(comment)}]`;
      }
    }

    // Two insertions at the same document end are ambiguous in one transaction.
    if (footnoteBlock && end === content.length) {
      commentSuffix += footnoteBlock;
      footnoteBlock = "";
    }

    if (alreadyHighlighted) {
      const insertAt = inspection.insertAt ?? end;
      changes.push({
        from: editor.offsetToPos(insertAt),
        to: editor.offsetToPos(insertAt),
        text: commentSuffix,
      });
    } else {
      changes.push({
        from: editor.offsetToPos(start),
        to: editor.offsetToPos(end),
        text: `==${selected}==${commentSuffix}`,
      });
    }

    if (footnoteBlock) {
      changes.push({
        from: editor.offsetToPos(content.length),
        to: editor.offsetToPos(content.length),
        text: footnoteBlock,
      });
    }

    editor.transaction({ changes });
    const cursor = editor.offsetToPos(start);
    editor.setCursor(cursor);
    editor.scrollIntoView({ from: cursor, to: cursor });
    return { addedHighlight: !alreadyHighlighted, addedComment: !!comment };
  }

  /** Remove syntax and comments for one annotation. Annotated text is preserved. */
  async remove(path: string, annotation: AnnotationRecord): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error("找不到原文件");

    const editor = this.editorFor(file);
    const content = editor ? editor.getValue() : await this.app.vault.read(file);
    const current = findCurrentAnnotation(content, annotation);
    if (!current) throw new Error("批注位置已变化，请刷新侧边栏后重试");

    const ranges = buildDeletionRanges(content, current);
    if (ranges.length === 0) return false;

    if (editor) {
      editor.transaction({ changes: rangesToEditorChanges(editor, ranges) });
    } else {
      await this.app.vault.modify(file, applyTextRanges(content, ranges));
    }
    return true;
  }

  private editorFor(file: TFile): Editor | null {
    const active = this.app.workspace.activeEditor;
    if (active?.editor && active.file?.path === file.path) return active.editor;
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === file.path) return view.editor;
    }
    return null;
  }
}

/** Locate an annotation after small edits by matching its source text. */
export function findCurrentAnnotation(content: string, annotation: AnnotationRecord): AnnotationRecord | null {
  const annotations = parseAnnotations(content);
  const exact = annotations.find((candidate) => candidate.id === annotation.id);
  if (exact) return exact;

  const candidates = annotations.filter((candidate) =>
    candidate.source === annotation.source && candidate.rawText === annotation.rawText
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) =>
    Math.abs(a.contentStart - annotation.contentStart) - Math.abs(b.contentStart - annotation.contentStart)
  );
  return candidates[0];
}

export function nextFootnoteId(content: string): string {
  const used = new Set<string>();
  const pattern = /\[\^([^\]\s]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) used.add(match[1]);
  let number = 1;
  while (used.has(String(number))) number++;
  return String(number);
}

export function escapeInlineComment(comment: string): string {
  return comment
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\]/g, "\\]")
    .trim();
}

function buildFootnoteBlock(content: string, id: string, comment: string): string {
  const lines = comment.split(/\r?\n/);
  const body = lines.map((line, index) => (index === 0 ? line : `    ${line}`)).join("\n");
  const prefix = content.endsWith("\n\n") ? "" : content.endsWith("\n") ? "\n" : "\n\n";
  return `${prefix}[^${id}]: ${body}\n`;
}

function startsBlockMarkdown(line: string): boolean {
  return /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|~~~)/.test(line.trimStart());
}

/** Apply ranges through an editor transaction so one delete can be undone as a unit. */
export function rangesToEditorChanges(editor: Editor, ranges: TextRange[]): EditorChange[] {
  return ranges
    .slice()
    .sort((a, b) => b.start - a.start)
    .map((range) => ({
      from: editor.offsetToPos(range.start),
      to: editor.offsetToPos(range.end),
      text: "",
    }));
}
