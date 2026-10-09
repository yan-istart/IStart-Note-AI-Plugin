import { DeepSeekSettings } from "../types";
import { LLMClient, parseJsonSafe } from "../core/llm";

export type CompletionMode =
  | "concept"        // 概念页补全
  | "section"        // 空 section 补全
  | "expand"         // 选中文字扩写
  | "document"       // 文档缺失分析
  | "continue";      // 续写

export interface SmartCompletionResult {
  mode: CompletionMode;
  content: string;          // 生成的 Markdown 内容
  explanation?: string;     // 简短说明
}

const SECTION_PROMPT = `你是一个知识笔记助手。用户有一篇笔记，其中某个章节是空的，请根据文件上下文为该章节生成内容。

文件标题：{{title}}
章节名：{{section}}
文件已有内容（供参考）：
{{context}}

要求：
1. 内容与文件主题一致，风格匹配已有内容。
2. 简洁、准确、适合个人知识库。
3. 直接输出该章节的正文内容（不要包含章节标题本身）。
4. 如果是列表类章节（如"示例"、"相关问题"），用 - 列表格式。`;

const EXPAND_PROMPT = `你是一个知识笔记助手。用户选中了一段文字，请帮助扩写/补全。

选中的文字：
{{selection}}

上下文（选中文字所在文件的部分内容）：
{{context}}

要求：
1. 保持原文风格和语气。
2. 扩展内容要有实质信息，不要水字数。
3. 直接输出扩写后的完整段落（包含原文 + 新增内容）。`;

const CONTINUE_PROMPT = `你是一个知识笔记助手。用户的光标在文件末尾或段落末尾，请续写内容。

光标前的内容：
{{before}}

要求：
1. 自然衔接前文。
2. 保持风格一致。
3. 生成 2-4 段有价值的续写内容。
4. 直接输出续写的内容。`;

const DOCUMENT_PROMPT = `你是一个知识笔记助手。请分析以下文档，找出可以补充的部分。

文档内容：
{{content}}

要求：
1. 分析文档结构，找出缺失或可以丰富的部分。
2. 为每个建议生成具体内容。
3. 严格按以下 JSON 格式返回：
{
  "suggestions": [
    {
      "section": "建议补充的章节名（已有章节名或新章节名）",
      "reason": "为什么需要补充",
      "content": "建议的内容"
    }
  ]
}`;

export interface DocumentSuggestion {
  section: string;
  reason: string;
  content: string;
}

export class SmartCompleter {
  private llm: LLMClient;

  constructor(settings: DeepSeekSettings) {
    this.llm = new LLMClient(settings);
  }

  /** 补全空 section */
  async completeSection(
    title: string,
    sectionName: string,
    fileContext: string
  ): Promise<SmartCompletionResult> {
    const prompt = SECTION_PROMPT
      .replace("{{title}}", title)
      .replace("{{section}}", sectionName)
      .replace("{{context}}", fileContext.slice(0, 1500));

    const content = await this.call(prompt);
    return { mode: "section", content, explanation: `已补全"${sectionName}"` };
  }

  /** 扩写选中文字 */
  async expand(selection: string, context: string): Promise<SmartCompletionResult> {
    const prompt = EXPAND_PROMPT
      .replace("{{selection}}", selection)
      .replace("{{context}}", context.slice(0, 1500));

    const content = await this.call(prompt);
    return { mode: "expand", content, explanation: "已扩写选中内容" };
  }

  /** 续写 */
  async continueWriting(beforeCursor: string): Promise<SmartCompletionResult> {
    const prompt = CONTINUE_PROMPT.replace("{{before}}", beforeCursor.slice(-1500));
    const content = await this.call(prompt);
    return { mode: "continue", content, explanation: "已续写" };
  }

  /** 分析文档缺失部分 */
  async analyzeDocument(content: string): Promise<DocumentSuggestion[]> {
    const prompt = DOCUMENT_PROMPT.replace("{{content}}", content.slice(0, 3000));
    const raw = await this.call(prompt);
    return this.parseDocumentSuggestions(raw);
  }

  private async call(prompt: string): Promise<string> {
    return this.llm.chat({ userPrompt: prompt, temperature: 0.6 });
  }

  private parseDocumentSuggestions(raw: string): DocumentSuggestion[] {
    const p = parseJsonSafe<Record<string, unknown> | null>(raw, null);
    if (!p) return [];
    const suggestions = p.suggestions;
    return Array.isArray(suggestions) ? (suggestions as DocumentSuggestion[]) : [];
  }
}
