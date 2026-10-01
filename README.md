# IStart-Note-AI

<p align="center">
  <strong>把 Obsidian 变成你的个人知识系统与写作工作台。</strong>
</p>

<p align="center">
  <a href="./README.en.md">English</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#隐私说明">隐私说明</a> ·
  <a href="#路线图">路线图</a>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/github/v/release/yan-istart/IStart-Note-AI-Plugin?include_prereleases">
  <img alt="License" src="https://img.shields.io/github/license/yan-istart/IStart-Note-AI-Plugin">
  <img alt="CI" src="https://img.shields.io/github/actions/workflow/status/yan-istart/IStart-Note-AI-Plugin/ci.yml?branch=main">
  <img alt="Obsidian" src="https://img.shields.io/badge/Obsidian-1.7.2%2B-7C3AED">
</p>

---

IStart-Note-AI 是一个面向 Obsidian 的 AI 插件,围绕三大业务场景:**知识**(读进来)、**写作**(写出去)、**辅助**(跨设备支撑)。

- 知识:把零散笔记变成可检索、可关联的知识系统
- 写作:把灵感变成作品——网文小说、论文、长文
- 辅助:多模型接入、百度网盘同步

---

## English

IStart-Note-AI is an Obsidian plugin built around three business scenarios: **Knowledge** (read in), **Writing** (write out), and **Auxiliary** (cross-device support).

- **Knowledge** — turn scattered notes into a searchable, interlinked knowledge system: Q&A generation, concept pages, reading projects, vault Q&A with source citations, and a knowledge-debt dashboard.
- **Writing** — turn ideas into works (web novels, papers, long-form articles): generate outlines, characters, and world settings; continue writing from the cursor with setting injection; generate the next chapter; import existing manuscripts (split, classify, clean) without touching the originals.
- **Auxiliary** — OpenAI-compatible LLM (DeepSeek by default), multiple output styles, and optional Baidu Pan sync.

For the full English documentation see [README.en.md](./README.en.md).

> [!warning] 测试版
> v3.0 引入了写作场景并移除了执行模块。Frontmatter schema 尚在演进。升级前请备份 Vault。

---

## 三大模块

### 1. 知识 Knowledge

输入与沉淀,构建结构化知识库。

- **知识提问**:提问 → 自动分类 → 生成 Q&A → 更新问题图谱
- **概念页**:自动创建、空页扫描、批量补全(定义/解释/示例/关联)
- **阅读项目**:输入书名生成全书骨架、章节预设问题、总结与费曼测试
- **知识库问答**:基于 Vault 元数据索引检索,回答附带 `[[来源]]` 引用
- **知识债务看板**:空概念、孤立问题、未完成阅读、长期草稿
- **实用模板**:从当前知识生成检查表、SOP、例行流程、行动计划、复盘表

### 2. 写作 Writing

输出与生产,把你的灵感变成作品。支持三种体裁:**网文小说 / 论文 / 通用长文**。

- **新建作品**:输入一句话简介,AI 生成作品首页、逐章大纲(含梗概)、章节文件;小说额外生成角色卡与世界观设定
- **导入原稿**:把已有网文原稿(粘贴/文件/文件夹)导入为写作项目——自动切章、内容归类(规则预判 + AI 智能识别,正文/大纲/设定/资料)、清洗水印、AI 反推文风与设定,原稿不动
- **续写**(核心):从光标处或文末接着写,自动带入上文、本章/前后章梗概、文风基调,并注入相关角色卡与世界观设定
- **生成下一章**:按大纲梗概生成完整新章,先预览后写入
- **润色**:选区改写,保持作品文风
- **提取角色卡**:从章节正文识别角色,写入 `_角色/`

数据边界:写作产物独立存放在 `Writing/` 下,知识库问答默认不检索写作内容(单向引用,可配置)。

### 3. 辅助 Auxiliary

- **OpenAI 兼容 LLM**:默认 DeepSeek,切换 Base URL 可用其他服务
- **输出风格可选**:知识库、技术、极简、产品、学术、叙事、卡片化
- **百度网盘同步**(可选):增量备份、双向同步、插件与 Obsidian 配置备份

---

## 状态

| 模块 | 功能 | 状态 | 说明 |
| --- | --- | --- | --- |
| 知识 | AI 助手 | 稳定 | 插入 / 替换 / 追加 / 仅展示 |
| 知识 | 阅读项目 | 稳定 | 骨架、章节问题、总结、费曼 |
| 知识 | 知识库问答 | 实验中 | 元数据索引检索,无 embedding |
| 知识 | 概念页补全 | 实验中 | 预览后写入 |
| 知识 | 问题图谱 | 实验中 | 分类 + 索引 + Mermaid 演化图 |
| 知识 | 知识债务看板 | 实验中 | 空概念 / 孤立问题 / 草稿统计 |
| 知识 | 实用模板 | 实验中 | 检查表 / SOP / 复盘表生成 |
| 写作 | 新建作品 | 实验中 | 大纲 + 角色卡 + 世界观 |
| 写作 | 导入原稿 | 实验中 | 切章 / 清洗 / AI 反推,原稿不动 |
| 写作 | 续写 | 实验中 | 光标 / 章节模式,设定注入 |
| 写作 | 生成下一章 | 实验中 | 按大纲梗概生成 |
| 辅助 | 百度同步 | 稳定 | 手动/自动备份与配置同步 |
| 辅助 | 多 Provider | 部分 | 支持 OpenAI 兼容 Base URL |

---

## 快速开始

1. 安装插件(见[安装](#安装))。
2. 进入**设置 → IStart-Note-AI → 辅助 → AI 服务**,输入 API Key。
3. 点击侧边栏命令面板图标或使用默认快捷键 `Cmd/Ctrl+Shift+A`,呼出 AI 助手。
4. 用自然语言输入指令,或在**写作**分组里新建作品、续写章节。

---

## 安装

### 社区插件商店(审核后可用)

1. 设置 → 第三方插件 → 浏览 → 搜索 **IStart-Note-AI**。
2. 安装 → 启用。

### 手动安装(测试期推荐)

从 [GitHub Release](https://github.com/yan-istart/IStart-Note-AI-Plugin/releases) 下载 `main.js`、`manifest.json`、`styles.css`,放入 `<Vault>/.obsidian/plugins/istart-note-ai/`。

> 不要直接克隆源码仓库——构建产物在 `dist/`,不在仓库中。请使用 Release 资产。

### 从源码构建

```bash
npm ci && npm run build
# → dist/main.js, dist/manifest.json, dist/styles.css
```

---

## 设置

设置页按三个标签组织:

| 标签 | 主要设置 |
| --- | --- |
| **知识** | Q&A 目录、问题索引目录、概念页目录、知识索引状态与重建 |
| **写作** | 作品目录(Writing/)、续写上文长度、默认续写字数 |
| **辅助** | API Key、Base URL、模型、输出风格、百度同步、隐私说明 |

---

## 使用

### 桌面

- 命令面板:侧边栏图标一键呼出,三域分组(知识 / 写作 / 辅助);打开章节文件时写作分组置顶
- 快捷键(默认,可在设置中修改):

  | 快捷键 | 功能 |
  | --- | --- |
  | `Cmd/Ctrl+Shift+A` | AI 助手 |
  | `Cmd/Ctrl+Shift+J` | 续写当前章节 |
  | `Cmd/Ctrl+Shift+N` | 生成下一章 |
  | `Cmd/Ctrl+Shift+W` | 新建作品 |

- 状态栏:打开章节文件时显示「续写」「下一章」一键按钮
- 编辑器右键:续写 / 润色 / 提取角色卡 / AI 助手
- 文件列表右键:AI 助手 / 美化文档

### 移动端

- 命令面板:侧边栏图标呼出,分组与桌面一致。
- 把常用命令添加到移动工具栏,一键直达。

---

## 数据目录

插件管理的笔记集中在两个根目录(路径可在设置中修改):

```
Knowledge/                 # 知识域(输入/沉淀)
  Q&A/                     # 问答笔记
  Questions/               # 问题索引与图谱
  Concepts/                # 概念页
  Reading/                 # 阅读项目(每本书一个目录)
  Artifacts/               # 实用模板
Writing/                   # 写作域(输出/生产)
  Novels/<作品>/           # 网文小说
    _作品.md               # type: writing-project
    _大纲.md               # type: outline(逐章梗概)
    _角色/                 # type: character
    _设定/                 # type: setting(世界观)
    01-章节.md             # type: chapter
  Papers/<论文>/           # 论文
  Articles/<长文>/         # 通用长文
```

Frontmatter 类型:`concept` / `question` / `reading-project` / `reading-note` / `writing-project` / `chapter` / `outline` / `character` / `setting`。

---

## 架构

```
src/
  core/
    llm/              LLM 客户端 + JSON 解析
    knowledge/        元数据知识索引
    artifact/         实用模板(检查表/SOP/复盘)类型、校验、渲染
    schema.ts         SCHEMA_VERSION + 工具函数
  ai/                 AI 能力模块(助手、分类器、阅读规划、写作规划、续写...)
  features/
    assistant/        AI 助手弹窗
    writing/          写作场景(新建作品、续写、项目/上下文管理)
    reading/          阅读项目管理
    concept/          概念补全
    question/         问题分类与图谱
    artifact/         实用模板生成
    dashboard/        知识债务看板
    sync/             百度网盘同步
    command-panel/    统一命令面板
  vault/              Vault 写入(冲突安全)
  settings/           设置页(知识/写作/辅助)
  actions/            动作注册与面板定义
  main.ts
```

---

## 隐私说明

AI 功能会把你选中的内容和部分笔记上下文发送到所配置的 API 端点。同步功能只上传到你自己的百度网盘。无遥测、无插件方服务器。详见 [PRIVACY.md](./PRIVACY.md) / [PRIVACY.zh-CN.md](./PRIVACY.zh-CN.md)。

---

## 路线图

### v3.0 — 写作场景(当前开发中)

- 三大业务场景:知识 / 写作 / 辅助;移除失效的执行模块
- 写作:新建作品(大纲 + 角色卡 + 世界观)、续写、生成下一章、润色、角色卡提取
- 数据边界:写作产物与知识库隔离,知识库问答默认排除写作内容
- 快捷入口:默认快捷键、状态栏按钮、右键菜单
- 全量移除 emoji,图标统一使用 Obsidian 原生 Lucide

### v3.1 — 写作工作台

- 侧边栏写作工作台视图:大纲树、章节字数与状态、设定速查
- 灵感碎片收集与展开
- 角色别名/昵称识别,设定注入更准
- 文风学习(基于前三章抽取样式)

### v3.2 — 集成与生态

- Tasks / Periodic Notes 集成
- 可选本地向量索引,增强知识库问答
- 多 Vault 支持

---

## 贡献

欢迎提 Issue / PR。请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。安全问题见 [SECURITY.md](./SECURITY.md)。

## 协议

MIT。详见 [LICENSE](./LICENSE)。
