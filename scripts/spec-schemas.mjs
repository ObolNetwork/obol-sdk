#!/usr/bin/env node
// Writes spec/schemas/*.json from the TypeBox input schemas
// (scripts/specSchemas.ts), bundled with esbuild first.
import { build } from 'esbuild';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Inside the repo, so the bundle resolves the packages from node_modules.
const out = join(root, 'temp', `spec-schemas-${process.pid}.mjs`);
mkdirSync(join(root, 'temp'), { recursive: true });
await build({
  entryPoints: [join(root, 'scripts/specSchemas.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: out,
  packages: 'external',
  logLevel: 'warning',
});
const { specSchemas } = await import(pathToFileURL(out).href);
rmSync(out);
const dir = join(root, 'spec/schemas');
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir)) if (f.endsWith('.json')) rmSync(join(dir, f));
const files = specSchemas();
for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
console.log(`wrote ${Object.keys(files).length} schemas to spec/schemas/`);
