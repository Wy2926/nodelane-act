import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink, stat } from "node:fs/promises";
import path from "node:path";
import { DISCOVERY_PORTS } from "../shared/connection.js";

export interface Config { version: 1; port: number; token: string }

/** Serialize starts from independent MCP processes without exposing credentials. */
export async function withFileLock<T>(filename: string, action: () => Promise<T>): Promise<T> {
  await mkdir(path.dirname(filename), { recursive: true });
  const owner = JSON.stringify({ pid: process.pid, nonce: randomUUID() });
  const deadline = Date.now() + 20_000;
  while (true) {
    try { await writeFile(filename, owner, { flag: "wx", mode: 0o600 }); break; }
    // Windows can report EPERM briefly while the previous lock's deletion drains.
    catch (error) { if (!["EEXIST", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
    // Only one reaper can inspect/remove a dead owner's lock at a time.
    const reaper = `${filename}.reap`;
    let ownsReaper = false;
    try {
      await writeFile(reaper, "", { flag: "wx", mode: 0o600 }); ownsReaper = true;
      const contents = await readFile(filename, "utf8");
      let stale = false;
      try {
        const holder = JSON.parse(contents) as { pid?: number };
        if (Number.isInteger(holder.pid) && holder.pid! > 0) {
          try { process.kill(holder.pid!, 0); } catch (error) { stale = (error as NodeJS.ErrnoException).code === "ESRCH"; }
        } else stale = Date.now() - (await stat(filename)).mtimeMs > 30_000;
      } catch { stale = Date.now() - (await stat(filename)).mtimeMs > 30_000; }
      if (stale) await unlink(filename);
    } catch (error) { if (!["ENOENT", "EEXIST", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
    finally { if (ownsReaper) await unlink(reaper).catch(() => {}); }
    if (Date.now() >= deadline) throw new Error("Another local bridge is still starting. Try again shortly.");
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  try { return await action(); }
  finally { if (await readFile(filename, "utf8").catch(() => "") === owner) await unlink(filename); }
}

export async function writeConfig(filename: string, config: Config): Promise<void> {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(config, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, filename);
  } finally { await unlink(temporary).catch(() => {}); }
}

export async function readConfig(filename: string, create = false): Promise<Config> {
  let value: unknown;
  try { value = JSON.parse(await readFile(filename, "utf8")); }
  catch (error) {
    if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Cannot read local configuration. Start Site MCP to create it automatically.");
    return withFileLock(`${filename}.config.lock`, async () => {
      try { await stat(filename); return readConfig(filename); }
      catch (existingError) { if ((existingError as NodeJS.ErrnoException).code !== "ENOENT") throw existingError; }
      const config: Config = { version: 1, port: DISCOVERY_PORTS[0], token: randomBytes(32).toString("hex") };
      await writeConfig(filename, config);
      return config;
    });
  }
  const config = value as Config;
  if (!config || typeof config !== "object" || config.version !== 1 || !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535 || typeof config.token !== "string" || !/^[a-f0-9]{64}$/.test(config.token)) throw new Error("Invalid local bridge configuration.");
  return config;
}
