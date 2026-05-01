import { App, TFile, normalizePath, stringifyYaml } from "obsidian";
import { DeepSeekSettings, QuestionClassification } from "./types";

export interface QuestionMeta {
  file: TFile;
  question: string;
  category: string;
  parent: string | null;
  related: string[];
  concepts: string[];
}

export class QuestionGraphManager {
  constructor(private app: App, private settings: DeepSeekSettings) {}

  /** 读取所有历史问题标题（用于分类时提供上下文） */
  getQuestionHistory(): string[] {
    const folder = normalizePath(this.settings.savePath);
    const files = this.app.vault.getMarkdownFiles()
      .filter((f) => f.path.startsWith(folder))
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, 20);

    const titles: string[] = [];
    for (const f of files) {
      const meta = this.app.metadataCache.getFileCache(f);
      const q = (meta?.frontmatter?.question as string) || f.basename;
      titles.push(q);
    }
    return titles;
  }

  /** 在 Q&A 笔记中写入问题图谱 frontmatter */
  async attachClassification(
    file: TFile,
    question: string,
    classification: QuestionClassification,
    concepts: string[]
  ): Promise<void> {
    const content = await this.app.vault.read(file);
    const today = new Date().toISOString().slice(0, 10);

    const fm: Record<string, unknown> = {
      type: "question",
      question,
      category: classification.category,
      parent: classification.parent ?? null,
      related: classification.related,
      concepts,
      created_at: today,
      status: "linked",
    };

    const fmStr = `---\n${stringifyYaml(fm)}---\n\n`;

    // 如果已有 frontmatter 则替换，否则前置
    const hasFm = content.startsWith("---\n");
    let newContent: string;
    if (hasFm) {
      newContent = fmStr + content.replace(/^---\n[\s\S]*?\n---\n\n?/, "");
    } else {
      newContent = fmStr + content;
    }

    await this.app.vault.modify(file, newContent);
  }

  /** 更新或创建问题索引页 */
  async updateQuestionIndex(
    question: string,
    classification: QuestionClassification,
    qaFilePath: string
  ): Promise<void> {
    const indexFolder = normalizePath(this.settings.questionsIndexPath);
    await this.ensureFolder(indexFolder);

    // 用 parent 或第一个 concept 作为索引页名，新问题用 "新问题" 兜底
    const indexName = classification.parent
      ? this.sanitize(classification.parent).slice(0, 40)
      : "问题索引";
    const indexPath = normalizePath(`${indexFolder}/${indexName}.md`);

    const link = `[[${qaFilePath}|${question}]]`;
    const section = classification.category === "refinement"
      ? "## 深化问题"
      : classification.category === "expansion"
      ? "## 扩展问题"
      : "## 核心问题";

    const existing = this.app.vault.getAbstractFileByPath(indexPath);
    if (!existing) {
      const body = `# ${indexName}\n\n## 核心问题\n\n## 深化问题\n\n## 扩展问题\n`;
      await this.app.vault.create(indexPath, body);
    }

    const indexFile = this.app.vault.getAbstractFileByPath(indexPath);
    if (!indexFile || !(indexFile instanceof TFile)) return;
    let content = await this.app.vault.read(indexFile);

    // 避免重复插入
    if (content.includes(link)) return;

    if (content.includes(section)) {
      content = content.replace(section, `${section}\n- ${link}`);
    } else {
      content += `\n${section}\n- ${link}\n`;
    }

    await this.app.vault.modify(indexFile, content);
  }

  /** 在 Q&A 笔记末尾追加推荐问题区块 */
  async appendRecommendations(
    file: TFile,
    classification: QuestionClassification
  ): Promise<void> {
    if (!classification.refinements.length && !classification.expansions.length) return;

    const content = await this.app.vault.read(file);
    if (content.includes("## 推荐问题")) return;

    const refinementLines = classification.refinements.map((q) => `- ${q}`).join("\n");
    const expansionLines = classification.expansions.map((q) => `- ${q}`).join("\n");

    const block = [
      "\n## 推荐问题",
      classification.refinements.length ? `\n### 深化\n${refinementLines}` : "",
      classification.expansions.length ? `\n### 扩展\n${expansionLines}` : "",
    ].join("\n");

    await this.app.vault.modify(file, content.trimEnd() + "\n" + block + "\n");
  }

  private async ensureFolder(path: string): Promise<void> {
    if (!this.app.vault.getAbstractFileByPath(path)) {
      await this.app.vault.createFolder(path);
    }
  }

  private sanitize(name: string): string {
    return name.replace(/[\\/:*?"<>|#[\]]/g, "-").trim();
  }
}
