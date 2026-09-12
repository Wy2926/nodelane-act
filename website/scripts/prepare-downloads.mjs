import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const target = path.join(root, 'website/public/downloads');
await mkdir(target, { recursive: true });
const names = { plugin: `nodelane-act-plugin-${version}.zip`, extension: `nodelane-act-extension-${version}.zip`, mcpb: `nodelane-act-${version}.mcpb` };
const files = {};
for (const [key, name] of Object.entries(names)) {
  const source = path.join(root, 'dist/packages', name);
  const bytes = await readFile(source);
  await copyFile(source, path.join(target, name));
  files[key] = { name, url: `/downloads/${name}`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
await writeFile(path.join(target, 'SHA256SUMS.txt'), Object.values(files).map(file => `${file.sha256}  ${file.name}`).join('\n')+'\n');
await writeFile(path.join(root, 'website/src/data/releases.json'), JSON.stringify({ version, files }, null, 2)+'\n');
console.log(`Prepared ${Object.keys(files).length} verified download files for ${version}.`);
