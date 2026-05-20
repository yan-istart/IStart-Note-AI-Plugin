# 隐私政策

_最近更新：2026-05-20。[English →](./PRIVACY.md)_

本文档描述 IStart-Note-AI 处理哪些数据、数据流向哪里、以及如何控制。插件完全运行在你的 Obsidian 客户端内：没有插件方服务器，不收集分析数据，也不上报遥测。

## 概览

- 插件只会把请求发到**你配置的 AI 服务**（默认 DeepSeek）。
- 启用百度云同步时，插件只会把文件上传到**你自己的百度网盘**。
- API Key、百度 OAuth Token 等凭证保存在 Vault 的插件数据文件里：`<你的 Vault>/.obsidian/plugins/istart-note-ai/data.json`。
- 不向其他第三方发送任何数据。

## 发送到 AI 服务的数据

触发 AI 功能时，插件会向**设置 → IStart-Note-AI → Base URL**（默认 `https://api.deepseek.com/v1/chat/completions`）发起 HTTPS 请求。

请求体可能包含：

| 来源 | 数据 | 触发时机 |
| --- | --- | --- |
| 选中文字 | 当前选中的文本 | 选中后调用 AI 助手 |
| 当前文件 | 当前文档内容（通常截断到约 2,000 字符） | 大多数动作 |
| 文件元数据 | 文件名、frontmatter `type` 字段 | 大多数动作 |
| 光标上下文 | 光标前最多约 500 字符 | 续写 / 空章节补全 |
| 概念名列表 | 概念目录下的所有文件名（用于自动双链） | 所有动作 |
| 问题历史 | 问答目录下最近 20 条问题标题 | 问题分类 |
| 阅读笔记 | 单个章节的笔记（截断到约 3,000 字符） | 章节总结、费曼测试 |
| 你的指令 | 你在助手中输入的自然语言指令 | 始终发送 |

插件不会读取你显式配置之外的目录，也不会把 API Key 发往配置的 endpoint 之外的任何地方。

具体数据由所配置服务的隐私政策约束。请自行查阅：

- DeepSeek：<https://platform.deepseek.com>
- 其他兼容服务请查阅对应官方文档。

## 上传到百度网盘的数据

百度云同步**默认关闭**。在**设置 → IStart-Note-AI → 百度云同步**中启用时，你需要提供：

- 在 [百度网盘开放平台](https://pan.baidu.com/union) 注册的 **App ID** 与 **App Secret**。
- 一次性 OAuth 授权码，插件会换取 `accessToken` 与 `refreshToken`。

启用后，插件会把以下内容上传到你自己百度网盘的指定路径（默认 `/apps/istart-note-ai`）：

- **笔记**：你选择同步的目录下的 markdown 文件。
- **插件配置（可选）**：不含凭证的小型 JSON 文件。
- **插件本身（可选）**：`.obsidian/plugins/istart-note-ai/` 下的编译产物。
- **Obsidian 配置（可选）**：`.obsidian/` 下的部分文件（工具栏、快捷键、外观、社区插件）。

文件通过百度网盘 REST API 走 HTTPS 上传。**插件不做端到端加密**，安全边界等同你百度网盘账号的安全。

你可以随时关闭同步。删除插件 data.json 或在「设置 → 第三方插件 → 重置」可清除本地存储的百度凭证。

## 凭证存放位置

所有设置（含 DeepSeek API Key、百度 App Secret、百度 access/refresh token）都存在：

```
<你的 Vault>/.obsidian/plugins/istart-note-ai/data.json
```

Vault 内的内容默认是本地的，除非你主动同步到别处。插件本身不会传输这个文件。

如果你通过 iCloud、Obsidian Sync、Git 等方式同步 Vault，**是否包含 `data.json` 由你的同步工具决定**。Obsidian 默认是包含的。如需排除，请在同步工具中添加忽略规则。

## 不会收集的内容

- 不收集遥测 / 使用分析 / 崩溃日志。
- 除配置的 AI 服务和百度网盘外，不向任何外部地址发请求。
- 同步关闭时不会有后台上传。
- 不收集 prompts 与笔记之外的个人信息。

## 移动端

插件支持 Obsidian Mobile，规则与桌面端一致。AI 请求走同一 endpoint，百度同步使用同一套 OAuth 凭证。

## 数据保留与删除

- **本地数据**：删除 `<你的 Vault>/.obsidian/plugins/istart-note-ai/data.json`。
- **百度网盘**：在百度网盘网页 / 客户端上删除同步目录（默认 `/apps/istart-note-ai`）。
- **AI 服务**：请参阅对应服务的数据保留策略；插件本身不留任何记录。

## 反馈渠道

安全或隐私问题请按 [SECURITY.md](./SECURITY.md) 流程提交。其他问题请在 GitHub 上提 issue。
