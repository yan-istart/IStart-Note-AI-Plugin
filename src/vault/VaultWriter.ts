import { App, TFile, normalizePath } from "obsidian";
import { DeepSeekResponse, DeepSeekSettings, ContextQAInput, ContextQAResponse } from "../types";
import { SCHEMA_VERSION, todayIso } from "../core/schema";

export class VaultWriter {
  constructor(private app: App, private settings: DeepSeekSettings) {}

  async writeQANote(question: string, response: DeepSeekResponse): Promise<TFile> {
    const date = new Date().toISOString().slice(0, 10);
    const safeTitle = this.sanitizeFilename(question).slice(0, 50);
    const folderPath = normalizePath(this.settings.savePath);

    await this.ensureFolder(folderPath);

    const filePath = await this.uniqueFilePath(folderPath, `${date}-${safeTitle}`);
    const content = this.buildNoteContent(question, response);
    const file = await this.app.vault.create(filePath, content);

    for (const concept of response.concepts) {
      await this.ensureConceptNote(concept);
    }

    return file;
  }

  async writeContextQANote(input: ContextQAInput, response: ContextQAResponse): Promise<TFile> {
    const date = new Date().toISOString().slice(0, 10);
    const safeTitle = this.sanitizeFilename(input.question).slice(0, 50);
    const folderPath = normalizePath(this.settings.savePath);

    await this.ensureFolder(folderPath);

    const filePath = await this.uniqueFilePath(folderPath, `${date}-ctx-${safeTitle}`);
    const content = this.buildContextNoteContent(input, response);
    const file = await this.app.vault.create(filePath, content);

    for (const concept of response.concepts) {
      await this.ensureConceptNote(concept);
    }

    await this.appendBacklink(input.sourceNote, file.path, input.question);

    return file;
  }

  private buildNoteContent(question: string, response: DeepSeekResponse): string {
    const conceptLinks = response.concepts.map((c) => `- [[${c}]]`).join("\n");
    const relationLines = response.relations
      .map((r) => `- [[${r.from}]] -${r.relation}-> [[${r.to}]]`)
      .join("\n");
    const tagLine = response.tags.map((t) => `#${t.replace(/\s+/g, "_")}`).join(" ");

    return `# ${question}

## Question
${question}

## Answer
${response.answer}

## Concepts
${conceptLinks || "- 暂无"}

## Relations
${relationLines || "- 暂无"}

## Tags
${tagLine || "暂无标签"}
`;
  }

  private buildContextNoteContent(input: ContextQAInput, response: ContextQAResponse): string {
    const conceptLinks = response.concepts.map((c) => `- [[${c}]]`).join("\n");
    const relationLines = response.relations
      .map((r) => `- [[${r.from}]] -${r.relation}-> [[${r.to}]]`)
      .join("\n");
    const tagLine = response.tags.map((t) => `#${t.replace(/\s+/g, "_")}`).join(" ");
    const suggestedLines = response.suggested_questions.map((q) => `- ${q}`).join("\n");
    const sourceLink = input.sourceNote ? `[[${input.sourceNote}]]` : "未知来源";

    return `# ${input.question}

## 来源片段
> ${input.context.split("\n").join("\n> ")}

来源：${sourceLink}

## Question
${input.question}

## Answer
${response.answer}

## Concepts
${conceptLinks || "- 暂无"}

## Relations
${relationLines || "- 暂无"}

## 延伸问题
${suggestedLines || "- 暂无"}

## Tags
${tagLine || "暂无标签"}
`;
  }

  private async appendBacklink(sourceNotePath: string, qaFilePath: string, question: string): Promise<void> {
    if (!sourceNotePath) return;
    const sourceFile = this.app.vault.getAbstractFileByPath(sourceNotePath) as TFile | null;
    if (!sourceFile) return;

    const content = await this.app.vault.read(sourceFile);
    const backlinkSection = "## 相关问答";
    const link = `- [[${qaFilePath}|${question}]]`;

    if (content.includes(link)) return;

    if (content.includes(backlinkSection)) {
      await this.app.vault.modify(
        sourceFile,
        content.replace(backlinkSection, `${backlinkSection}\n${link}`)
      );
    } else {
      await this.app.vault.modify(sourceFile, content.trimEnd() + `\n\n${backlinkSection}\n${link}\n`);
    }
  }

  async ensureConceptNote(concept: string): Promise<void> {
    const folderPath = normalizePath(this.settings.conceptsPath || "Knowledge/Concepts");

    // 先检查是否已存在于任何子目录中（可能已被分类）
    const allFiles = this.app.vault.getMarkdownFiles();
    const existingFile = allFiles.find(
      (f) => f.path.startsWith(folderPath) && f.basename === concept
    );
    if (existingFile) return;

    // 新概念放入 _未分类/ 子目录，补全后会自动移动到 domain 目录
    const uncategorizedPath = normalizePath(`${folderPath}/_未分类`);
    await this.ensureFolder(uncategorizedPath);

    const filePath = normalizePath(`${uncategorizedPath}/${concept}.md`);
    const exists = this.app.vault.getAbstractFileByPath(filePath);
    if (!exists) {
      const today = todayIso();
      const content = `---
type: concept
schema_version: ${SCHEMA_VERSION}
name: ${concept}
status: empty
completion_status: pending
created_from: Q&A
created_at: ${today}
---

# ${concept}

## 定义

## 核心解释

## 示例

## 关联概念

## 相关问题

## 来源
`;
      await this.app.vault.create(filePath, content);
    }
  }

  private async ensureFolder(path: string): Promise<void> {
    const exists = this.app.vault.getAbstractFileByPath(path);
    if (!exists) {
      await this.app.vault.createFolder(path);
    }
  }

  /**
   * Resolve a non-conflicting `.md` file path inside `folderPath`.
   * Appends `-2`, `-3`, ... when a file with the same name already exists.
   */
  private async uniqueFilePath(folderPath: string, baseName: string): Promise<string> {
    const safeBase = baseName || "note";
    let candidate = normalizePath(`${folderPath}/${safeBase}.md`);
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = normalizePath(`${folderPath}/${safeBase}-${suffix}.md`);
      suffix++;
    }
    return candidate;
  }

  private sanitizeFilename(name: string): string {
    return name.replace(/[\\/:*?"<>|#[\]]/g, "-").trim();
  }
}
