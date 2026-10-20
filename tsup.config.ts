import { mkdir, writeFile } from 'node:fs/promises';
import { defineConfig } from 'tsup';

// The package has no "type" field, so Node reads `.js` as CommonJS. The ESM
// builds get their own package.json marking their `.js` files as modules
// (no MODULE_TYPELESS_PACKAGE_JSON reparse warning). It sits one level above
// `src/` so it covers everything under the build directory.
const markAsModule = (dir: string) => async (): Promise<void> => {
  await mkdir(dir, { recursive: true });
  await writeFile(
    `${dir}/package.json`,
    `${JSON.stringify({ type: 'module' }, null, 2)}\n`,
  );
};

// One entry per build. Lock verification runs on the calling thread (it
// yields to the event loop), so there is no worker bundle.
const nodeEntries = { index: 'src/index.ts' };

// Bundle ESM-only deps and @noble/curves (avoids ESM resolution issues in CJS consumers)
const noExternal = ['@chainsafe/enr', '@noble/curves', '@noble/hashes'];

export default defineConfig([
  // Node.js CJS build
  {
    entry: nodeEntries,
    format: ['cjs'],
    dts: false,
    outDir: 'dist/cjs/src',
    sourcemap: true,
    noExternal,
    external: ['@chainsafe/ssz', 'viem'],
    esbuildOptions(options) {
      options.platform = 'node';
    },
  },
  // Node.js ESM build
  {
    entry: nodeEntries,
    format: ['esm'],
    dts: false,
    outDir: 'dist/esm/src',
    sourcemap: true,
    outExtension: () => ({ js: '.js' }), // Use .js instead of .mjs
    noExternal,
    external: ['@chainsafe/ssz', 'viem'],
    esbuildOptions(options) {
      options.platform = 'node';
    },
    onSuccess: markAsModule('dist/esm'),
  },
  // Browser ESM build
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: false,
    outDir: 'dist/browser/src',
    sourcemap: true,
    outExtension: () => ({ js: '.js' }),
    noExternal,
    external: ['@chainsafe/ssz', '@sinclair/typebox', 'viem'],
    esbuildOptions(options) {
      options.platform = 'browser';
      options.define = {
        'process.env': '{}',
        'global': 'globalThis'
      };
    },
    onSuccess: markAsModule('dist/browser'),
  },
]);
