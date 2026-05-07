import { App, TFile, normalizePath, Notice } from "obsidian";
import { ReadingPlan, ChapterSkeleton, ChapterDetail, ChapterSummaryResult, ReadingPlanner } from "../../ai/ReadingPlanner";
import { DeepSeekSettings } from "../../types";

const READING_ROOT = "Knowledge/Reading";

export class ReadingProjectManager {
  constructor(private app: App, private settings: DeepSeekSettings) {}

  /**
   * 创建阅读项目：先建骨架，再逐章生成问题。
   * 支持中断后恢复。
   */
  async createProject(
    plan: ReadingPlan,
    onProgress?: (current: number, total: number, chapter: string) => void
  ): Promise<TFile> {
    const projectFolder = normalizePath(`${READING_ROOT}/${this.sanitize(plan.bookTitle)}`);
    await this.ensureFolder(projectFolder);

    // 1. 创建索引页（骨架）
    const indexFile = await this.createIndexPage(projectFolder, plan);

    // 2. 创建所有章节笔记（空模板，不含问题）
    for (const chapter of plan.chapters) {
      await this.createChapterNote(projectFolder, plan.bookTitle, chapter);
    }

    // 3. 逐章生成预设问题
    const planner = new ReadingPlanner(this.settings);
    let generated = 0;

    for (const chapter of plan.chapters) {
      generated++;
      onProgress?.(generated, plan.chapters.length, chapter.title);

      try {
        const detail = await planner.generateChapterQuestions(plan.bookTitle, chapter);
        await this.writeChapterQuestions(projectFolder, chapter, detail);
      } catch {
        // 单章失败不中断整个流程，后续可以补全
        console.error(`[Reading] Failed to generate questions for chapter ${chapter.number}`);
      }
    }

    // 4. 更新索引页状态
    await this.updateGenerationStatus(indexFile, generated, plan.chapters.length);

    // 5. 预创建核心概念页
    await this.ensureConceptNotes(plan.keyConcepts, plan.bookTitle);

    return indexFile;
  }

  /**
   * 补全阅读项目：扫描缺少预设问题的章节，逐个生成。
   */
  async resumeProject(
    indexFile: TFile,
    onProgress?: (current: number, total: number, chapter: string) => void
  ): Promise<number> {
    const content = await this.app.vault.read(indexFile);
    const meta = this.app.metadataCache.getFileCache(indexFile);
    const fm = meta?.frontmatter;

    if (fm?.type !== "reading-project") {
      throw new Error("当前文件不是阅读项目索引页");
    }

    const bookTitle = (fm.book as string) || "";
    const projectFolder = indexFile.parent?.path ?? "";

    // 扫描所有章节笔记，找出缺少问题的
    const chapterFiles = this.app.vault.getMarkdownFiles().filter(
      (f) => f.path.startsWith(projectFolder) && f.path !== indexFile.path && f.name !== "_总结.md"
    );

    const incomplete: { file: TFile; number: number; title: string; summary: string; concepts: string[] }[] = [];

    for (const file of chapterFiles) {
      const fileMeta = this.app.metadataCache.getFileCache(file);
      const fileFm = fileMeta?.frontmatter;
      if (fileFm?.type !== "reading-note") continue;
      if (fileFm?.questions_generated === true) continue;

      // 读取文件检查是否有预设问题内容
      const fileContent = await this.app.vault.read(file);
      const questionsMatch = fileContent.match(/## 读前问题\n([\s\S]*?)(?=\n## )/);
      const hasQuestions = questionsMatch
        ? questionsMatch[1].split("\n").filter((l) => l.trim().startsWith("- [")).length > 0
        : false;

      if (!hasQuestions) {
        incomplete.push({
          file,
          number: (fileFm?.chapter as number) || 0,
          title: (fileFm?.title as string) || file.basename,
          summary: "",
          concepts: [],
        });
      }
    }

    if (incomplete.length === 0) return 0;

    const planner = new ReadingPlanner(this.settings);
    let done = 0;

    for (const ch of incomplete) {
      done++;
      onProgress?.(done, incomplete.length, ch.title);

      try {
        const skeleton: ChapterSkeleton = {
          number: ch.number,
          title: ch.title,
          summary: ch.summary,
          importance: "recommended",
          keyConcepts: ch.concepts,
        };
        const detail = await planner.generateChapterQuestions(bookTitle, skeleton);

        // 写入问题到章节文件
        let fileContent = await this.app.vault.read(ch.file);
        const questionsLines = detail.questions.map((q) => `- [ ] ${q}`).join("\n");

        if (fileContent.includes("## 读前问题")) {
          fileContent = fileContent.replace(
            /## 读前问题\n[\s\S]*?(?=\n## )/,
            `## 读前问题\n${questionsLines}\n`
          );
        }

        // 更新 frontmatter
        fileContent = fileContent.replace(
          /questions_generated: false/,
          "questions_generated: true"
        );
        if (!fileContent.includes("questions_generated")) {
          fileContent = fileContent.replace("---\n\n", "questions_generated: true\n---\n\n");
        }

        await this.app.vault.modify(ch.file, fileContent);
      } catch {
        console.error(`[Reading] Resume failed for chapter ${ch.number}`);
      }
    }

    // 更新索引页状态
    const totalChapters = chapterFiles.filter((f) => {
      const m = this.app.metadataCache.getFileCache(f);
      return m?.frontmatter?.type === "reading-note";
    }).length;
    await this.updateGenerationStatus(indexFile, totalChapters - (incomplete.length - done), totalChapters);

    return done;
  }

  /** 将章节总结写入章节笔记 */
  async writeChapterSummary(file: TFile, result: ChapterSummaryResult): Promise<void> {
    let content = await this.app.vault.read(file);

    content = content.replace(/status: (unread|reading)/, "status: done");

    const summarySection = `## 章节总结\n\n${result.summary}`;
    if (content.includes("## 章节总结")) {
      content = content.replace(/## 章节总结[\s\S]*?(?=\n## |$)/, summarySection + "\n");
    } else {
      content = content.trimEnd() + "\n\n" + summarySection + "\n";
    }

    if (result.answeredQuestions.length > 0) {
      const qaLines = result.answeredQuestions
        .map((qa) => `**Q: ${qa.question}**\nA: ${qa.answer}`)
        .join("\n\n");
      content = content.trimEnd() + `\n\n## 问题回答\n\n${qaLines}\n`;
    }

    if (result.mermaid) {
      content = content.trimEnd() + `\n\n## 关系图\n\n\`\`\`mermaid\n${result.mermaid}\n\`\`\`\n`;
    }

    if (result.connections.length > 0) {
      content = content.trimEnd() + `\n\n## 跨章关联\n\n${result.connections.map((c) => `- ${c}`).join("\n")}\n`;
    }

    await this.app.vault.modify(file, content);
  }

  // ── 私有方法 ───────────────────────────────────────────────

  private async createIndexPage(folder: string, plan: ReadingPlan): Promise<TFile> {
    const indexPath = normalizePath(`${folder}/_索引.md`);

    const progressLines = plan.chapters.map((ch) => {
      const icon = ch.importance === "core" ? "⭐" : ch.importance === "recommended" ? "📖" : "📄";
      return `- [ ] ${icon} 第${ch.number}章：[[${this.sanitize(ch.title)}|${ch.title}]]`;
    });

    const mermaidLines = plan.chapterRelations.length > 0
      ? `\`\`\`mermaid\ngraph LR\n    ${plan.chapterRelations.join("\n    ")}\n\`\`\``
      : "";

    const conceptLinks = plan.keyConcepts.map((c) => `[[${c}]]`).join(" · ");

    const content = `---
type: reading-project
book: "${plan.bookTitle}"
author: "${plan.author}"
started: ${new Date().toISOString().slice(0, 10)}
status: reading
generation_status: generating
chapters_generated: 0
chapters_total: ${plan.chapters.length}
---

# ${plan.bookTitle}

> ${plan.oneLiner}

**作者：** ${plan.author}

## 读完应能回答

${plan.coreQuestions.map((q) => `- ${q}`).join("\n")}

## 前置知识

${plan.prerequisites.length > 0 ? plan.prerequisites.map((p) => `- ${p}`).join("\n") : "- 无特殊前置要求"}

## 阅读进度

${progressLines.join("\n")}

## 章节关系

${mermaidLines}

## 核心概念

${conceptLinks}
`;

    const existing = this.app.vault.getAbstractFileByPath(indexPath);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
      return existing;
    }
    return await this.app.vault.create(indexPath, content);
  }

  private async createChapterNote(folder: string, bookTitle: string, chapter: ChapterSkeleton): Promise<void> {
    const fileName = this.sanitize(chapter.title);
    const filePath = normalizePath(`${folder}/${fileName}.md`);

    if (this.app.vault.getAbstractFileByPath(filePath)) return;

    const conceptLinks = chapter.keyConcepts.map((c) => `[[${c}]]`).join(" · ");

    const content = `---
type: reading-note
book: "${bookTitle}"
chapter: ${chapter.number}
title: "${chapter.title}"
status: unread
importance: ${chapter.importance}
questions_generated: false
---

# 第${chapter.number}章：${chapter.title}

> ${chapter.summary}

## 读前问题

（生成中...）

## 要点

- 

## 摘抄

> 

## 疑问

- 

## 我的理解



## 关联概念

${conceptLinks}

## 章节总结

`;

    await this.app.vault.create(filePath, content);
  }

  private async writeChapterQuestions(folder: string, chapter: ChapterSkeleton, detail: ChapterDetail): Promise<void> {
    const fileName = this.sanitize(chapter.title);
    const filePath = normalizePath(`${folder}/${fileName}.md`);

    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return;

    let content = await this.app.vault.read(file);

    const questionsLines = detail.questions.map((q) => `- [ ] ${q}`).join("\n");

    // 替换占位文本
    content = content.replace(
      /## 读前问题\n\n（生成中\.\.\.）/,
      `## 读前问题\n\n${questionsLines}`
    );

    // 更新 frontmatter
    content = content.replace("questions_generated: false", "questions_generated: true");

    await this.app.vault.modify(file, content);
  }

  private async updateGenerationStatus(indexFile: TFile, generated: number, total: number): Promise<void> {
    let content = await this.app.vault.read(indexFile);

    const status = generated >= total ? "complete" : "partial";
    content = content.replace(/generation_status: \w+/, `generation_status: ${status}`);
    content = content.replace(/chapters_generated: \d+/, `chapters_generated: ${generated}`);

    await this.app.vault.modify(indexFile, content);
  }

  private async ensureConceptNotes(concepts: string[], bookTitle: string): Promise<void> {
    const conceptsPath = normalizePath(this.settings.conceptsPath || "Knowledge/Concepts");
    const uncategorizedPath = normalizePath(`${conceptsPath}/_未分类`);
    await this.ensureFolder(uncategorizedPath);

    const today = new Date().toISOString().slice(0, 10);

    for (const concept of concepts) {
      const existing = this.app.vault.getMarkdownFiles().find(
        (f) => f.path.startsWith(conceptsPath) && f.basename === concept
      );
      if (existing) continue;

      const filePath = normalizePath(`${uncategorizedPath}/${concept}.md`);
      if (!this.app.vault.getAbstractFileByPath(filePath)) {
        await this.app.vault.create(filePath,
          `---\ntype: concept\nname: ${concept}\nstatus: empty\ncompletion_status: pending\ncreated_from: reading\nsource_book: "${bookTitle}"\ncreated_at: ${today}\n---\n\n# ${concept}\n\n## 定义\n\n## 核心解释\n\n## 示例\n\n## 关联概念\n\n## 相关问题\n\n## 来源\n`
        );
      }
    }
  }

  private async ensureFolder(path: string): Promise<void> {
    if (!this.app.vault.getAbstractFileByPath(path)) {
      await this.app.vault.createFolder(path).catch(() => {});
    }
  }

  private sanitize(name: string): string {
    return name.replace(/[\\/:*?"<>|#[\]]/g, "-").replace(/\s+/g, " ").trim();
  }
}
