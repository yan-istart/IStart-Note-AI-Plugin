import { ContentType, NoteTemplate, OutputStyle } from "../templates/types";
import { TEMPLATES } from "../templates/index";
import { AssistantContext } from "../AIAssistant";

/** 风格修饰指令 */
const STYLE_MODIFIERS: Record<OutputStyle, string> = {
  "minimal": "极简风格：只保留核心信息，去除所有冗余。段落极短，大量留白。",
  "technical": "技术文档风格：精确、严谨、代码友好。使用专业术语，标注版本和兼容性。",
  "product": "产品文档风格：面向用户，清晰的步骤和截图描述位。强调用户价值。",
  "academic": "学术风格：严谨论证，引用来源，使用学术术语。逻辑链条完整。",
  "knowledge-base": "知识库风格：模块化、可检索、强链接。每个段落独立可理解。",
  "story": "叙事风格：有故事感和沉浸感，但保持结构化。适合世界观和设定文档。",
  "dashboard": "卡片化风格：信息密度高，使用大量 Callout 作为信息卡片。每个知识点一个 Callout。适合快速扫描。结构示例：\n> [!abstract] 概览\n> 内容\n\n> [!info] 要点 1\n> 内容\n\n> [!tip] 要点 2\n> 内容",
};

/**
 * 结构化 Prompt 构建器
 * 根据内容类型 + 输出风格 + 上下文，生成高质量的 system prompt
 */
export class StructuredPromptBuilder {
  constructor(
    private defaultStyle: OutputStyle = "knowledge-base"
  ) {}

  /**
   * 构建完整的 system prompt
   */
  buildSystemPrompt(contentType: ContentType, style?: OutputStyle): string {
    const template = TEMPLATES[contentType] || TEMPLATES[ContentType.UNKNOWN];
    const effectiveStyle = style || this.defaultStyle;

    const parts: string[] = [];

    // 1. 角色定义
    parts.push(template.systemPrompt);

    // 2. 风格修饰
    parts.push(`\n输出风格：${STYLE_MODIFIERS[effectiveStyle]}`);

    // 3. 格式规则
    parts.push("\n## 格式规则（必须遵守）\n");
    parts.push(template.formattingRules.map((r, i) => `${i + 1}. ${r}`).join("\n"));

    // 4. Callout 规则
    if (template.calloutRules.length > 0) {
      parts.push("\n## Callout 使用规则\n");
      parts.push(template.calloutRules.map((r) => `- ${r}`).join("\n"));
    }

    // 5. Mermaid 规则
    if (template.mermaidRules.length > 0) {
      parts.push("\n## Mermaid 图表规则\n");
      parts.push(template.mermaidRules.map((r) => `- ${r}`).join("\n"));
    }

    // 6. 结构模板（如果有）
    if (template.markdownStructure.trim()) {
      parts.push("\n## 推荐文档结构\n");
      parts.push("根据内容需要选择合适的章节（不必全部使用）：");
      parts.push(template.markdownStructure);
    }

    // 7. 输出格式
    parts.push(`\n## 输出要求\n`);
    parts.push("直接输出 Markdown 内容，不要包裹在 JSON 或代码块中。");
    parts.push("不要输出任何解释性前缀（如「以下是...」），直接输出正文。");
    parts.push("\n## 双链规则（必须遵守）\n");
    parts.push("所有专业术语、概念名词、技术名词必须用 Obsidian 双链格式包裹：[[概念名]]");
    parts.push("例如：[[TCP]]、[[CAP定理]]、[[微服务]]、[[一致性]]");
    parts.push("这是 Obsidian 知识库的核心特性，不可省略。");

    return parts.join("\n");
  }

  /**
   * 构建 user prompt（包含上下文）
   */
  buildUserPrompt(instruction: string, ctx: AssistantContext): string {
    const parts: string[] = [];

    if (instruction.trim()) {
      parts.push(`【指令】${instruction.trim()}`);
    } else {
      parts.push("【指令】（未指定，请根据上下文智能判断并生成结构化内容）");
    }

    parts.push(`\n【文件】${ctx.fileName}${ctx.fileType ? ` (type: ${ctx.fileType})` : ""}`);

    if (ctx.selection) {
      parts.push(`\n【选中内容】\n${ctx.selection}`);
    }

    if (ctx.sectionName) {
      parts.push(`\n【当前章节】${ctx.sectionName}${ctx.sectionEmpty ? "（空，需要补全）" : ""}`);
    }

    if (!ctx.selection && ctx.cursorLineBefore) {
      parts.push(`\n【光标前内容】\n${ctx.cursorLineBefore.slice(-500)}`);
    }

    if (ctx.fileContent) {
      const content = ctx.fileContent.length > 2000 ? ctx.fileContent.slice(0, 2000) + "\n...（省略）" : ctx.fileContent;
      parts.push(`\n【文件全文】\n${content}`);
    }

    return parts.join("\n");
  }
}
