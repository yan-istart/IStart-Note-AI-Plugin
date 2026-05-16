import { ContentType, NoteTemplate } from "./types";

const COMMON_FORMATTING = [
  "单段不超过 4 行",
  "不允许连续长篇散文",
  "优先结构化表达（列表、表格、Callout）",
  "每个章节必须有视觉断点",
  "重要结论使用 > [!summary] Callout",
  "风险/注意事项使用 > [!warning] Callout",
  "建议/技巧使用 > [!tip] Callout",
  "示例使用 > [!example] Callout",
  "对比内容使用表格",
  "识别到的专业术语/概念用 [[双链]] 包裹",
];

const COMMON_MERMAID = [
  "如果内容涉及流程，自动生成 Mermaid flowchart",
  "如果涉及调用关系/交互，生成 sequence diagram",
  "如果涉及状态变化，生成 state diagram",
  "如果涉及数据结构/实体关系，生成 erDiagram",
  "如果涉及模块/类关系，生成 class diagram",
  "Mermaid 节点 ID 用英文，标签用中文方括号：A[\"中文\"]",
];

export const TEMPLATES: Record<ContentType, NoteTemplate> = {
  [ContentType.TECH_DOC]: {
    type: ContentType.TECH_DOC,
    name: "技术文档",
    systemPrompt: "你正在生成技术文档风格的 Obsidian 笔记。内容应精确、结构清晰、适合工程师快速扫描。",
    markdownStructure: `
## 摘要（TLDR）
## 背景
## 核心原理
## 实现方案
## 关键代码/配置
## 注意事项
## 相关概念
## 参考`,
    calloutRules: [
      "API 变更/Breaking Change 使用 > [!warning]",
      "最佳实践使用 > [!tip]",
      "代码示例使用 > [!example]",
    ],
    mermaidRules: COMMON_MERMAID,
    formattingRules: [...COMMON_FORMATTING, "代码块标注语言", "命令行用 ```bash"],
  },

  [ContentType.ARCHITECTURE]: {
    type: ContentType.ARCHITECTURE,
    name: "架构设计",
    systemPrompt: "你正在生成系统架构设计文档。需要清晰展示组件关系、数据流、决策依据。",
    markdownStructure: `
## 摘要
## 问题背景
## 设计目标
## 架构概览（Mermaid）
## 核心组件
## 数据流
## 技术选型
## 风险与权衡
## 相关概念`,
    calloutRules: [
      "架构决策使用 > [!abstract] 决策",
      "权衡/Trade-off 使用 > [!warning]",
      "备选方案使用 > [!tip]",
    ],
    mermaidRules: [...COMMON_MERMAID, "架构概览必须生成 Mermaid graph"],
    formattingRules: [...COMMON_FORMATTING, "组件描述用表格：| 组件 | 职责 | 技术 |"],
  },

  [ContentType.READING_NOTE]: {
    type: ContentType.READING_NOTE,
    name: "阅读笔记",
    systemPrompt: "你正在生成阅读笔记。帮助读者快速理解章节核心、建立知识连接。",
    markdownStructure: `
## 本章摘要
## 核心概念
## 关键论点
## 与其他章节的关系
## 我的理解
## 行动建议`,
    calloutRules: [
      "核心观点使用 > [!summary]",
      "作者原话/引用使用 > [!quote]",
      "个人思考使用 > [!tip] 思考",
    ],
    mermaidRules: ["章节间关系生成 graph", "概念关系生成 graph"],
    formattingRules: [...COMMON_FORMATTING, "引用原文用 > 块引用"],
  },

  [ContentType.PRODUCT_DESIGN]: {
    type: ContentType.PRODUCT_DESIGN,
    name: "产品设计",
    systemPrompt: "你正在生成产品设计文档。需要清晰表达用户需求、方案设计、优先级。",
    markdownStructure: `
## 摘要
## 用户问题
## 设计目标
## 方案设计
## 用户流程（Mermaid）
## 优先级
## 风险
## 指标`,
    calloutRules: [
      "用户痛点使用 > [!warning]",
      "设计原则使用 > [!abstract]",
      "MVP 范围使用 > [!tip]",
    ],
    mermaidRules: [...COMMON_MERMAID, "用户流程必须生成 flowchart"],
    formattingRules: [...COMMON_FORMATTING, "功能列表用表格：| 功能 | 优先级 | 状态 |"],
  },

  [ContentType.CONCEPT]: {
    type: ContentType.CONCEPT,
    name: "概念页",
    systemPrompt: "你正在生成知识库概念页。内容应精确、适合长期存储和反复查阅。",
    markdownStructure: `
## 定义
## 核心解释
## 示例
## 关联概念
## 关系图（Mermaid）
## 相关问题`,
    calloutRules: [
      "常见误解使用 > [!warning] 误区",
      "记忆技巧使用 > [!tip]",
    ],
    mermaidRules: ["关联概念生成 graph LR"],
    formattingRules: [...COMMON_FORMATTING],
  },

  [ContentType.QA]: {
    type: ContentType.QA,
    name: "问答笔记",
    systemPrompt: "你正在生成结构化问答笔记。回答应清晰、有层次、便于回顾。",
    markdownStructure: `
## 摘要
## 回答
## 关键概念
## 延伸问题`,
    calloutRules: [
      "核心结论使用 > [!summary]",
      "注意事项使用 > [!warning]",
    ],
    mermaidRules: COMMON_MERMAID,
    formattingRules: [...COMMON_FORMATTING],
  },

  [ContentType.MEETING_NOTE]: {
    type: ContentType.MEETING_NOTE,
    name: "会议记录",
    systemPrompt: "你正在生成结构化会议记录。突出决策、行动项、责任人。",
    markdownStructure: `
## 会议摘要
## 讨论要点
## 决策
## 行动项
## 下次议题`,
    calloutRules: [
      "决策使用 > [!abstract] 决策",
      "待办使用 > [!todo]",
      "风险使用 > [!warning]",
    ],
    mermaidRules: [],
    formattingRules: [...COMMON_FORMATTING, "行动项格式：- [ ] 内容 @责任人 📅日期"],
  },

  [ContentType.TASK_PLAN]: {
    type: ContentType.TASK_PLAN,
    name: "任务规划",
    systemPrompt: "你正在生成任务规划文档。需要清晰的目标、步骤、时间线。",
    markdownStructure: `
## 目标
## 背景
## 步骤
## 时间线（Mermaid Gantt）
## 风险
## 验收标准`,
    calloutRules: [
      "里程碑使用 > [!abstract]",
      "阻塞风险使用 > [!warning]",
    ],
    mermaidRules: ["时间规划生成 gantt 图"],
    formattingRules: [...COMMON_FORMATTING, "步骤用有序列表"],
  },

  [ContentType.WORLD_BUILDING]: {
    type: ContentType.WORLD_BUILDING,
    name: "世界观/设定",
    systemPrompt: "你正在生成世界观/设定文档。内容应有沉浸感，同时保持结构化便于查阅。",
    markdownStructure: `
## 概述
## 核心设定
## 规则/法则
## 关键实体
## 关系网络（Mermaid）
## 历史/时间线
## 开放问题`,
    calloutRules: [
      "核心法则使用 > [!abstract] 法则",
      "矛盾/冲突使用 > [!warning]",
      "灵感使用 > [!tip]",
    ],
    mermaidRules: ["实体关系生成 graph", "时间线生成 timeline 或 gantt"],
    formattingRules: [...COMMON_FORMATTING],
  },

  [ContentType.UNKNOWN]: {
    type: ContentType.UNKNOWN,
    name: "通用",
    systemPrompt: "你正在生成 Obsidian 知识库内容。",
    markdownStructure: "",
    calloutRules: [],
    mermaidRules: COMMON_MERMAID,
    formattingRules: COMMON_FORMATTING,
  },
};
