import { App, TFile, requestUrl } from "obsidian";
import { DeepSeekSettings } from "./types";

export interface SectionAppendResult {
  items: string[];   // 新增条目列表
  raw: string;       // 原始追加文本
}

const APPEND_PROMPT = `你是一个个人知识图谱助手。用户希望为概念页的某个章节补充更多内容。

概念：{{concept}}
章节名：{{section}}
章节现有内容：
{{existing}}

要求：
1. 只生成新增内容，不重复已有条目。
2. 风格与现有内容保持一致。
3. 生成 {{count}} 条新内容。
4. 严格按以下 JSON 格式返回，不要有任何其他内容：
{
  "items": ["新条目1", "新条目2"]
}`;

export class SectionAppender {
  constructor(private app: App, private settings: DeepSeekSettings) {}

  /** 从文件内容中提取指定 section 的现有内容 */
  extractSection(content: string, sectionName: string): { existing: string; startIndex: number; endIndex: number } | null {
    // 匹配 ## sectionName 到下一个 ## 或文件末尾
    const regex = new RegExp(`(^##\\s+${this.escapeRegex(sectionName)}\\s*\\n)([\\s\\S]*?)(?=\\n##\\s|$)`, "m");
    const match = content.match(regex);
    if (!match) return null;

    const startIndex = content.indexOf(match[0]);
    const headerEnd = startIndex + match[1].length;
    const endIndex = startIndex + match[0].length;

    return {
      existing: match[2].trim(),
      startIndex: headerEnd,
      endIndex,
    };
  }

  /** 识别光标所在的 section 名称 */
  getSectionAtCursor(content: string, cursorLine: number): string | null {
    const lines = content.split("\n");
    // 从光标行向上找最近的 ## 标题
    for (let i = cursorLine; i >= 0; i--) {
      const match = lines[i]?.match(/^##\s+(.+)/);
      if (match) return match[1].trim();
    }
    return null;
  }

  /** 调用 DeepSeek 生成追加内容 */
  async generate(
    conceptName: string,
    sectionName: string,
    existingContent: string,
    count = 3
  ): Promise<SectionAppendResult> {
    if (!this.settings.apiKey) {
      throw new Error("请先配置 API Key");
    }

    const prompt = APPEND_PROMPT
      .replace("{{concept}}", conceptName)
      .replace("{{section}}", sectionName)
      .replace("{{existing}}", existingContent || "（暂无内容）")
      .replace("{{count}}", String(count));

    const res = await requestUrl({
      url: `${this.settings.baseUrl}/v1/chat/completions`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.apiKey}`,
      },
      body: JSON.stringify({
        model: this.settings.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
      }),
      throw: false,
    });

    if (res.status !== 200) {
      throw new Error(`API 错误: ${res.status} - ${res.text}`);
    }

    const data = res.json;
    const raw = data.choices?.[0]?.message?.content ?? "";
    return this.parse(raw, sectionName);
  }

  /** 将新条目追加写入文件的指定 section */
  async appendToSection(file: TFile, sectionName: string, newItems: string[]): Promise<void> {
    const content = await this.app.vault.read(file);
    const section = this.extractSection(content, sectionName);

    if (!section) {
      // section 不存在则在文件末尾新建
      const appendText = `\n## ${sectionName}\n${this.formatItems(newItems, sectionName)}\n`;
      await this.app.vault.modify(file, content.trimEnd() + appendText);
      return;
    }

    const newText = this.formatItems(newItems, sectionName);
    const updated =
      content.slice(0, section.endIndex).trimEnd() +
      "\n" + newText + "\n" +
      content.slice(section.endIndex);

    await this.app.vault.modify(file, updated);
  }

  private formatItems(items: string[], sectionName: string): string {
    // 关联概念保持 [[链接]] 格式，其他用列表
    if (sectionName === "关联概念") {
      return items.map((item) => {
        // 如果已经是 [[xxx]]：yyy 格式则直接用，否则包装
        return item.startsWith("- ") ? item : `- ${item}`;
      }).join("\n");
    }
    return items.map((item) => `- ${item}`).join("\n");
  }

  private parse(content: string, sectionName: string): SectionAppendResult {
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) ||
      content.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch ? jsonMatch[1] : content;

    try {
      const p = JSON.parse(jsonStr.trim()) as Record<string, unknown>;
      const items: string[] = Array.isArray(p.items) ? p.items as string[] : [];
      return { items, raw: this.formatItems(items, sectionName) };
    } catch {
      // 降级：把每行当作一个条目
      const items = content.split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
      return { items, raw: this.formatItems(items, sectionName) };
    }
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
