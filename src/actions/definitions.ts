import { ActionDef } from "./types";

/**
 * All actions, organized by domain: Knowledge / Execution / Auxiliary.
 *
 * The "AI 助手" is placed in Auxiliary as a cross-cutting entry point.
 * The command panel renders it as a pinned top-level button above the grouped actions.
 */
export const ALL_ACTIONS: ActionDef[] = [
  // ══════════════════════════════════════════════════════════════
  //  KNOWLEDGE
  // ══════════════════════════════════════════════════════════════

  {
    id: "vault-qa",
    label: "知识库问答",
    icon: "library",
    description: "基于 Vault 检索回答，附带来源引用",
    domain: "knowledge",
    section: "retrieval",
    when: { always: true },
    showIn: ["panel", "editor-menu"],
    experimental: true,
    run: (ctx) => { ctx.plugin.openVaultQA(); },
  },
  {
    id: "question-with-graph",
    label: "知识提问",
    icon: "help-circle",
    description: "提问 → 自动分类 → 生成 Q&A → 更新问题图谱",
    domain: "knowledge",
    section: "question",
    when: { always: true },
    showIn: ["panel"],
    run: (ctx) => { ctx.plugin.openQuestionWithGraph(); },
  },
  {
    id: "complete-current-concept",
    label: "补全当前概念页",
    icon: "book-plus",
    description: "为当前打开的空概念页生成定义、解释、示例、关联",
    domain: "knowledge",
    section: "concept",
    when: { always: true },
    showIn: ["panel", "editor-menu"],
    experimental: true,
    run: (ctx) => { ctx.plugin.openCompleteCurrentConcept(); },
  },
  {
    id: "scan-empty-concepts",
    label: "扫描并补全空概念页",
    icon: "search",
    description: "扫描 Vault 中所有空概念页，批量补全",
    domain: "knowledge",
    section: "concept",
    when: { always: true },
    showIn: ["panel"],
    experimental: true,
    run: (ctx) => { ctx.plugin.openScanEmptyConcepts(); },
  },
  {
    id: "new-reading-project",
    label: "新建阅读项目",
    icon: "book-open",
    description: "输入书名，生成阅读地图",
    domain: "knowledge",
    section: "reading",
    when: { always: true },
    showIn: ["panel"],
    run: (ctx) => { ctx.plugin.openNewReadingProject(); },
  },
  {
    id: "knowledge-debt",
    label: "知识债务看板",
    icon: "bar-chart-2",
    description: "空概念、孤立问题、未完成阅读、长期未更新草稿",
    domain: "knowledge",
    section: "debt",
    when: { always: true },
    showIn: ["panel"],
    experimental: true,
    run: (ctx) => { ctx.plugin.openKnowledgeDebt(); },
  },

  // ══════════════════════════════════════════════════════════════
  //  EXECUTION
  // ══════════════════════════════════════════════════════════════

  // Placeholder: future actions like "生成执行计划", "查看执行日志", "定时任务"
  // will be added here once runtime is implemented.

  // ══════════════════════════════════════════════════════════════
  //  AUXILIARY
  // ══════════════════════════════════════════════════════════════

  {
    id: "ai-assistant",
    label: "AI 助手",
    icon: "sparkles",
    description: "选中文字或输入指令，AI 智能执行（跨模块入口）",
    domain: "auxiliary",
    section: "assistant",
    when: { always: true },
    showIn: ["panel", "editor-menu", "file-menu"],
    run: (ctx) => { ctx.plugin.openAssistant(); },
  },
  {
    id: "beautify-note",
    label: "美化当前文档",
    icon: "wand",
    description: "整理结构、插入 Callout、生成双链",
    domain: "auxiliary",
    section: "document",
    when: { always: true },
    showIn: ["panel", "editor-menu", "file-menu"],
    run: (ctx) => { void ctx.plugin.beautifyCurrentNote(); },
  },
  {
    id: "baidu-sync",
    label: "百度云同步",
    icon: "cloud",
    description: "备份 / 恢复 / 同步",
    domain: "auxiliary",
    section: "sync",
    when: { always: true },
    showIn: ["panel"],
    run: (ctx) => { ctx.plugin.openBaiduSyncModal(); },
  },
];
