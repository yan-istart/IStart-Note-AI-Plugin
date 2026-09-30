/**
 * 写作场景数据模型。
 *
 * 数据边界(与知识域隔离):
 *  - 作品文件位于 settings.writingPath 下(默认 Writing/)。
 *  - 角色卡 / 世界观是"作品私有设定",不进 Knowledge/Concepts。
 *  - 章节正文默认不自动建双链。
 */

/** 写作体裁 */
export type WritingGenre = "novel" | "paper" | "article";

export interface ChapterOutline {
  number: number;
  title: string;
  /** 本章梗概 —— 续写与生成下一章的锚点 */
  synopsis: string;
}

export interface CharacterCard {
  name: string;
  role: "protagonist" | "support" | "villain";
  /** 角色摘要:外貌、性格、动机、能力 */
  summary: string;
}

export interface WorldSetting {
  category: string; // 世界观 / 势力 / 力量体系 / 地理 等
  name: string;
  content: string;
}

/** AI 生成的完整作品规划 */
export interface WritingPlan {
  title: string;
  /** 一句话简介 */
  oneLiner: string;
  /** 文风基调,每次续写都携带以保证一致 */
  styleProfile: string;
  chapters: ChapterOutline[];
  /** 仅小说 */
  characters: CharacterCard[];
  /** 仅小说 */
  worldSettings: WorldSetting[];
}

/** 续写模式 */
export type ContinueMode = "cursor" | "chapter";

export interface ContinueRequest {
  mode: ContinueMode;
  /** 用户附加指令(可选) */
  instruction: string;
  /** 目标字数(中文字符) */
  targetWords: number;
}

/** 续写/生成章节时的作品级上下文 */
export interface WritingContext {
  projectTitle: string;
  oneLiner: string;
  styleProfile: string;
  genre: WritingGenre;
  chapterNumber: number;
  chapterTitle: string;
  chapterSynopsis: string;
  prevSynopsis: string;
  nextSynopsis: string;
  characters: CharacterCard[];
  worldSettings: WorldSetting[];
}
