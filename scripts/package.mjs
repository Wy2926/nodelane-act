import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { root } from "./generate.mjs";

if (process.platform !== "win32") throw new Error("The current release packaging script targets Windows.");
const metadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const { version } = metadata;
const packages = path.resolve(root, "dist/packages");
const stage = path.join(packages, "nodelane-act");
if (path.dirname(stage) !== packages || path.dirname(packages) !== path.resolve(root, "dist")) throw new Error("Unsafe packaging path");
await rm(stage, { recursive: true, force: true });
await mkdir(path.join(stage, "dist"), { recursive: true });
// Keep .js output explicitly ESM on every supported Node 22 minor version and
// when a user extracts this package beneath an unrelated CommonJS project.
await writeFile(path.join(stage, "package.json"), JSON.stringify({ name: metadata.name, version, private: true, type: "module", license: metadata.license, engines: { node: ">=22" }, bin: metadata.bin }, null, 2) + "\n");
for (const name of [".codex-plugin", ".mcp.json", "README.md", "LICENSE", "docs"]) await cp(path.join(root, name), path.join(stage, name), { recursive: true });
for (const name of ["server", "extension", "licenses"]) await cp(path.join(root, "dist", name), path.join(stage, "dist", name), { recursive: true, filter: source => !source.endsWith(".map") });
await cp(path.join(root, "dist/EXTENSION.md"), path.join(stage, "dist/EXTENSION.md"));
const quote = value => `'${value.replaceAll("'", "''")}'`;
const pluginZip = path.join(packages, `nodelane-act-plugin-${version}.zip`);
const extensionZip = path.join(packages, `nodelane-act-extension-${version}.zip`);
for (const file of [pluginZip, extensionZip]) await rm(file, { force: true });
// ZipFile includes dotfiles such as .mcp.json and .codex-plugin reliably.
const script = `Add-Type -AssemblyName System.IO.Compression.FileSystem\n[System.IO.Compression.ZipFile]::CreateFromDirectory(${quote(stage)}, ${quote(pluginZip)})\n[System.IO.Compression.ZipFile]::CreateFromDirectory(${quote(path.join(stage, "dist/extension"))}, ${quote(extensionZip)})`;
await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
console.log(`Packaged ${pluginZip}\nPackaged ${extensionZip}`);
