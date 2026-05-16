/**
 * 可读性布局引擎
 * 控制信息密度、节奏、视觉层级。
 * 在 MarkdownBeautifier 之后运行，做最终的布局优化。
 */
export class ReadableLayoutEngine {
  /**
   * 优化文档布局
   */
  optimize(content: string): string {
    let result = content;
    result = this.enforceHeadingDepth(result);
    result = this.ensureTLDR(result);
    result = this.balanceDensity(result);
    result = this.addSectionSpacing(result);
    return result;
  }

  /**
   * 标题深度控制
   * 禁止超过 H3，H4+ 转为加粗或 Callout
   */
  private enforceHeadingDepth(content: string): string {
    const lines = content.split("\n");
    return lines.map((line) => {
      // H4 → 加粗段落
      if (/^####\s+(.+)/.test(line)) {
        return `**${line.replace(/^####\s+/, "")}**`;
      }
      // H5/H6 → 加粗
      if (/^#{5,6}\s+(.+)/.test(line)) {
        return `**${line.replace(/^#{5,6}\s+/, "")}**`;
      }
      return line;
    }).join("\n");
  }

  /**
   * 确保文档顶部有 TLDR/摘要
   * 如果文档有 H1 但没有紧跟 summary callout，不强制添加（由 AI 生成）
   * 这里只检查格式：如果有 > [!summary] 确保它在顶部
   */
  private ensureTLDR(content: string): string {
    const lines = content.split("\n");

    // 找到 summary callout 的位置
    const summaryIdx = lines.findIndex((l) => /^>\s*\[!summary\]/.test(l));
    if (summaryIdx <= 0) return content; // 没有或已在顶部

    // 找到第一个 H1 的位置
    const h1Idx = lines.findIndex((l) => /^#\s+/.test(l));
    if (h1Idx < 0) return content;

    // 如果 summary 不在 H1 后面的前 3 行内，移动它
    if (summaryIdx > h1Idx + 3) {
      // 提取 summary 块（可能多行）
      const summaryLines: string[] = [];
      let i = summaryIdx;
      while (i < lines.length && (lines[i].startsWith(">") || lines[i].trim() === "")) {
        if (lines[i].startsWith(">")) summaryLines.push(lines[i]);
        else if (summaryLines.length > 0) break;
        i++;
      }

      // 从原位置删除
      lines.splice(summaryIdx, summaryLines.length);

      // 插入到 H1 后面
      lines.splice(h1Idx + 1, 0, "", ...summaryLines, "");
    }

    return lines.join("\n");
  }

  /**
   * 平衡信息密度
   * 如果连续多个列表项（>8），插入分组标记
   */
  private balanceDensity(content: string): string {
    const lines = content.split("\n");
    const result: string[] = [];
    let consecutiveListItems = 0;

    for (const line of lines) {
      if (/^[-*]\s/.test(line)) {
        consecutiveListItems++;
        // 每 6 个列表项后插入空行（视觉分组）
        if (consecutiveListItems > 0 && consecutiveListItems % 6 === 0) {
          result.push("");
        }
      } else {
        consecutiveListItems = 0;
      }
      result.push(line);
    }

    return result.join("\n");
  }

  /**
   * 章节间距
   * 确保每个 ## 标题前有足够空行
   */
  private addSectionSpacing(content: string): string {
    return content.replace(/([^\n])\n(##\s)/g, "$1\n\n$2");
  }
}
