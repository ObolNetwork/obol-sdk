// End-to-end bench: sync vs parallel share-binding on a synthetic large lock.
// Uses the existing v1.10 fixture's shares replicated N times.
//
// Run after `yarn build`:
//   node test/perf/parallelBench.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { verifySharesBinding } = require('../../dist/cjs/src/verification/parallelPool.js');
const { fromHexString } = require('@chainsafe/ssz');

async function syncRecover(shares, distributedKeys, threshold) {
  const { blsRecoverDistributedPubkeyFromShares, blsVerifyExtraShares } =
    require('../../dist/cjs/src/blsUtils.js');
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

// Real shares + distributed key from the v1.10 fixture (4 operators, threshold 3).
const SHARES = [
  '0xb6b24044bb78eae5801a41bb98ebda85d3210d08706e7a10ef42bebbf4505cd343d396ed10cdb1f63aa1ca9a850d97d7',
  '0x8c15903d870956aede8118806ab5bc36ed18bb3db7fc8fa86893e040c04f6322b9488e844882e0bc98df94dabb781e6a',
  '0x8d582fcac937895ca521a7f83cd43274656ea9b382eb5db2e096c3332c6488b56e5889456cabc5f56e0287d408146689',
  '0xa88805bb74b0a651a563c595fb6da9a561311894251db6dbf4ea21d2a5478becf8597dc1bb6bcb0c7129194540216b85',
];
const DK = '0xa47fefdb2d5c92bfd319463b83975744c29ba8a646b5c0306e5591c6646a49834c787c1ad6f6d9b031015e230bd0d1f5';
const THRESHOLD = 3;

async function timed(label, fn) {
  const t0 = process.hrtime.bigint();
  const ok = await fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`${label.padEnd(40)} ${ms.toFixed(0).padStart(6)}ms  ok=${ok}`);
  return ms;
}

console.log('\n--- Sync vs parallel share-binding ---');
console.log('(parallel kicks in at N >= 50; smaller N falls back to sync)\n');

for (const N of [10, 50, 100, 200, 500]) {
  const shares = Array.from({ length: N }, () => SHARES);
  const dks = Array.from({ length: N }, () => DK);

  const syncMs = await timed(`N=${N.toString().padStart(3)} sync (inline loop)`,
    () => syncRecover(shares, dks, THRESHOLD));
  const poolMs = await timed(`N=${N.toString().padStart(3)} verifySharesBinding`,
    () => verifySharesBinding(shares, dks, THRESHOLD));

  if (N >= 50) {
    const speedup = (syncMs / poolMs).toFixed(2);
    console.log(`  speedup: ${speedup}×\n`);
  } else {
    console.log(`  (both sync; pool didn't spawn workers)\n`);
  }
}
