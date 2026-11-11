# Migrating to obol-sdk 3

Version 3 is a rewrite on [viem](https://viem.sh). Nothing of the 2.x API is kept under the same name: this guide maps
each 2.x method to its v3 operation, then lists the breaking changes between the 3.0 release candidates. The contract
of every v3 operation (inputs, checks, outputs, error codes) is in [`spec/operations.md`](spec/operations.md).

- [From 2.x](#from-2x): client, cluster, terms, deposits, splits and OVM, incentives, exits, EOA, errors
  - [Verifying locks on a server](#verifying-locks-on-a-server) (obol-api)
  - [Every other 2.x export](#every-other-2x-export) (constants, types, helpers)
- [From 3.0.0-rc.3 to rc.4](#from-300-rc3-to-rc4)
- [From 3.0.0-rc.4 to rc.5](#from-300-rc4-to-rc5)
- [From 3.0.0-rc.5 to rc.6](#from-300-rc5-to-rc6)
- [From 3.0.0-rc.6 to rc.7](#from-300-rc6-to-rc7)
- [From 3.0.0-rc.7 to rc.8](#from-300-rc7-to-rc8)
- [From 3.0.0-rc.8 to rc.9](#from-300-rc8-to-rc9)
- [From 3.0.0-rc.9 to rc.10](#from-300-rc9-to-rc10)
- [From 3.0.0-rc.10 to rc.11](#from-300-rc10-to-rc11)
- [From 3.0.0-rc.11 to rc.12](#from-300-rc11-to-rc12) (breaking: six renames, `send` acknowledgements, `fromLock`, strict options)

## From 2.x

### What changes everywhere

- **viem instead of ethers.** Pass viem clients; the ethers `Signer` / `Provider` are gone. `viem@^2.27.0` is a
  peer dependency.
- **Prepare, then send.** A write no longer sends a transaction itself. `prepare*` checks everything and returns a
  `Prepared` (`kind`, `request`, `checks`, `preview`, `blockNumber`); `obol.send(prepared)` sends it, or your wallet
  layer sends `prepared.request`. `send` refuses a `Prepared` whose `checks` hold a warning until its code is passed
  in `acknowledge` (see [From 3.0.0-rc.11 to rc.12](#from-300-rc11-to-rc12)); 2.x had nothing like it.
- **Units.** ETH amounts are `bigint` wei everywhere (2.x mixed ETH strings, gwei and numbers). Shares are integer
  parts per million (`1_000_000` = 100%); `splits.percent('33.3333')` converts.
- **Errors.** One class, `ObolError` (`ObolApiError` for API answers), with a stable `code`; switch on it with
  `isObolError(error, code)`.

### Client

```typescript
// 2.x
import { Client } from '@obolnetwork/obol-sdk';
const client = new Client({ baseUrl, chainId: 560048 }, signer, provider);

// 3
import { createObolClient } from '@obolnetwork/obol-sdk';
import { createPublicClient, createWalletClient, custom, http } from 'viem';
import { hoodi } from 'viem/chains';

const obol = createObolClient({
  chain: hoodi,
  publicClient: createPublicClient({ chain: hoodi, transport: http() }),
  walletClient: createWalletClient({ chain: hoodi, transport: custom(window.ethereum) }),
  api: { baseUrl }, // optional; `false` for chain-only
});
```

### Every 2.x method

| 2.x | 3 |
|---|---|
| `client.hasAcceptedTerms()` | `obol.terms.hasAccepted(address?)` |
| `client.acceptObolLatestTermsAndConditions()` | `obol.terms.accept({ ifNotAccepted? })` |
| `client.createClusterDefinition(payload)` | `obol.cluster.prepareDefinition(input)` then `obol.cluster.create(prepared)` |
| `client.acceptClusterDefinition({ enr, version }, configHash)` | `obol.cluster.accept({ configHash, enr, version? })` |
| `client.getClusterDefinition(configHash)` | `obol.cluster.get(configHash)` |
| `client.getClusterLock(configHash)` | `obol.cluster.getLock({ configHash })` |
| `client.getClusterLockByHash(lockHash)` | `obol.cluster.getLock({ lockHash })` |
| `client.getDepositData(lock, options)` / `depositDataFromLock` | `obol.deposits.fromLock(lock, { amount?, validators? })`. `amount` (wei) is required when the lock has deposit data for several amounts, as Charon's default locks do (1 ETH and 32 ETH): `DEPOSIT_AMOUNT_REQUIRED` otherwise |
| `validateClusterLock(lock)` | `await isValidLock(lock, options?)` (boolean; also `cluster.isValidLock`, bound `obol.cluster.isValidLock`). **Not** a rename to `verifyLock`: see [Verifying locks on a server](#verifying-locks-on-a-server) |
| `client.createObolRewardsSplit(...)` | `obol.setup.prepareOvmWithSplits(obol.setup.rewardsSplit({ ... }))` |
| `client.createObolTotalSplit(...)` | `obol.setup.prepareOvmWithSplits(obol.setup.totalSplit({ ... }))` |
| `client.splits.createValidatorManagerAndRewardsSplit(...)` | `obol.setup.prepareOvmWithSplits(obol.setup.rewardsSplit({ ... }))` |
| `client.splits.createValidatorManagerAndTotalSplit(...)` | `obol.setup.prepareOvmWithSplits(obol.setup.totalSplit({ ... }))` |
| `client.splits.requestWithdrawal(...)` | `obol.ovm.prepareWithdraw({ ovm, requests, acknowledgeFullExit? })` |
| `client.splits.deposit(...)` | `obol.deposits.prepareDeposit({ deposits, via: { ovm } })`. For a validator that already exists pass `kind: 'topUp'`; `kind: 'deposit'` (the default) throws `DEPOSIT_VALIDATOR_EXISTS`, or `DEPOSIT_CONFLICT` when its credentials are someone else's |
| `client.getOWRTranches(owr)` | `obol.experimental.legacy.getOwrTranches(owr)` (any client chain, Gnosis and Sepolia included, since rc.6) |
| `client.eoa.requestWithdrawal(...)` | `obol.withdrawals.prepareEoaWithdraw({ pubkey, amount })` |
| `client.eoa.deposit(...)` | `obol.deposits.prepareDeposit({ deposits, via: { batch: true }, expectedWithdrawalAddress })` |
| `client.incentives.getIncentivesByAddress(address)` | `obol.incentives.get(address)` |
| `client.incentives.isClaimed(contract, index)` | `obol.incentives.isClaimed({ contractAddress, index })` |
| `client.incentives.preflightClaim(address)` | `obol.incentives.preflight(address)` |
| `client.incentives.claimIncentives(address)` | `obol.incentives.prepareClaim(address)` then `obol.send` |
| `client.exit.validateExitBlobs(clusterConfig, payload, beaconNodeApiUrl, existingBlob)` / `verifyPartialExitSignature` / `verifyExitPayloadSignature` | `obol.exits.assertPartialExit({ cluster, payload, existing })`. No beacon node URL: the genesis validators root comes from the SDK's chain table. A stored exit with **any** other epoch is `EXIT_EPOCH_MISMATCH` (2.x accepted a higher one); `details.direction` says which way, and the stored exit must be deleted before re-signing (see rc.12) |
| `client.exit.recombineExitBlobs(...)` | `obol.exits.aggregate({ validator, exit, threshold })` (threshold aggregation; 2.x summed the partials, which is not a valid exit signature) |
| `blsVerify(pubkey, message, signature)` (`Uint8Array`s) | `exits.blsVerify(pubkey, message, signature, { bls? })` with `Hex` strings (`bytesToHex` from viem). Throws `PAYLOAD_INVALID` on malformed input (not hex, wrong length) where 2.x returned `false`; a well-formed value that is not a valid point is still `false`. `bls` picks the backend (`await loadBlstBackend()` on a server; default pure JS) |
| `validateAddressSignature({ address, token, data, chainId })` | `await isValidTypedDataSignature({ address, signature: token, typedData: data, chainId, publicClients })`. A contract wallet (Safe) is checked only with a client for `chainId` (2.x used built-in RPCs); both the EIP-1271 magic `0x1626ba7e` and the legacy `isValidSignature(bytes, bytes)` → `0x20c13b0b` of Safes before 1.3.0 are accepted, as with 2.x's Safe protocol-kit (since rc.6). `data` may stay eth-sig-util's `TypedMessage` (since rc.6: a bytes `domain.salt` is converted to hex; rc.5 needed a cast). 2.x threw on a malformed `token`; v3 returns `false` |
| `validateEOASignature({ token, data, address })` | `await isValidTypedDataSignature({ address, signature: token, typedData: data })` (async; `false` instead of a throw for a malformed signature, as above) |
| `getWithdrawalRequestFee` / `resolveWithdrawalFee` | inside `prepareWithdraw` / `prepareEoaWithdraw` (`fee` input; `FEE_OUT_OF_RANGE`) |
| OWR / SplitMain creation | removed (reads of existing contracts stay under `experimental.legacy`) |

### Verifying locks on a server

2.x `validateClusterLock` returned a boolean. v3 `verifyLock` returns `{ ok, level, step?, issue?, validator? }`, an
object that is **always truthy**: renaming the call type-checks and accepts every lock.

```typescript
// 2.x (obol-api lock.service.ts)
const isValidLock = await validateClusterLock(dto);
if (!isValidLock) throw new BadRequestException('Invalid lock');

// 3: the drop-in
import { isValidLock } from '@obolnetwork/obol-sdk';
import { loadBlstBackend } from '@obolnetwork/obol-sdk/blst';

const bls = await loadBlstBackend(); // once, at startup (needs @chainsafe/blst installed)
const publicClients = { 1: mainnetClient, 560048: hoodiClient }; // or (chainId) => client
if (!(await isValidLock(dto, { bls, publicClients }))) {
  throw new BadRequestException('Invalid lock');
}

// 3: with the failing step, for logs or the error body
import { cluster, isObolError } from '@obolnetwork/obol-sdk';
try {
  const result = await cluster.verifyLock(dto, { level: 'full', bls, publicClients });
  if (!result.ok) throw new BadRequestException(`Invalid lock: ${result.step} (${result.issue})`);
} catch (error) {
  // A malformed lock throws PAYLOAD_INVALID where 2.x returned false: map it to a 400, not a 500.
  if (isObolError(error, 'PAYLOAD_INVALID')) throw new BadRequestException(error.details.issues);
  throw error;
}
```

- `isValidLock` runs `verifyLock` at `level: 'full'` and returns `result.ok`. It maps `PAYLOAD_INVALID` for the
  lock (a malformed lock) to `false`, as 2.x did; malformed *options* and any other error are thrown.
- **Use `level: 'full'` on a server, never `attested`.** `attested` skips share binding and `signature_aggregate`;
  it is for a depositor checking a lock it already trusts (`deposits.fromLock`). Do not drop to it to save CPU.
- **Pass a native BLS backend.** The default backend is pure JavaScript on the calling thread (about 25 ms per
  signature, so a 1k-validator lock at `full` is about 80 s of event-loop time; it yields, but throughput under load
  collapses). `@obolnetwork/obol-sdk/blst` ships the adapter over `@chainsafe/blst` (an optional peer dependency:
  `yarn add @chainsafe/blst`): `loadBlstBackend()`, or `blstBackendFrom(blst)` with a module you imported. The same
  lock takes about 1.3 s.
- **Contract-wallet signatures need a client per chain.** 2.x checked EIP-1271 signatures (Safe-created clusters)
  through built-in RPCs (`PROVIDER_MAP`); v3 has no RPCs of its own. Pass `publicClients` (by chain id, or a function
  of the chain id) so a server verifies locks of every chain it serves; `publicClient` alone is used for its own
  chain only. Without a client for the lock's chain, a definition signature that does not recover to its signer
  fails as `definition_signature_unverifiable` (not `definition_signature_invalid`), so the missing client shows.
  The same options apply to `verifyDefinition` (`signature_unverifiable`) and `isValidTypedDataSignature`.
- **Reuse the 2.x RPC settings for `publicClients`.** 2.x read `RPC_MAINNET`, `RPC_HOODI`, `RPC_GNOSIS` and
  `RPC_SEPOLIA` from the environment; v3 reads no environment variables, so build the clients from them:

  ```typescript
  import { createPublicClient, defineChain, http, type PublicClient } from 'viem';

  const RPCS: Record<number, string | undefined> = {
    1: process.env.RPC_MAINNET,
    560048: process.env.RPC_HOODI,
    100: process.env.RPC_GNOSIS,
    11155111: process.env.RPC_SEPOLIA,
  };
  const publicClients: Record<number, PublicClient> = {};
  for (const [id, url] of Object.entries(RPCS)) {
    if (url === undefined) continue;
    const chain = defineChain({
      id: Number(id),
      name: `chain-${id}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [url] } },
    });
    publicClients[chain.id] = createPublicClient({ chain, transport: http(url) }) as PublicClient;
  }
  ```

  `defineChain` rather than `viem/chains` here because of the TypeScript note below; a client is matched to a lock by
  its chain id only.
- **Bound the CPU per request with `signal`** (since rc.6): `isValidLock(dto, { bls, publicClients, signal:
  AbortSignal.timeout(10_000) })`. The run stops at its next yield point with `ABORTED` (`cause`: the signal's
  reason), so a slow or hostile lock cannot hold the thread; map `ABORTED` to a 503 (it says nothing about the lock).
  Racing the promise against a timer would leave the work running. `assertDepositData` takes `signal` too. There
  are no workers or concurrency limit (2.x `ClusterLockValidationTimeoutError` / `ClusterLockValidationBusyError`):
  apply a concurrency limit around the call.
- **Load blst at boot.** `@chainsafe/blst` 2.x ships prebuilt binaries for glibc and Alpine/musl Linux (x64,
  arm64), macOS and Windows, installed by npm or yarn as optional dependencies. If the binding does not load,
  `loadBlstBackend()` throws `BLS_BACKEND_UNAVAILABLE` and there is no fallback to the JS backend, so call it once
  at startup (and fail the deploy) rather than on the first request.
- **TypeScript with `module: commonjs` and `moduleResolution: node10`** (the NestJS default): importing
  `viem/chains` pulls ox's `.ts` sources into the compilation (viem 2.57.3 / ox 0.14.45), and their type errors
  (TS2589 and others) are not hidden by `skipLibCheck`, which skips `.d.ts` files only. `import ... from 'viem'`
  is fine. Either build the chains with `defineChain` (as above), or move to `moduleResolution: bundler` (with
  `module: esnext` / `preserve`, for a bundled build). `node16` / `nodenext` with CommonJS output does not help:
  viem's types are ESM there, so `import ... from 'viem'` itself fails with TS1479.

### Every other 2.x export

The 2.x root re-exported its constants, types and helpers. Each one used by Launchpad or the Obol API maps as follows.

| 2.x | 3 |
|---|---|
| `ENR` (`@chainsafe/enr`): `ENR.decodeTxt(enr)` to validate, `.publicKey` | `cluster.isValidEnr(enr)` (boolean), `cluster.parseEnr(enr).publicKey` (compressed key as `0x`-prefixed hex; 2.x code that did `Buffer.from(publicKey).toString('hex')` got it without the prefix, so drop or add `0x` where it is compared or stored; `PAYLOAD_INVALID` for a bad record). For other fields, import `@chainsafe/enr` yourself |
| `clusterLockHash(lock)` (obol-api `lock-definition-backfill.ts`) | `cluster.computeLockHash(lock)`. Decodes the lock first (`PAYLOAD_INVALID` for a malformed one) and throws `DEFINITION_INVALID` (`version_unsupported`) for a version the SDK does not implement, v1.9.0 included |
| `verifyDepositData(pubkey, depositData, withdrawalAddress, forkVersion)` and the like | `await deposits.assertDepositData(deposits, { chainId, expectedWithdrawalAddress?, kind?, bls?, signal? })`: resolves or throws `DEPOSIT_INVALID` with the failing `index` and `issue` (no boolean) |
| `clusterConfigOrDefinitionHash(definition, true)` / `(definition, false)` | `cluster.computeConfigHash(definition)` / `cluster.computeDefinitionHash(definition)`. Both decode the definition first and throw `PAYLOAD_INVALID` for a malformed one (map it to a 400); a mongoose document is accepted as it is |
| `signCreatorConfigHashPayload({ creator_config_hash }, chainId)` | `cluster.creatorConfigHashTypedData(configHash, chainId)` (viem typed data: no `EIP712Domain` in `types`, same hash) |
| `signOperatorConfigHashPayload`, `signEnrPayload` | `cluster.operatorConfigHashTypedData(configHash, chainId)`, `cluster.enrTypedData(enr, chainId)` |
| `validateAddressSignature`, `validateEOASignature` | `isValidTypedDataSignature` (see the method table) |
| `SPLITS_V2_SALT` | `splits.DEFAULT_SPLIT_SALT` (same value) |
| `PRINCIPAL_THRESHOLD` (`16`, ETH as a number) | `setup.DEFAULT_PRINCIPAL_THRESHOLD` (`16n * 10n ** 18n`, wei as a bigint); `MIN_` / `MAX_PRINCIPAL_THRESHOLD` next to it |
| `CHAIN_CONFIGURATION[chainId].BATCH_DEPOSIT_CONTRACT.address` (and the other contracts) | `getObolChain(chainId).contracts?.batchDeposit` (`CHAINS`, `ChainContracts`: `ovmFactory`, `warehouse`, `withdrawalRequest`, ...) |
| type `ClusterValidator` | `cluster.ClusterValidator` (same fields: `fee_recipient_address`, `withdrawal_address`) |
| type `ClaimableIncentives` (`operator_address`, `amount: string`, `merkle_proof`, ...) | `incentives.Incentives` (`operatorAddress`, `contractAddress`, `index`, `amount: bigint`, `merkleProof`), from `obol.incentives.get` |
| `Client` | `createObolClient` (see [Client](#client)) |
| `ClusterLockValidationTimeoutError`, `ClusterLockValidationBusyError` | none (see [Errors](#errors)) |

### Cluster definitions and locks

```typescript
// 2.x
const configHash = await client.createClusterDefinition({ name, operators, validators });
await client.acceptClusterDefinition({ enr, version: 'v1.10.0' }, configHash);
const lock = await client.getClusterLock(configHash);

// 3 (operators: { address }[]; validators: { feeRecipientAddress, withdrawalAddress }[])
const prepared = obol.cluster.prepareDefinition({ name, operators, validators, creator });
const configHash = await obol.cluster.create(prepared);       // signs with the walletClient
await obol.cluster.accept({ configHash, enr });               // as an operator
for await (const event of obol.cluster.watch(configHash, { signal })) {
  if (event.type === 'lock_published') break;
}
const lock = await obol.cluster.getLock({ configHash });
```

### Deposits

```typescript
// 2.x
const { deposits } = await client.getDepositData(lock);
await client.splits.deposit({ ovmAddress, deposits });

// 3
import { parseEther } from 'viem';

// Verifies the lock first. `amount` picks one of the lock's deposit amounts (Charon's default locks have 1 ETH
// and 32 ETH per validator; without it such a lock throws DEPOSIT_AMOUNT_REQUIRED).
const { deposits } = await obol.deposits.fromLock(lock, { amount: parseEther('32') });
const txs = await obol.deposits.prepareDeposit({ deposits, via: { ovm: ovmAddress } });
// A transaction with a warning in tx.checks is refused until its code is acknowledged (rc.12).
for (const tx of txs) await (await obol.send(tx)).wait();
```

### OVM and splits

```typescript
// 2.x
await client.createObolRewardsSplit({ splitRecipients, principalRecipient, ... });

// 3
const input = obol.setup.rewardsSplit({ recipients, principalRecipient, owner }); // shares in ppm, summing to 990_000
const prepared = await obol.setup.prepareOvmWithSplits(input);
const receipt = await (await obol.send(prepared)).wait();
const { ovm } = obol.setup.ovmFromReceipt(receipt);

// Withdraw (a full exit needs the acknowledgement):
await obol.send(await obol.ovm.prepareWithdraw({ ovm, requests: [{ pubkey, amount: 0n }], acknowledgeFullExit: true }));
// Distribute the OVM, its splits and the recipients' Warehouse balances in one transaction:
await obol.send(await obol.splits.prepareDistributeAll({ ovm }));
```

#### Split creation inputs (Launchpad)

2.x `client.splits.createValidatorManagerAndRewardsSplit` / `...AndTotalSplit` (and `createObolRewardsSplit` /
`createObolTotalSplit`) map to the presets `setup.rewardsSplit` / `setup.totalSplit`, whose result goes to
`setup.prepareOvmWithSplits`:

| 2.x input | 3 preset input |
|---|---|
| `OVMOwnerAddress` | `owner` |
| `splitOwnerAddress` | `splitOwner` (default the zero address: an immutable split) |
| `principalRecipient` | `principalRecipient` (`rewardsSplit` only) |
| `rewardSplitRecipients: { address, percentAllocation }[]` (percent as a number, summing to 99) | `recipients: { address, share }[]`: integer parts per million, summing to exactly `990_000`. `splits.percent('49.5')` gives `495_000n`; no float tolerance |
| `principalSplitRecipients` (`...AndTotalSplit`) | `principalRecipients` (optional; shares summing to `1_000_000`, no RAF). Leave it out for "Split Everything" |
| `distributorFeePercent` (a percent, at most 6.5535) | `distributionIncentive` (parts per million, an integer in `[0, 65535]`: 1% is `10_000`) |
| `principalThreshold` (ETH as a number, `PRINCIPAL_THRESHOLD = 16`) | `principalThreshold` (wei as a bigint; default `setup.DEFAULT_PRINCIPAL_THRESHOLD`, 16 ETH) |
| `etherAmount`, `recoveryAddress`, `controllerAddress`, `validatorsSize` (OWR / SplitMain) | removed with OWR and SplitMain creation |
| result `{ withdrawal_address, fee_recipient_address }` | none returned: the transaction is not sent by the SDK. After `send(...).wait()`, `setup.ovmFromReceipt(receipt).ovm` is the withdrawal address; the fee recipient is the reward split, `prepared.preview.rewardRecipient.address` (known before sending) |

- **The presets add the Obol RAF share (1%) themselves.** Pass the recipients *without* the RAF recipient, with
  shares summing to `990_000`: the preset adds `chain.contracts.rafRecipient` with `10_000`. Passing the RAF address
  as a recipient is `PAYLOAD_INVALID` (`duplicate_address`).
- **"Split Everything" is computed by `totalSplit`.** Without `principalRecipients`, each reward recipient gets its
  share plus `floor(10_000 / n)` of the principal, and the remainder goes to the first recipient in address order.
  The Launchpad computes this by hand today (`pages/confirm-configuration.tsx`: `percentAllocation + 1 / n`); a
  straight port of that code on top of `totalSplit` would add the 1% twice and fail the sum check. Delete it and
  pass the reward recipients only.
- `setup.prepareOvmWithSplits` and `splits.prepareCreateSplit` called directly add no RAF share: shares there sum to
  `1_000_000` and the caller decides who is in them.
- Recipients are checked more strictly than in 2.x: the zero address, the chain's own contracts (Warehouse,
  factories, deposit and request contracts) and the split's own address are refused (rc.12).

### Incentives

```typescript
// 2.x
const result = await client.incentives.claimIncentives(address); // { txHash } or { txHash: null }

// 3
try {
  await obol.send(await obol.incentives.prepareClaim(address));
} catch (error) {
  if (isObolError(error, 'ALREADY_CLAIMED')) { /* nothing to do */ }
}
```

### Exits

```typescript
// 2.x
const blobs = await client.exit.validateExitBlobs(clusterConfig, payload, beaconNodeApiUrl, existing);
const signed = await client.exit.recombineExitBlobs(existing);

// 3: the API's own formats, passed as received and stored
const fresh = obol.exits.assertPartialExit({ cluster, payload, existing: storedBlobs });
const full = obol.exits.aggregate({ validator, exit: storedBlob, threshold });
```

### Errors

| 2.x class | 3 code |
|---|---|
| `PayloadValidationError`, `InvalidArgumentError` | `PAYLOAD_INVALID` (`details.issues`) |
| `UnsupportedChainError` | `UNSUPPORTED_CHAIN` |
| `ChainMismatchError` | `CHAIN_MISMATCH` |
| `SignerRequiredError` | `WALLET_REQUIRED` |
| `InvalidBaseUrlError` | `BASE_URL_INVALID` |
| `DefinitionVerificationError` | `DEFINITION_INVALID` |
| `NotAnOperatorError` | `ACCOUNT_NOT_OPERATOR` |
| `IncentivesPreflightError` | `INCENTIVES_PREFLIGHT_FAILED` |
| `DepositConflictError` (2.16) | `DEPOSIT_CONFLICT` (`details.existing`: `queued` or `validator`), `DEPOSIT_VALIDATOR_EXISTS` |
| `ValidationError`, `UnauthorizedError`, `NotFoundError`, `ConflictError`, `RateLimitError`, `RequestTimeoutError` | `API_VALIDATION`, `API_UNAUTHORIZED`, `API_NOT_FOUND`, `API_CONFLICT`, `API_RATE_LIMIT`, `API_TIMEOUT` |
| `TransactionSubmissionError` | `TX_REVERTED`, `TX_UNCONFIRMED` (from `wait`) |
| `ClusterLockValidationTimeoutError`, `ClusterLockValidationBusyError` | `ABORTED` for a deadline: pass `signal` (e.g. `AbortSignal.timeout(ms)`) to `verifyLock` / `isValidLock` (since rc.6). No busy error: `verifyLock` yields instead of using workers; a server applies its own concurrency limit around the call |

The full list, with what to do for each, is [`spec/errors.md`](spec/errors.md).

## From 3.0.0-rc.3 to rc.4

rc.4 freezes the public shape before 3.0. Every change below breaks a call site written against rc.3.

### Shapes

```typescript
// Previews: one shape for every preview*
// rc.3: const { distributable, blockNumber } = await obol.ovm.previewDistribute({ ovm });
// rc.4
const { preview, checks, blockNumber } = await obol.ovm.previewDistribute({ ovm });
preview.distributable;
// splits.previewDistributeAll: preview.blockNumber is gone (use the top-level blockNumber).

// Prepared has a kind: narrow without guessing at the preview's shape
const p: AnyPrepared = await obol.splits.prepareDistributeAll({ ovm });
if (p.kind === 'distributeAll') p.preview.recipients;

// Typed errors
if (isObolError(error, 'TX_UNCONFIRMED')) watch(error.details.hash); // typed, no cast
```

### Renames

| rc.3 | rc.4 |
|---|---|
| `ovm.prepareSetBeneficiary({ newBeneficiary })` | `ovm.prepareSetPrincipalRecipient({ newPrincipalRecipient })` |
| `ovm.prepareTransfer({ newBeneficiary, newOwner })` | `ovm.prepareTransfer({ newPrincipalRecipient, newOwner })` |
| `ovm.prepareSweep({ beneficiary })` | `ovm.prepareSweep({ to })` |
| `obol.simulate(...)` | `obol.experimental.simulate(...)` (result `gasUsed` → `gas.used`, plus `gas.estimatedFee`) |
| `obol.legacy.getOwrTranches(...)` | `obol.experimental.legacy.getOwrTranches(...)` |
| distribution row `toWallet` | `fromThisDistribution` + `alreadyWaiting` (and `withdraw` / `skipReason`) |
| codes `INVALID_BASE_URL`, `NOT_AN_OPERATOR`, `NOT_OVM_OWNER` | `BASE_URL_INVALID`, `ACCOUNT_NOT_OPERATOR`, `OVM_OWNER_REQUIRED` |
| `ROLE_TO_PUBLIC_FORWARDER`, `OWNER_TO_PUBLIC_FORWARDER`, `RECIPIENT_IS_PUBLIC_FORWARDER` | `PUBLIC_FORWARDER_AS_ROLE_HOLDER`, `PUBLIC_FORWARDER_AS_OWNER`, `PUBLIC_FORWARDER_AS_RECIPIENT` |
| `INVALID_INCENTIVES_DATA`, `UNKNOWN_DISTRIBUTOR`, `UNEXPECTED_TOKEN`, `INVALID_PROOF` | `INCENTIVES_DATA_INVALID`, `DISTRIBUTOR_UNKNOWN`, `TOKEN_MISMATCH`, `PROOF_INVALID` |
| `EXIT_EPOCH_REGRESSION` | `EXIT_EPOCH_MISMATCH` (any different epoch) |
| warnings `WITHDRAW_PARTIAL_REQUIRES_COMPOUNDING`, `WITHDRAW_CREDENTIALS_NOT_OVM` / `_NOT_SENDER`, `WITHDRAW_VALIDATOR_NOT_ACTIVE`, `CONSOLIDATION_TARGET_NOT_COMPOUNDING` | errors `PARTIAL_REQUIRES_COMPOUNDING`, `CREDENTIALS_NOT_SOURCE`, `VALIDATOR_NOT_ACTIVE`, `CONSOLIDATION_TARGET_NOT_COMPOUNDING` |

### Behaviour

- `splits.getSplit` returns `null` for an address that is not a split (was `SPLIT_NOT_FOUND`); `ovm.getState` returns
  `null` for an address that is not an OVM (was `OVM_READ_FAILED`). Both still throw when the read fails.
- `principalOnBeaconChain` is `null` when the API was asked and had no value, absent with `api: false`.
- `ovm.getValidators` entries always have `lockHash`, `beaconStatus` and `balance` (`null` when unknown).
- `prepareDistributeAll` withdraws for the Obol RAF address by default; pass `includeRaf: false` to leave it.
- `prepareWithdraw`, `prepareEoaWithdraw` and `prepareConsolidate` refuse requests the beacon chain would ignore (see
  `spec/errors.md` "Withdrawal and consolidation requests") and cap partial amounts to the excess balance.
- `splits.percent` returns a `bigint`; `SPLITS_SCALE` and `RAF_SHARE` are `bigint`.
- Inputs take plain `string` for hex and addresses: drop the `` as `0x${string}` `` casts.
- Exits use the Obol API formats (snake_case): `PartialExitsPayload`, `StoredExitBlob`, `FullExitResponse`,
  `FullExitBlob`; `exits.aggregate({ validator, exit, threshold })`.
- Module namespaces export the documented API only (`ovm.readOvmCore`, `requestAmountGwei`, schema constants and the
  context-taking functions are gone): use the client, or `create<Module>Module(createObolContext(config))` from a
  module entry such as `@obolnetwork/obol-sdk/ovm`.
- Lock verification follows Charon more closely (a new `definition_invalid` step; 65-byte node signatures; canonical
  point encodings); a lock Charon would refuse is refused.

## From 3.0.0-rc.4 to rc.5

rc.5 is additive except for the two changes below.

- `verifyLock` reports a definition signature it could not check as `definition_signature_unverifiable` (new step):
  one that does not recover to its signer, when no client for the lock's chain was given to ask a contract wallet
  (EIP-1271). rc.4 reported `definition_signature_invalid`. `verifyDefinition` (and `cluster.accept`'s
  `DEFINITION_INVALID`) reports `signature_unverifiable` the same way. A signature known to be invalid (with a
  client: the signer is an account, or the contract refuses it) is still `definition_signature_invalid`.
- `send` passes the client's viem chain to `sendTransaction` (was `walletClient.chain ?? null`), so viem re-checks
  the wallet chain at send time; a wallet that switched after the check is `CHAIN_MISMATCH` (was sent, or
  `TX_REJECTED`).

New: `isValidLock`, `publicClients` on `verifyLock` / `verifyDefinition`, `isValidTypedDataSignature`,
`cluster.parseEnr` / `cluster.isValidEnr`, the `cluster.ClusterValidator` type, and the
`@obolnetwork/obol-sdk/blst` entry (`loadBlstBackend`, `blstBackendFrom`).

## From 3.0.0-rc.5 to rc.6

rc.6 is additive, but needs the obol-api deposit-status answer with queued deposit signatures (obol-api #1047) for its
new checks, and asks that route for at most 500 pubkeys per request (the updated API's limit; rc.5 asked for 1000).

- `deposits.status` entries from the Obol API carry `signaturesPending`, `credentialsConflict` and, per queued
  deposit, `signatureValid`. A queue-only pubkey's `withdrawalCredentials` are the first validly signed deposit's
  once every deposit before it is checked, so they can be set while `signaturesPending` is still true (later
  deposits are top-ups); absent while an unchecked deposit comes first, or when none is valid. While an entry is
  pending, `deposits.status` re-reads its batch (`pendingRetry`, default 3 requests over about two slots), then
  returns it pending.
- `prepareDeposit` throws `STATUS_UNAVAILABLE` with `reason: "signatures_pending"` for a queue-only pubkey still
  pending after the retries whose credentials are undecided (retry later); with decided credentials it proceeds,
  counting the still-unchecked later deposits as possibly valid for `DEPOSIT_CONFLICT`. It skips queued deposits
  with an invalid signature, and on
  `credentialsConflict` throws `DEPOSIT_CONFLICT` only when this deposit's credentials differ from the first validly
  signed one's (else the new warning `QUEUED_CREDENTIALS_CONFLICT`).

Also in rc.6 (additive):

- `isValidTypedDataSignature` and the definition signature checks (`verifyLock`, `verifyDefinition`) also accept the
  legacy EIP-1271 `isValidSignature(bytes, bytes)` → `0x20c13b0b` of Safes before 1.3.0 (the 32-byte EIP-712 hash
  as `data`), as 2.x did through Safe protocol-kit. `isValidTypedDataSignature` takes eth-sig-util's `TypedMessage`
  as it is (a bytes `domain.salt` is converted to hex).
- `signal?: AbortSignal` on `verifyLock`, `isValidLock` and `assertDepositData`: checked at every yield point; an
  abort throws the new code `ABORTED` (`cause`: the signal's reason). `isValidLock` throws it, never `false`.
- `exits.blsVerify(pubkey, message, signature, { bls })` verifies with the given backend (blst on a server).
- `experimental.legacy.getOwrTranches` works on any client chain (was mainnet / Hoodi only: `UNSUPPORTED_CHAIN` on
  Gnosis and Sepolia).

## From 3.0.0-rc.6 to rc.7

No API changes. Three behaviour changes:

- `ovm.getProvenance` returns `notObol` (source `chain`, reason "The contract does not answer the OVM getters") for a
  contract that does not answer the OVM getters, when the API gives no verdict, instead of scanning the factory logs
  (which on a public RPC could take long or end `unknown`). It never concludes `obol` that way.
- `ovm.getProvenance` takes only `obol` from the API OVM record; a `notObol` there (possibly cached before the OVM was
  deployed or indexed) is checked on the chain, so a just-deployed OVM is no longer `notObol` / api.
- A Multicall3 read pinned to a block that the RPC refuses (a non-archive node, or a load balancer whose backends lag
  each other) is retried once at `latest`, so `ovm.getRoleHolders`, `getState` and the OVM writes no longer fail with
  `CHAIN_READ_FAILED` on such RPCs.

## From 3.0.0-rc.7 to rc.8

No API changes. Log scans (`ovm.getProvenance`, `ovm.getRoleHolders`, `splits.getSplit`) start at 10,000-block windows instead
of 50,000 and double after each round that works, up to 50,000, never back to a size the RPC refused. On an RPC that
caps the range and is slow to refuse (eRPC takes about 28 s), a scan pays at most one refused round per client instead
of one per halving. If you pass viem's `fallback()` transport, let a log-range refusal throw instead of failing over
(its `shouldThrow`); otherwise the scan only sees the next transport's error and cannot shrink its window.

## From 3.0.0-rc.8 to rc.9

No API changes. Requests to the Obol API send `Content-Type: application/json` only when they have a body, so a
browser's cross-origin GET is a simple request (no CORS preflight). In Node they also send
`User-Agent: obol-sdk/<version>`; browsers send their own. A header you pass in the request still wins.

## From 3.0.0-rc.9 to rc.10

- `prepareDefinition` without `targetGasLimit` now sets 200,000,000 (was 36,000,000), the `charon create cluster`
  default. Pass `targetGasLimit` to keep the old value; the default is part of the `config_hash`.
- `ObolApiError` gains `requestId` and `retryAfterSeconds` (also in `details`). Quote `requestId` when reporting a
  problem with the Obol API, and wait `retryAfterSeconds` before retrying an `API_RATE_LIMIT`. In a browser both
  need the API to expose the headers (`Access-Control-Expose-Headers`).
- Deposit data whose pubkey or withdrawal credentials have the wrong length is now rejected (`PAYLOAD_INVALID`, or
  a failed verification result) rather than hashed after zero-padding or truncation.

## From 3.0.0-rc.10 to rc.11

- `cluster.prepareDefinition` creates only v1.10.0 and v1.11.0 definitions: `version` `v1.6.0`, `v1.7.0` or `v1.8.0`
  is now `PAYLOAD_INVALID` (path `version`). Those versions sign less of the definition and the Obol API rejects them
  for new clusters. `computeConfigHash`, `verifyDefinition` and `verifyLock` still accept them for existing clusters.

## From 3.0.0-rc.11 to rc.12

rc.12 fixes the findings of the pre-release review and settles the names before 3.0.0. Renames (0) and four
changes (1 to 4) break call sites written against rc.11; the rest change behaviour (stricter checks) without
changing a signature.

### 0. Renames

Six names change so that a name says what the operation does with a problem (README "Naming"): `verify*` returns a
result, `isValid*` a boolean, `assert*` throws, `get*` reads. No aliases are kept.

| rc.11 | rc.12 | Also renamed |
|---|---|---|
| `ovm.verify(ovm)` | `ovm.getProvenance(ovm, { requireChain? })` | type `OvmVerification` → `OvmProvenance`; new `OvmProvenanceOptions`. It reads where a contract came from; it never was a verifier of untrusted input |
| `splits.prepareDistribution(input)` | `splits.prepareDistributeAll(input)` | `Prepared` kind `'distribution'` → `'distributeAll'`; types `DistributionPreview` → `DistributeAllPreview`, `DistributionInput` → `DistributeAllInput`. It distributes the OVM, its splits and the recipients' Warehouse balances; `ovm.prepareDistribute` is the OVM alone |
| `splits.previewDistribution(input)` | `splits.previewDistributeAll(input)` | |
| `setup.prepareCreateSplit(input)` | `splits.prepareCreateSplit(input)` | The alias is removed; `setup` no longer re-exports `CreateSplitInput` / `CreateSplitPreview` (they are in `splits`) |
| `deposits.verifyDepositData(deposits, options)` | `deposits.assertDepositData(deposits, options)` | type `VerifyDepositDataOptions` → `AssertDepositDataOptions`. It throws `DEPOSIT_INVALID`; it never returned a verdict |
| `exits.verifyPartialExit(input)` | `exits.assertPartialExit(input)` | type `VerifyPartialExitInput` → `AssertPartialExitInput`. It throws `EXIT_*` and returns the blobs to store |
| `verifyTypedDataSignature(args)` (also `cluster.verifyTypedDataSignature`) | `isValidTypedDataSignature(args)` | It returns a boolean, like `isValidLock` |

```typescript
// rc.11
//   const provenance = await obol.ovm.verify(ovm);
//   const tx = await obol.splits.prepareDistribution({ ovm });
//   if (tx.kind === 'distribution') ...
// rc.12
const provenance = await obol.ovm.getProvenance(ovm);
const tx = await obol.splits.prepareDistributeAll({ ovm });
if (tx.kind === 'distributeAll') tx.preview.recipients;
```

`cluster.verifyLock` and `cluster.verifyDefinition` keep their names: they return a result. The JSON schemas in
`spec/schemas/` follow (`deposits.assertDepositData.json`, `exits.assertPartialExit.json`,
`splits.prepareDistributeAll.json`). The other rc sections of this guide and the 2.x tables above use the rc.12
names.

### 1. `send` refuses unacknowledged warnings

`prepared.checks` is no longer advisory. While it holds a finding with `severity: 'warning'`, `send` throws
`FINDINGS_NOT_ACKNOWLEDGED` before the wallet is asked for anything. A transaction without warnings (most of them)
is sent as before, with no options.

```typescript
// rc.11: sent whatever the warnings said
//   for (const finding of tx.checks) console.warn(finding.code, finding.message);
//   await obol.send(tx);

// rc.12, a UI: show the warnings, and on confirm acknowledge exactly what was shown
import { warningCodes, warningsOf } from '@obolnetwork/obol-sdk';

const warnings = warningsOf(tx, sim); // Finding[]: code, message, hint, subject, details
await showInConfirmDialog(warnings);  // resolves when the user confirms
await obol.send(tx, { simulation: sim, acknowledge: warningCodes(tx, sim) });

// rc.12, a script: a fixed policy, by code
await obol.send(tx, { acknowledge: ['VALIDATOR_STATUS_UNCHECKED'] });
```

```typescript
// rc.12, handling the refusal (typed: no cast)
import { isObolError } from '@obolnetwork/obol-sdk';

try {
  await obol.send(tx);
} catch (error) {
  if (!isObolError(error, 'FINDINGS_NOT_ACKNOWLEDGED')) throw error;
  error.details.codes;    // WarningCode[]              e.g. ['VALIDATOR_STATUS_UNCHECKED']
  error.details.findings; // Finding<WarningCode>[]     message, hint, subject, details of each
  error.message;          // one numbered line per warning
  error.hint;             // what to do next, with the exact send(...) call
}
```

- **Helpers.** `warningsOf(prepared, simulation?)` returns the warnings to show; `warningCodes(prepared,
  simulation?)` their distinct codes, ready for `acknowledge`; `findingsToAcknowledge(prepared, { acknowledge,
  simulation })` the ones still open (for a caller that sends `prepared.request` with its own wallet layer).
- **`acknowledge` is `readonly FindingCode[]`.** `true`, `'all'` or a single string is `PAYLOAD_INVALID` (and a type
  error); so is a string that is not a finding code. A listed code that does not occur is ignored, so a policy can be
  stated up front. `UNCHECKED_WARNING_CODES` is a ready-made list of the warnings that only mean "a check could not
  run".
- **Types.** `FindingCode` is `keyof typeof FINDINGS`, and each key of `FINDINGS` has TSDoc and, at run time,
  `{ severity, group, meaning, guidance }`. `Prepared<K>['checks']` is typed to the codes kind `K` can carry
  (`FindingCodeFor<K>`), so `warningCodes(tx)` and a `switch (finding.code)` offer only relevant codes;
  `FINDING_CODES_BY_KIND` is the same at run time. `FINDING_CODES` is now `FindingCode[]` (was a tuple type).
- **`info` findings need nothing.** These became warnings because they mean a check did not run:
  `DEPOSIT_EXISTENCE_UNCHECKED`, `VALIDATOR_STATUS_UNCHECKED`, `SIMULATION_UNAVAILABLE`. A client with `api: false`
  and no `beaconUrl` therefore has to acknowledge them on deposits, withdrawals and consolidations (or pass
  `beaconUrl`).
- **Simulation.** Pass it: `obol.send(tx, { simulation: sim, acknowledge })`. Its warnings then count too, and a
  simulation of another request is `PAYLOAD_INVALID`.
- **Do not** pass `warningCodes(tx)` without showing `warningsOf(tx)` to anyone: that is choosing to ignore the
  warnings. An agent reports them to its operator and waits.
- `send` needs `prepared.checks` to be present (an array), else `PREPARED_INVALID`: a hand-built `Prepared` must
  carry `checks: []`.
- `FINDINGS_NOT_ACKNOWLEDGED.details.findings` are full `Finding`s (with `subject` and `details`).

The warnings `send` can refuse, and what to check before acknowledging each (README "Acknowledging warnings" has
worked examples for a React dialog, a script and an agent):

| Warning | Meaning | Before you acknowledge |
|---|---|---|
| `DEPOSIT_EXISTENCE_UNCHECKED` | No deposit status source: whether the validators already exist, and with which withdrawal credentials, was not checked. | Pass `beaconUrl` or enable the Obol API so it is checked. Acknowledge only after checking each pubkey yourself (a beacon explorer): a deposit to a validator someone else created first goes to their withdrawal address. |
| `QUEUED_CREDENTIALS_CONFLICT` | Validly signed deposits queued for the pubkey carry different withdrawal credentials; the first one (yours) applies. | Find out who queued the other deposits. Acknowledge only if you accept adding ETH to a validator others have also deposited to. |
| `TOP_UP_ABOVE_EFFECTIVE_CAP` | The deposit takes a 0x00 / 0x01 validator above 32 ETH; the excess is swept back to the withdrawal address, not staked. | Deposit at most up to 32 ETH, or switch the validator to 0x02 first. Acknowledge if the round trip of the excess is acceptable. |
| `TOP_UP_EXITED_VALIDATOR` | Top-up to an exited validator: the ETH is swept back to its withdrawal address, not staked. | Do not top up an exited validator. Acknowledging sends ETH on a round trip to the withdrawal address. |
| `TOP_UP_CREDENTIALS_FOREIGN` | Top-up to a validator whose withdrawal credentials are not the expected address's: the ETH can only be withdrawn to those credentials. | Acknowledge only for a deliberate top-up of a validator you do not control. The ETH cannot be recovered. |
| `OVM_STAKE_NOT_TRACKED` | Deposit to an OVM's credentials through the batch contract: the OVM does not count it as principal, so it would later be paid out as rewards. | Deposit via the OVM instead. Acknowledge only if the owner will call `setAmountOfPrincipalStake` afterwards. |
| `PROVENANCE_UNKNOWN` | Could not check that the contract was created by the Obol OVM factory. | Retry `ovm.getProvenance`, or use an RPC that serves `eth_getLogs`. Acknowledge only if you know the contract by other means (you deployed it). |
| `VALIDATOR_STATUS_UNCHECKED` | The beacon chain request rules could not all be checked (`details.checks`); for a consolidation the withdrawal addresses were not compared. | Pass `beaconUrl` or enable the Obol API. Acknowledging accepts that the request may be ignored (fee lost) and, for a consolidation, that you checked the target's withdrawal address yourself. |
| `PARTIAL_WITHDRAWAL_QUEUE_FULL` | The beacon chain's pending partial withdrawal queue is full: the request would be ignored and the fee kept. | Wait for the queue to drain. Acknowledging spends the fee for a request that is likely to be dropped. |
| `CONSOLIDATION_CREDENTIALS_DIFFER` | Source and target validators have different withdrawal addresses: the stake moves out of this OVM and cannot be moved back. | Acknowledge only if the target validator and its withdrawal address (`details.targetWithdrawalAddress`) are yours. |
| `ROLE_GRANT_CONSOLIDATION` | Granting CONSOLIDATION: the holder can move the whole stake into a validator it controls. | Acknowledge only for an address you would trust with the stake. |
| `ROLE_GRANT_DEPOSIT_TO_PRINCIPAL` | Granting DEPOSIT to the principal recipient: it can raise the principal stake and take rewards as principal. | Grant DEPOSIT to another address. Acknowledge only if the reward recipients accept that. |
| `ROLES_SURVIVE_TRANSFER` | A change of owner does not revoke roles: the listed holders keep theirs. | Revoke the roles that should not survive, before or after. Acknowledge if the new owner knows the holders. |
| `SIMULATION_UNAVAILABLE` | The node could not simulate the request in full: only success or revert was checked, not what it moves. | Use an RPC with `eth_simulateV1`. Acknowledging sends on the strength of the preview alone. |
| `SIMULATION_REVERTED` | The transaction reverts when simulated. | Do not send; prepare again, or fix the sender or state. Acknowledging sends a transaction expected to fail (gas lost). |
| `SIMULATION_PREVIEW_MISMATCH` | The simulation differs from the operation's preview. | Prepare again and simulate the new transaction. Acknowledging sends a transaction whose effect is not the one previewed. |
| `SIMULATION_READS_INCOMPLETE` | Some balances or state could not be read while simulating: the changes shown are incomplete and not fully compared with the preview. | Simulate again, or on another RPC. Acknowledging sends without the full comparison; a missing change is not "no change". |
| `SIMULATION_UNTRUSTED_EVENT` | A contract with no known role in this transaction emitted events; they were not interpreted. | Look at the listed contracts. Acknowledge if they are expected (a recipient contract reacting to ETH). |

### 2. `prepareConsolidate` has no acknowledgement flag

```typescript
// rc.11
//   await obol.ovm.prepareConsolidate({ ovm, requests, acknowledgeStakeMovesToTarget: true });

// rc.12: the flag is gone (passing it is PAYLOAD_INVALID, unknown_key)
const tx = await obol.ovm.prepareConsolidate({ ovm, requests });
// A target with another withdrawal address is the warning CONSOLIDATION_CREDENTIALS_DIFFER, which send refuses:
await obol.send(tx, { acknowledge: ['CONSOLIDATION_CREDENTIALS_DIFFER'] }); // only after checking the target is yours
```

The flag had to be `true` on every call, also for a switch to compounding that moves no stake, so it protected
nothing. The error code `CONSOLIDATION_NOT_ACKNOWLEDGED` is removed. A consolidation whose rules could not be checked
(no status source, or the target's credentials unknown) carries `VALIDATOR_STATUS_UNCHECKED`, now a warning.
`acknowledgeFullExit` on `prepareWithdraw` / `prepareEoaWithdraw` is unchanged (required only for an amount of 0).

### 3. `deposits.fromLock`: `deposits` is always present, and `amount` may be required

```typescript
// rc.11: `deposits` was undefined for a lock with several amounts, so this sent nothing useful
//   const { deposits } = await obol.deposits.fromLock(lock);
//   await obol.deposits.prepareDeposit({ deposits: deposits ?? [], via: { ovm } }); // PAYLOAD_INVALID

// rc.12
import { parseEther } from 'viem';
const { deposits } = await obol.deposits.fromLock(lock, { amount: parseEther('32') });
await obol.deposits.prepareDeposit({ deposits, via: { ovm } });
```

- `LockDeposits.deposits` is `Deposit[]` (was `Deposit[] | undefined`): drop the `?? []`.
- A lock with deposit data for one amount needs no `amount`. A lock with several (every lock made with Charon's
  defaults: 1 ETH and 32 ETH; 1, 8, 32 and 256 ETH with compounding) throws `DEPOSIT_AMOUNT_REQUIRED` with
  `details.available`. The SDK does not choose: each amount is a different transaction value.
- `depositsByAmount` is unchanged, for depositing in parts.

### 4. Unknown keys are rejected

Every options object and operation input is strict. A key the operation does not define is `PAYLOAD_INVALID` with
`issue: 'unknown_key'` and a message naming the key and the allowed keys:

```typescript
// rc.11: `signature` was ignored, `attested` then checked no BLS signature, and this returned ok: true
//   await obol.cluster.verifyLock(lock, { level: 'attested', signature: 'all' });

// rc.12: PAYLOAD_INVALID 'options.signature: unknown key "signature"; allowed keys: bls, level, ...'
await obol.cluster.verifyLock(lock, { level: 'attested', signatures: 'all' });
```

Newly strict: the options of `verifyLock`, `isValidLock`, `fromLock`, `assertDepositData`, `verifyDefinition`,
`cluster.watch`, `exits.blsVerify`, `send`, `ovm.getProvenance`; the inputs of `verifyDefinition`, `incentives.isClaimed`,
`exits.assertPartialExit` and `exits.aggregate` (top-level keys), each `requests[]` entry of `prepareWithdraw` /
`prepareConsolidate`; and the `createObolClient` / `createObolContext` config. The `prepare*` inputs were strict
already. Documents are not: a cluster definition or lock, a `Deposit`, split params, and the exit objects
(`cluster`, `payload`, `existing`, `validator`, `exit`) may carry extra fields, as may API responses.

### Deposits to validators that already exist

`prepareDeposit` with `kind: 'deposit'` (the default) for a pubkey that is already in the validator registry, in any
status, exited included, now throws; rc.11 returned a `Prepared` with the warning `DEPOSIT_IS_TOP_UP` (removed).

| The validator's withdrawal credentials | rc.11 | rc.12 |
|---|---|---|
| point at the OVM / `expectedWithdrawalAddress` | warning `DEPOSIT_IS_TOP_UP` | error `DEPOSIT_VALIDATOR_EXISTS` (`status`, `withdrawalCredentials`) |
| point elsewhere, or are unknown | warning `DEPOSIT_IS_TOP_UP` | error `DEPOSIT_CONFLICT` with `existing: 'validator'` and `existingCredentials` |

`DEPOSIT_CONFLICT` for a queued deposit is unchanged and now has `existing: 'queued'`. To add stake to an existing
validator prepare a top-up (`kind: 'topUp'`). A top-up to a validator whose credentials are not the expected
address's gets the new warning `TOP_UP_CREDENTIALS_FOREIGN` (acknowledge it only for a deliberate donation).

`prepareDeposit` via an OVM also requires the OVM's provenance to be confirmed on chain: an Obol API answer alone
is no longer enough (`PROVENANCE_UNKNOWN` when the chain cannot confirm it). `ovm.getProvenance` confirms an API `obol`
answer against the creation receipt and returns `source: 'chain'`; when it cannot, the result is `source: 'api'`
with the reason marked "not confirmed on chain". `ovm.getProvenance(ovm, { requireChain: true })` never returns
`obol` / `api`.

### Deposit status from a beacon node

- The node at `beaconUrl` is checked before it is trusted: its `genesis_validators_root` must be the client
  chain's, and `/eth/v1/node/syncing` must report it in sync (not syncing, execution client online, not
  optimistic); state answers marked `execution_optimistic` are refused. Otherwise `STATUS_UNAVAILABLE` with
  `details.reason` `beacon_wrong_chain`, `beacon_syncing` or `beacon_optimistic`. rc.11 read such a node's empty
  answer as "every validator is new".
- The Obol API falls back to the beacon node only when it is unavailable (a timeout, a network failure, a 5xx). A
  400, 401, 403, 409, 422, 429 or 451 is thrown (rc.11 fell back on any API error). A 404 from the deposit-status
  route still means "this API has no such route" and moves on to the next source; a 404 for an unknown `lockHash`
  is thrown.

### Splits

`splits.splitParams`, `splits.prepareCreateSplit`, `setup.prepareOvmWithSplits` and the presets refuse the zero
address as a recipient (`PAYLOAD_INVALID`, `zero_address`); the chain-aware ones also refuse the chain's protocol
contracts (`protocol_contract`: Warehouse, factories, deposit and request contracts, ...) and the split's own
address (`self_recipient`). `splits.prepareDistributeAll` refuses `distributor: 0x0` when a split pays a
distribution incentive.

### Simulation (experimental)

```typescript
// rc.11
//   if (!sim.limited && !sim.matchesPreview.ok) ...   // ok was true when nothing had been compared

// rc.12
if (!sim.limited && sim.matchesPreview.status !== 'match') {
  // 'mismatch': sim.matchesPreview.differences; 'notCompared': sim.matchesPreview.notCompared
}
await obol.send(prepared, { simulation: sim });
```

`matchesPreview` gains `status` (`match` | `mismatch` | `notCompared`) and `notCompared`; `ok` is now
`status === 'match'`, so it is `false` for a preview with nothing comparable (was `true`). A failed before / after
read is the new warning `SIMULATION_READS_INCOMPLETE` instead of a silently missing change. Results carry the
simulated `request`. `SIMULATION_UNAVAILABLE` is a warning.

### Exits

`EXIT_EPOCH_MISMATCH` has `details.direction` (`'higher'` | `'lower'`: the new epoch against the stored one) and a
hint with the reset path. The rule itself is unchanged from rc.4: any other epoch is refused (2.x accepted a higher
one). To exit at another epoch the stored exit has to be deleted first; the Obol API offers that per operator
(`charon exit delete`, which removes the caller's partial signature; the document goes when none is left) and has
no call that deletes a whole exit document, so every operator that already submitted must delete before the
cluster can re-sign.

### Cluster files

- **v1.9.0 stays unsupported**, as in the Obol API. `verifyLock` now reports it before any other step
  (`{ step: 'hash_mismatch', issue: 'version_unsupported' }`; rc.11 reported whichever earlier step the file
  tripped), `computeConfigHash` / `computeDefinitionHash` / `computeLockHash` throw `DEFINITION_INVALID`
  (`version_unsupported`), and `deposits.fromLock` throws `LOCK_INVALID`.
- **Legacy locks (v1.6.0, v1.7.0) with `partial_deposit_data`** are refused: `verifyLock` fails at
  `deposit_data_invalid` / `partial_deposit_data_unexpected`, and `fromLock` throws `LOCK_INVALID` with that
  issue, also with `verify: false`. Their lock hash covers `deposit_data` only, so an added `partial_deposit_data`
  entry was not signed by the DKG; rc.11 returned it in place of the signed deposit. Charon ignores the field on
  such locks.
- `obol.cluster.prepareDefinition` and `obol.cluster.create` are typed with the definition input (they were
  `object` / `unknown`), so the fields complete and a misspelt one is a type error.

### Packaging and runtime

- **No `Buffer` in the browser build.** The SDK and the SSZ list hashing it uses no longer touch `Buffer`; remove a
  polyfill you added for the SDK. Nothing changes under Node.
- **`isObolError` works across copies** of the SDK (CommonJS and ESM builds loaded together, or two versions): it
  checks a `Symbol.for` brand, not `instanceof`. Use it instead of `error instanceof ObolError`.
- **`viem` peer range is `^2.27.0`** (was `^2.21.0`, which predates `hoodi` in `viem/chains`).
- `@chainsafe/enr` is no longer a dependency (it was installed, with about 40 transitive packages, and never loaded:
  the builds bundle it).

### Codes

| | Code |
|---|---|
| New exports | `warningsOf`, `warningCodes`, `findingsToAcknowledge`, `FINDINGS`, `FINDING_CODES_BY_KIND`, `SIMULATION_FINDING_CODES`, `UNCHECKED_WARNING_CODES`; types `SendOptions`, `WarningCode`, `FindingCodeFor`, `WarningCodeFor`, `FindingsOf`, `FindingInfo` |
| New errors | `FINDINGS_NOT_ACKNOWLEDGED`, `DEPOSIT_VALIDATOR_EXISTS`, `DEPOSIT_AMOUNT_REQUIRED` |
| Removed errors | `CONSOLIDATION_NOT_ACKNOWLEDGED` |
| New findings | `TOP_UP_CREDENTIALS_FOREIGN`, `SIMULATION_READS_INCOMPLETE` |
| Removed findings | `DEPOSIT_IS_TOP_UP` (now the errors above) |
| info → warning | `DEPOSIT_EXISTENCE_UNCHECKED`, `VALIDATOR_STATUS_UNCHECKED`, `SIMULATION_UNAVAILABLE` |
| New details | `DEPOSIT_CONFLICT.existing`, `EXIT_EPOCH_MISMATCH.direction`, `STATUS_UNAVAILABLE.reason` `beacon_*` |
| New `PAYLOAD_INVALID` issues | `unknown_key`, `unknown_finding_code`, `simulation_mismatch`, `zero_address`, `protocol_contract`, `self_recipient` |
| New `LOCK_INVALID` / `verifyLock` issue | `partial_deposit_data_unexpected` |
