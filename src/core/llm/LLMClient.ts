import { requestUrl } from "obsidian";
import { DeepSeekSettings } from "../../types";
import type { SkillDefinition, SkillFeature } from "../skills/types";
import { resolveActiveSkills } from "../skills/SkillRuntime";
import { renderSkillInstructions } from "../skills/SkillPrompt";

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

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMChatOptions {
  signal?: AbortSignal;
  /** Opt-in streaming transport; falls back to requestUrl when browser CORS prevents fetch. */
  onDelta?: (text: string) => void;
  onTransport?: (transport: "streaming" | "buffered") => void;
  /** Story protocols must not commit truncated or unterminated responses as completed turns. */
  requireComplete?: boolean;
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
  /** Identifies the calling feature for writing-skill selection. */
  skillFeature?: SkillFeature;
  /** Optional writing scope for calls made before a file is active (for example, planning a new work). */
  skillContext?: {
    genre?: string;
    projectTitle?: string;
    projectPath?: string;
    /** Set false when the active note is unrelated (for example, new-project planning). */
    useActiveFile?: boolean;
  };
}

interface ChatCompletionResponse {
  choices?: { finish_reason?: string; message?: { content?: unknown; reasoning_content?: unknown } }[];
}

export type LLMResponseErrorCode = "output_limit" | "reasoning_only" | "empty_content" | "invalid_response" | "content_filter" | "interrupted";

/** Keep response diagnostics without exposing reasoning text or request contents. */
export class LLMResponseError extends Error {
  constructor(public code: LLMResponseErrorCode, message: string, public finishReason?: string, public partialContent?: string) {
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
  constructor(private settings: DeepSeekSettings, private defaults: { skillContext?: LLMChatOptions["skillContext"]; signal?: AbortSignal; skills?: SkillDefinition[] } = {}) {}

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
    return this.chatMessages([{ role: "user", content: options.userPrompt }], options);
  }

  async chatMessages(history: LLMMessage[], options: Omit<LLMChatOptions, "userPrompt"> = {}): Promise<string> {
    this.ensureApiKey();
    if (!history.length) throw new Error("对话消息不能为空");
    const signal = this.defaults.signal ?? options.signal;
    if (signal?.aborted) throw new Error("生成已停止");
    const skillContext = this.defaults.skillContext ?? options.skillContext;
    let activeSkills: SkillDefinition[] = this.defaults.skills ?? [];
    if (!this.defaults.skills) {
      try {
        activeSkills = await resolveActiveSkills({
          systemPrompt: options.systemPrompt,
          userPrompt: [...history].reverse().find(m => m.role === "user")?.content ?? "",
          feature: options.skillFeature ?? "other",
          ...skillContext,
        });
      } catch { activeSkills = []; }
    }
    const systemPrompt = [options.systemPrompt, renderSkillInstructions(activeSkills)].filter(Boolean).join("\n\n");
    const messages: LLMMessage[] = [...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []), ...history];

    let isOfficialDeepSeek = false;
    try { isOfficialDeepSeek = new URL(this.settings.baseUrl).hostname === "api.deepseek.com"; } catch { /* Request validation handles invalid URLs. */ }

    const url = `${this.settings.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${this.settings.apiKey}` };
    const payload = {
      model: options.model ?? this.settings.model, messages,
      temperature: options.temperature ?? 0.5,
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
      ...(isOfficialDeepSeek && options.thinking ? { thinking: { type: options.thinking } } : {}),
    };
    const request = async () => {
      if (options.onDelta) {
        try { return await streamCompletion(url, headers, payload, options.onDelta, signal, options.onTransport); }
        catch (error) {
          // A fetch/CORS failure before receiving data is safe to retry using Obsidian's transport.
          if (!(error instanceof StreamUnavailable) || signal?.aborted) throw error;
        }
      }
      options.onTransport?.("buffered");
      const response = await requestUrl({ url, method: "POST", headers, body: JSON.stringify(payload), throw: false });
      return response;
    };
    if (signal?.aborted) throw new Error("生成已停止");
    const res = await abortable(request(), signal);

    if (res.status !== 200) {
      throw new LLMError(res.status, `LLM API 错误: ${res.status}`, res.text);
    }

    const data = res.json as ChatCompletionResponse | undefined;
    const choice = data?.choices?.[0];
    if (!choice?.message) throw new LLMResponseError("invalid_response", "模型服务返回格式异常，未找到生成结果");
    const content = choice.message.content;
    if (options.requireComplete && choice.finish_reason !== "stop") {
      throw new LLMResponseError(choice.finish_reason === "length" ? "output_limit" : "interrupted", "本次回应未完整结束，已保留收到的原稿，可继续演绎", choice.finish_reason, typeof content === "string" ? content : undefined);
    }
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


class StreamUnavailable extends Error {}

/** requestUrl has no cancellation API; discard late results and never execute subsequent tools. */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const cancel = () => { cleanup(); reject(new Error("生成已停止")); };
    const cleanup = () => signal.removeEventListener("abort", cancel);
    promise.then(value => { cleanup(); resolve(value); }, (error: unknown) => { cleanup(); reject(error instanceof Error ? error : new Error(String(error))); });
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener("abort", cancel, { once: true });
  });
}

async function streamCompletion(url: string, headers: Record<string, string>, payload: object, onDelta: (text: string) => void, signal?: AbortSignal, onTransport?: LLMChatOptions["onTransport"]): Promise<{ status: number; text: string; json: unknown }> {
  let response: Response;
  try {
    // requestUrl buffers the complete response and cannot deliver SSE deltas.
    // Keep fetch only for opt-in streaming; StreamUnavailable falls back to requestUrl.
    response = await window.fetch(url, { method: "POST", headers, body: JSON.stringify({ ...payload, stream: true }), signal });
  }
  catch (error) { if (signal?.aborted) throw error; throw new StreamUnavailable(); }
  if (!response.ok) return { status: response.status, text: await response.text(), json: null };
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    onTransport?.("buffered");
    const json: unknown = await response.json();
    return { status: response.status, text: "", json };
  }
  onTransport?.("streaming");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("模型服务没有返回可读取的数据流");
  const decoder = new TextDecoder(); let buffer = "", content = "", finishReason: string | undefined;
  function consume(line: string): void {
    if (!line.startsWith("data:")) return;
    const value = line.slice(5).trim(); if (!value || value === "[DONE]") return;
    const data = JSON.parse(value) as { error?: unknown; choices?: { delta?: { content?: unknown }; finish_reason?: string }[] };
    if (data.error) throw new Error("模型流式响应失败");
    const choice = data.choices?.[0];
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (typeof choice?.delta?.content === "string") { content += choice.delta.content; onDelta(choice.delta.content); }
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
      for (const line of lines) consume(line.replace(/\r$/, ""));
      if (done) { consume(buffer); break; }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const json = { choices: [{ message: { content }, finish_reason: finishReason }] };
  return { status: 200, text: "", json };
}
