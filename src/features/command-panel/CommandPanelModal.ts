import { App, Modal, setIcon, TFile } from "obsidian";

export interface PanelAction {
  id: string;
  icon: string;
  label: string;
  description?: string;
  callback: () => void;
}

export interface PanelGroup {
  title: string;
  actions: PanelAction[];
}

/**
 * 统一命令面板 — 根据上下文动态展示可用操作
 */
export class CommandPanelModal extends Modal {
  private groups: PanelGroup[];

  constructor(app: App, groups: PanelGroup[]) {
    super(app);
    this.groups = groups;
    this.titleEl.setText("IStart-Note-AI");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("istart-command-panel");

    let shortcutIndex = 1;

    for (const group of this.groups) {
      if (group.actions.length === 0) continue;

      const groupEl = contentEl.createDiv({ cls: "istart-panel-group" });
      groupEl.createEl("div", { text: group.title, cls: "istart-panel-group-title" });

      for (const action of group.actions) {
        const row = groupEl.createDiv({ cls: "istart-panel-action" });

        const iconEl = row.createSpan({ cls: "istart-panel-action-icon" });
        setIcon(iconEl, action.icon);

        const textEl = row.createDiv({ cls: "istart-panel-action-text" });
        textEl.createEl("span", { text: action.label, cls: "istart-panel-action-label" });
        if (action.description) {
          textEl.createEl("span", { text: action.description, cls: "istart-panel-action-desc" });
        }

        if (shortcutIndex <= 9) {
          row.createSpan({ text: `${shortcutIndex}`, cls: "istart-panel-action-key" });
        }

        row.addEventListener("click", () => {
          this.close();
          action.callback();
        });

        shortcutIndex++;
      }
    }

    // 键盘快捷键支持
    const handler = (e: KeyboardEvent) => {
      const num = parseInt(e.key);
      if (num >= 1 && num <= 9) {
        const allActions = this.groups.flatMap((g) => g.actions);
        const action = allActions[num - 1];
        if (action) {
          this.close();
          action.callback();
        }
      }
      if (e.key === "Escape") {
        this.close();
      }
    };
    document.addEventListener("keydown", handler);
    this.onClose = () => {
      document.removeEventListener("keydown", handler);
      contentEl.empty();
    };
  }
}

/**
 * 根据当前编辑器状态构建面板分组
 */
export function buildPanelGroups(context: {
  hasSelection: boolean;
  selection: string;
  isConceptPage: boolean;
  isReadingNote: boolean;
  isInSection: boolean;
  sectionName: string | null;
  activeFile: TFile | null;
  // 回调
  onAsk: () => void;
  onContextQA: () => void;
  onNewReading: () => void;
  onSmartComplete: () => void;
  onDiagram: () => void;
  onExpand: () => void;
  onContinue: () => void;
  onCompleteConcept: () => void;
  onScanConcepts: () => void;
  onChapterSummary: () => void;
  onFeynmanTest: () => void;
  onAnalyzeDoc: () => void;
  onSectionAppend: () => void;
}): PanelGroup[] {
  const groups: PanelGroup[] = [];

  // 通用操作
  const general: PanelAction[] = [
    { id: "ask", icon: "💬", label: "提问", description: "向 AI 提问并生成知识笔记", callback: context.onAsk },
    { id: "reading", icon: "📖", label: "新建阅读项目", description: "输入书名，生成阅读地图", callback: context.onNewReading },
  ];
  groups.push({ title: "通用", actions: general });

  // 选中文字相关
  if (context.hasSelection) {
    const selectionActions: PanelAction[] = [
      { id: "context-qa", icon: "❓", label: "基于选中内容提问", callback: context.onContextQA },
      { id: "diagram", icon: "📊", label: "生成图表 / 公式", callback: context.onDiagram },
      { id: "expand", icon: "📝", label: "扩写选中内容", callback: context.onExpand },
    ];
    groups.push({ title: "选中文字", actions: selectionActions });
  }

  // 编辑操作
  const editActions: PanelAction[] = [
    { id: "smart-complete", icon: "✨", label: "智能补全", description: "自动判断：补全/扩写/续写", callback: context.onSmartComplete },
  ];
  if (!context.hasSelection) {
    editActions.push({ id: "continue", icon: "🔄", label: "续写", description: "从光标位置继续写", callback: context.onContinue });
  }
  if (context.isInSection && context.sectionName) {
    editActions.push({ id: "section-append", icon: "📑", label: `补充"${context.sectionName}"`, callback: context.onSectionAppend });
  }
  groups.push({ title: "编辑", actions: editActions });

  // 概念页
  if (context.isConceptPage) {
    groups.push({
      title: "概念页",
      actions: [
        { id: "complete-concept", icon: "🧩", label: "补全当前概念页", callback: context.onCompleteConcept },
        { id: "scan-concepts", icon: "🔍", label: "扫描空概念页", callback: context.onScanConcepts },
      ],
    });
  }

  // 阅读笔记
  if (context.isReadingNote) {
    groups.push({
      title: "阅读笔记",
      actions: [
        { id: "chapter-summary", icon: "📋", label: "生成章节总结", callback: context.onChapterSummary },
        { id: "feynman", icon: "🎓", label: "费曼检验", callback: context.onFeynmanTest },
      ],
    });
  }

  // 文档工具
  groups.push({
    title: "文档工具",
    actions: [
      { id: "analyze", icon: "🔎", label: "分析文档缺失", description: "AI 分析并建议补充内容", callback: context.onAnalyzeDoc },
    ],
  });

  return groups;
}
