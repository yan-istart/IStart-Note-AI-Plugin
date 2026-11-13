import type { ReadingPlan } from "../../ai/ReadingPlanner";
import type { FileChange } from "./types";
import { noteName } from "./Changes";

export function buildReadingProjectDraft(plan: ReadingPlan, projectName = plan.bookTitle): FileChange[] {
  const strings = (values: unknown): values is string[] => Array.isArray(values) && values.every(s => typeof s === "string");
  if (typeof plan.bookTitle !== "string" || typeof plan.author !== "string" || typeof plan.oneLiner !== "string" || !strings(plan.coreQuestions) || !strings(plan.prerequisites) || !strings(plan.keyConcepts) || !strings(plan.chapterRelations) || !Array.isArray(plan.chapters) || !plan.chapters.length || plan.chapters.length > 80 || !plan.chapters.every(ch => Number.isInteger(ch.number) && ch.number >= 0 && typeof ch.title === "string" && typeof ch.summary === "string" && ["core", "recommended", "optional"].includes(ch.importance) && strings(ch.keyConcepts))) throw new Error("阅读规划格式不完整，请重新生成");
  const folder = `Knowledge/Reading/${noteName(projectName)}`;
  const filename = (number: number, title: string) => `${String(number).padStart(2, "0")}-${noteName(title)}.md`;
  const links = (values: string[]) => values.map(t => `[[${noteName(t)}|${t.replace(/[[\]|\r\n]/g, " ")}]]`).join(" · ");
  const index = `---\ntype: reading-project\nbook: ${JSON.stringify(plan.bookTitle)}\nauthor: ${JSON.stringify(plan.author)}\nstatus: reading\ngeneration_status: partial\nchapters_generated: 0\nchapters_total: ${plan.chapters.length}\n---\n\n# ${plan.bookTitle}\n\n${plan.oneLiner}\n\n## 核心问题\n\n${plan.coreQuestions.map(q => `- ${q}`).join("\n")}\n\n## 前置知识\n\n${plan.prerequisites.map(q => `- ${q}`).join("\n") || "无特殊前置要求"}\n\n## 阅读进度\n\n${plan.chapters.map(ch => `- [ ] [[${filename(ch.number, ch.title).replace(/\.md$/, "")}|${ch.title}]]：${ch.summary}`).join("\n")}\n\n## 章节关系\n\n${plan.chapterRelations.length ? `\`\`\`mermaid\ngraph LR\n${plan.chapterRelations.join("\n")}\n\`\`\`\n` : ""}\n\n## 核心概念\n\n${links(plan.keyConcepts)}\n`;
  const changes: FileChange[] = [{ path: `${folder}/_索引.md`, before: null, after: index }, ...plan.chapters.map(ch => ({ path: `${folder}/${filename(ch.number, ch.title)}`, before: null, after: `---\ntype: reading-note\nbook: ${JSON.stringify(plan.bookTitle)}\nchapter: ${ch.number}\ntitle: ${JSON.stringify(ch.title)}\nimportance: ${ch.importance}\nquestions_generated: false\nstatus: unread\n---\n\n# 第${ch.number}章：${ch.title}\n\n> ${ch.summary}\n\n## 读前问题\n\n（待生成）\n\n## 要点\n\n## 摘抄\n\n## 疑问\n\n## 我的理解\n\n## 关联概念\n\n${links(ch.keyConcepts)}\n\n## 章节总结\n\n` }))];
  if (new Set(changes.map(c => c.path)).size !== changes.length) throw new Error("阅读规划包含重复章节文件名，请重新生成");
  return changes;
}

/** Read the scalar fields used by plugin-owned reading/question frontmatter. */
export function yamlScalar(content: string, key: string): string {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1];
  if (!block) return "";
  const raw = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(block)?.[1]?.trim() ?? "";
  if (raw.startsWith('"')) { try { const value: unknown = JSON.parse(raw); return typeof value === "string" ? value : ""; } catch { return ""; } }
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
  return raw.replace(/\s+#.*$/, "");
}
function setFields(content: string, values: Record<string, string | number | boolean>): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  let block = match?.[1] ?? "";
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}: ${value}`;
    const field = new RegExp(`^${key}:.*$`, "m");
    block = field.test(block) ? block.replace(field, line) : `${block}${block ? "\n" : ""}${line}`;
  }
  return `---\n${block}\n---\n${match ? content.slice(match[0].length) : `\n${content}`}`;
}
export function completeReadingQuestions(content: string, questions: string[]): string {
  if (!questions.length || !questions.every(q => typeof q === "string" && q.trim())) throw new Error("未生成有效的读前问题");
  const section = /^##[ \t]+读前问题[ \t]*\r?\n([\s\S]*?)(?=^##[ \t]|$(?![\s\S]))/m;
  const previous = section.exec(content)?.[1]?.replace(/^\s*[（(](?:待生成|生成中[.。…]*)[）)]\s*$/gm, "").trim() ?? "";
  const known = new Set(previous.split(/\r?\n/).map(q => q.replace(/^\s*[-*]\s*(?:\[[ xX]\]\s*)?/, "").trim()));
  const additions = questions.map(q => q.replace(/\r?\n/g, " ").trim()).filter(q => { if (known.has(q)) return false; known.add(q); return true; });
  const body = [previous, additions.map(q => `- [ ] ${q}`).join("\n")].filter(Boolean).join("\n");
  const replacement = `## 读前问题\n\n${body}\n\n`;
  return setFields(section.test(content) ? content.replace(section, () => replacement) : `${content.trimEnd()}\n\n${replacement}`, { questions_generated: true });
}
export function readingProgress(index: string, chapters: string[]): string {
  const notes = chapters.filter(c => yamlScalar(c, "type") === "reading-note");
  const generated = notes.filter(c => yamlScalar(c, "questions_generated") === "true").length;
  return setFields(index, { chapters_generated: generated, chapters_total: notes.length, generation_status: notes.length > 0 && generated === notes.length ? "complete" : "partial" });
}
export interface QuestionNode { title: string; category: string; parent: string | null }
export function questionEvolution(content: string, questions: QuestionNode[]): string {
  if (!questions.some(q => q.parent)) return content;
  const nodes = new Map<string, string>();
  const id = (title: string) => { if (!nodes.has(title)) nodes.set(title, `Q${nodes.size}`); return nodes.get(title)!; };
  for (const q of questions) { id(q.title); if (q.parent) id(q.parent); }
  const escape = (text: string) => text.replace(/[\r\n]/g, " ").replace(/[[\](){}|<>#&"]/g, "").trim().slice(0, 60) || "?";
  const lines = [...nodes].map(([title, key]) => `    ${key}["${escape(title)}"]`);
  const edges = new Set(questions.filter(q => q.parent).map(q => `    ${id(q.parent!)} -->${q.category === "refinement" ? "|深化|" : q.category === "expansion" ? "|扩展|" : ""} ${id(q.title)}`));
  const block = `\n## 问题演化\n\n\`\`\`mermaid\ngraph TD\n${[...lines, ...edges].join("\n")}\n\`\`\`\n`;
  const previous = /\n## 问题演化\n[\s\S]*?```mermaid[\s\S]*?```\n?/;
  return previous.test(content) ? content.replace(previous, () => block) : content.trimEnd() + "\n" + block;
}
