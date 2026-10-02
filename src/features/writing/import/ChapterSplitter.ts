/**
 * 章节切分器 — 纯规则实现,无 AI 依赖,可单测。
 *
 * 支持:
 *  - 中文章节标题:第1章 / 第十二章 / 第 3 章 风起
 *  - 英文章节标题:Chapter 1
 *  - 纯数字标题:1. / 01、 等(仅当整篇命中 >= 2 次)
 *  - 分隔符:--- / === / *** 等作为章节边界
 *  - 文件夹模式:每个文件 = 一章,按文件名排序
 */

export interface RawChapter {
  /** 章节序号(仅 kind=chapter 有意义) */
  number: number;
  title: string;
  content: string;
  /** 内容归类,缺省视为正文章节 */
  kind?: MaterialKind;
}

/** 内容归类:正文 / 大纲细纲 / 设定世界观 / 其他资料 / 跳过 */
export type MaterialKind = "chapter" | "outline" | "setting" | "reference" | "skip";

export interface SplitInputFile {
  path: string;
  name: string;
  content: string;
}

const CN_TITLE = /^\s*第\s*([0-9零〇一二三四五六七八九十百千万两]+)\s*[章节卷回部集]\s*[.:：、\-\s]?\s*(.{0,60}?)\s*$/;
const EN_TITLE = /^\s*(?:Chapter|CHAPTER)\s+([0-9]+)\s*[.:：、\-\s]?\s*(.{0,60}?)\s*$/;
const NUM_TITLE = /^\s*(\d{1,4})\s*[.、:：]\s*(.{2,60}?)\s*$/;
const SEPARATOR = /^\s*([-=*_]{3,}|[·•]{8,}|※{3,})\s*$/;

/** 去掉章题中的编号前缀:"第3章 风起" → "风起";"Chapter 2 x" → "x" */
export function normalizeTitle(title: string): string {
  return title
    .replace(/^第[0-9零〇一二三四五六七八九十百千万两]+\s*[章节卷回部集]\s*[.:：、\-\s]*/, "")
    .replace(/^Chapter\s+\d+\s*[.:：、\-\s]*/i, "")
    .trim();
}

/**
 * 规则分类:根据名称与开头内容判断一份材料的类型。
 * 默认归类为「资料」,避免未知文件被当作正文章节。
 */
export function detectMaterialKind(label: string, contentHead: string): MaterialKind {
  const head = contentHead.trim();
  if (!head) return "skip";
  if (/第\s*[0-9零〇一二三四五六七八九十百千万两]+\s*[章节卷回部集]/.test(label)
    || /^\s*第\s*[0-9零〇一二三四五六七八九十百千万两]+\s*[章节卷回部集]/.test(head)) {
    return "chapter";
  }
  const text = `${label}\n${head.slice(0, 300)}`;
  if (/设定|世界观|百科|力量体系|势力|地理|地图|编年史|规则/.test(text)) return "setting";
  if (/大纲|细纲|梗概|剧情|连续性|章纲|结构/.test(text)) return "outline";
  if (/手册|执行|方案|资料|笔记|备忘|参考|写作/.test(text)) return "reference";
  return "reference";
}

export class ChapterSplitter {
  /**
   * 单文本切章。返回章节列表(含前言)。
   * 若仅命中 1 个标题或完全无结构,返回单章,由上层提示用户手动标记。
   */
  splitText(text: string): RawChapter[] {
    const normalized = text.replace(/\r\n?/g, "\n");
    const lines = normalized.split("\n");

    const boundaries = this.detectBoundaries(lines);
    if (boundaries.length === 0) {
      return [{ number: 1, title: "第1章", content: normalized.trim() }];
    }

    const collected: { title: string; content: string; isPreamble: boolean; kind: MaterialKind }[] = [];
    let currentTitle = "";
    let currentStart = 0;
    let firstBoundary = true;

    const flush = (end: number) => {
      const body = lines.slice(currentStart, end).join("\n").trim();
      if (body.length > 0) {
        collected.push({ title: currentTitle, content: body, isPreamble: false, kind: "chapter" });
      }
    };

    for (const b of boundaries) {
      if (b.kind === "title") {
        if (firstBoundary) {
          // 首个标题之前的内容 = 前言(书名/简介/楔子),默认按规则分类(通常为资料)
          const preamble = lines.slice(0, b.line).join("\n").trim();
          if (preamble.length > 0) {
            collected.push({
              title: "前言",
              content: preamble,
              isPreamble: true,
              kind: detectMaterialKind("前言", preamble),
            });
          }
          firstBoundary = false;
        } else {
          flush(b.line);
        }
        currentTitle = b.title;
        currentStart = b.line + 1; // 标题行不计入正文
      } else {
        // 分隔符:分隔符之前的内容也成章(首段=第一章,不产生前言)
        flush(b.line);
        currentStart = b.line + 1; // 分隔符行不计入正文
        firstBoundary = false;
      }
    }
    flush(lines.length);

    // 编号:前言=0,正文从 1 开始
    const chapters: RawChapter[] = [];
    let counter = 1;
    for (const c of collected) {
      if (c.isPreamble) {
        chapters.push({ number: 0, title: c.title, content: c.content, kind: c.kind });
      } else {
        chapters.push({
          number: counter,
          title: c.title || `第${counter}章`,
          content: c.content,
          kind: c.kind,
        });
        counter++;
      }
    }

    return chapters;
  }

  /** 文件夹模式:每文件 = 一个单元,按文件名排序,按规则分类 */
  splitFiles(files: SplitInputFile[]): RawChapter[] {
    const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    let chapterCounter = 1;
    return sorted.map((f) => {
      const content = f.content.replace(/\r\n?/g, "\n").trim();
      const kind = detectMaterialKind(f.name, content);
      const isChapter = kind === "chapter";
      const number = isChapter ? chapterCounter : 0;
      const baseTitle = this.titleFromFileName(f.name);
      if (isChapter) chapterCounter++;
      return {
        number,
        title: baseTitle || `第${number}章`,
        content,
        kind,
      };
    });
  }

  /** 从文件名提取章名:"001-风起.md" → "风起" */
  titleFromFileName(name: string): string {
    return name
      .replace(/\.[^.]+$/, "")
      .replace(/^\d+[-_.、\s]*/, "")
      .replace(/^第[0-9一二三四五六七八九十百千万两零〇]+[章节卷回部集][.:：、\-\s]*/, "")
      .trim();
  }

  // ── 内部 ───────────────────────────────────────────────────

  private detectBoundaries(lines: string[]): { line: number; title: string; kind: "title" | "separator" }[] {
    const cn = this.scan(lines, CN_TITLE, (m) => `第${m[1]}章${m[2] ? " " + m[2] : ""}`);
    if (cn.length >= 2) return cn.map((b) => ({ ...b, kind: "title" as const }));

    const en = this.scan(lines, EN_TITLE, (m) => `Chapter ${m[1]}${m[2] ? " " + m[2] : ""}`);
    if (en.length >= 2) return en.map((b) => ({ ...b, kind: "title" as const }));

    const num = this.scan(lines, NUM_TITLE, (m) => `第${m[1]}章 ${m[2]}`);
    if (num.length >= 2) return num.map((b) => ({ ...b, kind: "title" as const }));

    // 分隔符作为边界
    const sep: { line: number; title: string; kind: "title" | "separator" }[] = [];
    lines.forEach((line, i) => {
      if (SEPARATOR.test(line)) sep.push({ line: i, title: "", kind: "separator" });
    });
    if (sep.length >= 1) return sep;

    return [];
  }

  private scan(
    lines: string[],
    regex: RegExp,
    buildTitle: (m: RegExpMatchArray) => string
  ): { line: number; title: string }[] {
    const found: { line: number; title: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(regex);
      if (m) found.push({ line: i, title: buildTitle(m).trim() });
    }
    return found;
  }
}
