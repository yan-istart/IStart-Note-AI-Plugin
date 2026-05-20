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
   * @returns The raw assistant message content (string, possibly empty).
   */
  async chat(options: LLMChatOptions): Promise<string> {
    this.ensureApiKey();

    const messages: { role: "system" | "user"; content: string }[] = [];
    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: options.userPrompt });

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
      }),
      throw: false,
    });

    if (res.status !== 200) {
      throw new LLMError(res.status, `LLM API 错误: ${res.status}`, res.text);
    }

    return res.json?.choices?.[0]?.message?.content ?? "";
  }
}
