import { DeepSeekSettings } from "../types";
import { LLMClient } from "../core/llm";
import { WritingContext, ContinueRequest, ChapterOutline, InsertRequest } from "../features/writing/types";
import type { InsertionContext } from "../editor/InsertionContext";
import { buildInsertionPrompt } from "./InsertionPrompt";

const CONTINUE_SYSTEM = `你是一位专业的续写助手，为用户的现有作品续写正文。

规则：
1. 严格承接给定的上文，保持人称、时态、文风一致。
2. 遵循「本章梗概」推进情节/论述，不要偏离大纲。
3. 若提供角色卡与世界观设定，出场角色必须符合设定，禁止新增未设定的人物或规则。
4. 直接输出续写正文，不要写任何标题、解释、标注或"以下为续写"之类的文字。
5. 输出长度约 {{targetWords}} 字。
6. 小说：输出纯叙事正文，不用 Markdown 语法。论文/长文：允许使用段落结构与必要的小标题。{{genreRules}}`;

const CHAPTER_SYSTEM = `你是一位专业的章节写作助手，为用户的写作项目生成完整章节。

规则：
1. 按「本章梗概」完整写出本章内容。
2. 遵循作品文风基调，人物行为符合角色卡设定，世界观一致。
3. 直接输出章节正文（不含章节标题），不要写任何解释或标注。
4. 输出长度约 {{targetWords}} 字。
5. 小说：纯叙事正文，不用 Markdown 语法。论文：允许段落结构与小标题。{{genreRules}}`;

const NOVEL_RULES = `7. 网文节奏要求：段落宜短，多用对话与行动推进；避免大段描写拖慢节奏；情绪起伏清晰。{{hookRule}}`;
const PAPER_RULES = "";
const ARTICLE_RULES = `7. 语言平实流畅，段落间逻辑连贯，适当使用小标题。`;

const NOVEL_HOOK_RULE = "收尾时留一个轻微悬念或钩子，为下一章铺垫。";

export class StoryContinuer {
  private llm: LLMClient;

  constructor(settings: DeepSeekSettings) {
    this.llm = new LLMClient(settings);
  }

  /** 续写:光标处或章节末尾 */
  async continueStory(
    ctx: WritingContext,
    request: ContinueRequest,
    precedingText: string
  ): Promise<string> {
    const parts = this.buildCommonParts(ctx, request.targetWords, precedingText, request.instruction);

    const userPrompt = `【上文】\n${precedingText || "（本章开头，无上文）"}\n\n【本次任务】\n${request.instruction || "自然地接着写下去"}\n\n请续写：`;

    const raw = await this.llm.chat({
      systemPrompt: this.buildSystem(CONTINUE_SYSTEM, ctx, request.targetWords, request.mode),
      userPrompt: parts + "\n\n" + userPrompt,
      temperature: 0.8,
      maxTokens: this.tokenBudget(request.targetWords),
    });
    return this.trimIncompleteSentence(raw.trim());
  }

  /** 参考两侧正文和作品设定补充连接内容 */
  async insertStory(ctx: WritingContext, request: InsertRequest, context: InsertionContext): Promise<string> {
    const prompt = buildInsertionPrompt(request, context);
    // Match characters and settings mentioned on either side of the gap.
    const parts = this.buildCommonParts(ctx, request.targetWords, context.before + "\n" + context.after, request.instruction);
    const raw = await this.llm.chat({
      systemPrompt: this.buildSystem(prompt.systemPrompt + "\n遵守作品文风、大纲、角色卡与世界观设定。小说输出纯叙事正文。{{genreRules}}",
        ctx, request.targetWords, "cursor"),
      userPrompt: parts + "\n\n" + prompt.userPrompt,
      temperature: 0.6,
      maxTokens: this.tokenBudget(request.targetWords),
    });
    return raw.trim();
  }

  /** 按大纲梗概生成完整新章节 */
  async generateChapter(ctx: WritingContext, chapter: ChapterOutline, targetWords: number): Promise<string> {
    const parts = this.buildCommonParts(ctx, targetWords, "", "");

    const userPrompt = `【新章节】第${chapter.number}章：${chapter.title}\n本章梗概：${chapter.synopsis}\n\n请写出本章完整正文：`;

    const raw = await this.llm.chat({
      systemPrompt: this.buildSystem(CHAPTER_SYSTEM, ctx, targetWords, "chapter"),
      userPrompt: parts + "\n\n" + userPrompt,
      temperature: 0.8,
      maxTokens: this.tokenBudget(targetWords),
    });
    return this.trimIncompleteSentence(raw.trim());
  }

  /** 组装作品级上下文(作品简介/文风/本章梗概/前后章/相关设定) */
  private buildCommonParts(ctx: WritingContext, targetWords: number, precedingText: string, instruction: string): string {
    const lines: string[] = [];

    lines.push(`【作品】${ctx.projectTitle}`);
    if (ctx.oneLiner) lines.push(`一句话简介：${ctx.oneLiner}`);
    if (ctx.styleProfile) lines.push(`文风基调：${ctx.styleProfile}`);
    lines.push(`当前章节：第${ctx.chapterNumber}章 ${ctx.chapterTitle}`);
    if (ctx.chapterSynopsis) lines.push(`本章梗概：${ctx.chapterSynopsis}`);
    if (ctx.prevSynopsis) lines.push(`上一章梗概：${ctx.prevSynopsis}`);
    if (ctx.nextSynopsis) lines.push(`下一章梗概：${ctx.nextSynopsis}`);

    const injected = this.selectSettings(ctx, precedingText + "\n" + ctx.chapterSynopsis + "\n" + instruction);
    if (injected.length > 0) {
      lines.push(`相关设定（必须遵守）：\n${injected.join("\n")}`);
    }

    return lines.join("\n");
  }

  private buildSystem(template: string, ctx: WritingContext, targetWords: number, mode: string): string {
    let genreRules: string;
    let hookRule = "";

    if (ctx.genre === "novel") {
      genreRules = NOVEL_RULES;
      if (mode === "chapter") hookRule = NOVEL_HOOK_RULE;
    } else if (ctx.genre === "paper") {
      genreRules = PAPER_RULES;
    } else {
      genreRules = ARTICLE_RULES;
    }

    return template
      .replace("{{targetWords}}", String(targetWords))
      .replace("{{genreRules}}", genreRules.replace("{{hookRule}}", hookRule));
  }

  /** 中文 1 字约 1 token,预留 60% 余量防止截断 */
  private tokenBudget(targetWords: number): number {
    return Math.max(256, Math.round(targetWords * 1.6));
  }

  /** 截掉结尾不完整的半句(仅当尾部残句很短) */
  private trimIncompleteSentence(text: string): string {
    const lastStop = Math.max(
      text.lastIndexOf("。"),
      text.lastIndexOf("！"),
      text.lastIndexOf("？"),
      text.lastIndexOf("\"")
    );
    if (lastStop === -1) return text;
    const tail = text.slice(lastStop + 1).trim();
    if (tail.length > 0 && tail.length < 12 && !/[。！？]/.test(tail)) {
      return text.slice(0, lastStop + 1).trim();
    }
    return text;
  }

  /**
   * 设定注入:按 上文+梗概+指令 中出现的名字匹配角色卡/世界观。
   * 小说主角始终注入;其余按名字出现才注入(最多 3 角色 + 2 设定)。
   */
  private selectSettings(ctx: WritingContext, searchText: string): string[] {
    if (ctx.genre !== "novel") return [];

    const parts: string[] = [];
    const byRole: Record<string, number> = { protagonist: 0, support: 1, villain: 2 };

    const matchedCharacters = ctx.characters
      .filter((c) => c.role === "protagonist" || searchText.includes(c.name))
      .sort((a, b) => byRole[a.role] - byRole[b.role])
      .slice(0, 3);
    for (const c of matchedCharacters) {
      parts.push(`角色卡 ${c.name}（${c.role}）：${c.summary}`);
    }

    const matchedSettings = ctx.worldSettings
      .filter((w) => searchText.includes(w.name))
      .slice(0, 2);
    for (const w of matchedSettings) {
      parts.push(`世界观设定 ${w.name}（${w.category}）：${w.content}`);
    }

    return parts;
  }
}
