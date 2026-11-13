import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import type { RequestUrlResponse } from "obsidian";
import { DEFAULT_SETTINGS } from "../../types";
import { LLMClient, LLMError, LLMResponseError, abortable } from "./LLMClient";
import { generateWritingText } from "../../ai/WritingGeneration";
import { setSkillProvider } from "../skills/SkillRuntime";
import type { SkillDefinition } from "../skills/types";

vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));
const request = vi.mocked(requestUrl);
const settings = { ...DEFAULT_SETTINGS, apiKey: "test-key" };
const response = (json: unknown, status = 200): RequestUrlResponse => ({
  status, json, text: JSON.stringify(json), headers: {}, arrayBuffer: new ArrayBuffer(0),
});
const success = response({ choices: [{ message: { content: "连接正文" }, finish_reason: "stop" }] });
const exhausted = response({ choices: [{ message: { content: null, reasoning_content: "private reasoning" }, finish_reason: "length" }] });
const requestBody = (index = 0) => {
  const options = request.mock.calls[index][0];
  if (typeof options === "string") throw new Error("Expected a structured chat-completions request");
  if (typeof options.body !== "string") throw new Error("Expected a JSON string request body");
  return JSON.parse(options.body);
};

beforeEach(() => {
  request.mockReset();
  setSkillProvider(null);
});
afterEach(() => vi.unstubAllGlobals());

describe("agent conversations and transport", () => {
  it("normalizes non-Error rejections and preserves Error diagnostics", async () => {
    const signal = new AbortController().signal;
    await expect(abortable(Promise.reject("offline"), signal)).rejects.toThrow("offline");
    const error = new LLMError(429, "rate limited", "retry later");
    await expect(abortable(Promise.reject(error), signal)).rejects.toBe(error);
  });
  it("preserves user/assistant turns and isolates explicitly pinned skills from the active file", async () => {
    request.mockResolvedValue(success);
    const provider = vi.fn(() => []); setSkillProvider(provider);
    await new LLMClient(settings, { skills: [], skillContext: { useActiveFile: false } }).chatMessages([
      { role: "user", content: "original question" }, { role: "assistant", content: "earlier answer" }, { role: "user", content: "follow up" },
    ], { systemPrompt: "agent rules" });
    expect(provider).not.toHaveBeenCalled();
    expect(requestBody().messages).toEqual([{ role: "system", content: "agent rules" }, { role: "user", content: "original question" }, { role: "assistant", content: "earlier answer" }, { role: "user", content: "follow up" }]);
  });
  it("decodes SSE across UTF-8 and line boundaries without exposing reasoning", async () => {
    const data = new TextEncoder().encode('data: {"choices":[{"delta":{"reasoning_content":"hidden"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: {"choices":[{"delta":{"content":"世界"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n');
    const body = new ReadableStream({ start(controller) { for (let i = 0; i < data.length; i += 7) controller.enqueue(data.slice(i, i + 7)); controller.close(); } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "content-type": "text/event-stream" } })));
    const delta = vi.fn();
    expect(await new LLMClient(settings).chatMessages([{ role: "user", content: "hi" }], { onDelta: delta })).toBe("你好世界");
    expect(delta.mock.calls.flat().join("")).toBe("你好世界"); expect(request).not.toHaveBeenCalled();
  });
  it("falls back for CORS before streaming, and discards cancelled requestUrl results", async () => {
    request.mockResolvedValue(success); vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("CORS"); }));
    expect(await new LLMClient(settings).chatMessages([{ role: "user", content: "hi" }], { onDelta: () => {} })).toBe("连接正文");
    expect(request).toHaveBeenCalledOnce();
    request.mockReset().mockReturnValue(Object.assign(new Promise<RequestUrlResponse>(() => {}), { arrayBuffer: Promise.resolve(new ArrayBuffer(0)), json: Promise.resolve(null), text: Promise.resolve("") }));
    const abort = new AbortController();
    const job = new LLMClient(settings, { signal: abort.signal }).chat({ userPrompt: "hi" });
    abort.abort(); await expect(job).rejects.toThrow("停止");
  });
  it("does not issue duplicate requests if the stream fails after receiving output", async () => {
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')); }, pull(c) { c.error(new TypeError("disconnected")); } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "content-type": "text/event-stream" } })));
    await expect(new LLMClient(settings).chatMessages([{ role: "user", content: "hi" }], { onDelta: () => {} })).rejects.toThrow("disconnected");
    expect(request).not.toHaveBeenCalled();
  });
});

describe("writing responses from DeepSeek", () => {
  it("disables thinking on the official endpoint and separates a small prose target from its output budget", async () => {
    request.mockResolvedValue(success);
    expect(await generateWritingText(new LLMClient(settings), { userPrompt: "补一段过渡" }, 200)).toBe("连接正文");
    const body = requestBody();
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.max_tokens).toBeGreaterThan(320);
    expect(body.messages).toEqual([{ role: "user", content: "补一段过渡" }]);
  });

  it("keeps provider-specific thinking fields out of other compatible endpoints", async () => {
    request.mockResolvedValue(success);
    await generateWritingText(new LLMClient({ ...settings, baseUrl: "https://example.com" }), { userPrompt: "续写" }, 300);
    expect(requestBody()).not.toHaveProperty("thinking");
  });

  it("identifies an exhausted reasoning-only response without returning or exposing its reasoning", async () => {
    request.mockResolvedValue(exhausted);
    const error = await new LLMClient(settings).chat({ userPrompt: "插写", maxTokens: 320 }).catch((error) => error);
    expect(error).toBeInstanceOf(LLMResponseError);
    expect(error).toMatchObject({ code: "output_limit", finishReason: "length" });
    expect(error.message).not.toContain("private reasoning");
  });

  it("recovers empty output with one larger-budget attempt", async () => {
    request.mockResolvedValueOnce(exhausted).mockResolvedValueOnce(success);
    expect(await generateWritingText(new LLMClient(settings), { userPrompt: "插写" }, 200)).toBe("连接正文");
    expect(request).toHaveBeenCalledTimes(2);
    const [first, second] = request.mock.calls.map((_call, index) => requestBody(index));
    expect(second.max_tokens).toBe(first.max_tokens * 2);
    expect(second.thinking).toEqual({ type: "disabled" });
    expect(second.messages).toEqual(first.messages);
  });

  it("stops after one recovery attempt and reports the actual empty-output reason", async () => {
    request.mockResolvedValue(exhausted);
    const error = await generateWritingText(new LLMClient(settings), { userPrompt: "插写" }, 200).catch((error) => error);
    expect(request).toHaveBeenCalledTimes(2);
    expect(error).toMatchObject({ code: "output_limit" });
    expect(error.message).toContain("已自动重试一次");
  });

  it.each([
    ["stop", { content: "", reasoning_content: "hidden thought" }, "reasoning_only"],
    ["stop", { content: "   " }, "empty_content"],
    ["content_filter", { content: null }, "content_filter"],
    ["insufficient_system_resource", { content: null }, "interrupted"],
  ])("distinguishes %s with %j", async (reason, message, code) => {
    request.mockResolvedValue(response({ choices: [{ message, finish_reason: reason }] }));
    await expect(new LLMClient(settings).chat({ userPrompt: "写作" })).rejects.toMatchObject({ code });
  });

  it.each([{ choices: [] }, { choices: [{ message: { content: { text: "unexpected" } } }] }])("rejects malformed completions without repeated requests", async (json) => {
    request.mockResolvedValue(response(json));
    await expect(generateWritingText(new LLMClient(settings), { userPrompt: "写作" }, 200)).rejects.toMatchObject({ code: "invalid_response" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not retry content filtering or rate limits", async () => {
    request.mockResolvedValue(response({ choices: [{ message: { content: null }, finish_reason: "content_filter" }] }));
    await expect(generateWritingText(new LLMClient(settings), { userPrompt: "写作" }, 200)).rejects.toMatchObject({ code: "content_filter" });
    expect(request).toHaveBeenCalledTimes(1);
    request.mockClear().mockResolvedValue(response({ error: { message: "Rate limit" } }, 429));
    await expect(generateWritingText(new LLMClient(settings), { userPrompt: "写作" }, 200)).rejects.toBeInstanceOf(LLMError);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("keeps available prose even if the service stops at its output limit", async () => {
    request.mockResolvedValue(response({ choices: [{ message: { content: "可预览的正文" }, finish_reason: "length" }] }));
    expect(await new LLMClient(settings).chat({ userPrompt: "写作" })).toBe("可预览的正文");
  });

  it("injects the active writing skill into the system prompt", async () => {
    request.mockResolvedValue(success);
    const selected: SkillDefinition = {
      id: "writing-craft",
      name: "写作规范",
      description: "Shared writing rules",
      body: "段落要短，避免重复。",
      scope: "global",
      apply: "writing",
      priority: 10,
      path: "Skills/writing-craft/SKILL.md",
      root: "Skills",
    };
    let requestedFeature = "";
    setSkillProvider((input) => {
      requestedFeature = input.feature;
      return [selected];
    });

    await new LLMClient(settings).chat({
      systemPrompt: "基础系统提示",
      userPrompt: "继续写",
      skillFeature: "writing",
    });

    const body = requestBody();
    expect(requestedFeature).toBe("writing");
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("基础系统提示");
    expect(body.messages[0].content).toContain("writing-craft");
    expect(body.messages[0].content).toContain("段落要短");
    expect(body.messages[1]).toEqual({ role: "user", content: "继续写" });
  });
});
