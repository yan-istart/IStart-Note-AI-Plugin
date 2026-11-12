import { describe, expect, it, vi } from "vitest";
import { ImportAgentBridge } from "./ImportAgentBridge";
import { DEFAULT_SETTINGS } from "../../../types";
import type { AgentController } from "../../agent/AgentController";
import type { AgentTask } from "../../../core/agent/types";

function fixture() {
  const executeTask = vi.fn(async (task: AgentTask, _sessionId?: string, signal?: AbortSignal) => {
    if (signal?.aborted) throw new Error("cancelled");
    const content = task.actionId === "import-classify" ? JSON.stringify({ classifications: JSON.parse(String(task.args.units)).map((u: { index: number }) => ({ index: u.index, kind: "chapter" })) }) : '{"oneLiner":"简介","styleProfile":"文风","characters":[],"worldSettings":[]}';
    return { sessionId: "import-session", message: { content } };
  });
  return { executeTask, bridge: new ImportAgentBridge({ executeTask } as unknown as AgentController, DEFAULT_SETTINGS) };
}
describe("import wizard Agent bridge", () => {
  it("batches classification into one session and caps individual samples", async () => {
    const f = fixture(), abort = new AbortController();
    const result = await f.bridge.classify(Array.from({ length: 105 }, (_, index) => ({ index, title: "x", head: "y".repeat(1000) })), abort.signal);
    expect(result.size).toBe(105); expect(f.executeTask).toHaveBeenCalledTimes(3);
    expect(f.executeTask.mock.calls[0][1]).toBeUndefined();
    expect(f.executeTask.mock.calls[1][1]).toBe("import-session");
    expect(JSON.parse(String(f.executeTask.mock.calls[0][0].args.units))).toHaveLength(50);
    expect(JSON.parse(String(f.executeTask.mock.calls[0][0].args.units))[0].head).toHaveLength(200);
  });
  it("keeps escaped classification data below the tool limit", async () => {
    const f = fixture();
    await f.bridge.classify(Array.from({ length: 50 }, (_, index) => ({ index, title: "\u0001".repeat(500), head: "\u0002".repeat(500) })), new AbortController().signal);
    expect(String(f.executeTask.mock.calls[0][0].args.units).length).toBeLessThan(50000);
  });
  it("sends only capped chapter samples for analysis, excluding reference materials", async () => {
    const f = fixture();
    await f.bridge.analyze("作品", "novel", [{ number: 1, title: "正文", content: "x".repeat(10000), kind: "chapter" }, { number: 2, title: "资料", content: "不得作为正文采样", kind: "reference" }], new AbortController().signal);
    const task = f.executeTask.mock.calls[0][0];
    const samples = JSON.parse(String(task.args.chapters));
    expect(samples).toHaveLength(1); expect(samples[0].content).toHaveLength(2000);
    expect(String(task.args.chapters)).not.toContain("不得作为正文采样");
  });
  it("does not submit subsequent batches after cancellation", async () => {
    const f = fixture(), abort = new AbortController();
    f.executeTask.mockImplementationOnce(async () => { abort.abort(); return { sessionId: "import-session", message: { content: '{"classifications":[]}' } }; });
    await expect(f.bridge.classify(Array.from({ length: 100 }, (_, index) => ({ index, title: "x", head: "y" })), abort.signal)).rejects.toThrow();
    expect(f.executeTask).toHaveBeenCalledOnce();
  });
});
