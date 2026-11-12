import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor, WorkspaceLeaf } from "obsidian";
import { MarkdownView, TFile } from "obsidian";
import type DeepSeekPlugin from "../../main";
import type { EditorTarget } from "../../editor/EditorTarget";
import { LLMClient } from "../../core/llm";
import { DEFAULT_SETTINGS } from "../../types";
import { TypoCheckView } from "./TypoCheckView";

const ui = vi.hoisted(() => {
  class Element {
    children: Element[] = [];
    text = "";
    cls = "";
    disabled = false;
    events = new Map<string, () => void>();
    empty() { this.children = []; }
    addClass() {}
    setText(text: string) { this.text = text; }
    createEl(_tag: string, opts: { text?: string; cls?: string } = {}) {
      const child = new Element();
      child.text = opts.text ?? "";
      child.cls = opts.cls ?? "";
      this.children.push(child);
      return child;
    }
    createDiv(opts: { text?: string; cls?: string } = {}) { return this.createEl("div", opts); }
    createSpan(opts: { text?: string; cls?: string } = {}) { return this.createEl("span", opts); }
    addEventListener(name: string, callback: () => void) { this.events.set(name, callback); }
    click() { if (!this.disabled) this.events.get("click")?.(); }
    all(): Element[] { return [this, ...this.children.reduce<Element[]>((all, child) => all.concat(child.all()), [])]; }
  }
  return { Element };
});

vi.mock("obsidian", async original => ({
  ...await original(),
  ItemView: class {
    app: unknown;
    contentEl = new ui.Element();
    constructor(leaf: { app: unknown }) { this.app = leaf.app; }
    registerEvent() {}
  },
}));

const response = JSON.stringify({ issues: [{ line: 1, original: "再接再励", correction: "再接再厉", occurrence: 2 }] });

async function fixture() {
  let content = "再接再励，再接再励。";
  const file = Object.assign(new TFile(), { path: "原笔记.md", extension: "md" });
  const editor = {
    getValue: () => content,
    posToOffset: (pos: { ch: number }) => pos.ch,
    offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
    setSelection: vi.fn(), scrollIntoView: vi.fn(), focus: vi.fn(),
  } as unknown as Editor;
  let mode = "source";
  const markdown = Object.assign(new MarkdownView({} as WorkspaceLeaf), { editor, file, getMode: () => mode });
  const sourceLeaf = {
    view: markdown, getViewState: () => ({ state: { file: file.path, mode } }),
    setViewState: vi.fn().mockImplementation(async () => { mode = "source"; }),
  };
  const events = new Map<string, (...args: any[]) => void>();
  const workspace = {
    on: (event: string, callback: (...args: any[]) => void) => { events.set(event, callback); },
    getLeavesOfType: () => [sourceLeaf],
    setActiveLeaf: vi.fn(), rightSplit: { collapse: vi.fn() },
    getActiveFile: () => Object.assign(new TFile(), { path: "其他笔记.md" }),
  };
  const app = { workspace, vault: {
    on: (event: string, callback: (...args: any[]) => void) => { events.set(`vault:${event}`, callback); },
    getAbstractFileByPath: () => file, read: async () => content,
  } };
  const view = new TypoCheckView({ app } as unknown as WorkspaceLeaf, { settings: DEFAULT_SETTINGS } as DeepSeekPlugin);
  const target: EditorTarget = { editor, file, path: file.path, content,
    from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 }, cursor: { line: 0, ch: 0 }, selection: "" };
  await view.onOpen();
  const elements = () => (view.contentEl as unknown as InstanceType<typeof ui.Element>).all();
  return { view, target, editor, file, workspace, events, sourceLeaf, elements,
    status: () => elements().find(el => el.cls === "istart-typo-status")!.text,
    cards: () => elements().filter(el => el.cls === "istart-typo-item"),
    edit: () => { content = "正文已经修改。"; events.get("editor-change")!(editor, { file }); },
    preview: () => { mode = "preview"; },
  };
}

beforeEach(() => vi.restoreAllMocks());

describe("typo review sidebar", () => {
  it("renders original/correction and navigates to the captured note even after a file switch", async () => {
    const doc = await fixture();
    vi.spyOn(LLMClient.prototype, "chat").mockResolvedValue(response);
    await doc.view.showResult({ path: doc.target.path, content: doc.target.content, selected: false, result: { issues: [{ original: "再接再励", correction: "再接再厉", reason: "", start: 5, end: 9 }], unlocatedCount: 0 } });
    expect(doc.cards()).toHaveLength(1);
    expect(doc.cards()[0].children.map(el => el.text)).toEqual(["再接再励", " → ", "再接再厉", "第 1 行 · 第 6 列"]);
    doc.preview();
    doc.cards()[0].click();
    await vi.waitFor(() => expect(doc.editor.setSelection).toHaveBeenCalledWith({ line: 0, ch: 5 }, { line: 0, ch: 9 }));
    expect(doc.sourceLeaf.setViewState).toHaveBeenCalledWith(expect.objectContaining({ state: { file: doc.file.path, mode: "source" } }));
    expect(doc.workspace.setActiveLeaf).toHaveBeenCalledWith(doc.sourceLeaf, { focus: false });
    expect(doc.editor.getValue()).toBe(doc.target.content);
    await doc.view.onClose();
  });

  it("disables existing results when the source changes", async () => {
    const doc = await fixture();
    vi.spyOn(LLMClient.prototype, "chat").mockResolvedValue(response);
    await doc.view.showResult({ path: doc.target.path, content: doc.target.content, selected: false, result: { issues: [{ original: "再接再励", correction: "再接再厉", reason: "", start: 5, end: 9 }], unlocatedCount: 0 } });
    doc.edit();
    expect(doc.status()).toContain("原文已变化");
    expect(doc.cards()[0].disabled).toBe(true);
    doc.cards()[0].click();
    expect(doc.editor.setSelection).not.toHaveBeenCalled();
    await doc.view.onClose();
  });

  it("refuses to navigate a report opened after its original snapshot has changed", async () => {
    const doc = await fixture();
    doc.edit();
    await doc.view.showResult({ path: doc.target.path, content: doc.target.content, selected: false, result: { issues: [{ original: "再接再励", correction: "再接再厉", reason: "", start: 5, end: 9 }], unlocatedCount: 0 } });
    expect(doc.status()).toContain("原文已变化");
    expect(doc.cards()[0].disabled).toBe(true);
    doc.cards()[0].click();
    expect(doc.editor.setSelection).not.toHaveBeenCalled();
    await doc.view.onClose();
  });
  it("displays a completed empty check without calling the model", async () => {
    const doc = await fixture();
    const chat = vi.spyOn(LLMClient.prototype, "chat");
    await doc.view.showResult({ path: doc.target.path, content: doc.target.content, selected: false, result: { issues: [], unlocatedCount: 0 } });
    expect(doc.cards()).toHaveLength(0);
    expect(chat).not.toHaveBeenCalled();
    await doc.view.onClose();
  });
});
