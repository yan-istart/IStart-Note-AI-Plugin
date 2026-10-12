import { Notice, Setting } from "obsidian";
import type { InsertRequest, WritingContextScope } from "./types";
import { MAX_WRITING_TARGET } from "../../ai/WritingGeneration";

/** Shared compact fields for continuation and insertion, with independent defaults. */
export function addWritingFields(
  container: HTMLElement,
  defaultWords: number,
  wordPresets: number[],
  placeholder: string,
  instructionPresets: string[] = [],
  defaultScope: WritingContextScope = "full"
): () => InsertRequest | null {
  let targetWords = defaultWords;
  let contextScope = defaultScope;
  let input: HTMLInputElement;
  const buttons: HTMLButtonElement[] = [];
  const updatePressed = () => buttons.forEach((button, index) =>
    button.setAttribute("aria-pressed", String(wordPresets[index] === targetWords)));

  new Setting(container).setName("上下文范围").addDropdown((dropdown) => dropdown
    .addOption("full", "完整当前文档＋作品大纲和设定")
    .addOption("nearby", "光标附近（按上下文长度截取）")
    .setValue(contextScope).onChange((value) => { contextScope = value as WritingContextScope; }));
  container.createEl("p", { text: "默认带入当前整章前后文；作品章节还会带入完整大纲、角色与设定。", cls: "istart-assistant-context" });
  container.createEl("p", { text: "生成量", cls: "istart-field-label" });
  const presets = container.createDiv({ cls: "istart-word-presets" });
  for (const [index, words] of wordPresets.entries()) {
    const label = ["少量", "适中", "较多"][index] ?? "自定义";
    const button = presets.createEl("button", { attr: { type: "button", "aria-label": `${label}，约 ${words} 字`, "data-target-words": String(words), "aria-pressed": String(targetWords === words) } });
    button.createSpan({ text: label });
    button.createSpan({ text: `约 ${words} 字`, cls: "istart-amount-size" });
    buttons.push(button);
    button.addEventListener("click", () => {
      targetWords = words;
      input.value = String(words);
      updatePressed();
    });
  }
  new Setting(container).setName("自定义目标字数（约）").addText((text) => {
    input = text.inputEl;
    input.type = "number";
    input.min = "1";
    input.step = "1";
    input.max = String(MAX_WRITING_TARGET);
    input.inputMode = "numeric";
    input.setAttribute("aria-label", "目标字数");
    text.setValue(String(targetWords)).onChange((value) => {
      targetWords = Number(value);
      updatePressed();
    });
  });
  container.createEl("p", { text: "字数是近似目标，模型会尽量接近；请以预览中的实际生成字数为准。", cls: "istart-assistant-context" });

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
    if (!Number.isInteger(targetWords) || targetWords < 1 || targetWords > MAX_WRITING_TARGET) {
      new Notice(`请输入 1–${MAX_WRITING_TARGET} 的整数目标字数`);
      return null;
    }
    return { targetWords, instruction: instruction.value.trim(), contextScope };
  };
}
