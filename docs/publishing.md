# 图文内容分发

在 **IStart 工作台 → 内容分发** 或 **设置 → 内容分发** 配置连接。命令「分发图文笔记」和文件右键菜单可载入目标 Markdown 笔记，无需配置 AI API Key。

首版面向微信公众号、知乎、B 站专栏的长文章与正文图片。发送结果是平台草稿，仍需进入平台检查正文、图片及排版。实际保存行为依赖 Wechatsync 扩展与平台接口；无法确定保存为草稿时，任务显示「结果未知」。

## PC：连接本机服务

1. 安装 **Node.js 22 或更高版本**，以及 [Wechatsync 浏览器扩展](https://github.com/wechatsync/Wechatsync)。
2. 按下方「自行部署配套服务」说明下载或构建两个服务文件，设置令牌并独立启动服务。
3. 在插件中选择「连接本机服务」，填写 HTTP 端口（默认 `27123`）与部署时设置的 `PUBLISHING_TOKEN`，点击「测试连接并刷新账号」。
4. 在浏览器扩展桥接设置中填写 `ws://127.0.0.1:27125/extension?key=<EXTENSION_TOKEN>`，扩展 Token 填写部署时设置的 `EXTENSION_TOKEN`。在该浏览器登录目标平台，再测试连接、核对显示的账号。

插件通过 HTTP/HTTPS 连接服务；服务的安装、启动、停止和更新由用户或系统进程管理器负责。关闭插件不会停止独立运行的服务。服务侧任务记录保存在 `PUBLISHING_DATA` 指定的目录，默认是程序目录下的 `jobs`。

访问令牌使用 Obsidian SecretStorage（1.11.4+）；旧版本只在本次会话保留。连接模式、端口和远程地址使用设备本地存储（1.8.7+）；更旧版本配置只在会话中保留。不会写入插件 `data.json` 或同步稿件。不同模式使用独立的访问令牌。

### 从旧版本迁移

旧版「本地安装并启动」改为「连接本机服务」，保留原 HTTP 端口及 SecretStorage 中的访问令牌。升级后需独立部署并启动服务，在插件中填写服务访问令牌，同时在浏览器扩展中配置扩展 Token。旧版保存在 `~/.istart-publishing/<设备配置ID>/` 的程序及任务文件不会自动删除；若需保留旧任务查询，将其 `jobs` 路径作为新服务的 `PUBLISHING_DATA`，并使用原令牌。旧服务凭证的 SecretStorage 名称分别为 `istart-publishing-<设备配置ID>-local` 和 `istart-extension-<设备配置ID>`；也可重新设置两个不同的随机令牌并更新插件与扩展配置。

## PC / 手机：连接已有服务

在桌面端选择「连接已有服务」，填写 **IStart 配套分发服务** 的 HTTPS 地址及服务访问令牌。移动端仅提供此模式。本机回环地址允许 HTTP，其他地址要求 HTTPS；在同一局域网时也应通过受信任的 HTTPS 入口访问。

这不是任意 MCP URL：客户端使用下述版本化 HTTP API，服务内部通过 stdio MCP 与浏览器桥接通信。手机上传图片数据，不会把手机文件路径交给电脑读取。

服务连接的浏览器账号就是发送账号。即使 HTTP 服务在云端部署，也需要连接一个运行中的 Wechatsync 浏览器扩展。首版为单用户、单浏览器连接；多个客户端共用该浏览器的账号，服务同时只执行一个发送任务。

## 自行部署配套服务

从 [GitHub Releases](https://github.com/yan-istart/IStart-Note-AI-Plugin/releases) 下载 `publishing-service.cjs` 与 `publishing-mcp.cjs`，或从本仓库构建（Node.js 22+）：

```sh
npm ci
npm run build:publishing-service
```

部署以下两个文件到同一目录：

- `dist/publishing-service.cjs`
- `dist/publishing-mcp.cjs`

两者已包含依赖，可直接运行，无需在服务机器执行 `npm install`。依赖许可证附在文件头和 `dist/THIRD_PARTY_PUBLISHING_NOTICES.txt` 中。两个服务文件独立于插件发布，`main.js` 不包含服务程序。

配置环境变量后运行 `node publishing-service.cjs`。令牌各自使用随机、至少 24 字符的不同值，通过进程管理器或环境配置传入，不写入 Vault：

| 环境变量 | 含义 | 默认值 |
| --- | --- | --- |
| `PUBLISHING_TOKEN` | 手机和 PC 调用 HTTP API 的访问令牌 | 必填 |
| `EXTENSION_TOKEN` | 浏览器连接地址的 key 和扩展 Token | 必填 |
| `PUBLISHING_HOST` | HTTP 监听地址 | `127.0.0.1` |
| `PUBLISHING_PORT` | HTTP 端口 | `27123` |
| `BRIDGE_HOST` | WebSocket 监听地址 | `127.0.0.1` |
| `BRIDGE_PORT` | WebSocket 端口 | `27125` |
| `PUBLISHING_DATA` | 持久化任务目录 | 程序目录下的 `jobs` |

在 HTTPS 反向代理中，将 `/extension`（包括 query string 和 WebSocket upgrade）转发到 `127.0.0.1:27125`，其余请求转发到 `127.0.0.1:27123`。浏览器扩展服务器地址填入 `wss://你的域名/extension?key=<EXTENSION_TOKEN>`，扩展 Token 同样填 `EXTENSION_TOKEN`；Obsidian 服务地址填 `https://你的域名`，访问令牌填 `PUBLISHING_TOKEN`。

反向代理需允许约 26 MB 的 HTTP 请求体和 32 MB 的 WebSocket 消息；设置持久化的 `PUBLISHING_DATA`，并让一个服务实例独占此目录。远程常驻服务可以由系统进程管理器运行，独立于 Obsidian 生命周期。修改端口或服务部署位置后同步更新代理配置。

## 稿件和记录

默认分发目录可在设置中修改，首次保存快照时才创建：

```text
IStart/Publishing/
  <本地日期>-<短ID>/
    稿件.md
    assets/image-1.png
    records/<发送任务ID>.json
```

预览读取目标笔记编辑器中的最新正文，文件右键不会误用另一篇笔记的正文。发送前核对原文和本地图片是否变化，变化时要求重新预览。保存快照复制本次使用的图片，稿件使用快照内的相对路径；原笔记保持独立。

支持普通 Markdown 图片、Obsidian 图片嵌入和 HTTP/HTTPS 图片。正文双链转为显示文字，内部 frontmatter、批注和高亮标记不进入稿件；代码示例与普通文献脚注保留。笔记嵌入、引用式图片、HTML 媒体、缺失附件和不支持的图片格式会阻止生成预览。Mermaid、Dataview 等代码块保留源码并提示先转图片；不自动截图或执行转换。单张本地图片上限 8 MB，合计上限 16 MB。

预览是通用 Markdown 内容预览，目标平台会进一步转换。封面字段按平台实际支持处理，公众号等平台可能需要在后台补充封面。B 站上游适配器可能移除上传失败的图片，因此返回「草稿已保存」后仍需检查图片完整性。

分发目录可随现有 Git 同步规则同步，但不进入知识问答索引。记录移除返回 URL 中的 Token 等敏感参数；公众号草稿链接去掉 Token 后可能需要先登录并从平台草稿箱打开。

## 任务状态与恢复

- 每次发送先保存任务编号，服务按编号和内容摘要去重。一次任务逐平台执行并保存结果。
- 服务接收后异步发送，手机断网或退出界面不会要求重新 POST。使用「刷新发送记录」查询同一编号。
- 已有相同稿件、封面和账号的成功草稿或未知结果，会阻止再次提交。同一次任务重复请求不会再发送。
- 仅明确失败的平台显示「重试失败平台」。重新载入旧任务时，先显示稿件预览，由用户检查后发送。
- 超时、服务中断、返回缺失或未明确为草稿时显示「结果未知」，不会自动重发。请在平台核对；已知需要重新分发时，编辑稿件并重新预览形成新版本。
- 服务恢复时，磁盘中未完成的任务转为「结果未知」。单独同步记录不会触发执行。服务地址或服务标识不同的历史任务需要连接原服务查询。
- 客户端仅展示最近 50 个记录文件。完整历史保留在分发目录；任务内容不持久化到服务侧，服务只保存内容摘要、账号标识和结果。

## HTTP API v1

所有请求使用 `Authorization: Bearer <PUBLISHING_TOKEN>`；POST 使用 `Content-Type: application/json`。

| 方法 | 路径 | 返回 |
| --- | --- | --- |
| GET | `/v1/status` | 协议版本、服务 ID、扩展连接状态 |
| GET | `/v1/platforms` | 支持的平台及浏览器账号 |
| POST | `/v1/jobs` | 接收 `{id, article:{title, markdown, cover?}, accounts:[{id, username, userId?}]}`，返回任务 |
| GET | `/v1/jobs/<id>` | 同一任务的逐平台结果 |

服务在执行前重新检查账号，账号与预览不一致时阻止整批发送。首版只允许 `weixin`、`zhihu`、`bilibili`，不开放任意 MCP 工具和服务器文件读取。WebSocket 握手必须携带 `key`，MCP 消息同样携带扩展 Token。日志只输出固定的运行状态，不记录令牌或完整正文。

测试使用模拟浏览器覆盖 HTTP → MCP → WebSocket → 平台结果链路；真实平台账号、浏览器扩展和 iOS/Android 真机需要另外联调。
