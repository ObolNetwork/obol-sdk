/**
 * Byte helpers that need no `Buffer`: the browser build must not depend on a
 * global `Buffer` (Vite, Rollup, esbuild, workers and edge runtimes have
 * none; `.eslintrc.js` bans it in `src/`).
 */
const HEX: string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0'),
);

/** Lowercase hex of `bytes`, without a `0x` prefix. */
export const bytesToHex = (bytes: Uint8Array): string => {
  let out = '';
  for (const byte of bytes) out += HEX[byte];
  return out;
};

/** `0x`-prefixed lowercase hex of `bytes`. */
export const bytesTo0xHex = (bytes: Uint8Array): string =>
  `0x${bytesToHex(bytes)}`;
