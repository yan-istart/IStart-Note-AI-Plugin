import type { App, Editor, TFile } from "obsidian";
import type DeepSeekPlugin from "../main";

/** 动作执行时的上下文 */
export interface ActionContext {
  plugin: DeepSeekPlugin;
  app: App;
  editor: Editor | null;
  activeFile: TFile | null;
  selection: string;
  fileContent: string;
  fileType: string | undefined;
  filePath: string;
  sectionName: string | null;
  targetFile: TFile | null;
}

/** 可见性条件 */
export interface ActionWhen {
  always?: boolean;
  hasSelection?: boolean;
  noSelection?: boolean;
  fileType?: string[];
  filePath?: string;
  inSection?: boolean;
}

/** 动作出现的入口 */
export type ActionEntry = "panel" | "editor-menu" | "file-menu";

/** 三大产品域 */
export type ActionDomain = "knowledge" | "execution" | "auxiliary";

/** 细分领域（用于面板二级分组、设置定位等） */
export type ActionSection =
  | "question"
  | "concept"
  | "reading"
  | "retrieval"
  | "debt"
  | "plan"
  | "scheduler"
  | "logs"
  | "sync"
  | "assistant"
  | "document"
  | "settings";

/** 动作定义 */
export interface ActionDef {
  id: string;
  label: string;
  icon: string;
  description?: string;
  domain: ActionDomain;
  section: ActionSection;
  when: ActionWhen;
  showIn: ActionEntry[];
  /** 操作风险 */
  risk?: "none" | "low" | "medium" | "high";
  /** 是否实验性功能 */
  experimental?: boolean;
  run: (ctx: ActionContext) => void;
}

// ── 兼容层：旧 group 映射到新 domain ──────────────────────────
// 保留旧类型名以便 registry 和 panel 平滑迁移

/** @deprecated Use ActionDomain + ActionSection */
export type ActionGroup = ActionDomain;

/** 域标题（面板一级分组） */
export const DOMAIN_TITLES: Record<ActionDomain, string> = {
  knowledge: "知识",
  execution: "执行",
  auxiliary: "辅助",
};

/** 域排序 */
export const DOMAIN_ORDER: ActionDomain[] = ["knowledge", "execution", "auxiliary"];

// ── 向后兼容的 GROUP 导出（registry.ts 还在用） ───────────────
export const GROUP_TITLES = DOMAIN_TITLES;
export const GROUP_ORDER = DOMAIN_ORDER;
