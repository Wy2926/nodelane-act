import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { TextDecoder } from "node:util";
import { WebSocket } from "ws";
import type { Config } from "./config.js";

export const DEFAULT_NATIVE_HOST = "com.site_mcp.bridge";
const MAX_FRAME_BYTES = 2 * 1024 * 1024;
// Chrome accepts at most 1 MiB in the host -> extension direction.
const MAX_CHROME_OUTPUT_BYTES = 1024 * 1024;

type JsonObject = Record<string, unknown>;
function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function encodeNativeFrame(message: JsonObject, maxBytes = MAX_FRAME_BYTES): Buffer {
  if (!isObject(message)) throw new Error("Native message must be a JSON object.");
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (!body.length || body.length > maxBytes) throw new Error("Native message exceeds the frame limit.");
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/** Incremental framing; allocates a payload only after checking its length header. */
export class FrameDecoder {
  private header = Buffer.alloc(4);
  private headerSize = 0;
  private payload?: Buffer;
  private payloadSize = 0;
  private failed = false;
  private utf8 = new TextDecoder("utf-8", { fatal: true });

  constructor(readonly maxBytes = MAX_FRAME_BYTES) {
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_FRAME_BYTES) throw new Error("Invalid native frame limit.");
  }

  push(chunk: Uint8Array): JsonObject[] {
    if (this.failed) throw new Error("Native decoder is closed after an invalid frame.");
    const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const messages: JsonObject[] = [];
    let offset = 0;
    try {
      while (offset < bytes.length) {
        if (!this.payload) {
          const length = Math.min(4 - this.headerSize, bytes.length - offset);
          bytes.copy(this.header, this.headerSize, offset, offset + length);
          offset += length;
          this.headerSize += length;
          if (this.headerSize < 4) continue;
          const frameLength = this.header.readUInt32LE(0);
          if (!frameLength || frameLength > this.maxBytes) throw new Error("Invalid native frame length.");
          this.payload = Buffer.allocUnsafe(frameLength);
          this.payloadSize = 0;
        }
        const length = Math.min(this.payload.length - this.payloadSize, bytes.length - offset);
        bytes.copy(this.payload, this.payloadSize, offset, offset + length);
        offset += length;
        this.payloadSize += length;
        if (this.payloadSize === this.payload.length) {
          let value: unknown;
          try { value = JSON.parse(this.utf8.decode(this.payload)); }
          catch { throw new Error("Invalid UTF-8 JSON native message."); }
          if (!isObject(value)) throw new Error("Native message must be a JSON object.");
          messages.push(value);
          this.headerSize = 0;
          this.payload = undefined;
          this.payloadSize = 0;
        }
      }
      return messages;
    } catch (error) { this.failed = true; throw error; }
  }

  end(): void {
    if (this.failed || this.headerSize || this.payload) throw new Error("Native stream ended with an incomplete or invalid frame.");
  }
}

export interface NativeHostRegistration {
  entry: string;
  configFile: string;
  extensionId: string;
  installDir: string;
  hostName?: string;
}

function validHostName(value: string): boolean {
  return /^[a-z][a-z0-9_.]{0,100}$/.test(value) && !value.endsWith(".") && !value.includes("..");
}

/** No CALL or delayed expansion: literal '%' and '!' in user paths stay literal. */
function batchPath(value: string): string {
  if (!path.win32.isAbsolute(value) || /["\r\n\0]/.test(value)) throw new Error("Native host paths must be absolute Windows paths without quotes or newlines.");
  return `"${value.replaceAll("%", "%%")}"`;
}

/** Writes the host files without touching the registry; useful for installer validation. */
export async function prepareNativeHostFiles(options: NativeHostRegistration): Promise<{ manifestPath: string; wrapperPath: string; hostName: string }> {
  if (process.platform !== "win32") throw new Error("Automatic native host registration currently supports Windows.");
  const hostName = options.hostName ?? DEFAULT_NATIVE_HOST;
  if (!validHostName(hostName)) throw new Error("Invalid native host name.");
  if (!/^[a-p]{32}$/.test(options.extensionId)) throw new Error("Invalid Chrome extension ID.");
  const entry = path.resolve(options.entry);
  const configFile = path.resolve(options.configFile);
  const installDir = path.resolve(options.installDir);
  const errorLog = path.join(installDir, `${hostName}.error.log`);
  const command = `${batchPath(process.execPath)} ${batchPath(entry)} native --config ${batchPath(configFile)} %* 2> ${batchPath(errorLog)}`;
  const wrapperPath = path.join(installDir, `${hostName}.cmd`);
  const manifestPath = path.join(installDir, `${hostName}.json`);
  batchPath(wrapperPath);
  // The first lines are ASCII; switch encoding before cmd reads paths containing Unicode.
  const wrapper = `@echo off\r\nchcp 65001 >nul\r\nsetlocal DisableDelayedExpansion\r\necho Native host starting > ${batchPath(errorLog)}\r\n${command}\r\nexit /b %errorlevel%\r\n`;
  const manifest = {
    name: hostName,
    description: "Site MCP local browser bridge",
    path: wrapperPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${options.extensionId}/`],
  };
  await mkdir(installDir, { recursive: true });
  // Several MCP clients may start together. Avoid truncating an unchanged active host.
  for (const [filename, content] of [[wrapperPath, wrapper], [manifestPath, JSON.stringify(manifest, null, 2) + "\n"]]) {
    let unchanged = false;
    try { unchanged = await readFile(filename, "utf8") === content; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (!unchanged) await writeFile(filename, content, { encoding: "utf8", mode: 0o600 });
  }
  return { manifestPath, wrapperPath, hostName };
}

/** Register only HKCU keys; this never requests elevation or starts a visible shell. */
export async function registerNativeHost(options: NativeHostRegistration): Promise<void> {
  const prepared = await prepareNativeHostFiles(options);
  const executable = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "reg.exe");
  for (const browser of ["Google\\Chrome", "Chromium", "Microsoft\\Edge"]) {
    const key = `HKCU\\Software\\${browser}\\NativeMessagingHosts\\${prepared.hostName}`;
    await new Promise<void>((resolve, reject) => {
      execFile(executable, ["ADD", key, "/ve", "/t", "REG_SZ", "/d", prepared.manifestPath, "/f"], { windowsHide: true, encoding: "utf8" }, error => {
        if (error) reject(new Error("Could not register the native host for this Windows user."));
        else resolve();
      });
    });
  }
}

export interface NativeHostStreams { input: Readable; output: Writable }

/** Chrome authenticates allowed_origins; the local bridge secret never crosses stdout. */
export async function runNativeHost(config: Config, origin: string, streams: NativeHostStreams = { input: process.stdin, output: process.stdout }): Promise<void> {
  if (!/^chrome-extension:\/\/[a-p]{32}\/?$/.test(origin)) throw new Error("Native host requires a valid Chrome extension origin.");
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535 || typeof config.token !== "string" || !config.token) throw new Error("Invalid local bridge configuration.");
  const normalizedOrigin = origin.replace(/\/$/, "");
  const socket = new WebSocket(`ws://127.0.0.1:${config.port}`, { origin: normalizedOrigin, maxPayload: MAX_FRAME_BYTES, handshakeTimeout: 5000, perMessageDeflate: false });
  const decoder = new FrameDecoder();
  const { input, output } = streams;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let ready = false;
    const handshakeTimer = setTimeout(() => finish(new Error("Local native bridge handshake timed out.")), 8000);
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(handshakeTimer);
      input.off("data", onInput);
      input.off("end", onEnd);
      input.off("close", onCloseInput);
      input.off("error", onInputError);
      output.off("error", onOutputError);
      output.off("drain", onDrain);
      socket.off("open", onOpen);
      socket.off("message", onMessage);
      socket.off("close", onSocketClose);
      socket.off("error", onSocketError);
      // terminate() while connecting may emit one final error; it must not be unhandled.
      socket.on("error", () => {});
      // Chrome may close both pipes together; a queued stdout write can then report EPIPE.
      output.on("error", () => {});
      input.pause();
      socket.terminate();
      if (error) reject(error); else resolve();
    };
    const write = (message: JsonObject): void => {
      const frame = encodeNativeFrame(message, MAX_CHROME_OUTPUT_BYTES);
      if (output.writableLength > MAX_FRAME_BYTES) throw new Error("Native output consumer is too slow.");
      if (!output.write(frame)) socket.pause();
    };
    const onDrain = (): void => { if (!settled) socket.resume(); };
    const onOpen = (): void => { socket.send(JSON.stringify({ type: "hello", token: config.token, version: 1 })); };
    const onMessage = (bytes: Buffer): void => {
      if (settled) return;
      try {
        const message: unknown = JSON.parse(bytes.toString("utf8"));
        if (!isObject(message)) throw new Error("Invalid local bridge message.");
        if (message.type === "ready" && !ready) { ready = true; clearTimeout(handshakeTimer); write({ type: "ready" }); return; }
        if (message.type === "error") throw new Error("Local bridge rejected the native connection.");
        if (!ready) throw new Error("Local bridge sent a request before authentication.");
        if (message.type === "pong") { write({ type: "pong" }); return; }
        if (typeof message.id !== "string" || !message.id || message.id.length > 200) throw new Error("Invalid local bridge request ID.");
        if (message.type === "cancel") { write({ type: "cancel", id: message.id }); return; }
        if (message.type !== "request" || !["context", "execute"].includes(String(message.action))) throw new Error("Invalid local bridge request.");
        const outgoing: JsonObject = { type: "request", id: message.id, action: message.action };
        for (const key of ["tabId", "expectedUrl", "site", "operation", "args", "openIfMissing", "url"]) if (Object.hasOwn(message, key)) outgoing[key] = message[key];
        write(outgoing);
      } catch { finish(new Error("Invalid or oversized local bridge message.")); }
    };
    const onInput = (chunk: Buffer): void => {
      try {
        for (const message of decoder.push(chunk)) {
          if (message.type === "ping") { if (ready) socket.send('{"type":"ping"}'); continue; }
          if (!ready || socket.readyState !== WebSocket.OPEN) throw new Error("Native bridge is not ready.");
          if (message.type !== "result" || typeof message.id !== "string" || !message.id || message.id.length > 200 || !isObject(message.result) || typeof message.result.ok !== "boolean") throw new Error("Invalid extension result message.");
          if (socket.bufferedAmount > MAX_FRAME_BYTES) throw new Error("Local bridge consumer is too slow.");
          socket.send(JSON.stringify({ type: "result", id: message.id, result: message.result }));
        }
      } catch { finish(new Error("Invalid native input frame or extension message.")); }
    };
    const onEnd = (): void => {
      try { decoder.end(); finish(); }
      catch { finish(new Error("Native input ended in an incomplete frame.")); }
    };
    const onCloseInput = (): void => { if (!settled) onEnd(); };
    const onInputError = (): void => finish(new Error("Native input stream failed."));
    const onOutputError = (): void => finish(new Error("Native output stream failed."));
    const onSocketError = (): void => finish(new Error("Could not connect to the local native bridge."));
    const onSocketClose = (): void => finish(new Error("Local native bridge disconnected. Check any running write before retrying."));
    socket.on("open", onOpen);
    socket.on("message", onMessage);
    socket.on("close", onSocketClose);
    socket.on("error", onSocketError);
    input.on("data", onInput);
    input.on("end", onEnd);
    input.on("close", onCloseInput);
    input.on("error", onInputError);
    output.on("error", onOutputError);
    output.on("drain", onDrain);
    if (input.readableEnded || input.destroyed) onEnd();
  });
}
