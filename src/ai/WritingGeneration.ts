import { LLMClient, LLMResponseError } from "../core/llm";
import type { LLMChatOptions } from "../core/llm";

export const MAX_WRITING_TARGET = 10000;

export function writingLengthInstruction(targetWords: number): string {
  const low = Math.max(1, Math.round(targetWords * 0.8));
  const high = Math.round(targetWords * 1.2);
  return `约 ${targetWords} 字，尽量控制在 ${low}–${high} 字之间，保持句子与段落完整`;
}

export function countWritingCharacters(text: string): number {
  return Array.from(text.replace(/\s/g, "")).length;
}

/** A prose length target is separate from the model's token budget. */
export async function generateWritingText(llm: LLMClient, options: LLMChatOptions, targetWords: number): Promise<string> {
  // New-chapter generation uses up to three times the continuation target.
  if (!Number.isInteger(targetWords) || targetWords < 1 || targetWords > MAX_WRITING_TARGET * 3) {
    throw new Error(`生成目标超出范围，请在生成量设置中调整目标字数`);
  }
  const maxTokens = Math.max(2048, Math.ceil(targetWords * 3) + 512);
  const request: LLMChatOptions = { ...options, maxTokens, thinking: "disabled" };
  try {
    return await llm.chat(request);
  } catch (error) {
    if (!(error instanceof LLMResponseError) || !["output_limit", "reasoning_only", "empty_content"].includes(error.code)) throw error;
    // One bounded retry for empty output only; never retry filtering, invalid responses or HTTP errors.
    try {
      return await llm.chat({ ...request, maxTokens: maxTokens * 2 });
    } catch (retryError) {
      if (retryError instanceof LLMResponseError) {
        throw new LLMResponseError(retryError.code, `${retryError.message}（已自动重试一次）`, retryError.finishReason);
      }
      throw retryError;
    }
  }
}
