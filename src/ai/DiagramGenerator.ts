import { requestUrl } from "obsidian";
import { DeepSeekSettings } from "../types";

export type DiagramType =
  | "auto"
  | "flowchart"
  | "sequence"
  | "state"
  | "class"
  | "architecture"
  | "formula"
  | "gantt"
  | "er";

export interface DiagramResult {
  type: DiagramType;       // 实际生成的类型
  typeName: string;        // 中文名
  code: string;            // Mermaid 代码或 LaTeX 公式
  explanation?: string;    // 简短说明
}

const DIAGRAM_LABELS: Record<DiagramType, string> = {
  auto: "智能推荐",
  flowchart: "流程图",
  sequence: "时序图",
  state: "状态图",
  class: "类图",
  architecture: "架构图",
  formula: "数学公式",
  gantt: "甘特图",
  er: "ER 图",
};

const PROMPT = `你是一个技术文档可视化助手。根据用户提供的文字内容，生成对应的可视化代码。

用户选中的内容：
{{selection}}

{{context_section}}

要求生成类型：{{type}}

规则：
1. 如果类型是 "auto"，请根据内容自动判断最合适的图表类型。
2. 如果是 Mermaid 图（flowchart/sequence/state/class/architecture/gantt/er），输出合法的 Mermaid 语法。
3. 如果是 formula（数学公式），输出 LaTeX 数学公式（不含 $$ 包裹符号）。
4. 节点文字使用中文（如果原文是中文）。
5. 保持简洁，突出核心逻辑，不要过度复杂。
6. Mermaid 中节点 ID 只用英文字母和数字，中文放在方括号标签里，如 A["中文标签"]。

严格按以下 JSON 格式返回，不要有任何其他内容：
{
  "type": "实际类型（flowchart/sequence/state/class/architecture/formula/gantt/er）",
  "code": "Mermaid 代码或 LaTeX 公式",
  "explanation": "一句话说明生成了什么"
}`;

export class DiagramGenerator {
  constructor(private settings: DeepSeekSettings) {}

  async generate(
    selection: string,
    type: DiagramType = "auto",
    surroundingContext?: string
  ): Promise<DiagramResult> {
    if (!this.settings.apiKey) {
      throw new Error("请先配置 API Key");
    }

    const contextSection = surroundingContext
      ? `当前文件的上下文（供参考）：\n${surroundingContext}`
      : "";

    const prompt = PROMPT
      .replace("{{selection}}", selection)
      .replace("{{context_section}}", contextSection)
      .replace("{{type}}", type === "auto" ? "auto（请自动判断最合适的类型）" : type);

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
        temperature: 0.4,
      }),
      throw: false,
    });

    if (res.status !== 200) {
      throw new Error(`API 错误: ${res.status} - ${res.text}`);
    }

    const data = res.json;
    const content = data.choices?.[0]?.message?.content ?? "";
    return this.parse(content);
  }

  /** 优化/扩展已有的图表代码 */
  async refine(
    existingCode: string,
    instruction: string
  ): Promise<DiagramResult> {
    if (!this.settings.apiKey) {
      throw new Error("请先配置 API Key");
    }

    const prompt = `你是一个技术文档可视化助手。用户有一段已有的 Mermaid/LaTeX 代码，需要你根据指令进行优化或扩展。

已有代码：
\`\`\`
${existingCode}
\`\`\`

用户指令：${instruction}

规则：
1. 保留原有结构，在此基础上修改。
2. 输出完整的修改后代码。

严格按以下 JSON 格式返回：
{
  "type": "图表类型",
  "code": "修改后的完整代码",
  "explanation": "修改说明"
}`;

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
        temperature: 0.4,
      }),
      throw: false,
    });

    if (res.status !== 200) {
      throw new Error(`API 错误: ${res.status} - ${res.text}`);
    }

    const data = res.json;
    const content = data.choices?.[0]?.message?.content ?? "";
    return this.parse(content);
  }

  private parse(content: string): DiagramResult {
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) ||
      content.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch ? jsonMatch[1] : content;

    try {
      const p = JSON.parse(jsonStr.trim()) as Record<string, unknown>;
      const type = (p.type as DiagramType) || "flowchart";
      return {
        type,
        typeName: DIAGRAM_LABELS[type] || type,
        code: (p.code as string) || "",
        explanation: (p.explanation as string) || undefined,
      };
    } catch {
      // 降级：尝试直接提取 mermaid 代码
      const mermaidMatch = content.match(/```mermaid\s*([\s\S]*?)```/);
      if (mermaidMatch) {
        return { type: "flowchart", typeName: "流程图", code: mermaidMatch[1].trim() };
      }
      return { type: "flowchart", typeName: "流程图", code: content };
    }
  }

  /** 将结果格式化为可插入笔记的 Markdown */
  formatForInsert(result: DiagramResult): string {
    if (result.type === "formula") {
      return `$$\n${result.code}\n$$`;
    }
    return `\`\`\`mermaid\n${result.code}\n\`\`\``;
  }

  static getTypeLabels(): { value: DiagramType; label: string }[] {
    return [
      { value: "auto", label: "🤖 智能推荐" },
      { value: "flowchart", label: "📊 流程图" },
      { value: "sequence", label: "🔄 时序图" },
      { value: "state", label: "🔀 状态图" },
      { value: "class", label: "🏗 类图" },
      { value: "architecture", label: "🏛 架构图" },
      { value: "er", label: "🗃 ER 图" },
      { value: "gantt", label: "📅 甘特图" },
      { value: "formula", label: "📐 数学公式" },
    ];
  }
}
