export interface DeepSeekSettings {
  apiKey: string;
  baseUrl: string;
  model: "deepseek-chat" | "deepseek-reasoner";
  savePath: string;
  autoOpenGraph: boolean;
  conceptsPath: string;
  questionsIndexPath: string;
  // 百度云同步配置
  baiduSync: BaiduSyncConfig;
}

export interface BaiduSyncConfig {
  enabled: boolean;
  appId: string;           // 百度开放平台 App ID
  appSecret: string;       // App Secret
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: string;  // ISO 时间字符串
  remotePath: string;      // 远端备份根目录，如 /apps/istart-note-ai
  autoBackup: boolean;     // 每次生成笔记后自动备份
  ignorePattern: string;   // 忽略规则（正则）
  fileSizeLimitMB: number; // 单文件大小限制
}

export const DEFAULT_BAIDU_SYNC_CONFIG: BaiduSyncConfig = {
  enabled: false,
  appId: "",
  appSecret: "",
  accessToken: "",
  refreshToken: "",
  tokenExpiresAt: "",
  remotePath: "/apps/istart-note-ai",
  autoBackup: false,
  ignorePattern: "",
  fileSizeLimitMB: 100,
};

export const DEFAULT_SETTINGS: DeepSeekSettings = {
  apiKey: "",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  savePath: "Knowledge/Q&A",
  autoOpenGraph: false,
  conceptsPath: "Knowledge/Concepts",
  questionsIndexPath: "Knowledge/Questions",
  baiduSync: { ...DEFAULT_BAIDU_SYNC_CONFIG },
};

/**
 * 可跨设备同步的配置（不含凭证）
 * 存储在百度云：{remotePath}/istart-config.json
 */
export interface SyncableConfig {
  // DeepSeek
  baseUrl: string;
  model: "deepseek-chat" | "deepseek-reasoner";
  // 路径
  savePath: string;
  conceptsPath: string;
  questionsIndexPath: string;
  // 行为
  autoOpenGraph: boolean;
  // 同步规则（不含凭证）
  baiduRemotePath: string;
  baiduAutoBackup: boolean;
  baiduIgnorePattern: string;
  baiduFileSizeLimitMB: number;
  // 元信息
  updatedAt: string; // ISO，用于多设备冲突判断
  deviceId: string;  // 最后更新的设备标识
}

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

export interface ContextQAInput {
  question: string;
  context: string;           // 框选内容
  sourceNote: string;        // 来源文件路径
  surroundingContext?: string; // 上下文段落（可选）
}

export interface ContextQAResponse {
  answer: string;
  concepts: string[];
  relations: Relation[];
  suggested_questions: string[];
  tags: string[];
}
