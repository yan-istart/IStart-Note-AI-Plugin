import { DeepSeekSettings } from "../types";
import { LLMClient } from "../core/llm";

export interface AnnotationDraftInput {
  fileName: string;
  heading: string;
  selection: string;
  before: string;
  after: string;
}

const SYSTEM_PROMPT = `你是阅读批注助手。用户正在阅读一篇笔记，选中了一段文字，想留下一条以后能快速看懂的批注。
请写一条简洁、具体的批注，帮助用户回忆这段文字的价值。

要求：
1. 1-3 句，120 字以内。
2. 不要重复原文，重点说明含义、作用、疑问、启发或与其他知识的关联。
3. 直接输出批注正文，不要 Markdown 标题、列表、引号或“批注：”前缀。`;

/** Ask the configured LLM for a concise annotation draft. */
export async function draftAnnotation(settings: DeepSeekSettings, input: AnnotationDraftInput): Promise<string> {
  const selection = input.selection.trim();
  if (!selection) throw new Error("请先选中文字");

  const context = [
    `笔记：${input.fileName || "当前笔记"}`,
    input.heading ? `所在章节：${input.heading}` : "",
    input.before ? `上文（节选）：\n${input.before.slice(-600)}` : "",
    `【选中文字】\n${selection.slice(0, 4000)}`,
    input.after ? `下文（节选）：\n${input.after.slice(0, 600)}` : "",
  ].filter(Boolean).join("\n\n");

  const llm = new LLMClient(settings);
  const raw = await llm.chat({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: context,
    temperature: 0.4,
    thinking: "disabled",
  });
  const draft = cleanAnnotationDraft(raw);
  if (!draft) throw new Error("AI 未能生成有效批注，请重试");
  return draft;
}

/** Remove conversational wrappers the model may add despite the prompt. */
export function cleanAnnotationDraft(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/```$/, "")
    .trim()
    .replace(/^["“”'‘’]+|["“”'‘’]+$/g, "")
    .replace(/^(批注|注释)[：:]\s*/i, "")
    .trim()
    .slice(0, 500);
}
