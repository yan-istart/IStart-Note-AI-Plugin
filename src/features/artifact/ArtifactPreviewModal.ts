import { App, Component, MarkdownRenderer, Modal, Setting } from "obsidian";
import { ExecutionArtifact, ArtifactRenderer, ArtifactValidator } from "../../core/artifact";
import type { ValidationResult } from "../../core/artifact/ArtifactValidator";

export type ArtifactSaveChoice = "save-template" | "save-and-run" | "regenerate";

/**
 * Preview modal showing generated artifact items, sources, and inferred items.
 */
export class ArtifactPreviewModal extends Modal {
  private component: Component;
  private validation: ValidationResult;

  constructor(
    app: App,
    private artifact: ExecutionArtifact,
    private onChoice: (choice: ArtifactSaveChoice) => void
  ) {
    super(app);
    this.component = new Component();
    const validator = new ArtifactValidator();
    this.validation = validator.validate(artifact);
  }

  onOpen() {
    const { contentEl } = this;
    this.titleEl.setText(`预览：${this.artifact.title}`);

    // Stats bar
    const { stats } = this.validation;
    const statsEl = contentEl.createDiv({ attr: { style: "display: flex; gap: 16px; margin-bottom: 12px; font-size: 13px; color: var(--text-muted);" } });
    statsEl.createSpan({ text: `条目：${stats.totalItems}` });
    statsEl.createSpan({ text: `有来源：${stats.withSource}` });
    if (stats.inferred > 0) statsEl.createSpan({ text: `AI 推断：${stats.inferred}`, attr: { style: "color: var(--text-warning);" } });
    if (stats.highRisk > 0) statsEl.createSpan({ text: `高关注：${stats.highRisk}`, attr: { style: "color: var(--text-error);" } });

    // File impact notice
    const safeName = this.artifact.title.replace(/[\\/:*?"<>|#[\]]/g, "-").slice(0, 50);
    contentEl.createEl("div", {
      attr: { style: "font-size: 12px; color: var(--text-muted); margin-bottom: 8px; padding: 6px 8px; background: var(--background-secondary); border-radius: 4px;" },
    }).innerHTML = `将创建：<br>• <code>Knowledge/Artifacts/${safeName}.md</code><br>• <code>Knowledge/Artifact Runs/${new Date().toISOString().slice(0, 10)} ${safeName}.md</code>（仅"保存并生成今日记录"时）`;

    // Warnings
    if (this.validation.warnings.length > 0) {
      const warnEl = contentEl.createDiv({ attr: { style: "margin-bottom: 12px;" } });
      for (const w of this.validation.warnings) {
        warnEl.createEl("p", { text: `⚠ ${w}`, attr: { style: "color: var(--text-warning); font-size: 13px; margin: 2px 0;" } });
      }
    }

    // Rendered preview
    const previewEl = contentEl.createDiv({
      attr: { style: "max-height: 50vh; overflow-y: auto; border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 12px; margin-bottom: 16px;" },
    });
    const renderer = new ArtifactRenderer();
    const previewMd = renderer.renderTemplate(this.artifact);
    void MarkdownRenderer.render(this.app, previewMd, previewEl, "", this.component);

    // Actions
    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("保存为模板").setCta().onClick(() => {
          this.close();
          this.onChoice("save-template");
        })
      )
      .addButton((btn) =>
        btn.setButtonText("保存并生成今日记录").onClick(() => {
          this.close();
          this.onChoice("save-and-run");
        })
      )
      .addButton((btn) =>
        btn.setButtonText("重新生成").onClick(() => {
          this.close();
          this.onChoice("regenerate");
        })
      );
  }

  onClose() {
    this.component.unload();
    this.contentEl.empty();
  }
}
