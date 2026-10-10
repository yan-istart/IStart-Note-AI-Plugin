import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, Editor, PluginManifest } from "obsidian";
import { TFile } from "obsidian";
import DeepSeekPlugin from "../src/main";
import { DEFAULT_SETTINGS } from "../src/types";
import { LLMClient } from "../src/core/llm";
import { StoryContinuer } from "../src/ai/StoryContinuer";
import { WritingProjectManager } from "../src/features/writing/WritingProjectManager";
import { captureEditorTarget } from "../src/editor/EditorTarget";
import { registerAllActions } from "../src/actions/registry";
import { ALL_ACTIONS } from "../src/actions/definitions";

const ui = vi.hoisted(() => ({ results: [] as any[][], inputs: [] as any[][], settings: [] as any[][], insertSettings: [] as any[][], panels: [] as any[][] }));
vi.mock("obsidian", async (original) => ({
  ...await original(),
  Plugin: class { constructor(public app: App) {} },
  Modal: class {}, ItemView: class {}, PluginSettingTab: class {}, AbstractInputSuggest: class {},
  normalizePath: (path: string) => path,
}));
vi.mock("../src/features/assistant/AssistantModal", () => ({
  AssistantResultModal: class { constructor(...args: any[]) { ui.results.push(args); } open() {} },
  AssistantInputModal: class { constructor(...args: any[]) { ui.inputs.push(args); } open() {} },
}));
vi.mock("../src/features/writing/ContinueModal", () => ({
  ContinueModal: class { constructor(...args: any[]) { ui.settings.push(args); } open() {} },
}));
vi.mock("../src/features/writing/InsertModal", () => ({
  InsertModal: class { constructor(...args: any[]) { ui.insertSettings.push(args); } open() {} },
}));
vi.mock("../src/features/command-panel/CommandPanelModal", () => ({
  CommandPanelModal: class { constructor(...args: any[]) { ui.panels.push(args); } open() {} },
}));

function setup(type?: string, initialText = "上文", initialOffset = initialText.length) {
  let text = initialText, cursor = { line: 0, ch: 0 }, from = cursor;
  const toOffset = (pos: { line: number; ch: number }) => text.split("\n").slice(0, pos.line).reduce((sum, line) => sum + line.length + 1, 0) + pos.ch;
  const toPosition = (n: number) => { const lines = text.slice(0, n).split("\n"); return { line: lines.length - 1, ch: lines[lines.length - 1].length }; };
  cursor = toPosition(initialOffset);
  from = cursor;
  const editor = {
    getValue: () => text, getCursor: (side: string) => side === "from" ? from : cursor,
    getSelection: () => text.slice(toOffset(from), toOffset(cursor)),
    posToOffset: toOffset, offsetToPos: toPosition,
    setCursor: (pos: typeof cursor) => { cursor = pos; from = pos; }, scrollIntoView: vi.fn(),
    replaceRange: (insert: string, a: typeof cursor, b = a) => { text = text.slice(0, toOffset(a)) + insert + text.slice(toOffset(b)); },
  } as unknown as Editor;
  const file = Object.assign(new TFile(), { path: "note.md", basename: "note" });
  const app = {
    workspace: { activeEditor: { editor }, getActiveFile: () => file, on: vi.fn() },
    metadataCache: { getFileCache: () => ({ frontmatter: { type } }) },
    vault: { getMarkdownFiles: () => [] },
  } as unknown as App;
  const plugin = new DeepSeekPlugin(app, {} as PluginManifest);
  plugin.settings = { ...DEFAULT_SETTINGS, apiKey: "test-key" };
  Object.assign(plugin, { ensureLinkedConcepts: vi.fn(), saveSettings: vi.fn().mockResolvedValue(undefined) });
  return { plugin, app, editor, text: () => text,
    select: () => { from = { line: 0, ch: 0 }; cursor = { line: 0, ch: 2 }; },
    edit: () => { text = "已修改"; },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  ui.results.length = ui.inputs.length = ui.settings.length = ui.insertSettings.length = ui.panels.length = 0;
});

describe("insertion between existing passages", () => {
  it("reads both sides and inserts at the captured cursor, preserving the original prose", async () => {
    const doc = setup(undefined, "上文\n\n下文", 2);
    doc.plugin.settings.continueMode = "chapter";
    const chat = vi.spyOn(LLMClient.prototype, "chat").mockResolvedValue("承上启下");
    const target = captureEditorTarget(doc.app)!;
    doc.editor.setCursor({ line: 2, ch: 2 });
    await doc.plugin.runQuickAction("insert", target);
    expect(ui.insertSettings).toHaveLength(0);
    expect(doc.text()).toBe("上文\n\n下文");
    const prompt = chat.mock.calls[0][0];
    expect(prompt.userPrompt).toContain("【上文（插入位置之前）】\n上文");
    expect(prompt.userPrompt).toContain("【下文（插入位置之后）】\n下文");
    expect(prompt.systemPrompt).toContain("约 200 字");
    expect(prompt.systemPrompt).toContain("不改写、不复述两侧原文");
    const result = ui.results[0];
    expect(result[1].mode).toBe("insert");
    expect(result[5]).toBeUndefined();
    expect(result[2]()).toBe(true);
    expect(doc.text()).toBe("上文\n承上启下\n\n\n下文");
    expect(result[2]()).toBe(false);
    expect(doc.text()).toBe("上文\n承上启下\n\n\n下文");
  });

  it("limits context to the nearby prose and excludes frontmatter", async () => {
    const metadata = "---\ntitle: 测试\n---\n";
    const before = "远处的前文".repeat(20) + "上文末尾";
    const after = "下文开头" + "远处的后文".repeat(20);
    const doc = setup(undefined, metadata + before + "\n\n" + after, metadata.length + before.length);
    doc.plugin.settings.continueContextChars = 4;
    const chat = vi.spyOn(LLMClient.prototype, "chat").mockResolvedValue("连接段");
    await doc.plugin.insertWriting();
    expect(chat.mock.calls[0][0].userPrompt).toContain("【上文（插入位置之前）】\n上文末尾");
    expect(chat.mock.calls[0][0].userPrompt).toContain("【下文（插入位置之后）】\n下文开头");
    expect(chat.mock.calls[0][0].userPrompt).not.toMatch(/title:|远处/);
  });

  it.each([
    ["文末", "上文\n\n", 2],
    ["文首", "\n\n下文", 2],
    ["元数据之后", "---\ntitle: 测试\n---\n下文", "---\ntitle: 测试\n---\n".length],
    ["空元数据之后", "---\n---\n下文", 8],
    ["元数据之中", "---\ntitle: 测试\n---\n正文", 6],
  ])("does not generate when the cursor is at %s", async (_name, text, offset) => {
    const doc = setup(undefined, text, offset);
    const chat = vi.spyOn(LLMClient.prototype, "chat");
    await doc.plugin.insertWriting();
    expect(chat).not.toHaveBeenCalled();
    expect(ui.results).toHaveLength(0);
  });

  it("rejects a selection rather than silently replacing it", async () => {
    const doc = setup(undefined, "上文\n\n下文", 2);
    doc.select();
    const chat = vi.spyOn(LLMClient.prototype, "chat");
    await doc.plugin.insertWriting();
    expect(chat).not.toHaveBeenCalled();
    expect(doc.text()).toBe("上文\n\n下文");
  });

  it("saves separate insertion defaults and passes a custom bridging instruction", async () => {
    const doc = setup(undefined, "上文\n\n下文", 2);
    const chat = vi.spyOn(LLMClient.prototype, "chat").mockResolvedValue("解释段");
    await doc.plugin.insertWriting(true);
    expect(chat).not.toHaveBeenCalled();
    expect(ui.insertSettings[0][1]).toBe(200);
    ui.insertSettings[0][3]({ instruction: "解释前后观点的关系", targetWords: 100 });
    await vi.waitFor(() => expect(ui.results).toHaveLength(1));
    expect(doc.plugin.settings.insertTargetWords).toBe(100);
    expect(doc.plugin.settings.continueTargetWords).toBe(800);
    expect(doc.plugin.settings.continueMode).toBe("cursor");
    expect(chat.mock.calls[0][0].userPrompt).toContain("解释前后观点的关系");
    expect(chat.mock.calls[0][0].systemPrompt).toContain("约 100 字");
  });

  it("retries from both original sides and blocks writing after an edit", async () => {
    const doc = setup(undefined, "上文\n\n下文", 2);
    const chat = vi.spyOn(LLMClient.prototype, "chat").mockResolvedValueOnce("旧连接").mockResolvedValueOnce("新连接");
    await doc.plugin.insertWriting();
    ui.results[0][3]();
    await vi.waitFor(() => expect(ui.results).toHaveLength(2));
    expect(chat.mock.calls[0][0]).toEqual(chat.mock.calls[1][0]);
    expect(doc.text()).toBe("上文\n\n下文");
    doc.edit();
    expect(ui.results[1][2]()).toBe(false);
    expect(doc.text()).toBe("已修改");
  });

  it("prevents a second insertion or continuation while generation is pending", async () => {
    const doc = setup(undefined, "上文\n\n下文", 2);
    let resolve!: (text: string) => void;
    const chat = vi.spyOn(LLMClient.prototype, "chat").mockImplementation(() => new Promise((done) => { resolve = done; }));
    const pending = doc.plugin.insertWriting();
    await doc.plugin.insertWriting();
    await doc.plugin.continueWriting();
    expect(chat).toHaveBeenCalledTimes(1);
    resolve("连接段");
    await pending;
    expect(ui.results).toHaveLength(1);
  });

  it("injects chapter context and characters mentioned only in the following passage", async () => {
    const doc = setup("chapter", "他推开门。\n\n小林站在月港等他。", 5);
    const context = {
      projectTitle: "远行", oneLiner: "寻找故人", styleProfile: "简洁克制", genre: "novel",
      chapterNumber: 1, chapterTitle: "第一章", chapterSynopsis: "两人相遇", prevSynopsis: "", nextSynopsis: "",
      characters: [{ name: "小林", role: "support", summary: "旧友，沉默寡言" }],
      worldSettings: [{ name: "月港", category: "地理", content: "只在夜间开放" }],
    } as const;
    vi.spyOn(WritingProjectManager.prototype, "loadContext").mockResolvedValue(context as any);
    const chat = vi.spyOn(LLMClient.prototype, "chat").mockResolvedValue("他走过街巷来到港口。");
    await doc.plugin.insertWriting();
    const prompt = chat.mock.calls[0][0];
    expect(prompt.userPrompt).toContain("文风基调：简洁克制");
    expect(prompt.userPrompt).toContain("角色卡 小林（support）：旧友，沉默寡言");
    expect(prompt.userPrompt).toContain("世界观设定 月港（地理）：只在夜间开放");
    expect(prompt.userPrompt).toContain("【下文（插入位置之后）】\n小林站在月港等他。");
    expect(prompt.systemPrompt).not.toContain("为下一章铺垫");
    expect(ui.results[0][1].explanation).toBe("插写：note");
  });

  it.each([undefined, "chapter"])("prioritizes insertion in the panel for %s and keeps both writing entries", (type) => {
    const doc = setup(type, "上文\n\n下文", 2);
    const commands: any[] = [];
    Object.assign(doc.plugin, { addCommand: (command: any) => commands.push(command), registerEvent: vi.fn(), addRibbonIcon: vi.fn() });
    registerAllActions(doc.plugin, ALL_ACTIONS);
    expect(commands.find((command) => command.id === "insert-writing").icon).toBe("istart-insert");
    const openPanel = commands.find((command) => command.id === "open-panel").callback;
    openPanel();
    const panel = ui.panels[0];
    expect(panel[2][0].id).toBe("insert-writing");
    expect(panel[1].flatMap((group: any) => group.actions).map((action: any) => action.id)).toEqual(
      expect.arrayContaining(["continue-writing", "insert-writing"]));
    doc.editor.setCursor({ line: 2, ch: 2 });
    openPanel();
    expect(ui.panels[1][2][0].id).toBe("continue-writing");
  });

  it("offers insertion in the assistant and keeps the original position when focus moves", async () => {
    const doc = setup(undefined, "上文\n\n下文", 2);
    const chat = vi.spyOn(LLMClient.prototype, "chat").mockResolvedValue("连接段");
    doc.plugin.openAssistant();
    expect(ui.inputs[0][3].quickActions[0].id).toBe("insert");
    doc.editor.setCursor({ line: 2, ch: 2 });
    ui.inputs[0][2]("插写");
    await vi.waitFor(() => expect(ui.results).toHaveLength(1));
    expect(chat.mock.calls[0][0].userPrompt).toContain("【下文（插入位置之后）】\n下文");
    expect(ui.results[0][2]()).toBe(true);
    expect(doc.text()).toBe("上文\n连接段\n\n\n下文");
  });
});

describe("mobile quick-action workflow", () => {
  it("continues directly and inserts before using the accepted text in the next request", async () => {
    const doc = setup();
    const chat = vi.spyOn(LLMClient.prototype, "chat").mockResolvedValueOnce("第一段").mockResolvedValueOnce("第二段");
    await doc.plugin.runQuickAction("continue");
    expect(ui.settings).toHaveLength(0);
    expect(doc.text()).toBe("上文");
    const first = ui.results[0];
    expect(first[5].label).toBe("插入并继续");
    expect(first[5].callback()).toBe(true);
    await vi.waitFor(() => expect(ui.results).toHaveLength(2));
    expect(doc.text()).toBe("上文\n第一段\n");
    expect(chat.mock.calls[1][0].userPrompt).toContain("上文\n第一段");
    expect(ui.results[1][2]()).toBe(true);
    expect(doc.text()).toBe("上文\n第一段\n\n第二段\n");
  });

  it("retry keeps the original context and never inserts the rejected version", async () => {
    const doc = setup();
    const chat = vi.spyOn(LLMClient.prototype, "chat").mockResolvedValueOnce("旧版本").mockResolvedValueOnce("新版本");
    await doc.plugin.continueWriting();
    ui.results[0][3]();
    await vi.waitFor(() => expect(ui.results).toHaveLength(2));
    expect(chat.mock.calls[0][0]).toEqual(chat.mock.calls[1][0]);
    expect(doc.text()).toBe("上文");
  });

  it("suppresses repeated generation while a request is pending", async () => {
    const doc = setup();
    let resolve!: (text: string) => void;
    const chat = vi.spyOn(LLMClient.prototype, "chat").mockImplementation(() => new Promise((done) => { resolve = done; }));
    const pending = doc.plugin.continueWriting();
    await doc.plugin.continueWriting();
    expect(chat).toHaveBeenCalledTimes(1);
    resolve("续文");
    await pending;
    expect(ui.results).toHaveLength(1);
  });

  it("refuses insertion and another continuation if the original document changes", async () => {
    const doc = setup();
    const chat = vi.spyOn(LLMClient.prototype, "chat").mockResolvedValue("续文");
    await doc.plugin.continueWriting();
    doc.edit();
    expect(ui.results[0][5].callback()).toBe(false);
    expect(doc.text()).toBe("已修改");
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("uses chapter context for story continuation", async () => {
    const doc = setup("chapter");
    const context = { chapterTitle: "第一章" } as any;
    vi.spyOn(WritingProjectManager.prototype, "loadContext").mockResolvedValue(context);
    const story = vi.spyOn(StoryContinuer.prototype, "continueStory").mockResolvedValue("故事续文");
    const chat = vi.spyOn(LLMClient.prototype, "chat");
    await doc.plugin.continueWriting();
    expect(story).toHaveBeenCalledWith(context, { mode: "cursor", instruction: "", targetWords: 800 }, "上文");
    expect(chat).not.toHaveBeenCalled();
  });

  it("opens settings without generating, then saves the chosen defaults", async () => {
    const doc = setup();
    const chat = vi.spyOn(LLMClient.prototype, "chat").mockResolvedValue("续文");
    await doc.plugin.continueWriting(true);
    expect(chat).not.toHaveBeenCalled();
    ui.settings[0][3]({ mode: "chapter", instruction: "收束", targetWords: 300 });
    await vi.waitFor(() => expect(ui.results).toHaveLength(1));
    expect(doc.plugin.settings.continueMode).toBe("chapter");
    expect(doc.plugin.settings.continueTargetWords).toBe(300);
    expect(ui.results[0][1].mode).toBe("append");
  });

  it("forces explanation to a preview even if the model suggests replacing the selection", async () => {
    const doc = setup(); doc.select();
    vi.spyOn(LLMClient.prototype, "chat").mockResolvedValue("<!-- mode:replace -->\n解释内容");
    await doc.plugin.runQuickAction("explain");
    expect(ui.results[0][1].mode).toBe("show");
    expect(doc.text()).toBe("上文");
  });

  it("registers toolbar icons and checks selection requirements for commands", () => {
    const doc = setup();
    const commands: any[] = [];
    Object.assign(doc.plugin, { addCommand: (command: any) => commands.push(command), registerEvent: vi.fn(), addRibbonIcon: vi.fn() });
    registerAllActions(doc.plugin, ALL_ACTIONS);
    const continuation = commands.find((command) => command.id === "continue-writing");
    const polish = commands.find((command) => command.id === "polish-writing");
    expect(continuation.icon).toBe("istart-continue");
    expect(continuation.editorCheckCallback(true)).toBe(true);
    expect(polish.editorCheckCallback(true)).toBe(false);
    doc.select();
    expect(continuation.editorCheckCallback(true)).toBe(false);
    expect(polish.editorCheckCallback(true)).toBe(true);
  });

  it("keeps the original selection when opening the assistant", async () => {
    const doc = setup(); doc.select();
    const target = captureEditorTarget(doc.app)!;
    doc.plugin.openAssistant(target);
    doc.editor.setCursor({ line: 0, ch: 2 });
    vi.spyOn(WritingProjectManager.prototype, "loadContext").mockResolvedValue(null);
    vi.spyOn(LLMClient.prototype, "chat").mockResolvedValue("润色结果");
    ui.inputs[0][3].onQuickAction("polish");
    await vi.waitFor(() => expect(ui.results).toHaveLength(1));
    expect(ui.results[0][2]()).toBe(true);
    expect(doc.text()).toBe("润色结果");
  });
});
