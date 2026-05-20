import { ActionDef } from "./types";

/**
 * 精简后的动作定义。
 * 只保留 3 个核心入口，其他全部通过"AI 助手"自由指令覆盖。
 */
export const ALL_ACTIONS: ActionDef[] = [
  // ── 核心入口：AI 助手（覆盖 90% 场景） ────────────────────
  {
    id: "ai-assistant",
    label: "AI 助手",
    icon: "sparkles",
    description: "选中文字或输入指令，AI 智能执行",
    group: "general",
    when: { always: true },
    showIn: ["panel", "editor-menu", "file-menu"],
    run: (ctx) => { ctx.plugin.openAssistant(); },
  },

  // ── 概念页 ────────────────────────────────────────────────
  {
    id: "complete-current-concept",
    label: "补全当前概念页",
    icon: "book-plus",
    description: "为当前打开的空概念页生成定义、解释、示例、关联",
    group: "concept",
    when: { always: true },
    showIn: ["panel", "editor-menu"],
    run: (ctx) => { ctx.plugin.openCompleteCurrentConcept(); },
  },
  {
    id: "scan-empty-concepts",
    label: "扫描并补全空概念页",
    icon: "search",
    description: "扫描 Vault 中所有空概念页，批量补全",
    group: "concept",
    when: { always: true },
    showIn: ["panel"],
    run: (ctx) => { ctx.plugin.openScanEmptyConcepts(); },
  },

  // ── 知识提问（带图谱） ────────────────────────────────────
  {
    id: "question-with-graph",
    label: "知识提问",
    icon: "help-circle",
    description: "提问 → 自动分类 → 生成 Q&A → 更新问题图谱",
    group: "general",
    when: { always: true },
    showIn: ["panel"],
    run: (ctx) => { ctx.plugin.openQuestionWithGraph(); },
  },

  // ── 知识库问答（带引用） ──────────────────────────────────
  {
    id: "vault-qa",
    label: "知识库问答",
    icon: "library",
    description: "基于 Vault 检索回答，附带来源引用",
    group: "general",
    when: { always: true },
    showIn: ["panel", "editor-menu"],
    run: (ctx) => { ctx.plugin.openVaultQA(); },
  },

  // ── 阅读项目（需要专门表单） ──────────────────────────────
  {
    id: "new-reading-project",
    label: "新建阅读项目",
    icon: "book-open",
    description: "输入书名，生成阅读地图",
    group: "reading",
    when: { always: true },
    showIn: ["panel"],
    run: (ctx) => { ctx.plugin.openNewReadingProject(); },
  },

  // ── 知识债务看板 ──────────────────────────────────────────
  {
    id: "knowledge-debt",
    label: "知识债务看板",
    icon: "bar-chart-2",
    description: "查看空概念、孤立问题、未完成阅读、长期未更新草稿",
    group: "general",
    when: { always: true },
    showIn: ["panel"],
    run: (ctx) => { ctx.plugin.openKnowledgeDebt(); },
  },

  // ── 百度云同步（独立功能） ────────────────────────────────
  {
    id: "baidu-sync",
    label: "百度云同步",
    icon: "cloud",
    description: "备份 / 恢复 / 同步",
    group: "sync",
    when: { always: true },
    showIn: ["panel"],
    run: (ctx) => { ctx.plugin.openBaiduSyncModal(); },
  },

  // ── 美化当前文档 ──────────────────────────────────────────
  {
    id: "beautify-note",
    label: "美化当前文档",
    icon: "wand",
    description: "整理结构、插入 Callout、生成双链",
    group: "document",
    when: { always: true },
    showIn: ["panel", "editor-menu", "file-menu"],
    run: (ctx) => { void ctx.plugin.beautifyCurrentNote(); },
  },
];
