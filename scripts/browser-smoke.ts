import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { BrowserBridge } from "../src/server/bridge.js";
import { build } from "esbuild";
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";

// Real Chromium, real extension, real stdio MCP and HTTP/WebSocket bridge.
// Website network is intercepted with deterministic fixtures; no live account or writes.
const project = process.cwd();
const temporary = await mkdtemp(path.join(tmpdir(), "site-mcp-smoke-"));
const extensionPath = path.join(temporary, "extension");
const profile = path.join(temporary, "profile");
const config = { version: 1 as const, port: 0, token: randomBytes(32).toString("hex") };
let bridge = new BrowserBridge(config, 20_000);
await bridge.start(); config.port = bridge.port;
let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
let client: Client | undefined;
try {
  await cp(path.join(project, "dist/extension"), extensionPath, { recursive: true });
  await build({ entryPoints: [path.join(project, "extension/background.ts"), path.join(project, "extension/popup.ts")], outdir: extensionPath, bundle: true, platform: "browser", target: "chrome120", format: "esm", splitting: false, keepNames: false, define: { __SITE_MCP_DISCOVERY_PORTS__: JSON.stringify([config.port]) } });
  const configFile = path.join(temporary, "config.json");
  await writeFile(configFile, JSON.stringify(config));
  client = new Client({ name: "browser-smoke", version: "1" });
  const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(project, "dist/server/index.js"), "--config", configFile], env: environment, stderr: "pipe" });
  await client.connect(transport);
  // Extension-created tabs can navigate before Playwright attaches its request routes.
  // Block that first network request; only explicitly fulfilled fixtures can load.
  browser = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, proxy: { server: "http://127.0.0.1:9", bypass: "127.0.0.1,localhost" }, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent("serviceworker", { timeout: 20_000 });
  const extensionId = new URL(worker.url()).hostname;
  assert.equal(extensionId, JSON.parse(await readFile(path.join(project, "extension/identity.json"), "utf8")).extensionId, "Installation path does not change the extension identity");
  const pageErrors: string[] = [];
  let writes = 0;
  let answerRequests = 0;
  await browser.route("https://www.reddit.com/**", async route => {
    const url = new URL(route.request().url());
    let data: unknown;
    if (url.pathname === "/r/test/") { await route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><title>Reddit fixture</title><h1>Test community</h1>' }); return; }
    if (url.pathname === "/api/me.json") data = { kind: "t2", data: { name: "fixture_user", id: "abc", modhash: "fixture-only-csrf" } };
    else if (url.pathname === "/api/save") { writes++; data = {}; }
    else if (url.pathname.endsWith(".json")) data = { kind: "Listing", data: { after: "t3_next", before: null, children: [{ kind: "t3", data: { id: "abc", name: "t3_abc", title: "MCP compact fixture", selftext: "Fixture body", permalink: "/r/test/comments/abc/demo/", subreddit: "test", author: "fixture_user", score: 7, num_comments: 2 } }] } };
    else { await route.fulfill({ status: 404, body: "No fixture" }); return; }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
  });
  await browser.route("https://www.zhihu.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/") { await route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><title>知乎 fixture</title><main>已加载的问题和回答</main>' }); return; }
    if (url.pathname === "/question/123") {
      await route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><title>测试问题 - 知乎</title><h1 class="QuestionHeader-title">测试问题</h1><script id="js-initialData" type="application/json">{"initialState":{"entities":{"questions":{"123":{"id":123,"title":"测试问题","detail":"<p>正常网页问题描述</p>","answerCount":2}}}}}</script>' }); return;
    }
    if (url.pathname === "/topic/123/hot") {
      const card = (id: string) => `<div class="List-item"><div class="ContentItem AnswerItem"><h2 class="ContentItem-title"><a href="/question/123/answer/${id}">话题回答</a></h2><div class="RichContent-inner"><div class="RichText">精简话题内容</div></div></div></div>`;
      await route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><title>测试话题 - 知乎</title><script id="js-initialData" type="application/json">{"initialState":{"entities":{"topics":{"123":{"id":123,"name":"测试话题","introduction":"<p>话题介绍</p>","followersCount":2}}}}}</script><main id="TopicMain"><div class="TopicFeedList" style="padding-top:200vh">${card("1234567890123456789")}</div></main><script>addEventListener('scroll',()=>document.querySelector('.TopicFeedList').insertAdjacentHTML('beforeend',${JSON.stringify(card("1234567890123456790") + '<div class="List-footer">没有更多内容</div>')}),{once:true})</script>` }); return;
    }
    if (url.pathname.includes("/questions/")) { answerRequests++; await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: ["1234567890123456789", "1234567890123456790"].map(id => ({ id, type: "answer", content: "<p>精简回答内容</p>", question: { id: 123, title: "测试问题" }, author: { name: "用户", url_token: "fixture" }, voteup_count: 3 })), paging: { is_end: true } }) }); return; }
    await route.fulfill({ status: 404, body: "No fixture" });
  });
  await browser.route("https://web.whatsapp.com/**", async route => {
    await route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><title>WhatsApp fixture</title><main>Fixture chat</main><script>
      const chat = {id: '123456789@lid', unreadCount: 0, mute: {expiration: 0}};
      const message = {id: {_serialized: 'true_123456789@lid_ABC_out', remote: chat.id, fromMe: true}, type: 'chat', star: false, body: '中'.repeat(7000), mediaKey: 'fixture-secret-never-export'};
      window.fixtureWrites = 0;
      window.WPP = {
        loader: {isReady: true}, version: 'fixture',
        conn: {isAuthenticated: () => true, isMainReady: () => true, getMyUserId: () => '123456789@c.us'},
        profile: {getMyProfileName: () => 'fixture_user'},
        chat: {
          list: () => [chat], get: () => chat, getMessageById: () => message, getMessages: () => [message],
          starMessage: (id, star) => { window.fixtureWrites++; const old = message.star; setTimeout(() => {message.star = star}, 50); return {id, star: old}; }
        }
      };
    </script>` });
  });
  const reddit = await browser.newPage(); await reddit.goto("https://www.reddit.com/r/test/");
  const whatsapp = await browser.newPage(); await whatsapp.goto("https://web.whatsapp.com/");
  const popup = await browser.newPage();
  popup.on("pageerror", error => pageErrors.push(error.message));
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  assert.equal(await popup.locator("#token, #port, #pairing-form").count(), 0, "No pairing controls");
  try { await popup.waitForFunction(() => /已.*连接/.test(document.getElementById("connection-text")?.textContent ?? ""), undefined, { timeout: 20_000 }); }
  catch (error) {
    console.error("Extension connection state:", await popup.locator("body").innerText());
    console.error("Test extension id:", extensionId);
    throw error;
  }
  assert.equal(bridge.connected, true);
  const invoke = async (name: string, args: Record<string, unknown>) => {
    const result = await client!.callTool({ name, arguments: args }, undefined, { timeout: 30_000 });
    const data = JSON.parse((result.content as { text: string }[])[0].text);
    assert.equal(result.isError, false, JSON.stringify(data));
    return data;
  };
  const tools = await client.listTools(); assert.equal(tools.tools.length, 3);
  const openFixtureContext = async (args: Record<string, unknown>, url: string) => {
    const attached = browser!.waitForEvent("page");
    const context = invoke("site.context", args);
    // The extension creates the tab; this fixture-only navigation starts after routing attaches.
    const page = await attached;
    await page.goto(url, { waitUntil: "load" });
    return context;
  };
  const opened = await openFixtureContext({ site: "zhihu" }, "https://www.zhihu.com/");
  assert.equal(opened.targets.length, 1, "MCP opens the missing website automatically");
  const targets = await invoke("site.context", {});
  const redditTarget = targets.targets.find((target: { site: string }) => target.site === "reddit");
  const zhihuTarget = targets.targets.find((target: { site: string }) => target.site === "zhihu");
  const whatsappTarget = targets.targets.find((target: { site: string }) => target.site === "whatsapp");
  assert.ok(redditTarget); assert.ok(zhihuTarget);
  assert.ok(whatsappTarget);
  const waAccount = await invoke("site.execute", { targetId: whatsappTarget.targetId, operation: "account", args: {} });
  assert.equal(waAccount.data.ready, true);
  const waChat = await invoke("site.execute", { targetId: whatsappTarget.targetId, operation: "chat", args: { chat_id: "123456789@lid" } });
  assert.equal(waChat.data.muted, false, "WhatsApp mute projection uses expiration when derived fields are missing");
  const waHistory = await invoke("site.execute", { targetId: whatsappTarget.targetId, operation: "messages", args: { chat_id: "123456789@lid" } });
  assert.equal(waHistory.data.items[0].text.length, 240);
  assert.equal(waHistory.data.items[0].chat_id, undefined);
  assert.equal(waHistory.data.chat_id, "123456789@lid");
  assert.doesNotMatch(JSON.stringify(waHistory), /fixture-secret-never-export/);
  const waText = await invoke("site.execute", { targetId: whatsappTarget.targetId, operation: "message", args: { chat_id: "123456789@lid", message_id: "true_123456789@lid_ABC_out" } });
  const waTail = await invoke("site.execute", { targetId: whatsappTarget.targetId, operation: "message", args: { chat_id: "123456789@lid", message_id: "true_123456789@lid_ABC_out", text_offset: waText.data.next_text_offset } });
  assert.equal(waText.data.text + waTail.data.text, "中".repeat(7000), "MCP text continuation preserves content beyond the former 6000-character cap");
  const waStar = await invoke("site.execute", { targetId: whatsappTarget.targetId, operation: "star_message", args: { chat_id: "123456789@lid", message_id: "true_123456789@lid_ABC_out", starred: true } });
  assert.equal(waStar.data.starred, true, "The MAIN-world adapter observes delayed star state instead of the stale return value");
  assert.equal(await whatsapp.evaluate(() => (window as any).fixtureWrites), 1);
  const discovered = await invoke("site.discover", { site: "reddit", operation: "feed" });
  assert.equal(discovered.operations.length, 1); assert.doesNotMatch(JSON.stringify(discovered), /zhihu/);
  const feed = await invoke("site.execute", { targetId: redditTarget.targetId, operation: "feed", args: { limit: 1 } });
  assert.match(JSON.stringify(feed), /MCP compact fixture/); assert.match(JSON.stringify(feed), /t3_next/);
  const answers = await invoke("site.execute", { targetId: zhihuTarget.targetId, operation: "answers", args: { questionId: "123", limit: 1 } });
  assert.match(JSON.stringify(answers), /1234567890123456789/); assert.match(JSON.stringify(answers), /nextCursor/);
  const nextAnswers = await invoke("site.execute", { targetId: zhihuTarget.targetId, operation: "answers", args: { questionId: "123", limit: 1, cursor: answers.data.nextCursor } });
  assert.match(JSON.stringify(nextAnswers), /1234567890123456790/);
  assert.equal(nextAnswers.data.hasMore, false);
  assert.equal(answerRequests, 1, "Overflow pagination uses one browser snapshot without dropping entries");
  const question = await invoke("site.execute", { targetId: zhihuTarget.targetId, operation: "content", args: { type: "question", id: "123" } });
  assert.equal(question.data.descriptionComplete, true);
  assert.match(JSON.stringify(question), /正常网页问题描述/);
  const topicContext = await openFixtureContext({ url: "https://www.zhihu.com/topic/123/hot" }, "https://www.zhihu.com/topic/123/hot");
  const topicTargetId = topicContext.targets[0].targetId;
  const topic = await invoke("site.execute", { targetId: topicTargetId, operation: "topic", args: { topicId: "123" } });
  assert.equal(topic.data.name, "测试话题");
  const topicFeed = await invoke("site.execute", { targetId: topicTargetId, operation: "topic_feed", args: { topicId: "123", limit: 1 } });
  assert.equal(topicFeed.data.items[0].id, "1234567890123456789");
  const moreTopicFeed = await invoke("site.execute", { targetId: topicTargetId, operation: "topic_feed", args: { topicId: "123", limit: 1, cursor: topicFeed.data.nextCursor } });
  assert.equal(moreTopicFeed.data.items[0].id, "1234567890123456790");
  assert.equal(moreTopicFeed.data.hasMore, false, "Normal-page scrolling loads a new card and respects an explicit end");
  await invoke("site.execute", { targetId: redditTarget.targetId, operation: "save", args: { id: "t3_abc" } });
  assert.equal(await popup.getByRole("button", { name: "确认执行", exact: true }).count(), 0);
  await mkdir(path.join(project, "test-results"), { recursive: true });
  await popup.screenshot({ path: path.join(project, "test-results/extension-connected.png"), fullPage: true });
  assert.equal(writes, 1);
  assert.deepEqual(pageErrors, []);
  await bridge.close();
  bridge = new BrowserBridge(config, 20_000);
  await bridge.start();
  await invoke("site.context", {});
  assert.equal(bridge.connected, true, "Extension rediscovers a restarted local bridge");
  assert.equal(writes, 1, "A reconnect must not replay the prior write");
  assert.equal(await whatsapp.evaluate(() => (window as any).fixtureWrites), 1, "WhatsApp write is not replayed on reconnect");
  await writeFile(path.join(project, "test-results/browser-smoke.json"), JSON.stringify({ passed: true, browser: browser.browser()?.version(), tools: tools.tools.map(tool => tool.name), checks: ["MV3 service worker loads", "automatic loopback WebSocket discovery", "no pairing or confirmation UI", "stdio MCP lists three tools", "automatic website tab opening", "authorized targets", "site-specific discovery", "Reddit MAIN-world fetch and cursor", "Zhihu MAIN-world fetch and lossless id", "overflow pagination without dropped entries or refetch", "question normal HTML and topic SSR extraction", "topic DOM cursor loads a new card by scrolling", "one direct user-requested mutation", "bridge restart and automatic reconnection without repeated write"], liveWebsiteValidation: false }, null, 2));
  console.log("PASS: real Chromium extension + automatic WebSocket discovery + stdio MCP; fixture reads/pagination and direct write. No live website writes.");
} finally {
  await client?.close();
  await browser?.close();
  await bridge.close();
  const resolved = path.resolve(temporary);
  if (resolved.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(resolved).startsWith("site-mcp-smoke-")) await rm(resolved, { recursive: true, force: true });
}
