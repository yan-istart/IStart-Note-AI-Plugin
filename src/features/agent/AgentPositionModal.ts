import { Notice, Setting } from "obsidian";
import type DeepSeekPlugin from "../../main";
import { ActionModal } from "../../ui/ActionModal";
import { readNote, snapshotReference } from "../../core/agent/Context";
import type { NoteReference } from "../../core/agent/types";

/** Choose an exact location without returning keyboard focus to the source editor. */
export class AgentPositionModal extends ActionModal {
  private version = 0;
  constructor(private plugin: DeepSeekPlugin, private sessionId: string, private references: NoteReference[]) {
    super(plugin.app); this.titleEl.setText("设置插入位置");
  }
  onOpen(): void {
    super.onOpen();
    this.bodyEl.createEl("p", { text: "选择目标笔记，在原文中点击位置或用方向键移动光标，再确认。原文只读。" });
    const reference = this.references[0];
    if (!reference) { this.bodyEl.createEl("p", { text: "请先通过 @ 引用目标笔记。" }); return; }
    const source = this.bodyEl.createDiv();
    new Setting(this.bodyEl).setName("目标笔记").addDropdown(d => {
      for (const ref of this.references) d.addOption(ref.path, ref.path);
      d.setValue(reference.path).onChange(path => { const ref = this.references.find(r => r.path === path); if (ref) void this.load(ref, source); });
    });
    void this.load(reference, source);
  }
  private async load(reference: NoteReference, root: HTMLElement): Promise<void> {
    const version = ++this.version;
    root.empty(); this.actionsEl.empty();
    try {
      const note = await snapshotReference(this.app, { path: reference.path });
      if (version !== this.version) return;
      const input = root.createEl("textarea", { cls: "istart-agent-position-editor", attr: { "aria-readonly": "true", "aria-label": "在原文中选择插入位置", rows: "14" } });
      input.value = note.content;
      const offset = reference.cursor?.content === note.content ? reference.cursor.offset : note.content.length;
      let chosenOffset = offset;
      input.setSelectionRange(offset, offset);
      // Keep native caret navigation (readonly textareas suppress it on some clients),
      // while rejecting every text edit. This control never writes to the source.
      input.addEventListener("beforeinput", event => event.preventDefault());
      input.addEventListener("input", () => { input.value = note.content; input.setSelectionRange(chosenOffset, chosenOffset); });
      const location = root.createDiv({ cls: "istart-agent-muted" });
      const show = () => { chosenOffset = input.selectionStart; const lines = note.content.slice(0, chosenOffset).split("\n"); location.setText(`第 ${lines.length} 行，第 ${lines[lines.length - 1].length + 1} 列`); };
      for (const event of ["click", "keyup", "select"]) input.addEventListener(event, show);
      show();
      new Setting(this.actionsEl).addButton(b => b.setButtonText("确认插入位置").setCta().onClick(async () => {
        b.setDisabled(true);
        try {
          if (await readNote(this.app, note.path) !== note.content) throw new Error("原文已变化，请重新打开位置选择器");
          if (version !== this.version) return;
          this.plugin.agent.setInsertionReference(this.sessionId, { path: note.path, cursor: { offset: chosenOffset, content: note.content } });
          this.close();
        } catch (error) { new Notice((error as Error).message); b.setDisabled(false); }
      })).addButton(b => b.setButtonText("取消").onClick(() => this.close()));
      this.focusOnDesktop(input);
    } catch (error) { if (version === this.version) root.setText((error as Error).message); }
  }
  onClose(): void { ++this.version; super.onClose(); }
}
