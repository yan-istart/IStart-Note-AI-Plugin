# IStart-Note-AI

<p align="center">
  <strong>把 Obsidian 笔记变成"知识 → 执行"的个人系统。</strong>
</p>

<p align="center">
  <a href="./README.md">English</a> ·
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

IStart-Note-AI 是一个面向 Obsidian 的 AI 插件，围绕 **知识沉淀、执行计划、同步辅助** 三个模块，帮助你把零散笔记转化为可检索、可关联、可执行的个人知识系统。

一个统一 AI 入口，连接三类能力：知识沉淀、执行计划、辅助同步。

> [!warning] 测试版
> v2.0.0 引入了重大架构变更。Frontmatter schema 和定时任务模型尚未稳定。升级前请备份 Vault。

---

## 三大模块

### 1. 知识 Knowledge

构建和维护结构化知识库。

- **提问**并生成 Q&A 笔记，自动提取概念和关系。
- **问题分类**：new / refinement / expansion，维护问题演化图。
- **概念页创建与补全**：定义、解释、示例、关联概念、领域 MOC 索引。
- **阅读项目**：全书骨架、章节预设问题、章节总结、费曼测试。
- **知识库问答**：基于 Vault 索引检索回答，附带 `[[来源]]` 引用。
- **知识债务看板**：空概念、孤立问题、未完成阅读、长期草稿一目了然。

### 2. 执行 Execution

把知识转化为可审查的行动。

- **生成执行计划**：预览所有 Vault 修改后再执行。
- **执行日志**：自动记录到 `Knowledge/_Executions/`。
- **定时任务**（MVP）：每日知识债务扫描、自动百度备份。
- **安全优先**：AI 写入需要确认，批量操作有上限，高风险计划强制二次确认。
- 未来：diff 预览、回滚、任务集成。

### 3. 辅助 Auxiliary

跨设备和多服务的基础支撑。

- **OpenAI 兼容 LLM**：默认 DeepSeek，切换 Base URL 可用其他服务。
- **输出风格可选**：知识库、技术、极简、产品、学术、叙事、仪表盘。
- **百度网盘同步**（可选）：增量备份、双向同步、插件和 Obsidian 配置备份。
- **诊断与隐私**：查看数据流说明、导出配置、重建索引、清理日志。

---

## 状态

| 模块 | 功能 | 状态 | 说明 |
| --- | --- | --- | --- |
| 知识 | AI 助手 | 稳定 | 插入 / 替换 / 追加 / 仅展示 |
| 知识 | 阅读项目 | 稳定 | 骨架、章节问题、总结、费曼 |
| 知识 | 概念页补全 | 实验中 | 已接入命令面板，预览后写入 |
| 知识 | 问题图谱 | 实验中 | 分类 + 索引 + Mermaid 演化图 |
| 知识 | 知识库问答 | 实验中 | 元数据索引检索，无 embedding |
| 知识 | 知识债务 | 实验中 | 空概念 / 孤立问题 / 草稿统计 |
| 执行 | 执行计划 | 实验中 | PlanBuilder + Executor，无回滚 |
| 执行 | 定时任务 | 规划中 | 类型定义完成，runner 开发中 |
| 辅助 | 百度同步 | 稳定 | 手动/自动备份与配置同步 |
| 辅助 | 多 Provider | 部分 | 支持 OpenAI 兼容 Base URL |

---

## 快速开始

1. 安装插件（见下方安装说明）。
2. 进入**设置 → IStart-Note-AI → 辅助 → AI 服务**，输入 API Key。
3. 点击侧边栏 🧠 图标或命令面板 → **IStart-Note-AI: AI 助手**。
4. 用自然语言输入指令。

---

## 安装

### 社区插件商店（审核后可用）

1. 设置 → 第三方插件 → 浏览 → 搜索 **IStart-Note-AI**。
2. 安装 → 启用。

### 手动安装（测试期推荐）

从 [GitHub Release](https://github.com/yan-istart/IStart-Note-AI-Plugin/releases) 下载 `main.js`、`manifest.json`、`styles.css`，放到 `<Vault>/.obsidian/plugins/istart-note-ai/`。

### 从源码构建

```bash
npm ci && npm run build
# → dist/main.js, dist/manifest.json, dist/styles.css
```

---

## 设置

设置页按三个标签组织：

| 标签 | 主要设置 |
| --- | --- |
| **知识** | Q&A 路径、概念路径、问题索引路径、知识索引状态与重建 |
| **执行** | 执行日志目录、安全策略、定时任务（v2.1） |
| **辅助** | API Key、Base URL、模型、输出风格、百度同步、隐私说明 |

---

## 使用

### 桌面

- 🧠 侧边栏图标 → 命令面板（知识 / 执行 / 辅助）。
- 编辑器右键 → `IStart-Note-AI: AI 助手` 或 `知识库问答`。
- 文件列表右键 → `IStart-Note-AI: AI 助手`。

### 移动端

- 🧠 侧边栏图标 → 命令面板。
- 把命令添加到移动工具栏。

---

## 隐私说明

AI 功能会把你选中的内容和部分笔记上下文发送到所配置的 API 端点。同步功能只上传到你自己的百度网盘。无遥测、无插件方服务器。详见 [PRIVACY.md](./PRIVACY.md) / [PRIVACY.zh-CN.md](./PRIVACY.zh-CN.md)。

---

## 路线图

### v2.0 — 知识系统基础版（当前）

- 三模块产品结构：知识 / 执行 / 辅助。
- Vault 级轻量知识索引。
- 概念补全和问题图谱接入命令面板。
- 知识债务看板。
- 基础执行计划和执行日志。
- 分组设置页。
- 开源治理和隐私文档。

### v2.1 — 执行 MVP

- 定时任务运行时。
- 执行计划预览 Modal + diff。
- AI 写入默认 plan-only。
- 执行历史视图。

### v2.2 — 信任与控制

- 回滚最近执行。
- 更细粒度的隐私控制。
- 可选本地向量索引。

### v3.0 — 集成

- Tasks / Periodic Notes 集成。
- GitHub Issues / Linear / Todoist 导出。

---

## 贡献

欢迎提 Issue / PR。请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。安全问题见 [SECURITY.md](./SECURITY.md)。

## 协议

MIT。详见 [LICENSE](./LICENSE)。
