import { EditorView } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import type { AgentController } from "./AgentController";

/** Remember positions while the source editor owns focus, including its final blur update. */
export function createEditorAnchorExtension(controller: AgentController) {
  return EditorView.updateListener.of(update => {
    if (!(update.selectionSet || update.docChanged || update.focusChanged) || (!update.view.hasFocus && !update.focusChanged)) return;
    const info = update.state.field(editorInfoField, false);
    if (info?.editor && info.file) controller.rememberEditor(info.editor, info.file);
  });
}
