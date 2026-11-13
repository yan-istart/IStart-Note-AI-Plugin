import type { StoryBlock } from "./types";

export interface ParsedStoryBlock { kind: StoryBlock["kind"]; visibility: StoryBlock["visibility"]; text: string; complete: boolean }
interface Token { key?: string; text: string; complete: boolean; start: number; end: number }
export class StoryStreamError extends Error {}
/** Decode only complete escape sequences; partial Unicode/quotes never leak into the reader's text. */
function stringToken(source: string, start: number): Token {
  let text = "", i = start + 1;
  for (; i < source.length; i++) {
    const char = source[i];
    if (char === '"') return { text, complete: true, start, end: i + 1 };
    if (char === "\\") {
      if (i + 1 >= source.length) break;
      const next = source[i + 1];
      if (next === "u") {
        const hex = source.slice(i + 2, i + 6);
        if (hex.length < 4) break;
        if (!/^[0-9a-f]{4}$/i.test(hex)) throw new StoryStreamError("演绎文本包含无效的转义字符");
        const code = parseInt(hex, 16);
        if (code >= 0xd800 && code <= 0xdbff) {
          const tail = source.slice(i + 6, i + 12);
          if (tail.length < 6) break;
          if (!/^\\u[dD][c-fC-F][0-9a-fA-F]{2}$/.test(tail)) throw new StoryStreamError("演绎文本包含无效的 Unicode 字符");
          text += String.fromCharCode(code, parseInt(tail.slice(2), 16)); i += 11; continue;
        }
        text += String.fromCharCode(code); i += 5; continue;
      }
      const escapes: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
      if (!(next in escapes)) throw new StoryStreamError("演绎文本包含无效的转义字符");
      text += escapes[next]; i++; continue;
    }
    if (char.charCodeAt(0) < 32) throw new StoryStreamError("演绎协议中的换行必须转义");
    // A transport chunk may end between a surrogate pair.
    if (char.charCodeAt(0) >= 0xd800 && char.charCodeAt(0) <= 0xdbff && i + 1 === source.length) break;
    text += char;
  }
  return { text, complete: false, start, end: i };
}
function parseLine(source: string, complete: boolean): ParsedStoryBlock | null {
  const line = source.trim();
  if (!line) return null;
  if (line[0] === "[") return parseTuple(line, complete);
  if (line[0] !== "{") throw new StoryStreamError("演绎需要按行返回内容块，已显示的原稿会保留");
  const fields = new Map<string, Token>();
  let i = 1, closed = false;
  while (i < line.length) {
    while (/\s/.test(line[i] ?? "")) i++;
    if (line[i] === "}") { closed = true; i++; break; }
    if (line[i] !== '"') { if (!complete && i === line.length) break; throw new StoryStreamError("演绎内容块字段格式无效"); }
    const key = stringToken(line, i); if (!key.complete) break; i = key.end;
    while (/\s/.test(line[i] ?? "")) i++;
    if (i === line.length && !complete) break;
    if (line[i++] !== ":") throw new StoryStreamError("演绎内容块字段格式无效");
    while (/\s/.test(line[i] ?? "")) i++;
    if (i === line.length && !complete) break;
    if (line[i] !== '"') throw new StoryStreamError("演绎内容块字段必须是字符串");
    if (fields.has(key.text)) throw new StoryStreamError("演绎内容块包含重复字段");
    const value = stringToken(line, i); fields.set(key.text, value); i = value.end;
    if (!value.complete) break;
    while (/\s/.test(line[i] ?? "")) i++;
    if (line[i] === ",") { i++; continue; }
    if (line[i] === "}") { closed = true; i++; break; }
    if (!complete && i === line.length) break;
    throw new StoryStreamError("演绎内容块字段格式无效");
  }
  const kind = fields.get("kind"), visibility = fields.get("visibility"), text = fields.get("text");
  if (kind?.complete && !["dialogue", "narration"].includes(kind.text)) throw new StoryStreamError("未知的演绎内容类型");
  if (visibility?.complete && !["public", "private"].includes(visibility.text)) throw new StoryStreamError("未知的演绎可见范围");
  if (text && (!kind?.complete || !visibility?.complete)) throw new StoryStreamError("演绎必须先声明类型和可见性，再输出文本");
  if (complete) {
    let data: unknown;
    try { data = JSON.parse(line); } catch { throw new StoryStreamError("演绎内容块没有完整结束，原稿已保留"); }
    if (!closed || !data || typeof data !== "object" || Array.isArray(data) || fields.size !== 3 || !kind || !visibility || !text?.complete || !text.text.trim()) throw new StoryStreamError("演绎内容块不完整或为空");
    if (Object.keys(data).length !== 3 || [...fields.keys()].some(k => !["kind", "visibility", "text"].includes(k))) throw new StoryStreamError("演绎内容块包含不支持的字段");
  }
  if (!kind?.complete || !visibility?.complete || !text) return null;
  if (kind.text === "dialogue" && visibility.text !== "public") throw new StoryStreamError("对白必须为公开内容");
  return { kind: kind.text as ParsedStoryBlock["kind"], visibility: visibility.text as ParsedStoryBlock["visibility"], text: text.text, complete };
}
function parseTuple(line: string, complete: boolean): ParsedStoryBlock | null {
  const values: Token[] = [];
  let i = 1;
  while (i < line.length) {
    while (/\s/.test(line[i] ?? "")) i++;
    if (line[i] === "]" || (!complete && i === line.length)) break;
    if (line[i] !== '"' || values.length >= 3) throw new StoryStreamError("演绎内容块结构无效");
    const token = stringToken(line, i); values.push(token); i = token.end;
    if (!token.complete) break;
    while (/\s/.test(line[i] ?? "")) i++;
    if (line[i] === ",") { i++; continue; }
    if (line[i] === "]" || (!complete && i === line.length)) break;
    throw new StoryStreamError("演绎内容块结构无效");
  }
  const [kind, visibility, text] = values;
  if (kind?.complete && !["dialogue", "narration"].includes(kind.text)) throw new StoryStreamError("未知的演绎内容类型");
  if (visibility?.complete && !["public", "private"].includes(visibility.text)) throw new StoryStreamError("未知的演绎可见范围");
  if (complete) {
    let data: unknown;
    try { data = JSON.parse(line); } catch { throw new StoryStreamError("演绎内容块未完整结束"); }
    if (!Array.isArray(data) || data.length !== 3 || !data.every(value => typeof value === "string") || !text?.complete || !text.text.trim()) throw new StoryStreamError("演绎内容块不完整或为空");
  }
  if (!kind?.complete || !visibility?.complete || !text) return null;
  if (kind.text === "dialogue" && visibility.text !== "public") throw new StoryStreamError("对白必须为公开内容");
  return { kind: kind.text as ParsedStoryBlock["kind"], visibility: visibility.text as ParsedStoryBlock["visibility"], text: text.text, complete };
}

/** NDJSON framing with incremental decoding inside text strings. No quote-based dialogue guessing. */
export class StoryStreamParser {
  private source = "";
  private lines: ParsedStoryBlock[] = [];
  constructor(private update: (index: number, block: ParsedStoryBlock) => void) {}
  feed(chunk: string): void {
    this.source += chunk;
    if (this.source.length > 100000) throw new StoryStreamError("本次回应过长，已暂停并保留原稿");
    for (;;) {
      const end = this.source.indexOf("\n"); if (end < 0) break;
      const line = this.source.slice(0, end); this.source = this.source.slice(end + 1);
      const parsed = parseLine(line, true);
      if (parsed) { this.update(this.lines.length, parsed); this.lines.push(parsed); }
    }
    const partial = parseLine(this.source, false);
    if (partial) this.update(this.lines.length, partial);
  }
  finish(): void {
    const last = parseLine(this.source, true);
    if (last) { this.update(this.lines.length, last); this.lines.push(last); }
    this.source = "";
    if (!this.lines.length) throw new StoryStreamError("未生成有效的演绎内容块");
  }
}
