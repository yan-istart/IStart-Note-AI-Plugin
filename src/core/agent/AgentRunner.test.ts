import { describe, it, expect, vi } from "vitest";
import { AgentRunner, partialAnswer } from "./AgentRunner";
import { ToolRegistry } from "./ToolRegistry";
import { newSession } from "./types";
import type { AgentRunContext } from "./types";

const context = (signal = new AbortController().signal): AgentRunContext => ({ sessionId: "s", mode: "agent", notes: new Map(), scope: null, searchVault: true, signal, sources: new Set() });
describe("agent execution", () => {
  it("resumes from durable observations without repeating completed tools or creating another reply", async () => {
    const registry = new ToolRegistry(); const execute = vi.fn(async () => ({ content: "retrieved evidence" }));
    registry.add({ name: "read", label: "Read", description: "read", fields: {}, execute });
    const call = vi.fn().mockResolvedValueOnce('{"type":"tool","name":"read","args":{}}').mockRejectedValueOnce(new Error("offline"));
    const s = newSession(); s.messages.push({ id: "user", role: "user", content: "research", createdAt: 1 });
    const saved: string[] = [];
    const options = { maxSteps: 4, contextChars: 10000, streaming: false, syncHistory: false };
    const failed = await new AgentRunner({ chatMessages: call }, registry).run(s, context(), options, () => {}, { save: async () => { saved.push(JSON.stringify(s)); } });
    expect(failed.status).toBe("error"); expect(saved.some(data => data.includes("retrieved evidence"))).toBe(true);
    const recovered = JSON.parse(JSON.stringify(s)) as typeof s; const message = recovered.messages[1];
    const next = vi.fn(async (_history: unknown[]) => '{"type":"answer","content":"done"}');
    const result = await new AgentRunner({ chatMessages: next }, registry).run(recovered, context(), options, () => {}, { resume: message });
    expect(result.id).toBe(failed.id); expect(recovered.messages).toHaveLength(2); expect(execute).toHaveBeenCalledOnce();
    expect(JSON.stringify(next.mock.calls[0][0])).toContain("retrieved evidence"); expect(result.checkpoint).toBeUndefined(); expect(result.status).toBe("completed");
  });
  it("retries only an unfinished tool on resume and persists intent before executing it", async () => {
    const registry = new ToolRegistry(); const abort = new AbortController(); const execute = vi.fn(async () => { abort.abort(); return { content: "late" }; });
    registry.add({ name: "draft", label: "draft", description: "draft", fields: {}, execute });
    const call = vi.fn(async () => '{"type":"tool","name":"draft","args":{}}');
    const s = newSession(); const opts = { maxSteps: 2, contextChars: 10000, streaming: false, syncHistory: false };
    const cancelled = await new AgentRunner({ chatMessages: call }, registry).run(s, context(abort.signal), opts, () => {});
    expect(cancelled.checkpoint?.pendingTool?.name).toBe("draft");
    execute.mockImplementation(async () => ({ content: "finished" }));
    const finish = vi.fn(async () => '{"type":"answer","content":"ok"}');
    const result = await new AgentRunner({ chatMessages: finish }, registry).run(s, context(), opts, () => {}, { resume: cancelled });
    expect(execute).toHaveBeenCalledTimes(2); expect(result.steps).toHaveLength(1); expect(result.steps?.[0].status).toBe("completed");
    const noWrite = vi.fn(); const fresh = newSession();
    registry.add({ name: "blocked", label: "blocked", description: "blocked", fields: {}, execute: noWrite });
    const failure = await new AgentRunner({ chatMessages: vi.fn(async () => '{"type":"tool","name":"blocked","args":{}}') }, registry).run(fresh, context(), opts, () => {}, { save: async () => { throw new Error("disk full"); } });
    expect(failure.error).toContain("disk full"); expect(noWrite).not.toHaveBeenCalled();
  });
  it("decodes streamed answers without displaying JSON or tool arguments", () => {
    expect(partialAnswer('{"type":"tool","name":"note.create","args":{"content":"draft')).toBeNull();
    expect(partialAnswer('{"type":"answer","content":"第一行\\n第二行\\u4e')).toBe("第一行\n第二行");
    expect(partialAnswer('{"type":"answer","content":"quoted \\"ok\\"')).toBe('quoted "ok"');
  });
  it("executes real tools and feeds observations into subsequent model messages", async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({ content: "source evidence" }));
    registry.add({ name: "note.read", label: "Read", description: "read note", fields: { path: { type: "string", required: true } }, execute });
    const call = vi.fn().mockResolvedValueOnce('{"type":"tool","name":"note.read","args":{"path":"note.md"}}').mockResolvedValueOnce('{"type":"answer","content":"Based on evidence"}');
    const s = newSession(); s.messages.push({ id: "u", role: "user", content: "question", createdAt: 1 });
    const result = await new AgentRunner({ chatMessages: call }, registry).run(s, context(), { maxSteps: 4, contextChars: 10000, streaming: false, syncHistory: false }, () => {});
    expect(execute).toHaveBeenCalledOnce(); expect(result.content).toBe("Based on evidence");
    expect(result.steps?.[0].status).toBe("completed");
    expect(JSON.stringify(call.mock.calls[1][0])).toContain("source evidence");
  });
  it("stops a cancelled run before executing any returned tool", async () => {
    const abort = new AbortController(); const registry = new ToolRegistry(); const execute = vi.fn();
    registry.add({ name: "write", label: "write", description: "draft", draft: true, fields: {}, execute });
    const call = vi.fn(async () => { abort.abort(); return '{"type":"tool","name":"write","args":{}}'; });
    const s = newSession();
    const result = await new AgentRunner({ chatMessages: call }, registry).run(s, context(abort.signal), { maxSteps: 3, contextChars: 10000, streaming: false, syncHistory: false }, () => {});
    expect(result.status).toBe("cancelled"); expect(execute).not.toHaveBeenCalled();
  });
  it("rejects unauthorized tools in ask mode and ends at the execution budget", async () => {
    const registry = new ToolRegistry(); const execute = vi.fn();
    registry.add({ name: "write", label: "write", description: "draft", draft: true, fields: {}, execute });
    const call = vi.fn(async () => '{"type":"tool","name":"write","args":{}}');
    const c = context(); c.mode = "ask";
    const result = await new AgentRunner({ chatMessages: call }, registry).run(newSession(), c, { maxSteps: 2, contextChars: 10000, streaming: false, syncHistory: false }, () => {});
    expect(result.status).toBe("error"); expect(execute).not.toHaveBeenCalled(); expect(call.mock.calls.length).toBeLessThanOrEqual(3);
  });
  it("does not repeat prior tools on retry, and includes prior applied/rejected changes", async () => {
    const registry = new ToolRegistry(); const call = vi.fn(async (_history: unknown[]) => '{"type":"answer","content":"follow up"}');
    const s = newSession(); s.messages.push({ id: "old", role: "assistant", content: "draft", status: "completed", createdAt: 1, proposals: [{ id: "p", title: "edit", status: "applied", changes: [{ path: "a.md", before: "a", after: "b" }] }] });
    await new AgentRunner({ chatMessages: call }, registry).run(s, context(), { maxSteps: 2, contextChars: 10000, streaming: false, syncHistory: false }, () => {});
    expect(JSON.stringify(call.mock.calls[0][0])).toContain("applied");
  });
});
