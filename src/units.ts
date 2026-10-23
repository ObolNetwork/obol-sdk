import { invalid } from './schema.js';

export const GWEI = 1_000_000_000n;
export const ETH = 1_000_000_000_000_000_000n;
export const MAX_UINT64 = 2n ** 64n - 1n;

/** wei → gwei; PAYLOAD_INVALID (at `path`) if not a whole number of gwei. */
export const weiToGwei = (wei: bigint, path: string): bigint => {
  if (wei < 0n) throw invalid(path, 'must not be negative');
  if (wei % GWEI !== 0n) {
    throw invalid(path, 'must be a whole number of gwei', 'not_whole_gwei');
  }
  return wei / GWEI;
};

export const gweiToWei = (gwei: bigint): bigint => gwei * GWEI;
