import { ActionDef } from "./types";

/**
 * All actions, organized by domain: Knowledge / Execution / Auxiliary.
 *
 * The "AI 助手" is placed in Auxiliary as a cross-cutting entry point.
 * The command panel renders it as a pinned top-level button above the grouped actions.
 *
 * Icons use Lucide names (https://lucide.dev) which Obsidian supports natively.
 */
export const ALL_ACTIONS: ActionDef[] = [
  // ══════════════════════════════════════════════════════════════
  //  KNOWLEDGE
  // ══════════════════════════════════════════════════════════════

  {
    id: "vault-qa",
    label: "知识库问答",
    icon: "book-open-check",
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
    icon: "message-circle-question",
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
    icon: "puzzle",
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
    label: "扫描空概念页",
    icon: "scan-search",
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
    icon: "book-marked",
    description: "输入书名，生成阅读地图",
    domain: "knowledge",
    section: "reading",
    when: { always: true },
    showIn: ["panel"],
    run: (ctx) => { ctx.plugin.openNewReadingProject(); },
  },
  {
    id: "create-artifact",
    label: "从当前知识生成实用模板",
    icon: "file-check",
    description: "检查表、SOP、例行流程、行动计划、复盘表",
    domain: "knowledge",
    section: "retrieval",
    when: { always: true },
    showIn: ["panel", "editor-menu"],
    run: (ctx) => { ctx.plugin.openArtifactBuilder(); },
  },
  {
    id: "knowledge-debt",
    label: "知识债务看板",
    icon: "activity",
    description: "空概念、孤立问题、未完成阅读、长期草稿",
    domain: "knowledge",
    section: "debt",
    when: { always: true },
    showIn: ["panel"],
    experimental: true,
    run: (ctx) => { ctx.plugin.openKnowledgeDebt(); },
  },

  // ══════════════════════════════════════════════════════════════
  //  WRITING
  // ══════════════════════════════════════════════════════════════

  {
    id: "new-writing-project",
    label: "新建作品",
    icon: "file-plus-2",
    description: "网文小说 / 论文:生成大纲、角色卡与世界观",
    domain: "writing",
    section: "writing-project",
    when: { always: true },
    showIn: ["panel"],
    hotkeys: [{ modifiers: ["Mod", "Shift"], key: "W" }],
    run: (ctx) => { ctx.plugin.openNewWritingProject(); },
  },
  {
    id: "continue-writing",
    label: "续写",
    icon: "pen-line",
    description: "从光标处接着写,自动带入大纲与设定",
    domain: "writing",
    section: "writing-chapter",
    when: { fileType: ["chapter"] },
    showIn: ["panel", "editor-menu"],
    hotkeys: [{ modifiers: ["Mod", "Shift"], key: "J" }],
    run: (ctx) => { void ctx.plugin.continueWriting(); },
  },
  {
    id: "generate-next-chapter",
    label: "生成下一章",
    icon: "arrow-right-to-line",
    description: "按大纲梗概生成新章节,先预览后写入",
    domain: "writing",
    section: "writing-chapter",
    when: { fileType: ["chapter", "writing-project"] },
    showIn: ["panel"],
    hotkeys: [{ modifiers: ["Mod", "Shift"], key: "N" }],
    run: (ctx) => { void ctx.plugin.generateNextChapter(); },
  },
  {
    id: "polish-writing",
    label: "润色选中文字",
    icon: "wand-2",
    description: "保持作品文风,改写选中内容",
    domain: "writing",
    section: "writing-chapter",
    when: { fileType: ["chapter"] },
    showIn: ["panel", "editor-menu"],
    run: (ctx) => { void ctx.plugin.polishWriting(); },
  },
  {
    id: "extract-characters",
    label: "从章节提取角色卡",
    icon: "users",
    description: "分析当前章节,补全/新建角色卡",
    domain: "writing",
    section: "writing-project",
    when: { fileType: ["chapter"] },
    showIn: ["panel", "editor-menu"],
    run: (ctx) => { void ctx.plugin.extractCharacters(); },
  },

  // ══════════════════════════════════════════════════════════════
  //  AUXILIARY
  // ══════════════════════════════════════════════════════════════

  {
    id: "ai-assistant",
    label: "AI 助手",
    icon: "sparkles",
    description: "选中文字或输入指令，AI 智能处理",
    domain: "auxiliary",
    section: "assistant",
    when: { always: true },
    showIn: ["panel", "editor-menu", "file-menu"],
    hotkeys: [{ modifiers: ["Mod", "Shift"], key: "A" }],
    run: (ctx) => { ctx.plugin.openAssistant(); },
  },
  {
    id: "beautify-note",
    label: "美化当前文档",
    icon: "paintbrush",
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
    icon: "cloud-upload",
    description: "备份 / 恢复 / 同步",
    domain: "auxiliary",
    section: "sync",
    when: { always: true },
    showIn: ["panel"],
    run: (ctx) => { ctx.plugin.openBaiduSyncModal(); },
  },
];
