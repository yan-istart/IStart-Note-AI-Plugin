import { App, MarkdownView, TFile } from "obsidian";
import { validateNotePath, changedRange } from "./Changes";
import type { FileChange, NoteReference, NoteSnapshot } from "./types";
import type { EditorTarget } from "../../editor/EditorTarget";

export function referenceFromTarget(target: EditorTarget): NoteReference {
  const offset = (position: { line: number; ch: number }) => target.content.split("\n").slice(0, position.line).reduce((n, line) => n + line.length + 1, 0) + position.ch;
  const from = offset(target.from), to = offset(target.to);
  return {
    path: target.path,
    ...(target.selection ? { selection: { start: from, end: to, text: target.selection, content: target.content } } : {}),
    cursor: { offset: offset(target.cursor), content: target.content },
  };
}
function openEditor(app: App, path: string) {
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    if (leaf.view instanceof MarkdownView && leaf.view.file?.path === path && leaf.view.getMode() === "source") return leaf.view.editor;
  }
  return null;
}
export async function readNote(app: App, path: string): Promise<string | null> {
  validateNotePath(path);
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;
  return openEditor(app, path)?.getValue() ?? await app.vault.read(file);
}
export async function snapshotReference(app: App, ref: NoteReference): Promise<NoteSnapshot> {
  const content = await readNote(app, ref.path);
  if (content === null) throw new Error(`找不到引用笔记：${ref.path}`);
  if (content.length > 250000) throw new Error(`笔记过大，请引用选区或拆分笔记：${ref.path}`);
  if (ref.selection && ref.selection.content !== content) throw new Error(`引用选区的原文已变化，请重新选中并发送到助手：${ref.path}`);
  if (ref.cursor && ref.cursor.content !== content) {
    // A stale cursor must never silently become a different insertion point.
    return { ...ref, content, cursor: undefined };
  }
  return { ...ref, content };
}
export async function writeChange(app: App, change: FileChange): Promise<void> {
  const path = validateNotePath(change.path);
  const actual = await readNote(app, path);
  if (actual === change.after) return;
  if (actual !== change.before) throw new Error(`写入前原文已变化：${path}`);
  const editor = openEditor(app, path);
  if (editor && change.before !== null) {
    const range = changedRange(change.before, change.after);
    // One editor transaction preserves the native undo stack.
    editor.replaceRange(range.text, editor.offsetToPos(range.start), editor.offsetToPos(range.end));
    return;
  }
  if (change.before === null) {
    await ensureNoteFolder(app, path);
    await app.vault.create(path, change.after);
    return;
  }
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) throw new Error(`找不到原文件：${path}`);
  await app.vault.process(file, current => {
    if (current !== change.before) throw new Error(`原文已变化：${path}`);
    return change.after;
  });
}
export async function ensureNoteFolder(app: App, path: string): Promise<void> {
  let folder = "";
  for (const part of path.split("/").slice(0, -1)) {
    folder = folder ? `${folder}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
  }
}
