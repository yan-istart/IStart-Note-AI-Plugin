import { App, TFile, normalizePath } from "obsidian";
import { DeepSeekResponse, DeepSeekSettings } from "./types";

export class VaultWriter {
  constructor(private app: App, private settings: DeepSeekSettings) {}

  async writeQANote(question: string, response: DeepSeekResponse): Promise<TFile> {
    const date = new Date().toISOString().slice(0, 10);
    const safeTitle = this.sanitizeFilename(question).slice(0, 50);
    const filename = `${date}-${safeTitle}.md`;
    const folderPath = normalizePath(this.settings.savePath);
    const filePath = normalizePath(`${folderPath}/${filename}`);

    // 确保目录存在
    await this.ensureFolder(folderPath);

    const content = this.buildNoteContent(question, response);
    const file = await this.app.vault.create(filePath, content);

    // 自动创建概念页（V2 功能）
    for (const concept of response.concepts) {
      await this.ensureConceptNote(concept);
    }

    return file;
  }

  private buildNoteContent(question: string, response: DeepSeekResponse): string {
    const conceptLinks = response.concepts
      .map((c) => `- [[${c}]]`)
      .join("\n");

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
