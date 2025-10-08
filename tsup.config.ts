import { defineConfig } from 'tsup';

export default defineConfig([
  // Node.js CJS build
  {
    entry: ['src/index.ts'],
    format: ['cjs'],
    dts: false,
    outDir: 'dist/cjs/src',
    sourcemap: true,
    // Bundle ESM-only dependencies so they work in CJS
    noExternal: ['@chainsafe/enr'],
    // Keep @chainsafe/bls external - bundling breaks its WASM initialization
    external: ['@chainsafe/bls', '@chainsafe/blst'],
    esbuildOptions(options) {
      options.platform = 'node';
    },
  },
  // Node.js ESM build
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: false,
    outDir: 'dist/esm/src',
    sourcemap: true,
    outExtension: () => ({ js: '.js' }), // Use .js instead of .mjs
    // Bundle ESM-only dependencies
    noExternal: ['@chainsafe/enr'],
    // Keep @chainsafe/bls external - bundling breaks its WASM initialization
    external: ['@chainsafe/bls', '@chainsafe/blst'],
    esbuildOptions(options) {
      options.platform = 'node';
    },
  },
  // Browser ESM build
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: false,
    outDir: 'dist/browser/src',
    sourcemap: true,
    outExtension: () => ({ js: '.js' }),
    // Only bundle safe dependencies for browser
    noExternal: [
      '@chainsafe/enr',
      '@chainsafe/ssz',
      'ajv',
      'ajv-formats',
      'ajv-keywords',
      'cross-fetch',
      'elliptic',
      'semver',
      'uuid'
    ],
    // Externalize packages that have Node.js dependencies or are problematic in browser
    external: [
      'pdf-parse-debugging-disabled',
      'dotenv',
      '@chainsafe/bls',
      '@chainsafe/blst',
      '@metamask/eth-sig-util',
      '@safe-global/protocol-kit',
      '@safe-global/types-kit',
      'ethers' // User typically has this installed (large library)
    ],
    esbuildOptions(options) {
      options.platform = 'browser';
      options.define = {
        'process.env': '{}',
        'global': 'globalThis'
      };
    },
  },
]);

