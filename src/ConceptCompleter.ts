import { requestUrl } from "obsidian";
import { DeepSeekSettings, CompletionDepth, ConceptCompletionResult } from "./types";

const LIGHT_PROMPT = `你是一个个人知识图谱助手。请为以下概念生成简明的定义和关联概念。

概念：{{concept}}
来源问题：{{source_question}}
来源回答：{{source_answer}}
已有相关概念：{{related_concepts}}

严格按以下 JSON 格式输出，不要有任何其他内容：
{
  "definition": "简明定义",
  "explanation": "",
  "examples": [],
  "related_concepts": [
    { "name": "概念名", "relation": "关系类型", "description": "关系说明" }
  ],
  "related_questions": [],
  "tags": ["标签1"]
}`;

const STANDARD_PROMPT = `你是一个个人知识图谱助手。请根据给定概念和上下文，为 Obsidian 概念页生成内容。

要求：
1. 内容准确、简洁、适合长期存入个人知识库。
2. 关联概念使用概念名字符串，插件会自动转为 Obsidian 双链。
3. 不要编造具体来源。
4. 如果上下文不足，请给出通用但谨慎的定义。

概念：{{concept}}
来源问题：{{source_question}}
来源回答：{{source_answer}}
已有相关概念：{{related_concepts}}

严格按以下 JSON 格式输出，不要有任何其他内容：
{
  "definition": "简明定义",
  "explanation": "核心解释，包含关键内涵、边界和常见误解",
  "examples": ["例子1", "例子2"],
  "related_concepts": [
    { "name": "概念名", "relation": "关系类型", "description": "关系说明" }
  ],
  "related_questions": ["相关问题1", "相关问题2"],
  "tags": ["标签1", "标签2"]
}`;

export class ConceptCompleter {
  constructor(private settings: DeepSeekSettings) {}

  async complete(
    concept: string,
    depth: CompletionDepth,
    context: { sourceQuestion?: string; sourceAnswer?: string; relatedConcepts?: string[] }
  ): Promise<ConceptCompletionResult> {
    if (!this.settings.apiKey) {
      throw new Error("请先在插件设置中配置 DeepSeek API Key");
    }

    const template = depth === "light" ? LIGHT_PROMPT : STANDARD_PROMPT;
    const prompt = template
      .replace("{{concept}}", concept)
      .replace("{{source_question}}", context.sourceQuestion || "无")
      .replace("{{source_answer}}", context.sourceAnswer || "无")
      .replace("{{related_concepts}}", (context.relatedConcepts || []).join("、") || "无");

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
        temperature: 0.5,
      }),
      throw: false,
    });

    if (res.status !== 200) {
      throw new Error(`DeepSeek API 错误: ${res.status} - ${res.text}`);
    }

    const data = res.json;
    const content = data.choices?.[0]?.message?.content ?? "";
    return this.parse(content);
  }

  private parse(content: string): ConceptCompletionResult {
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) ||
      content.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch ? jsonMatch[1] : content;

    try {
      const p = JSON.parse(jsonStr.trim()) as Record<string, unknown>;
      return {
        definition: (p.definition as string) || "",
        explanation: (p.explanation as string) || "",
        examples: Array.isArray(p.examples) ? p.examples as string[] : [],
        related_concepts: Array.isArray(p.related_concepts) ? p.related_concepts as ConceptCompletionResult["related_concepts"] : [],
        related_questions: Array.isArray(p.related_questions) ? p.related_questions as string[] : [],
        tags: Array.isArray(p.tags) ? p.tags as string[] : [],
      };
    } catch {
      return {
        definition: content,
        explanation: "",
        examples: [],
        related_concepts: [],
        related_questions: [],
        tags: [],
      };
    }
  }
}
