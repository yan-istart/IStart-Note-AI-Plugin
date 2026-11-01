import { DeepSeekSettings } from "../types";
import { LLMClient } from "../core/llm";

export interface AnnotationDraftInput {
  fileName: string;
  heading: string;
  selection: string;
  before: string;
  after: string;
  existingComment?: string;
}

export interface AnnotationSuggestionInput {
  fileName: string;
  heading: string;
  selection: string;
  comment: string;
  before: string;
  after: string;
}

const SYSTEM_PROMPT = `你是阅读批注助手。用户正在阅读一篇笔记，选中了一段文字，想留下一条以后能快速看懂的批注。
请写一条简洁、具体的批注，帮助用户回忆这段文字的价值。

要求：
1. 1-3 句，120 字以内。
2. 不要重复原文，重点说明含义、作用、疑问、启发或与其他知识的关联。
3. 直接输出批注正文，不要 Markdown 标题、列表、引号或“批注：”前缀。`;

const SUGGESTION_PROMPT = `你是阅读批注助手。用户已经选中了一段文字并写了阅读批注。请根据原文、现有批注和上下文给出具体建议，帮助用户把这条批注想得更深。

要求：
1. 先用一句话概括现有批注已经抓住了什么。
2. 用 Markdown 列表给出 2-4 条具体建议：可补充的角度、与其他知识的关联、值得追问的问题，或可执行的下一步。
3. 如果现有批注为空，直接给出可以从哪些角度批注。
4. 不要重复原文，不要写“建议：”前缀，不要编造原文没有的事实。`;

/** Ask the configured LLM for a concise annotation draft. */
export async function draftAnnotation(settings: DeepSeekSettings, input: AnnotationDraftInput): Promise<string> {
  const selection = input.selection.trim();
  if (!selection) throw new Error("请先选中文字");

  const context = [
    `笔记：${input.fileName || "当前笔记"}`,
    input.heading ? `所在章节：${input.heading}` : "",
    input.before ? `上文（节选）：\n${input.before.slice(-600)}` : "",
    `【选中文字】\n${selection.slice(0, 4000)}`,
    input.existingComment ? `现有批注：\n${input.existingComment.slice(0, 1000)}` : "",
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

/** Ask the LLM how the current annotation could be deepened. */
export async function suggestFromAnnotation(
  settings: DeepSeekSettings,
  input: AnnotationSuggestionInput
): Promise<string> {
  const selection = input.selection.trim();
  if (!selection && !input.comment.trim()) throw new Error("这条批注没有可分析的内容");

  const context = [
    `笔记：${input.fileName || "当前笔记"}`,
    input.heading ? `所在章节：${input.heading}` : "",
    input.before ? `上文（节选）：\n${input.before.slice(-600)}` : "",
    `【被批注的文字】\n${selection.slice(0, 4000)}`,
    `【现有批注】\n${input.comment.trim() || "（尚未填写批注）"}`,
    input.after ? `下文（节选）：\n${input.after.slice(0, 600)}` : "",
  ].filter(Boolean).join("\n\n");

  const llm = new LLMClient(settings);
  const raw = await llm.chat({
    systemPrompt: SUGGESTION_PROMPT,
    userPrompt: context,
    temperature: 0.5,
    thinking: "disabled",
  });
  const suggestion = cleanAnnotationSuggestion(raw);
  if (!suggestion) throw new Error("AI 未能生成有效建议，请重试");
  return suggestion;
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

/** Keep Markdown structure in suggestions, but remove wrappers and runaway length. */
export function cleanAnnotationSuggestion(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/```$/, "")
    .trim()
    .replace(/^(建议|AI 建议)[：:]\s*/i, "")
    .trim()
    .slice(0, 1600);
}
