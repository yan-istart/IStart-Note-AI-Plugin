# 写作 Skill

IStart-Note-AI 支持读取标准 **Agent Skills**。同一份 `SKILL.md` 可以同时用于：

- IStart-Note-AI 的写作类 AI 请求
- Codex CLI
- OpenCode

插件不会执行 Skill 中的脚本，只会把 `SKILL.md` 正文注入 system prompt。`references/` 和 `scripts/` 主要供 Codex/OpenCode 使用。

## 目录

推荐在 Vault 内使用可见的 `Skills/` 作为插件主目录：

```text
<vault>/Skills/
├── writing-craft/
│   └── SKILL.md
├── writing-webnovel/
│   └── SKILL.md
└── work-example/
    └── SKILL.md
```

Codex 和 OpenCode 默认扫描 `.agents/skills`。可以让它指向 `Skills/`：

```bash
cd <vault>
mkdir -p .agents/skills
ln -s ../../Skills/writing-craft .agents/skills/writing-craft
ln -s ../../Skills/writing-webnovel .agents/skills/writing-webnovel
ln -s ../../Skills/work-example .agents/skills/work-example
```

也可以直接把 Skill 放在 `.agents/skills`。插件默认同时扫描：

```text
Skills
.agents/skills
```

两者中同名 ID 以 `Skills` 优先。

## Frontmatter

标准字段：

```yaml
---
name: writing-craft
description: Use when drafting, continuing, revising, or critiquing prose in this vault.
metadata:
  istart/scope: global
  istart/apply: writing
  istart/priority: 10
---
```

`name` 和 `description` 供 Codex/OpenCode 发现 Skill。`metadata` 中的 `istart/*` 字段只由本插件解释，其他 Agent 会忽略。

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `istart/scope` | `global` / `genre` / `project` | 注入范围，默认 `global` |
| `istart/apply` | `writing` / `all` | 默认 `writing`；`all` 允许进入非写作 AI 请求 |
| `istart/genre` | `novel` / `paper` / `article` / `any` | 体裁匹配，`any` 表示不限制 |
| `istart/project` | 作品标题 | 作品级匹配 |
| `istart/project-path` | `Writing/Novels/作品` | 优先于标题匹配 |
| `istart/priority` | 数字 | 数字越大越先占用注入预算 |

默认优先级：

- `project`: 30
- `genre`: 20
- `global`: 10

## 三层 Skill

### 公共技巧

```yaml
metadata:
  istart/scope: global
  istart/apply: writing
```

适用于所有写作任务。只放可复用的写作方法，不放具体作品事实。

### 体裁规范

```yaml
metadata:
  istart/scope: genre
  istart/genre: novel
```

仅在当前作品体裁匹配时注入。

### 作品规范

```yaml
metadata:
  istart/scope: project
  istart/project: 示例作品
  istart/project-path: Writing/Novels/示例作品
  istart/genre: novel
```

插件从当前章节文件向上查找 `_作品.md`，自动识别作品目录、标题和体裁。作品 Skill 只写：

- 视角、时态、文风
- 节奏和章节习惯
- 禁止项和内容边界
- 续写前检查清单

人物、剧情、世界观事实仍以 `_作品.md`、`_大纲.md`、`_角色/`、`_设定/` 为准，不要重复到 Skill 里。

## 注入顺序

```text
功能基础 system prompt
→ 通用 Skill
→ 体裁 Skill
→ 作品 Skill
→ 当前作品上下文
→ 用户请求
```

作品 Skill 优先级最高。总注入量受“最大注入字符”限制，作品 Skill 先占用预算。

## 插件设置

设置 → **Skill**：

- 启用自动附带
- 仅在写作场景注入
- Skill 根目录（每行一个 Vault 相对路径）
- 最大注入字符
- 已发现 Skill 列表与单独开关

关闭某个 Skill 只会阻止插件自动注入，不会影响 Codex/OpenCode。

## 与 Agent 配合

OpenCode 可以直接声明：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "skills": ["./Skills"]
}
```

Codex 使用 `.agents/skills`。如果 Skill 放在全局目录，也可以放到：

```text
~/.agents/skills/<id>/SKILL.md
```

Agent 的自动调用依赖 `description`。需要保证某次使用某个 Skill 时，显式调用：

- Codex：`$work-example`
- OpenCode：`@work-example`

插件端不需要显式调用，会根据 `scope` 自动注入。

## 同步

`.agents` 是隐藏目录，当前插件的 Git 同步默认排除隐藏路径。推荐：

- `Skills/` 作为可见主目录，随 Vault 同步
- `.agents/skills` 只作为本地 Agent 的桥接

`.agents` 中的真实文件也可以通过插件设置中的额外根目录或其它同步方案处理。

## 安全

Skill 会被当作系统级指令注入。只启用可信 Skill。插件不会执行 Skill 中的脚本；Codex/OpenCode 是否执行 `scripts/` 取决于它们自身的权限设置。

## 示例

仓库中的示例可以直接复制到 Vault：

```text
examples/skills/writing-craft/SKILL.md
examples/skills/writing-webnovel/SKILL.md
examples/skills/work-example/SKILL.md
```
