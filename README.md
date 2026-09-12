# NodeLane Act

让 AI 通过用户已登录的浏览器操作网站。一个 MCP 连接，按需发现站点能力，返回适合 AI 阅读的精简内容，无需复制 Cookie 或配置网站 API Key。

[官网](https://act.nodelane.net) · [下载](https://act.nodelane.net/download/) · [安装说明](docs/INSTALLATION.md) · [MIT 许可证](LICENSE)

## 支持的网站

| 网站 | 主要能力 |
| --- | --- |
| 知乎 | 推荐、搜索、问题与回答、文章、评论、收藏及发布互动 |
| Reddit | 推荐、搜索、社区、帖子与评论、收藏及发布互动 |
| WhatsApp Web | 会话与消息、联系人、群组、社群、频道和动态 |
| X（Twitter / 推特） | 推荐首页、搜索、趋势、通知与未读计数、聊天、发帖回帖及互动 |

以上为当前源码的适配范围，下载包以对应版本为准。具体操作与参数由 `site.discover` 按需提供，部分能力取决于网站权限和登录状态。

## 快速开始

需要 Node.js 22+、Chrome 或 Edge 120+。MCP 与浏览器须运行在同一台电脑上；当前主要在 Windows 上验证。

1. 从[官网下载页](https://act.nodelane.net/download/)获取浏览器扩展并解压到固定目录。
2. 打开 `chrome://extensions` 或 `edge://extensions`，启用「开发者模式」，选择「加载已解压的扩展」，选中包含 `manifest.json` 的目录。
3. 为 AI 客户端添加 MCP 服务，然后保持浏览器运行并登录要操作的网站。扩展会自动连接。

Codex：

```sh
codex mcp add nodelane-act -- npx -y --package=https://act.nodelane.net/downloads/nodelane-act-0.2.0.tgz nodelane-act
```

Claude Code：

```sh
claude mcp add --transport stdio --scope user nodelane-act -- npx -y --package=https://act.nodelane.net/downloads/nodelane-act-0.2.0.tgz nodelane-act
```

上述命令使用官网发布包。其他客户端配置、ZIP 和 MCPB 安装方式见[安装说明](docs/INSTALLATION.md)。

## 使用

连接后，直接向 AI 描述任务，例如：

- “查看知乎推荐的前 5 条，只给标题、摘要和来源链接。”
- “在 Reddit 搜索自托管相关讨论，展开最相关帖子的评论。”
- “查看 X 首页推荐，同时告诉我通知和聊天的未读数量。”
- “查看 WhatsApp 的未读会话，整理需要回复的消息。”

MCP 只暴露三个工具，站点操作按需发现：

| 工具 | 用途 |
| --- | --- |
| `site.context` | 选择或打开网站标签页，获取目标标识 |
| `site.discover` | 查找站点能力与操作参数 |
| `site.execute` | 执行操作或继续读取结果 |

列表默认返回少量条目与摘要，保留来源链接，支持分页和按需展开正文。X 的 `home` 可一次返回推荐、趋势、账号及未读计数。发帖、回复和消息发送按用户指令执行；结果不确定的写入不会自动重试。

## 从源码运行

```sh
git clone https://github.com/Wy2926/nodelane-act.git
cd nodelane-act
npm ci
npm run build
```

将 `dist/extension` 加载到浏览器，并将 `node <项目绝对路径>/dist/server/index.js` 配置为本地 stdio MCP。修改扩展代码后需重新构建并重新加载扩展。

开发、测试和打包见[贡献说明](CONTRIBUTING.md)，新增网站见[适配包开发说明](docs/ADAPTERS.md)，安全边界见[安全说明](SECURITY.md)。
