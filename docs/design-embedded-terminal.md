# 内嵌终端(工作台「终端」tab)设计方案

> 状态:已实现(2026-11-21),方案 B(本地配套服务 + 透明环境管理)。三平台(macOS / Windows / Linux)支持。
> 目标:工作台「终端」tab 内嵌交互式控制台(xterm.js + 本机 PTY 服务),在 Obsidian 内直接使用 opencode / codex 等 CLI;保留「打开系统终端」作为兜底。桌面端专属,移动端不提供。

---

## 1. 背景与决策

- 系统 Terminal.app 等外部应用无法嵌入 Obsidian(无嵌入 SDK);内嵌控制台 = 终端模拟器(xterm.js)+ 真实 shell(PTY)。
- 方案 A(插件内直接加载 node-pty)因 **Electron ABI 编译矩阵**成本过高被否:node-pty 必须按 Electron ABI 重新编译,需要三平台 CI + 每次发版重编 + Windows ConPTY 补丁。
- **采用方案 B**:PTY 由本机 Node.js 24+ 服务提供(官方预编译零编译成本),插件侧只做 xterm.js 界面与 WebSocket 客户端,复用仓库 publishing-service 的独立服务模式。

## 2. 关键决策

| 决策 | 结论 |
|---|---|
| 环境管理 | **透明一键**:终端页「启动终端」自动完成 检查 Node → 复用健康实例 → 下载(带进度)→ 解压 → 启动 → 健康检查;每一步进度可见 |
| 环境复用 | 复用系统已有 Node(仅要求 ≥24,不安装运行时);服务按版本目录缓存(`~/.istart-terminal/<版本>/`),版本一致跳过下载;已有健康实例直接复用不重复启动 |
| 离线/本地测试 | 服务包查找顺序:①插件目录内自带的 `terminal-service-<版本>.zip` ②GitHub Release 下载 ③设置 → 终端「从本地 zip 安装」手动选择 |
| 鉴权 | 服务只监听 127.0.0.1;随机令牌存 `~/.istart-terminal/config.json`(跨版本复用),WS 连接带 `?token=` |
| 会话 | 一个 WS = 一个 PTY 会话;tab 关闭即终止 shell;后续可扩展多会话 |
| 目录 | 复用 `resolveTerminalTarget`:当前笔记所在目录,无活动笔记回退 Vault 根;PTY spawn 直接传 `cwd` |
| 兜底 | 保留命令面板/右键/「打开系统终端」按钮(系统终端启动器) |

## 3. 架构

```
service/terminal.mjs              # 终端服务:HTTP(/health /shutdown) + WS(/terminal),PTY 会话
scripts/build-terminal-service.mjs # 打包 cjs + 打包 node-pty prebuilds 为 dist/terminal-service-<版本>.zip
src/features/terminal/
  environment.ts                  # TerminalEnvironment:环境检查/下载/安装/启动/复用(注入 Io 可测)
  session.ts                      # TerminalSession:WebSocket 客户端(spawn/input/resize/exit)
  launcher.ts                     # 系统终端启动器(兜底,保留)
  TerminalView.ts                 # 侧栏页:xterm + FitAddon + 工具栏(目录切换/进度/状态/兜底按钮)
  types.ts                        # TerminalSettings(含 port/serviceVersion)
  register.ts                     # 桌面门控注册
```

发布:`.github/workflows/release.yml` 上传 `dist/terminal-service-<版本>.zip` 与 `dist/TERMINAL_SERVICE_NOTICES.txt`(含 node-pty/ws 许可证)。

## 4. 商店审核合规

- 社区 zip 仅三件套;服务包为独立 Release 资产,插件内**用户可见进度**的主动下载,无遥测;
- node-pty(官方 prebuilt,MIT)、xterm.js(MIT)、fflate(MIT)、ws(MIT)均已计入 `THIRD_PARTY_NOTICES.md`;
- 终端以用户权限运行本地 shell,命令与输出不离开本机,PRIVACY 已说明;
- 桌面门控,`isDesktopOnly` 保持 false;
- 维护注意:node-pty prebuild 与 Node LTS ABI 绑定,Node 大版本升级时需更新 devDependency 并重新发服务包。

## 5. 里程碑

| 阶段 | 内容 | 状态 |
|---|---|---|
| M1 | 服务(HTTP/WS/PTY)+ 打包脚本 + 运行时测试 | ✅ |
| M2 | 环境管理器(检查/下载/安装/启动/复用)+ xterm 侧栏页 + 设置页后端管理 | ✅ |
| M3 | 三平台真机验证、多会话、会话保持开关 | ⏳ |
