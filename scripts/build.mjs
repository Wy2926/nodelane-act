import { build } from "esbuild";
import { mkdir, readdir, copyFile, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { generate, root } from "./generate.mjs";

const manifests = await generate();
for (const name of ["server", "extension", "licenses"]) {
  const destination = path.resolve(root, "dist", name);
  if (path.dirname(destination) !== path.resolve(root, "dist")) throw new Error("Unsafe build output path");
  await rm(destination, { recursive: true, force: true });
}
await mkdir(path.join(root, "dist/server"), { recursive: true });
await mkdir(path.join(root, "dist/extension"), { recursive: true });
const serverBuild = await build({ entryPoints: [path.join(root, "src/server/index.ts")], outdir: path.join(root, "dist/server"), bundle: true, platform: "node", target: "node22", format: "esm", splitting: true, chunkNames: "chunks/[name]-[hash]", banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" }, sourcemap: true, metafile: true });
// MV3 service workers do not support import(). esbuild lowers registered lazy
// loaders to local Promise initializers when splitting is off; no remote code.
await build({ entryPoints: [path.join(root, "extension/background.ts"), path.join(root, "extension/popup.ts")], outdir: path.join(root, "dist/extension"), bundle: true, platform: "browser", target: "chrome120", format: "esm", splitting: false, keepNames: false, sourcemap: true });
for (const entry of await readdir(path.join(root, "extension"), { withFileTypes: true })) {
  if (entry.isFile() && /\.(html|css|png|svg)$/.test(entry.name)) await copyFile(path.join(root, "extension", entry.name), path.join(root, "dist/extension", entry.name));
}
const manifest = JSON.parse(await readFile(path.join(root, "extension/manifest.json"), "utf8"));
const identity = JSON.parse(await readFile(path.join(root, "extension/identity.json"), "utf8"));
manifest.key = identity.publicKey;
manifest.host_permissions = [...new Set([...(manifest.host_permissions ?? []), ...manifests.flatMap(m => m.hosts.map(host => `https://${host}/*`))])];
delete manifest.optional_host_permissions;
await writeFile(path.join(root, "dist/extension/manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
await copyFile(path.join(root, "extension/identity.json"), path.join(root, "dist/extension/identity.json"));
const dependencyRoots = new Set();
for (const filename of Object.keys(serverBuild.metafile.inputs)) {
  const normalized = filename.replaceAll("\\", "/");
  const marker = normalized.lastIndexOf("node_modules/");
  if (marker < 0) continue;
  const parts = normalized.slice(marker + 13).split("/");
  const length = parts[0].startsWith("@") ? 2 : 1;
  dependencyRoots.add(path.resolve(root, normalized.slice(0, marker + 13), ...parts.slice(0, length)));
}
const notices = [];
for (const dependencyRoot of dependencyRoots) {
  const pkg = JSON.parse(await readFile(path.join(dependencyRoot, "package.json"), "utf8"));
  const directory = path.join(root, "dist/licenses", pkg.name.replaceAll("/", "__"));
  await mkdir(directory, { recursive: true });
  for (const file of await readdir(dependencyRoot)) if (/^(license|licence|notice|copying)(\.|$)/i.test(file)) await copyFile(path.join(dependencyRoot, file), path.join(directory, file));
  notices.push(`${pkg.name}@${pkg.version}: ${typeof pkg.license === "string" ? pkg.license : JSON.stringify(pkg.license ?? "See bundled license")}`);
}
await writeFile(path.join(root, "dist/licenses/DEPENDENCIES.txt"), notices.sort().join("\n") + "\n");
console.log(`Built MCP server and extension with ${manifests.length} independent, lazily loaded site adapters.`);
