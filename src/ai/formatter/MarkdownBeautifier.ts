/**
 * Markdown 美化器
 * 对 AI 输出（或任何 Markdown 内容）进行后处理，提升可读性。
 */
export class MarkdownBeautifier {
  private knownConcepts: Set<string>;

  constructor(knownConcepts?: string[]) {
    this.knownConcepts = new Set(knownConcepts ?? []);
  }

  /** 执行所有美化步骤 */
  beautify(content: string): string {
    let result = content;
    result = this.splitLongParagraphs(result);
    result = this.convertCallouts(result);
    result = this.insertVisualBreaks(result);
    result = this.autoLinkConcepts(result);
    result = this.cleanupSpacing(result);
    return result;
  }

  /**
   * 1. 长段落拆分
   * 超过 4 行的连续文本段落，在句号处拆分
   */
  private splitLongParagraphs(content: string): string {
    const lines = content.split("\n");
    const result: string[] = [];
    let paragraphLines: string[] = [];

    const flushParagraph = () => {
      if (paragraphLines.length <= 4) {
        result.push(...paragraphLines);
      } else {
        // 合并后按句号拆分
        const text = paragraphLines.join("\n");
        const sentences = text.split(/(?<=[。！？.!?])\s*/);
        let chunk: string[] = [];
        let lineCount = 0;
        for (const sentence of sentences) {
          chunk.push(sentence);
          lineCount += Math.ceil(sentence.length / 40); // 估算行数
          if (lineCount >= 3) {
            result.push(chunk.join(""));
            result.push("");
            chunk = [];
            lineCount = 0;
          }
        }
        if (chunk.length > 0) result.push(chunk.join(""));
      }
      paragraphLines = [];
    };

    for (const line of lines) {
      const isStructural = /^(#|>|\||-|\d+\.|```|---|\s*$)/.test(line);
      if (isStructural) {
        flushParagraph();
        result.push(line);
      } else {
        paragraphLines.push(line);
      }
    }
    flushParagraph();

    return result.join("\n");
  }

  /**
   * 2. 自动 Callout 转换
   * 识别特定模式并转为 Obsidian Callout
   */
  private convertCallouts(content: string): string {
    let result = content;

    // 模式：风险：xxx / 注意：xxx / 警告：xxx
    result = result.replace(
      /^(风险|注意|警告|⚠️)[:：]\s*(.+)$/gm,
      "> [!warning] $1\n> $2"
    );

    // 模式：建议：xxx / 技巧：xxx / 提示：xxx
    result = result.replace(
      /^(建议|技巧|提示|💡)[:：]\s*(.+)$/gm,
      "> [!tip] $1\n> $2"
    );

    // 模式：总结：xxx / 结论：xxx / 摘要：xxx
    result = result.replace(
      /^(总结|结论|摘要|核心)[:：]\s*(.+)$/gm,
      "> [!summary] $1\n> $2"
    );

    // 模式：示例：xxx / 例如：xxx
    result = result.replace(
      /^(示例|例如|例子)[:：]\s*(.+)$/gm,
      "> [!example] $1\n> $2"
    );

    // 模式：决策：xxx
    result = result.replace(
      /^(决策|决定)[:：]\s*(.+)$/gm,
      "> [!abstract] $1\n> $2"
    );

    return result;
  }

  /**
   * 3. 插入视觉断点
   * 每 250-350 字（约 3-4 段）如果没有标题/callout/分隔线，插入分隔
   */
  private insertVisualBreaks(content: string): string {
    const lines = content.split("\n");
    const result: string[] = [];
    let charsSinceBreak = 0;

    for (const line of lines) {
      const isBreak = /^(#{1,6}\s|>|---|\||\s*$|```mermaid)/.test(line);

      if (isBreak) {
        charsSinceBreak = 0;
      } else {
        charsSinceBreak += line.length;
      }

      result.push(line);

      // 如果累积超过 300 字且下一行不是结构性元素，插入空行
      if (charsSinceBreak > 300 && !isBreak) {
        result.push("");
        charsSinceBreak = 0;
      }
    }

    return result.join("\n");
  }

  /**
   * 4. 自动双链
   * 将已知概念转为 [[双链]] 格式
   */
  private autoLinkConcepts(content: string): string {
    if (this.knownConcepts.size === 0) return content;

    let result = content;

    // 按长度降序排列，避免短词匹配到长词的子串
    const sorted = [...this.knownConcepts].sort((a, b) => b.length - a.length);

    for (const concept of sorted) {
      if (concept.length < 2) continue; // 跳过太短的

      // 不在以下位置替换：已有双链内、代码块内、标题内、Mermaid 内
      const regex = new RegExp(
        `(?<!\\[\\[)(?<!\\w)${this.escapeRegex(concept)}(?!\\w)(?!\\]\\])`,
        "g"
      );

      // 只替换正文中的（跳过代码块和 mermaid）
      const lines = result.split("\n");
      let inCodeBlock = false;
      result = lines.map((line) => {
        if (line.startsWith("```")) inCodeBlock = !inCodeBlock;
        if (inCodeBlock) return line;
        if (/^#/.test(line)) return line; // 跳过标题
        if (/^>/.test(line)) return line.replace(regex, `[[${concept}]]`); // callout 内也替换
        return line.replace(regex, `[[${concept}]]`);
      }).join("\n");
    }

    return result;
  }

  /**
   * 5. 清理多余空行
   */
  private cleanupSpacing(content: string): string {
    // 连续 3 个以上空行合并为 2 个
    return content.replace(/\n{4,}/g, "\n\n\n");
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
