export interface DeepSeekSettings {
  apiKey: string;
  baseUrl: string;
  model: "deepseek-chat" | "deepseek-reasoner";
  savePath: string;
  autoOpenGraph: boolean;
  conceptsPath: string;
}

export const DEFAULT_SETTINGS: DeepSeekSettings = {
  apiKey: "",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  savePath: "Knowledge/Q&A",
  autoOpenGraph: false,
  conceptsPath: "Knowledge/Concepts",
};

export type CompletionDepth = "light" | "standard";

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
