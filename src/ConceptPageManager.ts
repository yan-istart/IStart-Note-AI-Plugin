import { App, TFile, parseYaml, stringifyYaml } from "obsidian";
import { ConceptCompletionResult, CompletionDepth } from "./types";

export interface ConceptPageInfo {
  file: TFile;
  conceptName: string;
  isEmpty: boolean;
  existingSections: Set<string>;
  sourceQuestion?: string;
  sourceAnswer?: string;
}

export class ConceptPageManager {
  constructor(private app: App) {}

  /** 判断当前打开的文件是否是待补全的概念页 */
  async analyzeCurrentFile(): Promise<ConceptPageInfo | null> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") return null;
    return this.analyzeFile(file);
  }

  async analyzeFile(file: TFile): Promise<ConceptPageInfo | null> {
    const content = await this.app.vault.read(file);
    const { frontmatter, body } = this.splitFrontmatter(content);

    // 必须是 concept 类型，或者在 Concepts 目录下
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
    const existingSections = this.getExistingSections(body);

    const newSections = this.buildSections(result, existingSections, depth);
    const updatedFrontmatter = this.updateFrontmatter(frontmatter, result);
    const updatedBody = this.mergeSections(body, newSections);

    const newContent = updatedFrontmatter
      ? `---\n${stringifyYaml(updatedFrontmatter)}---\n\n${updatedBody}`
      : updatedBody;

    await this.app.vault.modify(file, newContent);
  }

  buildPreviewMarkdown(result: ConceptCompletionResult, depth: CompletionDepth): string {
    return this.buildSections(result, new Set(), depth);
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
    // 检查 ## 定义 下是否有正文
    const defMatch = body.match(/##\s*定义\s*\n([\s\S]*?)(?=\n##|$)/);
    if (defMatch && defMatch[1].trim().length > 0) return false;
    // 只有标题和空章节
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
      // 检查该 section 是否有内容
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

    return parts.join("\n\n");
  }

  private mergeSections(body: string, newSections: string): string {
    // 把新内容追加到已有 body 末尾（空章节之后）
    const trimmed = body.trimEnd();
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
    };
  }
}
