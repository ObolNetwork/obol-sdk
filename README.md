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

BLS is pure JavaScript by default (about 25 ms per signature). A Node server can pass a native backend instead, for
example an adapter over `@chainsafe/blst` (the adapter is in the TSDoc of `BlsBackend`):

```typescript
import { blstBackend } from './blstBackend'; // your adapter; the SDK never imports a native module

await obol.cluster.verifyLock(lock, { bls: blstBackend }); // 1k validators, full: about 1 s instead of a minute
```

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
