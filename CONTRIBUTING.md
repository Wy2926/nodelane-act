# Contributing to NodeLane Act

感谢帮助改进 NodeLane Act。问题和功能请求请提交到 [GitHub Issues](https://github.com/Wy2926/nodelane-act/issues)，说明站点、要完成的具体操作、复现步骤和已经脱敏的错误信息。安全漏洞请按 [SECURITY.md](SECURITY.md) 的方式报告。

## 开发与验证

使用 Node.js 22+。在仓库根目录运行：

```powershell
npm ci
npm run check
npm test
npm run build
```

修改浏览器执行链路后，用 `npx playwright install chromium` 安装测试浏览器，再执行 `npm run test:browser`。该测试使用隔离的浏览器配置、站点 fixture 和模拟写入，不在真实网站上发帖或删除内容。请在 PR 中区分单元测试、fixture 浏览器测试与真实站点验证；不要将读取成功描述为所有互动操作均已验证。

源码构建后，使用浏览器的「加载已解压的扩展」加载 `dist/extension`，并将 `dist/server/index.js` 配置为本地 stdio MCP。变更扩展执行代码后重新构建并重新加载扩展。官网源码独立位于 `website/`，其依赖和产物不会提交。

## 新增站点或操作

每个站点在 `sites/<id>/` 中维护 `manifest.json` 和 `adapter.ts`，完整契约见 [适配包开发说明](docs/ADAPTERS.md)。通用核心不增加逐站点分支；保留三个稳定的 MCP 工具，按需返回操作 schema。

- 使用正常网页已有的调用方式和用户的浏览器登录状态；不引入需要用户复制的凭证，不绕过验证码或访问限制。
- 给参数、页大小和正文长度设置边界；结果保留来源链接、真实分页信息和明确错误，不伪造成功或结束状态。
- 写入只在用户请求授权的范围内执行，不自动重试结果不确定的写入。取消已发出的请求不等于网站撤销了操作。
- 浏览器执行器必须可序列化并在页面内独立运行，运行时辅助函数放在执行函数内部。
- 为实际行为增加必要的 fixture 或请求测试；不要提交真实账号响应、登录资料、浏览器配置或测试截图中的个人信息。

请保留 `site-mcp` 内部服务协议、既有状态兼容性与固定浏览器扩展身份。若需要改变这些行为，PR 应明确说明迁移影响。

## 准备分发文件

当前 ZIP 包装脚本面向 Windows。版本更新需同步根包、浏览器扩展、Codex 插件和发布元数据。先完成检查和测试，再运行：

```powershell
npm run package
npm run test:package -- dist/packages/nodelane-act-0.1.0.tgz
npm run package:mcpb
```

命令生成 ZIP、npm tarball、MCPB 和摘要文件，不会发布到 npm、GitHub 或市场。npm 验收在独立临时目录中离线安装包，检查可执行命令、MCP 初始化、按需 schema 和本机连接。MCPB 验收会解包并执行本地协议检查；这些验证不代表所有客户端的图形安装流程均通过。

提交源码和必要元数据，排除 `dist/`、`node_modules/`、`.astro/`、`test-results/`、环境文件及本地状态目录。修改按 [MIT 许可证](LICENSE) 随项目分发；引入依赖时保留所需许可文件。
