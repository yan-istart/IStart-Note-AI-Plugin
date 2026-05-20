import { App, TFile, normalizePath, stringifyYaml } from "obsidian";
import { DeepSeekSettings, QuestionClassification } from "../../types";
import { SCHEMA_VERSION, todayIso } from "../../core/schema";

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

    const fm: Record<string, unknown> = {
      type: "question",
      schema_version: SCHEMA_VERSION,
      question,
      category: classification.category,
      parent: classification.parent ?? null,
      related: classification.related,
      concepts,
      created_at: todayIso(),
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

    // 更新问题演化 Mermaid 图
    await this.rebuildQuestionMermaid(indexFile);
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

  /**
   * 重建问题索引页中的 Mermaid 演化图。
   * 从该索引页的链接和对应 Q&A 笔记的 frontmatter 中提取 parent/category 关系。
   */
  private async rebuildQuestionMermaid(indexFile: TFile): Promise<void> {
    const content = await this.app.vault.read(indexFile);

    // 提取所有 [[path|question]] 链接
    const linkRegex = /\[\[(.+?)\|(.+?)\]\]/g;
    const questions: { path: string; title: string; category: string; parent: string | null }[] = [];

    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(content)) !== null) {
      const qPath = match[1];
      const qTitle = match[2];
      const qFile = this.app.vault.getAbstractFileByPath(qPath);
      if (!qFile || !(qFile instanceof TFile)) {
        questions.push({ path: qPath, title: qTitle, category: "new", parent: null });
        continue;
      }
      const meta = this.app.metadataCache.getFileCache(qFile);
      const category = (meta?.frontmatter?.category as string) || "new";
      const parent = (meta?.frontmatter?.parent as string) || null;
      questions.push({ path: qPath, title: qTitle, category, parent });
    }

    if (questions.length < 2) return; // 不够画图

    // 构建 Mermaid 节点和边
    const nodeIds = new Map<string, string>();
    let idCounter = 0;
    const getId = (title: string): string => {
      if (!nodeIds.has(title)) {
        nodeIds.set(title, `Q${idCounter++}`);
      }
      return nodeIds.get(title)!;
    };

    const lines: string[] = [];

    // 先声明所有节点
    for (const q of questions) {
      const id = getId(q.title);
      const shortTitle = q.title.length > 20 ? q.title.slice(0, 20) + "..." : q.title;
      lines.push(`    ${id}["${this.mermaidEscapeStr(shortTitle)}"]`);
    }

    // 画边：有 parent 的画从 parent 到自己的边
    for (const q of questions) {
      if (q.parent) {
        const parentId = getId(q.parent);
        const childId = getId(q.title);
        const label = q.category === "refinement" ? "深化" : q.category === "expansion" ? "扩展" : "";
        if (label) {
          lines.push(`    ${parentId} -->|${label}| ${childId}`);
        } else {
          lines.push(`    ${parentId} --> ${childId}`);
        }
      }
    }

    // 如果没有任何边（全是 new），不生成图
    const hasEdges = questions.some((q) => q.parent);
    if (!hasEdges) return;

    const mermaidBlock = `\n## 问题演化\n\n\`\`\`mermaid\ngraph TD\n${lines.join("\n")}\n\`\`\`\n`;

    // 替换或追加
    const existingMermaid = content.match(/\n## 问题演化\n[\s\S]*?```mermaid[\s\S]*?```\n?/);
    let newContent: string;
    if (existingMermaid) {
      newContent = content.replace(existingMermaid[0], mermaidBlock);
    } else {
      newContent = content.trimEnd() + "\n" + mermaidBlock;
    }

    await this.app.vault.modify(indexFile, newContent);
  }

  private mermaidEscapeStr(text: string): string {
    return text.replace(/[[\](){}|<>#&"]/g, "").trim() || "?";
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
