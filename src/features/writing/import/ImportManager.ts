import { App, TFile, normalizePath, Notice } from "obsidian";
import { DeepSeekSettings } from "../../../types";
import { WritingProjectManager } from "../WritingProjectManager";
import { WritingPlan, WritingGenre, ChapterOutline } from "../types";
import { SCHEMA_VERSION } from "../../../core/schema";
import { RawChapter, normalizeTitle } from "./ChapterSplitter";
import { ruleSynopsis } from "./TextCleaner";
import { ImportAnalysis } from "./ImportAnalyzer";

export interface ImportPlan {
  title: string;
  genre: WritingGenre;
  chapters: RawChapter[];
  analysis: ImportAnalysis;
}

export interface ImportProgress {
  done: number;
  total: number;
  label: string;
}

/**
 * 原稿导入编排:
 *  切分+清洗后的章节 → 组装 WritingPlan → 复用 WritingProjectManager 落盘。
 *  原稿文件不动,全部复制进 Writing/。
 */
export class ImportManager {
  private manager: WritingProjectManager;
  private cancelled = false;

  constructor(private app: App, settings: DeepSeekSettings) {
    this.manager = new WritingProjectManager(app, settings);
  }

  cancel(): void {
    this.cancelled = true;
  }

  async run(
    plan: ImportPlan,
    onProgress?: (p: ImportProgress) => void
  ): Promise<TFile | null> {
    this.cancelled = false;

    // 0. 按分类拆分:正文 / 资料(大纲、设定、参考)
    const chapters: RawChapter[] = plan.chapters
      .filter((c) => (c.kind ?? "chapter") === "chapter")
      .map((c) => ({
        number: c.number,
        title: normalizeTitle(c.title) || `第${c.number}章`,
        content: c.content,
        kind: "chapter" as const,
      }));
    const materials: RawChapter[] = plan.chapters.filter(
      (c) => c.kind !== undefined && c.kind !== "chapter" && c.kind !== "skip"
    );

    if (chapters.length === 0) {
      new Notice("没有正文章节可导入(请检查第 3 步的分类)");
      return null;
    }

    // 1. 组装 WritingPlan:梗概 = 规则取首段(快速模式)
    const outlines: ChapterOutline[] = chapters.map((c) => ({
      number: c.number,
      title: c.title,
      synopsis: ruleSynopsis(c.content),
    }));
    const writingPlan: WritingPlan = {
      title: plan.title,
      oneLiner: plan.analysis.oneLiner,
      styleProfile: plan.analysis.styleProfile,
      chapters: outlines,
      characters: plan.analysis.characters,
      worldSettings: plan.analysis.worldSettings,
    };

    // 2. 建骨架(大纲 / 作品首页 / 空章节 / 角色 / 设定)
    const indexFile = await this.manager.createProject(writingPlan, plan.genre);
    const folder = indexFile.parent?.path ?? "";

    // 3. 逐章写入正文:已完结章节标 done,最后一章标 draft(续写点)
    const lastBodyNumber = chapters[chapters.length - 1].number;
    const total = chapters.length;
    let done = 0;

    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      const outline = outlines[i];
      if (this.cancelled) {
        new Notice(`导入已取消(已写入 ${done}/${total} 章)`);
        return null;
      }
      done++;
      onProgress?.({ done, total, label: `写入 ${ch.title}` });
      const status = ch.number !== lastBodyNumber ? "done" : "draft";
      await this.manager.writeChapterBody(folder, plan.title, plan.genre, outline, ch.content, status);
    }

    // 4. 写入资料:设定 → _设定/,大纲/参考 → _资料/
    await this.writeMaterials(folder, materials);

    // 5. 章节进度勾选 + 续写点指向最后一章
    await this.markImportedChapters(indexFile, chapters, lastBodyNumber);
    const lastFile = this.app.vault.getAbstractFileByPath(
      normalizePath(this.manager.chapterPath(folder, outlines[outlines.length - 1]))
    );
    if (lastFile instanceof TFile) {
      await this.manager.markCurrentChapter(lastFile, plan.title);
    }

    return indexFile;
  }

  /** 资料落盘:设定类进 _设定/(可参与续写注入),其余进 _资料/ */
  private async writeMaterials(folder: string, materials: RawChapter[]): Promise<void> {
    for (const m of materials) {
      if (this.cancelled) return;
      const isSetting = m.kind === "setting";
      const sub = isSetting ? "_设定" : "_资料";
      const subPath = normalizePath(`${folder}/${sub}`);
      if (!this.app.vault.getAbstractFileByPath(subPath)) {
        await this.app.vault.createFolder(subPath);
      }
      const safeName = m.title.replace(/[\\/:*?"<>|#[\]]/g, "-").trim() || "未命名";
      const filePath = normalizePath(`${subPath}/${safeName}.md`);
      if (this.app.vault.getAbstractFileByPath(filePath)) continue;

      const frontmatter = isSetting
        ? `---
type: setting
schema_version: ${SCHEMA_VERSION}
name: "${m.title.replace(/"/g, "'")}"
category: "导入设定"
---

`
        : `---
type: reference
schema_version: ${SCHEMA_VERSION}
source: "${m.title.replace(/"/g, "'")}"
---

`;

      await this.app.vault.create(filePath, frontmatter + m.content.trim() + "\n");
    }
  }

  /** 作品首页:已导入章节勾选为完成(最后一章留待续写) */
  private async markImportedChapters(indexFile: TFile, chapters: RawChapter[], lastBodyNumber: number): Promise<void> {
    const content = await this.app.vault.read(indexFile);
    let updated = content;
    for (const ch of chapters) {
      if (ch.number === lastBodyNumber) continue;
      const label = `第${ch.number}章`;
      const pattern = new RegExp(`- \\[ \\] ${this.escapeRegex(label)} `, "g");
      updated = updated.replace(pattern, `- [x] ${label} `);
    }
    if (updated !== content) {
      await this.app.vault.modify(indexFile, updated);
    }
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
