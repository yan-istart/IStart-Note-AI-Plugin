import { App, Editor, EditorChange, MarkdownView, TFile } from "obsidian";
import type { EditorTarget } from "../../editor/EditorTarget";
import { checkEditorTarget } from "../../editor/EditorTarget";
import type { AnnotationCommentStyle, AnnotationRecord, TextRange } from "../../core/annotations/AnnotationParser";
import { isUnsupportedAnnotationRange, parseAnnotations } from "../../core/annotations/AnnotationParser";
import { applyTextRanges, buildDeletionRanges, countFootnoteReferences } from "../../core/annotations/AnnotationEdits";

export interface AddAnnotationOptions {
  target: EditorTarget;
  comment: string;
  style: AnnotationCommentStyle;
}

export interface AddAnnotationResult {
  addedHighlight: boolean;
  addedComment: boolean;
}

interface TextEdit extends TextRange {
  text: string;
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

/** Write, edit and remove annotations in plain Obsidian Markdown. */
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

  /** Edit the comment on an existing annotation while preserving its highlight and syntax. */
  async updateComment(
    path: string,
    annotation: AnnotationRecord,
    rawComment: string,
    style: AnnotationCommentStyle
  ): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error("找不到原文件");

    const editor = this.editorFor(file);
    const content = editor ? editor.getValue() : await this.app.vault.read(file);
    const edits = buildAnnotationCommentEdits(content, annotation, rawComment, style);

    if (edits.length === 0) return false;
    if (editor) {
      editor.transaction({ changes: textEditsToChanges(editor, edits) });
    } else {
      await this.app.vault.modify(file, applyTextEdits(content, edits));
    }
    return true;
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

function formatInlineComment(comment: string): string {
  return `^[${escapeInlineComment(comment)}]`;
}

function formatObsidianComment(comment: string): string {
  return `%%${comment.replace(/%%/g, "% %")}%%`;
}

function footnoteBody(comment: string): string {
  return comment
    .split(/\r?\n/)
    .map((line, index) => (index === 0 ? line : `    ${line}`))
    .join("\n");
}

function formatFootnoteDefinition(id: string, comment: string): string {
  return `[^${id}]: ${footnoteBody(comment)}`;
}

function buildFootnoteBlock(content: string, id: string, comment: string): string {
  const prefix = content.endsWith("\n\n") ? "" : content.endsWith("\n") ? "\n" : "\n\n";
  return `${prefix}${formatFootnoteDefinition(id, comment)}\n`;
}

/** End offset just after the highlight's closing marker/tag. */
export function closingSyntaxEnd(content: string, annotation: AnnotationRecord): number | null {
  if (annotation.source === "highlight") return annotation.contentEnd + 2;
  if (annotation.source === "mark") {
    const closing = content.indexOf("</mark>", annotation.contentEnd);
    return closing === -1 ? null : closing + "</mark>".length;
  }
  return null;
}

export function applyTextEdits(content: string, edits: TextEdit[]): string {
  const sorted = normalizeTextEdits(edits);
  let cursor = 0;
  let result = "";
  for (const edit of sorted) {
    result += content.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return result + content.slice(cursor);
}

function textEditsToChanges(editor: Editor, edits: TextEdit[]): EditorChange[] {
  return normalizeTextEdits(edits)
    .sort((a, b) => b.start - a.start)
    .map((edit) => ({
      from: editor.offsetToPos(edit.start),
      to: editor.offsetToPos(edit.end),
      text: edit.text,
    }));
}

function normalizeTextEdits(edits: TextEdit[]): TextEdit[] {
  const sorted = edits
    .filter((edit) => Number.isFinite(edit.start) && Number.isFinite(edit.end) && edit.end >= edit.start)
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end || a.text.localeCompare(b.text));
  const unique: TextEdit[] = [];
  for (const edit of sorted) {
    const previous = unique[unique.length - 1];
    if (previous && previous.start === edit.start && previous.end === edit.end && previous.text === edit.text) continue;
    unique.push(edit);
  }
  for (let index = 1; index < unique.length; index++) {
    if (unique[index].start < unique[index - 1].end) throw new Error("批注编辑范围重叠，请刷新后重试");
  }
  return unique;
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

export function buildAnnotationCommentEdits(content: string, annotation: AnnotationRecord, rawComment: string, style: AnnotationCommentStyle): TextEdit[] {
    const current = findCurrentAnnotation(content, annotation);
    if (!current) throw new Error("批注位置已变化，请刷新侧边栏后重试");

    const comment = rawComment.trim();
    const parts = current.commentParts;

    const edits: TextEdit[] = [];

    if (parts.length === 0) {
      if (!comment) return [];
      if (current.source !== "highlight" && current.source !== "mark") {
        throw new Error("无法定位可编辑的批注");
      }
      const insertAt = closingSyntaxEnd(content, current);
      if (insertAt === null) throw new Error("无法定位原高亮的结束位置");
      let suffix = "";
      let footnoteBlock = "";
      if (style === "footnote") {
        const id = nextFootnoteId(content);
        suffix = `[^${id}]`;
        footnoteBlock = buildFootnoteBlock(content, id, comment);
      } else {
        suffix = formatInlineComment(comment);
      }
      if (footnoteBlock && insertAt === content.length) {
        suffix += footnoteBlock;
        footnoteBlock = "";
      }
      edits.push({ start: insertAt, end: insertAt, text: suffix });
      if (footnoteBlock) edits.push({ start: content.length, end: content.length, text: footnoteBlock });
    } else if (!comment) {
      // Clear all comments, keeping the highlight and removing orphaned definitions.
      const removedMarkers = parts.map((part) => part.markerRange);
      for (const part of parts) {
        edits.push({ ...part.markerRange, text: "" });
        if (part.source === "footnote" && part.footnoteId && part.definitionRange) {
          const remaining = countFootnoteReferences(
            content,
            { id: part.footnoteId, range: part.definitionRange },
            removedMarkers
          );
          if (remaining === 0) edits.push({ ...part.definitionRange, text: "" });
        }
      }
    } else if (parts.length > 1) {
      // Normalize multiple manually-attached comments into one editable comment.
      const removedMarkers = parts.map((part) => part.markerRange);
      let suffix = "";
      let footnoteBlock = "";
      if (style === "footnote") {
        const id = nextFootnoteId(content);
        suffix = `[^${id}]`;
        footnoteBlock = buildFootnoteBlock(content, id, comment);
      } else {
        suffix = formatInlineComment(comment);
      }
      edits.push({ ...parts[0].markerRange, text: suffix });
      for (let index = 1; index < parts.length; index++) {
        edits.push({ ...parts[index].markerRange, text: "" });
      }
      const seenDefinitions = new Set<string>();
      for (const part of parts) {
        if (part.source !== "footnote" || !part.footnoteId || !part.definitionRange) continue;
        const key = `${part.definitionRange.start}:${part.definitionRange.end}`;
        if (seenDefinitions.has(key)) continue;
        seenDefinitions.add(key);
        const remaining = countFootnoteReferences(
          content,
          { id: part.footnoteId, range: part.definitionRange },
          removedMarkers
        );
        if (remaining === 0) edits.push({ ...part.definitionRange, text: "" });
      }
      if (footnoteBlock) edits.push({ start: content.length, end: content.length, text: footnoteBlock });
    } else {
      const part = parts[0];
      if (part.source === "inline-comment") {
        edits.push({ ...part.markerRange, text: formatInlineComment(comment) });
      } else if (part.source === "obsidian-comment") {
        edits.push({ ...part.markerRange, text: formatObsidianComment(comment) });
      } else if (part.footnoteId && part.definitionRange) {
        const shared = countFootnoteReferences(
          content,
          { id: part.footnoteId, range: part.definitionRange },
          [part.markerRange]
        ) > 0;
        if (shared) {
          // Another reference owns this footnote: detach a new footnote for this annotation.
          const id = nextFootnoteId(content);
          edits.push({ ...part.markerRange, text: `[^${id}]` });
          edits.push({ start: content.length, end: content.length, text: buildFootnoteBlock(content, id, comment) });
        } else {
          const original = content.slice(part.definitionRange.start, part.definitionRange.end);
          const trailingNewline = original.endsWith("\n");
          edits.push({
            ...part.definitionRange,
            text: `${formatFootnoteDefinition(part.footnoteId, comment)}${trailingNewline ? "\n" : ""}`,
          });
        }
      } else {
        // Broken footnote data: fall back to an inline comment rather than losing the edit.
        edits.push({ ...part.markerRange, text: formatInlineComment(comment) });
      }
    }

    return edits;
}
