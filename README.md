![Obol Logo](https://obol.org/obolnetwork.png)

<h1 align="center">Obol SDK</h1>

TypeScript SDK for creating and managing Obol Distributed Validators: cluster definitions and locks, deposits,
Obol Validator Managers (OVM), splits, incentives and exits. Version 3 is built on [viem](https://viem.sh) and
replaces the 2.x `Client` (ethers) entirely; see the [CHANGELOG](CHANGELOG.md).

## Install

```bash
npm install @obolnetwork/obol-sdk viem
```

`viem@^2` is a peer dependency. Node 20+ (CommonJS or ESM) and browsers (ESM) are supported.

## Create a client

```typescript
import { createObolClient } from '@obolnetwork/obol-sdk';
import { createPublicClient, createWalletClient, custom, http } from 'viem';
import { hoodi } from 'viem/chains';

const publicClient = createPublicClient({ chain: hoodi, transport: http() });
const walletClient = createWalletClient({
  chain: hoodi,
  transport: custom(window.ethereum),
});

const obol = createObolClient({
  chain: hoodi, // mainnet or Hoodi; Gnosis and Sepolia for cluster files only
  publicClient,
  walletClient, // optional: needed for EIP-712 signatures and sends
  // api: false  // chain-only; the default is the Obol API at api.obol.tech
});
```

TypeScript with `module: commonjs` and `moduleResolution: node10` (a NestJS default): `viem/chains` pulls ox's `.ts`
sources into `tsc`, whose errors `skipLibCheck` does not hide. Use `moduleResolution: bundler`, or build the chain with
viem's `defineChain` (the SDK matches chains by `id`); see [MIGRATION.md](MIGRATION.md) "Verifying locks on a
server".

Every module is also exported as a namespace (`cluster`, `deposits`, `ovm`, `splits`, `setup`, `incentives`,
`exits`, `terms`, `withdrawals`, and `experimental` for `simulate` and `legacy`), so the pure functions (hashing, lock
verification, share math, exit aggregation) work without a client. Each module is also its own entry point, so a page
that needs one module loads only that one (a reads-only `ovm` import has no BLS or SSZ code):

```typescript
import { createObolContext, createOvmModule } from '@obolnetwork/obol-sdk/ovm';

const ovm = createOvmModule(createObolContext({ chain: hoodi, publicClient }));
const state = await ovm.getState(ovmAddress); // null when the address is not an OVM
```

## Prepare, then send

Writes are split in two. A `prepare*` operation runs every check, reads what it needs from the chain and the API,
and returns `Prepared` values: a `kind` (which operation), an encoded `request` (`to`, `data`, `value`, `chainId`),
non-blocking `checks` (findings with a `severity` and, when about one item, a `subject`), a `preview` typed by
`kind`, and the `blockNumber` it read (`isStale(prepared, head, maxAgeBlocks)` tells when to prepare again). Every
`preview*` operation returns `{ preview, checks, blockNumber }`. Nothing is sent until you pass it to `send`, or to your own wallet
layer (wagmi, a Safe, a relayer).

```typescript
const lock = await obol.cluster.getLock({ configHash });

// Verified deposits from the lock (amounts in wei).
const { deposits } = await obol.deposits.fromLock(lock);

// Checks credentials, signatures, OVM provenance and roles, and existing deposits.
const prepared = await obol.deposits.prepareDeposit({
  deposits: deposits ?? [],
  via: { ovm: ovmAddress },
});

for (const tx of prepared) {
  for (const finding of tx.checks) console.warn(finding.code, finding.message);
  const sent = await obol.send(tx);
  await sent.wait();
}
```

To show what a transaction will do before the user signs it, simulate it (experimental: the result shape may still
change). `simulate` runs the request on the node without sending it and returns the balance changes, gas, events,
state changes, plain-language `summary` lines and a comparison with the operation's own `preview`:

```typescript
const prepared = await obol.ovm.prepareDistribute({ ovm: ovmAddress });
const sim = await obol.experimental.simulate(prepared, { from: account });

if (!sim.success) throw new Error(sim.summary[0]); // "Reverts: Unauthorized()"
sim.summary.forEach(line => console.log(line));
// 0x1234…abcd (principal recipient) receives 32.000000 ETH
// 0x5678…ef01 (reward recipient) receives 1.200000 ETH
if (!sim.limited && !sim.matchesPreview.ok) console.warn(sim.matchesPreview.differences);

await obol.send(prepared);
```

It uses `eth_simulateV1` (geth, Nethermind, Erigon, Reth, anvil and most public RPCs), else `debug_traceCall`; on a
node with neither, the result is `limited` (success or revert only). A Safe is simulated as the Safe calling; its own
signature checks are not. Simulate just before sending: the state can change before the transaction is mined.

Failures throw `ObolError` (or `ObolApiError` for API responses) with a stable `code`, a `hint` and `details`:

```typescript
import { isObolError } from '@obolnetwork/obol-sdk';

try {
  await obol.deposits.fromLock(lock);
} catch (error) {
  if (isObolError(error, 'LOCK_INVALID')) {
    // do not deposit: error.details.step says which check failed (typed per code)
  }
}
```

### Lock verification

`cluster.verifyLock` runs on the calling thread and yields to the event loop every `yieldMs` (default 50), so pages
and servers stay responsive. `level: 'full'` (default) runs every check; `level: 'attested'` relies on the node
signatures over `lock_hash` for the BLS checks Charon ran during the DKG and checks the deposit signatures of the
validators you name, which is what `deposits.fromLock` does for the deposits it returns:

```typescript
const result = await obol.cluster.verifyLock(lock, { level: 'attested', signatures: [0, 1] });
// { ok: false, level: 'attested', step: 'deposit_data_invalid', issue: 'signature_invalid', validator: 1 }
```

BLS is pure JavaScript by default (about 25 ms per signature), which suits pages and scripts. Contract-wallet
(Safe) definition signatures are checked with EIP-1271 through a public client on the lock's chain: the bound client
uses its own; standalone calls take `publicClient` or `publicClients` (by chain id). Without one, such a signature
fails as `definition_signature_unverifiable`.

### Servers

A Node server that verifies locks from users (the Obol API does) should:

- call `isValidLock` (a boolean; `verifyLock` returns an object, always truthy) or check `verifyLock(...).ok`, and map
  `PAYLOAD_INVALID` (a malformed lock) to a 400;
- keep `level: 'full'` (the default). **Never `attested` on a server:** it skips share binding and the aggregate
  signature;
- pass the native BLS backend from `@obolnetwork/obol-sdk/blst` (install the optional peer `@chainsafe/blst`): a 1k
  validator lock at `full` takes about 1.3 s instead of 80 s of event-loop time;
- pass `publicClients` for every chain it serves, so Safe-created clusters verify (2.x had built-in RPCs; v3 has
  none);
- bound the CPU per request with `signal` (`AbortSignal.timeout(ms)`, or the request's own signal): the run stops at
  the next yield point with `ABORTED` (map it to a 503, not to "invalid"); racing the promise would leave the work
  running. Apply a concurrency limit around the call (there are no workers);
- warm the BLS backend at boot (`await loadBlstBackend()`): there is no fallback if the native binding fails to load
  (`BLS_BACKEND_UNAVAILABLE`), so fail the deploy rather than the first request.

```typescript
import { isValidLock } from '@obolnetwork/obol-sdk';
import { loadBlstBackend } from '@obolnetwork/obol-sdk/blst';

const bls = await loadBlstBackend(); // once; BLS_BACKEND_UNAVAILABLE if @chainsafe/blst is missing
const publicClients = { 1: mainnetClient, 560048: hoodiClient };

const ok = await isValidLock(lock, {
  bls,
  publicClients,
  signal: AbortSignal.timeout(10_000), // ABORTED after 10 s
});
if (!ok) throw new BadRequestException('Invalid lock');
```

`verifyTypedDataSignature({ address, signature, typedData, chainId?, publicClients })` checks an EIP-712 bearer
signature (an account by recovery, a Safe by EIP-1271), and `cluster.isValidEnr` / `cluster.parseEnr` validate ENRs.

## Specification

What each operation checks, reads and returns, every error and finding code, and the test vectors are in
[`spec/`](spec/README.md): [`operations.md`](spec/operations.md), [`errors.md`](spec/errors.md),
[`lifecycles.md`](spec/lifecycles.md), [`schemas/`](spec/schemas/) and [`vectors/`](spec/vectors/README.md). Moving
from 2.x, or from an earlier 3.0 release candidate: [MIGRATION.md](MIGRATION.md).

## Terms and Conditions

Creating a cluster definition or accepting an invite needs the [latest Obol terms and conditions](https://obol.org/terms.pdf)
accepted once per address: `obol.terms.hasAccepted()` and `obol.terms.accept()`.

## Security

- **API host:** `api.baseUrl` must be one of `https://api.obol.tech`, `https://obol-api-nonprod-dev.dev.obol.tech`
  or `https://obol-api-nonprod-qa.dev.obol.tech`, because EIP-712 signatures are sent to it as bearer tokens. Any
  other value throws `BASE_URL_INVALID`, except `http(s)://localhost[:port]` and `http(s)://127.0.0.1[:port]` with
  `api: { baseUrl, allowLocal: true }`, for a local obol-api.
- **Keys:** the SDK never sees private keys; it uses the viem `walletClient` you pass. Keep backend keys in a KMS or
  HSM and never commit them.

## Contributing

Report bugs and propose features in [Issues](https://github.com/ObolNetwork/obol-sdk/issues). For changes, fork the
repo, branch, and open a pull request with a clear description; every PR is reviewed before merge. Development
notes for humans and agents are in [AGENTS.md](AGENTS.md).
