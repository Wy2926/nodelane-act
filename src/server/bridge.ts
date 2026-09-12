import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { BridgeRequest, OperationResult } from "../shared/contracts.js";
import { readConfig, withFileLock, writeConfig, type Config } from "./config.js";
import { DISCOVERY_PORTS, EXTENSION_ORIGIN, PROTOCOL_VERSION, SERVICE_NAME } from "../shared/connection.js";

export type BrowserCommand = Omit<BridgeRequest, "type" | "id">;
const failure = (code: string, message: string): OperationResult => ({ ok: false, error: { code, message } });
function sameSecret(a: string, b: string) { const aa = Buffer.from(a), bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); }

export class BrowserBridge {
  private socket?: WebSocket;
  private closed = false;
  private connectionWaiters = new Set<(connected: boolean) => void>();
  private pending = new Map<string, { resolve: (value: OperationResult) => void; timer: NodeJS.Timeout }>();
  private http = createServer((req, res) => { void this.handleHttp(req, res); });
  private wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  // Cover the extension's 15s maximum retry delay plus ten 1.5s discovery attempts.
  constructor(readonly config: Config, readonly timeoutMs = 120_000, readonly connectionWaitMs = 35_000) {
    this.http.on("upgrade", (req, socket, head) => {
      if (!["/extension", "/"].includes(req.url ?? "") || req.headers.host !== `127.0.0.1:${this.port}` || req.headers.origin !== EXTENSION_ORIGIN) { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
      this.wss.handleUpgrade(req, socket, head, ws => this.accept(ws, req.url === "/extension"));
    });
  }
  get connected() { return this.socket?.readyState === WebSocket.OPEN; }
  get port() { const address = this.http.address(); return address && typeof address !== "string" ? address.port : this.config.port; }
  async start() {
    await new Promise<void>((resolve, reject) => { this.http.once("error", reject); this.http.listen(this.config.port, "127.0.0.1", () => { this.http.off("error", reject); resolve(); }); });
  }
  private accept(ws: WebSocket, discovery: boolean) {
    let authenticated = false;
    const timer = setTimeout(() => ws.close(1008, "Handshake required"), 5_000);
    ws.on("error", () => { /* close event releases in-flight work */ });
    ws.on("message", bytes => {
      let message: Record<string, unknown>;
      try { message = JSON.parse(bytes.toString()); } catch { ws.close(1008, "Invalid JSON"); return; }
      if (!message || typeof message !== "object" || Array.isArray(message)) { ws.close(1008, "Invalid message"); return; }
      if (!authenticated) {
        const identityValid = discovery ? message.service === SERVICE_NAME : typeof message.token === "string" && sameSecret(message.token, this.config.token);
        if (message.type !== "hello" || message.version !== PROTOCOL_VERSION || !identityValid) { ws.close(1008, "Handshake failed"); return; }
        if (this.connected) { ws.close(1008, "Another browser is already connected"); return; }
        authenticated = true; clearTimeout(timer); this.socket = ws;
        ws.send(JSON.stringify({ type: "ready", service: SERVICE_NAME, version: PROTOCOL_VERSION }));
        for (const resolve of this.connectionWaiters) resolve(true);
        this.connectionWaiters.clear(); return;
      }
      if (message.type === "ping") { ws.send(JSON.stringify({ type: "pong" })); return; }
      if (message.type !== "result" || typeof message.id !== "string") return;
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      const result = message.result as OperationResult;
      clearTimeout(waiting.timer); this.pending.delete(message.id);
      if (!result || typeof result.ok !== "boolean") waiting.resolve(failure("BAD_RESPONSE", "The extension returned an invalid result."));
      else waiting.resolve(result);
    });
    ws.on("close", () => {
      clearTimeout(timer);
      if (this.socket === ws) { this.socket = undefined; this.rejectPending("BROWSER_DISCONNECTED", "Browser disconnected. A running write may have completed; inspect the website before retrying."); }
    });
  }
  private async waitForConnection(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false;
    if (this.connected) return true;
    if (this.closed || this.connectionWaitMs <= 0) return false;
    return new Promise(resolve => {
      const done = (connected: boolean) => {
        clearTimeout(timer); this.connectionWaiters.delete(done);
        signal?.removeEventListener("abort", abort); resolve(connected);
      };
      const abort = () => done(false);
      const timer = setTimeout(() => done(false), this.connectionWaitMs);
      this.connectionWaiters.add(done);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  async request(command: BrowserCommand, signal?: AbortSignal): Promise<OperationResult> {
    const connected = await this.waitForConnection(signal);
    if (signal?.aborted) return failure("CANCELLED", "Browser operation was cancelled before execution.");
    if (!connected || !this.connected) return failure("BROWSER_OFFLINE", `The browser extension did not connect within ${this.connectionWaitMs / 1_000} seconds. Ensure the Site MCP extension is enabled in a running browser; it connects automatically.`);
    if (this.pending.size >= 30) return failure("BUSY", "Too many pending browser operations.");
    const id = randomUUID();
    return new Promise(resolve => {
      const complete = (result: OperationResult) => {
        clearTimeout(timer); this.pending.delete(id);
        signal?.removeEventListener("abort", abort); resolve(result);
      };
      const abort = () => {
        if (!this.pending.has(id)) return;
        if (this.connected) this.socket!.send(JSON.stringify({ type: "cancel", id }));
        complete(failure("CANCELLED", "Browser operation was cancelled. If execution had started, verify its outcome on the website before retrying a write."));
      };
      const timer = setTimeout(() => {
        if (this.connected) this.socket!.send(JSON.stringify({ type: "cancel", id }));
        complete(failure("TIMEOUT", "Browser operation timed out and was cancelled. If execution had started, verify its outcome on the website before retrying a write."));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: complete, timer });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      this.socket!.send(JSON.stringify({ ...command, type: "request", id }), error => {
        if (!error) return;
        const waiting = this.pending.get(id); if (!waiting) return;
        clearTimeout(waiting.timer); this.pending.delete(id);
        waiting.resolve(failure("BROWSER_DISCONNECTED", "Browser connection failed. A running write may have completed; inspect the website before retrying."));
      });
    });
  }
  private rejectPending(code: string, message: string) {
    for (const [id, item] of this.pending) { clearTimeout(item.timer); item.resolve(failure(code, message)); this.pending.delete(id); }
  }
  private async handleHttp(req: IncomingMessage, res: ServerResponse) {
    res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Cache-Control", "no-store");
    const authorization = req.headers.authorization ?? "";
    if (req.headers.origin || !sameSecret(authorization, `Bearer ${this.config.token}`)) { res.writeHead(403); res.end('{"error":"Forbidden"}'); return; }
    if (req.method === "GET" && req.url === "/health") { res.end(JSON.stringify({ service: SERVICE_NAME, version: PROTOCOL_VERSION, transport: "websocket-discovery", connected: this.connected })); return; }
    if (req.method === "POST" && req.url === "/shutdown") { res.end('{"ok":true}'); setImmediate(() => { void this.close(); }); return; }
    if (req.method !== "POST" || req.url !== "/rpc") { res.writeHead(404); res.end('{"error":"Not found"}'); return; }
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.on("close", cancel);
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.length; if (size > 256 * 1024) { res.writeHead(413); res.end('{"error":"Request too large"}'); return; } chunks.push(bytes); }
      const command = JSON.parse(Buffer.concat(chunks).toString("utf8")) as BrowserCommand;
      if (!command || !["context", "execute"].includes(command.action) || command.action === "execute" && (!Number.isInteger(command.tabId) || typeof command.site !== "string" || typeof command.operation !== "string" || !command.args || typeof command.args !== "object" || Array.isArray(command.args))) { res.writeHead(400); res.end('{"error":"Invalid command"}'); return; }
      const result = await this.request(command, controller.signal);
      if (!res.destroyed) res.end(JSON.stringify(result));
    } catch { if (!res.destroyed) { if (!res.headersSent) res.writeHead(400); res.end('{"error":"Invalid request"}'); } }
    finally { res.off("close", cancel); }
  }
  async close() {
    this.closed = true;
    for (const resolve of this.connectionWaiters) resolve(false);
    this.connectionWaiters.clear();
    this.rejectPending("BRIDGE_STOPPED", "Local bridge stopped; inspect any running write before retrying.");
    for (const socket of this.wss.clients) socket.terminate();
    await new Promise<void>(resolve => this.wss.close(() => resolve()));
    this.http.closeAllConnections();
    await new Promise<void>(resolve => this.http.close(() => resolve()));
  }
}

export async function bridgeFetch(config: Config, route: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(route === "/rpc" ? 170_000 : 2_000);
  const response = await fetch(`http://127.0.0.1:${config.port}${route}`, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) throw new Error(`Local bridge returned HTTP ${response.status}.`);
  return response.json();
}

export async function bridgeIsReady(config: Config): Promise<boolean> {
  try {
    const health = await bridgeFetch(config, "/health") as Record<string, unknown>;
    return health?.service === SERVICE_NAME && health.version === PROTOCOL_VERSION && health.transport === "websocket-discovery";
  } catch { return false; }
}

/** The child owns the startup lock so simultaneous MCP clients converge on one bridge. */
export async function startConfiguredBridge(filename: string, discoveryPorts: readonly number[] = DISCOVERY_PORTS): Promise<{ config: Config; bridge?: BrowserBridge }> {
  return withFileLock(`${filename}.bridge.lock`, async () => {
    const config = await readConfig(filename, true);
    if (await bridgeIsReady(config)) return { config };
    // Retire the old authenticated native bridge before moving its persisted port.
    try {
      const health = await bridgeFetch(config, "/health") as Record<string, unknown>;
      if (health?.service === SERVICE_NAME && health.version === PROTOCOL_VERSION) await bridgeFetch(config, "/shutdown", {});
    } catch { /* An occupied port may belong to an unrelated service. */ }
    const ports = [...new Set([...(discoveryPorts.includes(config.port) ? [config.port] : []), ...discoveryPorts])];
    for (const port of ports) {
      const candidate = { ...config, port };
      const bridge = new BrowserBridge(candidate);
      try { await bridge.start(); }
      catch (error) {
        await bridge.close();
        if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") continue;
        throw error;
      }
      try { await writeConfig(filename, candidate); }
      catch (error) { await bridge.close(); throw error; }
      return { config: candidate, bridge };
    }
    throw new Error("All Site MCP discovery ports are in use. Close another Site MCP instance or release ports 17477–17486.");
  });
}
