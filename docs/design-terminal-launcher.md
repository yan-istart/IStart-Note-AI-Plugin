# PC 终端快捷入口设计方案

> 状态:已确认(2026-11-20),**M1 + M2 已实现**,M3(助手快捷入口)待做。
> 范围:桌面端一键打开系统自带终端,定位到当前笔记所在目录(无活动笔记时回退 Vault 根);工作台新增「终端」tab。不内置 CLI 工具、不执行命令、不做工具初始化。移动端不提供。

---

## 1. 背景与目标

插件已与 Codex/OpenCode 共享 `Skills/`(见 [写作 Skill](./skills.md)),用户从 Obsidian 切换到 CLI Agent 时要手动开终端、手动 `cd` 到 Vault,路径长、有空格时很麻烦。

**目标(首版)**:

1. 一键打开**系统自带终端**,工作目录为**当前笔记所在目录**;无活动笔记时回退 **Vault 根**。
2. 同时提供「在终端打开 Vault」命令,满足从 Vault 根启动 `opencode` 等 Agent 的场景。
3. 纯桌面功能:移动端不注册、不显示;无网络请求、设置仅存本地。

**不做**:CLI 工具预设与自动执行命令(用户自己在终端里输入)、`opencode.json` 初始化、内嵌终端。

---

## 2. 方案对比与决策

| 方案 | 说明 | 结论 |
|---|---|---|
| A. 启动系统终端(`child_process`) | 插件在桌面端调用 Node 内置 `child_process`,启动 macOS `open`、Windows `cmd`/`wt`、Linux 终端模拟器;终端窗口在 Obsidian 之外独立运行 | ✅ **采用**。零依赖、零常驻进程、符合「系统自带的命令控制台」 |
| B. 内嵌终端(xterm.js + PTY) | 在 Obsidian 内渲染终端 | ❌ 不采用。体积与 PTY 绑定复杂,移动端不可用,与需求不符 |
| C. 本地配套服务(参照 publishing-service) | 插件经 HTTP 调本机 Node 服务再启终端 | ❌ 过度设计。启动终端不需要常驻服务,`child_process` 即可 |

> 说明:Obsidian 桌面版插件可以 `require("child_process")` 等 Node 内置模块(移动端会抛错),因此必须用 `Platform.isDesktopApp` 门控并 try/catch。macOS App Store 沙盒版本可能限制子进程启动,需降级处理(见 3.4)。

---

## 3. 功能设计

### 3.1 入口

| 入口 | 内容 | 说明 |
|---|---|---|
| 工作台「终端」tab | 侧边栏启动面板:显示当前定位目录,按钮「在当前笔记所在目录打开」「在 Vault 打开」,默认位置切换与设置入口 | 仅桌面显示(移动端隐藏);点击 tab 切换到终端面板,与其他工作台页面同路由 |
| 命令面板 | 「在终端打开」(按默认位置)、「在终端打开当前笔记所在目录」「在终端打开 Vault」 | 桌面端才注册,`checkCallback: () => Platform.isDesktopApp` |
| 编辑器右键菜单 | 「在终端打开所在目录」 | 复用现有 `editor-menu` 注册方式 |
| 文件列表右键菜单 | 「在终端打开所在目录」 | 复用现有 `file-menu` 注册方式 |
| AI 助手快捷入口 | 输入区「终端」分组(M3,未实现) | 见 7 |
| 设置 | 设置页新增「终端」标签(仅桌面显示) | 见 4 |

### 3.1.1 工作台「终端」面板

tab 切换后侧边栏显示紧凑面板(桌面):

- **当前定位**:实时显示活动笔记所在目录路径,无活动笔记时显示 Vault 根,随活动笔记切换刷新。
- **打开按钮**:「在当前笔记所在目录打开」「在 Vault 打开」。
- **默认位置**:下拉切换「当前笔记所在目录 / 总是 Vault 根」,与设置联动。
- **设置入口**:跳转到设置页「终端」标签(macOS 终端应用、Linux 终端模板等)。
- **降级提示**:启动失败(MAS 沙盒等)时面板内显示原因与「复制目录路径」按钮。

面板只读展示与按钮操作,不内嵌终端窗口。工作台导航在移动端不渲染该 tab,桌面端沿用单 leaf 路由,与其他工作台页面共存。

### 3.2 打开位置

默认打开位置按优先级:

1. **当前活动笔记所在目录**(编辑器内活动笔记,或文件列表右键所选笔记);
2. 无活动笔记时回退 **Vault 根**;
3. 可在设置中把默认位置改为「总是 Vault 根」。

Vault 绝对路径来自 `app.vault.adapter.getBasePath()`(桌面端有效)。路径含空格等特殊字符时按平台规则加引号转义。

### 3.3 平台启动策略

`launcher` 按平台组装命令,通过 `spawn` 调用系统程序(不经过 shell 拼接,参数逐个传递):

| 平台 | 打开终端到目录 |
|---|---|
| macOS | `open -a Terminal <dir>`;终端应用可配置(如 iTerm) |
| Windows | `cmd /c start "" cmd /K "cd /d <dir>"`;配置了 Windows Terminal 时用 `wt -d <dir>` |
| Linux | 按顺序尝试 `gnome-terminal --working-directory <dir>` / `konsole --workdir <dir>` / `x-terminal-emulator --working-directory <dir>`;设置中提供「终端命令模板」覆盖默认尝试顺序 |

只打开终端到目录,不在终端内执行任何命令——用户打开后自行输入 `opencode`、`codex` 等。

### 3.4 失败处理与降级

1. **启动失败 / 找不到终端程序**:捕获 spawn 错误,`Notice` 提示原因。
2. **macOS App Store 沙盒**:spawn 被沙盒拦截时,提示改用官网安装版,并提供「复制目录路径到剪贴板」(`navigator.clipboard`)作为兜底,用户粘贴到自开的终端。
3. **无活动笔记**:回退 Vault 根,不报错。

---

## 4. 设置

设置 → **终端**(仅桌面端显示;移动端隐藏该标签):

| 设置项 | 说明 | 默认 |
|---|---|---|
| 默认打开位置 | 当前笔记所在目录 / 总是 Vault 根 | 当前笔记所在目录 |
| 终端应用(macOS) | 系统 Terminal / iTerm / 自定义应用名 | 系统 Terminal |
| 终端命令模板(Linux) | 覆盖默认终端尝试顺序 | 空 |

**与同步的关系**:终端设置是**设备本地设置**,不进入跨设备配置推送/拉取的字段清单(与「写作设置、Skill 设置保持本地」的口径一致),也不会被 Git 同步上传(`data.json` 本就在同步排除范围)。

---

## 5. 架构

```
src/features/terminal/
  types.ts           // TerminalSettings、默认值
  launcher.ts        // 纯逻辑:目标目录解析、平台命令组装、spawn(注入)
  settings.ts        // load/save,并入插件 settings 的 terminal 字段
  register.ts        // 命令面板、editor-menu、file-menu 注册(桌面门控)
  TerminalView.ts    // 工作台「终端」面板视图(桌面)
  SettingsSection.ts // 设置页「终端」标签(仅桌面)
  launcher.test.ts   // 目录解析、平台命令组装单测(注入 fake spawn)
```

要点:

- **纯逻辑 + 依赖注入**:`launcher` 不直接 import `child_process`,而是接收注入的 `spawn`;单测用 fake 验证命令与参数,不真实开终端(与现有 vitest 风格一致)。
- **桌面门控**:`main.ts` 中 `if (Platform.isDesktopApp) registerTerminal(this)`,包括视图注册与工作台 tab;命令 `checkCallback` 桌面才显示。`require("child_process")` 在 try/catch 中延迟执行,移动端/异常环境不触发。
- **工作台集成**:`WORKBENCH_VIEWS` 增加 `terminal: "istart-terminal-view"`,`WorkbenchNav` 增加 tab(移动端过滤),沿用单 leaf 路由;面板定位信息订阅 `active-leaf-change` 刷新。
- **路径来源**:Vault 绝对路径用 `app.vault.adapter.getBasePath()`;Vault 内相对路径拼接用 Obsidian `normalizePath` + 注入的 `path.join`。

---

## 6. 安全与隐私

- 插件不读取、不执行任何来自笔记内容或 AI 输出的数据;只拼接「终端程序 + 目标目录」两个参数。
- 无网络请求、无遥测;设置只写入本地 `data.json`。

---

## 7. 里程碑

| 阶段 | 内容 |
|---|---|
| **M1** | ✅ 三平台「在终端打开当前笔记所在目录 / Vault」;工作台「终端」tab 与启动面板;命令面板 + 编辑器/文件右键;桌面门控与失败降级 |
| **M2** | ✅ 设置页「终端」标签(默认打开位置、macOS 终端应用、Linux 终端模板);剪贴板兜底 |
| **M3** | ⏳ AI 助手快捷入口「终端」分组 |
| 文档 | ✅ 已同步更新 `README.zh-CN.md` / `README.md` / `README.en.md`(功能清单、使用、设置表)与 `docs/skills.md` 的 OpenCode 衔接段 |

---

## 8. 决策记录

| 决策 | 结论 |
|---|---|
| 内置 CLI 工具预设 | **不做**。控制台只定位到目录,命令由用户自行输入 |
| `opencode.json` 初始化 | **不做**。不生成、不合并 Vault 内配置文件 |
| 助手快捷入口 | 放 **M3**,首版只做命令面板 + 右键菜单 + 工作台 tab |
| 工作台 tab | **新增「终端」tab(仅桌面)**,显示启动面板;移动端隐藏;纳入 M1 |
