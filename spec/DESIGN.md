# obol-sdk v3 design

Status: reviewed by the launchpad side (2026-10-18), implementation started. Branch `feat/sdk-v3`, based on v2.15.0.

## Goals

- **Something a human or an AI agent can plug together with high confidence.** Every method has typed inputs and
  outputs, says what it checks, and either returns findings or throws a typed error with a code and hint.
- **Chain-first, API-enriched.** Anything that can work from the chain alone does. The Obol API adds storage
  (definitions, locks) and indexed reads (provenance, roles, deposit status, incentives). It is on by default and can
  be switched off.
- **Prepare, then send.** The SDK builds and checks transactions; the caller's wallet layer (wagmi, a Safe, a script)
  sends them. A small send helper exists for scripts.
- **viem-native.** viem `Chain`, `PublicClient`, `WalletClient`, ABIs and units. No ethers.
- **Spec-backed.** Operations, checks, error codes and lifecycles are written down in `spec/` with JSON test vectors,
  so a second client (Go) can be written against the same contract. Cluster files follow
  [distributed-validator-specs](https://github.com/ObolNetwork/distributed-validator-specs) and the SDK runs its
  vectors.
- **Modest.** Small modules, thin wrappers over contracts, no clever type tricks. If a feature needs a lot of
  client-side machinery (log scanning, polling heuristics), it belongs in the API.

## Non-goals

- Running a DV node, DKG orchestration (Charon), or a wallet / Safe client.
- Creating legacy OWR or SplitMain contracts (reads of existing ones stay; creation only in test fixtures).
- Atomic multi-step programs (weiroll or a router contract). Two transactions where needed.

## Client

```ts
import { createObolClient } from '@obolnetwork/obol-sdk'
import { createPublicClient, http } from 'viem'
import { hoodi } from 'viem/chains'

const obol = createObolClient({
  chain: hoodi,                       // viem Chain: mainnet or hoodi (gnosis / sepolia for cluster files only)
  publicClient: createPublicClient({ chain: hoodi, transport: http() }),
  walletClient,                       // optional: signing (EIP-712) and the send helper
  api: { baseUrl, timeoutMs },        // default: Obol API for the chain; `false` = chain-only
})
```

- The chain is taken from `chain` and checked against `publicClient.chain` and, when signing or sending,
  `walletClient`'s chain. A mismatch is `ChainMismatchError`.
- **Method tags** (in TSDoc and `spec/operations.md`): `pure` (no client), `chain`, `api`, `api+chain` (API first,
  chain fallback). With `api: false`, `api+chain` methods use the chain and `api` methods throw `ApiDisabledError`.
- Pure functions are also plain exports, so obol-api and others can verify locks or deposits without a client.

## Writes: prepare, then send

Every write is a `prepareX(input)` returning:

```ts
type Prepared<K extends PreparedKind> = {
  kind: K             // which operation: 'deposit' | 'withdraw' | 'distribution' | ...; narrows preview
  request: { to: Address; data: Hex; value: bigint; chainId: number }  // viem-compatible
  checks: Finding[]   // everything the SDK verified; errors make prepare throw instead
  preview: PreviewByKind[K]  // what the transaction will do (amounts per recipient, predicted addresses, ...)
  blockNumber?: bigint
}
type AnyPrepared = Prepared<'deposit'> | Prepared<'withdraw'> | ...   // discriminated by kind
type Finding = { code: FindingCode; severity: 'warning' | 'info'; message: string; hint?: string;
                 subject?: { pubkey } | { address } | { index } }
```

- `prepareX` throws a typed error for anything that would lose funds or certainly revert (bad deposit signature,
  wrong credentials, fee out of range, unknown OVM provenance where it matters). Warnings come back in `checks`.
- Callers send `request` themselves (`walletClient.sendTransaction(prepared.request)`, wagmi `useSendTransaction`,
  a Safe app).
- Send helper for scripts and simple apps:

```ts
const { hash, wait } = await obol.send(prepared)        // uses walletClient
const receipt = await wait({ onReplaced })              // viem waitForTransactionReceipt
```

  `send` re-checks the chain and returns as soon as the wallet returns a hash, so the caller always has it before
  waiting. Errors from `wait` carry the hash.
- **Simulate before signing.** `simulate(prepared, { from })` runs the request on the node without sending it
  (`eth_simulateV1`, else `debug_traceCall`, else `eth_call` only, detected once per client) and returns the decoded
  revert or the balance changes, events, state changes, deterministic `summary` lines and a comparison with the
  preview (`matchesPreview`; a difference is an SDK bug). `prepareX` stays pure and never simulates on its own: the
  pattern is prepare → simulate → show the summary → send. A Safe is simulated as `msg.sender`; its own signature
  checks are not.
- **Safe.** A Safe over WalletConnect returns a `safeTxHash` that never appears on-chain. `send` detects a
  contract-wallet account (code at the address) and `wait` then follows the Safe's `ExecutionSuccess` /
  `ExecutionFailure` log for that hash, chain-only, as 2.15 did. That is the only Safe-specific code; apps that send
  through wagmi themselves can call `waitForContractWalletExecution` with the same rule. A Safe with `DEPOSIT_ROLE`
  batches several OVM deposits with `MultiSend` (delegatecall keeps the Safe as `msg.sender`).

## Events

- Long-running things are async iterables with an `AbortSignal`, not event emitters:

```ts
for await (const event of obol.cluster.watch(configHash, { signal })) {
  // { type: 'operator_signed', address, signed, total } | { type: 'definition_ready' } | { type: 'lock_published', lockHash }
}
```

- Transaction lifecycle uses viem's own (`wait({ onReplaced })`).
- Deposit lifecycle is a status, not a stream: `obol.deposits.status(pubkeys)` →
  `new | queued | active | exited` per pubkey with the raw `beaconStatus`, credentials and amounts (API `/state`,
  including the EIP-6110 queue; chain fallback via a beacon URL if given).
- Rationale: async iterables + abort map directly onto Go channels + `context.Context`.

## Units and types

- **ETH amounts: `bigint` wei everywhere in the public API.** The SDK converts to gwei where the chain wants it
  (deposit data amounts, EIP-7002 / EIP-7251 request amounts, OVM thresholds) and rejects values that are not whole
  gwei. Callers use viem's `parseEther`, `parseGwei`, `formatEther`.
- **Shares: integer parts per million** (`1_000_000` = 100%, the 0xSplits `PERCENTAGE_SCALE`), with
  `percent('33.3333')` → `333333n` and `formatPercent`. The SDK adds the Obol RAF share and spreads remainders
  deterministically (first recipient after sorting by address).
- Addresses `Address`, hex `Hex` (viem types). Hashes as `Hex`.
- **Schemas: TypeBox.** One definition gives the TypeScript type and a JSON Schema; the JSON Schemas are published in
  `spec/schemas/` for other clients.

## Errors

- Two classes: `ObolError` (`code` (stable string), `message`, `hint?`, `cause?`, plus the fields each code lists)
  and `ObolApiError extends ObolError` (`status`, `endpoint`, `method`, `body`; codes `API_*`). Callers switch on
  `code`. Input failures are `PAYLOAD_INVALID` with `issues` (path + message).
- Every code is listed in `spec/errors.md` with when it is thrown and what to do.

## Modules

| Module | Purpose | Main operations |
|---|---|---|
| `cluster` | Definitions and locks | `prepareDefinition` (build + hash, sign via walletClient) / `create`, `accept`, `get`, `getLock`, `watch`; pure `verifyDefinition`, `verifyLock`, `computeConfigHash`, `computeLockHash` |
| `deposits` | Deposit data and status | `fromLock(lock, { amount })`, `prepareDeposit` (OVM: one transaction per deposit, so it returns `Prepared[]`; batch deposit contract: one per 500; `kind: 'deposit' \| 'topUp'`), `status(pubkeys)`; pure `verifyDepositData`. Depositing to OVM credentials through the batch contract warns `OVM_STAKE_NOT_TRACKED` (the OVM's `amountOfPrincipalStake` is not raised, so principal would later be paid out as rewards) |
| `ovm` | ObolValidatorManager | reads `verify` (provenance: obol / notObol / unknown + source), `getState` (with distributable and routing), `getRoleHolders` (`api+chain`), `getValidators` (`api`); `prepareWithdraw` (full exits opt-in), `prepareConsolidate` (explicit opt-in), `prepareDistribute` / `previewDistribute`, role and ownership writes with previews and findings; pure `expectedWithdrawalCredentials`, `OVM_ROLES` |
| `splits` | 0xSplits v2 PullSplits | `predictSplit`, `prepareCreateSplit`, `getSplit` (params from input, API or logs, checked against `splitHash`), `prepareDistribution` / `previewDistribution` (OVM + splits + warehouse withdrawals, per-recipient preview, `minWithdraw` and skip reasons) |
| `setup` | Compositions | `prepareOvmWithSplits` (one Multicall3 tx: reward split, optional principal split, OVM; idempotent); presets (solo, Lido CSM, rewards split, total split) built on the individual builders |
| `incentives` | Obol incentives | `get(address)`, `prepareClaim` (proof vs on-chain root, deadline, contract code check) |
| `exits` | Exit messages | `verifyPartialExit`, `aggregate`; pure BLS helpers |
| `terms` | Terms and conditions | `hasAccepted`, `accept` |
| `withdrawals` | Direct EIP-7002 requests | `prepareEoaWithdraw` (from the validator's withdrawal address) |
| `legacy` | Existing OWR / SplitMain v1 | reads only (`getOwrTranches`) |

### Setup flows

- **Individual builders first:** `prepareCreateOvm({ owner, principalRecipient, rewardRecipient, principalThreshold })`
  takes any addresses (an existing split, an EOA, a Safe). `prepareCreateSplit({ recipients, owner, ... })` creates one
  PullSplit at a predicted CREATE2 address.
- **The aggregate is a composition:** `prepareOvmWithSplits` predicts the split addresses, skips splits that already
  exist, and batches the creates plus `createObolValidatorManager` in one Multicall3 `aggregate3` call. Only the splits
  are idempotent: the OVM is a plain CREATE, so every send makes a new OVM. Callers persist the OVM address from the
  receipt and must not re-send a mined setup. It works because
  the OVM (plain CREATE) is the only unknown address and nothing else in the transaction needs it. The OVM address is
  read from the `CreateObolValidatorManager` event: `obol.setup.ovmFromReceipt(receipt)`.
- Presets are data on top of these (which recipients get what, with Obol's fee on rewards and none on principal; CSM
  addresses per chain), not separate code paths.

## API enrichment

Endpoints v3 relies on (existing unless marked):

- definitions / locks / terms / incentives (existing);
- `GET /v1/state/:lockHash` including queued deposits (`pending_deposit`, obol-api PR `fix/state-pending-deposits`);
- **new:** `GET /v1/ovm/:network/:address`: provenance (factory creation), current role holders, cached state, the
  split params of its recipients (from `SplitCreated` / `SplitUpdated`), the validators whose credentials point at
  it (any cluster, with status), and `principalOnBeaconChain` (ETH the beacon chain credited to those validators minus
  principal paid out), to reconcile against `amountOfPrincipalStake`;
- **new:** deposit status by pubkey with credentials (registry + queue), for `deposits.status` and deposit checks:
  `POST /v1/validators/:network/deposit-status` (`{ pubkeys }`, at most 1000; wei amounts, every queued deposit with
  its own credentials). Until it is deployed the SDK falls back to `/v1/state/:lockHash` when given a `lockHash`;
- Etherscan proxies (`/v1/eth/contract-creation`, `/v1/eth/logs`) as interim sources until the above exist.

Values that move money are re-read on-chain inside `prepareX` even when the API supplied them for display.

Note for distribution: a Warehouse owner's own withdrawal bypasses their pause flag only when they send from an EOA
(`tx.origin`); from a Safe, a paused owner's withdrawal is skipped like anyone else's.

## Spec and vectors

```
spec/
  README.md          scope, conventions, how to run the vectors
  operations.md      every operation: tag, inputs, checks, outputs, errors
  lifecycles.md      cluster (definition → accepted → lock), transaction, deposit (new → queued → active)
  errors.md          codes, meaning, what to do
  schemas/           JSON Schema generated from the TypeBox types
  vectors/           SDK-level suites: deposit checks, share rounding, distribution routing, fee bounds, setup calldata
```

- Cluster file hashing and lock verification come from distributed-validator-specs (`test/fixtures/spec/`, already
  vendored in 2.15). The SDK suites could later move into that repo as an SDK section.
- Lock verification follows the spec's "Verifying a Lock Before Use" sequence in full (hashes, one share per operator
  and no repeats, every share reconstructs the group key, both signature sets).
- Lock verification has two levels. `full` runs every check. `attested` skips the BLS work that Charon has already
  done in the DKG (each node signs `lock_hash` only after it has verified every deposit and builder registration
  signature) and checks the signatures of the deposits a caller is about to send: `deposits.fromLock` uses it, so a
  10k-validator lock is seconds, not hours.

## Packaging

- One package, ESM + CJS, with correct `.d.ts` for both. Tree-shakeable modules: `"sideEffects": false`, and one
  entry per module (`@obolnetwork/obol-sdk/ovm`, `/splits`, `/cluster`, `/deposits`, `/setup`, `/incentives`,
  `/terms`, `/withdrawals`, `/exits`, `/experimental`) with shared chunks, so a reads-only `ovm` import carries no BLS
  or SSZ code (`yarn size:check` keeps it so, with a size budget).
- The public surface is explicit export lists, recorded in `etc/obol-sdk.api.md` (API Extractor; CI fails on an
  unreviewed change). What may still change (`simulate`, `legacy`) is under `experimental`.
- Peer dependency: `viem@^2`. Bundled: `@noble/curves`, `@noble/hashes`, `@chainsafe/enr`; dependencies: `@chainsafe/ssz`, `@sinclair/typebox`. No ethers (the launchpad uses wagmi / viem;
  the ethers adapter was dropped).
- Node ≥ 20, browsers via the ESM build.
- No native modules and no worker threads: BLS is pure JS (`@noble/curves`), and long verifications run on the
  calling thread, yielding to the event loop every `yieldMs`. Speed comes from the algorithms (each point decoded
  once, share binding by finite differences, randomised batch signature checks) rather than from threads. A Node
  server that wants native speed passes a `BlsBackend` adapter (for example over `@chainsafe/blst`, about 30 lines,
  documented on the type); the SDK itself never imports one.

## Migration from 2.x

- 2.x stays on a maintenance branch for fixes.
- Migration guide maps each 2.x method to its v3 operation; codemods are out of scope.
- Launchpad moves module by module (deposits and OVM first, where it gains the most).

## Harvested from the shelved 2.16 work

OVM reads and provenance rules, role constants, integer share math and Split Everything spreading, distribution
routing and previews, the consolidation fee helper, and the Hoodi checks of each. The overloads, Safe proposed mode,
`resolveSafeTx` and `validatorLookup` are not carried over.

## Open questions

1. ~~TypeBox~~: confirmed.
2. ~~ethers adapter~~: dropped.
3. Where the SDK vector suites live long-term (this repo vs distributed-validator-specs).
4. Gnosis and Sepolia: cluster files only (kept for existing deployments).
5. Exact shape of the new obol-api OVM endpoint (to design with obol-api). Deposit status:
   `POST /v1/validators/:network/deposit-status` (see `operations.md`), with `/v1/state/:lockHash` as the fallback
   until it is deployed.
6. Lido CSM preset addresses and roles per chain.

## Milestones

1. `spec/` (operations, lifecycles, errors) and this doc reviewed.
2. Core: client, units, errors, schemas, pure cluster and deposit functions passing all vectors.
3. Deposits + OVM + splits + setup builders, verified on Hoodi.
4. Cluster / terms / incentives / exits on the new client; `watch`.
5. obol-api endpoints; switch `api+chain` reads to them.
6. Examples, docs, migration guide; launchpad adoption; release 3.0.0.
