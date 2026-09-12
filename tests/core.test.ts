import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { adapterRegistrations, getAdapter, siteFromUrl } from "../src/shared/registry.js";
import { validateArgs } from "../src/shared/validate.js";
import { SiteService } from "../src/server/service.js";
import { createMcpServer } from "../src/server/mcp.js";
import { ResultStore } from "../src/server/output.js";
import type { BrowserCommand } from "../src/server/bridge.js";
import type { OperationResult } from "../src/shared/contracts.js";

test("registry extension needs no core branch, preserves lazy initialization and isolates discovery", async () => {
  let loads = 0;
  adapterRegistrations.push({ id: "fixture-forum", name: "Fixture Forum", description: "Test-only independent site", hosts: ["forum.example.com"], load: async () => { loads++; return { operations: [{ site: "fixture-forum", id: "read", title: "Read", description: "Read one item", keywords: ["read"], readOnly: true, inputSchema: { type: "object", additionalProperties: false, properties: {} } }], execute: async () => ({ ok: true }) }; } });
  try {
    const service = new SiteService(async () => ({ ok: true, data: { targets: [] } }));
    const sites = await service.discover({ query: "Fixture" });
    assert.match(JSON.stringify(sites), /fixture-forum/); assert.equal(loads, 0);
    assert.equal(siteFromUrl("https://forum.example.com/thread/1"), "fixture-forum");
    assert.equal(siteFromUrl("https://forum.example.com.evil.test/"), undefined);
    assert.equal(siteFromUrl("http://forum.example.com/"), undefined);
    assert.equal(siteFromUrl("https://user:pass@forum.example.com/"), undefined);
    const detail = await service.discover({ site: "fixture-forum", operation: "read" });
    assert.match(JSON.stringify(detail), /inputSchema/); assert.doesNotMatch(JSON.stringify(detail), /reddit|zhihu/); assert.equal(loads, 1);
    await getAdapter("fixture-forum"); assert.equal(loads, 1);
  } finally { adapterRegistrations.pop(); }
});

test("only three stable MCP tools are serialized; site-specific schemas are discovered on demand", async () => {
  const service = new SiteService(async () => ({ ok: true, data: { targets: [] } }));
  const server = createMcpServer(service);
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name), ["site.context", "site.discover", "site.execute"]);
    assert.doesNotMatch(JSON.stringify(listed), /reddit|zhihu|search_communities/);
    const detail = await client.callTool({ name: "site.discover", arguments: { site: "reddit", operation: "account" } });
    const text = (detail.content as { text: string }[])[0].text;
    assert.match(text, /inputSchema/); assert.doesNotMatch(text, /zhihu/);
    const invalid = await client.callTool({ name: "site.execute", arguments: { targetId: "unknown", operation: "account" } });
    assert.equal(invalid.isError, true);
  } finally { await client.close(); await server.close(); }
});

test("execution requires an issued target, validates schema, and refuses navigated targets", async () => {
  const calls: BrowserCommand[] = [];
  let url = "https://www.reddit.com/r/test/";
  const browser = async (command: BrowserCommand): Promise<OperationResult> => { calls.push(command); return command.action === "context" ? { ok: true, data: { targets: [{ tabId: 12, site: "reddit", url, title: "Test" }] } } : { ok: true, data: { done: true } }; };
  const service = new SiteService(browser);
  const context = await service.context() as { targets: { targetId: string }[] };
  const targetId = context.targets[0].targetId;
  await service.execute({ targetId, operation: "account", args: {} });
  assert.equal(calls.at(-1)?.action, "execute"); assert.equal(calls.at(-1)?.expectedUrl, url);
  const count = calls.length;
  const invalid = await service.execute({ targetId, operation: "account", args: { cookie: "secret" } }) as OperationResult;
  assert.equal(invalid.error?.code, "INVALID_ARGUMENTS"); assert.equal(calls.length, count);
  url = "https://www.reddit.com/r/another/";
  const changed = await service.execute({ targetId, operation: "account" }) as OperationResult;
  assert.equal(changed.error?.code, "TARGET_CHANGED"); assert.equal(calls.at(-1)?.action, "context");
});

test("pre-cancelled calls and cancellation during target validation never dispatch a write", async () => {
  const controller = new AbortController();
  const calls: BrowserCommand[] = [];
  let cancelPreflight = false;
  const targets = [{ tabId: 12, site: "reddit", url: "https://www.reddit.com/r/test/", title: "Test" }];
  const service = new SiteService(async (command, signal) => {
    calls.push(command);
    if (cancelPreflight) { assert.equal(signal, controller.signal); controller.abort("private cancellation reason"); }
    return { ok: true, data: { targets } };
  });
  const context = await service.context() as { targets: { targetId: string }[] };
  const args = { targetId: context.targets[0].targetId, operation: "save", args: { id: "t3_abc" } };
  cancelPreflight = true;
  const result = await service.execute(args, controller.signal) as OperationResult;
  assert.equal(result.error?.code, "CANCELLED");
  assert.equal(calls.length, 2); assert.ok(calls.every(command => command.action === "context"));
  assert.doesNotMatch(JSON.stringify(result), /private cancellation reason/);
  assert.equal((await service.execute(args, controller.signal) as OperationResult).error?.code, "CANCELLED");
  assert.equal((await service.context("reddit", undefined, true, controller.signal) as OperationResult).error?.code, "CANCELLED");
  assert.equal((await service.discover({ site: "reddit" }, controller.signal) as OperationResult).error?.code, "CANCELLED");
  assert.equal(calls.length, 2);
});

test("cancelled in-flight writes report an uncertain outcome and are never replayed", { timeout: 5000 }, async () => {
  const controller = new AbortController();
  let writes = 0;
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const service = new SiteService(async (command, signal) => {
    if (command.action === "context") return { ok: true, data: { targets: [{ tabId: 12, site: "reddit", url: "https://www.reddit.com/", title: "Test" }] } };
    writes++;
    assert.equal(signal, controller.signal);
    return await new Promise<OperationResult>((_resolve, reject) => {
      signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
      markStarted();
    });
  });
  const context = await service.context() as { targets: { targetId: string }[] };
  const pending = service.execute({ targetId: context.targets[0].targetId, operation: "save", args: { id: "t3_abc" } }, controller.signal);
  await started;
  controller.abort(new Error("private cancellation reason"));
  const result = await pending as OperationResult;
  assert.equal(result.error?.code, "CANCELLED");
  assert.match(result.error!.message, /may already have reached.*inspect its outcome/);
  assert.doesNotMatch(result.error!.message, /private cancellation reason/);
  assert.equal(writes, 1);
});

for (const tool of ["site.context", "site.execute"] as const) {
  test(`MCP cancellation notification reaches the browser signal for ${tool}`, { timeout: 5000 }, async () => {
    const controller = new AbortController();
    const calls: BrowserCommand[] = [];
    let pendingAction: BrowserCommand["action"] | undefined;
    let markStarted!: () => void, markCancelled!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const cancelled = new Promise<void>(resolve => { markCancelled = resolve; });
    const service = new SiteService(async (command, signal) => {
      calls.push(command);
      if (command.action !== pendingAction) return { ok: true, data: { targets: [{ tabId: 12, site: "reddit", url: "https://www.reddit.com/", title: "Test" }] } };
      assert.ok(signal); assert.equal(signal.aborted, false);
      return await new Promise<OperationResult>((_resolve, reject) => {
        signal.addEventListener("abort", () => { markCancelled(); reject(signal.reason); }, { once: true });
        markStarted();
      });
    });
    const server = createMcpServer(service);
    const client = new Client({ name: "cancel-test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a); await client.connect(b);
    try {
      const issued = await client.callTool({ name: "site.context", arguments: {} });
      const targetId = JSON.parse((issued.content as { text: string }[])[0].text).targets[0].targetId as string;
      pendingAction = tool === "site.context" ? "context" : "execute";
      const rejected = assert.rejects(client.callTool({ name: tool, arguments: tool === "site.context" ? {} : { targetId, operation: "save", args: { id: "t3_abc" } } }, undefined, { signal: controller.signal }));
      await started;
      controller.abort();
      await Promise.all([rejected, cancelled]);
      assert.equal(calls.filter(command => command.action === "execute").length, tool === "site.execute" ? 1 : 0);
    } finally { controller.abort(); await client.close(); await server.close(); }
  });
}

test("CSP-safe schemas reject extra parameters, unknown validators, prototype keys and duplicates", () => {
  assert.equal(validateArgs({ type: "object", properties: {}, additionalProperties: false }, { approved: true }).ok, false);
  assert.equal(validateArgs({ type: "string", format: "email" }, "x").ok, false);
  assert.equal(validateArgs({ type: "object" }, JSON.parse('{"__proto__":{}}')).ok, false);
  assert.equal(validateArgs({ type: "array", uniqueItems: true }, ["x", "x"]).ok, false);
  assert.equal(validateArgs({ type: "integer", minimum: 1, maximum: 20 }, 21).ok, false);
});

test("large outputs are retrievable without repeating writes and cached results are bounded", () => {
  const store = new ResultStore(1);
  const first = store.format({ text: "a".repeat(2500) }, 1000) as { resultId: string; nextOffset: number; chunk: string };
  assert.equal(first.chunk.length, 1000); assert.equal(first.nextOffset, 1000);
  const second = store.read(first.resultId, first.nextOffset, 1000) as { chunk: string; nextOffset: number };
  assert.equal(second.chunk.length, 1000); assert.equal(second.nextOffset, 2000);
  store.format({ text: "b".repeat(2500) }, 1000);
  assert.equal((store.read(first.resultId) as OperationResult).error?.code, "RESULT_EXPIRED");
});
