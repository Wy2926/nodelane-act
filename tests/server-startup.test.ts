import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { buildSync } from "esbuild";
import { BrowserBridge, bridgeIsReady, startConfiguredBridge } from "../src/server/bridge.js";
import { readConfig, withFileLock, writeConfig } from "../src/server/config.js";
import { DISCOVERY_PORTS, PROTOCOL_VERSION, SERVICE_NAME } from "../src/shared/connection.js";

async function temporaryConfig() {
  const directory = await mkdtemp(path.join(tmpdir(), "site-mcp-startup-"));
  return { directory, filename: path.join(directory, "config.json") };
}

async function listeningServer() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return { server, port, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

test("simultaneous first starts persist one internal credential and default discovery port", async () => {
  const { directory, filename } = await temporaryConfig();
  try {
    const configs = await Promise.all(Array.from({ length: 12 }, () => readConfig(filename, true)));
    assert.equal(new Set(configs.map(config => config.token)).size, 1);
    assert.equal(configs[0].port, DISCOVERY_PORTS[0]);
    assert.deepEqual(await readConfig(filename), configs[0]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("port collision falls through, persists the winner, and concurrent starts reuse it", async () => {
  const { directory, filename } = await temporaryConfig();
  const occupied = await listeningServer();
  const available = await listeningServer(); await available.close();
  const initial = { version: 1 as const, port: 17373, token: randomBytes(32).toString("hex") };
  const bridges: BrowserBridge[] = [];
  try {
    await writeConfig(filename, initial);
    const started = await Promise.all(Array.from({ length: 6 }, () => startConfiguredBridge(filename, [occupied.port, available.port])));
    for (const result of started) if (result.bridge) bridges.push(result.bridge);
    assert.equal(bridges.length, 1);
    assert.ok(started.every(result => result.config.port === available.port && result.config.token === initial.token));
    assert.deepEqual(await readConfig(filename), { ...initial, port: available.port });
    assert.equal(await bridgeIsReady(await readConfig(filename)), true);
  } finally { await Promise.all(bridges.map(bridge => bridge.close())); await occupied.close(); await rm(directory, { recursive: true, force: true }); }
});

test("an existing discovery bridge on an explicit arbitrary port remains in place", async () => {
  const { directory, filename } = await temporaryConfig();
  const bridge = new BrowserBridge({ version: 1, port: 0, token: randomBytes(32).toString("hex") });
  await bridge.start();
  try {
    await writeConfig(filename, { ...bridge.config, port: bridge.port });
    const started = await startConfiguredBridge(filename);
    assert.equal(started.bridge, undefined); assert.equal(started.config.port, bridge.port);
  } finally { await bridge.close(); await rm(directory, { recursive: true, force: true }); }
});

test("legacy authenticated bridge is retired and moved into the discovery range", async () => {
  const { directory, filename } = await temporaryConfig();
  const available = await listeningServer(); await available.close();
  const token = randomBytes(32).toString("hex");
  let stopped = false;
  const old = createServer((req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/health") res.end(JSON.stringify({ service: SERVICE_NAME, version: PROTOCOL_VERSION, connected: false }));
    else { stopped = true; res.end('{"ok":true}'); old.close(); }
  });
  await new Promise<void>(resolve => old.listen(0, "127.0.0.1", resolve));
  let bridge: BrowserBridge | undefined;
  try {
    await writeConfig(filename, { version: 1, port: (old.address() as { port: number }).port, token });
    const result = await startConfiguredBridge(filename, [available.port]); bridge = result.bridge;
    assert.equal(stopped, true); assert.equal(result.config.port, available.port); assert.equal(result.config.token, token);
  } finally { if (bridge) await bridge.close(); old.closeAllConnections(); old.close(); await rm(directory, { recursive: true, force: true }); }
});

test("startup failure leaves the existing config unchanged and releases its lock", async () => {
  const { directory, filename } = await temporaryConfig();
  const occupied = await listeningServer();
  try {
    const config = await readConfig(filename, true);
    await assert.rejects(startConfiguredBridge(filename, [occupied.port]), /discovery ports are in use/);
    assert.deepEqual(await readConfig(filename), config);
    await withFileLock(`${filename}.bridge.lock`, async () => {});
    await writeFile(filename, "null"); await assert.rejects(readConfig(filename), /Invalid local bridge configuration/);
    assert.equal(await readFile(filename, "utf8"), "null");
  } finally { await occupied.close(); await rm(directory, { recursive: true, force: true }); }
});

test("independent MCP child processes converge on one persisted bridge", async () => {
  const { directory, filename } = await temporaryConfig();
  const available = await listeningServer(); await available.close();
  const source = buildSync({
    stdin: { contents: `import { startConfiguredBridge } from './src/server/bridge.ts';
      startConfiguredBridge(process.argv[1], [Number(process.argv[2])]).then(({config, bridge}) => {
        process.stdout.write(JSON.stringify({port:config.port, owner:!!bridge})+'\\n');
        process.stdin.resume(); process.stdin.once('end', () => {
          Promise.resolve(bridge?.close()).then(() => process.exit(0));
        });
      }).catch(() => { process.stderr.write('Bridge child failed\\n'); process.exit(1); });`, resolveDir: process.cwd() },
    bundle: true, write: false, platform: "node", format: "cjs", target: "node22", packages: "external",
  }).outputFiles[0].text;
  const children: ReturnType<typeof spawn>[] = [];
  const exits: Promise<unknown>[] = [];
  try {
    const ready = Array.from({ length: 4 }, () => {
      const child = spawn(process.execPath, ["-e", source, filename, String(available.port)], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      children.push(child); exits.push(once(child, "exit"));
      return new Promise<{ port: number; owner: boolean }>((resolve, reject) => {
        let output = "";
        const timeout = setTimeout(() => reject(new Error("Bridge child did not become ready")), 15_000);
        child.once("error", error => { clearTimeout(timeout); reject(error); });
        child.once("exit", code => { clearTimeout(timeout); if (!output.includes("\n")) reject(new Error(`Bridge child exited: ${code}`)); });
        child.stdout!.on("data", chunk => {
          output += chunk.toString();
          if (output.includes("\n")) { clearTimeout(timeout); resolve(JSON.parse(output.split("\n")[0])); }
        });
      });
    });
    const results = await Promise.all(ready);
    assert.equal(results.filter(result => result.owner).length, 1);
    assert.ok(results.every(result => result.port === available.port));
    assert.equal(await bridgeIsReady(await readConfig(filename)), true);
    for (const child of children) child.stdin!.end();
    assert.ok((await Promise.all(exits)).every(result => (result as unknown[])[0] === 0));
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
    await Promise.allSettled(exits);
    await rm(directory, { recursive: true, force: true });
  }
});
