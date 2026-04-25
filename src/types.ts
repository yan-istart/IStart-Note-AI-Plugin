export interface DeepSeekSettings {
  apiKey: string;
  baseUrl: string;
  model: "deepseek-chat" | "deepseek-reasoner";
  savePath: string;
  autoOpenGraph: boolean;
  conceptsPath: string;
  questionsIndexPath: string;
}

export const DEFAULT_SETTINGS: DeepSeekSettings = {
  apiKey: "",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  savePath: "Knowledge/Q&A",
  autoOpenGraph: false,
  conceptsPath: "Knowledge/Concepts",
  questionsIndexPath: "Knowledge/Questions",
};

export type CompletionDepth = "light" | "standard";

export type QuestionCategory = "new" | "refinement" | "expansion";

export interface QuestionClassification {
  category: QuestionCategory;
  parent: string | null;       // 父问题标题（refinement 时有值）
  related: string[];           // 相关问题标题列表
  confidence: number;          // 0-1
  refinements: string[];       // 推荐深化问题
  expansions: string[];        // 推荐扩展问题
}

export interface ConceptCompletionResult {
  definition: string;
  explanation: string;
  examples: string[];
  related_concepts: { name: string; relation: string; description: string }[];
  related_questions: string[];
  tags: string[];
}

export interface DeepSeekResponse {
  answer: string;
  concepts: string[];
  relations: Relation[];
  tags: string[];
}

export interface Relation {
  from: string;
  relation: string;
  to: string;
}
