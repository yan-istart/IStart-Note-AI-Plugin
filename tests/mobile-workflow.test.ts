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

const ui = vi.hoisted(() => ({ results: [] as any[][], inputs: [] as any[][], settings: [] as any[][] }));
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

function setup(type?: string) {
  let text = "上文", cursor = { line: 0, ch: 2 }, from = cursor;
  const toOffset = (pos: { line: number; ch: number }) => text.split("\n").slice(0, pos.line).reduce((sum, line) => sum + line.length + 1, 0) + pos.ch;
  const toPosition = (n: number) => { const lines = text.slice(0, n).split("\n"); return { line: lines.length - 1, ch: lines[lines.length - 1].length }; };
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
  ui.results.length = ui.inputs.length = ui.settings.length = 0;
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
