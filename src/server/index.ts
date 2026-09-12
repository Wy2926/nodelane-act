import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig, type Config } from "./config.js";
import { bridgeFetch, bridgeIsReady, startConfiguredBridge } from "./bridge.js";
import { SiteService } from "./service.js";
import { createMcpServer } from "./mcp.js";
import type { OperationResult } from "../shared/contracts.js";
import { runNativeHost } from "./native.js";

const args = process.argv.slice(2);
const configIndex = args.indexOf("--config");
const stateDir = process.platform === "win32" ? path.join(process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData/Local"), "SiteMCP") : path.join(homedir(), ".local/share/site-mcp");
const configFile = path.resolve(configIndex >= 0 ? args[configIndex + 1] : path.join(stateDir, "config.json"));
const command = args[0]?.startsWith("--") ? undefined : args[0];
const entry = fileURLToPath(import.meta.url);

let starting: Promise<Config> | undefined;
async function ensureBridge(): Promise<Config> {
  const current = await readConfig(configFile, true);
  if (await bridgeIsReady(current)) return current;
  if (starting) return starting;
  starting = startBridgeProcess();
  try { return await starting; }
  finally { starting = undefined; }
}

async function startBridgeProcess(): Promise<Config> {
  const child = spawn(process.execPath, [entry, "bridge", "--config", configFile], { detached: true, stdio: "ignore", windowsHide: true });
  let startupError: Error | undefined;
  child.on("error", error => { startupError = error; }); child.unref();
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
    if (startupError) throw new Error("Failed to start the local bridge.");
    const config = await readConfig(configFile);
    if (await bridgeIsReady(config)) return config;
  }
  throw new Error("Could not start the local bridge. Check whether discovery ports 17477–17486 are available.");
}

async function main() {
  const config = await readConfig(configFile, !["status", "stop", "native"].includes(command ?? ""));
  if (command === "native") {
    const origin = args.find(arg => /^chrome-extension:\/\/[a-p]{32}\/?$/.test(arg));
    if (!origin) throw new Error("Native host must be launched by the installed browser extension.");
    await runNativeHost(config, origin);
    return;
  }
  if (command === "bridge") {
    const { bridge } = await startConfiguredBridge(configFile);
    if (!bridge) return;
    console.error(`Site MCP local bridge listening on 127.0.0.1:${bridge.port}`);
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void bridge.close().then(() => process.exit(0)); });
    return;
  }
  if (command === "status") { console.log(JSON.stringify(await bridgeFetch(config, "/health"))); return; }
  if (command === "stop") { await bridgeFetch(config, "/shutdown", {}); console.log("Local bridge stopped."); return; }
  if (command && command !== "setup") throw new Error(`Unknown command: ${command}`);
  if (command === "setup") { await ensureBridge(); console.log("Local browser bridge is ready. The extension connects automatically; no pairing or credentials are required."); return; }
  const service = new SiteService(async (browserCommand, signal) => {
    signal?.throwIfAborted();
    const active = await ensureBridge();
    signal?.throwIfAborted();
    return await bridgeFetch(active, "/rpc", browserCommand, signal) as OperationResult;
  });
  const server = createMcpServer(service);
  await ensureBridge();
  await server.connect(new StdioServerTransport());
  process.stdin.once("end", () => { void server.close(); });
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Site MCP failed"); process.exitCode = 1; });
