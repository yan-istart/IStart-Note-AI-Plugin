import { DeepSeekSettings, QuestionClassification } from "./types";

const CLASSIFY_PROMPT = `你是一个知识图谱助手，负责对用户的问题进行分类和关联。

问题类型定义：
- new：全新问题，不依赖已有问题，引入新领域
- refinement：对某个已有问题的深入追问
- expansion：对某个已有问题的横向扩展

当前问题：
{{question}}

历史问题列表（最近20条）：
{{history}}

请严格按以下 JSON 格式返回，不要有任何其他内容：
{
  "category": "new | refinement | expansion",
  "parent": "最相关的历史问题标题，没有则为 null",
  "related": ["相关问题1", "相关问题2"],
  "confidence": 0.9,
  "refinements": ["推荐深化问题1", "推荐深化问题2"],
  "expansions": ["推荐扩展问题1", "推荐扩展问题2"]
}`;

export class QuestionClassifier {
  constructor(private settings: DeepSeekSettings) {}

  async classify(question: string, history: string[]): Promise<QuestionClassification> {
    if (!this.settings.apiKey) {
      return this.defaultClassification();
    }

    const prompt = CLASSIFY_PROMPT
      .replace("{{question}}", question)
      .replace("{{history}}", history.length > 0 ? history.map((q, i) => `${i + 1}. ${q}`).join("\n") : "（无历史问题）");

    try {
      const response = await fetch(`${this.settings.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.settings.apiKey}`,
        },
        body: JSON.stringify({
          model: this.settings.model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
        }),
      });

      if (!response.ok) throw new Error(`API ${response.status}`);

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content ?? "";
      return this.parse(content);
    } catch {
      return this.defaultClassification();
    }
  }

  private parse(content: string): QuestionClassification {
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) ||
      content.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch ? jsonMatch[1] : content;

    try {
      const p = JSON.parse(jsonStr.trim());
      return {
        category: ["new", "refinement", "expansion"].includes(p.category) ? p.category : "new",
        parent: typeof p.parent === "string" ? p.parent : null,
        related: Array.isArray(p.related) ? p.related : [],
        confidence: typeof p.confidence === "number" ? p.confidence : 0.5,
        refinements: Array.isArray(p.refinements) ? p.refinements : [],
        expansions: Array.isArray(p.expansions) ? p.expansions : [],
      };
    } catch {
      return this.defaultClassification();
    }
  }

  private defaultClassification(): QuestionClassification {
    return { category: "new", parent: null, related: [], confidence: 0, refinements: [], expansions: [] };
  }
}
