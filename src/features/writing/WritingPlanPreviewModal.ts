import { App, Modal, Setting, MarkdownRenderer, Component } from "obsidian";
import { WritingPlan, WritingGenre } from "./types";

const GENRE_LABEL: Record<WritingGenre, string> = {
  novel: "网文小说",
  paper: "论文",
  article: "通用长文",
};

/**
 * 作品规划预览 — 确认后创建项目文件。
 */
export class WritingPlanPreviewModal extends Modal {
  private component = new Component();

  constructor(
    app: App,
    private plan: WritingPlan,
    private genre: WritingGenre,
    private onConfirm: () => void,
    private onRegenerate: () => void
  ) {
    super(app);
    this.titleEl.setText(`作品规划预览：${plan.title}`);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("istart-result-modal");

    const chapterLines = this.plan.chapters
      .slice(0, 20)
      .map((c) => `- 第${c.number}章 ${c.title}：${c.synopsis}`)
      .join("\n");
    const characterLines = this.plan.characters
      .map((c) => `- ${c.name}（${c.role === "protagonist" ? "主角" : c.role === "support" ? "配角" : "反派"}）：${c.summary.slice(0, 80)}`)
      .join("\n");
    const settingLines = this.plan.worldSettings
      .map((w) => `- ${w.name}（${w.category}）`)
      .join("\n");

    const markdown = `**体裁：** ${GENRE_LABEL[this.genre]}

> ${this.plan.oneLiner}

## 文风基调

${this.plan.styleProfile || "（未设定）"}

## 大纲（${this.plan.chapters.length} 章）

${chapterLines}

${characterLines ? `## 角色卡（${this.plan.characters.length}）\n\n${characterLines}\n` : ""}
${settingLines ? `## 世界观设定（${this.plan.worldSettings.length}）\n\n${settingLines}\n` : ""}
`;

    const previewEl = contentEl.createDiv({ cls: "istart-result-preview" });
    void MarkdownRenderer.render(this.app, markdown, previewEl, "", this.component);

    const actionBar = contentEl.createDiv({ cls: "istart-result-actions" });
    new Setting(actionBar)
      .addButton((btn) =>
        btn.setButtonText("创建项目").setCta().onClick(() => { this.close(); this.onConfirm(); })
      )
      .addButton((btn) =>
        btn.setButtonText("重新生成").onClick(() => { this.close(); this.onRegenerate(); })
      )
      .addButton((btn) => btn.setButtonText("关闭").onClick(() => this.close()));
  }

  onClose() {
    this.component.unload();
    this.contentEl.empty();
  }
}
