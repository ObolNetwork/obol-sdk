import { defineConfig } from 'tsup';

export default defineConfig([
  // Node.js CJS build
  {
    entry: [
      'src/index.ts',
      'src/blsUtils.ts',
      'src/verification/lockWorker.ts',
      'src/verification/parallelPool.ts',
    ],
    format: ['cjs'],
    dts: false,
    outDir: 'dist/cjs/src',
    sourcemap: true,
    // Bundle ESM-only deps and @noble/curves (avoids ESM resolution issues in CJS consumers)
    noExternal: ['@chainsafe/enr', '@noble/curves', '@noble/hashes'],
    // Keep large or problematic dependencies external
    external: [
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
    entry: [
      'src/index.ts',
      'src/blsUtils.ts',
      'src/verification/lockWorker.ts',
      'src/verification/parallelPool.ts',
    ],
    format: ['esm'],
    dts: false,
    outDir: 'dist/esm/src',
    sourcemap: true,
    outExtension: () => ({ js: '.js' }), // Use .js instead of .mjs
    // Bundle ESM-only deps and @noble/curves
    noExternal: ['@chainsafe/enr', '@noble/curves', '@noble/hashes'],
    // Keep large or problematic dependencies external
    external: [
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
    // Bundle @chainsafe/enr (ESM-only) and @noble/curves (pure JS, safe to bundle)
    noExternal: ['@chainsafe/enr', '@noble/curves', '@noble/hashes'],
    // Externalize everything else
    external: [
      'ajv',
      'ajv-formats',
      'ajv-keywords',
      'cross-fetch',
      'elliptic',
      'semver',
      'uuid',
      'dotenv',
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
