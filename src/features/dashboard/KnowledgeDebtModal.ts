import { App, Modal, Setting } from "obsidian";
import { KnowledgeIndexService, IndexEntry } from "../../core/knowledge";

export interface DebtStats {
  emptyConcepts: IndexEntry[];
  orphanQuestions: IndexEntry[];   // questions with no parent, no related
  unfinishedReadings: IndexEntry[]; // reading chapters with status != completed
  staleNotes: IndexEntry[];        // notes not modified in >90 days with status=draft
}

/**
 * Knowledge Debt Dashboard — shows what needs attention in the vault.
 */
export class KnowledgeDebtModal extends Modal {
  private stats!: DebtStats;

  constructor(
    app: App,
    private index: KnowledgeIndexService,
    private onAction?: (action: string, entries: IndexEntry[]) => void
  ) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText("📊 知识债务看板");
    this.stats = this.computeStats();
    this.render();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();

    const total =
      this.stats.emptyConcepts.length +
      this.stats.orphanQuestions.length +
      this.stats.unfinishedReadings.length +
      this.stats.staleNotes.length;

    if (total === 0) {
      contentEl.createEl("p", { text: "🎉 你的知识库很健康，没有发现待处理的知识债务。" });
      new Setting(contentEl).addButton((btn) => btn.setButtonText("关闭").onClick(() => this.close()));
      return;
    }

    contentEl.createEl("p", {
      text: `发现 ${total} 项需要关注的知识债务：`,
      attr: { style: "color: var(--text-muted); margin-bottom: 12px;" },
    });

    // ── Empty concepts ──
    this.renderSection(
      contentEl,
      `📝 空概念页 (${this.stats.emptyConcepts.length})`,
      this.stats.emptyConcepts,
      "补全这些概念",
      "complete-concepts"
    );

    // ── Orphan questions ──
    this.renderSection(
      contentEl,
      `❓ 孤立问题 (${this.stats.orphanQuestions.length})`,
      this.stats.orphanQuestions,
      "分类这些问题",
      "classify-questions"
    );

    // ── Unfinished readings ──
    this.renderSection(
      contentEl,
      `📖 未完成阅读章节 (${this.stats.unfinishedReadings.length})`,
      this.stats.unfinishedReadings,
      null,
      null
    );

    // ── Stale drafts ──
    this.renderSection(
      contentEl,
      `🕸 长期未更新草稿 (${this.stats.staleNotes.length})`,
      this.stats.staleNotes,
      null,
      null
    );

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("关闭").onClick(() => this.close())
    );
  }

  private renderSection(
    container: HTMLElement,
    title: string,
    entries: IndexEntry[],
    actionLabel: string | null,
    actionId: string | null
  ) {
    if (entries.length === 0) return;

    const section = container.createDiv({ attr: { style: "margin-bottom: 16px;" } });
    section.createEl("h4", { text: title, attr: { style: "margin: 8px 0 4px 0;" } });

    const list = section.createDiv({
      attr: { style: "max-height: 120px; overflow-y: auto; padding-left: 12px; font-size: 13px;" },
    });
    const shown = entries.slice(0, 15);
    for (const entry of shown) {
      list.createEl("div", {
        text: `• ${entry.basename}${entry.domain ? ` [${entry.domain}]` : ""}`,
        attr: { style: "padding: 1px 0; color: var(--text-normal);" },
      });
    }
    if (entries.length > 15) {
      list.createEl("div", {
        text: `...还有 ${entries.length - 15} 项`,
        attr: { style: "color: var(--text-muted); font-style: italic;" },
      });
    }

    if (actionLabel && actionId && this.onAction) {
      new Setting(section).addButton((btn) =>
        btn.setButtonText(actionLabel).onClick(() => {
          this.close();
          this.onAction!(actionId, entries);
        })
      );
    }
  }

  private computeStats(): DebtStats {
    const now = Date.now();
    const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

    const emptyConcepts = this.index
      .getByType("concept")
      .filter((e) => e.status === "empty" || e.status === "pending");

    const allQuestions = this.index.getByType("question");
    const orphanQuestions = allQuestions.filter((e) => {
      // A question is "orphan" if it has no backlinks and no concepts linked
      return e.backlinks.length === 0 && e.concepts.length === 0;
    });

    // Reading chapters: files in "Reading" path with status != completed
    const unfinishedReadings = [...this.index["entries"].values()].filter((e) => {
      return (
        e.path.includes("Reading/") &&
        e.type !== "domain-index" &&
        e.status !== "completed" &&
        e.headings.some((h) => h.includes("笔记") || h.includes("问题"))
      );
    });

    const staleNotes = [...this.index["entries"].values()].filter((e) => {
      return (
        e.status === "draft" &&
        now - e.mtime > NINETY_DAYS
      );
    });

    return { emptyConcepts, orphanQuestions, unfinishedReadings, staleNotes };
  }

  onClose() {
    this.contentEl.empty();
  }
}
