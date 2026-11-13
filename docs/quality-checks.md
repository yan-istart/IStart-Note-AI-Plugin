# Obsidian 插件质量检查

## 本地与 CI

```sh
npm ci
npm run check:obsidian
npm run ci
```

`check:obsidian` 与 `lint` 使用同一套配置，任意警告或错误都导致检查失败。`ci` 在质量检查后运行插件回归、配套服务测试、TypeScript 检查和生产构建。PR、主分支 CI 与发布工作流均接入此检查。

## 规则范围

基础配置为 `eslint.obsidian.config.mjs`，直接启用官方 [`eslint-plugin-obsidianmd` 的完整 recommended 配置](https://github.com/obsidianmd/eslint-plugin#usage)。`eslint.config.mjs` 在此基础上保留本仓库更严格的类型安全、DOM 创建、实例检查和设置搜索规则。

检查入口明确包括：

- `src/` 下的插件生产 TypeScript 源码，包括内容分发。
- `manifest.json` 的结构与字段要求。
- `package.json` 的依赖建议。
- `LICENSE` 的许可证与版权声明。

构建输出、测试、构建脚本和独立 Node 服务不套用 Obsidian 窗口及移动端运行规则。配套服务通过 `node --test service/*.test.mjs` 单独验证，包括打包后的 HTTP → MCP → 模拟浏览器扩展链路。依赖版本由 lockfile 固定。

## 兼容和特殊传输

- Manifest 仍声明最低版本 1.7.2；SecretStorage 在 `requireApiVersion("1.11.4")` 保护下使用，旧版本仅保留会话令牌。
- 新版破坏性按钮样式在 `requireApiVersion("1.13.0")` 保护下使用，旧版本保留兼容样式。
- 插件计时器使用 `window` API，前台可见性使用 `activeDocument`。
- Git 的 Buffer 明确来自浏览器包入口 `buffer/index.js`，浏览器构建测试验证无需 Node 全局对象。
- 普通 HTTP 请求使用 Obsidian `requestUrl`。仅可选 AI SSE 流式传输使用 `window.fetch`，因为 `requestUrl` 不提供流读取与 AbortSignal；现有测试覆盖 SSE、跨域回退和取消，不使用 ESLint disable 注释跳过限制。

## 检查结果的边界

本地检查使用官方推荐配置，并不是调用社区后台扫描。社区目录的自动审核有自己的提交分层、扫描范围和发布检查；通过本地检查不等于插件已经通过社区审核。需要在线预扫描时，在 Obsidian 社区开发者后台选择相应分支、提交或标签。

官方参考：[配置与社区扫描差异](https://github.com/obsidianmd/eslint-plugin/blob/master/docs/configuration.md#community-plugin-scanner-configuration)、[发布审核说明](https://obsidian.md/blog/future-of-plugins/)。
