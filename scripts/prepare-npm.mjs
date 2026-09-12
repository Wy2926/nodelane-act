import { chmod, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { root } from "./generate.mjs";

// npm publishes this already bundled entry, with no runtime install dependencies.
const metadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (metadata.private || Object.keys(metadata.dependencies ?? {}).length) throw new Error("The npm release must be public and self-contained.");
const entry = path.join(root, metadata.bin[metadata.name]);
if (entry !== path.join(root, "dist/server/index.js")) throw new Error("Unexpected npm executable path.");
const source = await readFile(entry, "utf8");
if (!source.startsWith("#!/usr/bin/env node\n")) await writeFile(entry, "#!/usr/bin/env node\n" + source.replace(/^#![^\n]*\n/, ""));
await chmod(entry, 0o755);

const dependencies = (await readFile(path.join(root, "dist/licenses/DEPENDENCIES.txt"), "utf8")).trim().split("\n");
if (!dependencies.length || !dependencies[0]) throw new Error("Bundled dependency license inventory is missing.");
for (const dependency of dependencies) {
  const name = dependency.slice(0, dependency.indexOf(":")).replace(/@[^@]+$/, "");
  const directory = path.join(root, "dist/licenses", name.replaceAll("/", "__"));
  if (!(await readdir(directory)).some(file => /^(license|licence|notice|copying)(\.|$)/i.test(file))) throw new Error(`Missing bundled license for ${name}.`);
}
await readFile(path.join(root, "LICENSE"), "utf8");
const manifest = JSON.parse(await readFile(path.join(root, "dist/extension/manifest.json"), "utf8"));
const identity = JSON.parse(await readFile(path.join(root, "extension/identity.json"), "utf8"));
if (manifest.key !== identity.publicKey) throw new Error("The packaged browser extension identity must remain stable.");
await writeFile(path.join(root, "dist/EXTENSION.md"), `# NodeLane Act companion extension\n\nThe MCP command requires Node.js 22 or later and the companion browser extension in the same computer's Chrome or Edge browser. It uses your browser's existing website sessions; no pairing code or API keys are needed.\n\nDownload the extension ZIP from https://github.com/Wy2926/nodelane-act/releases and extract it to a permanent directory. Open chrome://extensions or edge://extensions, enable Developer mode, choose Load unpacked, and select that directory. The extension connects automatically when the MCP command runs.\n\nThis npm package also includes a complete offline copy in dist/extension. If you use it, copy that folder to a permanent directory before loading it; temporary npx cache locations are not suitable for an installed browser extension.\n\nRun the stdio MCP server with npx -y ${metadata.name}. Website: https://act.nodelane.net\n`);
console.log(`Prepared ${metadata.name}@${metadata.version} with its companion extension and ${dependencies.length} third-party license notices.`);
