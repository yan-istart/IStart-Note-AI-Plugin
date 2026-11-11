import type { WritingPlan, WritingGenre } from "../../features/writing/types";
import type { FileChange } from "./types";
import { noteName } from "./Changes";
import { SCHEMA_VERSION, todayIso } from "../schema";

/** The Agent previews the same frontmatter protocol consumed by WritingProjectManager. */
export function buildWritingProjectDraft(plan: WritingPlan, genre: WritingGenre, root: string): FileChange[] {
  if (!plan.chapters.length || typeof plan.title !== "string" || typeof plan.oneLiner !== "string" || typeof plan.styleProfile !== "string" || !plan.chapters.every(c => Number.isInteger(c.number) && c.number >= 0 && typeof c.title === "string" && typeof c.synopsis === "string") || !plan.characters.every(c => typeof c.name === "string" && typeof c.summary === "string" && ["protagonist", "support", "villain"].includes(c.role)) || !plan.worldSettings.every(w => typeof w.name === "string" && typeof w.category === "string" && typeof w.content === "string")) throw new Error("作品规划格式不完整，请重新生成");
  const folder = `${root || "Writing"}/${({ novel: "Novels", paper: "Papers", article: "Articles" })[genre]}/${noteName(plan.title)}`;
  const files: FileChange[] = [];
  const add = (name: string, fields: Record<string, string | number>, body: string) => files.push({ path: `${folder}/${name}.md`, before: null, after: `---\nschema_version: ${SCHEMA_VERSION}\n${Object.entries(fields).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}\n---\n\n${body}\n` });
  const chapterName = (number: number, title: string) => `${String(number).padStart(2, "0")}-${noteName(title)}`;
  add("_作品", { type: "writing-project", genre, title: plan.title, one_liner: plan.oneLiner, style_profile: plan.styleProfile, status: "writing", current_chapter: `[[${chapterName(plan.chapters[0].number, plan.chapters[0].title)}]]`, created_at: todayIso() }, `# ${plan.title}\n\n> ${plan.oneLiner}\n\n## 文风基调\n\n${plan.styleProfile}\n\n## 章节进度\n\n${plan.chapters.map(c => `- [ ] 第${c.number}章 [[${chapterName(c.number, c.title)}|${c.title}]]：${c.synopsis}`).join("\n")}`);
  add("_大纲", { type: "outline", genre, project: plan.title, status: "active" }, `# ${plan.title} · 大纲\n\n${plan.chapters.map(c => `## 第${c.number}章：${c.title}\n\n> ${c.synopsis}\n\n章节文件：[[${chapterName(c.number, c.title)}|${c.title}]]\n`).join("\n")}`);
  for (const ch of plan.chapters) add(chapterName(ch.number, ch.title), { type: "chapter", genre, project: plan.title, number: ch.number, title: ch.title, synopsis: ch.synopsis, status: "draft", word_target: genre === "paper" ? 1500 : 3000 }, `# 第${ch.number}章：${ch.title}\n\n> 本章梗概：${ch.synopsis}\n`);
  if (genre === "novel") {
    for (const c of plan.characters) add(`_角色/${noteName(c.name)}`, { type: "character", name: c.name, role: c.role }, `# ${c.name}\n\n## 角色概要\n\n${c.summary}`);
    for (const w of plan.worldSettings) add(`_设定/${noteName(w.name)}`, { type: "setting", name: w.name, category: w.category }, `# ${w.name}\n\n${w.content}`);
  }
  if (new Set(files.map(f => f.path)).size !== files.length) throw new Error("规划包含重复的章节或角色文件名，请重新生成");
  return files;
}
