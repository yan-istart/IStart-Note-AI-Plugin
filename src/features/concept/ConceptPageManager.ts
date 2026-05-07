import { App, TFile, parseYaml, stringifyYaml, normalizePath } from "obsidian";
import { ConceptCompletionResult, CompletionDepth, DeepSeekSettings } from "../../types";

export interface ConceptPageInfo {
  file: TFile;
  conceptName: string;
  isEmpty: boolean;
  existingSections: Set<string>;
  sourceQuestion?: string;
  sourceAnswer?: string;
}

export class ConceptPageManager {
  constructor(private app: App, private settings?: DeepSeekSettings) {}

  /** 判断当前打开的文件是否是待补全的概念页 */
  async analyzeCurrentFile(): Promise<ConceptPageInfo | null> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") return null;
    return this.analyzeFile(file);
  }

  async analyzeFile(file: TFile): Promise<ConceptPageInfo | null> {
    const content = await this.app.vault.read(file);
    const { frontmatter, body } = this.splitFrontmatter(content);

    const isConceptType = frontmatter?.type === "concept";
    const isInConceptsFolder = file.path.includes("Concepts/");
    if (!isConceptType && !isInConceptsFolder) return null;

    const isEmpty = this.checkIsEmpty(frontmatter, body);
    const existingSections = this.getExistingSections(body);
    const fm = frontmatter as Record<string, string> | null;
    const conceptName = fm?.name || file.basename;

    return {
      file,
      conceptName,
      isEmpty,
      existingSections,
      sourceQuestion: fm?.source_question,
      sourceAnswer: fm?.source_answer,
    };
  }

  /** 扫描 Vault 中所有空概念页 */
  async scanEmptyConcepts(): Promise<ConceptPageInfo[]> {
    const files = this.app.vault.getMarkdownFiles();
    const results: ConceptPageInfo[] = [];

    for (const file of files) {
      const info = await this.analyzeFile(file);
      if (info && info.isEmpty) {
        results.push(info);
      }
    }
    return results;
  }

  /** 将补全结果写入概念页（增量，不覆盖已有内容） */
  async writeCompletion(
    file: TFile,
    result: ConceptCompletionResult,
    depth: CompletionDepth
  ): Promise<void> {
    const content = await this.app.vault.read(file);
    const { frontmatter, body } = this.splitFrontmatter(content);

    // 先清除空占位标题，再判断哪些 section 已有内容
    const cleanedBody = this.removeEmptySections(body);
    const existingSections = this.getExistingSections(cleanedBody);

    const newSections = this.buildSections(result, existingSections, depth);
    const updatedFrontmatter = this.updateFrontmatter(frontmatter, result);

    // 合并：cleanedBody 只保留顶级标题和有内容的 section，新内容追加
    const updatedBody = this.mergeSections(cleanedBody, newSections);

    const newContent = updatedFrontmatter
      ? `---\n${stringifyYaml(updatedFrontmatter)}---\n\n${updatedBody}`
      : updatedBody;

    await this.app.vault.modify(file, newContent);

    // 为关联概念预创建空概念页
    await this.ensureRelatedConceptNotes(result.related_concepts.map((c) => c.name));

    // 更新 domain MOC 索引 + 移动文件到 domain 子目录
    if (result.domain) {
      const conceptName = (frontmatter?.name as string) || file.basename;
      const movedFile = await this.moveTodomainFolder(file, result.domain);
      await this.updateDomainIndex(result.domain, conceptName, movedFile.path);
    }
  }

  buildPreviewMarkdown(result: ConceptCompletionResult, depth: CompletionDepth): string {
    return this.buildSections(result, new Set(), depth);
  }

  // ── 空占位清除 ──────────────────────────────────────────────

  /**
   * 移除 body 中所有"只有标题没有正文内容"的 section。
   * 保留有实际内容的 section 和顶级标题（# xxx）。
   */
  private removeEmptySections(body: string): string {
    const lines = body.split("\n");
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // 检测 ## 标题行
      if (/^##\s+/.test(line)) {
        // 收集该 section 的内容（直到下一个 ## 或文件末尾）
        const sectionLines: string[] = [line];
        let j = i + 1;
        while (j < lines.length && !/^##\s+/.test(lines[j])) {
          sectionLines.push(lines[j]);
          j++;
        }

        // 判断 section 是否有实际内容（非空行）
        const contentLines = sectionLines.slice(1).filter((l) => l.trim().length > 0);
        if (contentLines.length > 0) {
          // 有内容，保留
          result.push(...sectionLines);
        }
        // 没内容则跳过（不加入 result）

        i = j;
      } else {
        result.push(line);
        i++;
      }
    }

    return result.join("\n");
  }

  // ── Domain MOC 索引 ─────────────────────────────────────────

  /**
   * 维护 domain 索引页：{domain}/_索引.md
   * 包含概念列表和 Mermaid 概览图。
   */
  private async updateDomainIndex(domain: string, conceptName: string, conceptPath: string): Promise<void> {
    const folderPath = normalizePath(this.settings?.conceptsPath ?? "Knowledge/Concepts");
    const domainFolder = normalizePath(`${folderPath}/${this.sanitize(domain)}`);
    const indexPath = normalizePath(`${domainFolder}/_索引.md`);

    const link = `- [[${conceptName}]]`;

    const existing = this.app.vault.getAbstractFileByPath(indexPath);
    if (!existing) {
      // 确保目录存在
      if (!this.app.vault.getAbstractFileByPath(domainFolder)) {
        await this.app.vault.createFolder(domainFolder);
      }
      const content = `---\ntype: domain-index\ndomain: ${domain}\n---\n\n# ${domain}\n\n${link}\n`;
      await this.app.vault.create(indexPath, content);
      return;
    }

    if (!(existing instanceof TFile)) return;

    const content = await this.app.vault.read(existing);

    // 避免重复
    if (content.includes(`[[${conceptName}]]`)) return;

    // 在 Mermaid 块之前插入链接（如果有 Mermaid 块的话），否则追加到末尾
    const mermaidIdx = content.indexOf("```mermaid");
    if (mermaidIdx > 0) {
      const before = content.slice(0, mermaidIdx).trimEnd();
      const after = content.slice(mermaidIdx);
      await this.app.vault.modify(existing, `${before}\n${link}\n\n${after}`);
    } else {
      await this.app.vault.modify(existing, content.trimEnd() + `\n${link}\n`);
    }
  }

  /**
   * 重新生成某个 domain 索引页的 Mermaid 概览图。
   * 聚合该 domain 下所有概念的 relations。
   */
  async rebuildDomainMermaid(domain: string): Promise<void> {
    const folderPath = normalizePath(this.settings?.conceptsPath ?? "Knowledge/Concepts");
    const domainFolder = normalizePath(`${folderPath}/${this.sanitize(domain)}`);
    const indexPath = normalizePath(`${domainFolder}/_索引.md`);

    const indexFile = this.app.vault.getAbstractFileByPath(indexPath);
    if (!indexFile || !(indexFile instanceof TFile)) return;

    // 收集该 domain 下所有概念的关系
    const relations: { from: string; relation: string; to: string }[] = [];
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(domainFolder) && f.name !== "_索引.md");

    for (const f of files) {
      const content = await this.app.vault.read(f);
      // 从"关联概念"section 提取关系
      const sectionMatch = content.match(/## 关联概念\n([\s\S]*?)(?=\n##|$)/);
      if (!sectionMatch) continue;
      const conceptName = f.basename;
      const lines = sectionMatch[1].split("\n").filter((l) => l.startsWith("- [["));
      for (const line of lines) {
        const m = line.match(/- \[\[(.+?)\]\]：(.+)/);
        if (m) {
          relations.push({ from: conceptName, relation: m[2].split("（")[0].trim(), to: m[1] });
        }
      }
    }

    if (relations.length === 0) return;

    // 生成 Mermaid
    const mermaidLines = relations.map((r) => {
      return `    ${this.mermaidEscape(r.from)} -->|${this.mermaidEscape(r.relation)}| ${this.mermaidEscape(r.to)}`;
    });
    const mermaidBlock = `\n## 领域概览\n\n\`\`\`mermaid\ngraph TD\n${mermaidLines.join("\n")}\n\`\`\`\n`;

    // 替换或追加 Mermaid 块
    let content = await this.app.vault.read(indexFile);
    const existingMermaid = content.match(/\n## 领域概览\n[\s\S]*?```mermaid[\s\S]*?```\n?/);
    if (existingMermaid) {
      content = content.replace(existingMermaid[0], mermaidBlock);
    } else {
      content = content.trimEnd() + "\n" + mermaidBlock;
    }

    await this.app.vault.modify(indexFile, content);
  }

  // ── private helpers ──────────────────────────────────────────

  private splitFrontmatter(content: string): { frontmatter: Record<string, unknown> | null; body: string } {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) return { frontmatter: null, body: content };
    try {
      return { frontmatter: parseYaml(match[1]) as Record<string, unknown>, body: match[2].trimStart() };
    } catch {
      return { frontmatter: null, body: content };
    }
  }

  private checkIsEmpty(frontmatter: Record<string, unknown> | null, body: string): boolean {
    if (frontmatter?.status === "empty" || frontmatter?.completion_status === "pending") return true;
    const defMatch = body.match(/##\s*定义\s*\n([\s\S]*?)(?=\n##|$)/);
    if (defMatch && defMatch[1].trim().length > 0) return false;
    const nonEmptyLines = body
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"))
      .length;
    return nonEmptyLines === 0;
  }

  private getExistingSections(body: string): Set<string> {
    const sections = new Set<string>();
    const matches = body.matchAll(/^##\s+(.+)/gm);
    for (const m of matches) {
      const heading = m[1].trim();
      const sectionContent = body
        .slice(body.indexOf(m[0]) + m[0].length)
        .split(/^##\s/m)[0]
        .trim();
      if (sectionContent.length > 0) sections.add(heading);
    }
    return sections;
  }

  private buildSections(
    result: ConceptCompletionResult,
    existing: Set<string>,
    depth: CompletionDepth
  ): string {
    const parts: string[] = [];

    if (!existing.has("定义") && result.definition) {
      parts.push(`## 定义\n${result.definition}`);
    }
    if (depth === "standard") {
      if (!existing.has("核心解释") && result.explanation) {
        parts.push(`## 核心解释\n${result.explanation}`);
      }
      if (!existing.has("示例") && result.examples.length > 0) {
        parts.push(`## 示例\n${result.examples.map((e) => `- ${e}`).join("\n")}`);
      }
    }
    if (!existing.has("关联概念") && result.related_concepts.length > 0) {
      const lines = result.related_concepts
        .map((c) => `- [[${c.name}]]：${c.description}`)
        .join("\n");
      parts.push(`## 关联概念\n${lines}`);
    }
    if (depth === "standard" && !existing.has("相关问题") && result.related_questions.length > 0) {
      parts.push(`## 相关问题\n${result.related_questions.map((q) => `- ${q}`).join("\n")}`);
    }

    // Mermaid 关系图
    if (!existing.has("关系图") && result.related_concepts.length > 0) {
      const conceptName = result.definition ? result.definition.split("，")[0].split("。")[0].slice(0, 10) : "本概念";
      const mermaidLines = result.related_concepts.map((c) => {
        const safeFrom = this.mermaidEscape(conceptName);
        const safeTo = this.mermaidEscape(c.name);
        const safeRel = this.mermaidEscape(c.relation);
        return `    ${safeFrom} -->|${safeRel}| ${safeTo}`;
      });
      parts.push(`## 关系图\n\n\`\`\`mermaid\ngraph LR\n${mermaidLines.join("\n")}\n\`\`\``);
    }

    return parts.join("\n\n");
  }

  private mergeSections(body: string, newSections: string): string {
    const trimmed = body.trimEnd();
    // 如果 body 只剩顶级标题（# xxx），直接在后面追加
    return trimmed + (trimmed ? "\n\n" : "") + newSections + "\n";
  }

  private updateFrontmatter(
    fm: Record<string, unknown> | null,
    result: ConceptCompletionResult
  ): Record<string, unknown> | null {
    if (!fm) return null;
    const today = new Date().toISOString().slice(0, 10);
    return {
      ...fm,
      status: "completed",
      completion_status: "completed",
      updated_at: today,
      ...(result.tags.length > 0 ? { tags: result.tags } : {}),
      ...(result.domain ? { domain: result.domain } : {}),
    };
  }

  private async ensureRelatedConceptNotes(concepts: string[]): Promise<void> {
    const folderPath = normalizePath(
      this.settings?.conceptsPath ?? "Knowledge/Concepts"
    );
    const uncategorizedPath = normalizePath(`${folderPath}/_未分类`);

    // 确保 _未分类 目录存在
    if (!this.app.vault.getAbstractFileByPath(uncategorizedPath)) {
      if (!this.app.vault.getAbstractFileByPath(folderPath)) {
        await this.app.vault.createFolder(folderPath);
      }
      await this.app.vault.createFolder(uncategorizedPath);
    }

    const today = new Date().toISOString().slice(0, 10);

    for (const concept of concepts) {
      // 检查是否已存在于任何子目录
      const allFiles = this.app.vault.getMarkdownFiles();
      const existing = allFiles.find(
        (f) => f.path.startsWith(folderPath) && f.basename === concept
      );
      if (existing) continue;

      const filePath = normalizePath(`${uncategorizedPath}/${concept}.md`);
      if (!this.app.vault.getAbstractFileByPath(filePath)) {
        await this.app.vault.create(
          filePath,
          `---\ntype: concept\nname: ${concept}\nstatus: empty\ncompletion_status: pending\ncreated_from: concept-completion\ncreated_at: ${today}\n---\n\n# ${concept}\n\n## 定义\n\n## 核心解释\n\n## 示例\n\n## 关联概念\n\n## 相关问题\n\n## 来源\n`
        );
      }
    }
  }

  private sanitize(name: string): string {
    return name.replace(/[\\/:*?"<>|#[\]]/g, "-").trim();
  }

  /** Escape special characters for Mermaid node/edge labels */
  private mermaidEscape(text: string): string {
    // Mermaid doesn't allow certain chars in node IDs; use quotes for labels
    return text.replace(/[[\](){}|<>#&]/g, "").replace(/"/g, "'").trim() || "?";
  }

  /**
   * 补全后将概念页移动到对应 domain 子目录。
   * 使用 Obsidian 的 rename API，会自动更新所有引用。
   */
  async moveTodomainFolder(file: TFile, domain: string): Promise<TFile> {
    const folderPath = normalizePath(this.settings?.conceptsPath ?? "Knowledge/Concepts");
    const domainFolder = normalizePath(`${folderPath}/${this.sanitize(domain)}`);
    const targetPath = normalizePath(`${domainFolder}/${file.name}`);

    // 如果已经在目标位置，不移动
    if (file.path === targetPath) return file;

    // 确保 domain 子目录存在
    if (!this.app.vault.getAbstractFileByPath(domainFolder)) {
      await this.app.vault.createFolder(domainFolder);
    }

    // 如果目标已存在同名文件，不移动（避免覆盖）
    if (this.app.vault.getAbstractFileByPath(targetPath)) return file;

    // 移动文件（Obsidian 会自动更新所有双链引用）
    await this.app.vault.rename(file, targetPath);

    // 返回移动后的文件引用
    const moved = this.app.vault.getAbstractFileByPath(targetPath);
    return (moved instanceof TFile) ? moved : file;
  }
}
