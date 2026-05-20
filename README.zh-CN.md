# IStart-Note-AI

> [!warning] 测试版软件
> IStart-Note-AI 仍在持续开发中。下文标记为**实验中**的功能可能在没有提前通知的情况下变更或移除。Frontmatter schema 尚未稳定，尝试新功能前请先备份你的 Vault。

[English README →](./README.md)

把笔记升级成可被结构化、可被检索、可被执行的个人知识系统的 Obsidian 插件。统一的 AI 助手帮你起草、扩写、组织笔记，并自动维护概念页、双链、阅读项目，可选搭配百度云同步。

底层使用 OpenAI 兼容的 chat completions 接口，默认接入 [DeepSeek](https://platform.deepseek.com)，更换 Base URL 可使用其他兼容服务。

---

## 功能状态总览

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| AI 助手（插入 / 替换 / 追加 / 仅展示） | 稳定 | 命令面板单一入口，配套内容分类 + 结构化 Prompt + Markdown 美化 |
| 阅读项目 | 稳定 | 全书骨架、章节预设问题、章节总结、费曼测试 |
| 百度云同步（笔记 + 插件配置） | 稳定 | 手动与自动模式、冲突策略、插件本身 / Obsidian 配置备份 |
| 文档美化 | 稳定 | 重新组织标题，加入 Callout 和 Mermaid |
| 概念页自动创建 | 稳定 | 从 `[[概念]]` 自动扫描并创建空概念页 |
| 概念页智能补全（`ConceptCompleter`） | 实验中 | 内部实现已就绪，尚未接入命令面板 |
| 问题图谱（`QuestionGraphManager`） | 实验中 | 已支持 frontmatter 分类与 Mermaid 演化图，尚未接入命令面板 |
| Vault 级知识检索 | 未实现 | 列入 v2 |
| 执行计划 / 预览 / 回滚 | 未实现 | 列入 v3 |

---

## 主要功能

### AI 助手（统一入口）

选中文字或停在光标处，用自然语言描述你想做的事：

- **扩写 / 改写**选中文字
- **解释**某个术语
- **生成图表**（流程图、时序图、状态图、类图、ER、甘特图）和 LaTeX 公式
- **补全**当前空章节
- **续写**光标后的内容
- **总结**当前文档
- **美化**已有内容（加 Callout、双链、视觉分隔）

也支持快捷标签：`[扩写]` `[解释]` `[画图]` `[补全]` `[续写]` `[总结]` `[公式]` `[时序图]`。

### 结构化输出

模型输出会做一层后处理，按知识库风格统一：短段落、Obsidian Callout（`> [!summary]`、`> [!warning]`、`> [!tip]`）、必要时的 Mermaid 图，以及对已有概念页自动加 `[[双链]]`。输出风格可切换：technical / minimal / academic / product / story / dashboard。

### 阅读项目

把一本书变成一份可执行的阅读计划：

1. 输入书名（可选粘贴目录）。
2. 插件生成阅读路线图、章节关系、读前问题。
3. 边读边记，再生成章节总结与费曼测试。

### 知识组织

- 新概念先落到 `Knowledge/Concepts/_未分类/`。
- 补全完成后，按 domain 自动归类到子目录。
- 自动维护 domain MOC 索引页（含 Mermaid 概览图）。
- 问题索引下生成问题演化图。

### 百度云同步（可选）

- 增量备份 / 双向同步 / 强制覆盖。
- 可选连同插件本身及 Obsidian 配置（工具栏、快捷键、外观）一起备份。
- 可选生成笔记后自动备份。

> [!info] 隐私说明
> AI 功能会把你选中的内容以及当前笔记的部分上下文发送到所配置的 chat-completions 接口。同步功能会把笔记（可选 Obsidian 配置）上传到你自己的百度网盘。完整数据流见 [PRIVACY.md](./PRIVACY.md)。

---

## 环境要求

- Obsidian 1.7.2 及以上。
- DeepSeek 或其它 OpenAI 兼容服务的 API Key。
- 百度云同步（可选）：百度网盘开放平台 App ID 与 App Secret。

---

## 安装

### 从社区插件商店（首选）

正在准备提交。审核通过后：

1. 设置 → 第三方插件 → 浏览。
2. 搜索 **IStart-Note-AI**。
3. 安装 → 启用。

### 手动安装（测试版推荐方式）

从 [GitHub Release](https://github.com/yan-istart/IStart-Note-AI-Plugin/releases) 下载 `main.js`、`manifest.json`、`styles.css`，放到 `<你的 Vault>/.obsidian/plugins/istart-note-ai/` 目录下。

> 不要直接克隆源码安装：构建产物在 `dist/`，并不入库。请始终使用 release 资产。

### 从源码构建

```bash
npm ci
npm run build
# dist/main.js、dist/manifest.json、dist/styles.css 即为安装文件
```

---

## 设置项

设置 → IStart-Note-AI：

| 设置 | 说明 | 默认 |
| --- | --- | --- |
| API Key | DeepSeek API Key（或兼容服务） | — |
| Base URL | chat completions 根地址 | `https://api.deepseek.com` |
| 模型 | `deepseek-v4-flash` 或 `deepseek-v4-pro` | `deepseek-v4-flash` |
| 输出风格 | 知识库、技术、极简、产品、学术、故事、仪表盘 | 知识库 |
| 问答目录 | Q&A 笔记保存路径 | `Knowledge/Q&A` |
| 概念目录 | 概念页保存路径 | `Knowledge/Concepts` |
| 百度云同步 | 启用、App ID/Secret、远端路径、自动备份、忽略规则 | 关闭 |

---

## 使用方式

### 桌面端

- 🧠 **侧边栏图标**：打开命令面板。
- **编辑器右键** → `IStart-Note-AI: AI 助手`。
- **文件列表右键** → `IStart-Note-AI: AI 助手`。

### 移动端

- 🧠 **侧边栏图标**：打开命令面板。
- 把 `AI 助手` 添加到移动工具栏，可一键唤起。

### 工作流

1. 可选：选中文字。
2. 点击 🧠 或右键 → AI 助手。
3. 输入指令（或用快捷标签，或留空让插件自动判断）。
4. 预览结果，选择插入 / 替换 / 追加 / 仅展示。

---

## 目录结构

```
src/
  core/           # 跨功能基础设施
    llm/          # 统一 LLM 客户端 + JSON 提取
  ai/             # AI 功能（助手、分类器、Planner ...）
  features/       # 各功能 UI 与管理器
  vault/          # Vault 写入层
  settings/
  actions/        # action 注册 / 命令面板
  main.ts
```

`core/llm` 是所有 chat-completions 调用的唯一入口。新增 AI 功能应该依赖它，而不是直接调用 `requestUrl`。

---

## 路线图

- v1.9（进行中）：统一 LLM 客户端、基础 Vault 检索、AI 操作预览、补齐开源治理。
- v2.0：带来源引用的 Vault 级检索、问题图谱与概念成熟度看板。
- v3.0：执行引擎 —— 把笔记转换为可预览、可回滚的计划（任务、决策、项目）。

更长期规划见仓库 issue。

---

## 贡献

欢迎提 Issue / PR。请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。安全相关问题请按 [SECURITY.md](./SECURITY.md) 流程提交。

## 协议

MIT。详见 [LICENSE](./LICENSE)。
