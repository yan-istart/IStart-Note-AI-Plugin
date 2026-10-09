import { DeepSeekSettings } from "../../../types";
import { LLMClient, parseJsonSafe } from "../../../core/llm";
import { WritingGenre, CharacterCard, WorldSetting } from "../types";
import { RawChapter, MaterialKind } from "./ChapterSplitter";

export interface ImportAnalysis {
  oneLiner: string;
  styleProfile: string;
  characters: CharacterCard[];
  worldSettings: WorldSetting[];
}

const ANALYZE_PROMPT = `你是网文分析助手。根据用户提供的章节样本,反推作品级元数据。

样本来自同一部作品,已按顺序给出(节选)。

要求:
1. one_liner:一句话介绍这部作品的题材与核心看点(不超过 60 字)。
2. style_profile:2-3 句话描述文风基调(叙事视角、节奏、语言风格),后续续写会以此保持一致。
3. {{novelOnly}}最多提取 5 个主要角色与 3 条世界观设定;只依据样本,不要编造。
4. 严格按 JSON 输出,不要其他内容。

JSON 格式:
{
  "one_liner": "一句话简介",
  "style_profile": "文风基调",
  "characters": [
    { "name": "角色名", "role": "protagonist | support | villain", "summary": "外貌性格动机能力,2-3 句" }
  ],
  "world_settings": [
    { "category": "世界观/势力/力量体系/地理", "name": "设定名", "content": "设定内容" }
  ]
}`;

/**
 * 元数据反推 — 单次 LLM 调用,基于采样章节。
 * 采样策略:前 3 章 + 每 50 章 + 最后一章,总量封顶。
 */
export class ImportAnalyzer {
  private llm: LLMClient;

  constructor(settings: DeepSeekSettings) {
    this.llm = new LLMClient(settings);
  }

  async analyze(title: string, genre: WritingGenre, chapters: RawChapter[]): Promise<ImportAnalysis> {
    const samples = sampleChapters(chapters, 8);
    if (samples.length === 0) {
      return { oneLiner: "", styleProfile: "", characters: [], worldSettings: [] };
    }

    const sampleText = samples
      .map((c) => `【第${c.number}章 ${c.title}】\n${c.content.slice(0, 2500)}`)
      .join("\n\n---\n\n");

    const novelOnly = genre === "novel"
      ? ""
      : "characters 与 world_settings 输出空数组。";

    const prompt = ANALYZE_PROMPT.replace("{{novelOnly}}", novelOnly);

    const raw = await this.llm.chat({
      systemPrompt: prompt,
      userPrompt: `作品标题：${title || "未命名"}\n\n章节样本：\n${sampleText}`,
      temperature: 0.4,
      maxTokens: 1600,
    });

    const p = parseJsonSafe<Record<string, unknown> | null>(raw, null);
    if (!p) return { oneLiner: "", styleProfile: "", characters: [], worldSettings: [] };

    return {
      oneLiner: (p.one_liner as string) || "",
      styleProfile: (p.style_profile as string) || "",
      characters: Array.isArray(p.characters)
        ? (p.characters as CharacterCard[]).filter((c) => c && typeof c.name === "string")
        : [],
      worldSettings: Array.isArray(p.world_settings)
        ? (p.world_settings as WorldSetting[]).filter((w) => w && typeof w.name === "string")
        : [],
    };
  }
}

/** 采样:前 3 章 + 每 50 章 + 最后一章,去重封顶 */
export function sampleChapters(chapters: RawChapter[], cap: number): RawChapter[] {
  const body = chapters.filter((c) => c.number > 0);
  if (body.length === 0) return [];

  const picked = new Map<number, RawChapter>();
  const take = (c: RawChapter | undefined) => {
    if (c) picked.set(c.number, c);
  };

  take(body[0]);
  take(body[1]);
  take(body[2]);
  for (let i = 49; i < body.length; i += 50) take(body[i]);
  take(body[body.length - 1]);

  const ordered = body.filter((c) => picked.has(c.number));
  return ordered.slice(0, cap);
}

const CLASSIFY_PROMPT = `你是网文原稿分类助手。对下面每个导入单元分类。

单元格式:"[编号] 名称\\n开头内容(节选)"

分类标准:
- chapter: 正文章节(小说正文、序章、楔子、番外)
- outline: 大纲、细纲、章节梗概、剧情结构、连续性表
- setting: 世界观设定、角色设定、势力、力量体系、百科、地图
- reference: 其他写作资料(手册、方案、笔记、备忘等)
- skip: 无用内容(封面、版权页、纯广告等)

严格按 JSON 输出,不要其他内容:
{"classifications": [{"index": 0, "kind": "chapter"}, ...]}

必须覆盖每一个单元。`;

const VALID_KINDS: MaterialKind[] = ["chapter", "outline", "setting", "reference", "skip"];

export interface ClassifyUnit {
  index: number;
  title: string;
  head: string;
}

/**
 * AI 批量内容分类:一次调用覆盖最多 50 个单元(超量分批)。
 * 返回 单元索引 → 分类 的映射;解析失败的部分由调用方保留规则结果。
 */
export class ImportClassifier {
  private llm: LLMClient;

  constructor(settings: DeepSeekSettings) {
    this.llm = new LLMClient(settings);
  }

  async classifyUnits(units: ClassifyUnit[]): Promise<Map<number, MaterialKind>> {
    const result = new Map<number, MaterialKind>();
    const CHUNK = 50;

    for (let i = 0; i < units.length; i += CHUNK) {
      const chunk = units.slice(i, i + CHUNK);
      const listText = chunk
        .map((u) => `[${u.index}] ${u.title}\n${u.head.slice(0, 200)}`)
        .join("\n\n");

      const raw = await this.llm.chat({
        systemPrompt: CLASSIFY_PROMPT,
        userPrompt: listText,
        temperature: 0.1,
        maxTokens: Math.max(512, chunk.length * 40),
      });

      const p = parseJsonSafe<{ classifications?: { index: number; kind: string }[] } | null>(raw, null);
      for (const c of p?.classifications ?? []) {
        if (typeof c.index === "number" && VALID_KINDS.includes(c.kind as MaterialKind)) {
          result.set(c.index, c.kind as MaterialKind);
        }
      }
    }

    return result;
  }
}
