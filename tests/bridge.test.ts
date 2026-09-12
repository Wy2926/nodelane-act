import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { WebSocket } from "ws";
import { BrowserBridge, bridgeFetch, type BrowserCommand } from "../src/server/bridge.js";
import { EXTENSION_ORIGIN, PROTOCOL_VERSION, SERVICE_NAME } from "../src/shared/connection.js";

const extensionOrigin = EXTENSION_ORIGIN;
async function connect(bridge: BrowserBridge) {
  const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/extension`, { origin: extensionOrigin });
  await once(ws, "open");
  const ready = once(ws, "message");
  ws.send(JSON.stringify({ type: "hello", version: PROTOCOL_VERSION, service: SERVICE_NAME }));
  assert.deepEqual(JSON.parse((await ready)[0].toString()), { type: "ready", version: PROTOCOL_VERSION, service: SERVICE_NAME });
  return ws;
}

test("local bridge authenticates both extension and MCP clients and routes results", async () => {
  const bridge = new BrowserBridge({ version: 1, port: 0, token: randomBytes(32).toString("hex") });
  await bridge.start();
  try {
    const base = `http://127.0.0.1:${bridge.port}`;
    assert.equal((await fetch(base + "/health")).status, 403);
    assert.equal((await fetch(base + "/health", { headers: { Authorization: `Bearer ${bridge.config.token}`, Origin: "https://evil.example" } })).status, 403);
    const health = await fetch(base + "/health", { headers: { Authorization: `Bearer ${bridge.config.token}` } });
    assert.equal((await health.json() as { connected: boolean }).connected, false);
    const ws = await connect(bridge);
    const message = once(ws, "message");
    const result = bridge.request({ action: "context" });
    const [bytes] = await message;
    const request = JSON.parse(bytes.toString());
    ws.send(JSON.stringify({ type: "result", id: request.id, result: { ok: true, data: { targets: [] } } }));
    assert.deepEqual(await result, { ok: true, data: { targets: [] } });
    const ping = once(ws, "message"); ws.send('{"type":"ping"}');
    assert.deepEqual(JSON.parse((await ping)[0].toString()), { type: "pong" });
    ws.close();
  } finally { await bridge.close(); }
});

test("wrong website or extension origins, Host headers, and hello identities are rejected", async () => {
  const bridge = new BrowserBridge({ version: 1, port: 0, token: randomBytes(32).toString("hex") });
  await bridge.start();
  try {
    for (const options of [{ origin: "https://www.reddit.com" }, { origin: "chrome-extension://" + "a".repeat(32) }, { origin: extensionOrigin, headers: { Host: `evil.example:${bridge.port}` } }]) {
      const evil = new WebSocket(`ws://127.0.0.1:${bridge.port}/extension`, options);
      await once(evil, "error"); assert.equal(bridge.connected, false);
    }
    const wrong = new WebSocket(`ws://127.0.0.1:${bridge.port}/extension`, { origin: extensionOrigin });
    await once(wrong, "open"); const closed = once(wrong, "close");
    wrong.send(JSON.stringify({ type: "hello", version: 1, service: "wrong" }));
    assert.equal((await closed)[0], 1008); assert.equal(bridge.connected, false);
  } finally { await bridge.close(); }
});

test("timeout cancels the request; disconnect never automatically retries a write", async () => {
  const bridge = new BrowserBridge({ version: 1, port: 0, token: randomBytes(32).toString("hex") }, 80);
  await bridge.start();
  try {
    const ws = await connect(bridge);
    const messages: Record<string, unknown>[] = [];
    ws.on("message", data => messages.push(JSON.parse(data.toString())));
    const result = await bridge.request({ action: "execute", tabId: 1, site: "fixture", operation: "write", args: {} });
    assert.equal(result.error?.code, "TIMEOUT");
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(messages.filter(m => m.type === "request").length, 1);
    assert.equal(messages.filter(m => m.type === "cancel").length, 1);
    const pending = bridge.request({ action: "execute", tabId: 1, site: "fixture", operation: "write", args: {} });
    ws.close();
    assert.equal((await pending).error?.code, "BROWSER_DISCONNECTED");
  } finally { await bridge.close(); }
});

test("malformed WebSocket values close only the unauthenticated connection", async () => {
  const bridge = new BrowserBridge({ version: 1, port: 0, token: randomBytes(32).toString("hex") });
  await bridge.start();
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/extension`, { origin: extensionOrigin });
    await once(ws, "open"); const closed = once(ws, "close"); ws.send("null");
    assert.equal((await closed)[0], 1008);
    const valid = await connect(bridge); assert.equal(bridge.connected, true); valid.close();
  } finally { await bridge.close(); }
});

test("a request waits for automatic discovery and is sent exactly once after hello", async () => {
  const bridge = new BrowserBridge({ version: 1, port: 0, token: randomBytes(32).toString("hex") }, 500, 500);
  await bridge.start();
  try {
    let resolved = false;
    const pending = bridge.request({ action: "context" }).then(value => { resolved = true; return value; });
    await new Promise(resolve => setTimeout(resolve, 25)); assert.equal(resolved, false);
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/extension`, { origin: extensionOrigin });
    let requests = 0;
    ws.on("message", data => {
      const message = JSON.parse(data.toString());
      if (message.type === "request") { requests++; ws.send(JSON.stringify({ type: "result", id: message.id, result: { ok: true, data: "connected" } })); }
    });
    await once(ws, "open"); ws.send(JSON.stringify({ type: "hello", service: SERVICE_NAME, version: PROTOCOL_VERSION }));
    assert.deepEqual(await pending, { ok: true, data: "connected" }); assert.equal(requests, 1); ws.close();
  } finally { await bridge.close(); }
});

test("the first request survives maximum reconnect backoff and a full discovery scan", async t => {
  const bridge = new BrowserBridge({ version: 1, port: 0, token: randomBytes(32).toString("hex") });
  await bridge.start();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let resolved = false;
    const pending = bridge.request({ action: "context" }).then(value => { resolved = true; return value; });
    // The browser may already be waiting 15s before scanning ten unresponsive ports.
    t.mock.timers.tick(30_000);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(resolved, false);
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/extension`, { origin: extensionOrigin });
    let requests = 0;
    const dispatched = new Promise<string>(resolve => ws.on("message", data => {
      const message = JSON.parse(data.toString());
      if (message.type === "request") { requests++; resolve(message.id); }
    }));
    await once(ws, "open"); ws.send(JSON.stringify({ type: "hello", service: SERVICE_NAME, version: PROTOCOL_VERSION }));
    const id = await dispatched;
    // Discovery does not consume the operation's separate 120s execution budget.
    t.mock.timers.tick(119_999);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(resolved, false);
    ws.send(JSON.stringify({ type: "result", id, result: { ok: true, data: "reconnected" } }));
    assert.deepEqual(await pending, { ok: true, data: "reconnected" });
    assert.equal(requests, 1); ws.close();
  } finally { t.mock.timers.reset(); await bridge.close(); }
});

test("cancelled discovery never dispatches when the browser connects later", async () => {
  const bridge = new BrowserBridge({ version: 1, port: 0, token: randomBytes(32).toString("hex") });
  await bridge.start();
  try {
    const controller = new AbortController();
    const pending = bridge.request({ action: "execute", tabId: 1, site: "fixture", operation: "write", args: {} }, controller.signal);
    controller.abort();
    assert.equal((await pending).error?.code, "CANCELLED");
    assert.equal((await bridge.request({ action: "context" }, controller.signal)).error?.code, "CANCELLED");
    const ws = await connect(bridge);
    const messages: Record<string, unknown>[] = [];
    ws.on("message", data => messages.push(JSON.parse(data.toString())));
    const pong = once(ws, "message"); ws.send('{"type":"ping"}'); await pong;
    assert.deepEqual(messages, [{ type: "pong" }]); ws.close();
  } finally { await bridge.close(); }
});

test("cancelling an in-flight write cancels only its id and never replays it", async () => {
  const bridge = new BrowserBridge({ version: 1, port: 0, token: randomBytes(32).toString("hex") });
  await bridge.start();
  try {
    const ws = await connect(bridge);
    const cancelledController = new AbortController();
    const completedController = new AbortController();
    const messages: Record<string, unknown>[] = [];
    let bothSent!: () => void;
    const dispatched = new Promise<void>(resolve => { bothSent = resolve; });
    ws.on("message", data => {
      messages.push(JSON.parse(data.toString()));
      if (messages.filter(message => message.type === "request").length === 2) bothSent();
    });
    const cancelled = bridge.request({ action: "execute", tabId: 1, site: "fixture", operation: "write", args: { text: "cancel" } }, cancelledController.signal);
    const completed = bridge.request({ action: "execute", tabId: 1, site: "fixture", operation: "write", args: { text: "keep" } }, completedController.signal);
    await dispatched;
    const firstId = messages[0].id, secondId = messages[1].id;
    const cancellation = once(ws, "message"); cancelledController.abort();
    assert.match((await cancelled).error?.message ?? "", /verify its outcome/);
    assert.deepEqual(JSON.parse((await cancellation)[0].toString()), { type: "cancel", id: firstId });
    // A late response for the cancelled operation cannot resolve another client's request.
    ws.send(JSON.stringify({ type: "result", id: firstId, result: { ok: true, data: "late" } }));
    ws.send(JSON.stringify({ type: "result", id: secondId, result: { ok: true, data: "kept" } }));
    assert.deepEqual(await completed, { ok: true, data: "kept" });
    completedController.abort();
    const pong = once(ws, "message"); ws.send('{"type":"ping"}'); await pong;
    assert.equal(messages.filter(message => message.type === "cancel").length, 1);
    const closed = once(ws, "close"); ws.close(); await closed;
    const reconnected = await connect(bridge);
    const reconnectFrames: Record<string, unknown>[] = [];
    reconnected.on("message", data => reconnectFrames.push(JSON.parse(data.toString())));
    const reconnectedPong = once(reconnected, "message"); reconnected.send('{"type":"ping"}'); await reconnectedPong;
    assert.deepEqual(reconnectFrames, [{ type: "pong" }]); reconnected.close();
  } finally { await bridge.close(); }
});

test("aborting the HTTP MCP request cancels its dispatched browser operation", async () => {
  const bridge = new BrowserBridge({ version: 1, port: 0, token: randomBytes(32).toString("hex") });
  await bridge.start();
  try {
    const ws = await connect(bridge);
    const controller = new AbortController();
    const command = once(ws, "message");
    const pending = bridgeFetch({ ...bridge.config, port: bridge.port }, "/rpc", { action: "execute", tabId: 1, site: "fixture", operation: "write", args: {} }, controller.signal);
    const rejection = assert.rejects(pending, { name: "AbortError" });
    const request = JSON.parse((await command)[0].toString());
    const cancellation = once(ws, "message"); controller.abort();
    await rejection;
    assert.deepEqual(JSON.parse((await cancellation)[0].toString()), { type: "cancel", id: request.id });
    ws.close();
  } finally { await bridge.close(); }
});

test("closing HTTP during discovery removes the wait before a later connection", async t => {
  const bridge = new BrowserBridge({ version: 1, port: 0, token: randomBytes(32).toString("hex") });
  await bridge.start();
  try {
    const originalRequest = bridge.request;
    let started!: () => void;
    const requested = new Promise<void>(resolve => { started = resolve; });
    let finished!: (code: string | undefined) => void;
    const result = new Promise<string | undefined>(resolve => { finished = resolve; });
    t.mock.method(bridge, "request", async function (command: BrowserCommand, signal?: AbortSignal) {
      started();
      const response = await originalRequest.call(bridge, command, signal);
      finished(response.error?.code); return response;
    });
    const controller = new AbortController();
    const pending = bridgeFetch({ ...bridge.config, port: bridge.port }, "/rpc", { action: "context" }, controller.signal);
    const rejection = assert.rejects(pending, { name: "AbortError" });
    await requested; controller.abort(); await rejection;
    assert.equal(await result, "CANCELLED");
    const ws = await connect(bridge);
    const messages: Record<string, unknown>[] = [];
    ws.on("message", data => messages.push(JSON.parse(data.toString())));
    const pong = once(ws, "message"); ws.send('{"type":"ping"}'); await pong;
    assert.deepEqual(messages, [{ type: "pong" }]); ws.close();
  } finally { await bridge.close(); }
});

test("discovery expiry is offline, and closing the bridge releases discovery waits", async () => {
  const bridge = new BrowserBridge({ version: 1, port: 0, token: randomBytes(32).toString("hex") }, 100, 40);
  await bridge.start();
  const started = Date.now();
  assert.equal((await bridge.request({ action: "context" })).error?.code, "BROWSER_OFFLINE");
  assert.ok(Date.now() - started >= 30);
  const pending = bridge.request({ action: "context" });
  await bridge.close(); assert.equal((await pending).error?.code, "BROWSER_OFFLINE");
});

test("legacy native websocket still requires its internal token", async () => {
  const bridge = new BrowserBridge({ version: 1, port: 0, token: randomBytes(32).toString("hex") });
  await bridge.start();
  try {
    const wrong = new WebSocket(`ws://127.0.0.1:${bridge.port}/`, { origin: extensionOrigin });
    await once(wrong, "open"); const closed = once(wrong, "close");
    wrong.send(JSON.stringify({ type: "hello", version: 1, token: "wrong" })); assert.equal((await closed)[0], 1008);
    const valid = new WebSocket(`ws://127.0.0.1:${bridge.port}/`, { origin: extensionOrigin });
    await once(valid, "open"); const ready = once(valid, "message");
    valid.send(JSON.stringify({ type: "hello", version: 1, token: bridge.config.token })); await ready;
    assert.equal(bridge.connected, true); valid.close();
  } finally { await bridge.close(); }
});

test("Chinese text survives UTF-8 split across HTTP request chunks", async () => {
  const bridge = new BrowserBridge({ version: 1, port: 0, token: randomBytes(32).toString("hex") });
  await bridge.start();
  try {
    const ws = await connect(bridge);
    const body = Buffer.from(JSON.stringify({ action: "execute", tabId: 1, site: "fixture", operation: "comment", args: { text: "中文评论不会损坏" } }));
    const split = body.indexOf(Buffer.from("中")) + 1;
    ws.once("message", data => { const command = JSON.parse(data.toString()); ws.send(JSON.stringify({ type: "result", id: command.id, result: { ok: true, data: command.args.text } })); });
    const result = await new Promise<string>((resolve, reject) => {
      const req = httpRequest(`http://127.0.0.1:${bridge.port}/rpc`, { method: "POST", headers: { Authorization: `Bearer ${bridge.config.token}`, "Content-Type": "application/json" } }, res => {
        res.setEncoding("utf8"); let text = ""; res.on("data", chunk => { text += chunk; }); res.on("end", () => resolve(text));
      });
      req.on("error", reject); req.write(body.subarray(0, split)); setTimeout(() => req.end(body.subarray(split)), 10);
    });
    assert.equal(JSON.parse(result).data, "中文评论不会损坏"); ws.close();
  } finally { await bridge.close(); }
});
