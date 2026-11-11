import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { defineConfig } from 'tsup';

// The User-Agent's version (src/api.ts SDK_VERSION), from package.json.
const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as {
  version: string;
};
const define = { __OBOL_SDK_VERSION__: JSON.stringify(version) };

// The package has no "type" field, so Node reads `.js` as CommonJS. The ESM
// builds get their own package.json marking their `.js` files as modules and
// free of side effects (the nearest package.json decides both for bundlers)
// (no MODULE_TYPELESS_PACKAGE_JSON reparse warning). It sits one level above
// `src/` so it covers everything under the build directory.
const markAsModule = (dir: string) => async (): Promise<void> => {
  await mkdir(dir, { recursive: true });
  await writeFile(
    `${dir}/package.json`,
    `${JSON.stringify({ type: 'module', sideEffects: false }, null, 2)}\n`,
  );
};

// The root entry plus one per module (`@obolnetwork/obol-sdk/ovm`, ...).
// Code shared by several entries is split into chunks, so a reads-only
// import of `ovm` does not pull in the BLS or SSZ code, and every entry
// shares one copy of each class (`ObolError` keeps working with
// `instanceof` across entries). Lock verification runs on the calling thread
// (it yields to the event loop), so there is no worker bundle.
export const MODULE_ENTRIES = [
  'cluster',
  'deposits',
  'ovm',
  'splits',
  'setup',
  'incentives',
  'terms',
  'withdrawals',
  'exits',
  'experimental',
] as const;
const entries: Record<string, string> = {
  index: 'src/index.ts',
  ...Object.fromEntries(
    MODULE_ENTRIES.map(m => [`${m}/index`, `src/${m}/index.ts`]),
  ),
};
// Node only: the native BLS backend (`@obolnetwork/obol-sdk/blst`). It loads
// the optional peer @chainsafe/blst with a dynamic import, which stays
// external; no other entry imports this one.
const nodeEntries: Record<string, string> = {
  ...entries,
  'blst/index': 'src/blst/index.ts',
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
    splitting: true,
    sourcemap: true,
    noExternal,
    external: ['@chainsafe/blst', '@chainsafe/ssz', 'viem'],
    define,
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
    splitting: true,
    sourcemap: true,
    outExtension: () => ({ js: '.js' }), // Use .js instead of .mjs
    noExternal,
    external: ['@chainsafe/blst', '@chainsafe/ssz', 'viem'],
    define,
    esbuildOptions(options) {
      options.platform = 'node';
    },
    onSuccess: markAsModule('dist/esm'),
  },
  // Browser ESM build
  {
    entry: entries,
    format: ['esm'],
    dts: false,
    outDir: 'dist/browser/src',
    splitting: true,
    sourcemap: true,
    outExtension: () => ({ js: '.js' }),
    noExternal,
    external: ['@chainsafe/ssz', '@sinclair/typebox', 'viem'],
    define,
    esbuildOptions(options) {
      options.platform = 'browser';
      options.define = {
        ...options.define,
        'process.env': '{}',
        'global': 'globalThis'
      };
    },
    onSuccess: markAsModule('dist/browser'),
  },
]);
