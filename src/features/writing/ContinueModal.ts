import { App, Setting, Notice } from "obsidian";
import { ContinueMode, ContinueRequest } from "./types";
import { ActionModal } from "../../ui/ActionModal";

/**
 * 续写弹窗 — 选择模式,可选附加指令与目标字数。
 */
export class ContinueModal extends ActionModal {
  private instruction = "";
  private targetWords: number;

  constructor(
    app: App,
    defaultWords: number,
    private chapterTitle: string,
    private onSubmit: (request: ContinueRequest) => void,
    private mode: ContinueMode = "cursor"
  ) {
    super(app);
    this.targetWords = defaultWords;
    this.titleEl.setText(`续写：${chapterTitle}`);
  }

  onOpen() {
    super.onOpen();
    const contentEl = this.bodyEl;

    new Setting(contentEl)
      .setName("续写方式")
      .addDropdown((drop) =>
        drop
          .addOption("cursor", "光标续写（接住当前段落）")
          .addOption("chapter", "文末续写（追加到文档末尾）")
          .setValue(this.mode)
          .onChange((v) => { this.mode = v as ContinueMode; })
      );

    contentEl.createEl("p", { text: "目标字数", cls: "istart-field-label" });
    const presets = contentEl.createDiv({ cls: "istart-word-presets" });
    const buttons: HTMLButtonElement[] = [];
    for (const words of [300, 800, 1500]) {
      const button = presets.createEl("button", { text: `${words} 字`, attr: { type: "button", "aria-pressed": String(this.targetWords === words) } });
      buttons.push(button);
      button.addEventListener("click", () => {
        this.targetWords = words;
        input.value = String(words);
        buttons.forEach((btn, index) => btn.setAttribute("aria-pressed", String([300, 800, 1500][index] === words)));
      });
    }

    let input: HTMLInputElement;
    new Setting(contentEl)
      .setName("自定义字数")
      .addText((text) => {
          input = text.inputEl;
          input.type = "number";
          input.min = "1";
          input.step = "1";
          input.inputMode = "numeric";
          input.setAttribute("aria-label", "目标字数");
          text.setValue(String(this.targetWords)).onChange((v) => {
            this.targetWords = Number(v);
            buttons.forEach((btn, index) => btn.setAttribute("aria-pressed", String([300, 800, 1500][index] === this.targetWords)));
          });
      });

    const details = contentEl.createEl("details", { cls: "istart-assistant-more" });
    details.createEl("summary", { text: "附加指令（可选）" });
    const instruction = details.createEl("textarea", {
      cls: "istart-assistant-input", attr: { rows: "2", placeholder: "如：推进感情线 / 收束本章悬念", "aria-label": "附加指令" },
    });
    instruction.addEventListener("input", () => { this.instruction = instruction.value.trim(); });

    new Setting(this.actionsEl)
      .addButton((btn) =>
        btn.setButtonText("开始续写").setCta().onClick(() => {
          if (!Number.isInteger(this.targetWords) || this.targetWords <= 0) { new Notice("请输入正整数目标字数"); return; }
          this.close();
          this.onSubmit({ mode: this.mode, instruction: this.instruction, targetWords: this.targetWords });
        })
      )
      .addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));
  }

  onClose() {
    super.onClose();
  }
}
