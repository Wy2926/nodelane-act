import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Run after npm pack: npm run test:package -- dist/packages/<package>.tgz
const archive = path.resolve(process.argv[2] ?? "");
if (!process.argv[2] || !archive.endsWith(".tgz")) throw new Error("Pass the npm pack .tgz path.");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this check with npm run test:package -- <archive.tgz>.");
const tempRoot = path.resolve(os.tmpdir());
const fixture = await mkdtemp(path.join(tempRoot, "nodelane-act-npm-"));
const secret = randomBytes(32).toString("hex");
const server = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${secret}`) { res.writeHead(403); res.end(); return; }
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/health") { res.end(JSON.stringify({ service: "site-mcp", version: 1, transport: "websocket-discovery", connected: true })); return; }
  if (req.url === "/rpc") {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const command = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    res.end(JSON.stringify(command.action === "context" ? { ok: true, data: { targets: [] } } : { ok: false, error: { code: "TEST_ONLY", message: "No website execution in npm smoke tests." } })); return;
  }
  res.writeHead(404); res.end();
});
let client;
try {
  await promisify(execFile)(process.execPath, [npmCli, "install", "--prefix", fixture, archive, "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev", "--package-lock=false"], { cwd: fixture, windowsHide: true, env: { ...process.env, npm_config_cache: path.join(fixture, "cache"), npm_config_update_notifier: "false" } });
  const installed = path.join(fixture, "node_modules/nodelane-act");
  const metadata = JSON.parse(await readFile(path.join(installed, "package.json"), "utf8"));
  assert.equal(metadata.private, undefined); assert.deepEqual(metadata.dependencies ?? {}, {});
  for (const file of await readdir(installed, { recursive: true, withFileTypes: true })) {
    if (!file.isFile()) continue;
    const relative = path.relative(installed, path.join(file.parentPath, file.name)).replaceAll("\\", "/");
    assert.ok(["package.json", "README.md", "LICENSE", "dist/EXTENSION.md"].includes(relative)
      || /^dist\/server\/(?:chunks\/)?[^/]+\.js$/.test(relative)
      || relative.startsWith("dist/licenses/")
      || /^dist\/extension\/[^/]+\.(?:js|json|html|css|png|svg)$/.test(relative), `Unexpected published file: ${relative}`);
  }
  assert.match(await readFile(path.join(installed, "dist/server/index.js"), "utf8"), /^#!\/usr\/bin\/env node\n/);
  assert.match(await readFile(path.join(installed, "dist/EXTENSION.md"), "utf8"), /releases/);
  await readFile(path.join(installed, "LICENSE")); await readFile(path.join(installed, "dist/licenses/DEPENDENCIES.txt"));
  await readFile(path.join(installed, "dist/extension/manifest.json"));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const configFile = path.join(fixture, "config.json");
  await writeFile(configFile, JSON.stringify({ version: 1, port: server.address().port, token: secret }));
  const transport = new StdioClientTransport({ command: process.execPath, args: [npmCli, "exec", "--offline", "--prefix", fixture, "--", "nodelane-act", "--config", configFile], cwd: fixture, stderr: "pipe", env: { ...process.env, npm_config_update_notifier: "false" } });
  client = new Client({ name: "npm-package-smoke", version: "1" });
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ["site.context", "site.discover", "site.execute"]);
  for (const site of ["reddit", "zhihu"]) {
    const result = await client.callTool({ name: "site.discover", arguments: { site, operation: "account" } });
    assert.equal(result.isError, false); assert.match(result.content[0].text, /inputSchema/);
  }
  const context = await client.callTool({ name: "site.context", arguments: {} });
  assert.deepEqual(JSON.parse(context.content[0].text).targets, []);
  console.log("npm package smoke passed: offline install, generated bin command, MCP initialization, lazy Reddit/Zhihu schemas, and authenticated localhost context. No website writes were made.");
} finally {
  await client?.close();
  server.closeAllConnections();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  if (path.dirname(fixture) !== tempRoot || !path.basename(fixture).startsWith("nodelane-act-npm-")) throw new Error("Unsafe temporary test directory.");
  await rm(fixture, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
