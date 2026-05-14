// End-to-end bench for the two parallel paths in verifyDV:
//   1. share-binding (Lagrange + extras) via verifySharesBinding
//   2. batch BLS verify (deposit+builder pairings) via verifyBatchParallel
//
// Run after `yarn build`:
//   node test/perf/parallelBench.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { verifySharesBinding, verifyBatchParallel } = require(
  '../../dist/cjs/src/verification/parallelPool.js',
);
const {
  blsRecoverDistributedPubkeyFromShares,
  blsVerifyExtraShares,
  blsAggregateSignatures,
  blsVerifyMultiple,
} = require('../../dist/cjs/src/blsUtils.js');
const { fromHexString } = require('@chainsafe/ssz');
const { bls12_381 } = require('@noble/curves/bls12-381.js');
const ls = bls12_381.longSignatures;
const ETH2_DST = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_';

// ----- Real fixture-derived data for the share-binding bench -----
const SHARES = [
  '0xb6b24044bb78eae5801a41bb98ebda85d3210d08706e7a10ef42bebbf4505cd343d396ed10cdb1f63aa1ca9a850d97d7',
  '0x8c15903d870956aede8118806ab5bc36ed18bb3db7fc8fa86893e040c04f6322b9488e844882e0bc98df94dabb781e6a',
  '0x8d582fcac937895ca521a7f83cd43274656ea9b382eb5db2e096c3332c6488b56e5889456cabc5f56e0287d408146689',
  '0xa88805bb74b0a651a563c595fb6da9a561311894251db6dbf4ea21d2a5478becf8597dc1bb6bcb0c7129194540216b85',
];
const DK =
  '0xa47fefdb2d5c92bfd319463b83975744c29ba8a646b5c0306e5591c6646a49834c787c1ad6f6d9b031015e230bd0d1f5';
const THRESHOLD = 3;

function syncShares(shares, distributedKeys, threshold) {
  for (let i = 0; i < shares.length; i++) {
    const bytes = shares[i].map(s => fromHexString(s));
    const dk = fromHexString(distributedKeys[i]);
    const recovered = blsRecoverDistributedPubkeyFromShares(bytes, threshold);
    if (!recovered) return false;
    for (let j = 0; j < dk.length; j++) {
      if (recovered[j] !== dk[j]) return false;
    }
    if (!blsVerifyExtraShares(bytes, threshold, dk)) return false;
  }
  return true;
}

// ----- Synthetic real BLS keypairs/sigs for the batch-verify bench -----
// Important: noble's getPublicKey() returns a Point object (not Uint8Array),
// and Point's class prototype is stripped by structured clone when sent
// through workerData. So we explicitly call .toBytes() to keep everything
// as Uint8Array across the worker boundary.
function buildBatchCorpus(n) {
  const pubkeys = [];
  const messages = [];
  const signatures = [];
  for (let i = 0; i < n; i++) {
    const seed = new Uint8Array(48);
    seed[0] = (i + 1) & 0xff;
    seed[1] = ((i + 1) >> 8) & 0xff;
    const sk = ls.keygen(seed).secretKey;
    pubkeys.push(ls.getPublicKey(sk).toBytes());
    const msg = new Uint8Array(32);
    msg[0] = i & 0xff;
    msg[1] = (i >> 8) & 0xff;
    messages.push(msg);
    signatures.push(ls.Signature.toBytes(ls.sign(ls.hash(msg, ETH2_DST), sk)));
  }
  return { pubkeys, messages, signatures };
}

async function timed(label, fn) {
  const t0 = process.hrtime.bigint();
  const ok = await fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`${label.padEnd(50)} ${ms.toFixed(0).padStart(6)}ms  ok=${ok}`);
  return ms;
}

async function main() {
  console.log('\n=== Phase 1: share-binding (Lagrange + extras) ===\n');
  for (const N of [50, 200, 500]) {
    const shares = Array.from({ length: N }, () => SHARES);
    const dks = Array.from({ length: N }, () => DK);

    const sMs = await timed(`N=${N} sync`, () => syncShares(shares, dks, THRESHOLD));
    const pMs = await timed(`N=${N} verifySharesBinding`, () =>
      verifySharesBinding(shares, dks, THRESHOLD),
    );
    console.log(`  speedup: ${(sMs / pMs).toFixed(2)}×\n`);
  }

  console.log('\n=== Phase 2: batch BLS verify (deposit+builder pairings) ===\n');
  for (const N of [100, 400, 1000]) {
    // (real lock has 2× deposit+builder messages per validator; use N pairs directly)
    const { pubkeys, messages, signatures } = buildBatchCorpus(N);
    const sMs = await timed(`N=${N} sync (single verifyBatch)`, () =>
      blsVerifyMultiple(pubkeys, messages, blsAggregateSignatures(signatures)),
    );
    const pMs = await timed(`N=${N} verifyBatchParallel`, () =>
      verifyBatchParallel(pubkeys, messages, signatures),
    );
    console.log(`  speedup: ${(sMs / pMs).toFixed(2)}×\n`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
