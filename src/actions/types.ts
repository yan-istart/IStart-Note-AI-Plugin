import type { App, Editor, TFile } from "obsidian";
import type DeepSeekPlugin from "../main";

/** 动作执行时的上下文 */
export interface ActionContext {
  plugin: DeepSeekPlugin;
  app: App;
  editor: Editor | null;
  activeFile: TFile | null;
  selection: string;             // 选中文字（trim 后）
  fileContent: string;           // 当前文件全文
  fileType: string | undefined;  // frontmatter.type
  filePath: string;              // 当前文件路径
  sectionName: string | null;    // 光标所在 section 名
  // file-menu 专用：右键的目标文件（可能不是当前打开的文件）
  targetFile: TFile | null;
}

/** 可见性条件 */
export interface ActionWhen {
  always?: boolean;              // 始终可见
  hasSelection?: boolean;        // 需要有选中文字
  noSelection?: boolean;         // 需要没有选中文字
  fileType?: string[];           // frontmatter type 匹配其一
  filePath?: string;             // 文件路径包含此字符串
  inSection?: boolean;           // 光标在某个 ## section 内
}

/** 动作出现的入口 */
export type ActionEntry = "panel" | "editor-menu" | "file-menu";

/** 面板分组 */
export type ActionGroup = "general" | "selection" | "edit" | "concept" | "reading" | "sync" | "document";

/** 动作定义 */
export interface ActionDef {
  id: string;
  label: string;
  icon: string;
  description?: string;
  group: ActionGroup;
  when: ActionWhen;
  showIn: ActionEntry[];
  run: (ctx: ActionContext) => void;
}

/** 分组标题映射 */
export const GROUP_TITLES: Record<ActionGroup, string> = {
  general: "通用",
  selection: "选中文字",
  edit: "编辑",
  concept: "概念页",
  reading: "阅读",
  sync: "同步",
  document: "文档工具",
};

/** 分组排序 */
export const GROUP_ORDER: ActionGroup[] = [
  "general", "selection", "edit", "concept", "reading", "sync", "document",
];
