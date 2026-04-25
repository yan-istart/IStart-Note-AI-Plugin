# IStart-Note-AI

基于 DeepSeek AI 的 Obsidian 知识图谱插件。将提问行为转化为结构化双链笔记，自动构建个人知识网络。

---

## 功能概览

| 功能 | 描述 |
|------|------|
| 普通提问 | 输入问题 → DeepSeek 回答 → 自动生成结构化笔记 |
| 框选提问 | 选中文本 → 基于上下文提问 → 生成带来源引用的笔记 |
| 问题分类 | 自动判断问题类型（新问题 / 深化 / 扩展）并建立关联 |
| 概念补全 | 按需补全空概念页，支持轻量 / 标准两种深度 |
| 批量扫描 | 扫描 Vault 中所有空概念页，批量补全 |
| 问题索引 | 自动维护问题图谱索引页 |

---

## 安装

### 手动安装

1. 构建插件（见下方开发指南）
2. 将 `dist/` 目录下的文件复制到 Vault 的 `.obsidian/plugins/istart-note-ai/`
3. 在 Obsidian 设置 → 第三方插件中启用 **IStart-Note-AI**

### 目录结构要求

插件会自动创建以下目录（可在设置中修改路径）：

```
Knowledge/
├── Q&A/          # 问答笔记
├── Concepts/     # 概念页
└── Questions/    # 问题索引
```

---

## 配置

进入 Obsidian 设置 → IStart-Note-AI：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| API Key | DeepSeek API Key，在 [platform.deepseek.com](https://platform.deepseek.com) 获取 | 空 |
| Base URL | API 地址 | `https://api.deepseek.com` |
| 模型 | `deepseek-chat` 或 `deepseek-reasoner` | `deepseek-chat` |
| Q&A 保存路径 | 问答笔记存储目录 | `Knowledge/Q&A` |
| 概念页路径 | 概念页存储目录 | `Knowledge/Concepts` |
| 问题索引路径 | 问题图谱索引目录 | `Knowledge/Questions` |
| 自动打开 Graph View | 生成笔记后自动打开图谱 | 关闭 |

---

## 使用方式

### 普通提问

- 快捷键：`Cmd/Ctrl + Shift + D`
- 侧边栏点击脑图标
- 命令面板：`向 DeepSeek 提问并生成知识笔记`

输入问题后，插件会：
1. 调用 DeepSeek 生成回答
2. 弹出问题分类确认弹窗（可手动调整类型）
3. 生成结构化 Markdown 笔记，包含 Answer / Concepts / Relations / 推荐问题
4. 自动创建相关概念页（空节点）
5. 更新问题索引页

### 框选提问

1. 在任意笔记中选中一段文字
2. 右键 → **IStart-Note-AI：基于选中内容提问**
   或快捷键 `Cmd/Ctrl + Shift + Q`
3. 在弹窗中输入针对该内容的问题
4. 生成的笔记包含来源引用，并在原笔记末尾追加反向链接

### 概念页补全

**单个补全：**
- 打开概念页 → 命令面板：`补全当前概念页`
- 编辑器内选中 `[[概念名]]` → 右键 → `IStart-Note-AI：补全概念 "xxx"`
- 文件列表右键任意 `.md` 文件 → `IStart-Note-AI：补全此概念页`

**批量补全：**
- 命令面板：`扫描空概念页`
- 从列表中选择（最多 5 个）→ 选择补全深度 → 确认

补全深度：
- **轻量**：定义 + 关联概念
- **标准**：定义 + 核心解释 + 示例 + 关联概念 + 相关问题

所有补全内容在写入前会弹出预览窗口，支持重新生成或取消。

### 问题索引

- 命令面板：`打开问题索引`
- 每次提问后自动更新对应索引页

---

## 笔记结构

### Q&A 笔记（普通提问）

```markdown
---
type: question
question: 五行是什么？
category: new
parent: null
related: []
concepts: [五行, 木, 火, 土, 金, 水]
status: linked
created_at: 2026-04-25
---

# 五行是什么？

## Question
## Answer
## Concepts
## Relations
## Tags
## 推荐问题
### 深化
### 扩展
```

### Q&A 笔记（框选提问）

```markdown
# 为什么阴阳平衡会影响系统稳定？

## 来源片段
> 阴阳平衡决定系统稳定性

来源：[[原始笔记路径]]

## Question
## Answer
## Concepts
## Relations
## 延伸问题
## Tags
```

### 概念页

```markdown
---
type: concept
name: 五行
status: completed
completion_status: completed
created_from: Q&A
created_at: 2026-04-25
updated_at: 2026-04-25
---

# 五行

## 定义
## 核心解释
## 示例
## 关联概念
## 相关问题
## 来源
```

---

## 开发指南

### 环境要求

- Node.js >= 16
- npm >= 8

### 本地开发

```bash
cd obsidian-deepseek-plugin
npm install
npm run dev        # 监听模式，输出到 dist/main.js
```

### 生产构建

```bash
npm run build      # 输出到 dist/main.js + dist/manifest.json
```

### 项目结构

```
src/
├── main.ts                    # 插件入口，注册命令 / 菜单 / 设置
├── types.ts                   # 全局类型定义
├── DeepSeekClient.ts          # 普通提问 API 调用
├── ContextQAClient.ts         # 框选提问 API 调用（带上下文）
├── VaultWriter.ts             # 笔记写入（Q&A / Context Q&A / 概念页）
├── QuestionModal.ts           # 普通提问弹窗
├── ContextQAModal.ts          # 框选提问弹窗
├── QuestionClassifier.ts      # 问题分类（new / refinement / expansion）
├── QuestionClassifyModal.ts   # 分类确认弹窗
├── QuestionGraphManager.ts    # 问题图谱：frontmatter / 索引页 / 推荐问题
├── ConceptCompleter.ts        # 概念补全 API 调用
├── ConceptPageManager.ts      # 概念页识别 / 增量写入 / 批量扫描
├── ConceptCompletionModal.ts  # 深度选择 / 预览确认 / 批量扫描弹窗
└── SettingsTab.ts             # 设置页面
```

### 扩展开发

**新增 AI 功能**：参考 `ContextQAClient.ts` 的模式，实现 `ask()` 方法并返回结构化 JSON。

**新增命令**：在 `main.ts` 的 `onload()` 中调用 `this.addCommand()`。

**新增右键菜单项**：在 `editor-menu` 或 `file-menu` 事件监听中追加 `menu.addItem()`。

**修改笔记模板**：编辑 `VaultWriter.ts` 中的 `buildNoteContent()` 或 `buildContextNoteContent()`。

**修改 Prompt**：编辑对应 Client 文件中的 prompt 常量。

---

## 版本历史

### v1.3.0
- 新增框选提问（Context Q&A）功能
- 框选提问支持上下文传入、来源引用、反向链接
- 插件更名为 IStart-Note-AI

### v1.2.0
- 新增问题图谱：自动分类（new / refinement / expansion）
- 新增问题索引页自动维护
- 新增推荐深化 / 扩展问题

### v1.1.0
- 新增概念页按需补全（轻量 / 标准）
- 新增批量扫描空概念页
- 新增预览确认弹窗
- 新增右键菜单支持

### v1.0.0
- 基础 Q&A 提问与笔记生成
- 自动创建概念页与双链
- DeepSeek API 配置

---

## License

MIT
