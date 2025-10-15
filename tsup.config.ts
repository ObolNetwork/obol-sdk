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
    // Also keep problematic TypeScript dependencies external
    external: [
      '@chainsafe/bls',
      '@chainsafe/blst',
      '@chainsafe/ssz',
      '@safe-global/protocol-kit',
      '@safe-global/types-kit',
      'ethers',                      // ← Very large (~2MB), consumers always have it
    ],
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
    // Also keep problematic TypeScript dependencies external
    external: [
      '@chainsafe/bls',
      '@chainsafe/blst',
      '@chainsafe/ssz',
      '@safe-global/protocol-kit',
      '@safe-global/types-kit',
      'ethers',                      // ← Very large (~2MB), consumers always have it
    ],
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
    // Only bundle @chainsafe/enr (ESM-only, breaks in CJS)
    noExternal: ['@chainsafe/enr'],
    // Externalize everything else - works like tsc
    external: [
      'ajv',
      'ajv-formats',
      'ajv-keywords',
      'cross-fetch',
      'elliptic',
      'semver',
      'uuid',
      'dotenv',
      '@chainsafe/bls',
      '@chainsafe/blst',
      '@chainsafe/ssz',
      '@metamask/eth-sig-util',
      '@safe-global/protocol-kit',
      '@safe-global/types-kit',
      'ethers'
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