export type PageContent = {
  title: string;
  lead: string;
  sections: { heading: string; body: string[]; list?: string[]; code?: string }[];
};

export const pages: Record<'zh' | 'en', Record<string, PageContent>> = {
  zh: {
    docs: {
      title: '安装与使用',
      lead: '安装浏览器扩展和 MCP，让 AI 在你的登录会话中调用知乎与 Reddit 的网站能力。',
      sections: [
        {
          heading: '准备环境',
          body: ['NodeLane Act 0.1.0 需要同一台电脑上的 MCP 客户端、Node.js 22 或更新版本，以及 Chrome 或 Edge 120 或更新版本。Windows 是当前测试环境；macOS 和 Linux 尚未实测。真实网站只读验收使用 Chrome，浏览器自动化测试使用独立 Chromium。', '浏览器需要保持运行，并在你希望操作的网站正常登录。项目不要求网站开放平台账号、App Key 或另建 OAuth 应用。AI 客户端本身的账号和使用费用由对应服务提供方决定。'],
          code: 'node --version',
        },
        {
          heading: '1. 获取同一版本的安装包',
          body: ['前往 https://act.nodelane.net/download/ 选择安装方式。浏览器扩展和 MCP 是两个组件，都需要安装；ZIP 和 MCPB 是 MCP 的不同安装方式，选择其中一种即可。', 'ZIP 包已经包含构建后的代码和运行依赖，无需再执行 npm install，但不包含 Node.js 二进制。MCPB 也不捆绑 Node.js，请先确保系统可运行 Node.js 22+。当前文档不表示项目已经发布到 npm、浏览器扩展商店或任何 MCP 市场；具体上架状态以下载页的明确标注为准。'],
          list: ['nodelane-act-extension-0.1.0.zip：独立浏览器扩展。', 'nodelane-act-plugin-0.1.0.zip：MCP 服务、Codex 插件清单和同版本浏览器扩展。', 'nodelane-act-0.1.0.mcpb：供支持 MCPB 的客户端导入的 MCP 包，浏览器扩展仍需另行安装。'],
        },
        {
          heading: '2. 安装浏览器扩展',
          body: ['把扩展 ZIP 解压到固定目录。在 Chrome 打开 chrome://extensions，在 Edge 打开 edge://extensions，启用“开发者模式”，选择“加载已解压的扩展”，然后选择包含 manifest.json 的解压目录。不要直接选择 ZIP 文件。', '如果下载的是完整插件 ZIP，也可加载其中的 dist/extension 目录，无需再安装第二份扩展。按浏览器提示核对网站访问权限。扩展通过已声明的网站权限执行操作；安装后不会追加配对码、端口输入或扩展确认步骤。', '保留解压目录，浏览器以后仍从这里加载文件。扩展弹窗显示连接状态、执行状态与近期历史。'],
        },
        {
          heading: '3A. 导入 MCPB',
          body: ['如果你的 MCP 客户端支持 MCPB 本地安装，在该客户端的扩展或 MCP 设置中导入 nodelane-act-0.1.0.mcpb，核对包名与权限后启用。具体入口取决于客户端及版本，不能假设所有 MCP 客户端都支持此格式。', '这个文件安装 MCP 服务，不会代替 Chrome 或 Edge 扩展的安装。若客户端没有 MCPB 导入入口，使用下面的普通 stdio MCP 配置。客户端如果提供符合版本要求的 Node.js 运行时，也可使用其运行时；项目不保证每个客户端都内置 Node.js。'],
        },
        {
          heading: '3B. 配置普通 MCP',
          body: ['把完整插件 ZIP 解压到固定目录，例如 C:\\Tools\\nodelane-act。保持 package.json、dist/ 和点文件的原有层级。MCP 启动命令为 node，参数为解压目录下 dist/server/index.js 的绝对路径。', '支持 mcpServers JSON 配置的客户端可使用下例。其他客户端请在对应表单中填写相同的 command 与 args；不要把服务器命令填写为远程 HTTP URL。修改后按客户端要求重新加载或重启 MCP。'],
          code: '{\n  "mcpServers": {\n    "nodelane-act": {\n      "command": "node",\n      "args": ["C:\\\\Tools\\\\nodelane-act\\\\dist\\\\server\\\\index.js"]\n    }\n  }\n}',
        },
        {
          heading: 'Codex 命令行安装',
          body: ['已安装 Codex 命令行时，可以用下面的命令注册同一个本地 stdio MCP。路径应替换为实际解压位置。完整 ZIP 也包含 .codex-plugin/plugin.json 与 .mcp.json，供支持相应插件导入方式的 Codex 客户端使用。不要同时用多个入口重复注册同一个服务。', 'Codex 的 MCP 配置说明：https://learn.chatgpt.com/docs/extend/mcp?surface=cli。'],
          code: 'codex mcp add nodelane-act -- node "C:\\Tools\\nodelane-act\\dist\\server\\index.js"',
        },
        {
          heading: '4. 检查连接并开始读取',
          body: ['MCP 启动时会自动启动或复用本机桥接，扩展自动发现并连接。安装顺序不限，不需要设置端口或复制认证信息。让浏览器与 MCP 客户端同时运行，确认弹窗显示已连接。', '可以先让 AI“读取 Reddit 推荐的 5 条帖子”或“查看这个知乎问题的前 5 个回答，并保留下一页游标”。AI 先选择页面，再按当前站点发现必要操作。浏览器缺少目标页面时，可由 site.context 打开；不会覆盖其他已有标签页。'],
          code: 'site.context({ site: "zhihu" })\nsite.discover({ site: "zhihu", operation: "answers" })\nsite.execute({\n  targetId: "<context 返回的 targetId>",\n  operation: "answers",\n  args: { questionId: "<问题 ID>", limit: 5 }\n})',
        },
        {
          heading: '翻页、正文与上下文预算',
          body: ['初始只有 site.context、site.discover 和 site.execute 三个工具。site.discover 传入 site 可获取精简目录，加入 query 可查找相关能力，加入 operation 可只获取一个操作的参数定义。', '知乎列表将 nextCursor 原样传回 cursor；Reddit 列表按各自参数定义使用 after 或 before。下一页保留原始查询、排序等条件。正文单独读取，避免一次返回整页 HTML。', '知乎话题列表可读取对应网页已加载的卡片。抵达末尾时尝试一次正常滚动，最多等待 8 秒；没有新增内容且没有明确结束标记时，返回 PAGE_NOT_READY。TARGET_PAGE_REQUIRED 会给出可由 site.context 自动打开的页面地址。网页游标与 API 游标不能混用。', 'site.execute 的 maxChars 默认 12000、最高 30000，这是字符预算，不是精确 token 数。超大结果会分段返回；使用 resultId 与 nextOffset 续取的是本地缓存，不会再次执行原操作。缓存最多 30 项，10 分钟过期。'],
          code: 'site.execute({ resultId: "<返回的 resultId>", offset: 12000, maxChars: 12000 })',
        },
        {
          heading: '互动与失败处理',
          body: ['明确告诉 AI 操作对象和希望执行的动作。获得用户指令后，支持的写入直接提交到网站，扩展不再弹出第二次确认。发布前需要审核的内容，应先让 AI 起草，确认内容后再要求提交。', '取消、超时或断线无法撤销已经发出的写入。遇到结果不确定，请先在网站查看是否已经完成，再决定是否重试。扩展不会自动重试写入。页面导航或目标失效后，应重新调用 site.context。', '登录、权限、限流和验证码由网站决定。遇到限制时，在浏览器按网站正常流程处理；NodeLane Act 不破解签名或绕过验证。知乎文章发布需要 zhuanlan.zhihu.com 的页面目标。'],
        },
        {
          heading: '更新、诊断与卸载',
          body: ['更新时先停止正在进行的操作，替换为同版本 MCP 与扩展文件，在扩展管理页重新加载扩展，并重启客户端中的 MCP。不要在操作执行期间删除安装目录。', '连接失败时先检查 Node.js 版本、MCP 绝对路径、浏览器是否运行、扩展是否启用和网站访问权限。下列命令从同一安装目录检查状态或停止共享桥接。停止前先在 MCP 客户端停用服务，避免下一次请求自动重新启动桥接。', '卸载时移除浏览器扩展和客户端中的 MCP 配置，停止本机桥接，然后删除安装目录。本地运行配置需另行清理；网站上已经发布的内容与 AI 客户端保存的对话不会随卸载删除。'],
          code: 'node "C:\\Tools\\nodelane-act\\dist\\server\\index.js" status\nnode "C:\\Tools\\nodelane-act\\dist\\server\\index.js" stop',
        },
        {
          heading: '从源码构建',
          body: ['开发者可以从项目仓库构建，然后加载 dist/extension，并将 dist/server/index.js 注册为本地 MCP。新增站点在 sites/<id>/ 中提供 manifest.json 与 adapter.ts，遵循同一参数校验和结果协议。浏览器执行代码变更后需要重建并重新加载扩展。'],
          code: 'git clone https://github.com/Wy2926/nodelane-act.git\ncd nodelane-act\nnpm ci\nnpm run build',
        },
      ],
    },
    platforms: {
      title: '平台与能力',
      lead: '0.1.0 包含 Reddit 26 个操作与知乎 28 个操作；AI 按当前任务获取需要的能力。',
      sections: [
        {
          heading: 'Reddit：发现、阅读与社区互动',
          body: ['读取账号、首页与推荐、帖子搜索、社区搜索、社区资料与规则、社区帖子、帖子详情、评论树、用户资料与内容、收藏和兼容消息收件箱。列表可继续翻页，评论树中未加载的分支通过 more_comments 继续读取。'],
          list: ['点赞、反对与撤回；收藏与取消；隐藏与取消隐藏帖子。', '发表评论和回复，发布文字或链接帖子，修改或删除自己有权操作的帖子和评论。', '加入或退出社区，发送兼容消息，标记消息已读，解除已有用户屏蔽。'],
        },
        {
          heading: '知乎：问题、回答、话题与创作',
          body: ['读取账号、推荐与关注流、热榜、搜索、问题与回答、文章与想法、用户资料与内容、收藏夹及内容。问题回答、评论、回复和收藏内容支持分页；正文可分段读取。', '话题包括详情，以及热门、精华、最新和待回答列表的读取路径。正常网页读取兼容问题详情与话题内容；话题滚动加载保留明确的结束和待加载状态。'],
          list: ['赞同、反对与撤回；评论点赞与取消；感谢、没有帮助及撤回。', '关注或取消关注用户、问题与话题；拉黑与取消；收藏与取消；新建收藏夹。', '发表评论和回复，发布与修改回答，提问、发布文章，以及删除自己有权删除的内容。'],
        },
        {
          heading: '当前没有覆盖的能力',
          body: ['这 54 个操作是明确的适配范围，不代表平台所有功能均可用。不同账号、页面状态、网站接口调整和社区权限可能影响可执行性。运行时以 site.discover 返回的参数定义和操作结果为准。'],
          list: ['图片和视频上传尚未实现；当前创作正文以纯文本转换为 HTML。', 'Reddit 完整 Chat 会话管理尚未实现。兼容消息发送可能创建 Chat，不能视为完整传统私信能力。', 'Reddit mark_read 只提供已读标记，unblock 只解除已有屏蔽。', '知乎 page_content 读取当前已加载文本，不代表自动完整翻页，更不能作为写入成功的证明。'],
        },
        {
          heading: '验证范围',
          body: ['2026-09-12 的本地验证通过 117 项单元与集成测试，并完成真实浏览器扩展、自动连接和 MCP 的 fixture 测试。真实账号执行了 25 项只读检查，覆盖两站主要读取路径及部分分页。', '知乎真实话题列表从 19 条已加载卡片继续加载到 35 条，确认了该页面的滚动续页。当前没有把每一种排序、账号权限或页面状态都作为线上通过项。', '写入使用模拟响应和独立浏览器 fixture 验证；未以真实发帖、发送消息或删除内容进行验收。读取检查成功不等于所有互动已经通过真实网站验收。'],
        },
        {
          heading: '为新网站添加能力',
          body: ['站点适配包包含域名、操作参数定义、执行器和精简结果转换。核心通过统一目录发现适配包，不需要为每个站点增加顶层 MCP 工具。执行代码随扩展打包，不从远端下载脚本运行。', '欢迎通过 https://github.com/Wy2926/nodelane-act/issues 提出平台需求，并说明具体读取或互动场景。加入计划和完成时间取决于接口可行性与维护资源。'],
        },
      ],
    },
    faq: {
      title: '常见问题',
      lead: '关于登录、连接、上下文、写入和当前兼容范围的直接回答。',
      sections: [
        { heading: '需要把网站密码或 Cookie 交给 AI 吗？', body: ['不需要。网站请求在你已登录的浏览器会话中执行，登录凭证与网站 CSRF 信息不作为工具结果导出。但账号资料、私有内容或其他请求结果可能包含个人信息，并会返回你使用的 AI 客户端。'] },
        { heading: '装了 MCPB，还要装浏览器扩展吗？', body: ['需要。MCPB 安装本地 MCP 服务，浏览器扩展负责在网站页面执行。两个组件在同一台电脑自动连接；无需配对码、端口输入或网站开放平台密钥。'] },
        { heading: '一定能节省多少 token？', body: ['项目不承诺固定节省比例。初始仅暴露三个工具，操作参数按站点和任务发现，列表精简字段并限制长度。这通常减少无关上下文；实际 token 用量取决于模型、内容与调用方式。maxChars 是字符预算。'] },
        { heading: '能在云端 MCP 或远程浏览器里用吗？', body: ['当前连接设计要求 MCP 与扩展位于同一台电脑，本机桥接只监听回环地址。没有面向公网的远程浏览器代理服务，也不需要把桥接端口开放到互联网。'] },
        { heading: '每次写入都会再弹确认吗？', body: ['扩展不增加第二次确认。AI 应只执行用户明确请求的写入。若需要先审核，要求 AI 先生成草稿，随后再明确授权发布。AI 客户端自身可能还有独立的工具审批设置。'] },
        { heading: '点击取消后，评论还会发出去吗？', body: ['可能。取消可以停止等待或阻止尚未执行的步骤，无法撤销网站已经收到的请求。超时和断线也有同样边界。先在网站检查最终状态，避免重复发布。'] },
        { heading: '为什么一个页面能打开，API 仍然报错？', body: ['网站可能对不同读取路径使用不同权限与验证。部分知乎读取已提供正常网页兼容路径；其他限制会作为真实错误返回。项目不绕过登录、验证码、签名或访问限制。'] },
        { heading: '为什么下一页提示 PAGE_NOT_READY？', body: ['话题页面尚未加载新卡片，且没有明确显示列表结束。稍后可重试同一次读取。若出现 TARGET_PAGE_REQUIRED，AI 可使用错误中给出的正常页面 URL 调用 site.context。页面导航后应重新选择目标并获取合适游标。'] },
        { heading: '可以同时连接多个 AI 客户端吗？', body: ['同机 MCP 客户端可以共用本地桥接，各自的目标句柄和输出缓存隔离。它们仍会操作同一浏览器与网站账号，因此不要同时对同一内容发出相互冲突的指令。'] },
        { heading: '收费吗？与 Reddit 或知乎有关联吗？', body: ['NodeLane Act 源码采用 MIT 许可证。你的 AI 服务、网络和网站可能另有费用或条款。本项目为独立工具，与 Reddit、知乎、OpenAI 或其他所提平台不存在由本项目声明的官方合作或背书关系。'] },
        { heading: '可以在 macOS、Linux 或手机上使用吗？', body: ['当前测试环境是 Windows，要求 Node.js 22+ 与 Chrome 或 Edge 120+。macOS、Linux 尚未实测；移动浏览器不属于当前验证范围。不要把源码跨平台特性等同于这些环境已经通过验收。'] },
      ],
    },
    changelog: {
      title: '更新记录',
      lead: '记录已经实现的变化与验证范围，安装包是否发布以下载页和仓库发布记录为准。',
      sections: [
        {
          heading: '0.1.0 · 2026-09-12',
          body: ['NodeLane Act 的首个版本，围绕用户自己的浏览器会话提供精简、按需发现的网站操作。'],
          list: ['提供三个固定 MCP 工具，接入 Reddit 26 项与知乎 28 项操作。', 'MCP 自动启动或复用本机桥接，扩展自动发现连接；无需配对与端口配置。', '加入列表分页、正文分段、大结果缓存，以及知乎正常问题网页和话题滚动读取。', '绑定标签页、URL 和浏览器文档，处理取消、断线、文档变化与写入结果不确定，阻止自动重放写入。', '提供浏览器 ZIP、完整插件 ZIP、MCPB 打包方式及普通 stdio MCP 入口。', '完成 117 项单元与集成测试和 25 项真实账号只读检查；写入仅使用 mock 与 fixture 验证。'],
        },
        {
          heading: '已知边界',
          body: ['图片、视频上传与 Reddit 完整 Chat 尚未实现。macOS、Linux 与全部互动的真实线上执行尚未验收。网站接口可能变化，具体问题与后续改动请查看 https://github.com/Wy2926/nodelane-act/issues。'],
        },
      ],
    },
    about: {
      title: '关于 NodeLane Act',
      lead: '让 AI 了解当前网站能做什么，并通过用户自己的浏览器完成明确的操作。',
      sections: [
        { heading: '为什么做这个项目', body: ['跨网站任务往往需要大量页面文本、重复定位和无关工具定义。NodeLane Act 将各站点常用能力封装为独立适配包，让 AI 按当前网站和意图获取参数，并接收简洁、可继续翻页的结果。', '网页请求仍在用户浏览器里发生。MCP 负责连接、工具发现和结果预算；扩展负责选定页面中的执行。网站原有登录、权限和验证仍然有效。'] },
        { heading: '从两个平台开始', body: ['0.1.0 聚焦知乎和 Reddit，共 54 个操作。项目优先提供可解释的结果与明确失败，不把打开编辑器或保存草稿描述为已经发布，也不把未加载内容描述为列表结束。'] },
        { heading: '开源与维护', body: ['项目由 NodeLane contributors 维护，采用 MIT 许可证。源代码、问题反馈与贡献入口为 https://github.com/Wy2926/nodelane-act。官网为 https://act.nodelane.net，联系邮箱为 contact@nodelane.net。', '社区名称、产品名称与商标归各自权利人所有。出现这些名称是为了说明兼容目标，不代表相应平台认可、赞助或官方维护本项目。'] },
      ],
    },
    support: {
      title: '帮助与反馈',
      lead: '报告可复现的问题、提出平台需求，或私下联系维护者。',
      sections: [
        { heading: '公开问题与功能建议', body: ['在 https://github.com/Wy2926/nodelane-act/issues 创建问题。先搜索是否有相同报告，再说明预期行为与实际结果。社区支持没有承诺的响应时限或服务等级。'], list: ['NodeLane Act 版本、操作系统、浏览器与 Node.js 版本。', 'AI 客户端名称、安装方式，以及扩展是否显示已连接。', '站点、操作名称、已脱敏的最小参数、错误代码与复现步骤。', '涉及写入时，说明是否已经在网站确认最终结果；不要为复现而反复发帖或删除内容。'] },
        { heading: '私密联系', body: ['账号相关信息、隐私请求和安全问题请发送至 contact@nodelane.net。邮件由维护者及所用邮件服务处理；请只提供解决问题所需的最少信息。', '不要发送密码、Cookie、完整会话令牌、本地桥接认证文件或未经清理的网络抓包。截图与日志可能包含用户名、私信、正文和路径，发送前请自行检查。'] },
        { heading: '先做这些检查', body: ['确认 Node.js 22+ 可运行，MCP 的绝对路径仍然存在，MCP 和浏览器在同一台电脑运行。查看扩展是否启用、是否具备相应网站权限，以及网站登录是否仍有效。', '读取因导航失败时重新获取页面目标。写入超时或断线时先看网站结果。安全验证请按网站页面处理，不要反复重试受限请求。完整安装步骤见 https://act.nodelane.net/docs/。'] },
      ],
    },
    privacy: {
      title: '隐私说明',
      lead: '更新于 2026 年 9 月 12 日。说明官网、浏览器扩展与本地 MCP 各自如何处理数据。',
      sections: [
        { heading: '本说明的范围', body: ['本说明适用于 act.nodelane.net 与 NodeLane Act 0.1.0。项目由 NodeLane 维护者提供，隐私问题可联系 contact@nodelane.net。你使用的 AI 客户端、浏览器、GitHub、邮件服务和被操作网站有各自的数据处理规则。'] },
        { heading: '浏览器和 MCP 处理什么', body: ['在你调用工具时，扩展读取支持的网站标签页信息，并在选定网页执行相应读取或互动。返回的信息可能包括标签页标题和 URL、账号资料、列表内容、正文、评论、私有消息与操作结果，取决于具体操作和网站授权。', '网站登录 Cookie 与 CSRF 信息在浏览器会话中用于请求，不作为凭证字段导出给模型。本地 MCP 与扩展经回环地址交换指令和结果，当前代码没有将操作正文主动上传到 NodeLane 托管后端的遥测流程。'] },
        { heading: 'AI 客户端会收到结果', body: ['工具请求和返回内容会提供给你选用的 MCP／AI 客户端。若该客户端使用云端模型或保存对话，内容可能离开本机，并按该服务的设置和政策处理。NodeLane Act 无法替你控制这些保存、训练或共享设置。', '因此，“在本机浏览器执行”不等于“读取内容永不离开设备”。请求包含个人信息、私密内容或组织数据时，请先确认你有权将其提供给所选 AI 服务。'] },
        { heading: '本地保存和缓存', body: ['本机运行目录保存桥接配置和自动生成的连接认证信息。扩展本地存储保存最近成功连接的端口，以及用于避免重复写入的请求 ID 与时间。', 'MCP 将超长结果暂存在进程内，最多 30 项、10 分钟过期。站点分页也可能使用网页内的短期缓存；扩展在运行时保留近期状态、错误与已完成结果。它们可能包含请求返回的数据，不能把这些内存缓存视为独立的安全存储。', '清除扩展数据、结束相关浏览器或 MCP 进程，以及删除本地运行配置，分别影响不同本地数据。卸载不会删除网站内容、AI 对话记录、系统备份或你自行保存的诊断文件。'] },
        { heading: '官网访问与安全服务', body: ['官网当前没有产品账号、广告追踪或统计分析脚本，也不设置用于分析或营销的可选 Cookie。网站经 Cloudflare 提供网络与安全服务，托管服务器和安全服务可能处理 IP 地址、请求时间、页面路径、响应状态、浏览器信息和安全事件等基础访问数据。', '这些数据用于交付页面、诊断故障和防滥用；具体日志字段与保留周期取决于部署及安全配置。本项目不承诺网站访问完全不产生数据。Cloudflare Cookie 的使用取决于启用的安全功能，详情见 Cookie 说明。'] },
        { heading: '联系、披露与处理请求', body: ['你提交 GitHub issue 时，内容通常公开，并受 GitHub 的政策管理。你发邮件时，维护者会收到你提供的地址和内容，并用于答复与排查。请不要在公开渠道提交凭证或私密网站内容。', '如需查询、更正或删除维护者持有的联系记录，或行使适用法律下的相关权利，请邮件说明涉及的数据和请求。我们可能需要适度核实身份；不要求你为此提供网站登录凭证。网站和 AI 服务持有的记录需向相应提供方提出请求。', '对本说明的实质变更会在本页更新日期并说明；后续新增遥测、账号或其他用途时，应相应更新说明。'] },
      ],
    },
    terms: {
      title: '使用条款',
      lead: '更新于 2026 年 9 月 12 日。适用于官网的使用说明，并阐明开源软件和网站操作的边界。',
      sections: [
        { heading: '开源许可', body: ['NodeLane Act 软件采用 MIT 许可证。你可以在遵守许可证条件的前提下使用、复制、修改与分发软件；分发时须保留所要求的版权和许可声明。第三方组件保留各自的许可。', '软件授权以仓库中的 LICENSE 为准，本页不替代或缩减该许可证。完整文本：https://github.com/Wy2926/nodelane-act/blob/main/LICENSE。'] },
        { heading: '你的账号与指令', body: ['请仅操作你有权访问的账号与内容，并遵守适用法律、网站条款、社区规则及他人的权利。软件不会赋予你额外的网站权限，也不保证某种自动化使用方式得到网站允许。', '你需要核对操作对象、拟发布的内容和选择的 AI 服务。用户请求的写入可直接提交，扩展不提供逐次确认作为必要前置步骤。取消、超时或断线不撤销已发出的请求。'] },
        { heading: '功能和准确性', body: ['网站接口、页面结构、账号状态和规则可能变化。项目尽力返回明确结果，但不能保证每项操作持续可用，或 AI 生成的内容准确、合适、完整。请在需要时核实网站最终状态。', '官网的兼容性说明和测试结果仅适用于注明的版本及范围，不构成所有账号、设备或写入场景的保证。当前写入功能仅经过模拟与 fixture 验证。'] },
        { heading: '无额外保证或服务承诺', body: ['软件按 MIT 许可证所载的现状提供及责任限制条款分发。本项目未提供额外的可用性、适销性、特定用途适用性或响应时限承诺；任何适用法律不能排除的权利不受本说明影响。', '官网外部链接仅为资料、下载或反馈入口。第三方服务由其运营方控制，可能有独立费用、账号要求及条款。'] },
        { heading: '名称、更新与联系', body: ['NodeLane Act 是独立项目。Reddit、知乎、OpenAI 等名称属于对应权利人；兼容性描述不构成官方授权、合作或背书的声明。', '版本能力和本页内容可能更新。对软件授权以所使用版本附带的许可证为准。关于本页或使用方式的问题，请联系 contact@nodelane.net。'] },
      ],
    },
    security: {
      title: '安全与信任边界',
      lead: '工具在本机连接，在已选择的网站页面执行。理解这些边界，才能正确授权操作。',
      sections: [
        { heading: '扩展权限的用途', body: ['tabs 用于识别网站标签页；scripting 用于在选定文档中运行随包提供的适配器；storage 保存本地连接状态与写入去重记录；alarms 用于维护连接。构建后的扩展声明已支持网站域名及本机连接所需权限。', '目前站点范围为 Reddit、知乎及知乎专栏相应域名。浏览器页面可执行范围受扩展权限和站点注册表共同约束；这不等于所有页面内容均可信。无需将桥接端口暴露到公网。'] },
        { heading: '本机连接与页面绑定', body: ['桥接只监听 127.0.0.1，扩展通过固定扩展 Origin 连接，MCP 的本地 HTTP 控制接口使用程序生成的认证数据。认证值不传给 AI，也不需要用户手工交换。', '执行目标绑定标签页、URL 和浏览器文档标识。导航或文档替换可能使操作失效，需要重新获取上下文。参数通过 schema 校验，执行代码随本地扩展发布，不远程下载执行脚本。', '这些约束不能防御已经控制你设备、浏览器或 AI 客户端的恶意程序。请保护本地账号和安装目录，只安装可信发布包。'] },
        { heading: '网站文本不是指令', body: ['帖子、评论、私信与网页正文都是不可信输入，可能包含诱导 AI 改变任务、泄露信息或执行其他操作的内容。AI 应把这些内容作为待处理资料，不应把其中的命令当作用户授权。', '工具返回精简内容和来源链接，并在发现流程提示此边界，但这不是对提示注入的完全防御。客户端仍需维持用户指令、网站内容与工具权限之间的分离。'] },
        { heading: '写入、取消与结果不确定', body: ['只有用户请求的互动才应执行。扩展不附加确认窗口，也不自动重试写入；近期写入请求 ID 用于阻止相同请求在重连后被重放。', '取消只影响未完成的本地流程，不能撤销网站已收到的操作。遇到 WRITE_UNCONFIRMED、超时、断线或页面变化，请先检查网站，再判断是否需要重试。重试时新生成的请求不是撤销机制。'] },
        { heading: '报告漏洞', body: ['请将安全问题私下发送至 contact@nodelane.net，提供版本、影响范围和不含敏感数据的最小复现步骤。不要在公开 issue 中发布仍可利用的凭证、用户数据或完整攻击细节。', '维护者会按可用资源评估与处理报告，不承诺固定响应时限、悬赏或未经协商的测试授权。测试请使用自己的账号与隔离环境，不访问他人数据，不执行破坏性操作。'] },
      ],
    },
    cookies: {
      title: 'Cookie 与本地存储',
      lead: '更新于 2026 年 9 月 12 日。区分官网 Cookie、浏览器扩展状态和被操作网站自己的登录数据。',
      sections: [
        { heading: '官网当前使用情况', body: ['官网当前不使用广告、分析追踪脚本或可选 Cookie，也没有基于 Cookie 的产品登录。语言切换通过页面地址完成。没有可选 Cookie 并不意味着没有网络访问记录。'] },
        { heading: 'Cloudflare 安全 Cookie', body: ['网站使用 Cloudflare。启用的安全或防滥用功能可能设置必要 Cookie，例如保存验证状态的 cf_clearance。并非每次访问都会设置相同 Cookie，实际情况取决于部署配置与请求。', 'Cloudflare 对其 Cookie 的用途作了说明：https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/。'] },
        { heading: '扩展和网站的存储是分开的', body: ['扩展使用 chrome.storage.local 保存本地连接状态与写入去重信息，网页内和 MCP 进程内也可能暂存分页结果。这些不属于官网追踪 Cookie。', 'Reddit 与知乎的登录 Cookie 由对应网站和浏览器管理，NodeLane Act 在用户现有会话中发起请求。清除官网 Cookie 不会使这些网站退出登录，也不会删除扩展配置。'] },
        { heading: '管理与变化', body: ['你可以通过浏览器的站点数据设置查看、限制或删除官网 Cookie。阻止安全验证所需的 Cookie 可能影响访问。扩展数据需通过浏览器扩展管理清理，网站登录数据则在对应域名下管理。', '如果未来引入可选分析、广告或其他 Cookie，本页及相关选择机制需要相应更新。有关当前配置可联系 contact@nodelane.net。'], },
      ],
    },
  },
  en: {
    docs: {
      title: 'Install and use',
      lead: 'Install the browser extension and MCP server to let AI use supported Zhihu and Reddit features in your signed-in browser.',
      sections: [
        { heading: 'Requirements', body: ['NodeLane Act 0.1.0 requires an MCP client, Node.js 22 or later, and Chrome or Edge 120 or later on the same computer. Windows is the tested environment. macOS and Linux have not been tested. Live website read checks used Chrome; isolated browser tests used Chromium.', 'Keep the browser running and sign in to the websites normally. You do not need a website developer account, App Key, or a separate OAuth application. Your AI provider may have its own account requirements and charges.'], code: 'node --version' },
        { heading: '1. Get matching packages', body: ['Visit https://act.nodelane.net/download/ to choose an installation method. The browser extension and MCP server are separate components: install both. ZIP and MCPB are alternative ways to install the MCP component.', 'The ZIP packages include built code and runtime dependencies, so they do not require npm install. They do not include the Node.js executable. The MCPB also requires a suitable Node.js runtime; install Node.js 22+ first. These instructions do not claim publication to npm, browser extension stores, or an MCP marketplace. Refer to the download page for explicit listing status.'], list: ['nodelane-act-extension-0.1.0.zip: the standalone browser extension.', 'nodelane-act-plugin-0.1.0.zip: the MCP server, Codex plugin manifest, and matching browser extension.', 'nodelane-act-0.1.0.mcpb: an MCP bundle for clients that support this format. Install the browser extension separately.'] },
        { heading: '2. Install the browser extension', body: ['Extract the extension ZIP to a permanent folder. Open chrome://extensions in Chrome or edge://extensions in Edge, enable Developer mode, choose Load unpacked, and select the extracted folder containing manifest.json. Do not select the ZIP itself.', 'If you downloaded the full plugin ZIP, you can load its dist/extension folder instead. Do not install a duplicate extension. Review the browser’s website permission prompts. After installation, the extension does not add a pairing code, port form, or extra action confirmation.', 'Keep the extracted folder: the browser continues to load files from it. The extension popup shows connection status, running operations, and recent history.'] },
        { heading: '3A. Import an MCPB', body: ['If your client supports local MCPB installation, import nodelane-act-0.1.0.mcpb through its extension or MCP settings, review the package and permissions, and enable it. The exact entry point depends on the client and version. MCPB is not supported by every MCP client.', 'The bundle installs the MCP server, not the Chrome or Edge extension. If there is no MCPB import option, use the stdio configuration below. A client-provided Node.js runtime may be used if it meets the version requirement; the project does not assume every client includes one.'] },
        { heading: '3B. Configure a standard MCP server', body: ['Extract the full plugin ZIP to a permanent folder such as C:\\Tools\\nodelane-act. Preserve package.json, dist/, and the dotfiles in their original layout. Use node as the command and the absolute path to dist/server/index.js as its argument.', 'For clients that accept an mcpServers JSON configuration, use the example below. In other clients, enter the same command and arguments in the appropriate fields. This is a local stdio server, so do not enter it as a remote HTTP endpoint. Reload or restart MCP as your client requires.'], code: '{\n  "mcpServers": {\n    "nodelane-act": {\n      "command": "node",\n      "args": ["C:\\\\Tools\\\\nodelane-act\\\\dist\\\\server\\\\index.js"]\n    }\n  }\n}' },
        { heading: 'Install with the Codex CLI', body: ['If the Codex CLI is installed, the following command registers the same local stdio server. Replace the path with your actual installation folder. The full ZIP also includes .codex-plugin/plugin.json and .mcp.json for Codex clients that support that plugin import mechanism. Avoid registering the same server more than once.', 'Codex MCP configuration documentation: https://learn.chatgpt.com/docs/extend/mcp?surface=cli.'], code: 'codex mcp add nodelane-act -- node "C:\\Tools\\nodelane-act\\dist\\server\\index.js"' },
        { heading: '4. Check the connection and read', body: ['Starting MCP automatically starts or reuses the local bridge. The extension discovers it and connects. Install the components in either order; no port settings or authentication values need to be copied. Keep the browser and MCP client running and check that the popup reports a connection.', 'Start with “Read five Reddit recommendations” or “Read the first five answers to this Zhihu question and keep the next-page cursor.” AI selects a page and discovers the operations it needs. site.context can open a missing supported page without replacing your other tabs.'], code: 'site.context({ site: "zhihu" })\nsite.discover({ site: "zhihu", operation: "answers" })\nsite.execute({\n  targetId: "<targetId returned by context>",\n  operation: "answers",\n  args: { questionId: "<question ID>", limit: 5 }\n})' },
        { heading: 'Pagination, full text, and context budgets', body: ['There are only three initial tools: site.context, site.discover, and site.execute. Discover with site for a compact catalog, add query to find relevant capabilities, or add operation to fetch one exact input schema.', 'For Zhihu lists, pass nextCursor unchanged as cursor. Reddit lists use after or before as specified by each operation. Keep the original query and sort when paging. Fetch full text separately instead of returning an entire HTML page.', 'Zhihu topic feeds can read cards loaded on the corresponding page. At the loaded end, one normal scroll waits up to eight seconds for more. If no new cards appear and the page has no explicit end, the result is PAGE_NOT_READY. TARGET_PAGE_REQUIRED provides a URL that site.context can open. DOM and API cursors cannot be mixed.', 'site.execute.maxChars defaults to 12000 and is capped at 30000. It is a character budget, not an exact token count. Oversized output is returned in chunks. Reading a resultId with nextOffset resumes the local result cache without executing the operation again. The cache holds up to 30 results for ten minutes.'], code: 'site.execute({ resultId: "<returned resultId>", offset: 12000, maxChars: 12000 })' },
        { heading: 'Interactions and failures', body: ['State the target and action clearly. Supported user-requested writes are submitted directly to the website without a second extension confirmation. If you want to review a post first, ask AI to draft it, then explicitly request submission after review.', 'Cancellation, timeouts, and disconnections cannot undo a write already sent. If the outcome is uncertain, inspect the website before retrying. Writes are not automatically retried. After navigation or target expiry, call site.context again.', 'Website login, permissions, rate limits, and verification still apply. Complete normal website flows in the browser when needed. NodeLane Act does not bypass signatures or verification. Publishing a Zhihu article requires a target on zhuanlan.zhihu.com.'] },
        { heading: 'Update, diagnose, and uninstall', body: ['Finish ongoing operations before updating. Replace both components with matching versions, reload the extension in the browser, and restart MCP in the client. Do not remove an installation folder while an operation is running.', 'For connection problems, check the Node.js version, absolute MCP path, running browser, enabled extension, and website permissions. The commands below check status or stop the shared bridge. Disable MCP in your client before stopping the bridge, or a later request may start it again.', 'To uninstall, remove the browser extension and client MCP configuration, stop the bridge, and delete the installation folder. Local runtime configuration requires separate cleanup. Uninstalling does not delete website posts or conversations retained by your AI client.'], code: 'node "C:\\Tools\\nodelane-act\\dist\\server\\index.js" status\nnode "C:\\Tools\\nodelane-act\\dist\\server\\index.js" stop' },
        { heading: 'Build from source', body: ['Developers can build the repository, load dist/extension, and register dist/server/index.js as a local MCP server. Each added site provides a manifest.json and adapter.ts under sites/<id>/ and follows the shared validation and result contract. Rebuild and reload the extension after changing browser execution code.'], code: 'git clone https://github.com/Wy2926/nodelane-act.git\ncd nodelane-act\nnpm ci\nnpm run build' },
      ],
    },
    platforms: {
      title: 'Platforms and capabilities',
      lead: 'Version 0.1.0 includes 26 Reddit operations and 28 Zhihu operations, discovered as the task needs them.',
      sections: [
        { heading: 'Reddit: reading and community interactions', body: ['Read your account, home and recommendation feeds, post search, community search, community details and rules, community posts, post details, comment trees, profiles and user content, saved items, and the compatible message inbox. Lists support continuation; more_comments retrieves unloaded comment branches.'], list: ['Vote up or down and undo votes; save or unsave; hide or unhide posts.', 'Comment and reply, publish text or link posts, and edit or delete posts and comments you have permission to manage.', 'Join or leave communities, send compatible messages, mark messages read, and unblock previously blocked users.'] },
        { heading: 'Zhihu: questions, answers, topics, and publishing', body: ['Read account details, recommendations, following and hot feeds, search results, questions and answers, articles and pins, profiles and user content, and collections. Answers, comments, replies, and collection contents support pagination; full text can be read in sections.', 'Topics include details and reading paths for hot, top answers, newest, and unanswered feeds. Normal-page fallbacks cover question details and topic content. Topic scrolling distinguishes an explicit end from content that is not ready.'], list: ['Vote and undo votes, like or unlike comments, and add or remove thanks and not-helpful feedback.', 'Follow or unfollow users, questions, and topics; block or unblock; save or unsave; create collections.', 'Comment and reply, publish and edit answers, ask questions, publish articles, and delete content you have permission to delete.'] },
        { heading: 'Current limits', body: ['These 54 operations define the implemented scope. They do not guarantee every platform feature or every account state. Website changes, permissions, and page state can affect availability. Use site.discover for current parameter definitions and inspect the actual result.'], list: ['Image and video uploads are not implemented. Publishing currently converts plain text to HTML.', 'Complete Reddit Chat management is not implemented. Compatible message sending may create a Chat; it is not a full traditional private-message interface.', 'Reddit mark_read only marks messages read, and unblock only removes an existing block.', 'Zhihu page_content reads currently loaded text. It does not promise complete pagination or prove that a write succeeded.'] },
        { heading: 'What has been verified', body: ['On September 12, 2026, local validation passed 117 unit and integration tests, plus fixture tests using a real extension, automatic connection, and MCP. Twenty-five read-only checks used signed-in accounts across both websites, covering major reading paths and selected pagination.', 'A live Zhihu topic page expanded from 19 loaded cards to 35, verifying additional loading on that page. This does not cover every sort order, permission level, or page state.', 'Writes have been checked with mocks and an isolated browser fixture. No live publishing, message sending, or deletion was used for acceptance testing. Passing read checks does not establish live verification of all interactions.'] },
        { heading: 'Add another website', body: ['A site package supplies domains, operation schemas, an executor, and compact result conversion. The core discovers packages through a shared registry without adding a top-level MCP tool per site. Execution code is bundled with the extension rather than downloaded and run remotely.', 'Request a platform at https://github.com/Wy2926/nodelane-act/issues and describe the specific reads or interactions you need. Feasibility and maintenance resources determine what can be added and when.'] },
      ],
    },
    faq: {
      title: 'Frequently asked questions',
      lead: 'Practical answers about login, connection, context, writes, and compatibility.',
      sections: [
        { heading: 'Do I give AI my password or cookies?', body: ['No. Requests run in your signed-in browser, and login credentials and website CSRF values are not exported as credential fields in tool results. Requested account details, private content, or other results may still contain personal information and are returned to your AI client.'] },
        { heading: 'Do I still need the extension after installing an MCPB?', body: ['Yes. MCPB installs the local MCP server, while the extension executes operations in website pages. The two components connect automatically on the same computer without pairing codes, port entry, or website developer keys.'] },
        { heading: 'How many tokens does it save?', body: ['There is no fixed saving guarantee. Only three tools appear initially, operation schemas are discovered for the relevant site and task, and lists use selected fields and length limits. Actual token use depends on the model, content, and workflow. maxChars is a character budget.'] },
        { heading: 'Can I use a cloud MCP server or remote browser?', body: ['The current connection requires MCP and the browser extension on the same computer. The bridge listens only on loopback. The project does not provide a public remote-browser proxy and does not require exposing a port to the internet.'] },
        { heading: 'Will every write ask for another confirmation?', body: ['The extension adds no second confirmation. AI should only perform writes requested by the user. Ask for a draft first if you want to review content before explicitly requesting publication. Your AI client may have separate tool-approval controls.'] },
        { heading: 'Can a comment still be sent after cancellation?', body: ['Yes. Cancellation can stop waiting or prevent steps that have not run; it cannot undo a request already received by the website. The same applies to timeouts and disconnections. Check the final website state before sending the same action again.'] },
        { heading: 'Why does an API fail when its page opens normally?', body: ['Websites may apply different permissions and verification to different access paths. Some Zhihu reads have normal-page fallbacks; other restrictions are reported as errors. The project does not bypass login, verification, signatures, or access controls.'] },
        { heading: 'Why does the next page return PAGE_NOT_READY?', body: ['The topic page has not loaded new cards and has not explicitly reached the end. Retry the same read later. If the result is TARGET_PAGE_REQUIRED, AI can call site.context with the provided normal page URL. After navigation, select the target again and use an appropriate cursor.'] },
        { heading: 'Can several AI clients connect?', body: ['Local clients can share the bridge, with separate target handles and output caches. They still operate the same browser and website accounts, so avoid conflicting instructions against the same content.'] },
        { heading: 'Is it free, and is it an official platform integration?', body: ['The source is available under the MIT license. Your AI provider, network, and websites may have their own charges or terms. This is an independent project and does not claim official partnership or endorsement by Reddit, Zhihu, OpenAI, or other named platforms.'] },
        { heading: 'What about macOS, Linux, or phones?', body: ['Windows is the tested environment, with Node.js 22+ and Chrome or Edge 120+ required. macOS and Linux have not been tested. Mobile browsers are outside the current validation scope. Cross-platform source code is not evidence of tested support on those systems.'] },
      ],
    },
    changelog: {
      title: 'Changelog',
      lead: 'Implemented changes and their verification scope. Check downloads and repository releases for package publication status.',
      sections: [
        { heading: '0.1.0 · September 12, 2026', body: ['The first NodeLane Act version provides compact website operations through your own browser session, with tools discovered on demand.'], list: ['Three fixed MCP tools with 26 Reddit and 28 Zhihu operations.', 'Automatic local bridge startup and extension discovery, without pairing or port configuration.', 'List pagination, segmented full text, result caching, and normal-page Zhihu question and topic reads.', 'Tab, URL, and document binding; cancellation, disconnection, and uncertain-write handling without automatic write replay.', 'Browser ZIP, full plugin ZIP, MCPB packaging, and a standard stdio MCP entry point.', '117 unit and integration tests and 25 live read-only checks. Writes use mocks and browser fixtures only.'] },
        { heading: 'Known limits', body: ['Image and video uploads and complete Reddit Chat are not implemented. macOS, Linux, and live execution of all write operations have not been verified. Website interfaces may change. Track issues and follow-up work at https://github.com/Wy2926/nodelane-act/issues.'] },
      ],
    },
    about: {
      title: 'About NodeLane Act',
      lead: 'Help AI understand what a website can do and carry out clear requests through your own browser.',
      sections: [
        { heading: 'Why this project exists', body: ['Cross-site tasks can require large page dumps, repeated element searches, and unrelated tool schemas. NodeLane Act packages common site features into independent adapters, discovers their inputs for the current task, and returns compact results with continuation when needed.', 'Website requests still happen in your browser. MCP handles connection, discovery, and output budgets; the extension handles execution in a selected page. The website’s own login, permissions, and verification remain in effect.'] },
        { heading: 'Starting with two platforms', body: ['Version 0.1.0 focuses on Zhihu and Reddit with 54 operations. The project favors explicit outcomes and failures: opening an editor or saving a draft is not described as publication, and unloaded content is not presented as the end of a list.'] },
        { heading: 'Open source and maintenance', body: ['NodeLane contributors maintain the project under the MIT license. Source, issues, and contribution channels are at https://github.com/Wy2926/nodelane-act. The website is https://act.nodelane.net and the contact address is contact@nodelane.net.', 'Platform names and trademarks belong to their respective owners. They identify compatibility targets and do not imply approval, sponsorship, or official maintenance by those platforms.'] },
      ],
    },
    support: {
      title: 'Support and feedback',
      lead: 'Report a reproducible problem, request a platform, or contact maintainers privately.',
      sections: [
        { heading: 'Public issues and requests', body: ['Open an issue at https://github.com/Wy2926/nodelane-act/issues. Search for an existing report first, then describe the expected and actual behavior. Community support does not include a promised response time or service level.'], list: ['NodeLane Act, operating system, browser, and Node.js versions.', 'AI client, installation method, and whether the extension reports a connection.', 'Site, operation name, minimal redacted arguments, error code, and reproduction steps.', 'For writes, whether you checked the final state on the website. Do not repeatedly publish or delete content just to reproduce a problem.'] },
        { heading: 'Private contact', body: ['Send account-related details, privacy requests, and security reports to contact@nodelane.net. Maintainers and the email service process your message. Share only what is necessary to resolve the issue.', 'Do not send passwords, cookies, full session tokens, bridge authentication files, or unredacted network captures. Screenshots and logs can reveal usernames, private messages, content, and paths; review them before sharing.'] },
        { heading: 'First checks', body: ['Confirm Node.js 22+ runs, the absolute MCP path exists, and MCP and the browser run on the same computer. Check that the extension is enabled, has website permissions, and that the website session is signed in.', 'After navigation errors, select the page again. After a write timeout or disconnection, inspect the website outcome first. Complete verification normally instead of repeatedly retrying restricted requests. See https://act.nodelane.net/en/docs/ for installation instructions.'] },
      ],
    },
    privacy: {
      title: 'Privacy notice',
      lead: 'Updated September 12, 2026. How the website, browser extension, and local MCP server each handle data.',
      sections: [
        { heading: 'Scope', body: ['This notice covers act.nodelane.net and NodeLane Act 0.1.0. The project is provided by NodeLane maintainers; contact contact@nodelane.net about privacy. Your AI client, browser, GitHub, email service, and the websites you operate have their own data practices.'] },
        { heading: 'Browser and MCP processing', body: ['When tools are called, the extension identifies supported website tabs and performs the requested read or interaction in a selected page. Results may include tab titles and URLs, account details, list entries, full text, comments, private messages, and action outcomes, depending on the operation and website permissions.', 'Website login cookies and CSRF values are used within the browser session and are not exported to the model as credential fields. The local MCP server and extension exchange instructions and results over loopback. The current code has no telemetry flow that sends operation content to a NodeLane-hosted backend.'] },
        { heading: 'Your AI client receives results', body: ['Tool requests and results are provided to your chosen MCP or AI client. If it uses a cloud model or stores conversations, content may leave the device and be handled under that service’s settings and policies. NodeLane Act cannot control that provider’s retention, training, or sharing settings for you.', 'Execution in a local browser does not mean that read content never leaves the device. Before requesting personal, private, or organizational data, confirm you have permission to provide it to your chosen AI service.'] },
        { heading: 'Local storage and caches', body: ['The local runtime directory stores bridge configuration and generated connection authentication data. Extension storage keeps the last successful connection port and recent write request IDs and times used to prevent replay.', 'The MCP process caches oversized results in memory, up to 30 entries for ten minutes. Site pagination may use short-lived page caches. The extension also retains recent statuses, errors, and completed results while running. These caches can contain returned data and are not a separate secure storage system.', 'Clearing extension data, ending the relevant browser or MCP processes, and removing runtime configuration affect different local data. Uninstalling does not remove website content, AI conversations, system backups, or diagnostic files you saved.'] },
        { heading: 'Website access and security services', body: ['The website currently has no product accounts, advertising trackers, analytics scripts, or optional analytics or marketing cookies. Cloudflare provides delivery and security services. Hosting and security systems may process basic access information such as IP addresses, request times, paths, status codes, browser details, and security events.', 'These records support delivery, troubleshooting, and abuse prevention. Exact log fields and retention depend on deployment and security configuration; this project does not claim that visiting the website generates no data. Cloudflare cookie use depends on enabled security features. See the cookie notice.'] },
        { heading: 'Contact records and requests', body: ['GitHub issues are generally public and are handled under GitHub’s policies. If you email maintainers, your address and message are received for support and investigation. Do not post credentials or private website content publicly.', 'To ask about, correct, or delete contact records held by maintainers, or exercise relevant rights under applicable law, email with the data and request concerned. Proportionate identity verification may be needed; website login credentials are not required. Ask the relevant website or AI provider directly about records it holds.', 'Material changes will be reflected by an updated date and explanation on this page. New telemetry, accounts, or processing purposes should be accompanied by an updated notice.'] },
      ],
    },
    terms: {
      title: 'Terms of use',
      lead: 'Updated September 12, 2026. Website use and the boundaries of the open-source software and website operations.',
      sections: [
        { heading: 'Software license', body: ['NodeLane Act is licensed under MIT. You may use, copy, modify, and distribute the software subject to that license, including retaining the required copyright and permission notices. Third-party components retain their respective licenses.', 'The repository LICENSE governs the software grant. This page does not replace or narrow it. Read the full text at https://github.com/Wy2926/nodelane-act/blob/main/LICENSE.'] },
        { heading: 'Your accounts and instructions', body: ['Operate only accounts and content you are authorized to access, and comply with applicable law, website terms, community rules, and the rights of others. The software grants no extra website permissions and does not establish that a website permits a particular form of automation.', 'Review the target, proposed content, and chosen AI service. User-requested writes can be submitted directly without a required per-action extension confirmation. Cancellation, timeouts, or disconnections do not undo sent requests.'] },
        { heading: 'Availability and accuracy', body: ['Website interfaces, page structures, accounts, and rules can change. The project aims to return explicit outcomes but cannot guarantee continued availability of each operation or the accuracy, suitability, or completeness of AI-generated content. Verify the final website state when needed.', 'Compatibility descriptions and tests apply only to the stated version and scope. They are not guarantees for every account, device, or write scenario. Current write validation uses mocks and fixtures.'] },
        { heading: 'No additional warranty or service commitment', body: ['The software is distributed subject to the MIT license’s warranty disclaimer and liability terms. The project offers no additional commitment concerning availability, merchantability, fitness for a particular purpose, or response times. This notice does not exclude rights that applicable law does not allow to be excluded.', 'External links provide documentation, downloads, or feedback channels. Third-party operators control their services and may impose separate fees, account requirements, and terms.'] },
        { heading: 'Names, updates, and contact', body: ['NodeLane Act is independent. Names including Reddit, Zhihu, and OpenAI belong to their respective owners. Compatibility descriptions do not claim official authorization, partnership, or endorsement.', 'Capabilities and this page may change. The license accompanying your software version governs its licensing. Contact contact@nodelane.net with questions about this page or project use.'] },
      ],
    },
    security: {
      title: 'Security and trust boundaries',
      lead: 'The connection is local, and execution happens in selected website pages. Authorize operations with these boundaries in mind.',
      sections: [
        { heading: 'Why the extension needs permissions', body: ['tabs identifies website tabs; scripting runs bundled adapters in a selected document; storage keeps connection state and write deduplication records; alarms maintain the connection. The built extension declares the supported website domains and local connection permissions.', 'The current site scope covers the relevant Reddit, Zhihu, and Zhihu column domains. Browser execution is constrained by extension permissions and the site registry. This does not make page content trustworthy. Do not expose the bridge to the public internet.'] },
        { heading: 'Local connection and document binding', body: ['The bridge listens only on 127.0.0.1. The extension uses a fixed extension Origin, and the local HTTP control interface uses generated authentication data. That value is not sent to AI or exchanged manually by the user.', 'Targets are bound to a tab, URL, and browser document identifier. Navigation or document replacement may invalidate an operation and require fresh context. Schemas validate arguments. Execution code ships in the local extension rather than being downloaded and run remotely.', 'These controls do not defend against malware that already controls your device, browser, or AI client. Protect your local account and installation folders and install trusted releases.'] },
        { heading: 'Website text is not an instruction', body: ['Posts, comments, private messages, and page bodies are untrusted input. They may try to redirect AI, disclose information, or trigger unrelated actions. AI should treat that text as material to process, not as user authorization.', 'Compact results, source links, and discovery guidance help communicate this boundary, but do not provide complete prompt-injection protection. The client must still separate user instructions, website content, and tool authority.'] },
        { heading: 'Writes, cancellation, and uncertainty', body: ['Only user-requested interactions should run. The extension adds no confirmation window and does not automatically retry writes. Recent write request IDs help prevent replay of the same request after reconnection.', 'Cancellation affects unfinished local work; it cannot undo an operation already received by the website. After WRITE_UNCONFIRMED, timeout, disconnection, or navigation, inspect the website before retrying. A newly generated retry request is not an undo mechanism.'] },
        { heading: 'Report a vulnerability', body: ['Privately email contact@nodelane.net with the version, impact, and a minimal reproduction without sensitive data. Do not publish usable credentials, user information, or full details of an unresolved exploit in a public issue.', 'Maintainers assess reports as resources allow. There is no promised response time, bounty, or authorization for testing beyond what has been agreed. Use your own accounts and isolated environments, avoid others’ data, and do not perform destructive tests.'] },
      ],
    },
    cookies: {
      title: 'Cookies and local storage',
      lead: 'Updated September 12, 2026. Website cookies, extension state, and website login data serve different purposes.',
      sections: [
        { heading: 'Current website behavior', body: ['The website currently uses no advertising or analytics scripts, optional cookies, or cookie-based product login. Language selection uses page URLs. An absence of optional cookies does not imply an absence of network access records.'] },
        { heading: 'Cloudflare security cookies', body: ['The website uses Cloudflare. Enabled security or abuse-prevention features may set necessary cookies, such as cf_clearance for verification state. Which cookies appear depends on the deployment and request.', 'Cloudflare explains its cookie purposes at https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/.'] },
        { heading: 'Extension and website storage are separate', body: ['The extension uses chrome.storage.local for connection state and write deduplication. Page and MCP process memory can also hold pagination results. These are not website tracking cookies.', 'Reddit and Zhihu login cookies are managed by those websites and your browser. NodeLane Act makes requests in your existing session. Clearing this website’s cookies does not sign you out of those platforms or erase extension configuration.'] },
        { heading: 'Control and changes', body: ['Use browser site-data settings to inspect, block, or remove this website’s cookies. Blocking cookies needed for security verification may affect access. Manage extension data in browser extension settings and website login data under the corresponding domain.', 'If optional analytics, advertising, or other cookies are introduced, this notice and relevant choices need to be updated. Contact contact@nodelane.net about the current configuration.'] },
      ],
    },
  },
};
