/**
 * 原稿清洗器 — 确定性规则,无 AI 依赖,可单测。
 */

export interface CleanOptions {
  /** 清理防盗水印 / 站点广告话术 */
  removeWatermarks: boolean;
  /** 合并段落内硬换行(网文常每句一行) */
  mergeHardBreaks: boolean;
  /** 作者的话处理方式 */
  authorNotes: "keep-callout" | "keep-plain" | "strip";
}

export const DEFAULT_CLEAN_OPTIONS: CleanOptions = {
  removeWatermarks: true,
  mergeHardBreaks: true,
  authorNotes: "keep-callout",
};

/** 常见防盗水印 / 站点话术(保守清单,避免误删正文) */
const WATERMARK_PATTERNS = [
  /请记住本站域名[^\n]*/g,
  /请收藏本站[^\n]*/g,
  /本书首发[^\n]*/g,
  /最快更新[^\n]*/g,
  /更新快[^\n]*无广告[^\n]*/g,
  /一秒记住[^\n]*/g,
  /(?:www\.|https?:\/\/)[a-z0-9.\/_-]+/gi,
];

/** 常见 HTML 实体 */
const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&hellip;": "…",
  "&mdash;": "—",
};

/** 作者的话 起始标记 */
const AUTHOR_NOTE = /^\s*(?:作者的话|题外话|作者菌有话|ps\b|p\.s\b)[:：]?\s*/i;
/** 句子结束标点(用于判断硬换行是否应保留) */
const SENTENCE_END = /[。！？…”"」』:：]$/;

export class TextCleaner {
  clean(text: string, options: CleanOptions = DEFAULT_CLEAN_OPTIONS): string {
    let result = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");

    // HTML 实体
    for (const [entity, ch] of Object.entries(HTML_ENTITIES)) {
      result = result.split(entity).join(ch);
    }

    if (options.removeWatermarks) {
      for (const pattern of WATERMARK_PATTERNS) {
        result = result.replace(pattern, "");
      }
    }

    // 作者的话
    result = this.handleAuthorNotes(result, options.authorNotes);

    if (options.mergeHardBreaks) {
      result = this.mergeLines(result);
    }

    // 压缩连续空行
    return result
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // ── 内部 ───────────────────────────────────────────────────

  private mergeLines(text: string): string {
    const lines = text.split("\n");
    const out: string[] = [];

    for (const raw of lines) {
      const line = raw.trimEnd();
      const trimmed = line.trim();
      if (trimmed === "") {
        out.push("");
        continue;
      }

      // 引用/Callout 行不参与合并
      if (trimmed.startsWith(">") || trimmed.startsWith("|")) {
        out.push(trimmed);
        continue;
      }

      const prev = out[out.length - 1];
      if (prev === "" || prev === undefined || prev.startsWith(">")) {
        out.push(trimmed);
        continue;
      }

      if (SENTENCE_END.test(prev)) {
        // 上一行已结尾 → 新行(对话/短段落保留)
        out.push(trimmed);
      } else {
        // 上一行未结尾 → 视为硬换行,合并
        out[out.length - 1] = prev + trimmed;
      }
    }

    return out.join("\n");
  }

  private handleAuthorNotes(text: string, mode: CleanOptions["authorNotes"]): string {
    if (mode === "keep-plain") return text;

    const lines = text.split("\n");
    const out: string[] = [];
    let inNote = false;

    for (const raw of lines) {
      const line = raw.trimEnd();
      const trimmed = line.trim();

      if (AUTHOR_NOTE.test(trimmed)) {
        inNote = true;
        if (mode === "strip") continue;
        out.push("");
        out.push("> [!note] 作者的话");
        out.push("> " + trimmed.replace(AUTHOR_NOTE, ""));
        continue;
      }

      if (inNote) {
        if (trimmed === "") {
          inNote = false;
          if (mode === "keep-callout") out.push("");
          continue;
        }
        if (mode === "strip") continue;
        out.push("> " + trimmed);
        continue;
      }

      out.push(line);
    }

    return out.join("\n");
  }
}

/** 规则化章节梗概:取首段正文(跳过标题/引用/列表),用于未做 AI 分析的章节 */
export function ruleSynopsis(content: string, maxLen = 80): string {
  const lines = content.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length < 10) continue;
    if (/^[#>|>\-*[\]`]/.test(line)) continue;
    return line.length > maxLen ? line.slice(0, maxLen) + "…" : line;
  }
  return "";
}
