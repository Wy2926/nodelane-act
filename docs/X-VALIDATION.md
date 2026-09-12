# X API 适配与验证

## 实现

- 独立 `sites/x` 包，manifest 自动生成注册和扩展权限；未修改通用 MCP、桥接或连接层。
- 常规接口通过当前 X Redux provider 的 `api.fetchClient.dispatch` 调用同源 `/i/api`。此传输使用 X 的登录/交易签名过滤器，末端为单次 fetch；不使用含自动重试过滤器的 `apiClient.graphQL` 发送写入。
- 从已安装 webpack 模块中读取当前 GraphQL 定义；使用 X 实际功能开关。无硬编码 query hash、远程代码下载或 eval，无 Cookie/令牌导出。
- 首页并行聚合 HomeTimeline、badge_count、ExploreSidebar、UserByRestId。计数字段保持原始语义；任一模块失败不会隐藏其他模块的结果。
- X Chat 使用已挂载的原生 KMP SDK component/state/event API。读取解密后的有界数据；更多会话/历史由 SDK 请求加载。未发送 `VisibleReadableItemsChanged` 等已读事件。打开会话产生的网页行为需区别对待。
- 默认聊天不调用旧 DM API。旧接口必须显式选择 `backend=legacy`，不能覆盖或代表新版加密聊天。

## 真实浏览器记录（2026-09-12）

使用用户已登录的 X 与已重新加载的本地扩展，通过新启动的 MCP 服务进行只读 API 验证。没有真实发帖、回复、点赞、发私信或删除。

第一轮已通过：账号、未读计数、首页推荐及缓冲续页、关注时间线、搜索、帖子详情、回复、个人资料、通知。计数 API 实际返回 `ntab_unread_count`、`dm_unread_count`、`xchat_unread_count`、`total_unread_count`。

第一轮发现旧 guide 趋势提取为零、旧 DM 解码失败，已分别调整为 ExploreSidebar 和当前 X Chat SDK。旧 DM 仅作为显式兼容选项，并区分 `AT_END` 且无 entries 的合法空收件箱。当前真实 Chat 页面显示 Empty inbox；空列表不能替代非空聊天、历史分页或发送验收。

最新只读报告由下列命令写入 `test-results/x-live-read-check.json`，只包含状态、计数和错误码，不保存账号 ID、正文、私信、请求头或凭证：

```sh
npm run build
# 手动重新加载本地开发扩展后执行
npx tsx scripts/x-live-smoke.ts --read-only
```

`tests/x.test.ts` 使用生产构建的独立序列化执行器，覆盖 API 参数、首页部分失败、零/未知计数、动态定义、长 ID、压缩、广告过滤、缓冲分页、错误/回执、旧 DM 和新 SDK 空/非空收件箱。模拟验证不代表真实账号写入已验收。

## 已知边界

- X 网页内部 API/SDK 并非公开稳定协议，升级可能需要更新适配器；缺少定义时显式失败，不请求猜测的旧接口。
- GraphQL 所需模块必须已由网页加载。X Chat 必须已打开、完成初始化和必要的本地解锁；消息操作必须匹配当前会话。
- 不提供 PIN/恢复密钥处理、媒体上传、语音/视频通话、支付、群管理、Spaces 或完整账号设置。发帖支持已有媒体 ID；新版聊天当前支持文本发送，旧 DM 支持已有 media_id、回复和表情接口。
- 真实写入、新版非空聊天及聊天历史续页需要专用验收数据；本次不向真实联系人发测试消息。

## 协议参考

- [X 时间线说明](https://help.x.com/en/using-x/x-timeline)
- [X Chat 说明](https://help.x.com/en/using-x/about-chat)
- [Twikit API 客户端源码](https://github.com/d60/twikit/tree/main/twikit/client)用于旧接口参数交叉核对。
- 当前 X 自身公开 JS 的 main、HomeTimeline、XChat 和 xchat-kmp 模块用于核对签名传输、badge_count、ExploreSidebar 及 SDK 的公开事件字段。未将远程脚本拷入发行包或执行外部下载代码。
