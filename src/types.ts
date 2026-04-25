export interface DeepSeekSettings {
  apiKey: string;
  baseUrl: string;
  model: "deepseek-chat" | "deepseek-reasoner";
  savePath: string;
  autoOpenGraph: boolean;
}

export const DEFAULT_SETTINGS: DeepSeekSettings = {
  apiKey: "",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  savePath: "Knowledge/Q&A",
  autoOpenGraph: false,
};

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
