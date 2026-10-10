import { Notice, Setting } from "obsidian";
import type { InsertRequest } from "./types";

/** Shared compact fields for continuation and insertion, with independent defaults. */
export function addWritingFields(
  container: HTMLElement,
  defaultWords: number,
  wordPresets: number[],
  placeholder: string,
  instructionPresets: string[] = []
): () => InsertRequest | null {
  let targetWords = defaultWords;
  let input: HTMLInputElement;
  const buttons: HTMLButtonElement[] = [];
  const updatePressed = () => buttons.forEach((button, index) =>
    button.setAttribute("aria-pressed", String(wordPresets[index] === targetWords)));

  container.createEl("p", { text: "目标字数", cls: "istart-field-label" });
  const presets = container.createDiv({ cls: "istart-word-presets" });
  for (const words of wordPresets) {
    const button = presets.createEl("button", { text: `${words} 字`, attr: { type: "button", "aria-pressed": String(targetWords === words) } });
    buttons.push(button);
    button.addEventListener("click", () => {
      targetWords = words;
      input.value = String(words);
      updatePressed();
    });
  }
  new Setting(container).setName("自定义字数").addText((text) => {
    input = text.inputEl;
    input.type = "number";
    input.min = "1";
    input.step = "1";
    input.inputMode = "numeric";
    input.setAttribute("aria-label", "目标字数");
    text.setValue(String(targetWords)).onChange((value) => {
      targetWords = Number(value);
      updatePressed();
    });
  });

  const details = container.createEl("details", { cls: "istart-assistant-more" });
  details.createEl("summary", { text: "附加指令（可选）" });
  const instruction = details.createEl("textarea", {
    cls: "istart-assistant-input", attr: { rows: "2", placeholder, "aria-label": "附加指令" },
  });
  if (instructionPresets.length) {
    const tags = details.createDiv({ cls: "istart-assistant-tags" });
    for (const preset of instructionPresets) {
      const button = tags.createEl("button", { text: preset, cls: "istart-assistant-tag", attr: { type: "button" } });
      button.addEventListener("click", () => { instruction.value = preset; });
    }
  }
  return () => {
    if (!Number.isInteger(targetWords) || targetWords <= 0) {
      new Notice("请输入正整数目标字数");
      return null;
    }
    return { targetWords, instruction: instruction.value.trim() };
  };
}
