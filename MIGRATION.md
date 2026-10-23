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
- [From 3.0.0-rc.9 to 3.0.0](#from-300-rc9-to-300)

## From 2.x

### What changes everywhere

- **viem instead of ethers.** Pass viem clients; the ethers `Signer` / `Provider` are gone. `viem@^2` is a peer
  dependency.
- **Prepare, then send.** A write no longer sends a transaction itself. `prepare*` checks everything and returns a
  `Prepared` (`kind`, `request`, `checks`, `preview`, `blockNumber`); `obol.send(prepared)` sends it, or your wallet
  layer sends `prepared.request`.
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
| `client.getDepositData(lock, options)` / `depositDataFromLock` | `obol.deposits.fromLock(lock, { amount?, validators? })` |
| `validateClusterLock(lock)` | `await isValidLock(lock, options?)` (boolean; also `cluster.isValidLock`, bound `obol.cluster.isValidLock`). **Not** a rename to `verifyLock`: see [Verifying locks on a server](#verifying-locks-on-a-server) |
| `client.createObolRewardsSplit(...)` | `obol.setup.prepareOvmWithSplits(obol.setup.rewardsSplit({ ... }))` |
| `client.createObolTotalSplit(...)` | `obol.setup.prepareOvmWithSplits(obol.setup.totalSplit({ ... }))` |
| `client.splits.createValidatorManagerAndRewardsSplit(...)` | `obol.setup.prepareOvmWithSplits(obol.setup.rewardsSplit({ ... }))` |
| `client.splits.createValidatorManagerAndTotalSplit(...)` | `obol.setup.prepareOvmWithSplits(obol.setup.totalSplit({ ... }))` |
| `client.splits.requestWithdrawal(...)` | `obol.ovm.prepareWithdraw({ ovm, requests, acknowledgeFullExit? })` |
| `client.splits.deposit(...)` | `obol.deposits.prepareDeposit({ deposits, via: { ovm } })` |
| `client.getOWRTranches(owr)` | `obol.experimental.legacy.getOwrTranches(owr)` (any client chain, Gnosis and Sepolia included, since rc.6) |
| `client.eoa.requestWithdrawal(...)` | `obol.withdrawals.prepareEoaWithdraw({ pubkey, amount })` |
| `client.eoa.deposit(...)` | `obol.deposits.prepareDeposit({ deposits, via: { batch: true }, expectedWithdrawalAddress })` |
| `client.incentives.getIncentivesByAddress(address)` | `obol.incentives.get(address)` |
| `client.incentives.isClaimed(contract, index)` | `obol.incentives.isClaimed({ contractAddress, index })` |
| `client.incentives.preflightClaim(address)` | `obol.incentives.preflight(address)` |
| `client.incentives.claimIncentives(address)` | `obol.incentives.prepareClaim(address)` then `obol.send` |
| `client.exit.validateExitBlobs(...)` / `verifyPartialExitSignature` / `verifyExitPayloadSignature` | `obol.exits.verifyPartialExit({ cluster, payload, existing })` |
| `client.exit.recombineExitBlobs(...)` | `obol.exits.aggregate({ validator, exit, threshold })` (threshold aggregation; 2.x summed the partials, which is not a valid exit signature) |
| `blsVerify(pubkey, message, signature)` (`Uint8Array`s) | `exits.blsVerify(pubkey, message, signature, { bls? })` with `Hex` strings (`bytesToHex` from viem). Throws `PAYLOAD_INVALID` on malformed input (not hex, wrong length) where 2.x returned `false`; a well-formed value that is not a valid point is still `false`. `bls` picks the backend (`await loadBlstBackend()` on a server; default pure JS) |
| `validateAddressSignature({ address, token, data, chainId })` | `await verifyTypedDataSignature({ address, signature: token, typedData: data, chainId, publicClients })`. A contract wallet (Safe) is checked only with a client for `chainId` (2.x used built-in RPCs); both the EIP-1271 magic `0x1626ba7e` and the legacy `isValidSignature(bytes, bytes)` → `0x20c13b0b` of Safes before 1.3.0 are accepted, as with 2.x's Safe protocol-kit (since rc.6). `data` may stay eth-sig-util's `TypedMessage` (since rc.6: a bytes `domain.salt` is converted to hex; rc.5 needed a cast). 2.x threw on a malformed `token`; v3 returns `false` |
| `validateEOASignature({ token, data, address })` | `await verifyTypedDataSignature({ address, signature: token, typedData: data })` (async; `false` instead of a throw for a malformed signature, as above) |
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
  The same options apply to `verifyDefinition` (`signature_unverifiable`) and `verifyTypedDataSignature`.
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
  Racing the promise against a timer would leave the work running. `verifyDepositData` takes `signal` too. There
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
| `clusterConfigOrDefinitionHash(definition, true)` / `(definition, false)` | `cluster.computeConfigHash(definition)` / `cluster.computeDefinitionHash(definition)`. Both decode the definition first and throw `PAYLOAD_INVALID` for a malformed one (map it to a 400); a mongoose document is accepted as it is |
| `signCreatorConfigHashPayload({ creator_config_hash }, chainId)` | `cluster.creatorConfigHashTypedData(configHash, chainId)` (viem typed data: no `EIP712Domain` in `types`, same hash) |
| `signOperatorConfigHashPayload`, `signEnrPayload` | `cluster.operatorConfigHashTypedData(configHash, chainId)`, `cluster.enrTypedData(enr, chainId)` |
| `validateAddressSignature`, `validateEOASignature` | `verifyTypedDataSignature` (see the method table) |
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

// 3
const prepared = obol.cluster.prepareDefinition({ name, operators, validators, creator, chainId });
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
const { deposits } = await obol.deposits.fromLock(lock);      // verifies the lock first
const txs = await obol.deposits.prepareDeposit({ deposits: deposits ?? [], via: { ovm: ovmAddress } });
for (const tx of txs) await (await obol.send(tx)).wait();
```

### OVM and splits

```typescript
// 2.x
await client.createObolRewardsSplit({ splitRecipients, principalRecipient, ... });

// 3
const input = obol.setup.rewardsSplit({ recipients, principalRecipient, owner });
const prepared = await obol.setup.prepareOvmWithSplits(input);
const receipt = await (await obol.send(prepared)).wait();
const { ovm } = obol.setup.ovmFromReceipt(receipt);

// Withdraw (a full exit needs the acknowledgement):
await obol.send(await obol.ovm.prepareWithdraw({ ovm, requests: [{ pubkey, amount: 0n }], acknowledgeFullExit: true }));
// Distribute the OVM, its splits and the recipients' Warehouse balances in one transaction:
await obol.send(await obol.splits.prepareDistribution({ ovm }));
```

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
const blobs = await client.exit.validateExitBlobs(clusterConfig, payload, existing);
const signed = await client.exit.recombineExitBlobs(existing);

// 3: the API's own formats, passed as received and stored
const fresh = obol.exits.verifyPartialExit({ cluster, payload, existing: storedBlobs });
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
| `ValidationError`, `UnauthorizedError`, `NotFoundError`, `ConflictError`, `RateLimitError`, `RequestTimeoutError` | `API_VALIDATION`, `API_UNAUTHORIZED`, `API_NOT_FOUND`, `API_CONFLICT`, `API_RATE_LIMIT`, `API_TIMEOUT` |
| `TransactionSubmissionError` | `TX_REVERTED`, `TX_UNCONFIRMED` (from `wait`) |
| `ClusterLockValidationTimeoutError`, `ClusterLockValidationBusyError` | `ABORTED` for a deadline: pass `signal` (e.g. `AbortSignal.timeout(ms)`) to `verifyLock` / `isValidLock` (since rc.6). No busy error: `verifyLock` yields instead of using workers; a server applies its own concurrency limit around the call |

The full list, with what to do for each, is [`spec/errors.md`](spec/errors.md).

## From 3.0.0-rc.3 to rc.4

rc.4 freezes the public shape before 3.0. Every change below breaks a call site written against rc.3.

### Shapes

```typescript
// Previews: one shape for every preview*
// rc.3
const { distributable, blockNumber } = await obol.ovm.previewDistribute({ ovm });
// rc.4
const { preview, checks, blockNumber } = await obol.ovm.previewDistribute({ ovm });
preview.distributable;
// splits.previewDistribution: preview.blockNumber is gone (use the top-level blockNumber).

// Prepared has a kind: narrow without guessing at the preview's shape
const p: AnyPrepared = await obol.splits.prepareDistribution({ ovm });
if (p.kind === 'distribution') p.preview.recipients;

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
- `prepareDistribution` withdraws for the Obol RAF address by default; pass `includeRaf: false` to leave it.
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

New: `isValidLock`, `publicClients` on `verifyLock` / `verifyDefinition`, `verifyTypedDataSignature`,
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

- `verifyTypedDataSignature` and the definition signature checks (`verifyLock`, `verifyDefinition`) also accept the
  legacy EIP-1271 `isValidSignature(bytes, bytes)` → `0x20c13b0b` of Safes before 1.3.0 (the 32-byte EIP-712 hash
  as `data`), as 2.x did through Safe protocol-kit. `verifyTypedDataSignature` takes eth-sig-util's `TypedMessage`
  as it is (a bytes `domain.salt` is converted to hex).
- `signal?: AbortSignal` on `verifyLock`, `isValidLock` and `verifyDepositData`: checked at every yield point; an
  abort throws the new code `ABORTED` (`cause`: the signal's reason). `isValidLock` throws it, never `false`.
- `exits.blsVerify(pubkey, message, signature, { bls })` verifies with the given backend (blst on a server).
- `experimental.legacy.getOwrTranches` works on any client chain (was mainnet / Hoodi only: `UNSUPPORTED_CHAIN` on
  Gnosis and Sepolia).

## From 3.0.0-rc.6 to rc.7

No API changes. Three behaviour changes:

- `ovm.verify` returns `notObol` (source `chain`, reason "The contract does not answer the OVM getters") for a
  contract that does not answer the OVM getters, when the API gives no verdict, instead of scanning the factory logs
  (which on a public RPC could take long or end `unknown`). It never concludes `obol` that way.
- `ovm.verify` takes only `obol` from the API OVM record; a `notObol` there (possibly cached before the OVM was
  deployed or indexed) is checked on the chain, so a just-deployed OVM is no longer `notObol` / api.
- A Multicall3 read pinned to a block that the RPC refuses (a non-archive node, or a load balancer whose backends lag
  each other) is retried once at `latest`, so `ovm.getRoleHolders`, `getState` and the OVM writes no longer fail with
  `CHAIN_READ_FAILED` on such RPCs.

## From 3.0.0-rc.7 to rc.8

No API changes. Log scans (`ovm.verify`, `ovm.getRoleHolders`, `splits.getSplit`) start at 10,000-block windows instead
of 50,000 and double after each round that works, up to 50,000, never back to a size the RPC refused. On an RPC that
caps the range and is slow to refuse (eRPC takes about 28 s), a scan pays at most one refused round per client instead
of one per halving. If you pass viem's `fallback()` transport, let a log-range refusal throw instead of failing over
(its `shouldThrow`); otherwise the scan only sees the next transport's error and cannot shrink its window.

## From 3.0.0-rc.8 to rc.9

No API changes. Requests to the Obol API send `Content-Type: application/json` only when they have a body, so a
browser's cross-origin GET is a simple request (no CORS preflight). In Node they also send
`User-Agent: obol-sdk/<version>`; browsers send their own. A header you pass in the request still wins.

## From 3.0.0-rc.9 to 3.0.0

No API or behaviour changes: 3.0.0 is rc.9 with internal refactors. It is published on npm `latest`, so an unpinned
`npm install @obolnetwork/obol-sdk` now installs v3; a `^2` range stays on 2.x. Move an npm alias
(`npm:@obolnetwork/obol-sdk@3.0.0-rc.9`) to `@obolnetwork/obol-sdk@3.0.0`.
