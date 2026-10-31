/**
 * Parse reading annotations from ordinary Markdown.
 *
 * Supported syntax:
 * - `==highlight==`
 * - `<mark style="background: ...">highlight</mark>`
 * - `==highlight==^[inline comment]`
 * - `==highlight==[^1]` plus `[^1]: footnote comment`
 * - standalone `^[inline comment]`, footnote references, and `%%Obsidian comments%%`
 *
 * Code blocks, inline code and frontmatter are ignored.
 */

export type AnnotationKind = "highlight" | "note";
export type AnnotationSource = "highlight" | "mark" | "inline-comment" | "footnote" | "obsidian-comment";
export type AnnotationCommentStyle = "inline" | "footnote";

export interface TextRange {
  start: number;
  end: number;
}

export interface FootnoteDefinitionRef {
  id: string;
  range: TextRange;
}

export interface AnnotationRecord {
  id: string;
  kind: AnnotationKind;
  source: AnnotationSource;
  /** Cleaned text shown in the sidebar. */
  text: string;
  /** Exact source text used to relocate an annotation after edits. */
  rawText: string;
  comment: string;
  color?: string;
  heading: string;
  line: number;
  ch: number;
  endLine: number;
  endCh: number;
  contentStart: number;
  contentEnd: number;
  /** Syntax and attached comments to remove while keeping the annotated text. */
  deleteRanges: TextRange[];
  footnoteDefinitions: FootnoteDefinitionRef[];
}

interface LineInfo {
  start: number;
  end: number;
  text: string;
}

interface HighlightCandidate {
  source: "highlight" | "mark";
  start: number;
  end: number;
  innerStart: number;
  innerEnd: number;
  raw: string;
  color?: string;
}

interface CommentCandidate {
  source: "inline-comment" | "footnote" | "obsidian-comment";
  start: number;
  end: number;
  innerStart: number;
  innerEnd: number;
  text: string;
  footnoteId?: string;
  footnoteRange?: TextRange;
}

interface FootnoteDefinition {
  id: string;
  body: string;
  range: TextRange;
}

/** Convert a character offset to Obsidian's zero-based line/ch position. */
export function offsetToLineCh(content: string, offset: number): { line: number; ch: number } {
  const bounded = Math.max(0, Math.min(offset, content.length));
  const before = content.slice(0, bounded);
  const line = before.split("\n").length - 1;
  return { line, ch: bounded - (before.lastIndexOf("\n") + 1) };
}

/** Find the nearest Markdown heading above an offset. */
export function headingAtOffset(content: string, offset: number): string {
  const lines = buildLines(content);
  const lineStarts = lines.map((line) => line.start);
  const { mask } = buildBaseMask(content, lines);
  return headingFor(lines, lineStarts, mask, offset);
}

/** Build a clean, single-line excerpt for list display. */
export function cleanAnnotationText(text: string, maxLength = 500): string {
  const cleaned = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/\^\[(?:\\.|[^\]\\])*\]/g, "")
    .replace(/\[\^[^\]\s]+\]/g, "")
    .replace(/%%[\s\S]*?%%/g, "")
    .replace(/%%/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

/** True when a selection cannot render as a highlight (code, frontmatter, definitions, comments). */
export function isUnsupportedAnnotationRange(content: string, start: number, end: number): boolean {
  if (end <= start) return true;
  const lines = buildLines(content);
  const { mask, blockMask } = buildBaseMask(content, lines);
  if (hasProtected(blockMask, start, end)) return true;
  collectFootnoteDefinitions(content, lines, mask, blockMask);

  const commentRe = /%%([\s\S]*?)%%/g;
  let match: RegExpExecArray | null;
  while ((match = commentRe.exec(content)) !== null) {
    const commentStart = match.index;
    const commentEnd = commentStart + match[0].length;
    if (!hasProtected(mask, commentStart, commentEnd)) markRange(mask, commentStart, commentEnd);
  }

  const inlineCommentRe = /\^\[((?:\\.|[^\]\\])*)\]/g;
  while ((match = inlineCommentRe.exec(content)) !== null) {
    const commentStart = match.index;
    const commentEnd = commentStart + match[0].length;
    if (!hasProtected(mask, commentStart, commentEnd)) markRange(mask, commentStart, commentEnd);
  }

  const footnoteRefRe = /\[\^[^\]\s]+\]/g;
  while ((match = footnoteRefRe.exec(content)) !== null) {
    const referenceStart = match.index;
    const referenceEnd = referenceStart + match[0].length;
    if (!hasProtected(mask, referenceStart, referenceEnd)) markRange(mask, referenceStart, referenceEnd);
  }

  for (let index = start; index < end; index++) {
    if (!mask[index]) return false;
  }
  return true;
}

export function parseAnnotations(content: string): AnnotationRecord[] {  const lines = buildLines(content);
  const lineStarts = lines.map((line) => line.start);
  const { mask, blockMask } = buildBaseMask(content, lines);

  // Footnote definitions are read first, then hidden from marker scanning.
  const footnoteDefinitions = collectFootnoteDefinitions(content, lines, mask, blockMask);

  // Obsidian comments are opaque annotations; hide their contents from other markers.
  const comments: CommentCandidate[] = [];
  const commentRe = /%%([\s\S]*?)%%/g;
  let commentMatch: RegExpExecArray | null;
  while ((commentMatch = commentRe.exec(content)) !== null) {
    const start = commentMatch.index;
    const end = start + commentMatch[0].length;
    if (hasProtected(mask, start, end)) continue;
    const innerStart = start + 2;
    const innerEnd = end - 2;
    const text = cleanAnnotationText(content.slice(innerStart, innerEnd), 500);
    if (!text) continue;
    comments.push({ source: "obsidian-comment", start, end, innerStart, innerEnd, text });
    markRange(mask, start, end);
  }

  const highlights = collectHighlights(content, mask, blockMask);
  const inlineComments = collectInlineComments(content, mask, footnoteDefinitions)
    .filter((candidate) => !highlights.some((highlight) =>
      candidate.start < highlight.end && candidate.end > highlight.start
    ))
    .sort((a, b) => a.start - b.start);
  const commentsByStart = inlineComments;

  const usedComments = new Set<CommentCandidate>();
  const records: AnnotationRecord[] = [];

  let commentCursor = 0;
  for (const highlight of highlights) {
    while (commentCursor < commentsByStart.length && commentsByStart[commentCursor].end <= highlight.start) {
      commentCursor++;
    }

    const attached: CommentCandidate[] = [];
    let cursorEnd = highlight.end;
    let scanIndex = commentCursor;
    while (scanIndex < commentsByStart.length) {
      const candidate = commentsByStart[scanIndex];
      if (candidate.start < cursorEnd) {
        scanIndex++;
        continue;
      }
      const gap = content.slice(cursorEnd, candidate.start);
      if (!/^[ \t]*$/.test(gap)) break;
      attached.push(candidate);
      usedComments.add(candidate);
      cursorEnd = candidate.end;
      scanIndex++;
    }

    const commentText = attached
      .map((candidate) => candidate.text)
      .filter((text) => !!text)
      .join("\n");
    const footnoteRefs: FootnoteDefinitionRef[] = [];
    for (const candidate of attached) {
      if (candidate.source === "footnote" && candidate.footnoteId && candidate.footnoteRange) {
        footnoteRefs.push({ id: candidate.footnoteId, range: candidate.footnoteRange });
      }
    }

    const deleteRanges: TextRange[] = [
      { start: highlight.start, end: highlight.innerStart },
      { start: highlight.innerEnd, end: highlight.end },
    ];
    for (const candidate of attached) deleteRanges.push({ start: candidate.start, end: candidate.end });

    records.push(buildRecord({
      lines,
      lineStarts,
      mask,
      source: highlight.source,
      kind: commentText ? "note" : "highlight",
      text: cleanAnnotationText(highlight.raw, 500),
      rawText: highlight.raw,
      comment: commentText,
      color: highlight.color,
      contentStart: highlight.innerStart,
      contentEnd: highlight.innerEnd,
      deleteRanges,
      footnoteDefinitions: footnoteRefs,
    }));
  }

  for (const candidate of commentsByStart) {
    if (usedComments.has(candidate)) continue;
    const context = contextBefore(content, candidate.start);
    const isFootnote = candidate.source === "footnote";
    const text = isFootnote
      ? context || `脚注 ${candidate.footnoteId ?? ""}`.trim()
      : context;
    const footnoteRefs: FootnoteDefinitionRef[] = [];
    if (isFootnote && candidate.footnoteId && candidate.footnoteRange) {
      footnoteRefs.push({ id: candidate.footnoteId, range: candidate.footnoteRange });
    }
    records.push(buildRecord({
      lines,
      lineStarts,
      mask,
      source: candidate.source,
      kind: "note",
      text,
      rawText: content.slice(candidate.start, candidate.end),
      comment: candidate.text,
      contentStart: candidate.start,
      contentEnd: candidate.end,
      deleteRanges: [{ start: candidate.start, end: candidate.end }],
      footnoteDefinitions: footnoteRefs,
    }));
  }

  for (const candidate of comments) {
    records.push(buildRecord({
      lines,
      lineStarts,
      mask,
      source: candidate.source,
      kind: "note",
      text: candidate.text,
      rawText: content.slice(candidate.start, candidate.end),
      comment: "",
      contentStart: candidate.innerStart,
      contentEnd: candidate.innerEnd,
      deleteRanges: [{ start: candidate.start, end: candidate.end }],
      footnoteDefinitions: [],
    }));
  }

  records.sort((a, b) => a.contentStart - b.contentStart || a.contentEnd - b.contentEnd);
  return records;
}

interface BuildRecordInput {
  lines: LineInfo[];
  lineStarts: number[];
  mask: Uint8Array;
  source: AnnotationSource;
  kind: AnnotationKind;
  text: string;
  rawText: string;
  comment: string;
  color?: string;
  contentStart: number;
  contentEnd: number;
  deleteRanges: TextRange[];
  footnoteDefinitions: FootnoteDefinitionRef[];
}

function buildRecord(input: BuildRecordInput): AnnotationRecord {
  const start = offsetToLineChWithStarts(input.lineStarts, input.contentStart);
  const end = offsetToLineChWithStarts(input.lineStarts, input.contentEnd);
  return {
    id: `${input.source}:${input.contentStart}:${input.contentEnd}`,
    kind: input.kind,
    source: input.source,
    text: input.text,
    rawText: input.rawText,
    comment: input.comment,
    color: input.color,
    heading: headingFor(input.lines, input.lineStarts, input.mask, input.contentStart),
    line: start.line,
    ch: start.ch,
    endLine: end.line,
    endCh: end.ch,
    contentStart: input.contentStart,
    contentEnd: input.contentEnd,
    deleteRanges: input.deleteRanges,
    footnoteDefinitions: input.footnoteDefinitions,
  };
}

function buildLines(content: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let start = 0;
  while (start <= content.length) {
    const newline = content.indexOf("\n", start);
    const end = newline === -1 ? content.length : newline;
    lines.push({ start, end, text: content.slice(start, end) });
    if (newline === -1) break;
    start = newline + 1;
  }
  return lines;
}

function offsetToLineChWithStarts(lineStarts: number[], offset: number): { line: number; ch: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (lineStarts[middle] <= offset) low = middle + 1;
    else high = middle - 1;
  }
  const line = Math.max(0, high);
  return { line, ch: Math.max(0, offset - lineStarts[line]) };
}

function buildBaseMask(content: string, lines: LineInfo[]): { mask: Uint8Array; blockMask: Uint8Array } {
  const mask = new Uint8Array(content.length);
  const blockMask = new Uint8Array(content.length);

  // YAML frontmatter at the very beginning.
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content);
  if (frontmatter) {
    markRange(mask, 0, frontmatter[0].length);
    markRange(blockMask, 0, frontmatter[0].length);
  }

  // Fenced code blocks.
  let fence: { char: string; length: number } | null = null;
  for (const line of lines) {
    if (!fence) {
      const opening = line.text.match(/^\s*(`{3,}|~{3,})/);
      if (!opening) continue;
      fence = { char: opening[1][0], length: opening[1].length };
      markRange(mask, line.start, line.end);
      markRange(blockMask, line.start, line.end);
      continue;
    }
    markRange(mask, line.start, line.end);
    markRange(blockMask, line.start, line.end);
    const closing = line.text.trim().match(/^(`{3,}|~{3,})$/);
    if (closing && closing[1][0] === fence.char && closing[1].length >= fence.length) fence = null;
  }

  // Inline code spans (single-line form).
  const inlineCodeRe = /(`+)([^\n]*?)\1/g;
  let inlineCode: RegExpExecArray | null;
  while ((inlineCode = inlineCodeRe.exec(content)) !== null) {
    const start = inlineCode.index;
    const end = start + inlineCode[0].length;
    if (!hasProtected(mask, start, end)) markRange(mask, start, end);
  }

  return { mask, blockMask };
}

function collectFootnoteDefinitions(
  content: string,
  lines: LineInfo[],
  mask: Uint8Array,
  blockMask: Uint8Array
): Map<string, FootnoteDefinition> {
  const definitions = new Map<string, FootnoteDefinition>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (hasProtected(mask, line.start, Math.min(line.end, line.start + 8))) continue;
    const match = line.text.match(/^ {0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/);
    if (!match) continue;

    let lastLine = i;
    let scan = i + 1;
    while (scan < lines.length) {
      const next = lines[scan];
      if (hasProtected(mask, next.start, Math.min(next.end, next.start + 1))) break;
      if (next.text.trim() === "") {
        let lookahead = scan + 1;
        while (lookahead < lines.length && lines[lookahead].text.trim() === "") lookahead++;
        if (lookahead < lines.length && /^( {2,}|\t)/.test(lines[lookahead].text)) {
          scan++;
          continue;
        }
        break;
      }
      if (!/^( {2,}|\t)/.test(next.text)) break;
      lastLine = scan;
      scan++;
    }

    const bodyLines = [match[2]];
    for (let index = i + 1; index <= lastLine; index++) {
      bodyLines.push(lines[index].text.replace(/^\t|^ {1,4}/, ""));
    }
    const rangeEnd = lastLine + 1 < lines.length ? lines[lastLine + 1].start : content.length;
    definitions.set(match[1], {
      id: match[1],
      body: bodyLines.join("\n").trim(),
      range: { start: line.start, end: rangeEnd },
    });
    markRange(mask, line.start, rangeEnd);
    markRange(blockMask, line.start, rangeEnd);
    i = lastLine;
  }
  return definitions;
}

function collectHighlights(content: string, mask: Uint8Array, blockMask: Uint8Array): HighlightCandidate[] {
  const candidates: HighlightCandidate[] = [];

  const highlightRe = /==([\s\S]+?)==/g;
  let match: RegExpExecArray | null;
  while ((match = highlightRe.exec(content)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (hasProtected(mask, start, start + 2) || hasProtected(mask, end - 2, end) || hasProtected(blockMask, start, end)) continue;
    if (content[start - 1] === "=" || content[end] === "=" || content[start - 1] === "\\") continue;
    const raw = match[1];
    if (!isHighlightContent(raw)) continue;
    candidates.push({
      source: "highlight",
      start,
      end,
      innerStart: start + 2,
      innerEnd: end - 2,
      raw,
    });
  }

  const markRe = /<mark\b([^>]*)>([\s\S]*?)<\/mark>/gi;
  while ((match = markRe.exec(content)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const innerStart = start + match[0].indexOf(">") + 1;
    const innerEnd = innerStart + match[2].length;
    if (hasProtected(mask, start, innerStart) || hasProtected(mask, innerEnd, end) || hasProtected(blockMask, start, end)) continue;
    const raw = match[2];
    if (!raw.trim()) continue;
    candidates.push({
      source: "mark",
      start,
      end,
      innerStart,
      innerEnd,
      raw,
      color: parseMarkColor(match[1]),
    });
  }

  candidates.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const highlights: HighlightCandidate[] = [];
  let previousEnd = -1;
  for (const candidate of candidates) {
    if (candidate.start < previousEnd) continue;
    highlights.push(candidate);
    previousEnd = candidate.end;
  }
  return highlights;
}

function collectInlineComments(
  content: string,
  mask: Uint8Array,
  definitions: Map<string, FootnoteDefinition>
): CommentCandidate[] {
  const comments: CommentCandidate[] = [];

  const inlineRe = /\^\[((?:\\.|[^\]\\])*)\]/g;
  let match: RegExpExecArray | null;
  while ((match = inlineRe.exec(content)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (hasProtected(mask, start, end)) continue;
    comments.push({
      source: "inline-comment",
      start,
      end,
      innerStart: start + 2,
      innerEnd: end - 1,
      text: match[1].replace(/\\\]/g, "]").replace(/\\\\/g, "\\").trim(),
    });
  }

  const footnoteRe = /\[\^([^\]\s]+)\]/g;
  while ((match = footnoteRe.exec(content)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (hasProtected(mask, start, end)) continue;
    const definition = definitions.get(match[1]);
    if (!definition) continue;
    comments.push({
      source: "footnote",
      start,
      end,
      innerStart: start,
      innerEnd: end,
      text: definition.body,
      footnoteId: definition.id,
      footnoteRange: definition.range,
    });
  }

  return comments;
}

function isHighlightContent(raw: string): boolean {
  if (!raw || !raw.trim()) return false;
  if (/^\s/.test(raw) || /\s$/.test(raw)) return false;
  if (/\n\s*\n/.test(raw)) return false;
  return true;
}

function parseMarkColor(attributes: string): string | undefined {
  const style = /style\s*=\s*["']([^"']*)["']/i.exec(attributes);
  const fromStyle = style?.[1]?.match(/background(?:-color)?\s*:\s*([^;]+)/i);
  if (fromStyle) return fromStyle[1].trim();
  const color = /\bcolor\s*=\s*["']([^"']+)["']/i.exec(attributes);
  return color?.[1]?.trim();
}

function contextBefore(content: string, offset: number): string {
  const lineStart = content.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  let text = content.slice(lineStart, offset);
  if (!cleanAnnotationText(text)) {
    const previousEnd = Math.max(0, lineStart - 1);
    const previousStart = content.lastIndexOf("\n", Math.max(0, previousEnd - 1)) + 1;
    text = content.slice(previousStart, previousEnd);
  }
  return cleanAnnotationText(text, 120);
}

function headingFor(lines: LineInfo[], lineStarts: number[], mask: Uint8Array, offset: number): string {
  const startLine = offsetToLineChWithStarts(lineStarts, offset).line;
  for (let i = startLine; i >= 0; i--) {
    if (hasProtected(mask, lines[i].start, Math.min(lines[i].end, lines[i].start + 3))) continue;
    const match = lines[i].text.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match) return match[2].trim();
  }
  return "";
}

function hasProtected(mask: Uint8Array, start: number, end: number): boolean {
  const from = Math.max(0, start);
  const to = Math.min(mask.length, end);
  for (let i = from; i < to; i++) {
    if (mask[i]) return true;
  }
  return false;
}

function markRange(mask: Uint8Array, start: number, end: number): void {
  const from = Math.max(0, start);
  const to = Math.min(mask.length, end);
  for (let i = from; i < to; i++) mask[i] = 1;
}
