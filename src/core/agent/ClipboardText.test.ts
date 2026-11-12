import { describe, expect, it } from "vitest";
import { messageText, conversationText } from "./ClipboardText";
import { newSession, AgentMessage } from "./types";

describe("copyable Agent contents", () => {
  it("retains plain Markdown, multiline code, references and selections", () => {
    const content = '说明\n\n```ts\nconst x = "value";\n```';
    const message: AgentMessage = { id: "m", role: "user", createdAt: 1, content, references: [{ path: "a.md", content: "原文", selection: { start: 0, end: 2, text: "原文", content: "原文" }, annotation: "思考" }] };
    const result = messageText(message);
    expect(result).toContain(content); expect(result).toContain("a.md"); expect(result).toContain("原文"); expect(result).toContain("思考");
  });
  it("includes errors, tool details, sources, story turns and both sides of a file change", () => {
    const result = messageText({ id: "m", role: "assistant", createdAt: 1, content: "回答", error: "错误信息", sources: ["a.md"], steps: [{ id: "s", tool: "t", label: "工具", status: "completed", detail: "执行详情" }], story: { projectPath: "p", chapterPath: "a.md", cast: [], turns: [{ name: "角色", round: 1, content: "角色发言" }], evolution: { status: "error", content: "推演", error: "推演失败" } }, proposals: [{ id: "p", title: "修改", status: "pending", changes: [{ path: "a.md", before: "原文", after: "修改后全文" }] }] });
    for (const text of ["回答", "错误信息", "a.md", "执行详情", "角色发言", "推演失败", "原文", "修改后全文"]) expect(result).toContain(text);
  });
  it("copies the whole conversation with its summary and both speakers", () => {
    const session = newSession(); session.title = "会话"; session.summary = { content: "较早内容", through: "u" };
    session.messages.push({ id: "u", role: "user", content: "问题", createdAt: 1 }, { id: "a", role: "assistant", content: "回答", createdAt: 2 });
    const copied = conversationText(session);
    for (const text of ["# 会话", "较早内容", "## 我", "问题", "## IStart", "回答"]) expect(copied).toContain(text);
  });
});
