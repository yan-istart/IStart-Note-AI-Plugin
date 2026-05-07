import { requestUrl } from "obsidian";
import { DeepSeekSettings } from "../types";

export interface ReadingPlan {
  bookTitle: string;
  author: string;
  oneLiner: string;
  coreQuestions: string[];
  prerequisites: string[];
  chapters: ChapterSkeleton[];
  chapterRelations: string[];
  keyConcepts: string[];
}

/** 骨架：只有标题和重要度，不含详细问题 */
export interface ChapterSkeleton {
  number: number;
  title: string;
  summary: string;
  importance: "core" | "recommended" | "optional";
  keyConcepts: string[];
}

/** 单章详情：预设问题 */
export interface ChapterDetail {
  number: number;
  title: string;
  questions: string[];
}

export interface ChapterSummaryResult {
  summary: string;
  answeredQuestions: { question: string; answer: string }[];
  newConcepts: string[];
  connections: string[];
  mermaid?: string;
}

export interface FeynmanQuestion {
  question: string;
  difficulty: "basic" | "intermediate" | "advanced";
  hint: string;
}

// ── Prompts ──────────────────────────────────────────────────

const SKELETON_PROMPT = `你是一个阅读规划助手。用户准备阅读一本书，请生成全书骨架。

书籍信息：{{book_info}}

{{toc_section}}

要求：
1. 如果你了解这本书，基于你的知识生成。如果不了解，基于目录推断。
2. importance: core=必读核心, recommended=推荐, optional=可跳读。
3. chapterRelations 用 Mermaid graph 语法描述章节逻辑依赖。
4. keyConcepts 列出全书最重要的 10-15 个概念。
5. 每章的 summary 只需 1-2 句话。

严格按以下 JSON 格式返回：
{
  "bookTitle": "书名",
  "author": "作者",
  "oneLiner": "一句话概括",
  "coreQuestions": ["核心问题1", "核心问题2", "核心问题3"],
  "prerequisites": ["前置知识1"],
  "chapters": [
    { "number": 1, "title": "章节标题", "summary": "本章讲什么", "importance": "core", "keyConcepts": ["概念1"] }
  ],
  "chapterRelations": ["Ch1[标题1] --> Ch2[标题2]"],
  "keyConcepts": ["概念1", "概念2"]
}`;

const CHAPTER_DETAIL_PROMPT = `你是一个阅读规划助手。请为以下章节生成"读前问题"——用户带着这些问题去阅读，帮助聚焦重点。

书名：{{book}}
章节：第{{number}}章 - {{title}}
章节概要：{{summary}}
本章核心概念：{{concepts}}

要求：
1. 生成 3-5 个引导性问题，从基础到深入。
2. 问题应该能通过阅读本章找到答案。
3. 至少包含 1 个"为什么"类问题和 1 个"如何"类问题。

严格按以下 JSON 格式返回：
{
  "questions": ["问题1", "问题2", "问题3", "问题4"]
}`;

const CHAPTER_SUMMARY_PROMPT = `你是一个阅读助手。用户读完了一个章节，请基于他的笔记生成章节总结。

书名：{{book}}
章节：{{chapter}}
用户的笔记内容：
{{notes}}

读前预设问题：
{{questions}}

要求：
1. 基于用户笔记生成总结，不要编造用户没提到的内容。
2. 尝试回答预设问题（如果笔记中有相关信息）。
3. 提取新出现的概念。
4. 找出与其他章节的关联。

严格按以下 JSON 格式返回：
{
  "summary": "章节总结（2-3段）",
  "answeredQuestions": [{ "question": "问题", "answer": "回答" }],
  "newConcepts": ["概念1"],
  "connections": ["与第X章的关联"],
  "mermaid": "graph LR\\n    A[概念1] -->|关系| B[概念2]"
}`;

const FEYNMAN_PROMPT = `你是一个学习检验助手。请基于章节内容提出检验性问题。

书名：{{book}}
章节：{{chapter}}
核心概念：{{concepts}}
用户笔记：
{{notes}}

要求：
1. 5 个检验问题（从简单到深入）。
2. 需要真正理解才能回答，不是记忆题。
3. 至少 1 个"如果...会怎样"思考题。
4. 至少 1 个对比题。

返回 JSON：
{
  "questions": [{ "question": "问题", "difficulty": "basic|intermediate|advanced", "hint": "提示" }]
}`;

export class ReadingPlanner {
  constructor(private settings: DeepSeekSettings) {}

  /** 第一步：生成全书骨架（轻量，一次请求） */
  async planSkeleton(bookInfo: string, tableOfContents?: string): Promise<ReadingPlan> {
    if (!this.settings.apiKey) throw new Error("请先配置 API Key");

    const tocSection = tableOfContents
      ? `目录（用户提供）：\n${tableOfContents}`
      : "（用户未提供目录，请基于你对这本书的了解生成）";

    const prompt = SKELETON_PROMPT
      .replace("{{book_info}}", bookInfo)
      .replace("{{toc_section}}", tocSection);

    const raw = await this.call(prompt);
    return this.parseSkeleton(raw);
  }

  /** 第二步：为单章生成预设问题 */
  async generateChapterQuestions(
    book: string,
    chapter: ChapterSkeleton
  ): Promise<ChapterDetail> {
    const prompt = CHAPTER_DETAIL_PROMPT
      .replace("{{book}}", book)
      .replace("{{number}}", String(chapter.number))
      .replace("{{title}}", chapter.title)
      .replace("{{summary}}", chapter.summary)
      .replace("{{concepts}}", chapter.keyConcepts.join("、") || "未知");

    const raw = await this.call(prompt);
    const parsed = this.extractJson(raw);

    try {
      const p = JSON.parse(parsed) as { questions: string[] };
      return {
        number: chapter.number,
        title: chapter.title,
        questions: Array.isArray(p.questions) ? p.questions : [],
      };
    } catch {
      return { number: chapter.number, title: chapter.title, questions: [] };
    }
  }

  /** 生成章节总结 */
  async summarizeChapter(
    book: string,
    chapter: string,
    notes: string,
    presetQuestions: string[]
  ): Promise<ChapterSummaryResult> {
    const prompt = CHAPTER_SUMMARY_PROMPT
      .replace("{{book}}", book)
      .replace("{{chapter}}", chapter)
      .replace("{{notes}}", notes.slice(0, 3000))
      .replace("{{questions}}", presetQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n"));

    const raw = await this.call(prompt);
    return this.parseChapterSummary(raw);
  }

  /** 费曼检验 */
  async feynmanTest(
    book: string,
    chapter: string,
    concepts: string[],
    notes: string
  ): Promise<FeynmanQuestion[]> {
    const prompt = FEYNMAN_PROMPT
      .replace("{{book}}", book)
      .replace("{{chapter}}", chapter)
      .replace("{{concepts}}", concepts.join("、"))
      .replace("{{notes}}", notes.slice(0, 2000));

    const raw = await this.call(prompt);
    return this.parseFeynman(raw);
  }

  private async call(prompt: string): Promise<string> {
    const res = await requestUrl({
      url: `${this.settings.baseUrl}/v1/chat/completions`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.apiKey}`,
      },
      body: JSON.stringify({
        model: this.settings.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.5,
      }),
      throw: false,
    });

    if (res.status !== 200) throw new Error(`API 错误: ${res.status}`);
    return res.json.choices?.[0]?.message?.content ?? "";
  }

  private parseSkeleton(raw: string): ReadingPlan {
    const jsonStr = this.extractJson(raw);
    try {
      const p = JSON.parse(jsonStr) as ReadingPlan;
      return {
        bookTitle: p.bookTitle || "未知书名",
        author: p.author || "未知作者",
        oneLiner: p.oneLiner || "",
        coreQuestions: Array.isArray(p.coreQuestions) ? p.coreQuestions : [],
        prerequisites: Array.isArray(p.prerequisites) ? p.prerequisites : [],
        chapters: Array.isArray(p.chapters) ? p.chapters : [],
        chapterRelations: Array.isArray(p.chapterRelations) ? p.chapterRelations : [],
        keyConcepts: Array.isArray(p.keyConcepts) ? p.keyConcepts : [],
      };
    } catch {
      throw new Error("AI 返回格式异常，请重试");
    }
  }

  private parseChapterSummary(raw: string): ChapterSummaryResult {
    const jsonStr = this.extractJson(raw);
    try {
      const p = JSON.parse(jsonStr) as ChapterSummaryResult;
      return {
        summary: p.summary || "",
        answeredQuestions: Array.isArray(p.answeredQuestions) ? p.answeredQuestions : [],
        newConcepts: Array.isArray(p.newConcepts) ? p.newConcepts : [],
        connections: Array.isArray(p.connections) ? p.connections : [],
        mermaid: p.mermaid || undefined,
      };
    } catch {
      return { summary: raw, answeredQuestions: [], newConcepts: [], connections: [] };
    }
  }

  private parseFeynman(raw: string): FeynmanQuestion[] {
    const jsonStr = this.extractJson(raw);
    try {
      const p = JSON.parse(jsonStr) as { questions: FeynmanQuestion[] };
      return Array.isArray(p.questions) ? p.questions : [];
    } catch {
      return [];
    }
  }

  private extractJson(raw: string): string {
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/);
    return match ? match[1] : raw;
  }
}
