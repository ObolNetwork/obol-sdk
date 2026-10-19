import { defineConfig } from 'tsup';

// The chunk worker is its own bundle next to the entry's internal/ tree:
// parallelPool's getWorkerPath looks for it at
// <dist>/{cjs,esm}/src/internal/verification/lockWorker.js.
const nodeEntries = {
  index: 'src/index.ts',
  'internal/verification/lockWorker': 'src/internal/verification/lockWorker.ts',
};

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
  },
]);
