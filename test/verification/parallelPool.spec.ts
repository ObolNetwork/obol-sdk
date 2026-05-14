// Public-API contract tests for the parallel pool helpers.
//
// IMPORTANT: jest runs from source, where dist/cjs/.../lockWorker.js does
// not exist, so getWorkerPath() returns null and these tests exercise the
// SYNC FALLBACK path. They catch:
//   - sync-fallback correctness regressions
//   - WorkerInput shape mismatches at compile time (since the pool now
//     uses the typed import)
//   - API contract drift (signature, return type)
//
// They do NOT catch worker-specific breakage (worker_threads pathing,
// structured-clone issues, etc). For that, run
//   node test/perf/parallelBench.mjs
// after `yarn build`. See PARALLEL_VALIDATION_PLAN.md.
import {
  verifySharesBinding,
  verifyBatchParallel,
} from '../../src/verification/parallelPool';
import {
  blsAggregateSignatures,
  blsVerifyMultiple,
} from '../../src/blsUtils';
import { bls12_381 } from '@noble/curves/bls12-381.js';

const ls = bls12_381.longSignatures;
const ETH2_DST = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_';

// Real shares from the v1.10 fixture (4 operators, threshold 3) — they
// already reconstruct to the corresponding DV key.
const SHARES = [
  '0xb6b24044bb78eae5801a41bb98ebda85d3210d08706e7a10ef42bebbf4505cd343d396ed10cdb1f63aa1ca9a850d97d7',
  '0x8c15903d870956aede8118806ab5bc36ed18bb3db7fc8fa86893e040c04f6322b9488e844882e0bc98df94dabb781e6a',
  '0x8d582fcac937895ca521a7f83cd43274656ea9b382eb5db2e096c3332c6488b56e5889456cabc5f56e0287d408146689',
  '0xa88805bb74b0a651a563c595fb6da9a561311894251db6dbf4ea21d2a5478becf8597dc1bb6bcb0c7129194540216b85',
];
const DK =
  '0xa47fefdb2d5c92bfd319463b83975744c29ba8a646b5c0306e5591c6646a49834c787c1ad6f6d9b031015e230bd0d1f5';
const THRESHOLD = 3;

describe('verifySharesBinding', () => {
  it('returns true for 50 valid validators (parallel threshold boundary)', async () => {
    const N = 50;
    const shares = Array.from({ length: N }, () => SHARES);
    const dks = Array.from({ length: N }, () => DK);
    expect(await verifySharesBinding(shares, dks, THRESHOLD)).toBe(true);
  });

  it('returns true for 100 valid validators', async () => {
    const N = 100;
    const shares = Array.from({ length: N }, () => SHARES);
    const dks = Array.from({ length: N }, () => DK);
    expect(await verifySharesBinding(shares, dks, THRESHOLD)).toBe(true);
  });

  it('returns false when shares do not reconstruct the DV key', async () => {
    const N = 50;
    // Reverse share order — same uniqueness, wrong polynomial positions,
    // so reconstruction yields a different key.
    const reversed = [...SHARES].reverse();
    const shares = Array.from({ length: N }, () => reversed);
    const dks = Array.from({ length: N }, () => DK);
    expect(await verifySharesBinding(shares, dks, THRESHOLD)).toBe(false);
  });

  it('returns false on length mismatch', async () => {
    expect(
      await verifySharesBinding([SHARES, SHARES], [DK], THRESHOLD),
    ).toBe(false);
  });

  it('returns true on empty input', async () => {
    expect(await verifySharesBinding([], [], THRESHOLD)).toBe(true);
  });
});

function buildCorpus(n: number): {
  pubkeys: Uint8Array[];
  messages: Uint8Array[];
  signatures: Uint8Array[];
} {
  const pubkeys: Uint8Array[] = [];
  const messages: Uint8Array[] = [];
  const signatures: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const seed = new Uint8Array(48);
    seed[0] = (i + 1) & 0xff;
    seed[1] = ((i + 1) >> 8) & 0xff;
    const sk = ls.keygen(seed).secretKey;
    // Point.toBytes() to keep things as Uint8Array — see lockWorker docs
    // for why this matters across worker boundaries.
    pubkeys.push((ls.getPublicKey(sk) as any).toBytes());
    const msg = new Uint8Array(32);
    msg[0] = i & 0xff;
    msg[1] = (i >> 8) & 0xff;
    messages.push(msg);
    signatures.push(
      ls.Signature.toBytes(ls.sign(ls.hash(msg, ETH2_DST), sk)),
    );
  }
  return { pubkeys, messages, signatures };
}

describe('verifyBatchParallel', () => {
  it('returns true for 100 valid (pubkey, message, sig) triples', async () => {
    const { pubkeys, messages, signatures } = buildCorpus(100);
    expect(await verifyBatchParallel(pubkeys, messages, signatures)).toBe(
      true,
    );
  });

  it('matches sync blsVerifyMultiple for the same input', async () => {
    const { pubkeys, messages, signatures } = buildCorpus(60);
    const aggSync = blsAggregateSignatures(signatures);
    expect(blsVerifyMultiple(pubkeys, messages, aggSync)).toBe(true);
    expect(await verifyBatchParallel(pubkeys, messages, signatures)).toBe(
      true,
    );
  });

  it('returns false when a message is changed (sig no longer matches its pair)', async () => {
    // Aggregate sig sum is commutative so swapping sigs is a no-op. We
    // mutate one message instead so the (pubkey, message) pair at that
    // position no longer matches the corresponding signature.
    const { pubkeys, messages, signatures } = buildCorpus(100);
    messages[0] = new Uint8Array(32).fill(0xaa);
    expect(await verifyBatchParallel(pubkeys, messages, signatures)).toBe(
      false,
    );
  });

  it('returns false on length mismatch', async () => {
    const { pubkeys, messages, signatures } = buildCorpus(5);
    expect(
      await verifyBatchParallel(pubkeys.slice(0, 4), messages, signatures),
    ).toBe(false);
  });

  it('returns true on empty input', async () => {
    expect(await verifyBatchParallel([], [], [])).toBe(true);
  });
});
