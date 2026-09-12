# 安装与客户端配置

先按 [README](../README.md#快速开始) 安装浏览器扩展。MCP 服务与浏览器须运行在同一台电脑的本机用户环境中；远程服务器、容器或云端 Agent 无法直接连接本机扩展。

## Cursor、Windsurf 与通用 MCP 客户端

将以下条目合并到客户端配置，保留已有服务：

```json
{
  "mcpServers": {
    "nodelane-act": {
      "command": "npx",
      "args": ["-y", "--package=https://act.nodelane.net/downloads/nodelane-act-0.2.0.tgz", "nodelane-act"]
    }
  }
}
```

| 客户端 | 配置位置 |
| --- | --- |
| Cursor | 全局 `~/.cursor/mcp.json` 或项目 `.cursor/mcp.json` |
| Windsurf / Cascade | `~/.codeium/windsurf/mcp_config.json` |
| 其他 MCP 客户端 | 本地 stdio 设置中的 `command` 与 `args` |

## VS Code / GitHub Copilot

通过 **MCP: Open User Configuration** 打开本机用户配置，或使用项目 `.vscode/mcp.json`：

```json
{
  "servers": {
    "nodelane-act": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "--package=https://act.nodelane.net/downloads/nodelane-act-0.2.0.tgz", "nodelane-act"]
    }
  }
}
```

通过 **MCP: List Servers** 启动服务，并在 Copilot Chat 中启用工具。

## ZIP 与 MCPB

从[官网下载页](https://act.nodelane.net/download/)获取同一版本的包：

- **插件 ZIP**：包含 MCP 服务、Codex 插件清单、浏览器扩展和运行依赖。解压后可直接加载 `dist/extension`，无需另外下载扩展。
- **扩展 ZIP**：仅包含浏览器扩展，搭配 README 中的命令使用。
- **MCPB**：供支持本地 MCPB 导入的客户端安装 MCP 服务，浏览器扩展仍需单独安装。

这些包不捆绑 Node.js；运行环境需要 Node.js 22+。下载页提供 SHA-256 摘要供核对。

插件 ZIP 解压后，将 MCP 的 `command` 设为 `node`，`args` 设为服务入口的绝对路径。例如：

```json
{
  "mcpServers": {
    "nodelane-act": {
      "command": "node",
      "args": ["C:/Tools/nodelane-act/dist/server/index.js"]
    }
  }
}
```

保留解压目录及其中的 `.codex-plugin` 和 `.mcp.json`；浏览器与 MCP 会继续从中加载文件。

## 连接检查

- Codex 使用 `codex mcp list`，Claude Code 使用 `claude mcp list` 检查配置；扩展弹窗显示浏览器连接状态。
- 工具列表只有 `site.context`、`site.discover`、`site.execute` 三项是正常状态，具体操作由 AI 按需发现。
- 若找不到 `node` 或 `npx`，安装 Node.js 后重启客户端，并检查 PATH。
- 本地 ZIP 或源码安装可运行 `node <安装目录>/dist/server/index.js status` 查看桥接状态，使用 `stop` 停止桥接。

客户端参考：[Codex](https://developers.openai.com/codex/mcp) · [Claude Code](https://code.claude.com/docs/en/mcp) · [Cursor](https://cursor.com/docs/mcp) · [Windsurf](https://docs.windsurf.com/windsurf/cascade/mcp) · [VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers)
