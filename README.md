# IStart-Note-AI

<p align="center">
  <strong>把 Obsidian 变成你的个人知识系统与写作工作台。</strong>
</p>

<p align="center">
  <a href="./README.en.md">English</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#隐私说明">隐私说明</a> ·
  <a href="#当前限制">当前限制</a>
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
- 辅助:AI 助手、文档美化、模型设置、百度网盘同步

---

## English

IStart-Note-AI is an Obsidian plugin built around three business scenarios: **Knowledge** (read in), **Writing** (write out), and **Auxiliary** (cross-device support).

- **Knowledge** — turn scattered notes into a searchable, interlinked knowledge system: Q&A generation, concept pages, reading project templates, vault Q&A with source citations, and a knowledge-debt dashboard.
- **Writing** — turn ideas into works (web novels, papers, long-form articles): generate outlines, characters, and world settings; continue writing from the cursor with setting injection; generate the next chapter; import existing manuscripts (split, classify, clean) without touching the originals.
- **Auxiliary** — configurable chat-completions endpoint with two fixed DeepSeek model choices, multiple output styles, and optional Baidu Pan sync.

For the full English documentation see [README.en.md](./README.en.md).

> 本文按当前源码实现整理。`package.json` 与 `manifest.json` 标注版本为 **2.2.6**，最低支持 **Obsidian 1.7.2**。

---

## 三大模块

### 1. 知识 Knowledge

输入与沉淀,构建结构化知识库。

- **知识提问**:提问 → 自动分类并确认 → 生成 Q&A → 更新问题图谱
- **概念页**:自动创建、空页扫描、批量补全(定义/解释/示例/关联)；单页补全先预览，批量补全直接写入所选页面
- **阅读项目**:输入书名与可选目录，生成全书骨架、章节预设问题、核心概念页和含总结区块的笔记模板
- **知识库问答**:基于 Vault 元数据索引检索,回答附带 `[[来源]]` 引用
- **知识债务看板**:空概念、孤立问题、未完成阅读、长期草稿
- **实用模板**:从当前知识生成检查表、SOP、例行流程、行动计划、复盘表、问题清单、决策记录或自定义格式，预览后保存

### 2. 写作 Writing

输出与生产,把你的灵感变成作品。支持三种体裁:**网文小说 / 论文 / 通用长文**。

- **新建作品**:输入一句话简介，先预览 AI 规划，再创建作品首页、逐章大纲(含梗概)、章节模板;小说额外生成角色卡与世界观设定
- **导入原稿**:把已有小说、论文或长文原稿(粘贴/当前文件/Vault 文件/Vault 文件夹/桌面本地文件/桌面本地文件夹，支持 `.md`、`.txt`)导入为写作项目——自动切章、内容归类(规则预判 + 可选 AI 智能识别，正文/大纲/设定/资料/跳过，可手动调整分类、合并相邻章节)、清洗水印、AI 反推文风与设定,原稿不动
- **续写**(核心):从光标处或文末接着写,自动带入上文、本章/前后章梗概、文风基调,并注入相关角色卡与世界观设定
- **插写**:把光标放在两段正文之间，同时参考前后文，补充承上启下、解释或转场内容；预览后插入，保留两侧原文。普通笔记与写作章节均支持，章节额外带入大纲和相关设定
- **生成下一章**:按大纲梗概生成完整新章,先预览后写入
- **润色**:选区改写,保持作品文风
- **提取角色卡**:仅限小说，分析当前章节前 6,000 字符内的角色，写入 `_角色/`

写作项目存放在可配置的 `Writing/` 根目录。知识库问答按 frontmatter 类型排除 `chapter`、`writing-project`、`character`、`setting`、`outline`、`snippet`。当前没有设置开关，也不按整个目录排除；无类型笔记和导入的 `reference` 资料仍可能被检索。

### 3. 辅助 Auxiliary

- **AI 助手**:用自然语言处理选区、当前文档或光标上下文，预览后替换选区、插入或追加，也可复制结果或创建概念页
- **AI 服务**:默认 DeepSeek，可配置 API Key 与 Base URL，请求为 `POST {baseUrl}/v1/chat/completions`。模型下拉框仅提供 `deepseek-v4-flash`（默认）和 `deepseek-v4-pro`；其他端点需接受所选模型名称。当前没有自定义模型输入或 Provider 管理器
- **美化当前文档**:AI 重组结构、插入 Callout、双链及适当的 Mermaid 图，预览后替换全文
- **输出风格可选**:知识库、技术、极简、产品、学术、叙事、卡片化
- **百度网盘同步**(可选):Git 提交历史、双向增量同步、文本合并与单文件版本恢复；兼容原有文件备份方式

Git 模式：在设置中启用百度网盘同步、填写百度 App ID、App Secret 并完成授权，选择「Git 版本同步」，再点击「打开同步」或侧边栏「手动同步」。自动同步与启动时自动拉取配置默认关闭。电脑与手机使用同一套同步内核；应用在前台时才支持可选自动同步。

同步默认关闭；新安装默认选择 Git 模式，未记录同步方式的已有配置保留原有文件模式，需要手动切换到 Git。各设备需使用相同远端路径与 Git 模式，旧备份不会被删除。首次 Git 同步从当前本地笔记创建历史；若需要旧云端备份，请先用原有模式恢复。详见 [Git 同步说明](./docs/git-sync.md)。

---

## 当前限制

- 知识库问答用内存元数据索引匹配标题、标签、标题层级、链接、概念与领域，最多检索 8 篇笔记，每篇提供前 600 字符，并带入选中文字；没有 embedding 或全文语义检索。
- 阅读项目创建会生成读前问题和笔记模板；当前未注册补全阅读项目、生成章节总结、费曼测试的独立命令，可通过 AI 助手处理这些任务。
- 普通笔记也可续写；`type: chapter` 的章节续写会额外带入大纲、角色和设定。生成下一章要求打开章节笔记。新建作品生成的是章节模板，不是完整正文。
- 小说设定注入按上文、梗概与指令中的名字匹配，包含主角，最多注入 3 个角色和 2 个世界观设定；暂不自动识别别名。
- Git 同步已有内核与适配器自动化测试；百度授权、真实网络服务及 Android/iOS 真机行为仍需安装后验证，详见同步说明。

---

## 快速开始

1. 安装插件(见[安装](#安装))。
2. 进入**设置 → IStart-Note-AI → 辅助 → AI 服务**,输入 API Key。
3. 点击左侧脑形图标打开功能面板 → **AI 助手**，或从 Obsidian 命令面板选择 IStart-Note-AI 命令。
4. 用自然语言输入指令,或在**写作**分组里新建作品、续写章节。

---

## 安装

### 社区插件商店

若在设置 → 第三方插件 → 浏览中可以搜索到 **IStart-Note-AI**，可直接安装并启用；否则使用手动安装或源码构建。

### 手动安装

从 [GitHub Release](https://github.com/yan-istart/IStart-Note-AI-Plugin/releases) 下载 `main.js`、`manifest.json`、`styles.css`,放入 `<Vault>/.obsidian/plugins/istart-note-ai/`。

> 克隆源码后需自行构建；可使用 Release 资产，或复制源码构建生成的 `dist/` 文件。

### 从源码构建

```bash
npm ci && npm run build
# → dist/main.js, dist/manifest.json, dist/styles.css
```

---

## 设置

AI 默认值：Base URL 为 `https://api.deepseek.com`，模型为 `deepseek-v4-flash`，输出风格为 `knowledge-base`。Base URL 填根地址，不加末尾斜杠或 `/v1/chat/completions`，客户端会追加该后缀。

设置页按三个标签组织:

| 标签 | 主要设置 |
| --- | --- |
| **知识** | Q&A 目录、问题索引目录、概念页目录、知识索引状态与重建 |
| **写作** | 作品目录（`Writing`）、上下文长度（续写上文或插写每侧各 2,000 字符）、续写目标（800 中文字）、插写目标（200 中文字） |
| **辅助** | API Key、Base URL、模型、输出风格、百度同步、隐私说明 |

---

## 使用

### 桌面

- 命令面板:侧边栏图标一键呼出,三域分组(知识 / 写作 / 辅助);打开章节或作品首页时写作分组置顶
- 快捷键：插件没有注册默认快捷键，可在 Obsidian 设置 → 快捷键中为 AI 助手、续写、插写、下一章、新建作品等命令自行绑定。
- 状态栏:打开章节文件时显示「续写」「下一章」一键按钮
- 编辑器右键：AI 助手、知识库问答、概念补全、实用模板、美化文档；无选区时显示续写、插写及各自设置，选中文字时显示润色、扩写、解释，章节笔记额外显示提取角色卡
- 文件列表右键：AI 助手 / 美化文档；实际操作使用当前编辑器，请先打开目标笔记
- 云形图标：打开百度同步侧边栏，Git 模式提供手动同步和版本历史

### 移动端

- 从导航菜单中的 IStart-Note-AI 图标或「打开功能面板」命令进入。面板顶部根据当前文件与选区显示常用操作，使用 Phosphor Duotone 图标和短标签；其余操作收进「全部功能」。
- 无选区且光标前后都有正文时，面板和助手优先显示「插写」；文末优先「续写」。「全部功能」保留续写与插写两个入口。
- 在 Obsidian 设置 → 界面 → 配置移动工具栏 → 添加命令，将「续写」「插写」「润色选中文字」「扩写」「解释」「总结」等加入工具栏；这些命令使用同组 Phosphor Bold 图标，插写采用向中间汇合的箭头。
- 续写直接使用默认参数生成预览；「续写设置」可调整光标/文末、目标字数（300/800/1500 或自定义）及附加指令。位置和字数会保存为后续默认值。
- 插写直接生成短篇预览，默认 200 字；「插写设置」提供 100/200/300 字或自定义字数，以及「承上启下」「补充解释」「转场」要求，字数独立保存。插写需要取消选区并将光标放在两段正文之间，文首、文末及元数据内会提示调整位置。
- 续写结果页「插入并继续」先插入当前结果，再承接新增正文；插写结果确认后只插入连接内容。「更多 → 重新生成」只重试当前任务。生成前记录原文件、光标和选区，原文变化或切换文档时会阻止直接写入，结果仍可复制。
- 助手、续写、插写、提问、新建作品和结果预览采用紧凑弹窗，表单独立滚动，底部按钮随键盘上移；移动端不主动聚焦输入框。
- Vault 外的本地文件/文件夹导入仅支持桌面端；移动端可使用粘贴或 Vault 内来源。

---

## 数据目录

以下为默认布局。Q&A、Questions、Concepts 与 Writing 路径可配置；Reading 和 Artifacts 当前使用固定路径：

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
    _资料/                 # 导入的大纲与参考资料，type: reference
    01-章节.md             # type: chapter
  Papers/<论文>/           # 论文
  Articles/<长文>/         # 通用长文
```

Frontmatter 类型:`concept` / `question` / `reading-project` / `reading-note` / `writing-project` / `chapter` / `outline` / `character` / `setting` / `reference`；实用模板使用 `execution-artifact-*` 类型。

---

## 架构

```
src/
  core/
    llm/              LLM 客户端 + JSON 解析
    knowledge/        元数据知识索引
    artifact/         实用模板(检查表/SOP/复盘)类型、校验、渲染
    sync/             JavaScript Git 内核、版本包交换、合并与恢复
    schema.ts         SCHEMA_VERSION + 工具函数
  ai/                 AI 能力模块(助手、分类器、阅读规划、写作规划、续写...)
  features/
    assistant/        AI 助手弹窗
    writing/          新建作品、规划预览、续写、原稿导入、项目/上下文管理
    reading/          阅读项目管理
    concept/          概念补全
    question/         问题分类与图谱
    artifact/         实用模板生成
    dashboard/        知识债务看板
    sync/             百度网盘同步
    command-panel/    统一命令面板
  vault/              Q&A 与概念页写入
  settings/           设置页(知识/写作/辅助)
  actions/            动作注册与面板定义
  main.ts
```

---

## 隐私说明

AI 功能会把你选中的内容和部分笔记上下文发送到所配置的 API 端点。同步功能只上传到你自己的百度网盘。Git 笔记同步排除隐藏路径、Obsidian 配置目录、凭证及 Git 元数据；历史会保留已删除笔记的旧内容，未提供额外加密。独立配置同步不含 API Key 与百度凭证，文件模式启用「备份插件本身」时会上传插件 `data.json`（含凭证）及部分 Obsidian 配置。无遥测、无插件方服务器。详见 [PRIVACY.md](./PRIVACY.md) / [PRIVACY.zh-CN.md](./PRIVACY.zh-CN.md)。

---

## 同步与配置迁移

文件模式保留备份、恢复、状态扫描、双向同步、逐文件冲突选择与可选插件备份。「自动备份」设置仍保留，但当前笔记生成流程没有触发该操作，请使用手动备份。

Git 模式同步符合规则的普通 Vault 文件，包含附件与删除，使用忽略正则与大小限制（默认单文件 100 MB）。它保存提交、交换增量 Git bundle、合并文本、处理冲突并恢复单文件历史版本，无需系统 Git。自动同步默认关闭，开启后在启动时和应用可见时每分钟执行。

配置推送/拉取传递 Base URL、模型、三个知识路径、自动打开图谱、远端路径、忽略规则与大小限制。写作设置、输出风格、凭证、同步方式和自动行为保持本地设置；启动时拉取配置默认关闭。迁移步骤、本地历史位置与恢复细节见 [Git 同步说明](./docs/git-sync.md)。

---

## 贡献

欢迎提 Issue / PR。请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。安全问题见 [SECURITY.md](./SECURITY.md)。

## 协议

MIT。详见 [LICENSE](./LICENSE)。
