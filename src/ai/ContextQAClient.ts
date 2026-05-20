import { DeepSeekSettings, ContextQAInput, ContextQAResponse, Relation } from "../types";
import { LLMClient, parseJsonSafe } from "../core/llm";

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
  private llm: LLMClient;

  constructor(settings: DeepSeekSettings) {
    this.llm = new LLMClient(settings);
  }

  async ask(input: ContextQAInput): Promise<ContextQAResponse> {
    const content = await this.llm.chat({
      userPrompt: buildPrompt(input),
      temperature: 0.6,
    });
    return this.parse(content);
  }

  private parse(content: string): ContextQAResponse {
    const p = parseJsonSafe<Record<string, unknown> | null>(content, null);
    if (!p) {
      return { answer: content, concepts: [], relations: [], suggested_questions: [], tags: [] };
    }
    return {
      answer: (p.answer as string) || "",
      concepts: Array.isArray(p.concepts) ? (p.concepts as string[]) : [],
      relations: Array.isArray(p.relations) ? (p.relations as Relation[]) : [],
      suggested_questions: Array.isArray(p.suggested_questions)
        ? (p.suggested_questions as string[])
        : [],
      tags: Array.isArray(p.tags) ? (p.tags as string[]) : [],
    };
  }
}
