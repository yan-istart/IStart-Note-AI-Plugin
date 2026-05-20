import { DeepSeekSettings, DeepSeekResponse } from "../types";
import { LLMClient, parseJsonSafe } from "../core/llm";

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
  private llm: LLMClient;

  constructor(settings: DeepSeekSettings) {
    this.llm = new LLMClient(settings);
  }

  async ask(question: string): Promise<DeepSeekResponse> {
    const content = await this.llm.chat({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: question,
      temperature: 0.7,
    });

    if (!content) {
      throw new Error("DeepSeek 返回内容为空");
    }

    return this.parseResponse(content);
  }

  private parseResponse(content: string): DeepSeekResponse {
    const parsed = parseJsonSafe<Partial<DeepSeekResponse> | null>(content, null);
    if (!parsed) {
      return { answer: content, concepts: [], relations: [], tags: [] };
    }
    return {
      answer: parsed.answer ?? "",
      concepts: Array.isArray(parsed.concepts) ? parsed.concepts : [],
      relations: Array.isArray(parsed.relations) ? parsed.relations : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    };
  }
}
