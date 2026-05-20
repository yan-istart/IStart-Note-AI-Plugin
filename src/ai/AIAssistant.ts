import { DeepSeekSettings } from "../types";
import { LLMClient } from "../core/llm";
import { ContentClassifier } from "./classifier/ContentClassifier";
import { StructuredPromptBuilder } from "./prompt/StructuredPromptBuilder";
import { MarkdownBeautifier } from "./formatter/MarkdownBeautifier";
import { ReadableLayoutEngine } from "./formatter/ReadableLayoutEngine";
import { OutputStyle } from "./templates/types";

/** 用户请求的上下文 */
export interface AssistantContext {
  selection: string;
  fileContent: string;
  fileName: string;
  fileType: string | undefined;
  cursorLineBefore: string;
  sectionName: string | null;
  sectionEmpty: boolean;
}

/** AI 返回的结果 */
export interface AssistantResult {
  mode: "insert" | "replace" | "append" | "show";
  content: string;
  explanation?: string;
}

/**
 * 统一 AI 助手
 * 流程：分类 → 构建 Prompt → 调用 AI → 美化输出
 */
export class AIAssistant {
  private classifier: ContentClassifier;
  private promptBuilder: StructuredPromptBuilder;
  private llm: LLMClient;

  constructor(
    private settings: DeepSeekSettings,
    private outputStyle: OutputStyle = "knowledge-base",
    private knownConcepts: string[] = []
  ) {
    this.classifier = new ContentClassifier();
    this.promptBuilder = new StructuredPromptBuilder(outputStyle);
    this.llm = new LLMClient(settings);
  }

  async run(instruction: string, ctx: AssistantContext): Promise<AssistantResult> {
    this.llm.ensureApiKey();

    // 1. 分类内容类型
    const contentType = this.classifier.classify({
      instruction,
      fileName: ctx.fileName,
      filePath: ctx.fileName, // 简化：用 fileName 代替完整路径
      fileType: ctx.fileType,
      selection: ctx.selection,
    });

    // 2. 构建结构化 prompt
    const systemPrompt = this.promptBuilder.buildSystemPrompt(contentType, this.outputStyle);
    const userPrompt = this.promptBuilder.buildUserPrompt(instruction, ctx);

    // 3. 追加输出模式指令
    const modeInstruction = this.buildModeInstruction(ctx);
    const fullUserPrompt = userPrompt + "\n\n" + modeInstruction;

    // 4. 调用 AI
    const raw = await this.callAPI(systemPrompt, fullUserPrompt);

    // 5. 解析模式
    const { mode, content } = this.parseResponse(raw, ctx);

    // 6. 美化输出
    const beautifier = new MarkdownBeautifier(this.knownConcepts);
    const beautified = beautifier.beautify(content);

    // 7. 布局优化
    const layoutEngine = new ReadableLayoutEngine();
    const final = layoutEngine.optimize(beautified);

    return {
      mode,
      content: final,
      explanation: this.generateExplanation(mode, contentType),
    };
  }

  /** 美化已有文档（不调用 AI，只做格式化） */
  beautifyContent(content: string): string {
    const beautifier = new MarkdownBeautifier(this.knownConcepts);
    const beautified = beautifier.beautify(content);
    const layoutEngine = new ReadableLayoutEngine();
    return layoutEngine.optimize(beautified);
  }

  private buildModeInstruction(ctx: AssistantContext): string {
    const parts: string[] = ["【输出模式判断】"];

    if (ctx.selection) {
      parts.push("有选中内容。如果指令是改写/扩写/翻译，输出应替换选中内容（在第一行写 `<!-- mode:replace -->`）。");
      parts.push("如果是生成新内容（图表、解释等），输出应插入到选中内容下方（在第一行写 `<!-- mode:insert -->`）。");
    } else if (ctx.sectionEmpty && ctx.sectionName) {
      parts.push(`光标在空章节"${ctx.sectionName}"内。输出应填充该章节（在第一行写 \`<!-- mode:insert -->\`）。`);
    } else if (ctx.cursorLineBefore) {
      parts.push("无选中内容。输出应插入到光标位置（在第一行写 `<!-- mode:insert -->`）。");
    } else {
      parts.push("输出追加到文件末尾（在第一行写 `<!-- mode:append -->`）。");
    }

    parts.push("如果只是回答问题/解释（不需要修改文件），在第一行写 `<!-- mode:show -->`。");
    parts.push("\n注意：mode 注释必须是输出的第一行，后面紧跟正文内容。");

    return parts.join("\n");
  }

  private async callAPI(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.llm.chat({ systemPrompt, userPrompt, temperature: 0.5 });
  }

  private parseResponse(raw: string, ctx: AssistantContext): { mode: AssistantResult["mode"]; content: string } {
    // 提取 mode 注释
    const modeMatch = raw.match(/^<!--\s*mode:(replace|insert|append|show)\s*-->\s*\n?/);
    let mode: AssistantResult["mode"];
    let content: string;

    if (modeMatch) {
      mode = modeMatch[1] as AssistantResult["mode"];
      content = raw.slice(modeMatch[0].length).trim();
    } else {
      // 没有 mode 标记，根据上下文推断
      if (ctx.selection) {
        mode = "replace";
      } else if (ctx.sectionEmpty) {
        mode = "insert";
      } else {
        mode = "insert";
      }
      content = raw.trim();
    }

    return { mode, content };
  }

  private generateExplanation(mode: AssistantResult["mode"], contentType: string): string {
    const modeLabels: Record<string, string> = {
      replace: "替换选中内容",
      insert: "插入到光标位置",
      append: "追加到文件末尾",
      show: "仅展示",
    };
    return `${modeLabels[mode]}（${contentType}）`;
  }
}
