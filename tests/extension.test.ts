import assert from "node:assert/strict";
import test from "node:test";
import type { BridgeRequest } from "../src/shared/contracts.js";
import { BrowserConnector, type BrowserConnection } from "../extension/connection.js";
import { DISCOVERY_PORTS, EXTENSION_ORIGIN, PROTOCOL_VERSION, SERVICE_NAME } from "../src/shared/connection.js";

test("extension discovers its local service and preserves target and replay protection", async (t) => {
  type MessageListener = (message: unknown, sender: { id: string; url: string }, respond: (value: any) => void) => boolean | undefined;
  type FakeTab = { id: number; url: string; title: string; windowId: number; status: string; pendingUrl?: string; documentUrl?: string; documentReadyState?: string };
  let listener: MessageListener | undefined;
  let suspended: (() => void) | undefined;
  let alarm: ((value: { name: string }) => void) | undefined;
  const tab: FakeTab = { id: 7, url: "https://www.reddit.com/r/test/", title: "Test community", windowId: 1, status: "complete" };
  const tabs: FakeTab[] = [tab, { id: 8, url: "https://example.com/private", title: "Unrelated private tab", windowId: 1, status: "complete" }];
  const created: Array<{ url: string; active: boolean }> = [];
  const updatedListeners = new Set<(id: number, change: { status: string }) => void>();
  const removedListeners = new Set<(id: number) => void>();
  let authorized = true;
  let probeUrlOverride: string | undefined;
  let probeGate: Promise<void> | undefined;
  let probes = 0;
  let releaseProbe: (() => void) | undefined;
  let createdState: Partial<FakeTab> | undefined;
  let manualLoad = false;
  let mainError: Error | undefined;
  let mainResult: unknown = { ok: true, data: { executed: true } };
  let documentId = "fixed-document-id";
  let documentAfterInjection: string | undefined;
  const injected: Array<{ target: { tabId: number; documentIds?: string[] }; args?: unknown[] }> = [];
  const stored: Record<string, unknown> = { recentWriteIds: [["previous-session-write", Date.now()]], lastBridgePort: DISCOVERY_PORTS[2] };
  const requestedStorage: string[][] = [];
  let trustedStorage = false;
  class FakeWebSocket {
    static OPEN = 1;
    static instances: FakeWebSocket[] = [];
    sent: Array<Record<string, any>> = [];
    readyState = 0;
    closed = false;
    onopen?: (() => void) | null;
    onmessage?: ((event: { data: string }) => void) | null;
    onclose?: ((event: { code: number }) => void) | null;
    onerror?: (() => void) | null;
    constructor(public url: string) {
      FakeWebSocket.instances.push(this);
      queueMicrotask(() => { this.readyState = 1; this.onopen?.(); });
    }
    send(value: string): void {
      if (this.closed) throw new Error("Port disconnected");
      const message = JSON.parse(value);
      this.sent.push(message);
      if (message.type === "hello") queueMicrotask(() => this.receive({ type: "ready", service: SERVICE_NAME, version: PROTOCOL_VERSION }));
      if (message.type === "ping") queueMicrotask(() => this.receive({ type: "pong" }));
    }
    receive(value: unknown): void { this.onmessage?.({ data: JSON.stringify(value) }); }
    close(): void {
      if (this.closed) return;
      this.closed = true;
      this.readyState = 3;
      this.onclose?.({ code: 1000 });
    }
    disconnect(): void { this.close(); }
  }

  const fakeChrome = {
    storage: { local: {
      setAccessLevel: async ({ accessLevel }: { accessLevel: string }) => { trustedStorage = accessLevel === "TRUSTED_CONTEXTS"; },
      get: async (keys: string[]) => { requestedStorage.push(keys); return { ...stored }; },
      set: async (value: Record<string, unknown>) => { Object.assign(stored, value); },
    } },
    tabs: {
      query: async () => tabs.map((item) => ({ ...item })),
      get: async (id: number) => { const found = tabs.find((item) => item.id === id); if (!found) throw new Error("Unknown tab"); return { ...found }; },
      create: async (options: { url: string; active: boolean }) => {
        created.push(options);
        const newTab: FakeTab = { id: 100 + created.length, url: options.url, title: "Loading", status: "loading", windowId: 1, ...createdState };
        tabs.push(newTab);
        if (!manualLoad) setTimeout(() => {
          newTab.title = "New website page";
          newTab.status = "complete";
          for (const callback of updatedListeners) callback(newTab.id, { status: "complete" });
        }, 5);
        return { ...newTab };
      },
      onUpdated: { addListener: (callback: (id: number, change: { status: string }) => void) => updatedListeners.add(callback), removeListener: (callback: (id: number, change: { status: string }) => void) => updatedListeners.delete(callback) },
      onRemoved: { addListener: (callback: (id: number) => void) => removedListeners.add(callback), removeListener: (callback: (id: number) => void) => removedListeners.delete(callback) },
    },
    permissions: { contains: async () => authorized, onAdded: { addListener: () => {} }, onRemoved: { addListener: () => {} } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    alarms: { create: async () => {}, onAlarm: { addListener: (callback: (value: { name: string }) => void) => { alarm = callback; } } },
    runtime: {
      id: EXTENSION_ORIGIN.split("//")[1],
      getURL: (path: string) => `${EXTENSION_ORIGIN}/${path}`,
      sendMessage: async () => {},
      onMessage: { addListener: (callback: MessageListener) => { listener = callback; } },
      onSuspend: { addListener: (callback: () => void) => { suspended = callback; } },
      onSuspendCanceled: { addListener: () => {} },
    },
    scripting: { executeScript: async (invocation: { target: { tabId: number; documentIds?: string[] }; args?: unknown[]; world: string }) => {
      if (invocation.world === "ISOLATED") {
        probes++;
        await probeGate;
        const selected = tabs.find((item) => item.id === invocation.target.tabId)!;
        return [{ result: { url: probeUrlOverride ?? selected.documentUrl ?? selected.url, readyState: selected.documentReadyState ?? (selected.status === "complete" ? "complete" : "loading") }, documentId }];
      }
      assert.deepEqual(invocation.target.documentIds, ["fixed-document-id"]);
      injected.push(invocation);
      if (documentAfterInjection) documentId = documentAfterInjection;
      if (mainError) throw mainError;
      return [{ result: mainResult }];
    } },
  };
  const previousChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const previousWebSocket = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
  Object.defineProperty(globalThis, "chrome", { value: fakeChrome, configurable: true });
  Object.defineProperty(globalThis, "WebSocket", { value: FakeWebSocket, configurable: true });

  async function popup(message: Record<string, unknown>): Promise<any> {
    return new Promise((resolve) => listener!(message, { id: fakeChrome.runtime.id, url: `${EXTENSION_ORIGIN}/popup.html` }, resolve));
  }
  async function eventually(predicate: () => boolean | Promise<boolean>): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.fail("Condition did not become true");
  }
  function write(id: string, extra: Record<string, unknown> = {}): BridgeRequest {
    return { type: "request", id, action: "execute", site: "reddit", tabId: 7, expectedUrl: tab.url, operation: "vote", args: { id: "t3_abc", direction: 1, ...extra } };
  }
  function read(id: string): BridgeRequest {
    return { type: "request", id, action: "execute", site: "reddit", tabId: 7, expectedUrl: tab.url, operation: "account", args: {} };
  }
  function delayProbe(): number {
    const before = probes;
    probeGate = new Promise((resolve) => { releaseProbe = resolve; });
    return before;
  }
  async function resumeProbe(): Promise<void> {
    releaseProbe?.();
    probeGate = undefined;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  try {
    await import("../extension/background.js");
    await eventually(async () => Boolean((await popup({ type: "state" })).ready));
    const port = FakeWebSocket.instances[0]!;

    await t.test("startup reuses the remembered discovery port without configuration or credentials", async () => {
      assert.equal(port.url, `ws://127.0.0.1:${DISCOVERY_PORTS[2]}/extension`);
      assert.equal(trustedStorage, true);
      assert.deepEqual(requestedStorage, [["recentWriteIds", "lastBridgePort"]]);
      assert.deepEqual(port.sent, [{ type: "hello", service: SERVICE_NAME, version: PROTOCOL_VERSION }]);
      assert.equal(stored.lastBridgePort, DISCOVERY_PORTS[2]);
      const state = await popup({ type: "state" });
      assert.equal(state.config, undefined);
      assert.equal(state.pending, undefined);
      assert.deepEqual(state.active, []);
    });

    await t.test("context returns only authorized registered website tabs", async () => {
      port.receive({ type: "request", id: "context", action: "context" });
      await eventually(() => port.sent.some((message) => message.id === "context"));
      assert.deepEqual(port.sent.find((message) => message.id === "context")!.result.data.targets.map((item: { tabId: number }) => item.tabId), [7]);
      authorized = false;
      port.receive(read("denied-read"));
      await eventually(() => port.sent.some((message) => message.id === "denied-read"));
      assert.equal(port.sent.find((message) => message.id === "denied-read")!.result.ok, false);
      assert.equal(injected.length, 0);
      authorized = true;
    });

    await t.test("reads and writes execute directly while unknown parameters fail validation", async () => {
      port.receive(read("read"));
      await eventually(() => port.sent.some((message) => message.id === "read"));
      assert.equal(injected.length, 1);
      port.receive(write("write-once"));
      await eventually(() => port.sent.some((message) => message.id === "write-once"));
      assert.equal(injected.length, 2);
      assert.ok((stored.recentWriteIds as Array<[string, number]>).some(([id]) => id === "write-once"));
      port.receive(write("invalid", { arbitrary: true }));
      await eventually(() => port.sent.some((message) => message.id === "invalid"));
      assert.equal(port.sent.find((message) => message.id === "invalid")!.result.error.code, "INVALID_ARGUMENTS");
      assert.equal(injected.length, 2);
    });

    await t.test("repeated writes and recovered request IDs never inject again", async () => {
      port.receive(write("write-once"));
      port.receive(write("previous-session-write"));
      await eventually(() => port.sent.some((message) => message.id === "previous-session-write"));
      assert.equal(port.sent.find((message) => message.id === "previous-session-write")!.result.error.code, "ALREADY_PROCESSED");
      assert.equal(injected.length, 2);
    });

    await t.test("stale target URLs and navigation during document detection block execution", async () => {
      const stale = read("stale-url");
      tab.url = "https://www.reddit.com/r/other/";
      port.receive(stale);
      await eventually(() => port.sent.some((message) => message.id === "stale-url"));
      assert.equal(port.sent.find((message) => message.id === "stale-url")!.result.error.code, "TARGET_CHANGED");
      probeUrlOverride = "https://www.reddit.com/r/navigated/";
      port.receive(read("navigation-race"));
      await eventually(() => port.sent.some((message) => message.id === "navigation-race"));
      assert.equal(port.sent.find((message) => message.id === "navigation-race")!.result.error.code, "TARGET_CHANGED");
      assert.equal(injected.length, 2);
      probeUrlOverride = undefined;
    });

    await t.test("cancellation before injection prevents the write and suppresses its late response", async () => {
      const before = delayProbe();
      port.receive(write("cancel-me"));
      await eventually(() => probes > before);
      port.receive({ type: "cancel", id: "cancel-me" });
      assert.equal((await popup({ type: "state" })).active.length, 0);
      await resumeProbe();
      assert.equal(injected.length, 2);
      assert.equal(port.sent.some((message) => message.id === "cancel-me"), false);
      const ignored = listener!({ type: "reconnect" }, { id: fakeChrome.runtime.id, url: tab.url }, () => assert.fail("A website must not control the extension"));
      assert.equal(ignored, undefined);
    });

    await t.test("context opens missing website pages and reuses exact URLs without navigating existing tabs", async () => {
      port.receive({ type: "request", id: "open-zhihu", action: "context", site: "zhihu", openIfMissing: true });
      await eventually(() => port.sent.some((message) => message.id === "open-zhihu"));
      const opened = port.sent.find((message) => message.id === "open-zhihu")!.result.data.targets;
      assert.equal(opened.length, 1);
      assert.equal(opened[0].site, "zhihu");
      assert.equal(opened[0].title, "New website page");
      assert.equal(created.length, 1);
      const url = "https://www.reddit.com/r/newcommunity/";
      port.receive({ type: "request", id: "open-path", action: "context", site: "reddit", url, openIfMissing: true });
      await eventually(() => port.sent.some((message) => message.id === "open-path"));
      assert.equal(created.length, 2);
      assert.equal(tab.url, "https://www.reddit.com/r/other/");
      port.receive({ type: "request", id: "reuse-path", action: "context", site: "reddit", url, openIfMissing: true });
      await eventually(() => port.sent.some((message) => message.id === "reuse-path"));
      assert.equal(created.length, 2);
      port.receive({ type: "request", id: "no-open", action: "context", site: "reddit", url: "https://www.reddit.com/r/missing/", openIfMissing: false });
      await eventually(() => port.sent.some((message) => message.id === "no-open"));
      assert.deepEqual(port.sent.find((message) => message.id === "no-open")!.result.data.targets, []);
      port.receive({ type: "request", id: "wrong-site", action: "context", site: "reddit", url: "https://example.com/", openIfMissing: true });
      await eventually(() => port.sent.some((message) => message.id === "wrong-site"));
      assert.equal(port.sent.find((message) => message.id === "wrong-site")!.result.ok, false);
      assert.equal(created.length, 2);
      assert.equal(updatedListeners.size, 0);
      assert.equal(removedListeners.size, 0);
    });

    await t.test("new tabs wait past stale complete events for the requested loaded document", async () => {
      const url = "https://www.zhihu.com/topic/123/hot";
      manualLoad = true;
      createdState = { url: "about:blank", pendingUrl: url, status: "complete" };
      const before = created.length;
      const result = () => port.sent.find(message => message.id === "new-document-race");
      port.receive({ type: "request", id: "new-document-race", action: "context", site: "zhihu", url, openIfMissing: true });
      await eventually(() => created.length === before + 1 && updatedListeners.size > 0);
      const loadingTab = tabs.at(-1)!;
      const update = async () => {
        for (const callback of updatedListeners) callback(loadingTab.id, { status: "complete" });
        await new Promise(resolve => setTimeout(resolve, 10));
      };
      try {
        await update(); assert.equal(result(), undefined, "The initial blank page's complete event is not the destination");
        loadingTab.url = url;
        await update(); assert.equal(result(), undefined, "A pending navigation must finish even if the reported URL matches");
        delete loadingTab.pendingUrl; loadingTab.status = "loading";
        await update(); assert.equal(result(), undefined, "A stale complete event cannot override the current loading status");
        loadingTab.status = "complete"; loadingTab.documentUrl = "about:blank";
        await update(); assert.equal(result(), undefined, "The actual injected document must match the requested URL");
        loadingTab.documentUrl = url; loadingTab.documentReadyState = "interactive";
        await update(); assert.equal(result(), undefined, "The actual document must finish loading");
        loadingTab.documentReadyState = "complete"; loadingTab.title = "Loaded topic";
        await update(); await eventually(() => Boolean(result()));
        assert.equal(result()!.result.data.targets[0].title, "Loaded topic");
        assert.equal(updatedListeners.size, 0); assert.equal(removedListeners.size, 0);
      } finally { manualLoad = false; createdState = undefined; }
    });

    await t.test("cancelling a new-page wait removes listeners and suppresses late completion", async () => {
      manualLoad = true;
      const before = created.length;
      port.receive({ type: "request", id: "cancel-tab-load", action: "context", site: "zhihu", url: "https://www.zhihu.com/topic/456/hot", openIfMissing: true });
      await eventually(() => created.length === before + 1 && updatedListeners.size > 0);
      port.receive({ type: "cancel", id: "cancel-tab-load" });
      await eventually(() => updatedListeners.size === 0);
      tabs.at(-1)!.status = "complete";
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(port.sent.some(message => message.id === "cancel-tab-load"), false);
      assert.equal(removedListeners.size, 0); manualLoad = false;
    });

    await t.test("a completed same-site redirect reports the changed target without waiting for timeout", async () => {
      createdState = { url: "https://www.zhihu.com/signin?next=%2Ftopic%2F789%2Fhot", status: "complete" };
      try {
        port.receive({ type: "request", id: "redirected-new-tab", action: "context", site: "zhihu", url: "https://www.zhihu.com/topic/789/hot", openIfMissing: true });
        await eventually(() => port.sent.some(message => message.id === "redirected-new-tab"));
        assert.equal(port.sent.find(message => message.id === "redirected-new-tab")!.result.error.code, "TARGET_CHANGED");
        assert.equal(updatedListeners.size, 0); assert.equal(removedListeners.size, 0);
      } finally { createdState = undefined; }
    });

    await t.test("disconnect cancels pending execution and reconnects automatically on wake", async () => {
      const before = delayProbe();
      port.receive(write("disconnect-pending"));
      await eventually(() => probes > before);
      port.disconnect();
      assert.equal((await popup({ type: "state" })).active.length, 0);
      assert.equal((await popup({ type: "state" })).ready, false);
      alarm!({ name: "site-mcp-reconnect" });
      await eventually(async () => (await popup({ type: "state" })).ready);
      await resumeProbe();
      assert.equal(FakeWebSocket.instances.length, 2);
      assert.equal(injected.length, 2);
      const replacement = FakeWebSocket.instances[1]!;
      replacement.receive(write("write-once"));
      await eventually(() => replacement.sent.some((message) => message.id === "write-once"));
      assert.equal(replacement.sent.find((message) => message.id === "write-once")!.result.error.code, "ALREADY_PROCESSED");
      assert.equal(injected.length, 2);
    });

    await t.test("lost documents are target changes and failed writes are never reinjected", async () => {
      const replacement = FakeWebSocket.instances.at(-1)!;
      const before = injected.length;
      mainError = new Error("No document with id fixed-document-id in tab 7.");
      replacement.receive(write("lost-write-document"));
      await eventually(() => replacement.sent.some(message => message.id === "lost-write-document"));
      assert.equal(replacement.sent.find(message => message.id === "lost-write-document")!.result.error.code, "TARGET_CHANGED");
      assert.equal(injected.length, before + 1);
      mainError = undefined;
      replacement.receive(write("lost-write-document"));
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(injected.length, before + 1);

      mainResult = null; documentAfterInjection = "replacement-document-id";
      replacement.receive(read("null-from-old-document"));
      await eventually(() => replacement.sent.some(message => message.id === "null-from-old-document"));
      assert.equal(replacement.sent.find(message => message.id === "null-from-old-document")!.result.error.code, "TARGET_CHANGED");
      documentId = "fixed-document-id"; documentAfterInjection = undefined;
      replacement.receive(read("invalid-on-current-document"));
      await eventually(() => replacement.sent.some(message => message.id === "invalid-on-current-document"));
      assert.equal(replacement.sent.find(message => message.id === "invalid-on-current-document")!.result.error.code, "INVALID_SITE_RESPONSE");
      mainResult = { ok: true, data: { executed: true } };
    });

  } finally {
    releaseProbe?.();
    suspended?.();
    await new Promise((resolve) => setImmediate(resolve));
    if (previousChrome) Object.defineProperty(globalThis, "chrome", previousChrome);
    else Reflect.deleteProperty(globalThis, "chrome");
    if (previousWebSocket) Object.defineProperty(globalThis, "WebSocket", previousWebSocket);
    else Reflect.deleteProperty(globalThis, "WebSocket");
  }
});

test("local connector validates identity, discovers ports, times out and recovers without replay", async (t) => {
  type Mode = "ready" | "wrong-service" | "wrong-version" | "premature-request" | "timeout" | "offline";
  let origin = EXTENSION_ORIGIN;
  let respondToPing = true;
  const modes = new Map<number, Mode>();
  const saved: Record<string, unknown> = {};
  const connectors: BrowserConnector[] = [];
  class Socket {
    static OPEN = 1;
    static instances: Socket[] = [];
    readyState = 0;
    sent: Record<string, unknown>[] = [];
    onopen?: (() => void) | null;
    onmessage?: ((event: { data: string }) => void) | null;
    onerror?: (() => void) | null;
    onclose?: ((event: { code: number }) => void) | null;
    readonly port: number;
    constructor(readonly url: string) {
      this.port = Number(new URL(url).port);
      Socket.instances.push(this);
      queueMicrotask(() => {
        if (modes.get(this.port) === "offline" || !modes.has(this.port)) { this.onerror?.(); return; }
        this.readyState = 1;
        this.onopen?.();
      });
    }
    send(value: string): void {
      const message: Record<string, unknown> = JSON.parse(value);
      this.sent.push(message);
      if (message.type === "ping") {
        if (respondToPing) queueMicrotask(() => this.receive({ type: "pong" }));
        return;
      }
      if (message.type !== "hello") return;
      const mode = modes.get(this.port);
      if (mode === "timeout") return;
      if (mode === "premature-request") {
        queueMicrotask(() => this.receive({ type: "request", id: "unverified-write", action: "execute", operation: "delete" }));
        return;
      }
      queueMicrotask(() => this.receive({ type: "ready", service: mode === "wrong-service" ? "other-service" : SERVICE_NAME, version: mode === "wrong-version" ? PROTOCOL_VERSION + 1 : PROTOCOL_VERSION }));
    }
    receive(value: unknown): void { this.onmessage?.({ data: JSON.stringify(value) }); }
    close(): void { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code: 1000 }); }
  }
  const previousChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const previousSocket = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
  Object.defineProperty(globalThis, "chrome", { value: { runtime: { getURL: (path: string) => `${origin}/${path}` }, storage: { local: { set: async (value: Record<string, unknown>) => { Object.assign(saved, value); } } } }, configurable: true });
  Object.defineProperty(globalThis, "WebSocket", { value: Socket, configurable: true });
  function create(options: { preferredPort?: unknown; heartbeatMs?: number; retryDelayMs?: number } = {}) {
    const received: Record<string, unknown>[] = [];
    const connected: BrowserConnection[] = [];
    const disconnected: string[] = [];
    const states: Array<{ connected: boolean; message: string; detail: string }> = [];
    const connector = new BrowserConnector({ ...options, handshakeTimeoutMs: 10, retryDelayMs: options.retryDelayMs ?? 5000, heartbeatMs: options.heartbeatMs ?? 1000,
      onReady: (connection) => connected.push(connection), onMessage: (message) => received.push(message), onDisconnect: (_connection, reason) => disconnected.push(reason), onState: (state) => states.push(state) });
    connectors.push(connector);
    return { connector, received, connected, disconnected, states };
  }
  async function eventually(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.fail("Connection condition did not become true");
  }
  try {
    await t.test("an unexpected extension origin never initiates discovery", async () => {
      origin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const test = create();
      await test.connector.connect();
      assert.equal(Socket.instances.length, 0);
      assert.match(test.states.at(-1)!.message, /标识/);
      test.connector.stop();
      origin = EXTENSION_ORIGIN;
    });
    await t.test("service, version, early commands and handshake timeout are rejected before the next candidate", async () => {
      modes.set(DISCOVERY_PORTS[0], "wrong-service");
      modes.set(DISCOVERY_PORTS[1], "wrong-version");
      modes.set(DISCOVERY_PORTS[2], "premature-request");
      modes.set(DISCOVERY_PORTS[3], "timeout");
      modes.set(DISCOVERY_PORTS[4], "ready");
      const test = create({ preferredPort: 65500 });
      await test.connector.connect();
      assert.deepEqual(Socket.instances.map((socket) => socket.port), DISCOVERY_PORTS.slice(0, 5));
      assert.equal(test.connected.length, 1);
      assert.equal(test.connected[0].port, DISCOVERY_PORTS[4]);
      assert.deepEqual(test.received, [], "No command from an unverified service reaches execution");
      assert.equal(saved.lastBridgePort, DISCOVERY_PORTS[4]);
      for (const socket of Socket.instances) assert.deepEqual(socket.sent[0], { type: "hello", service: SERVICE_NAME, version: PROTOCOL_VERSION });
      for (const socket of Socket.instances.slice(0, 4)) assert.equal(socket.readyState, 3);
      test.connector.stop();
      modes.clear();
    });
    await t.test("automatic retries find a service started after the browser", async () => {
      const test = create({ retryDelayMs: 5 });
      const before = Socket.instances.length;
      await test.connector.connect();
      assert.equal(test.connected.length, 0);
      assert.equal(Socket.instances.length - before, DISCOVERY_PORTS.length);
      modes.set(DISCOVERY_PORTS[1], "ready");
      await eventually(() => test.connected.length === 1);
      assert.equal(test.connected[0].port, DISCOVERY_PORTS[1]);
      test.connector.stop();
      modes.clear();
    });
    await t.test("heartbeats preserve a live connection and detect missing pong responses", async () => {
      modes.set(DISCOVERY_PORTS[0], "ready");
      const test = create({ heartbeatMs: 10 });
      await test.connector.connect();
      const socket = Socket.instances.at(-1)!;
      await eventually(() => socket.sent.some((message) => message.type === "ping"));
      assert.equal(test.disconnected.length, 0);
      respondToPing = false;
      await eventually(() => test.disconnected.length === 1);
      assert.match(test.disconnected[0], /心跳超时/);
      assert.equal(socket.readyState, 3);
      assert.equal(socket.sent.some((message) => message.type === "result"), false);
      test.connector.stop();
      respondToPing = true;
      modes.clear();
    });
    await t.test("reconnection uses the last good port and never resends previous messages", async () => {
      modes.set(DISCOVERY_PORTS[2], "ready");
      const test = create({ preferredPort: DISCOVERY_PORTS[2] });
      await test.connector.connect();
      const first = Socket.instances.at(-1)!;
      test.connected[0].postMessage({ type: "result", id: "completed-write", result: { ok: true } });
      first.close();
      await test.connector.connect();
      const second = Socket.instances.at(-1)!;
      assert.notEqual(first, second);
      assert.equal(second.port, first.port);
      assert.deepEqual(second.sent, [{ type: "hello", service: SERVICE_NAME, version: PROTOCOL_VERSION }]);
      assert.equal(test.connected.length, 2);
      test.connector.stop();
    });
  } finally {
    for (const connector of connectors) connector.stop();
    await new Promise((resolve) => setImmediate(resolve));
    if (previousChrome) Object.defineProperty(globalThis, "chrome", previousChrome); else Reflect.deleteProperty(globalThis, "chrome");
    if (previousSocket) Object.defineProperty(globalThis, "WebSocket", previousSocket); else Reflect.deleteProperty(globalThis, "WebSocket");
  }
});
