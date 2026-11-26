// Runs the browser build (dist/browser) with no global `Buffer`, as Vite,
// Rollup, esbuild, workers and edge runtimes do, and prints what it computed.
// argv: <path to a lock JSON> [<path to a second lock JSON>]
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const locks = process.argv
  .slice(2)
  .map(p => JSON.parse(readFileSync(p, 'utf8')));

// Gone before the bundle (and its dependencies) are loaded, as in a browser:
// `Buffer.from(...)` is then a ReferenceError, and `globalThis.Buffer` (which
// some dependencies probe for) is undefined.
delete globalThis.Buffer;
if (typeof Buffer !== 'undefined') throw new Error('Buffer is still defined');

const sdk = await import(
  pathToFileURL(resolve('dist/browser/src/index.js')).href
);

const out = [];
for (const lock of locks) {
  const entry = { version: lock.cluster_definition.version };
  entry.configHash = sdk.cluster.computeConfigHash(lock.cluster_definition);
  entry.definitionHash = sdk.cluster.computeDefinitionHash(
    lock.cluster_definition,
  );
  entry.lockHash = sdk.cluster.computeLockHash(lock);
  entry.verification = await sdk.cluster.verifyLock(lock);
  entry.isValid = await sdk.isValidLock(lock);
  entry.enr = sdk.cluster.parseEnr(
    lock.cluster_definition.operators[0].enr,
  ).publicKey;
  try {
    const amounts = await sdk.deposits
      .fromLock(lock, { verify: false })
      .catch(e => e.details.available);
    const amount = Array.isArray(amounts)
      ? amounts[amounts.length - 1]
      : undefined;
    const { deposits } = await sdk.deposits.fromLock(lock, {
      ...(amount !== undefined ? { amount } : {}),
    });
    await sdk.deposits.assertDepositData(deposits, {
      chainId: 560048,
      expectedWithdrawalAddress:
        lock.cluster_definition.validators[0].withdrawal_address,
    });
    entry.deposits = deposits.length;
    entry.depositRoot = sdk.deposits.depositDataRoot({
      pubkey: deposits[0].pubkey,
      withdrawalCredentials: deposits[0].withdrawalCredentials,
      amountGwei: deposits[0].amount / 10n ** 9n,
      signature: deposits[0].signature,
    });
    entry.storedDepositRoot = deposits[0].depositDataRoot;
  } catch (e) {
    entry.depositsError = `${e.code}: ${e.message}`;
  }
  out.push(entry);
}
process.stdout.write(
  JSON.stringify({ bufferDefined: typeof Buffer !== 'undefined', locks: out }),
);
