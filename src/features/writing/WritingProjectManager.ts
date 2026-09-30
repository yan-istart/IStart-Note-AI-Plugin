import { App, TFile, normalizePath } from "obsidian";
import { DeepSeekSettings } from "../../types";
import { SCHEMA_VERSION, todayIso } from "../../core/schema";
import { WritingPlan, WritingGenre, WritingContext, ChapterOutline, CharacterCard, WorldSetting } from "./types";

const GENRE_LABEL: Record<WritingGenre, string> = {
  novel: "网文小说",
  paper: "论文",
  article: "通用长文",
};

const GENRE_FOLDER: Record<WritingGenre, string> = {
  novel: "Novels",
  paper: "Papers",
  article: "Articles",
};

/**
 * 写作项目管理 — 负责把 WritingPlan 落盘为作品目录结构。
 */
export class WritingProjectManager {
  constructor(private app: App, private settings: DeepSeekSettings) {}

  async createProject(plan: WritingPlan, genre: WritingGenre): Promise<TFile> {
    const root = normalizePath(this.settings.writingPath || "Writing");
    const projectFolder = normalizePath(`${root}/${GENRE_FOLDER[genre]}/${this.sanitize(plan.title)}`);
    await this.ensureFolder(projectFolder);

    const today = todayIso();

    // 1. 大纲
    await this.createOutline(projectFolder, plan, genre);

    // 2. 章节文件(空模板,含 synopsis)
    for (const ch of plan.chapters) {
      await this.createChapterNote(projectFolder, plan.title, genre, ch);
    }

    // 3. 角色卡 / 世界观(仅小说)
    if (genre === "novel") {
      for (const c of plan.characters) {
        await this.createCharacterNote(projectFolder, c);
      }
      for (const w of plan.worldSettings) {
        await this.createSettingNote(projectFolder, w);
      }
    }

    // 4. 作品首页(最后写,避免元数据被后续修改干扰)
    const indexFile = await this.createProjectIndex(projectFolder, plan, genre, today);
    return indexFile;
  }

  // ── 文件生成 ───────────────────────────────────────────────

  private async createOutline(folder: string, plan: WritingPlan, genre: WritingGenre): Promise<TFile> {
    const lines = plan.chapters.map((ch) => {
      const fileName = this.chapterFileName(ch);
      return `## 第${ch.number}章：${ch.title}\n\n> ${ch.synopsis}\n\n章节文件：[[${fileName}|${ch.title}]]\n`;
    });

    const content = `---
type: outline
schema_version: ${SCHEMA_VERSION}
genre: ${genre}
project: "${plan.title}"
status: active
updated_at: ${todayIso()}
---

# ${plan.title} · 大纲

${plan.oneLiner ? `> ${plan.oneLiner}\n` : ""}
${lines.join("\n")}
`;

    return this.createOrReplace(normalizePath(`${folder}/_大纲.md`), content);
  }

  private async createChapterNote(
    folder: string,
    bookTitle: string,
    genre: WritingGenre,
    ch: ChapterOutline
  ): Promise<void> {
    const filePath = normalizePath(`${folder}/${this.chapterFileName(ch)}.md`);
    if (this.app.vault.getAbstractFileByPath(filePath)) return;

    const content = `---
type: chapter
schema_version: ${SCHEMA_VERSION}
genre: ${genre}
project: "${bookTitle}"
number: ${ch.number}
title: "${ch.title}"
synopsis: "${ch.synopsis.replace(/"/g, "'")}"
status: draft
word_target: ${genre === "paper" ? 1500 : 3000}
---

# 第${ch.number}章：${ch.title}

> 本章梗概：${ch.synopsis}

`;
    await this.app.vault.create(filePath, content);
  }

  private async createCharacterNote(folder: string, c: { name: string; role: string; summary: string }): Promise<void> {
    await this.ensureFolder(normalizePath(`${folder}/_角色`));
    const filePath = normalizePath(`${folder}/_角色/${this.sanitize(c.name)}.md`);
    if (this.app.vault.getAbstractFileByPath(filePath)) return;

    const roleLabel = c.role === "protagonist" ? "主角" : c.role === "support" ? "配角" : "反派";
    const content = `---
type: character
schema_version: ${SCHEMA_VERSION}
name: "${c.name}"
role: ${c.role}
created_at: ${todayIso()}
---

# ${c.name}

> 定位：${roleLabel}

## 角色概要

${c.summary}

## 关键台词 / 名场面

- 

## 与其他角色的关系

- 
`;
    await this.app.vault.create(filePath, content);
  }

  private async createSettingNote(folder: string, w: { category: string; name: string; content: string }): Promise<void> {
    await this.ensureFolder(normalizePath(`${folder}/_设定`));
    const filePath = normalizePath(`${folder}/_设定/${this.sanitize(w.name)}.md`);
    if (this.app.vault.getAbstractFileByPath(filePath)) return;

    const content = `---
type: setting
schema_version: ${SCHEMA_VERSION}
name: "${w.name}"
category: "${w.category}"
created_at: ${todayIso()}
---

# ${w.name}

> 类别：${w.category}

${w.content}

## 相关设定

- 
`;
    await this.app.vault.create(filePath, content);
  }

  private async createProjectIndex(
    folder: string,
    plan: WritingPlan,
    genre: WritingGenre,
    today: string
  ): Promise<TFile> {
    const chapterLinks = plan.chapters
      .map((ch) => {
        const fileName = this.chapterFileName(ch);
        return `- [ ] 第${ch.number}章 [[${fileName}|${ch.title}]]：${ch.synopsis}`;
      })
      .join("\n");

    const novelSections =
      genre === "novel"
        ? `\n## 角色\n\n${plan.characters.map((c) => `- [[_角色/${this.sanitize(c.name)}|${c.name}]]（${c.role === "protagonist" ? "主角" : c.role === "support" ? "配角" : "反派"}）`).join("\n")}
\n## 世界观设定\n\n${plan.worldSettings.map((w) => `- [[_设定/${this.sanitize(w.name)}|${w.name}]]（${w.category}）`).join("\n")}`
        : "";

    const content = `---
type: writing-project
schema_version: ${SCHEMA_VERSION}
genre: ${genre}
title: "${plan.title}"
one_liner: "${(plan.oneLiner || "").replace(/"/g, "'")}"
status: writing
style_profile: "${(plan.styleProfile || "").replace(/"/g, "'")}"
current_chapter: ${plan.chapters[0] ? `"[[${this.chapterFileName(plan.chapters[0])}]]"` : '""'}
created_at: ${today}
updated_at: ${today}
---

# ${plan.title}

> ${plan.oneLiner}

**体裁：** ${GENRE_LABEL[genre]}

## 文风基调

${plan.styleProfile || "（未设定）"}

## 章节进度

${chapterLinks}
${novelSections}
`;
    return this.createOrReplace(normalizePath(`${folder}/_作品.md`), content);
  }

  // ── 上下文读取 ─────────────────────────────────────────────

  /**
   * 读取章节文件所属作品的完整写作上下文。
   * 章节必须位于作品目录下(父目录含 _作品.md)。
   */
  async loadContext(chapterFile: TFile): Promise<WritingContext | null> {
    const folder = chapterFile.parent?.path ?? "";
    const meta = this.app.metadataCache.getFileCache(chapterFile);
    const fm = meta?.frontmatter;
    if (fm?.type !== "chapter") return null;

    const projectMeta = this.app.metadataCache.getFileCache(
      this.app.vault.getAbstractFileByPath(normalizePath(`${folder}/_作品.md`)) as TFile
    )?.frontmatter;

    // 大纲中的前后章梗概
    const outlineFile = this.app.vault.getAbstractFileByPath(normalizePath(`${folder}/_大纲.md`));
    const synopses = outlineFile instanceof TFile
      ? this.parseOutlineSynopses(await this.app.vault.read(outlineFile))
      : [];

    const chapterNumber = Number(fm.number) || 0;
    const current = synopses.find((s) => s.number === chapterNumber);
    const prev = synopses.filter((s) => s.number < chapterNumber).pop();
    const next = synopses.find((s) => s.number > chapterNumber);

    const characters = await this.readCards<CharacterCard>(normalizePath(`${folder}/_角色`));
    const worldSettings = await this.readCards<WorldSetting>(normalizePath(`${folder}/_设定`));

    return {
      projectTitle: (projectMeta?.title as string) || fm.project || chapterFile.basename,
      oneLiner: (projectMeta?.one_liner as string) || "",
      styleProfile: (projectMeta?.style_profile as string) || "",
      genre: (fm.genre as WritingGenre) || "article",
      chapterNumber,
      chapterTitle: (fm.title as string) || chapterFile.basename,
      chapterSynopsis: (fm.synopsis as string) || current?.synopsis || "",
      prevSynopsis: prev?.synopsis ?? "",
      nextSynopsis: next?.synopsis ?? "",
      characters,
      worldSettings,
    };
  }

  /** 更新作品首页的 current_chapter 与 updated_at */
  async markCurrentChapter(chapterFile: TFile, projectTitle: string): Promise<void> {
    const folder = chapterFile.parent?.path ?? "";
    const indexFile = this.app.vault.getAbstractFileByPath(normalizePath(`${folder}/_作品.md`));
    if (!(indexFile instanceof TFile)) return;

    const content = await this.app.vault.read(indexFile);
    const updated = content
      .replace(/current_chapter:.*\n/, `current_chapter: "[[${chapterFile.basename}]]"\n`)
      .replace(/updated_at:.*\n/, `updated_at: ${todayIso()}\n`);
    await this.app.vault.modify(indexFile, updated);
  }

  /** 读取章节文件所属项目的所有角色卡 */
  async getProjectCharacters(chapterFile: TFile): Promise<{ path: string; name: string }[]> {
    const folder = chapterFile.parent?.path ?? "";
    return this.listCardFiles(normalizePath(`${folder}/_角色`));
  }

  /** 写入角色卡(新建或追加) */
  async writeCharacter(chapterFile: TFile, card: { name: string; role: string; summary: string }): Promise<TFile> {
    const folder = chapterFile.parent?.path ?? "";
    await this.ensureFolder(normalizePath(`${folder}/_角色`));
    const filePath = normalizePath(`${folder}/_角色/${this.sanitize(card.name)}.md`);

    const existing = this.app.vault.getAbstractFileByPath(filePath);
    if (existing instanceof TFile) {
      const old = await this.app.vault.read(existing);
      await this.app.vault.modify(existing, old.trimEnd() + `\n\n## 补充（AI 提取）\n\n${card.summary}\n`);
      return existing;
    }

    const content = `---
type: character
schema_version: ${SCHEMA_VERSION}
name: "${card.name}"
role: ${card.role}
created_at: ${todayIso()}
---

# ${card.name}

> 定位：${card.role}

## 角色概要

${card.summary}

## 关键台词 / 名场面

- 

## 与其他角色的关系

- 
`;
    return await this.app.vault.create(filePath, content);
  }

  /** 在章节文件末尾追加正文,并标记状态 */
  async appendChapterText(file: TFile, text: string): Promise<void> {
    const content = await this.app.vault.read(file);
    await this.app.vault.modify(file, content.trimEnd() + "\n\n" + text.trim() + "\n");
  }

  /** 用新章节梗概创建章节文件 */
  async createChapterNoteFromOutline(
    folder: string,
    projectTitle: string,
    genre: WritingGenre,
    ch: ChapterOutline
  ): Promise<TFile> {
    await this.createChapterNote(folder, projectTitle, genre, ch);
    const path = normalizePath(`${folder}/${this.chapterFileName(ch)}.md`);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`章节文件创建失败：${path}`);
    return file;
  }

  /** 读取大纲,返回编号大于 currentNumber 的下一章 */
  getNextChapter(outlineContent: string, currentNumber: number): ChapterOutline | null {
    const chapters = this.parseOutline(outlineContent);
    return chapters.find((c) => c.number > currentNumber) ?? null;
  }

  // ── 私有工具 ───────────────────────────────────────────────

  private parseOutlineSynopses(outlineContent: string): { number: number; synopsis: string }[] {
    return this.parseOutline(outlineContent).map((c) => ({ number: c.number, synopsis: c.synopsis }));
  }

  private parseOutline(outlineContent: string): ChapterOutline[] {
    const result: ChapterOutline[] = [];
    const sections = outlineContent.split(/^## /m).slice(1);
    for (const section of sections) {
      const headMatch = section.match(/^第(\d+)章[：:]\s*(.+)/);
      const synMatch = section.match(/>\s*(.+)/);
      if (headMatch) {
        result.push({
          number: Number(headMatch[1]),
          title: headMatch[2].trim(),
          synopsis: synMatch ? synMatch[1].trim() : "",
        });
      }
    }
    return result;
  }

  private async readCards<T>(folder: string): Promise<T[]> {
    const cards: T[] = [];
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder + "/"));
    for (const f of files) {
      const m = this.app.metadataCache.getFileCache(f)?.frontmatter;
      const body = await this.app.vault.cachedRead(f);
      const bodyText = body.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
      cards.push({
        name: m?.name ?? f.basename,
        role: m?.role ?? "support",
        category: m?.category ?? "",
        summary: bodyText.slice(0, 600),
        content: bodyText.slice(0, 600),
      } as unknown as T);
    }
    return cards;
  }

  private listCardFiles(folder: string): { path: string; name: string }[] {
    return this.app.vault.getMarkdownFiles()
      .filter((f) => f.path.startsWith(folder + "/"))
      .map((f) => {
        const m = this.app.metadataCache.getFileCache(f)?.frontmatter;
        return { path: f.path, name: (m?.name as string) ?? f.basename };
      });
  }

  private chapterFileName(ch: ChapterOutline): string {
    const numPrefix = String(ch.number).padStart(2, "0");
    return `${numPrefix}-${this.sanitize(ch.title)}`;
  }

  private sanitize(name: string): string {
    return name.replace(/[\\/:*?"<>|#[\]]/g, "-").replace(/\s+/g, " ").trim();
  }

  private async ensureFolder(path: string): Promise<void> {
    if (!this.app.vault.getAbstractFileByPath(path)) {
      await this.app.vault.createFolder(path);
    }
  }

  private async createOrReplace(path: string, content: string): Promise<TFile> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
      return existing;
    }
    return await this.app.vault.create(path, content);
  }
}
