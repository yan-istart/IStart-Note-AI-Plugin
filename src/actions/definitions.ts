import { Notice } from "obsidian";
import { ActionDef } from "./types";

/**
 * 所有插件动作的定义。
 * 新增功能只需在此数组中添加一条。
 */
export const ALL_ACTIONS: ActionDef[] = [
  // ── 通用 ──────────────────────────────────────────────────
  {
    id: "ask-deepseek",
    label: "提问",
    icon: "message-circle",
    description: "向 AI 提问并生成知识笔记",
    group: "general",
    when: { always: true },
    showIn: ["panel", "editor-menu"],
    run: (ctx) => ctx.plugin.openQuestionModal(),
  },
  {
    id: "new-reading-project",
    label: "新建阅读项目",
    icon: "book-open",
    description: "输入书名，生成阅读地图",
    group: "general",
    when: { always: true },
    showIn: ["panel"],
    run: (ctx) => ctx.plugin.openNewReadingProject(),
  },
  {
    id: "baidu-sync",
    label: "百度云同步",
    icon: "cloud",
    group: "general",
    when: { always: true },
    showIn: ["panel"],
    run: (ctx) => ctx.plugin.openBaiduSyncModal(),
  },

  // ── 选中文字 ──────────────────────────────────────────────
  {
    id: "context-qa",
    label: "基于选中内容提问",
    icon: "help-circle",
    group: "selection",
    when: { hasSelection: true },
    showIn: ["panel", "editor-menu"],
    run: (ctx) => {
      const path = ctx.activeFile?.path ?? "";
      ctx.plugin.openContextQAModal(ctx.selection, path);
    },
  },
  {
    id: "generate-diagram",
    label: "生成图表 / 公式",
    icon: "bar-chart-2",
    group: "selection",
    when: { hasSelection: true },
    showIn: ["panel", "editor-menu"],
    run: (ctx) => {
      if (!ctx.editor) return;
      ctx.plugin.openDiagramGenerator(ctx.selection, ctx.fileContent.slice(0, 800), ctx.editor);
    },
  },
  {
    id: "expand-selection",
    label: "扩写选中内容",
    icon: "expand",
    group: "selection",
    when: { hasSelection: true },
    showIn: ["panel", "editor-menu"],
    run: (ctx) => {
      if (!ctx.editor) return;
      void ctx.plugin.runExpand(ctx.selection, ctx.fileContent.slice(0, 1500), ctx.editor);
    },
  },

  // ── 编辑 ──────────────────────────────────────────────────
  {
    id: "smart-complete",
    label: "智能补全",
    icon: "sparkles",
    description: "自动判断：补全/扩写/续写",
    group: "edit",
    when: { always: true },
    showIn: ["panel", "editor-menu", "file-menu"],
    run: (ctx) => {
      if (ctx.editor) {
        void ctx.plugin.runSmartComplete(ctx.editor);
      } else if (ctx.targetFile) {
        // file-menu: 先打开文件再执行
        void (async () => {
          const leaf = ctx.app.workspace.getLeaf(false);
          await leaf.openFile(ctx.targetFile!);
          setTimeout(() => {
            const ed = ctx.app.workspace.activeEditor?.editor;
            if (ed) void ctx.plugin.runSmartComplete(ed);
          }, 200);
        })();
      }
    },
  },
  {
    id: "continue-writing",
    label: "续写",
    icon: "pencil",
    description: "从光标位置继续写",
    group: "edit",
    when: { noSelection: true },
    showIn: ["panel", "editor-menu"],
    run: (ctx) => {
      if (!ctx.editor) return;
      const cursor = ctx.editor.getCursor();
      const before = ctx.editor.getRange({ line: 0, ch: 0 }, cursor);
      void ctx.plugin.runContinue(before, ctx.editor);
    },
  },
  {
    id: "append-section",
    label: "补充当前章节",
    icon: "plus-circle",
    group: "edit",
    when: { inSection: true },
    showIn: ["panel", "editor-menu"],
    run: (ctx) => {
      if (!ctx.editor || !ctx.activeFile || !ctx.sectionName) return;
      void ctx.plugin.runSectionAppend(ctx.activeFile, ctx.sectionName, ctx.fileContent);
    },
  },

  // ── 概念页 ────────────────────────────────────────────────
  {
    id: "complete-concept",
    label: "补全概念页",
    icon: "brain",
    group: "concept",
    when: { fileType: ["concept"], filePath: "Concepts/" },
    showIn: ["panel", "editor-menu", "file-menu"],
    run: (ctx) => { void ctx.plugin.completeCurrentConcept(); },
  },
  {
    id: "scan-empty-concepts",
    label: "扫描空概念页",
    icon: "search",
    group: "concept",
    when: { fileType: ["concept"], filePath: "Concepts/" },
    showIn: ["panel"],
    run: (ctx) => { void ctx.plugin.scanAndBatchComplete(); },
  },

  // ── 阅读 ──────────────────────────────────────────────────
  {
    id: "resume-reading",
    label: "补全阅读项目",
    icon: "refresh-cw",
    description: "补全缺失章节的预设问题",
    group: "reading",
    when: { fileType: ["reading-project"] },
    showIn: ["panel", "editor-menu", "file-menu"],
    run: (ctx) => { void ctx.plugin.resumeReadingProject(); },
  },
  {
    id: "chapter-summary",
    label: "生成章节总结",
    icon: "file-text",
    group: "reading",
    when: { fileType: ["reading-note"] },
    showIn: ["panel", "editor-menu", "file-menu"],
    run: (ctx) => {
      const editor = ctx.editor ?? ctx.app.workspace.activeEditor?.editor;
      if (editor) void ctx.plugin.runChapterSummary(editor);
    },
  },
  {
    id: "feynman-test",
    label: "费曼检验",
    icon: "help-circle",
    description: "检验理解程度",
    group: "reading",
    when: { fileType: ["reading-note"] },
    showIn: ["panel", "editor-menu", "file-menu"],
    run: (ctx) => {
      const editor = ctx.editor ?? ctx.app.workspace.activeEditor?.editor;
      if (editor) void ctx.plugin.runFeynmanTest(editor);
    },
  },

  // ── 文档工具 ──────────────────────────────────────────────
  {
    id: "analyze-document",
    label: "分析文档缺失",
    icon: "search",
    description: "AI 分析并建议补充内容",
    group: "document",
    when: { always: true },
    showIn: ["panel", "editor-menu"],
    run: (ctx) => {
      if (!ctx.editor) return;
      void ctx.plugin.runDocumentAnalysis(ctx.fileContent, ctx.editor);
    },
  },
  {
    id: "smart-diagram",
    label: "智能生成图表",
    icon: "bar-chart-2",
    description: "AI 自动判断最合适的图表类型",
    group: "document",
    when: { hasSelection: true },
    showIn: ["panel"],
    run: (ctx) => {
      if (!ctx.editor) return;
      void ctx.plugin.runDiagramGeneration(ctx.selection, "auto", ctx.fileContent.slice(0, 800), ctx.editor);
    },
  },
];
