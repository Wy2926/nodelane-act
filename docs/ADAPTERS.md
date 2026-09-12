# 添加网站适配包

新增 `sites/<id>/manifest.json` 和 `adapter.ts`，运行 `npm run build`。注册表、扩展安装时声明的域名权限和弹窗列表都由 manifest 自动生成。`src/server`、`src/shared`、`extension` 不得增加具体网站分支。

```json
{
  "id": "example-forum",
  "name": "Example Forum",
  "description": "论坛阅读与互动",
  "hosts": ["forum.example.com"],
  "entry": "./adapter.ts",
  "operationsExport": "operations",
  "executeExport": "execute"
}
```

站点 id 唯一，域名精确匹配且不可重叠。入口必须在项目目录内。适配包是受信任的安装代码；网站内容和 API 返回不是适配包，不可提供或修改操作定义。

```typescript
import type {
  OperationDefinition, PageInvocation, OperationResult
} from "../../src/shared/contracts.js";

export const operations: OperationDefinition[] = [
  {
    site: "example-forum",
    id: "read",
    title: "读取内容",
    description: "Return one compact content item.",
    keywords: ["读取", "正文", "read"],
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", pattern: "^[0-9]+$", maxLength: 24 } },
      required: ["id"],
      additionalProperties: false
    }
  }
];

export async function execute(invocation: PageInvocation): Promise<OperationResult> {
  // Chrome 会把此函数序列化后注入网页 MAIN world。
  // 所有运行时 helper 必须定义在函数内部；只能使用浏览器全局。
  // 不可引用模块变量、导入的函数或 esbuild __name 辅助函数。
  // 按本网站的实际接口和页面实现，并返回 OperationResult。
  return { ok: false, error: { code: "NOT_IMPLEMENTED", message: "Implement the website operation." } };
}
```

示例是接口模板，不是注册的可用站点。实现时必须提供真实执行路径和测试，不能把模板空函数作为可用功能暴露。

## 连接与适配包的职责

MCP 启动时自动启动或复用本机共享桥接，扩展通过 WebSocket 自动发现连接。桥接只监听 `127.0.0.1`，扩展扫描内部端口范围 `17477..17486`；这些端口是通用连接层的实现细节，不属于站点参数，也不要求用户输入。

浏览器连接由发行包固定的扩展 Origin 识别。扩展 ID 由 `extension/identity.json` 和构建产物中的 manifest key 保持一致，桥接只接受该扩展 ID 对应的 `chrome-extension://` Origin。本地 HTTP 控制接口使用程序生成的认证数据，认证数据只在本机 MCP 与桥接之间使用，不返回给模型、不显示给用户，也不进入站点执行器。新增站点不得另设配对流程、连接端口或连接凭证。

连接层不解析知乎、Reddit 或其他网站的接口；站点包只提供操作定义和网页执行器。修改连接方式不改变 manifest、按需发现、参数验证和结果预算的契约。当前运行流程在 Windows + Node.js 22 环境开发和测试，其他操作系统仍需单独验证。

## 契约

- `OperationDefinition.site` 必须与 manifest id 一致；操作名在本站唯一。同名操作在不同网站可有各自参数，核心不会强迫不同产品共用错误的数据模型。
- `inputSchema` 必须限制字符串长度、列表数量、分页范围，禁止多余参数。站点和操作 schema 不加入 MCP 的初始工具定义。
- 当前校验器支持 `type/properties/required/additionalProperties/items/enum/const/minimum/maximum/minLength/maxLength/pattern/minItems/maxItems/uniqueItems/anyOf/oneOf/allOf` 及描述性字段；未知校验关键词失败关闭。扩展禁止运行时生成代码或 eval。
- `readOnly=false` 标记写入；经用户指令授权后直接执行，无第二次扩展确认。该标记驱动写入去重和状态记录，网页或请求参数不可覆盖。读取收件箱时不得隐式标为已读。
- 所有请求在用户选定网页上下文执行；域名限制、登录检查、CSRF 和站点特有校验由本站执行器实现。凭证不作为结果返回。
- ID 保留字符串，尤其要防止超过 JavaScript 安全整数的 ID 失真。输出只含任务相关字段与来源链接。
- 列表默认小页；正文按需读取；返回真实 `hasMore` 和续页信息。不能把截断的响应伪装为全部内容，也不能在裁剪页后静默跳过未返回的条目。
- 写入必须检查平台错误及最终结果，草稿不是发布。请求超时或失去响应须报告不确定，不能自动重放写入。
- 增加 mock 回归测试，并测试生产构建中函数的独立序列化执行。新增网站的真实账号验收另行记录，不由 fixture 测试替代。

## 扩展性边界

所有注册和域名匹配均基于数据，没有站点数量的固定上限。MCP 服务端按需 import 站点包；浏览器端为满足 MV3 将执行代码随扩展打包，本地延迟初始化。大量站点时可进一步分成按需安装的扩展发行包，保持同一核心和站点契约；不要把所有站点 schema 一次返回模型来解决加载问题。
