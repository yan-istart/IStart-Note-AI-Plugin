import { describe, expect, it, vi } from "vitest";
import { StoryRunner, composeStoryRound, parseEvolution } from "./StoryRunner";
import { AgentMessage, AgentRunContext, DEFAULT_AGENT_SETTINGS, newSession, NoteSnapshot } from "./types";

const cast: NoteSnapshot[] = [
  { path: "作品/_角色/林川.md", content: "---\nname: 林川\n---\n谨慎寡言。秘密：藏着一枚蓝色徽章。" },
  { path: "作品/_角色/阿宁.md", content: "---\nname: 阿宁\n---\n活泼。秘密：其实是北城的信使。" },
];
const scene = "林川把钥匙交给了阿宁，终于愿意让她同行。";
function context(signal = new AbortController().signal): AgentRunContext {
  const primary = { path: "作品/01-重逢.md", content: "雨夜，两人在门口重逢。" };
  return { sessionId: "s", mode: "story", primary, notes: new Map([[primary.path, primary]]), scope: { projectPath: "作品", projectTitle: "重逢", genre: "novel" }, searchVault: false, signal, sources: new Set([primary.path]) };
}
function confirmed(): AgentMessage {
  return { id: "scene", role: "assistant", createdAt: 1, content: scene, status: "completed", steps: [], proposals: [], story: { projectPath: "作品", chapterPath: "作品/01-重逢.md", cast, turns: [{ name: "林川", path: cast[0].path, round: 1, content: "未确认的演员原稿" }], confirmedAt: 2 } };
}

describe("novel performance and character evolution", () => {
  it("runs independent actors in order, sharing only the public performance with the narrator", async () => {
    const session = newSession(); session.messages.push({ id: "u", role: "user", createdAt: 1, content: "围绕钥匙发生冲突" });
    const client = { chatMessages: vi.fn().mockResolvedValueOnce("林川握紧钥匙，问她为何而来。").mockResolvedValueOnce("阿宁伸出手，保证会回来。").mockResolvedValueOnce(JSON.stringify({ passages: ["雨声敲着门檐。", "", scene] })) };
    const save = vi.fn(async () => {});
    const result = await new StoryRunner(client).run(session, context(), DEFAULT_AGENT_SETTINGS, cast, { characterPaths: [], rounds: 1 }, () => {}, save);
    expect(client.chatMessages).toHaveBeenCalledTimes(3);
    const first = client.chatMessages.mock.calls[0][0][0].content;
    const second = client.chatMessages.mock.calls[1][0][0].content;
    expect(first).toContain("蓝色徽章"); expect(first).not.toContain("北城的信使");
    expect(second).toContain("北城的信使"); expect(second).not.toContain("蓝色徽章"); expect(second).toContain("问她为何而来");
    expect(result.content).toBe(["雨声敲着门檐。", "林川握紧钥匙，问她为何而来。", "阿宁伸出手，保证会回来。", scene].join("\n\n")); expect(result.story!.turns.map(t => t.name)).toEqual(["林川", "阿宁", "旁白"]);
    expect(result.status).toBe("completed"); expect(result.proposals).toEqual([]); expect(result.story!.confirmedAt).toBeUndefined();
    expect(save).toHaveBeenCalledTimes(4);
  });
  it("feeds confirmed scenes into later rounds and excludes unconfirmed scenes and generic summaries", async () => {
    const session = newSession(); session.messages.push(confirmed(), { ...confirmed(), id: "draft", content: "草稿里的秘密谋杀", story: { ...confirmed().story!, confirmedAt: undefined } }, { id: "u", role: "user", content: "继续相遇", createdAt: 4 });
    session.summary = { content: "摘要中的未确认背叛", through: "draft" };
    const client = { chatMessages: vi.fn().mockImplementation(async (_messages, options) => options.systemPrompt.includes("你是旁白 Agent") ? JSON.stringify({ passages: ["", "", ""] }) : "新的动作与台词。") };
    await new StoryRunner(client).run(session, context(), DEFAULT_AGENT_SETTINGS, cast, { characterPaths: [], rounds: 2 }, () => {}, async () => {});
    expect(client.chatMessages).toHaveBeenCalledTimes(6);
    for (const call of client.chatMessages.mock.calls) {
      expect(call[0][0].content).toContain(scene);
      expect(call[0][0].content).not.toContain("秘密谋杀"); expect(call[0][0].content).not.toContain("未确认背叛");
    }
    expect(client.chatMessages.mock.calls[3][0][0].content).toContain("第1轮 · 旁白");
  });
  it("does not generate evolution before confirmation and uses the approved text instead of actor drafts", async () => {
    const client = { chatMessages: vi.fn().mockResolvedValue(JSON.stringify({ updates: [{ path: cast[0].path, insight: "开始试着信任阿宁，仍保持谨慎。", evidence: ["把钥匙交给了阿宁"] }] })) };
    const result = confirmed(); delete result.story!.confirmedAt;
    await expect(new StoryRunner(client).evolve(result, cast, context(), () => {})).rejects.toThrow("先确认");
    expect(client.chatMessages).not.toHaveBeenCalled(); result.story!.confirmedAt = 1;
    await new StoryRunner(client).evolve(result, cast, context(), () => {});
    expect(client.chatMessages.mock.calls[0][0][0].content).not.toContain("未确认的演员原稿");
    expect(result.proposals![0].changes[0].before).toBe(cast[0].content);
    expect(result.proposals![0].changes[0].after).toContain(cast[0].content);
    expect(result.proposals![0].changes[0].after).toContain("开始试着信任阿宁"); expect(result.proposals![0].status).toBe("pending");
  });
  it("allows a scene with no lasting personality change", async () => {
    const result = confirmed();
    await new StoryRunner({ chatMessages: vi.fn().mockResolvedValue('{"updates":[]}') }).evolve(result, cast, context(), () => {});
    expect(result.proposals).toEqual([]); expect(result.story!.evolution?.content).toContain("保留现有角色设定");
  });
  it("keeps every actor passage verbatim and in order when narration is added", async () => {
    const first = '林川低声说：“我没有答应。\n\n你听清楚，是没有答应——不是忘了。”\n\n' + '“这句话我还要再说一次，不能省略。”\n'.repeat(80);
    const second = '阿宁摇头。“我听清了。你没有答应。”\n\n“那你为什么还留着钥匙？”';
    const session = newSession(); session.messages.push({ id: "u", role: "user", content: "完整演绎这场争执", createdAt: 1 });
    const client = { chatMessages: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockResolvedValueOnce(JSON.stringify({ passages: ["雨声渐密。", "门外传来脚步声。", "两人都没有离开。"] })) };
    const result = await new StoryRunner(client).run(session, context(), DEFAULT_AGENT_SETTINGS, cast, { characterPaths: [], rounds: 1 }, () => {}, async () => {});
    expect(result.status).toBe("completed");
    expect(result.content).toBe(["雨声渐密。", first.trim(), "门外传来脚步声。", second, "两人都没有离开。"].join("\n\n"));
    expect(client.chatMessages.mock.calls[1][0][0].content).toContain(first.trim());
    expect(result.content.match(/这句话我还要再说一次，不能省略。/g)).toHaveLength(80);
    expect(result.story!.turns[2].content).toBe(result.content);
  });
  it("retains the full actor transcript when the narrator returns a summary instead of valid connecting passages", async () => {
    const session = newSession(); session.messages.push({ id: "u", role: "user", content: "完整演绎对话", createdAt: 1 });
    const first = '林川说：“今天、明天，还是下一次见面？请你说清楚。”';
    const second = '阿宁说：“明天。不是下一次，是明天。”';
    const client = { chatMessages: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockResolvedValueOnce("两人商定了下次见面的时间。") };
    const result = await new StoryRunner(client).run(session, context(), DEFAULT_AGENT_SETTINGS, cast, { characterPaths: [], rounds: 1 }, () => {}, async () => {});
    expect(result.status).toBe("completed"); expect(result.error).toContain("角色原稿已完整保留");
    expect(result.steps![result.steps!.length - 1].status).toBe("error");
    expect(result.content).toBe(`${first}\n\n${second}`); expect(result.content).not.toContain("两人商定");
    expect(result.story!.turns).toHaveLength(2);
    expect(() => composeStoryRound('{"passages":["省略其他角色"]}', result.story!.turns)).toThrow("旁白衔接格式无效");
  });
  it("rejects fabricated evidence, duplicate roles, and paths outside the cast before staging any changes", () => {
    const update = { path: cast[0].path, insight: "更加信任同伴", evidence: ["把钥匙交给了阿宁"] };
    expect(parseEvolution(JSON.stringify({ updates: [update] }), cast, scene)).toHaveLength(1);
    for (const updates of [[{ ...update, evidence: ["他决定永远背叛"] }], [{ ...update, path: "其他作品/角色.md" }], [update, update], [{ ...update, evidence: [] }]]) expect(() => parseEvolution(JSON.stringify({ updates }), cast, scene)).toThrow();
  });
  it("stops cancelled generations without accepting late actor output or invoking another actor", async () => {
    const abort = new AbortController(); let finish!: (value: string) => void;
    const client = { chatMessages: vi.fn().mockImplementation(() => new Promise<string>(resolve => { finish = resolve; })) };
    const session = newSession(); session.messages.push({ id: "u", role: "user", content: "继续", createdAt: 1 });
    const job = new StoryRunner(client).run(session, context(abort.signal), DEFAULT_AGENT_SETTINGS, cast, { characterPaths: [], rounds: 1 }, () => {}, async () => {});
    await vi.waitFor(() => expect(client.chatMessages).toHaveBeenCalledOnce()); abort.abort(); const result = await job; finish("迟到的行为");
    expect(result.status).toBe("cancelled"); expect(result.story!.turns).toEqual([]); expect(result.proposals).toEqual([]); expect(client.chatMessages).toHaveBeenCalledOnce();
  });
  it("enforces the context budget before sending oversized character cards to the model", async () => {
    const client = { chatMessages: vi.fn() }; const session = newSession(); session.messages.push({ id: "u", role: "user", content: "继续", createdAt: 1 });
    const result = await new StoryRunner(client, 8000).run(session, context(), { ...DEFAULT_AGENT_SETTINGS, contextChars: 8000 }, [{ ...cast[0], content: "过长设定".repeat(5000) }], { characterPaths: [], rounds: 1 }, () => {}, async () => {});
    expect(client.chatMessages).not.toHaveBeenCalled(); expect(result.error).toContain("超过上下文预算");
  });
  it("keeps a completed long speech intact when it exceeds the next actor's context budget", async () => {
    const speech = '“每一句话都必须保留。”'.repeat(800);
    const client = { chatMessages: vi.fn().mockResolvedValueOnce(speech) };
    const session = newSession(); session.messages.push({ id: "u", role: "user", content: "继续完整谈话", createdAt: 1 });
    const result = await new StoryRunner(client, 8000).run(session, context(), { ...DEFAULT_AGENT_SETTINGS, contextChars: 8000 }, cast, { characterPaths: [], rounds: 1 }, () => {}, async () => {});
    expect(client.chatMessages).toHaveBeenCalledOnce(); expect(result.error).toContain("超过上下文预算");
    expect(result.content).toBe(speech); expect(result.story!.turns[0].content).toBe(speech);
  });
});
