import { DeepSeekSettings } from "../types";
import { LLMClient, parseJsonSafe } from "../core/llm";
import { WritingGenre, WritingPlan, ChapterOutline, CharacterCard, WorldSetting } from "../features/writing/types";

const PROMPT = `你是一位专业的写作策划师。用户要开始一个新的写作项目，请基于题材与简介生成完整的作品规划。

体裁：{{genre}}
作品标题：{{title}}
一句话简介：{{premise}}

要求：
1. 大纲 10-20 章。论文按 摘要/引言/相关工作/方法/实验/讨论/结论 等标准结构，其余体裁按叙事或论述的章节结构。
2. 每章 synopsis 是一句话梗概，必须具体(包含本章发生什么/论述什么)，这是后续续写的锚点。
3. {{novelOnly}}
4. style_profile 用 2-3 句话描述文风基调(叙事视角、节奏、语言风格)。
5. 不要写正文，只输出规划。

严格按以下 JSON 格式输出，不要有任何其他内容：
{
  "title": "作品名",
  "one_liner": "一句话简介",
  "style_profile": "文风基调",
  "chapters": [
    { "number": 1, "title": "章节名", "synopsis": "本章梗概" }
  ],
  "characters": [
    { "name": "角色名", "role": "protagonist | support | villain", "summary": "外貌性格动机能力" }
  ],
  "world_settings": [
    { "category": "世界观/势力/力量体系/地理", "name": "设定名", "content": "设定内容" }
  ]
}`;

const NOVEL_ONLY = `4. 生成 3-6 个主要角色卡(characters)，包含主角、重要配角与反派；生成 3-5 条世界观设定(world_settings)。`;
const PAPER_ONLY = `4. characters 与 world_settings 输出空数组。`;

export class WritingPlanner {
  private llm: LLMClient;

  constructor(settings: DeepSeekSettings) {
    this.llm = new LLMClient(settings);
  }

  async plan(genre: WritingGenre, title: string, premise: string): Promise<WritingPlan> {
    const genreLabel = genre === "novel" ? "网文小说" : genre === "paper" ? "论文" : "通用长文";
    const novelOnly = genre === "novel" ? NOVEL_ONLY : PAPER_ONLY;

    const prompt = PROMPT
      .replace(/\{\{genre\}\}/g, genreLabel)
      .replace(/\{\{title\}\}/g, title || "(由你根据简介拟定)")
      .replace(/\{\{premise\}\}/g, premise || "(未提供)")
      .replace("{{novelOnly}}", novelOnly);

    const raw = await this.llm.chat({ userPrompt: prompt, temperature: 0.7 });
    return this.parse(raw, title);
  }

  private parse(raw: string, fallbackTitle: string): WritingPlan {
    const p = parseJsonSafe<Record<string, unknown> | null>(raw, null);
    if (!p) {
      return {
        title: fallbackTitle || "未命名作品",
        oneLiner: "",
        styleProfile: "",
        chapters: [],
        characters: [],
        worldSettings: [],
      };
    }

    const chapters: ChapterOutline[] = Array.isArray(p.chapters)
      ? (p.chapters as ChapterOutline[]).filter((c) => c && typeof c.title === "string")
      : [];
    const characters: CharacterCard[] = Array.isArray(p.characters)
      ? (p.characters as CharacterCard[]).filter((c) => c && typeof c.name === "string")
      : [];
    const worldSettings: WorldSetting[] = Array.isArray(p.world_settings)
      ? (p.world_settings as WorldSetting[]).filter((w) => w && typeof w.name === "string")
      : [];

    return {
      title: (p.title as string) || fallbackTitle || "未命名作品",
      oneLiner: (p.one_liner as string) || "",
      styleProfile: (p.style_profile as string) || "",
      chapters,
      characters,
      worldSettings,
    };
  }
}
