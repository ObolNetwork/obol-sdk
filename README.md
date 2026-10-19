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
`exits`, `terms`, `withdrawals`, `legacy`), so the pure functions (hashing, lock verification, share math, exit
aggregation) work without a client.

## Prepare, then send

Writes are split in two. A `prepare*` operation runs every check, reads what it needs from the chain and the API,
and returns `Prepared` values: an encoded `request` (`to`, `data`, `value`, `chainId`), non-blocking `checks`
(findings with a `severity`) and a `preview`. Nothing is sent until you pass it to `send`, or to your own wallet
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

Failures throw `ObolError` (or `ObolApiError` for API responses) with a stable `code`, a `hint` and `details`:

```typescript
import { isObolError } from '@obolnetwork/obol-sdk';

try {
  await obol.cluster.verifyLock(lock);
} catch (error) {
  if (isObolError(error, 'LOCK_VERIFICATION_BUSY')) {
    // retry with backoff
  }
}
```

## Specification

What each operation checks, reads and returns, every error and finding code, and the test vectors are in
[`spec/`](spec/README.md): [`operations.md`](spec/operations.md), [`errors.md`](spec/errors.md),
[`lifecycles.md`](spec/lifecycles.md) and [`vectors/`](spec/vectors/README.md). A migration guide from 2.x follows.

## Terms and Conditions

Creating a cluster definition or accepting an invite needs the [latest Obol terms and conditions](https://obol.org/terms.pdf)
accepted once per address: `obol.terms.hasAccepted()` and `obol.terms.accept()`.

## Security

- **API host:** `api.baseUrl` must be one of `https://api.obol.tech`, `https://obol-api-nonprod-dev.dev.obol.tech`
  or `https://obol-api-nonprod-qa.dev.obol.tech`, because EIP-712 signatures are sent to it as bearer tokens. Any
  other value throws `INVALID_BASE_URL`.
- **Keys:** the SDK never sees private keys; it uses the viem `walletClient` you pass. Keep backend keys in a KMS or
  HSM and never commit them.

## Contributing

Report bugs and propose features in [Issues](https://github.com/ObolNetwork/obol-sdk/issues). For changes, fork the
repo, branch, and open a pull request with a clear description; every PR is reviewed before merge. Development
notes for humans and agents are in [AGENTS.md](AGENTS.md).
