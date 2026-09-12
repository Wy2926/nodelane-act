import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packExtension, unpackExtension } from "@anthropic-ai/mcpb";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const metadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const template = JSON.parse(await readFile(path.join(root, "server.json"), "utf8"));
const { version } = metadata;
assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
assert.equal(template.version, version, "Update server.json alongside package.json when releasing.");
assert.equal(metadata.name, "nodelane-act");
assert.equal(template.name, "io.github.Wy2926/nodelane-act");
const packages = path.resolve(root, "dist/packages");
const stage = path.join(packages, "nodelane-act-mcpb");
if (path.dirname(stage) !== packages || path.dirname(packages) !== path.resolve(root, "dist")) throw new Error("Unsafe MCPB staging path.");
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
for (const directory of ["server", "extension", "licenses"]) {
  await cp(path.join(root, "dist", directory), path.join(stage, "dist", directory), { recursive: true });
}
for (const name of ["LICENSE", "README.md", "docs"]) await cp(path.join(root, name), path.join(stage, name), { recursive: true });
await cp(path.join(root, "dist/EXTENSION.md"), path.join(stage, "EXTENSION.md"));
await writeFile(path.join(stage, "package.json"), JSON.stringify({ name: metadata.name, version, type: "module", private: true, license: "MIT", engines: { node: ">=22" } }, null, 2) + "\n");
const manifest = {
  manifest_version: "0.3",
  name: "nodelane-act",
  display_name: "NodeLane Act",
  icon: "dist/extension/logo.png",
  version,
  description: template.description,
  long_description: "Use Reddit, Zhihu, X and WhatsApp through your own signed-in browser. Requires Node.js 22 or later and the companion browser extension on the same computer. Install the browser extension separately from the included dist/extension directory or the official extension ZIP. The MCP server and browser connection run locally; NodeLane does not relay your browser traffic through a cloud service. Website writes require authorization in the user's request.",
  author: { name: "NodeLane contributors", url: "https://nodelane.net" },
  repository: { type: "git", url: template.repository.url },
  homepage: template.websiteUrl,
  documentation: template.websiteUrl + "/#install",
  support: template.repository.url + "/issues",
  license: "MIT",
  privacy_policies: [template.websiteUrl + "/privacy/"],
  keywords: ["mcp", "browser", "reddit", "zhihu", "twitter", "whatsapp", "nodelane"],
  compatibility: { platforms: ["win32", "darwin", "linux"], runtimes: { node: ">=22" } },
  server: { type: "node", entry_point: "dist/server/index.js", mcp_config: { command: "node", args: ["${__dirname}/dist/server/index.js"] } },
  tools: [
    { name: "site.context", description: "Find or open supported browser tabs and obtain opaque target IDs." },
    { name: "site.discover", description: "Discover supported websites and selected operation schemas on demand." },
    { name: "site.execute", description: "Run a discovered, user-authorized operation through the local browser extension." }
  ],
  tools_generated: false
};
await writeFile(path.join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
const filename = `nodelane-act-${version}.mcpb`;
const archive = path.join(packages, filename);
if (!await packExtension({ extensionPath: stage, outputPath: archive })) throw new Error("MCPB packaging failed.");

// Test the actual archive after extraction, with a disconnected local bridge.
// This confirms that listing tools and loading adapters do not need an extension,
// and avoids opening a real browser or competing for the user's discovery ports.
const tempRoot = path.resolve(tmpdir());
const fixture = await mkdtemp(path.join(tempRoot, "nodelane-act-mcpb-"));
const unpacked = path.join(fixture, "extension");
const token = randomBytes(32).toString("hex");
const bridge = createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(403); res.end(); return; }
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/health") { res.end(JSON.stringify({ service: "site-mcp", version: 1, transport: "websocket-discovery", connected: false })); return; }
  res.end(JSON.stringify({ ok: false, error: { code: "BROWSER_DISCONNECTED", message: "Install and connect the local browser extension." } }));
});
let client;
let serverCard;
try {
  if (!await unpackExtension({ mcpbPath: archive, outputDir: unpacked, silent: true })) throw new Error("MCPB extraction failed.");
  const unpackedManifest = JSON.parse(await readFile(path.join(unpacked, "manifest.json"), "utf8"));
  assert.equal(unpackedManifest.version, version);
  assert.equal(unpackedManifest.server.entry_point, "dist/server/index.js");
  await readFile(path.join(unpacked, "LICENSE"));
  await readFile(path.join(unpacked, "dist/licenses/DEPENDENCIES.txt"));
  const browserManifest = JSON.parse(await readFile(path.join(unpacked, "dist/extension/manifest.json"), "utf8"));
  assert.ok(browserManifest.key, "MCPB must preserve the browser extension identity.");
  await new Promise(resolve => bridge.listen(0, "127.0.0.1", resolve));
  const config = path.join(fixture, "config.json");
  await writeFile(config, JSON.stringify({ version: 1, port: bridge.address().port, token }));
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(unpacked, unpackedManifest.server.entry_point), "--config", config], cwd: fixture, stderr: "pipe" });
  client = new Client({ name: "nodelane-act-mcpb-check", version });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ["site.context", "site.discover", "site.execute"]);
  for (const site of ["reddit", "zhihu", "x", "whatsapp"]) {
    const result = await client.callTool({ name: "site.discover", arguments: { site, operation: "account" } });
    assert.equal(result.isError, false);
    assert.match(result.content[0].text, /inputSchema/);
  }
  const context = await client.callTool({ name: "site.context", arguments: {} });
  assert.equal(context.isError, true);
  assert.equal(JSON.parse(context.content[0].text).error.code, "BROWSER_DISCONNECTED");
  serverCard = { serverInfo: { name: "nodelane-act", title: "NodeLane Act", version, websiteUrl: template.websiteUrl }, tools, resources: [], prompts: [] };
} finally {
  await client?.close();
  bridge.closeAllConnections();
  if (bridge.listening) await new Promise(resolve => bridge.close(resolve));
  if (path.dirname(fixture) !== tempRoot || !path.basename(fixture).startsWith("nodelane-act-mcpb-")) throw new Error("Unsafe MCPB test directory.");
  await rm(fixture, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
const sha256 = createHash("sha256").update(await readFile(archive)).digest("hex");
const published = { ...template, packages: [{ registryType: "mcpb", identifier: `${template.repository.url}/releases/download/v${version}/${filename}`, fileSha256: sha256, transport: { type: "stdio" } }] };
await writeFile(path.join(packages, "server.json"), JSON.stringify(published, null, 2) + "\n");
await writeFile(path.join(packages, "server-card.json"), JSON.stringify(serverCard, null, 2) + "\n");
const checksums = [];
for (const name of [`nodelane-act-plugin-${version}.zip`, `nodelane-act-extension-${version}.zip`, filename, `nodelane-act-${version}.tgz`, "server.json", "server-card.json"]) {
  checksums.push(`${createHash("sha256").update(await readFile(path.join(packages, name))).digest("hex")}  ${name}`);
}
await writeFile(path.join(packages, "SHA256SUMS.txt"), checksums.join("\n") + "\n");
console.log(`MCPB archive passed: extraction, local stdio startup, three tools, all four site schemas, and disconnected-extension response.\nCreated ${archive}\nRegistry metadata: ${path.join(packages, "server.json")}`);
