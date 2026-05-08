import { requestUrl } from "obsidian";
import { DeepSeekSettings } from "../types";

/** 用户请求的上下文 */
export interface AssistantContext {
  selection: string;              // 选中文字
  fileContent: string;            // 当前文件全文
  fileName: string;               // 文件名（不含扩展名）
  fileType: string | undefined;   // frontmatter.type
  cursorLineBefore: string;       // 光标前的最后 500 字（用于续写）
  sectionName: string | null;     // 光标所在 section
  sectionEmpty: boolean;          // 该 section 是否为空
}

/** AI 返回的结果 */
export interface AssistantResult {
  mode: "insert" | "replace" | "append" | "show";  // 如何处理结果
  content: string;                                  // 生成的 Markdown 内容
  explanation?: string;                             // 简短说明
}

const SYSTEM_PROMPT = `你是 Obsidian 笔记插件的 AI 助手。用户会给你一段指令（或不给）和当前上下文，你需要智能理解意图并生成对应的 Markdown 内容。

## 你能做什么

- **扩写/改写**：基于用户选中的文字，扩展或改写
- **续写**：在光标位置继续写
- **补全**：填充空章节（## 标题下没有内容的区域）
- **解释**：解释选中的概念、术语、代码
- **回答问题**：如果用户指令是个问题，直接回答
- **画图**：生成 Mermaid 图表（流程图、时序图、状态图、类图、架构图、ER图、甘特图）
- **数学公式**：用 LaTeX 生成公式（\`$$...$$\` 包裹）
- **总结/摘要**：对文件或选中内容做总结
- **分析文档**：找出文档缺失部分并建议补充

## 输出规则

严格返回 JSON 格式，不要其他内容：
\`\`\`json
{
  "mode": "insert | replace | append | show",
  "content": "生成的 Markdown 内容",
  "explanation": "一句话说明做了什么"
}
\`\`\`

**mode 说明：**
- \`replace\`：替换用户选中的文字（扩写/改写/翻译时用）
- \`insert\`：在光标位置插入新内容（续写/补全 section/插入图表时用）
- \`append\`：追加到文件末尾（总结/分析时用）
- \`show\`：仅展示给用户看，不修改文件（回答问题/解释时用）

**Mermaid 图表必须用代码块包裹：**
\`\`\`mermaid
...
\`\`\`

**数学公式用 \`$$...$$\` 包裹。**

## 智能判断（用户没给指令时）

- 有选中文字 → 扩写
- 光标在空 section 内 → 补全该 section
- 否则 → 续写`;

export class AIAssistant {
  constructor(private settings: DeepSeekSettings) {}

  async run(instruction: string, ctx: AssistantContext): Promise<AssistantResult> {
    if (!this.settings.apiKey) throw new Error("请先配置 API Key");

    const userPrompt = this.buildUserPrompt(instruction, ctx);

    const res = await requestUrl({
      url: `${this.settings.baseUrl}/v1/chat/completions`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.apiKey}`,
      },
      body: JSON.stringify({
        model: this.settings.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.5,
      }),
      throw: false,
    });

    if (res.status !== 200) {
      throw new Error(`API 错误: ${res.status} - ${res.text}`);
    }

    const raw = res.json.choices?.[0]?.message?.content ?? "";
    return this.parse(raw);
  }

  private buildUserPrompt(instruction: string, ctx: AssistantContext): string {
    const parts: string[] = [];

    // 指令
    if (instruction.trim()) {
      parts.push(`【用户指令】\n${instruction.trim()}`);
    } else {
      parts.push(`【用户指令】\n（未指定，请根据上下文智能判断）`);
    }

    // 上下文
    parts.push(`\n【当前文件】${ctx.fileName}${ctx.fileType ? ` (type: ${ctx.fileType})` : ""}`);

    if (ctx.selection) {
      parts.push(`\n【选中文字】\n${ctx.selection}`);
    }

    if (ctx.sectionName) {
      parts.push(`\n【光标所在章节】${ctx.sectionName}${ctx.sectionEmpty ? "（空）" : ""}`);
    }

    if (!ctx.selection && ctx.cursorLineBefore) {
      parts.push(`\n【光标前内容（用于续写参考）】\n${ctx.cursorLineBefore.slice(-500)}`);
    }

    // 文件全文（截断）
    if (ctx.fileContent && ctx.fileContent.length < 2000) {
      parts.push(`\n【文件全文】\n${ctx.fileContent}`);
    } else if (ctx.fileContent) {
      parts.push(`\n【文件全文（截取）】\n${ctx.fileContent.slice(0, 2000)}\n...（省略）`);
    }

    return parts.join("\n");
  }

  private parse(raw: string): AssistantResult {
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch ? jsonMatch[1] : raw;

    try {
      const p = JSON.parse(jsonStr.trim()) as Record<string, unknown>;
      const mode = (p.mode as AssistantResult["mode"]) || "show";
      return {
        mode: ["insert", "replace", "append", "show"].includes(mode) ? mode : "show",
        content: (p.content as string) || raw,
        explanation: (p.explanation as string) || undefined,
      };
    } catch {
      // 解析失败，当作 show 模式展示
      return { mode: "show", content: raw };
    }
  }
}
