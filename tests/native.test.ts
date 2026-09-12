import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { WebSocketServer } from "ws";
import { encodeNativeFrame, FrameDecoder, prepareNativeHostFiles, runNativeHost } from "../src/server/native.js";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const origin = `chrome-extension://${extensionId}/`;
function rawFrame(value: string | Buffer): Buffer {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(body.length);
  return Buffer.concat([prefix, body]);
}

test("native frames count UTF-8 bytes and survive one-byte header/body chunks", () => {
  const message = { type: "result", id: "一", result: { ok: true, data: "中文💬 café" } };
  const frame = encodeNativeFrame(message);
  assert.equal(frame.readUInt32LE(0), Buffer.byteLength(JSON.stringify(message)));
  assert.notEqual(frame.readUInt32LE(0), JSON.stringify(message).length);
  const decoder = new FrameDecoder();
  const messages: object[] = [];
  for (const byte of frame) messages.push(...decoder.push(Buffer.of(byte)));
  decoder.end();
  assert.deepEqual(messages, [message]);
});

test("decoder handles multiple frames and partial trailing frames in a mock stream", async () => {
  const input = new PassThrough();
  const decoder = new FrameDecoder();
  const messages: object[] = [];
  input.on("data", chunk => messages.push(...decoder.push(chunk)));
  const a = { type: "ready" }, b = { type: "request", id: "two", args: { text: "你好" } };
  const frames = Buffer.concat([encodeNativeFrame(a), encodeNativeFrame(b)]);
  const ended = once(input, "end");
  input.write(frames.subarray(0, 3));
  input.write(frames.subarray(3, frames.length - 1));
  assert.deepEqual(messages, [a]);
  input.end(frames.subarray(frames.length - 1));
  await ended;
  decoder.end();
  assert.deepEqual(messages, [a, b]);
});

test("decoder rejects over-limit/zero lengths before allocating a body", () => {
  const over = Buffer.alloc(4); over.writeUInt32LE(2 * 1024 * 1024 + 1);
  assert.throws(() => new FrameDecoder().push(over), /length/);
  assert.throws(() => new FrameDecoder().push(Buffer.alloc(4)), /length/);
  assert.throws(() => new FrameDecoder(8).push(rawFrame('{"long":true}')), /length/);
  assert.throws(() => encodeNativeFrame({ text: "x".repeat(30) }, 10), /limit/);
});

test("decoder rejects null, arrays, scalars, invalid UTF-8 and malformed JSON", () => {
  for (const input of ["null", "[]", '"text"', "3", "true", "{bad}"]) {
    const decoder = new FrameDecoder();
    assert.throws(() => decoder.push(rawFrame(input)), /JSON/);
    assert.throws(() => decoder.push(encodeNativeFrame({ ok: true })), /closed/);
  }
  assert.throws(() => new FrameDecoder().push(rawFrame(Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]))), /UTF-8/);
  assert.throws(() => encodeNativeFrame(null as never), /JSON object/);
});

test("decoder reports incomplete header or body on EOF", () => {
  const header = new FrameDecoder(); header.push(Buffer.of(1, 0));
  assert.throws(() => header.end(), /incomplete/);
  const body = new FrameDecoder(); body.push(rawFrame('{"ok":true}').subarray(0, 7));
  assert.throws(() => body.end(), /incomplete/);
});

test("native relay authenticates internally and exchanges only framed protocol output", async t => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  t.after(async () => { for (const socket of server.clients) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const input = new PassThrough(); const output = new PassThrough();
  const decoder = new FrameDecoder(); const received: Record<string, unknown>[] = [];
  const rawOutput: Buffer[] = [];
  let onOutput: (() => void) | undefined;
  output.on("data", bytes => { rawOutput.push(bytes); received.push(...decoder.push(bytes)); onOutput?.(); });
  const nextOutput = async (count: number) => {
    if (received.length >= count) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for native output")), 2000);
      onOutput = () => { if (received.length >= count) { clearTimeout(timer); onOutput = undefined; resolve(); } };
    });
  };
  const connected = once(server, "connection");
  const address = server.address(); assert.ok(address && typeof address === "object");
  const running = runNativeHost({ version: 1, port: address.port, token: "fake-internal-test-token" }, origin, { input, output });
  const [socket, request] = await connected;
  assert.equal(request.headers.origin, origin.slice(0, -1));
  const [helloBytes] = await once(socket, "message");
  assert.deepEqual(JSON.parse(String(helloBytes)), { type: "hello", token: "fake-internal-test-token", version: 1 });
  socket.send(JSON.stringify({ type: "ready", token: "must-not-leak" }));
  socket.send(JSON.stringify({ type: "request", id: "req1", action: "execute", site: "reddit", operation: "comment", args: { text: "你好" }, token: "must-not-leak" }));
  socket.send(JSON.stringify({ type: "cancel", id: "req2", token: "must-not-leak" }));
  await nextOutput(3);
  assert.deepEqual(received, [{ type: "ready" }, { type: "request", id: "req1", action: "execute", site: "reddit", operation: "comment", args: { text: "你好" } }, { type: "cancel", id: "req2" }]);
  assert.doesNotMatch(Buffer.concat(rawOutput).toString("utf8"), /fake-internal-test-token|must-not-leak/);
  const result = { type: "result", id: "req1", result: { ok: true, data: { message: "完成💬" } } };
  const response = once(socket, "message");
  const frame = encodeNativeFrame(result);
  for (let offset = 0; offset < frame.length; offset += 3) input.write(frame.subarray(offset, offset + 3));
  assert.deepEqual(JSON.parse(String((await response)[0])), result);
  input.end();
  await running;
  decoder.end();
});

test("native relay rejects malformed input without exposing credential or invalid output", async t => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  t.after(async () => { for (const socket of server.clients) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const input = new PassThrough(); const output = new PassThrough(); const chunks: Buffer[] = [];
  output.on("data", chunk => chunks.push(chunk));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const connected = once(server, "connection");
  const running = runNativeHost({ version: 1, port: address.port, token: "private-test-token" }, origin, { input, output });
  const rejection = assert.rejects(running, /Invalid native input/);
  const [socket] = await connected; await once(socket, "message");
  socket.send('{"type":"ready"}');
  await once(output, "data");
  input.write(rawFrame("null"));
  await rejection;
  const messages = new FrameDecoder().push(Buffer.concat(chunks));
  assert.deepEqual(messages, [{ type: "ready" }]);
  assert.doesNotMatch(Buffer.concat(chunks).toString("utf8"), /private-test-token/);
});

test("invalid native origin fails before connecting", async () => {
  for (const value of ["https://reddit.com", "chrome-extension://wrong/", `${origin}?token=secret`, `${origin}\n`]) {
    await assert.rejects(runNativeHost({ version: 1, port: 12345, token: "private" }, value), /origin/);
  }
});

test("Windows host files execute hidden with spaces, Unicode and shell characters in paths", { skip: process.platform !== "win32" }, async t => {
  const tempRoot = path.resolve(tmpdir());
  const directory = await mkdtemp(path.join(tempRoot, "site-mcp-native-"));
  t.after(async () => {
    const target = path.resolve(directory);
    assert.ok(target.startsWith(tempRoot + path.sep) && path.basename(target).startsWith("site-mcp-native-"));
    await rm(target, { recursive: true, force: true });
  });
  const fixtureDir = path.join(directory, "路径 spaces %TEMP% ! & test");
  await mkdir(fixtureDir);
  const entry = path.join(fixtureDir, "fixture.cjs");
  const configFile = path.join(fixtureDir, "config file.json");
  await writeFile(entry, "process.stdout.write(JSON.stringify(process.argv.slice(2)));", "utf8");
  const prepared = await prepareNativeHostFiles({ entry, configFile, extensionId, installDir: path.join(directory, "host"), hostName: "com.site_mcp.test" });
  const manifest = JSON.parse(await readFile(prepared.manifestPath, "utf8"));
  assert.equal(manifest.name, "com.site_mcp.test");
  assert.equal(manifest.path, prepared.wrapperPath);
  assert.deepEqual(manifest.allowed_origins, [origin]);
  assert.equal(manifest.type, "stdio");
  const wrapper = await readFile(prepared.wrapperPath, "utf8");
  assert.match(wrapper, /DisableDelayedExpansion/);
  assert.match(wrapper, /%%TEMP%%/);
  const command = `""${prepared.wrapperPath}" "${origin}" --parent-window=0"`;
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe", ["/d", "/s", "/c", command], { windowsHide: true, windowsVerbatimArguments: true, encoding: "utf8" }, (error, text) => error ? reject(error) : resolve(text));
  });
  assert.deepEqual(JSON.parse(stdout), ["native", "--config", configFile, origin, "--parent-window=0"]);
  for (const hostName of ["../escape", "com..bad", "com.bad.", "bad;command"]) {
    await assert.rejects(prepareNativeHostFiles({ entry, configFile, extensionId, installDir: directory, hostName }), /host name/);
  }
});
