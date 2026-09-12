import { DISCOVERY_PORTS, EXTENSION_ORIGIN, PROTOCOL_VERSION, SERVICE_NAME } from "../src/shared/connection.js";

export interface BrowserConnection {
  readonly port: number;
  postMessage(message: Record<string, unknown>): void;
  disconnect(): void;
}

interface ConnectionState { connected: boolean; message: string; detail: string }
interface ConnectorOptions {
  onReady(connection: BrowserConnection): void;
  onMessage(message: Record<string, unknown>, connection: BrowserConnection): void;
  onDisconnect(connection: BrowserConnection, reason: string): void;
  onState(state: ConnectionState): void;
  preferredPort?: unknown;
  /** Timing overrides are only used by deterministic tests. */
  handshakeTimeoutMs?: number;
  heartbeatMs?: number;
  retryDelayMs?: number;
}

/** Local transport only. Website execution and request journals remain in the background worker. */
export class BrowserConnector {
  private active?: BrowserConnection;
  private connecting = false;
  private stopped = false;
  private epoch = 0;
  private preferredPort?: number;
  private retry?: ReturnType<typeof setTimeout>;
  private cancelAttempt?: () => void;
  private cancelActive?: (reason: string) => void;
  private retryDelay: number;
  private readonly initialRetry: number;
  private readonly handshakeMs: number;
  private readonly heartbeatMs: number;

  constructor(private readonly options: ConnectorOptions) {
    this.preferredPort = typeof options.preferredPort === "number" && DISCOVERY_PORTS.includes(options.preferredPort) ? options.preferredPort : undefined;
    this.initialRetry = options.retryDelayMs ?? 1000;
    this.retryDelay = this.initialRetry;
    this.handshakeMs = options.handshakeTimeoutMs ?? 1500;
    this.heartbeatMs = options.heartbeatMs ?? 20_000;
  }

  private state(message: string, detail = "", connected = false): void {
    this.options.onState({ connected, message, detail: detail.slice(0, 400) });
  }

  private schedule(): void {
    if (this.stopped || this.retry || this.active) return;
    this.retry = setTimeout(() => { this.retry = undefined; void this.connect(); }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 15_000);
  }

  async connect(): Promise<void> {
    if (this.stopped || this.active || this.connecting) return;
    if (chrome.runtime.getURL("").replace(/\/$/, "") !== EXTENSION_ORIGIN) {
      this.state("扩展标识与本地 MCP 不一致", "请加载发行包中带固定标识的浏览器扩展。");
      return;
    }
    if (this.retry) clearTimeout(this.retry);
    this.retry = undefined;
    this.connecting = true;
    const epoch = this.epoch;
    this.state("正在自动查找本地 MCP");
    try {
      const candidates = [...new Set([...(this.preferredPort === undefined ? [] : [this.preferredPort]), ...DISCOVERY_PORTS])];
      for (const port of candidates) {
        if (this.stopped || this.epoch !== epoch) return;
        if (await this.tryPort(port, epoch)) return;
      }
      if (!this.stopped && this.epoch === epoch) {
        this.state("等待本地 MCP，正在自动重连", "在 Codex 中使用 Site MCP 时会自动启动本地连接。");
        this.schedule();
      }
    } finally {
      if (this.epoch === epoch) this.connecting = false;
    }
  }

  private tryPort(port: number, epoch: number): Promise<boolean> {
    return new Promise((resolve) => {
      let client: WebSocket;
      try { client = new WebSocket(`ws://127.0.0.1:${port}/extension`); }
      catch { resolve(false); return; }
      let accepted = false;
      let finished = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let lastMessageAt = Date.now();
      const connection: BrowserConnection = {
        port,
        postMessage: (message) => {
          if (!accepted || finished || this.active !== connection || client.readyState !== WebSocket.OPEN) throw new Error("Local MCP connection is unavailable.");
          client.send(JSON.stringify(message));
        },
        disconnect: () => finish("本地 MCP 连接已断开"),
      };
      const finish = (reason: string): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        if (heartbeat) clearInterval(heartbeat);
        client.onopen = client.onmessage = client.onclose = client.onerror = null;
        try { client.close(); } catch { /* Already closed. */ }
        if (this.epoch === epoch) this.cancelAttempt = undefined;
        if (accepted) {
          if (this.active === connection) {
            this.active = undefined;
            this.cancelActive = undefined;
            this.options.onDisconnect(connection, reason);
            this.state("连接已断开，正在自动重连", reason);
            this.schedule();
          }
        } else resolve(false);
      };
      const timeout = setTimeout(() => finish("本地服务握手超时"), this.handshakeMs);
      this.cancelAttempt = () => finish("连接查找已取消");
      client.onopen = () => {
        if (finished || this.stopped || this.epoch !== epoch) { finish("连接查找已取消"); return; }
        try { client.send(JSON.stringify({ type: "hello", service: SERVICE_NAME, version: PROTOCOL_VERSION })); }
        catch { finish("本地服务握手失败"); }
      };
      client.onmessage = (event) => {
        if (finished || this.stopped || this.epoch !== epoch) return;
        if (typeof event.data !== "string" || event.data.length > 2 * 1024 * 1024) { finish("本地服务返回了无效消息"); return; }
        let message: Record<string, unknown>;
        try {
          const value: unknown = JSON.parse(event.data);
          if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid message");
          message = value as Record<string, unknown>;
        } catch { finish("本地服务返回了无效消息"); return; }
        if (!accepted) {
          if (message.type !== "ready" || message.service !== SERVICE_NAME || message.version !== PROTOCOL_VERSION) {
            finish("该端口不是兼容的 Site MCP 服务");
            return;
          }
          clearTimeout(timeout);
          this.cancelAttempt = undefined;
          accepted = true;
          this.active = connection;
          this.cancelActive = finish;
          this.preferredPort = port;
          this.retryDelay = this.initialRetry;
          lastMessageAt = Date.now();
          void chrome.storage.local.set({ lastBridgePort: port }).catch(() => {});
          this.options.onReady(connection);
          this.state("已自动连接本地 MCP", "", true);
          heartbeat = setInterval(() => {
            if (Date.now() - lastMessageAt > this.heartbeatMs * 3) { finish("本地 MCP 心跳超时"); return; }
            try { connection.postMessage({ type: "ping" }); }
            catch { finish("本地 MCP 心跳失败"); }
          }, this.heartbeatMs);
          resolve(true);
          return;
        }
        lastMessageAt = Date.now();
        if (message.type === "pong") return;
        if (message.type === "request" || message.type === "cancel") {
          this.options.onMessage(message, connection);
          return;
        }
        if (message.type === "error") { finish("本地 MCP 拒绝了连接"); return; }
        finish("本地 MCP 返回了未知消息");
      };
      client.onerror = () => finish("本地服务暂不可用");
      client.onclose = (event) => finish(event.code === 1008 ? "本地 MCP 拒绝连接，或另一个浏览器已连接" : "本地 MCP 连接已断开");
    });
  }

  stop(reason = "浏览器正在关闭连接"): void {
    this.stopped = true;
    this.epoch++;
    this.connecting = false;
    if (this.retry) clearTimeout(this.retry);
    this.retry = undefined;
    this.cancelAttempt?.();
    this.cancelAttempt = undefined;
    this.cancelActive?.(reason);
    this.cancelActive = undefined;
  }

  reconnect(reason = "正在重新连接本地 MCP"): void {
    this.stop(reason);
    this.stopped = false;
    this.retryDelay = this.initialRetry;
    void this.connect();
  }
}
