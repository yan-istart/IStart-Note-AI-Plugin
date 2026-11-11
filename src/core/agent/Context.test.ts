import { describe, expect, it, vi } from "vitest";
import type { App, WorkspaceLeaf } from "obsidian";
import { MarkdownView, TFile } from "obsidian";
import { referenceFromTarget, writeChange } from "./Context";
import type { EditorTarget } from "../../editor/EditorTarget";

describe("fixed Agent editor targets", () => {
  it("computes offsets from captured content, even when the editor changed before the preview opened", () => {
    const position = vi.fn(() => 999);
    const target = { path: "a.md", content: "header\nabcd", selection: "bc", from: { line: 1, ch: 1 }, to: { line: 1, ch: 3 }, cursor: { line: 1, ch: 3 }, editor: { posToOffset: position } } as unknown as EditorTarget;
    expect(referenceFromTarget(target)).toMatchObject({ selection: { start: 8, end: 10, text: "bc", content: "header\nabcd" }, cursor: { offset: 10 } });
    expect(position).not.toHaveBeenCalled();
  });
  it("writes to an inactive open editor in one undoable change and refuses later edits", async () => {
    let content = "abc";
    const replace = vi.fn((text: string, from: { ch: number }, to: { ch: number }) => { content = content.slice(0, from.ch) + text + content.slice(to.ch); });
    const file = Object.assign(new TFile(), { path: "a.md" });
    const view = Object.assign(new MarkdownView({} as WorkspaceLeaf), { file, getMode: () => "source", editor: { getValue: () => content, offsetToPos: (ch: number) => ({ line: 0, ch }), replaceRange: replace } });
    const diskWrite = vi.fn();
    const app = { workspace: { getLeavesOfType: () => [{ view }] }, vault: { getAbstractFileByPath: () => file, process: diskWrite } } as unknown as App;
    await writeChange(app, { path: "a.md", before: "abc", after: "aNEWbc" });
    expect(content).toBe("aNEWbc"); expect(replace).toHaveBeenCalledOnce(); expect(diskWrite).not.toHaveBeenCalled();
    content = "manual edit";
    await expect(writeChange(app, { path: "a.md", before: "aNEWbc", after: "another" })).rejects.toThrow("变化");
    expect(content).toBe("manual edit");
  });
});
