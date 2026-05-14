// Microbench: confirms where time goes in pure-JS BLS for lock validation.
// Run: node test/perf/blsBench.mjs
import { bls12_381 } from '../../node_modules/@noble/curves/bls12-381.js';

const { longSignatures: ls, G1, fields: { Fr } } = bls12_381;
const ETH2_DST = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_';

function bench(name, fn) {
  const start = process.hrtime.bigint();
  fn();
  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
  console.log(`${name.padEnd(45)} ${elapsed.toFixed(1)}ms`);
  return elapsed;
}

// Setup: a real BLS keypair so verification is meaningful.
const skBytes = ls.keygen(new Uint8Array(48).fill(11)).secretKey;
const pk = ls.getPublicKey(skBytes);
const message = new Uint8Array(32).fill(7);
const messageHashed = ls.hash(message, ETH2_DST);
const sig = ls.sign(messageHashed, skBytes);

// Dummy share for G1 mul timing (real point, deterministic).
const sharePoint = G1.Point.BASE.multiply(Fr.create(987654321n));
const shareBytes = sharePoint.toBytes();

console.log('\n--- BLS hot-path microbench (single thread) ---\n');

// 1. G1 point multiplication (Lagrange building block)
const N_MULS = 5000;
const t1 = bench(`${N_MULS}× G1.Point.multiply(scalar)`, () => {
  for (let i = 0; i < N_MULS; i++) {
    sharePoint.multiply(Fr.create(BigInt(i + 1)));
  }
});
console.log(`  per op: ${(t1 / N_MULS * 1000).toFixed(1)}µs`);

// 2. fromBytes (deserialize + on-curve + subgroup check)
const N_DESER = 5000;
const t2 = bench(`${N_DESER}× G1.Point.fromBytes`, () => {
  for (let i = 0; i < N_DESER; i++) {
    G1.Point.fromBytes(shareBytes);
  }
});
console.log(`  per op: ${(t2 / N_DESER * 1000).toFixed(1)}µs`);

// 3. Single BLS verify (one pairing + extras)
const N_VERIFY = 200;
const t3 = bench(`${N_VERIFY}× ls.verify single`, () => {
  for (let i = 0; i < N_VERIFY; i++) {
    ls.verify(sig, messageHashed, pk);
  }
});
console.log(`  per op: ${(t3 / N_VERIFY).toFixed(1)}ms`);

// 4. Batch verify scaling — UNIQUE pairs (real-world)
for (const N of [50, 200, 500]) {
  const sks = Array.from({ length: N }, (_, i) => ls.keygen(new Uint8Array(48).fill(i + 20)).secretKey);
  const pks = sks.map(s => ls.getPublicKey(s));
  const msgs = Array.from({ length: N }, (_, i) => {
    const m = new Uint8Array(32);
    m[0] = i & 0xff;
    m[1] = (i >> 8) & 0xff;
    return ls.hash(m, ETH2_DST);
  });
  const sigs = msgs.map((m, i) => ls.sign(m, sks[i]));
  const aggSig = ls.Signature.toBytes(ls.aggregateSignatures(sigs));
  const items = pks.map((pk, i) => ({ publicKey: pk, message: msgs[i] }));
  const t = bench(`verifyBatch ${N} unique pairs`, () => {
    ls.verifyBatch(aggSig, items);
  });
  console.log(`  per pair: ${(t / N).toFixed(2)}ms`);
}

console.log('\n--- Estimated full validation cost ---\n');
console.log('For a 500-validator, 4-of-6 lock:');
const lagrangeCost = 500 * 4 * (1 + 2) * (t1 / N_MULS); // T*(1+(N-T)) muls per validator
console.log(`  Lagrange + extras: ${lagrangeCost.toFixed(0)}ms`);
const batchCost = (1000 * (t3 / N_VERIFY)) * 0.6; // batch is ~60% of N single verifies
console.log(`  blsVerifyMultiple (batched 1000 pairs, est): ${batchCost.toFixed(0)}ms`);
console.log(`  Aggregate sig + node sigs: <200ms`);
console.log(`  TOTAL est: ${(lagrangeCost + batchCost + 200).toFixed(0)}ms\n`);
