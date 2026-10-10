import type { App, Editor, EditorPosition, TFile } from "obsidian";
import type { AssistantResult } from "../ai/AIAssistant";

/** Captured before opening UI, so focus or selection changes cannot redirect a write. */
export interface EditorTarget {
  editor: Editor;
  file: TFile;
  path: string;
  content: string;
  cursor: EditorPosition;
  from: EditorPosition;
  to: EditorPosition;
  selection: string;
}

export function captureEditorTarget(app: App): EditorTarget | null {
  const editor = app.workspace.activeEditor?.editor;
  const file = app.workspace.getActiveFile();
  if (!editor || !file) return null;
  return {
    editor, file, path: file.path, content: editor.getValue(),
    cursor: { ...editor.getCursor() }, from: { ...editor.getCursor("from") }, to: { ...editor.getCursor("to") },
    selection: editor.getSelection(),
  };
}

export function checkEditorTarget(app: App, target: EditorTarget): void {
  if (app.workspace.getActiveFile()?.path !== target.path || target.file.path !== target.path ||
      app.workspace.activeEditor?.editor !== target.editor) {
    throw new Error("请回到生成时的原文档，再插入结果");
  }
  if (target.editor.getValue() !== target.content) {
    throw new Error("原文已发生变化，请复制结果或基于新正文重新发起生成");
  }
}

/** Returns a new target at the end of the insertion for the next continuation. */
export function writeEditorResult(app: App, target: EditorTarget, result: AssistantResult): EditorTarget {
  checkEditorTarget(app, target);
  const { editor } = target;
  let from = target.cursor;
  let to = from;
  let text = `\n${result.content}\n`;
  if (result.mode === "replace") {
    from = target.from;
    to = target.to;
    text = result.content;
  } else if (result.mode === "append") {
    from = editor.offsetToPos(target.content.length);
    to = from;
    text = `\n\n${result.content}\n`;
  }
  const endOffset = editor.posToOffset(from) + text.length;
  editor.replaceRange(text, from, to);
  const cursor = editor.offsetToPos(endOffset);
  editor.setCursor(cursor);
  editor.scrollIntoView({ from: cursor, to: cursor });
  return {
    ...target, content: editor.getValue(), cursor: { ...cursor },
    from: { ...cursor }, to: { ...cursor }, selection: "",
  };
}
