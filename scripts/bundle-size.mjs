#!/usr/bin/env node
// Bundle-size check (CI: `yarn size:check` after `yarn build`). Bundles a few
// typical imports of the built browser ESM output with esbuild, as an app
// bundler would (minified, tree-shaken, viem external), and compares the
// sizes with scripts/bundle-budget.json. It also checks that a reads-only
// import of the ovm module carries no BLS12-381 or SSZ code.
//
//   node scripts/bundle-size.mjs            check
//   node scripts/bundle-size.mjs --update   record the current sizes (+5%)
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist/browser/src');
const budgetFile = join(root, 'scripts/bundle-budget.json');

const SCENARIOS = {
  // A page that reads an OVM (ovm.getState / verify) and nothing else.
  'ovm-reads': `
    import { createObolContext, createOvmModule } from '${dist}/ovm/index.js';
    export const read = (config, address) =>
      createOvmModule(createObolContext(config)).getState(address);`,
  // The same through the root entry: the namespaces it does not use go,
  // except the imports of @chainsafe/ssz, which does not declare itself free
  // of side effects; so only the BLS check applies here.
  'ovm-reads-root': `
    import { createObolContext, ovm } from '${dist}/index.js';
    export const read = (config, address) =>
      ovm.createOvmModule(createObolContext(config)).getState(address);`,
  'splits-distribution': `
    import { createObolContext, createSplitsModule } from '${dist}/splits/index.js';
    export const preview = (config, input) =>
      createSplitsModule(createObolContext(config)).previewDistribution(input);`,
  // Everything: the client with every module.
  client: `
    import { createObolClient } from '${dist}/index.js';
    export const client = config => createObolClient(config);`,
};

// Code that must not be in a reads-only ovm bundle.
const HEAVY = {
  'BLS12-381 (@noble/curves)': /BLS_SIG_BLS12381G2|bls12-381|BLS12_381/,
  '@chainsafe/ssz': /@chainsafe\/ssz|ContainerType|ByteVectorType/,
};
const LIGHT = { 'ovm-reads': Object.keys(HEAVY), 'ovm-reads-root': ['BLS12-381 (@noble/curves)'] };

const bundle = async name => {
  const result = await build({
    stdin: { contents: SCENARIOS[name], resolveDir: root, loader: 'js' },
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    metafile: true,
    external: ['viem', 'viem/*'],
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  return {
    code,
    inputs: Object.keys(result.metafile.inputs),
    bytes: Buffer.byteLength(code),
    gzip: gzipSync(code).length,
  };
};

const update = process.argv.includes('--update');
const budget = update ? {} : JSON.parse(readFileSync(budgetFile, 'utf8'));
let failed = false;
const next = {};
for (const name of Object.keys(SCENARIOS)) {
  const { code, inputs, bytes, gzip } = await bundle(name);
  next[name] = {
    bytes: Math.ceil((bytes * 1.05) / 1024) * 1024,
    gzip: Math.ceil((gzip * 1.05) / 1024) * 1024,
  };
  let line = `${name}: ${(bytes / 1024).toFixed(1)} KiB, ${(gzip / 1024).toFixed(1)} KiB gzip`;
  for (const what of LIGHT[name] ?? []) {
    const pattern = HEAVY[what];
    {
      const viaInputs = inputs.some(i => pattern.test(i));
      if (viaInputs || pattern.test(code)) {
        failed = true;
        line += `\n  FAIL: contains ${what}`;
      }
    }
  }
  if (!update) {
    const limit = budget[name];
    if (limit === undefined) {
      failed = true;
      line += '\n  FAIL: no budget recorded (run with --update)';
    } else if (bytes > limit.bytes || gzip > limit.gzip) {
      failed = true;
      line += `\n  FAIL: over budget (${limit.bytes} bytes, ${limit.gzip} gzip)`;
    }
  }
  console.log(line);
}
if (update) {
  writeFileSync(budgetFile, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`recorded ${budgetFile}`);
}
if (failed) process.exit(1);
