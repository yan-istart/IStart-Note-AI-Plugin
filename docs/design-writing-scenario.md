# IStart-Note-AI v3.0 产品设计方案:三大业务场景重构

> 状态:已确认(2026-09-30)
> 范围:emoji 清理、执行域移除、写作场景(网文/论文)MVP

---

## 1. 背景与决策

| 决策 | 结论 |
|---|---|
| Emoji 清理 | UI 与写入笔记的模板中全部移除 emoji;图标统一用 Obsidian 原生支持的 Lucide(`setIcon`);不引入自定义 SVG |
| 执行域 | **整体移除**。诊断结论:`ScheduledTaskRunner`(v2.0 已禁用)是 ExecutionPlan 的唯一生产者;`PlanDraftStore` 纯内存、重启即失;`openGeneratePlan` 产出 `type: plan` 与 `confirmAndExecutePlan` 要求的 `type: execution-plan` 不匹配 → 待确认计划恒为空、执行恒失败。含「从当前笔记生成执行计划」一并移除 |
| 写作 MVP 范围 | 新建作品(大纲+角色卡+世界观)、续写(光标/章节模式+设定注入)、生成下一章、面板三域重组 |

---

## 2. 顶层信息架构

```
IStart-Note-AI
├─ 知识 Knowledge   ← 输入/沉淀(已有)
│   ├─ 知识库问答(检索+来源引用)
│   ├─ 知识提问 → 分类 → Q&A → 问题图谱
│   ├─ 概念页(补全/扫描/债务看板)
│   └─ 阅读项目(书籍 → 章节 → 预设问题)
├─ 写作 Writing     ← 输出/生产(新增)
│   ├─ 网文小说 novel
│   ├─ 论文 paper
│   └─ 通用长文 article
└─ 辅助 Auxiliary
    ├─ AI 助手 / 美化文档 / 百度云同步
    └─ (执行域已移除)
```

**核心边界**:知识库负责"读进来",写作负责"写出去"。数据流单向:写作可检索/引用知识库,知识库问答默认不把写作产物当答案来源。

---

## 3. 写作场景功能清单

| 层级 | 功能 | 说明 | MVP |
|---|---|---|---|
| 作品 | 新建作品 | 输入题材+一句话简介 → 生成作品首页(简介/文风基调/大纲/分卷) | ✅ |
| 作品 | 作品大纲 | 逐章 synopsis(续写的锚点) | ✅ |
| 正文 | 续写(光标) | 接住光标处上文继续写 | ✅ |
| 正文 | 续写(章节) | 在文末按 synopsis 写完整章 | ✅ |
| 正文 | 生成下一章 | 按大纲 synopsis 生成新章,先预览后落盘 | ✅ |
| 正文 | 扩写/润色(选区) | 复用 AI 助手,限定"保持文风" | ✅ |
| 设定 | 角色卡 / 世界观 | 新建作品时自动生成;续写时按上文实体检索注入 | ✅ |
| 素材 | 灵感碎片 | 随手记 → 展开成文 | v2 |
| 论文 | 摘要/参考文献 | 分节撰写、摘要生成、引用管理 | v2(简化版已有) |

---

## 4. 续写专项设计(核心)

### 4.1 上下文组装(按优先级,受 token 预算约束)

1. 光标前 N 字正文(默认 2000,`continueContextChars` 可配)
2. 当前章节 frontmatter `synopsis`(本章该写什么)
3. 大纲中本章 + 前后章 synopsis(防跑偏)
4. 设定检索 top3:本项目角色卡/世界观与上文实体匹配者
5. 作品简介 + `style_profile`(文风基调)
6. 用户附加指令(可选,如"推进感情线,写 800 字")

### 4.2 输出约束

- 小说:纯正文,禁止 markdown 标题/双链/清单;默认 500–1500 字(`continueTargetWords` 可配)
- 论文:允许结构化段落、标题与 `[[知识库来源]]` 引用
- 交互:生成 → 预览 Modal → 「插入光标处 / 追加文末 / 继续续写 / 重新生成」(复用 `AssistantResultModal` 模式)

### 4.3 质量保障(已实现)

1. `max_tokens = 目标字数 × 1.6`,防止超长或截断;结尾残句自动裁掉
2. 体裁化规则:网文附加"短段落/对话行动推进/收尾留钩子(章节续写模式)"等节奏约束
3. 设定注入匹配范围 = 上文 + 本章梗概 + 用户指令(主角恒注入,其余按名字命中,≤3 角色 + 2 设定)

### 4.4 快捷入口(非命令)

| 入口 | 说明 |
|---|---|
| 默认快捷键 | 续写 `Cmd/Ctrl+Shift+J`;生成下一章 `Cmd/Ctrl+Shift+N`;新建作品 `Cmd/Ctrl+Shift+W`;AI 助手 `Cmd/Ctrl+Shift+A` |
| 状态栏 | 打开章节文件时显示「续写」「下一章」一键按钮 |
| 右键菜单 | 章节内右键:续写 / 润色 / 提取角色卡 |
| 命令面板 | ribbon(`brain`)一键打开,写作文件中写作域置顶 |

### 4.5 三种模式

| 模式 | 触发 | 写入位置 |
|---|---|---|
| 光标续写 | 光标在正文中 | 光标处 |
| 章节续写 | 命令面板(写作分组) | 文末 |
| 灵感续写 | 灵感碎片 | v2 |

---

## 5. 数据边界

### 5.1 目录结构

```
Writing/
├─ Novels/<作品名>/
│   ├─ _作品.md      type: writing-project, genre: novel
│   ├─ _大纲.md      type: outline
│   ├─ _设定/        type: setting(世界观/势力/力量体系)
│   ├─ _角色/        type: character(protagonist|support|villain)
│   ├─ 01-章名.md    type: chapter
│   └─ _废稿/        弃稿归档
└─ Papers/<论文名>/
    ├─ _论文.md      type: writing-project, genre: paper
    ├─ _大纲.md
    ├─ _参考文献.md
    └─ 01-引言.md
```

### 5.2 Frontmatter 协议(schema v2)

```yaml
# writing-project
type: writing-project
genre: novel | paper | article
title: xxx
status: planning | writing | paused | done
style_profile: 文风基调
current_chapter: "[[01-章名]]"

# chapter
type: chapter
project: "[[_作品]]"
number: 1
title: 章名
synopsis: 本章梗概
status: draft | revising | done
word_target: 3000
```

### 5.3 边界规则

1. 知识索引对 `type: writing-*` 打标,但知识库问答默认排除(设置可调)
2. 角色卡/世界观**不进** `Knowledge/Concepts/`(概念页=跨作品通用知识,设定=作品私有)
3. 章节正文不自动插双链、不自动建概念页(与 `ensureLinkedConcepts` 隔离);论文仅对知识库来源插链
4. `SCHEMA_VERSION` 升至 2

---

## 6. UI 设计

- 命令面板重组为 知识/写作/辅助 三域;上下文感知:当前文件为 `chapter` 时写作组置顶,显示「续写」「生成下一章」「润色选区」
- 写作工作台侧边栏视图(v2):大纲树 + 各章字数/状态 + 设定速查 + 快捷按钮
- 图标(Lucide):写作域 `feather`、续写 `pen-line`、新建作品 `file-plus-2`、角色 `users`、世界观 `map`、下一章 `arrow-right-to-line`;ribbon 保持 `brain`

---

## 7. 实施顺序

1. emoji 清理(UI 文案 + 模板内容)
2. 移除执行域(`core/execution`、`core/scheduler`、5 个 action、`main.ts` 入口、`Knowledge/_Executions`/`Plans` 产出)
3. 写作数据模型(schema v2 + 类型)
4. 新建作品流程(WritingPlanner + NewWritingModal + WritingProjectManager)
5. 续写(StoryContinuer + 设定注入 + 预览写入)
6. 生成下一章 + 面板三域重组
7. typecheck + build

---

## 8. 风险与取舍

- 设定注入采用关键词/实体匹配(复用 `KnowledgeIndexService` 思路),不做 embedding —— 与现有技术栈一致
- 文风一致性仅靠 `style_profile` 文本描述,不做样式学习(v2 可做"前三章抽样式")
- 删除执行域是不可逆操作;git 历史可回退
