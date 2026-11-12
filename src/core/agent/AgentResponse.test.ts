import { describe, expect, it } from "vitest";
import { parseDecision, partialAnswer } from "./AgentResponse";

describe("Agent response envelopes", () => {
  it("recovers DeepSeek answer strings with literal newlines, tabs and carriage returns", () => {
    const content = "第一段。\n\n第二段。\r\n- 列表\t内容";
    expect(parseDecision(`{"type":"answer","content":"${content}"}`)).toEqual({ type: "answer", content });
  });
  it("parses an answer containing fenced code before examining Markdown fences", () => {
    const content = '示例：\n```ts\nconst value = { name: "demo" };\n```\n完成。';
    expect(parseDecision(JSON.stringify({ type: "answer", content }))).toEqual({ type: "answer", content });
    expect(parseDecision('```json\n' + JSON.stringify({ type: "answer", content }) + '\n```')).toEqual({ type: "answer", content });
  });
  it("preserves escaped quotes, newlines, backslashes and Unicode escape values", () => {
    const content = '原文 "quoted"，路径 a\\b；字面量 \\n，表情 😊。\n换行。';
    expect(parseDecision(JSON.stringify({ type: "answer", content }))).toEqual({ type: "answer", content });
    expect(parseDecision('{"type":"answer","content":"\\u4f60\\u597d"}')).toEqual({ type: "answer", content: "你好" });
  });
  it("recovers one complete tool request followed by redundant closing braces", () => {
    const args = { path: "note.md", content: '包含 } 和 { 以及 "引号"\n的正文', mode: "append" };
    const request = JSON.stringify({ type: "tool", name: "note.propose", args });
    expect(parseDecision(request + "}\n}")).toEqual({ type: "tool", name: "note.propose", args });
    expect(parseDecision('```json\n' + request + '}\n```')).toEqual({ type: "tool", name: "note.propose", args });
  });
  it("recovers control characters inside tool arguments without changing their contents", () => {
    expect(parseDecision('{"type":"tool","name":"note.propose","args":{"content":"第一行\n第二行","mode":"append"}}}'))
      .toEqual({ type: "tool", name: "note.propose", args: { content: "第一行\n第二行", mode: "append" } });
  });
  it.each([
    "普通 Markdown 回答。\n\n- 项目",
    '```ts\nconst value = { count: 1 };\n```',
    '```\nfunction example() {}\n```',
    '这是示例，不能执行：{"type":"tool","name":"note.create","args":{}}',
  ])("accepts standalone Markdown without extracting tool-like examples: %s", content => {
    expect(parseDecision(content)).toEqual({ type: "answer", content });
  });
  it.each([
    '{"type":"tool","name":"note.propose","args":{"path":"note.md"}',
    '{"type":"tool","name":"note.propose","args":{}}{"type":"answer","content":"extra"}',
    '{"type":"tool","name":"note.propose","args":{}} trailing text',
    '{"type":"tool","name":"note.propose","args":"not an object"}',
    '{"type":"tool","name":"note.propose","args":null}',
    '{"type":"tool","name":"note.propose","args":[]}',
    '{"type":"answer","content":"unclosed string}',
    '```json\n{"type":"answer","content":"unclosed\n```',
  ])("does not guess truncated or ambiguous protocol: %s", raw => {
    expect(() => parseDecision(raw)).toThrow("有效的回答或工具请求");
  });
  it("streams literal newlines and fenced answers without displaying nested tool arguments", () => {
    expect(partialAnswer('{"type":"answer","content":"第一行\n第二行')).toBe("第一行\n第二行");
    expect(partialAnswer('```json\n{"type":"answer","content":"你好')).toBe("你好");
    expect(partialAnswer('{"type":"tool","name":"note.create","args":{"type":"answer","content":"private draft')).toBeNull();
  });
});
