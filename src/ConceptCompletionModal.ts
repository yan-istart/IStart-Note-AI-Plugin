import { App, Modal, Setting, MarkdownRenderer, Component } from "obsidian";
import { CompletionDepth, ConceptCompletionResult } from "./types";

export class DepthSelectModal extends Modal {
  private depth: CompletionDepth = "standard";
  private onSubmit: (depth: CompletionDepth) => void;

  constructor(app: App, conceptName: string, onSubmit: (depth: CompletionDepth) => void) {
    super(app);
    this.onSubmit = onSubmit;
    this.titleEl.setText(`补全概念：${conceptName}`);
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.createEl("p", {
      text: "选择补全深度：",
      attr: { style: "margin-bottom: 8px; color: var(--text-muted);" },
    });

    new Setting(contentEl)
      .setName("补全深度")
      .setDesc("轻量：定义 + 关联概念 ｜ 标准：定义 + 解释 + 示例 + 关联 + 相关问题")
      .addDropdown((drop) =>
        drop
          .addOption("light", "轻量")
          .addOption("standard", "标准（推荐）")
          .setValue(this.depth)
          .onChange((v: CompletionDepth) => (this.depth = v))
      );

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("开始补全").setCta().onClick(() => {
          this.close();
          this.onSubmit(this.depth);
        })
      )
      .addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class PreviewModal extends Modal {
  private component: Component;

  constructor(
    app: App,
    private conceptName: string,
    private previewMd: string,
    private onConfirm: () => void,
    private onRegenerate: () => void
  ) {
    super(app);
    this.component = new Component();
  }

  onOpen() {
    const { contentEl } = this;
    this.titleEl.setText(`预览：${this.conceptName}`);

    const previewEl = contentEl.createDiv({ attr: { style: "max-height: 60vh; overflow-y: auto; border: 1px solid var(--background-modifier-border); border-radius: 4px; padding: 12px; margin-bottom: 16px;" } });

    MarkdownRenderer.render(this.app, this.previewMd, previewEl, "", this.component);

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("写入概念页").setCta().onClick(() => {
          this.close();
          this.onConfirm();
        })
      )
      .addButton((btn) =>
        btn.setButtonText("重新生成").onClick(() => {
          this.close();
          this.onRegenerate();
        })
      )
      .addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));
  }

  onClose() {
    this.component.unload();
    this.contentEl.empty();
  }
}

export class BatchScanModal extends Modal {
  private selected = new Set<string>();

  constructor(
    app: App,
    private concepts: { name: string; path: string }[],
    private onConfirm: (selected: string[], depth: CompletionDepth) => void
  ) {
    super(app);
    this.titleEl.setText(`扫描到 ${concepts.length} 个空概念页`);
  }

  onOpen() {
    const { contentEl } = this;
    let depth: CompletionDepth = "standard";

    if (this.concepts.length === 0) {
      contentEl.createEl("p", { text: "没有找到待补全的概念页。" });
      new Setting(contentEl).addButton((btn) => btn.setButtonText("关闭").onClick(() => this.close()));
      return;
    }

    contentEl.createEl("p", {
      text: "选择要补全的概念（最多 5 个）：",
      attr: { style: "color: var(--text-muted); margin-bottom: 8px;" },
    });

    const listEl = contentEl.createDiv({ attr: { style: "max-height: 40vh; overflow-y: auto; margin-bottom: 12px;" } });

    for (const c of this.concepts) {
      const row = listEl.createDiv({ attr: { style: "display: flex; align-items: center; gap: 8px; padding: 4px 0;" } });
      const cb = row.createEl("input", { type: "checkbox" });
      row.createEl("span", { text: c.name });

      cb.addEventListener("change", () => {
        if (cb.checked) {
          if (this.selected.size >= 5) {
            cb.checked = false;
            return;
          }
          this.selected.add(c.path);
        } else {
          this.selected.delete(c.path);
        }
      });
    }

    new Setting(contentEl)
      .setName("补全深度")
      .addDropdown((drop) =>
        drop
          .addOption("light", "轻量")
          .addOption("standard", "标准（推荐）")
          .setValue(depth)
          .onChange((v: CompletionDepth) => (depth = v))
      );

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("补全选中").setCta().onClick(() => {
          if (this.selected.size === 0) return;
          this.close();
          this.onConfirm([...this.selected], depth);
        })
      )
      .addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));
  }

  onClose() {
    this.contentEl.empty();
  }
}
