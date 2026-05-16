/** 内容类型 */
export enum ContentType {
  TECH_DOC = "tech-doc",
  PRODUCT_DESIGN = "product-design",
  READING_NOTE = "reading-note",
  ARCHITECTURE = "architecture",
  CONCEPT = "concept",
  QA = "qa",
  MEETING_NOTE = "meeting-note",
  TASK_PLAN = "task-plan",
  WORLD_BUILDING = "world-building",
  UNKNOWN = "unknown",
}

/** 输出风格 */
export type OutputStyle = "minimal" | "technical" | "product" | "academic" | "knowledge-base" | "story" | "dashboard";

/** 笔记模板定义 */
export interface NoteTemplate {
  type: ContentType;
  name: string;
  systemPrompt: string;
  markdownStructure: string;
  calloutRules: string[];
  mermaidRules: string[];
  formattingRules: string[];
}

export const OUTPUT_STYLE_LABELS: Record<OutputStyle, string> = {
  "minimal": "极简",
  "technical": "技术文档",
  "product": "产品设计",
  "academic": "学术",
  "knowledge-base": "知识库",
  "story": "世界观/叙事",
  "dashboard": "卡片化",
};
