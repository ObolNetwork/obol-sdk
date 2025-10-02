import { defineConfig } from 'tsup';

export default defineConfig([
  // CJS build
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
  // ESM build
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
]);

