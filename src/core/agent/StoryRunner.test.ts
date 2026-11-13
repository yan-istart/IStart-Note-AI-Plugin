import { describe, expect, it, vi } from "vitest";
import { StoryRunner, parseEvolution } from "./StoryRunner";
import { storyContext } from "./StoryContent";
import { isLiveStory, DEFAULT_AGENT_SETTINGS, newSession } from "./types";
import type { AgentMessage, AgentRunContext, LiveStoryScene, NoteSnapshot } from "./types";
import type { LLMChatOptions, LLMMessage } from "../llm";

const cast: NoteSnapshot[] = [
  { path: "作品/_角色/林川.md", content: "---\nname: 林川\n---\n谨慎。秘密：藏着一枚蓝色徽章。" },
  { path: "作品/_角色/阿宁.md", content: "---\nname: 阿宁\n---\n秘密：其实是北城的信使。" },
];
const line = (text: string, kind = "dialogue", visibility = "public") => JSON.stringify({ kind, visibility, text });
const target = (path: string) => JSON.stringify({ target: path });
function setup(signal = new AbortController().signal) {
  const session = newSession(); session.mode = "story"; session.messages.push({ id: "u", role: "user", createdAt: 1, content: "围绕钥匙发生冲突" });
  const primary = { path: "作品/01.md", content: "雨夜，两人重逢。" };
  const context: AgentRunContext = { sessionId: session.id, mode: "story", primary, notes: new Map([[primary.path, primary]]), scope: { projectPath: "作品", projectTitle: "重逢", genre: "novel" }, searchVault: false, signal, sources: new Set() };
  return { session, context, config: { characterPaths: [], rounds: 1, maxTurns: 2 } };
}
const save = async () => {};
const live = (message: AgentMessage): LiveStoryScene => { if (!isLiveStory(message.story)) throw new Error("expected live scene"); return message.story; };

describe("live story performance", () => {
  it("streams dialogue and narrative blocks in order, with independent actors and no retrospective rewrite", async () => {
    const f = setup(); const speech = '“我没有答应。\n\n你听清楚，是没有答应——不是忘了。”';
    const raw = line("他握紧钥匙。", "narration") + '\n' + line(speech);
    let visibleBeforeReturn = false;
    const chat = vi.fn<(history: LLMMessage[], options?: Omit<LLMChatOptions, "userPrompt">) => Promise<string>>()
      .mockImplementationOnce(async (_history, options) => {
        for (let i = 0; i < raw.length; i += 3) options?.onDelta?.(raw.slice(i, i + 3));
        visibleBeforeReturn = live(f.session.messages[1]).blocks[1].text === speech;
        return raw;
      }).mockResolvedValueOnce(target(cast[1].path)).mockResolvedValueOnce(line("“那你为什么还留着钥匙？”"));
    const result = await new StoryRunner({ chatMessages: chat }).run(f.session, f.context, DEFAULT_AGENT_SETTINGS, cast, f.config, () => {}, save);
    expect(visibleBeforeReturn).toBe(true); expect(result.status).toBe("idle"); expect(live(result).state).toBe("paused");
    expect(result.content).toBe(`他握紧钥匙。\n\n${speech}\n\n“那你为什么还留着钥匙？”`);
    expect(live(result).blocks.map(b => b.kind)).toEqual(["narration", "dialogue", "dialogue"]);
    expect(chat.mock.calls[0][0][0].content).not.toContain("北城的信使");
    expect(chat.mock.calls[2][0][0].content).toContain(speech); expect(chat.mock.calls[2][0][0].content).not.toContain("蓝色徽章");
    expect(result.proposals).toEqual([]);
  });
  it("isolates private psychology from other actors, the scene generator and the director, including confirmed history", async () => {
    const f = setup();
    const chat = vi.fn().mockResolvedValueOnce(line("暗号是七只蓝鸟", "narration", "private") + '\n' + line("“请进。”")).mockResolvedValueOnce(target(cast[1].path)).mockResolvedValueOnce(line("“谢谢。”"));
    const first = await new StoryRunner({ chatMessages: chat }).run(f.session, f.context, DEFAULT_AGENT_SETTINGS, cast, f.config, () => {}, save);
    expect(chat.mock.calls[1][0][0].content).not.toContain("七只蓝鸟"); expect(chat.mock.calls[2][0][0].content).not.toContain("七只蓝鸟");
    const scene = live(first); expect(storyContext(f.session, scene, cast[0].path)).toContain("七只蓝鸟");
    scene.confirmedAt = 2; scene.confirmedBlocks = structuredClone(scene.blocks); scene.state = "confirmed";
    f.session.messages.push({ id: "u2", role: "user", content: "继续", createdAt: 3 });
    chat.mockReset().mockResolvedValueOnce(line("“继续说。”")).mockResolvedValueOnce(target(cast[1].path)).mockResolvedValueOnce(line("“好。”"));
    await new StoryRunner({ chatMessages: chat }).run(f.session, f.context, DEFAULT_AGENT_SETTINGS, cast, f.config, () => {}, save);
    expect(chat.mock.calls[0][0][0].content).toContain("七只蓝鸟"); expect(chat.mock.calls[2][0][0].content).not.toContain("七只蓝鸟");
    chat.mockReset().mockResolvedValue('{"updates":[]}');
    await new StoryRunner({ chatMessages: chat }).evolve(first, cast, f.context, () => {});
    expect(chat.mock.calls[0][0][0].content).toContain("七只蓝鸟");
    expect(chat.mock.calls[1][0][0].content).not.toContain("七只蓝鸟");
    expect(chat.mock.calls[1][0][0].content).not.toContain("蓝色徽章");
  });
  it("pauses after a complete response and resumes the same scene without duplicating completed dialogue", async () => {
    const f = setup();
    const chat = vi.fn().mockImplementationOnce(async () => { live(f.session.messages[1]).runtime.pauseRequested = true; return line("“第一句原话。”"); });
    const runner = new StoryRunner({ chatMessages: chat });
    const result = await runner.run(f.session, f.context, DEFAULT_AGENT_SETTINGS, cast, f.config, () => {}, save);
    expect(chat).toHaveBeenCalledOnce(); const originalId = live(result).blocks[0].id;
    chat.mockResolvedValueOnce(target(cast[1].path)).mockResolvedValueOnce(line("“第二句回应。”"));
    await runner.run(f.session, f.context, DEFAULT_AGENT_SETTINGS, cast, f.config, () => {}, save, { resume: result, singleStep: true });
    expect(f.session.messages).toHaveLength(2); expect(live(result).blocks[0].id).toBe(originalId);
    expect(result.content).toBe("“第一句原话。”\n\n“第二句回应。”");
  });
  it("allows consecutive responses by the same role and public scene events without forcing a round robin", async () => {
    const f = setup(); f.config.maxTurns = 3;
    const chat = vi.fn().mockResolvedValueOnce(line("“等等。”")).mockResolvedValueOnce(target(cast[0].path)).mockResolvedValueOnce(line("“我还有一句。”")).mockResolvedValueOnce(target("scene")).mockResolvedValueOnce(line("门外传来脚步声。", "narration"));
    const result = await new StoryRunner({ chatMessages: chat }).run(f.session, f.context, DEFAULT_AGENT_SETTINGS, cast, f.config, () => {}, save);
    expect(live(result).blocks.map(b => b.characterPath)).toEqual([cast[0].path, cast[0].path, undefined]);
    expect(result.content).toContain("脚步声");
  });
  it("lets the director select the opening role from the author's scene request", async () => {
    const f = setup();
    const chat = vi.fn().mockResolvedValueOnce(target(cast[1].path)).mockResolvedValueOnce(line("“这次由我先说。”"));
    const result = await new StoryRunner({ chatMessages: chat }).run(f.session, f.context, DEFAULT_AGENT_SETTINGS, cast, { ...f.config, characterPaths: cast.map(c => c.path), maxTurns: 1, openingTarget: "auto" }, () => {}, save);
    expect(live(result).blocks[0].characterPath).toBe(cast[1].path); expect(chat.mock.calls[0][1].systemPrompt).toContain("演绎调度");
  });
  it("rejects scene impersonation and preserves the protocol response for diagnosis", async () => {
    const f = setup(); const chat = vi.fn().mockResolvedValueOnce(line("“等等。”")).mockResolvedValueOnce(target("scene")).mockResolvedValueOnce(line("“他替我答应了。”"));
    const result = await new StoryRunner({ chatMessages: chat }).run(f.session, f.context, DEFAULT_AGENT_SETTINGS, cast, f.config, () => {}, save);
    expect(result.error).toContain("不得代写"); expect(live(result).blocks).toHaveLength(1); expect(live(result).runtime.failures?.[0].raw).toContain("替我答应");
  });
  it("keeps streamed fragments after cancellation and ignores late tokens", async () => {
    const abort = new AbortController(), f = setup(abort.signal); let finish!: (value: string) => void;
    let delta: LLMChatOptions["onDelta"];
    const chat = vi.fn().mockImplementation((_history: LLMMessage[], options?: Omit<LLMChatOptions, "userPrompt">) => {
      delta = options?.onDelta; delta?.('{"kind":"dialogue","visibility":"public","text":"没有说完');
      return new Promise<string>(resolve => { finish = resolve; });
    });
    const job = new StoryRunner({ chatMessages: chat }).run(f.session, f.context, DEFAULT_AGENT_SETTINGS, cast, f.config, () => {}, save);
    await vi.waitFor(() => expect(chat).toHaveBeenCalledOnce()); abort.abort(); const result = await job; delta?.('的迟到内容"}'); finish(line("迟到的完整内容"));
    expect(result.content).toBe("没有说完"); expect(live(result).blocks[0].status).toBe("interrupted"); expect(chat).toHaveBeenCalledOnce();
    await expect(new StoryRunner({ chatMessages: chat }).run(f.session, setup().context, DEFAULT_AGENT_SETTINGS, cast, f.config, () => {}, save, { resume: result })).rejects.toThrow("未完成片段");
  });
  it("retains repeated long speeches and stops on context budget rather than summarizing", async () => {
    const f = setup(); const speech = '“每一句话都必须保留。”'.repeat(800);
    const chat = vi.fn().mockResolvedValueOnce(line(speech));
    const result = await new StoryRunner({ chatMessages: chat }, 8000).run(f.session, f.context, { ...DEFAULT_AGENT_SETTINGS, contextChars: 8000 }, cast, f.config, () => {}, save);
    expect(chat).toHaveBeenCalledOnce(); expect(result.error).toContain("预算"); expect(result.content).toBe(speech);
  });
  it("uses only confirmed v2 revisions and ignores drafts, legacy prose and summaries for shared scene knowledge", async () => {
    const f = setup(); f.session.summary = { content: "未确认背叛", through: "old" };
    f.session.messages.unshift({ id: "old", role: "assistant", content: "旧版秘密谋杀", createdAt: 0, story: { projectPath: "作品", chapterPath: "作品/01.md", cast, turns: [], confirmedAt: 1 } });
    const chat = vi.fn().mockResolvedValueOnce(line("“你好。”")).mockResolvedValueOnce(target("end"));
    const result = await new StoryRunner({ chatMessages: chat }).run(f.session, f.context, DEFAULT_AGENT_SETTINGS, cast, f.config, () => {}, save);
    expect(result.status).toBe("completed"); expect(live(result).state).toBe("review");
    expect(chat.mock.calls[0][0][0].content).not.toContain("秘密谋杀"); expect(chat.mock.calls[0][0][0].content).not.toContain("未确认背叛");
  });
  it("requires confirmation before evolving and validates original evidence and cast paths", async () => {
    const f = setup(); const chat = vi.fn().mockResolvedValueOnce(line("“把钥匙交给阿宁。”")).mockResolvedValueOnce(target("end"));
    const runner = new StoryRunner({ chatMessages: chat }), result = await runner.run(f.session, f.context, DEFAULT_AGENT_SETTINGS, cast, f.config, () => {}, save);
    await expect(runner.evolve(result, cast, f.context, () => {})).rejects.toThrow("先确认");
    live(result).confirmedAt = 1; live(result).state = "confirmed"; live(result).confirmedBlocks = structuredClone(live(result).blocks);
    chat.mockResolvedValueOnce(JSON.stringify({ updates: [{ path: cast[0].path, insight: "愿意让同伴参与，仍保留谨慎。", evidence: ["把钥匙交给阿宁"] }] })).mockResolvedValueOnce('{"updates":[]}');
    await runner.evolve(result, cast, f.context, () => {}); expect(result.proposals![0].changes[0].after).toContain(cast[0].content); expect(result.proposals![0].status).toBe("pending");
    expect(() => parseEvolution(JSON.stringify({ updates: [{ path: cast[1].path, insight: "任意改变", evidence: ["不存在的事件"] }] }), cast, result.content)).toThrow();
  });
});
