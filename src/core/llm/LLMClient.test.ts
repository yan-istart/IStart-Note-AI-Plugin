import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import type { RequestUrlResponse } from "obsidian";
import { DEFAULT_SETTINGS } from "../../types";
import { LLMClient, LLMError, LLMResponseError } from "./LLMClient";
import { generateWritingText } from "../../ai/WritingGeneration";

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

beforeEach(() => request.mockReset());

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
});
