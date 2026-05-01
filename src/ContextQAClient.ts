import { requestUrl } from "obsidian";
import { DeepSeekSettings, ContextQAInput, ContextQAResponse, Relation } from "./types";

const buildPrompt = (input: ContextQAInput): string => `请基于以下上下文回答问题。

【上下文】
${input.context}
${input.surroundingContext ? `\n【周围段落】\n${input.surroundingContext}` : ""}

【问题】
${input.question}

要求：
1. 回答必须基于上下文，可补充必要背景知识
2. 提取关键概念（2-5个）
3. 识别概念间关系（影响/属于/导致/依赖/对立）
4. 生成 2-3 个延伸问题
5. 生成相关标签（2-4个）

严格按以下 JSON 格式返回，不要有任何其他内容：
{
  "answer": "回答内容",
  "concepts": ["概念A", "概念B"],
  "relations": [
    { "from": "概念A", "relation": "影响", "to": "概念B" }
  ],
  "suggested_questions": ["延伸问题1", "延伸问题2"],
  "tags": ["标签1", "标签2"]
}`;

export class ContextQAClient {
  constructor(private settings: DeepSeekSettings) {}

  async ask(input: ContextQAInput): Promise<ContextQAResponse> {
    if (!this.settings.apiKey) {
      throw new Error("请先在插件设置中配置 API Key");
    }

    const res = await requestUrl({
      url: `${this.settings.baseUrl}/v1/chat/completions`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.apiKey}`,
      },
      body: JSON.stringify({
        model: this.settings.model,
        messages: [{ role: "user", content: buildPrompt(input) }],
        temperature: 0.6,
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

  private parse(content: string): ContextQAResponse {
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) ||
      content.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch ? jsonMatch[1] : content;

    try {
      const p = JSON.parse(jsonStr.trim()) as Record<string, unknown>;
      return {
        answer: (p.answer as string) || "",
        concepts: Array.isArray(p.concepts) ? p.concepts as string[] : [],
        relations: Array.isArray(p.relations) ? p.relations as Relation[] : [],
        suggested_questions: Array.isArray(p.suggested_questions) ? p.suggested_questions as string[] : [],
        tags: Array.isArray(p.tags) ? p.tags as string[] : [],
      };
    } catch {
      return { answer: content, concepts: [], relations: [], suggested_questions: [], tags: [] };
    }
  }
}
