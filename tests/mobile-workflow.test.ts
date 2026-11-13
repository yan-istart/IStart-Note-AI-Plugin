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
  Component: class {},
  Modal: class {}, ItemView: class {}, PluginSettingTab: class {}, AbstractInputSuggest: class {},
  MarkdownView: class {},
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

describe("unified workbench entry points", () => {
  it("opens publishing without an AI key and preserves the right-click target over the active editor", () => {
    const doc = setup(); doc.plugin.settings.apiKey = "";
    const publish = vi.spyOn(doc.plugin, "activatePublishingView").mockResolvedValue(undefined);
    const commands: any[] = [], handlers = new Map<string, (...args: any[]) => void>();
    vi.mocked(doc.app.workspace.on).mockImplementation(((event: string, callback: (...args: any[]) => void) => { handlers.set(event, callback); return {}; }) as any);
    Object.assign(doc.plugin, { addCommand: (command: any) => commands.push(command), registerEvent: vi.fn(), addRibbonIcon: vi.fn() });
    registerAllActions(doc.plugin, ALL_ACTIONS);
    commands.find(command => command.id === "publish-note").editorCheckCallback(false);
    expect(publish).toHaveBeenLastCalledWith(doc.app.workspace.getActiveFile());
    const other = Object.assign(new TFile(), { path: "other.md", extension: "md", basename: "other" });
    const callbacks: (() => void)[] = [];
    const item = { setTitle() { return this; }, setIcon() { return this; }, onClick(callback: () => void) { callbacks.push(callback); return this; } };
    handlers.get("file-menu")!({ addItem: (build: (value: typeof item) => void) => build(item) }, other);
    callbacks.forEach(callback => callback());
    expect(publish).toHaveBeenLastCalledWith(other);
  });
  it("captures source anchors before the workbench takes focus and immediately runs a configured task", async () => {
    const doc = setup(); doc.select(); const target = captureEditorTarget(doc.app)!;
    const prepareTask = vi.fn((_task: unknown, _refs: unknown) => ({ id: "task-session" }));
    const submitTask = vi.fn(async () => {});
    Object.assign(doc.plugin, { agent: { prepareTask, submitTask } });
    vi.spyOn(doc.plugin as any, "activateWorkbench").mockImplementation(async () => { doc.editor.setCursor({ line: 0, ch: 2 }); });
    await doc.plugin.startAgentAction("polish-writing", target);
    expect(prepareTask.mock.calls[0][0]).toMatchObject({ tool: "writing.generate", args: { task: "polish" } });
    expect(prepareTask.mock.calls[0][1]).toEqual([expect.objectContaining({ path: "note.md", selection: { start: 0, end: 2, text: "上文", content: "上文" } })]);
    expect(submitTask).toHaveBeenCalledWith("task-session");
  });
  it("opens parameter tasks in the assistant without generating before the user fills the card", async () => {
    const doc = setup(); const prepareTask = vi.fn((_task: unknown, _refs: unknown) => ({ id: "task-session" }));
    const submitTask = vi.fn(); Object.assign(doc.plugin, { agent: { prepareTask, submitTask } });
    vi.spyOn(doc.plugin as any, "activateWorkbench").mockResolvedValue(undefined);
    await doc.plugin.startAgentAction("new-reading-project");
    expect(prepareTask.mock.calls[0][0]).toMatchObject({ tool: "reading.plan" });
    expect(prepareTask.mock.calls[0][1]).toEqual([]); expect(submitTask).not.toHaveBeenCalled();
  });
  it("routes existing generation commands to Agent while keeping ordinary annotations local", () => {
    const doc = setup(); doc.select();
    const start = vi.spyOn(doc.plugin, "startAgentAction").mockResolvedValue(undefined);
    const annotation = vi.spyOn(doc.plugin, "addAnnotation").mockImplementation(() => {});
    const commands: any[] = [];
    Object.assign(doc.plugin, { addCommand: (command: any) => commands.push(command), registerEvent: vi.fn(), addRibbonIcon: vi.fn() });
    registerAllActions(doc.plugin, ALL_ACTIONS);
    commands.find(command => command.id === "ai-annotation").editorCheckCallback(false);
    expect(start.mock.calls[0][0]).toBe("ai-annotation");
    commands.find(command => command.id === "add-annotation").editorCheckCallback(false);
    expect(annotation).toHaveBeenCalledOnce(); expect(start).toHaveBeenCalledOnce();
  });
  it("opens the assistant from a single workbench ribbon entry while retaining the panel command", () => {
    const doc = setup();
    const commands: any[] = [];
    const ribbons: any[][] = [];
    const assistant = vi.spyOn(doc.plugin, "openAssistant").mockImplementation(() => {});
    Object.assign(doc.plugin, {
      addCommand: (command: any) => commands.push(command),
      registerEvent: vi.fn(),
      addRibbonIcon: (...args: any[]) => ribbons.push(args),
    });
    registerAllActions(doc.plugin, ALL_ACTIONS);
    expect(ribbons).toHaveLength(1);
    expect(ribbons[0][1]).toBe("IStart 工作台");
    ribbons[0][2]();
    expect(assistant).toHaveBeenCalledTimes(1);
    expect(ui.panels).toHaveLength(0);
    commands.find(command => command.id === "open-panel").callback();
    expect(ui.panels).toHaveLength(0);
    expect(assistant).toHaveBeenCalledTimes(2);
  });

  it("routes the existing sync command into the workbench rather than a separate sync modal", () => {
    const doc = setup();
    const commands: any[] = [];
    const sync = vi.spyOn(doc.plugin, "activateSyncView").mockResolvedValue(undefined);
    const modal = vi.spyOn(doc.plugin, "openDataSyncModal").mockImplementation(() => {});
    Object.assign(doc.plugin, { addCommand: (command: any) => commands.push(command), registerEvent: vi.fn(), addRibbonIcon: vi.fn() });
    registerAllActions(doc.plugin, ALL_ACTIONS);
    const command = commands.find(item => item.id === "baidu-sync");
    expect(command.checkCallback(true)).toBe(true);
    expect(sync).not.toHaveBeenCalled();
    command.checkCallback(false);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(modal).not.toHaveBeenCalled();
  });
});

describe("legacy entry aliases", () => {
  it.each([
    ["continue", "continue-writing"], ["insert", "insert-writing"], ["continue-settings", "continue-writing-settings"],
    ["insert-settings", "insert-writing-settings"], ["polish", "polish-writing"], ["expand", "expand-selection"],
    ["explain", "explain-selection"], ["summarize", "summarize-note"],
  ] as const)("routes %s to its Agent task with the captured editor target", async (quick, action) => {
    const doc = setup(); const target = captureEditorTarget(doc.app)!;
    const start = vi.spyOn(doc.plugin, "startAgentAction").mockResolvedValue(undefined);
    await doc.plugin.runQuickAction(quick, target);
    expect(start).toHaveBeenCalledWith(action, target);
    expect(ui.results).toHaveLength(0); expect(ui.inputs).toHaveLength(0);
  });
  it.each(["beautify-note", "check-typos", "knowledge-debt"])("routes the remaining %s command to Agent", action => {
    const doc = setup();
    const start = vi.spyOn(doc.plugin, "startAgentAction").mockResolvedValue(undefined);
    const commands: any[] = [];
    Object.assign(doc.plugin, { addCommand: (command: any) => commands.push(command), registerEvent: vi.fn(), addRibbonIcon: vi.fn() });
    registerAllActions(doc.plugin, ALL_ACTIONS);
    const command = commands.find(c => c.id === action);
    (command.editorCheckCallback ?? command.checkCallback)(false);
    expect(start.mock.calls[0][0]).toBe(action);
    expect(ui.results).toHaveLength(0); expect(ui.panels).toHaveLength(0);
  });
  it("redirects both old quick dialogs into the assistant", () => {
    const doc = setup(); const target = captureEditorTarget(doc.app)!;
    const assistant = vi.spyOn(doc.plugin, "openAssistant").mockImplementation(() => {});
    const qa = vi.spyOn(doc.plugin, "openVaultQA").mockImplementation(() => {});
    doc.plugin.openQuickAssistant(target); doc.plugin.openVaultQAQuick();
    expect(assistant).toHaveBeenCalledWith(target); expect(qa).toHaveBeenCalledOnce();
    expect(ui.inputs).toHaveLength(0);
  });
  it("retains selection checks on commands", () => {
    const doc = setup(); const commands: any[] = [];
    Object.assign(doc.plugin, { addCommand: (command: any) => commands.push(command), registerEvent: vi.fn(), addRibbonIcon: vi.fn() });
    registerAllActions(doc.plugin, ALL_ACTIONS);
    const polish = commands.find(c => c.id === "polish-writing");
    expect(polish.editorCheckCallback(true)).toBe(false);
    doc.select(); expect(polish.editorCheckCallback(true)).toBe(true);
  });
});
