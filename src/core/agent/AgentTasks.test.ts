import { describe, expect, it } from "vitest";
import { AGENT_TASKS, createAgentTask, taskDescription, validAgentTask, validateTaskFields } from "./AgentTasks";
import { DEFAULT_SETTINGS } from "../../types";

describe("Agent action tasks", () => {
  const reference = { path: "chapter.md", cursor: { offset: 1, content: "正文" } };
  it("keeps continuation and insertion defaults independent, including position and context", () => {
    const settings = { ...DEFAULT_SETTINGS, continueTargetWords: 1500, insertTargetWords: 100, continueMode: "chapter" as const, writingContextScope: "nearby" as const };
    expect(createAgentTask("continue-writing", settings, reference).args).toMatchObject({ task: "continue", targetWords: 1500, mode: "chapter", contextScope: "nearby" });
    expect(createAgentTask("insert-writing", settings, reference).args).toMatchObject({ task: "insert", targetWords: 100, contextScope: "nearby" });
    expect(createAgentTask("generate-next-chapter", settings, reference).args.targetWords).toBe(4500);
    expect(AGENT_TASKS["continue-writing-settings"].configure).toBe(true);
  });
  it("requires the right source before opening an assistant task", () => {
    expect(() => createAgentTask("summarize-note", DEFAULT_SETTINGS)).toThrow("笔记");
    expect(() => createAgentTask("polish-writing", DEFAULT_SETTINGS, reference)).toThrow("选中");
    expect(() => createAgentTask("continue-writing", DEFAULT_SETTINGS, { path: "a.md" })).toThrow("光标");
    expect(createAgentTask("new-reading-project", DEFAULT_SETTINGS).args).toEqual({});
  });
  it("keeps parameter drafts valid for storage but validates required fields before execution", () => {
    const task = createAgentTask("new-writing-project", DEFAULT_SETTINGS);
    expect(validAgentTask(task)).toBe(true);
    expect(() => validateTaskFields(task)).toThrow("作品名");
    Object.assign(task.args, { title: "归途", premise: "寻找旧友", genre: "novel" });
    validateTaskFields(task);
    expect(taskDescription(task)).toContain("体裁：小说");
    task.args.genre = "invalid";
    expect(() => validateTaskFields(task)).toThrow("体裁");
  });
  it("rejects corrupted tool names, fixed task changes, prototypes and invalid numeric values", () => {
    const task = createAgentTask("continue-writing", DEFAULT_SETTINGS, reference);
    expect(validAgentTask({ ...task, tool: "note.propose" })).toBe(false);
    expect(validAgentTask({ ...task, args: { ...task.args, task: "characters" } })).toBe(false);
    expect(validAgentTask({ ...task, actionId: "__proto__", tool: undefined })).toBe(false);
    task.args.targetWords = 1.5;
    expect(() => validateTaskFields(task)).toThrow("目标字数");
    task.args.targetWords = Infinity;
    expect(validAgentTask(task)).toBe(false);
  });
});
