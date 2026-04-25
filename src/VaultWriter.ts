import { App, TFile, normalizePath } from "obsidian";
import { DeepSeekResponse, DeepSeekSettings, ContextQAInput, ContextQAResponse } from "./types";

export class VaultWriter {
  constructor(private app: App, private settings: DeepSeekSettings) {}

  async writeQANote(question: string, response: DeepSeekResponse): Promise<TFile> {
    const date = new Date().toISOString().slice(0, 10);
    const safeTitle = this.sanitizeFilename(question).slice(0, 50);
    const filename = `${date}-${safeTitle}.md`;
    const folderPath = normalizePath(this.settings.savePath);
    const filePath = normalizePath(`${folderPath}/${filename}`);

    await this.ensureFolder(folderPath);

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
    const filename = `${date}-ctx-${safeTitle}.md`;
    const folderPath = normalizePath(this.settings.savePath);
    const filePath = normalizePath(`${folderPath}/${filename}`);

    await this.ensureFolder(folderPath);

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
    const filePath = normalizePath(`${folderPath}/${concept}.md`);

    await this.ensureFolder(folderPath);

    const exists = this.app.vault.getAbstractFileByPath(filePath);
    if (!exists) {
      const today = new Date().toISOString().slice(0, 10);
      const content = `---
type: concept
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

  private sanitizeFilename(name: string): string {
    return name.replace(/[\\/:*?"<>|#\[\]]/g, "-").trim();
  }
}
