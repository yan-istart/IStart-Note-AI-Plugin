import { requestUrl } from "obsidian";
import { DeepSeekSettings } from "../../types";

/**
 * Unified LLM chat-completion client.
 *
 * Centralizes:
 *  - OpenAI-compatible chat-completions request shape
 *  - API-key validation
 *  - Error normalization
 *  - Default headers / timeouts
 *
 * All AI feature modules (assistant, classifier, completer, planner, ...)
 * should use this client instead of calling `requestUrl` directly.
 *
 * Provider-agnostic by design: the request payload conforms to the
 * `chat/completions` schema used by DeepSeek, OpenAI, and most compatible
 * providers. Adding a new provider should only require subclassing or
 * swapping out this module.
 */

export interface LLMChatOptions {
  /** Optional system prompt. Sent as the first message when provided. */
  systemPrompt?: string;
  /** Required user prompt. */
  userPrompt: string;
  /** Sampling temperature. Defaults to 0.5. */
  temperature?: number;
  /**
   * Override the model name configured in settings.
   * Useful for tasks that always need a specific model.
   */
  model?: string;
  /** Upper bound on generated tokens; separate from a prose-length target. */
  maxTokens?: number;
  /** Applied to the official DeepSeek endpoint only; compatible providers keep their existing payload. */
  thinking?: "enabled" | "disabled";
}

interface ChatCompletionResponse {
  choices?: { finish_reason?: string; message?: { content?: unknown; reasoning_content?: unknown } }[];
}

export type LLMResponseErrorCode = "output_limit" | "reasoning_only" | "empty_content" | "invalid_response" | "content_filter" | "interrupted";

/** Keep response diagnostics without exposing reasoning text or request contents. */
export class LLMResponseError extends Error {
  constructor(public code: LLMResponseErrorCode, message: string, public finishReason?: string) {
    super(message);
    this.name = "LLMResponseError";
  }
}

export class LLMError extends Error {
  constructor(public status: number, message: string, public body?: string) {
    super(message);
    this.name = "LLMError";
  }
}

export class LLMClient {
  constructor(private settings: DeepSeekSettings) {}

  /** Throw a friendly error if the API key is not configured. */
  ensureApiKey(): void {
    if (!this.settings.apiKey) {
      throw new Error("请先在插件设置中配置 API Key");
    }
  }

  /**
   * Run a single chat-completion request.
   * @returns The raw assistant message content. Empty or malformed responses have specific errors.
   */
  async chat(options: LLMChatOptions): Promise<string> {
    this.ensureApiKey();

    const messages: { role: "system" | "user"; content: string }[] = [];
    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: options.userPrompt });

    let isOfficialDeepSeek = false;
    try { isOfficialDeepSeek = new URL(this.settings.baseUrl).hostname === "api.deepseek.com"; } catch { /* Request validation handles invalid URLs. */ }

    const res = await requestUrl({
      url: `${this.settings.baseUrl}/v1/chat/completions`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model ?? this.settings.model,
        messages,
        temperature: options.temperature ?? 0.5,
        ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
        ...(isOfficialDeepSeek && options.thinking ? { thinking: { type: options.thinking } } : {}),
      }),
      throw: false,
    });

    if (res.status !== 200) {
      throw new LLMError(res.status, `LLM API 错误: ${res.status}`, res.text);
    }

    const data = res.json as ChatCompletionResponse | undefined;
    const choice = data?.choices?.[0];
    if (!choice?.message) throw new LLMResponseError("invalid_response", "模型服务返回格式异常，未找到生成结果");
    const content = choice.message.content;
    if (content != null && typeof content !== "string") {
      throw new LLMResponseError("invalid_response", "模型服务返回的正文格式无法识别", choice.finish_reason);
    }
    if (typeof content === "string" && content.trim()) return content;
    const reason = choice.finish_reason;
    if (reason === "content_filter") {
      throw new LLMResponseError("content_filter", "模型服务因内容过滤未返回正文", reason);
    }
    if (reason === "length") {
      throw new LLMResponseError("output_limit", "模型已用完生成预算，但尚未输出正文；请调整生成量后重试", reason);
    }
    if (reason === "insufficient_system_resource" || reason === "aborted") {
      throw new LLMResponseError("interrupted", "模型服务中断了生成，请稍后重试", reason);
    }
    if (typeof choice.message.reasoning_content === "string" && choice.message.reasoning_content.trim()) {
      throw new LLMResponseError("reasoning_only", "模型只返回了思考内容，没有输出正文；请检查服务的思考模式配置", reason);
    }
    throw new LLMResponseError("empty_content", "模型服务返回空正文，请调整生成要求或稍后重试", reason);
  }
}
