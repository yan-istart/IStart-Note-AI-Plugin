import { DeepSeekSettings, DeepSeekResponse } from "./types";

const SYSTEM_PROMPT = `你是一个知识图谱构建助手。用户会向你提问，你需要：
1. 给出清晰的回答
2. 提取关键概念（3-7个）
3. 识别概念间的关系（限于：影响、属于、导致、依赖、对立）
4. 生成相关标签（2-5个）

严格按照以下 JSON 格式返回，不要有任何其他内容：
{
  "answer": "详细回答",
  "concepts": ["概念A", "概念B"],
  "relations": [
    { "from": "概念A", "relation": "影响", "to": "概念B" }
  ],
  "tags": ["标签1", "标签2"]
}`;

export class DeepSeekClient {
  constructor(private settings: DeepSeekSettings) {}

  async ask(question: string): Promise<DeepSeekResponse> {
    if (!this.settings.apiKey) {
      throw new Error("请先在插件设置中配置 DeepSeek API Key");
    }

    const response = await fetch(`${this.settings.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.apiKey}`,
      },
      body: JSON.stringify({
        model: this.settings.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: question },
        ],
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`DeepSeek API 错误: ${response.status} - ${err}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("DeepSeek 返回内容为空");
    }

    return this.parseResponse(content);
  }

  private parseResponse(content: string): DeepSeekResponse {
    // 提取 JSON，兼容模型可能包裹 markdown 代码块的情况
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) ||
      content.match(/(\{[\s\S]*\})/);

    const jsonStr = jsonMatch ? jsonMatch[1] : content;

    try {
      const parsed = JSON.parse(jsonStr.trim());
      return {
        answer: parsed.answer || "",
        concepts: Array.isArray(parsed.concepts) ? parsed.concepts : [],
        relations: Array.isArray(parsed.relations) ? parsed.relations : [],
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      };
    } catch {
      // 解析失败时，至少保留回答内容
      return {
        answer: content,
        concepts: [],
        relations: [],
        tags: [],
      };
    }
  }
}
