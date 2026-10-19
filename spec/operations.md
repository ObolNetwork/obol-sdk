# Operations

One section per operation of the design's module table. Conventions (units, encodings, tags, checks) are in
[`README.md`](README.md); codes are in [`errors.md`](errors.md). `(2.15)` / `(2.16)` after a check says which earlier
code it comes from; `(new)` marks a check neither had.

Contents: [Shared types](#shared-types) · [Client](#client) · [cluster](#cluster) · [deposits](#deposits) ·
[ovm](#ovm) · [splits](#splits) · [setup](#setup) · [incentives](#incentives) · [exits](#exits) · [terms](#terms) ·
[send](#send) · [Not placed in the module table](#not-placed-in-the-module-table) · [Open questions](#open-questions)

## Shared types

```
Prepared<P> = {
  request:     { to: Address, data: Hex, value: bigint, chainId: uint }
  checks:      Finding[]      # every warning / info from the checks; errors throw instead
  preview:     P?             # what the transaction will do
  blockNumber: uint?          # the block the checks and preview read; absent for operations that read no chain state
}
Finding = { code: string, severity: "warning" | "info", message: string, hint: string? }
Source  = "api" | "chain"
SplitParams = { recipients: Address[], allocations: bigint[], totalAllocation: bigint, distributionIncentive: uint }
Deposit = { pubkey: Pubkey, withdrawalCredentials: Hex32, signature: Hex96, depositDataRoot: Hash32, amount: bigint }
```

- `request.chainId` is the client chain. `request.value` is `0` unless stated.
- A `Prepared` is a snapshot checked at `blockNumber`. `send` does not refuse an old one: the writes are safe when
  stale (a distribution pays what is there at execution; fees have a maximum), and the UI re-prepares on confirm. A
  caller that shows a preview for long should prepare again before sending.

### Checks every operation runs

Not repeated below:

- **G1** Inputs are decoded against the operation's schema: required fields, types, hex lengths, address format
  (checksum rule in README), integer ranges. Failure: `PAYLOAD_INVALID` with `issues[]` (path + message).
  (2.15 `PayloadValidationError`, `InvalidArgumentError`)
- **G2** A `chain` or `api+chain` operation that reads contracts requires the client chain to have them: OVM, splits,
  incentives and deposit operations are mainnet (1) and Hoodi (560048) only. Else `UNSUPPORTED_CHAIN`. (2.15)
- **G3** An operation that signs, or `send`, checks the `walletClient` chain equals the client chain, else
  `CHAIN_MISMATCH`; no wallet: `WALLET_REQUIRED`. (2.15 `assertSignerChain`, `SignerRequiredError`)
- **G4** An `api` operation with `api: false` throws `API_DISABLED`. API failures map to the `API_*` codes.

## Client

### createObolClient

Tag: constructor. Inputs:

```
{ chain: Chain, publicClient: PublicClient, walletClient: WalletClient?,
  api: { baseUrl: string?, timeoutMs: uint? } | false   # default: the Obol API for the chain, 30000 ms }
```

Checks:

1. `chain.id` is 1, 560048, 100 or 11155111, else `UNSUPPORTED_CHAIN`. 100 and 11155111 allow only cluster,
   terms and pure operations (G2). (2.15 `SUPPORTED_CHAIN_IDS`)
2. `publicClient.chain.id` equals `chain.id`, else `CHAIN_MISMATCH`. (new; design "Client")
3. If `walletClient.chain` is set, it equals `chain.id`, else `CHAIN_MISMATCH`. Re-checked before every signature and
   `send` (G3), because wallets switch chains.
4. `api.baseUrl`, after removing trailing `/`, is one of `https://api.obol.tech`,
   `https://obol-api-nonprod-dev.dev.obol.tech`, `https://obol-api-nonprod-qa.dev.obol.tech`, else
   `INVALID_BASE_URL`. EIP-712 signatures are sent as bearer tokens, so they only go to Obol hosts. (2.15)
5. `api.timeoutMs` is a finite integer ≥ 0 (0 = no timeout), else `PAYLOAD_INVALID`. (2.15)

## cluster

Cluster files follow distributed-validator-specs `cluster-files.md`. Supported definition versions: `v1.6.0`,
`v1.7.0`, `v1.8.0`, `v1.10.0`, `v1.11.0`; default `v1.11.0`. EIP-712 domain `{ name: "Obol", version: "1", chainId }`
(chain-bound) for config hash and ENR signatures; without `chainId` for terms.

### cluster.computeConfigHash / cluster.computeLockHash

Tag: `pure`. Input: a definition / a lock. Output: `Hash32`. As distributed-validator-specs "Definition Hash
Computation" / "Lock Hash Computation" for the file's `version`; `computeDefinitionHash` is the same function with
signatures included. Unsupported version: `DEFINITION_INVALID` (issue `version_unsupported`). Vectors:
`cluster_hashing.json` (all cases).

### cluster.prepareDefinition

Tag: `pure`. Builds an unsigned definition and its config hash; nothing is signed or sent.

Inputs:

```
{ name: string, operators: { address: Address }[], validators: { feeRecipientAddress: Address, withdrawalAddress: Address }[],
  depositAmounts: bigint[]?, compounding: bool? (false), targetGasLimit: uint? (36000000),
  consensusProtocol: "" | "qbft" ? (""), version: string? ("v1.11.0"),
  creator: Address, chainId: uint, uuid: string?, timestamp: string? }   # uuid / timestamp generated when absent
```

Checks:

1. `version` is supported, else `PAYLOAD_INVALID` (path `version`). (2.15)
2. At least 4 operators; addresses valid, unique case-insensitively; either all set or all empty (solo / Charon
   flows). Else `PAYLOAD_INVALID`. (2.15 `validateUniqueAddresses`)
3. At least 1 validator; fee recipient and withdrawal addresses non-zero. (2.15)
4. Each `depositAmounts` entry is whole gwei and one of 1, 32 ETH (or 1, 8, 32, 256 ETH with `compounding`). (2.15)
5. No unknown fields. (2.15 `additionalProperties: false`)

Output: `{ definition, configHash }` with `threshold = ceil(2n/3)` for n operators, `num_validators`, `fork_version`
of the chain, `dkg_algorithm: "default"`, `creator.address`, amounts written in gwei. (2.15)

### cluster.create

Tag: `api` (+ wallet). Input: the output of `prepareDefinition` (or its input). Signs `CreatorConfigHash
{ creator_config_hash: configHash }` with the wallet and posts the definition.

Checks:

1. G3. The wallet account equals `definition.creator.address`, else `PAYLOAD_INVALID` (path `creator`). (new)
2. Recompute `configHash` from the definition; it must equal the one in the input, else `DEFINITION_INVALID`. (new;
   guards against an edited prepared definition)

Output: `configHash`. Sources: `POST /v1/definition` with `Authorization: Bearer <signature>` and `fork-version`. A
409 is `API_CONFLICT` (definition exists; read it with `cluster.get`). Terms acceptance is enforced by the API (401/403
→ `API_UNAUTHORIZED`), not checked locally. (2.15)

### cluster.accept

Tag: `api` (+ wallet). Inputs: `{ configHash: Hash32, enr: string }`.

Checks:

1. G3.
2. Fetch the definition (`GET /v1/definition/:configHash`) and run `verifyDefinition` with the client chain; any
   failure is `DEFINITION_INVALID`. (2.15 `getVerifiedClusterDefinition`)
3. An explicit `version` in the input equals the definition's version, else `DEFINITION_INVALID`. (2.15)
4. The wallet account is one of `definition.operators[].address` (case-insensitive), else `NOT_AN_OPERATOR`. (2.15)
5. If that operator already has a `config_signature` and the same ENR, return the definition without signing
   (idempotent). (2.15)

Then sign `OperatorConfigHash { operator_config_hash: configHash }` and `ENR { enr }` and
`PUT /v1/definition/:configHash` with the operator payload. Output: the updated definition.

### cluster.verifyDefinition

Tag: `pure`. Inputs: `{ definition, configHash: Hash32?, chainId: uint }`. Output: `{ ok: bool, issues: { code,
message }[] }`; `cluster.accept` throws `DEFINITION_INVALID` with these issues.

1. The definition's `config_hash` equals `configHash` when given (case-insensitive). Issue `config_hash_mismatch`.
2. Recomputed config hash equals `config_hash`. Issue `config_hash_mismatch` (or `version_unsupported`).
3. `fork_version` equals the chain's genesis fork version (`0x00000000` mainnet, `0x10000910` Hoodi, `0x00000064`
   Gnosis, `0x90000069` Sepolia). Issue `fork_version_mismatch`. (2.15)
4. For a definition with signatures: the creator and operator EIP-712 signatures as distributed-validator-specs
   "EIP-712 Signature Computation" (contract-wallet signers via EIP-1271, which makes this step `chain`). Issue
   `signature_invalid`. (2.15 `verifyDefinitionSignatures`, run only inside lock verification today; `new` for accept)

### cluster.verifyLock

Tag: `pure` (`chain` when a definition signer is a contract wallet: EIP-1271 call). Input: a lock. Output:
`{ ok: bool, step: string?, issue: string? }`.

The full "Verifying a Lock Before Use" sequence of distributed-validator-specs, plus the Obol definition and deposit
rules, in this order (first failure is reported as `step`):

1. Definition flow is one of: group (creator and every operator signed), solo (creator signed, operators carry only
   ENRs), Charon (nothing signed). Else `definition_flow_unknown`. (2.15 `definitionFlow`)
2. Definition signatures valid for the flow (as `verifyDefinition` 4). `definition_signature_invalid`.
3. Recomputed `config_hash`, `definition_hash` and `lock_hash` equal the stored values. `hash_mismatch`. (spec step 1)
4. Every validator has exactly one public share per operator, no two validators share a group key, no validator
   repeats a share (case-insensitive). `share_layout_invalid`. (spec step 2)
5. The shares reconstruct the group key, checking every share: recover from the first `threshold`, then once per
   remaining share substituted in. `share_reconstruction_failed`. (spec step 3)
6. For v1.8.0+: every amount in `deposit_amounts` appears in each validator's `partial_deposit_data`; each deposit has
   the validator's group pubkey, credentials `0x01` (or `0x02` with `compounding`) + 11 zero bytes + the validator's
   withdrawal address, and a valid BLS signature in the deposit domain of the fork. `deposit_data_invalid`. (2.15)
7. Each builder registration has the group pubkey and the definition's fee recipient, and a valid signature in the
   builder domain. `builder_registration_invalid`. (2.15; distributed-validator-specs leaves it out of scope)
8. One node signature per operator, each a valid secp256k1 signature over `lock_hash` by the operator's ENR key;
   `signature_aggregate` verifies over `lock_hash` against all public shares in file order (plain aggregate).
   `lock_signature_invalid`. (spec step 4)

Large locks run the share, BLS and aggregate checks in worker chunks (Node CJS build); exceeding the time limit throws `LOCK_VERIFICATION_TIMEOUT` (not a verdict), too
many concurrent runs throw `LOCK_VERIFICATION_BUSY`. (2.15) Vectors: the `cluster_hashing.json` hash cases. (`real_keys_3_of_4` has placeholder EIP-712, deposit and builder
signatures, so it stops at `definition_signature_invalid`; it is not a full-pass fixture.)

### cluster.get / cluster.getLock

Tag: `api`. `get(configHash)` → definition (`GET /v1/definition/:configHash`). `getLock({ configHash } | { lockHash })`
→ lock (`GET /v1/lock/configHash/:configHash` or `GET /v1/lock/:lockHash`). Check: the hash is 32-byte hex before it
goes in the path (`PAYLOAD_INVALID`). Not found: `API_NOT_FOUND`. The returned file is not verified; use
`verifyDefinition` / `verifyLock` (or `deposits.fromLock`, which verifies by default).

`get` and `getLock` check that the returned file's `config_hash` / `lock_hash` (case-insensitive) equals the
requested one, else `API_RESPONSE_MISMATCH`. Cheap, and it catches a wrong API answer. (new; 2.15 did not)

### cluster.watch

Tag: `api`. Inputs: `configHash: Hash32`, `{ signal: AbortSignal, intervalMs: uint? }`. Output: an async iterable of

```
{ type: "operator_signed", address: Address, signed: uint, total: uint }
{ type: "definition_ready" }
{ type: "lock_published", lockHash: Hash32 }
```

Rules: poll `GET /v1/definition/:configHash` until every operator has `config_signature` and `enr_signature`, emitting
`operator_signed` once per newly signed operator and `definition_ready` once; then poll
`GET /v1/lock/configHash/:configHash` (404 = not yet) until it returns, emit `lock_published` and end. A
`definition_ready` / `lock_published` that is already true on the first poll is still emitted. Abort ends the
iteration without an error. API errors other than 404 are thrown from the iterator. See
[`lifecycles.md`](lifecycles.md#cluster).

Polling: every `intervalMs` (default 12,000, minimum 2,000); after an `API_RATE_LIMIT`, `API_TIMEOUT` or 5xx it
doubles the wait up to 60,000 and returns to `intervalMs` after a success, and only throws after 5 failures in a row.
An API stream would replace this later without changing the events.

## deposits

Deposit data amounts are wei in the SDK and gwei on the wire. Constants: minimum 1 ETH; maximum 32 ETH for `0x00` /
`0x01` credentials, 2048 ETH for `0x02` and for any top-up.

### deposits.fromLock

Tag: `pure`. Inputs: `lock`, `{ amount: bigint?, verify: bool? (true) }`. Output:

```
{ lockHash: Hash32, amounts: bigint[] (ascending), depositsByAmount: map bigint -> Deposit[], deposits: Deposit[]? }
```

Checks:

1. With `verify`, `cluster.verifyLock` must pass, else `LOCK_INVALID` (with `step`). (2.15 `getDepositData`)
2. The lock has at least one validator; each has `partial_deposit_data` (v1.8.0+) or `deposit_data`. Else
   `LOCK_INVALID` (issue `deposit_data_missing`). (2.15)
3. Each deposit: pubkey, credentials, signature are well-formed hex of the right length, `amount` is a positive
   integer (gwei); the pubkey equals the validator's `distributed_public_key`; a present `deposit_data_root` equals the
   recomputed root (an absent one is computed). Else `LOCK_INVALID` (issue `deposit_data_invalid`). (2.15)
4. Duplicate amounts for one validator keep the first. (2.15)
5. With `amount`, every validator has a deposit of that amount, else `DEPOSIT_AMOUNT_NOT_IN_LOCK` (lists the available
   amounts). Without `amount`, `deposits` is set only when the lock has one amount. (2.15)

The lock's `fork_version` must match the client chain when called through the client (`LOCK_INVALID`, issue
`fork_version_mismatch`). (2.15 `getDepositData`)

### deposits.verifyDepositData

Tag: `pure`. Inputs: `deposits: Deposit[]`, `{ chainId: uint, kind: "deposit" | "topUp" (default "deposit"),
expectedWithdrawalAddress: Address? }`. Output: nothing (throws on the first failure).

For each deposit in order, then the signatures (vectors `deposit_checks.json`):

1. `kind` is `deposit` and the signature is all zero: `DEPOSIT_LOOKS_LIKE_TOP_UP`. A zero-signature deposit to a new
   validator is ignored by the beacon chain and the ETH is not recoverable. (2.15)
2. `amount` is whole gwei (`amount_not_whole_gwei`) and ≥ 1 ETH (`amount_below_minimum`). (2.15)
3. Credentials prefix is `0x00`, `0x01` or `0x02` (`credentials_prefix_unknown`); for `0x01` / `0x02`, bytes 1–11 are
   zero (`credentials_malformed`). (2.15)
4. `amount` ≤ 2048 ETH if the prefix is `0x02` or `kind` is `topUp`, else ≤ 32 ETH (`amount_above_maximum`). (2.15)
5. With `expectedWithdrawalAddress`: the prefix is not `0x00` and the last 20 bytes equal it, case-insensitive
   (`credentials_mismatch`); a `topUp` may instead have all-zero credentials. (2.15)
6. `depositDataRoot` equals `hash_tree_root(DepositData{pubkey, withdrawal_credentials, amount_gwei, signature})`
   (`root_mismatch`). (2.15)
7. `kind` is `deposit`: the chain must have a known genesis fork (`UNSUPPORTED_CHAIN`); every signature verifies
   against the pubkey over `DepositMessage{pubkey, withdrawal_credentials, amount_gwei}` in the deposit domain
   (`DOMAIN_DEPOSIT 0x03000000`, genesis fork version, zero genesis validators root). Batch-verified with random
   weights, so each signature must be valid on its own; on failure the first invalid index is reported (`signature_invalid`; a signature that is not a curve point also counts). (2.15)

Failures 2–7 are `DEPOSIT_INVALID` with `issue` and `index`.

### deposits.status

Tag: `api+chain`. Inputs: `pubkeys: Pubkey[]`, `{ beaconUrl: string?, lockHash: Hash32? }`. Output per pubkey:

```
{ pubkey, status: "new" | "queued" | "active" | "exited", source: Source,
  beaconStatus: string?,      # the raw beacon name: "pending_deposit" (EIP-6110 queue only), "pending_initialized", "active_ongoing", ...
  validatorIndex: uint?, withdrawalCredentials: Hex32?, balance: bigint?, effectiveBalance: bigint?,
  pendingDeposits: { amount: bigint, withdrawalCredentials: Hex32 }[] }
```

Mapping (beacon names): no registry entry and no pending deposit → `new`; a pending deposit (EIP-6110
`pending_deposits`) and no registry entry, or a registry entry in `pending_initialized` / `pending_queued` → `queued`;
`active_*` → `active`; `exited_*` / `withdrawal_*` → `exited`.

Sources: API (a by-pubkey endpoint is planned, design "API enrichment"; until then `GET /v1/state/:lockHash` with
`pending_deposit`, which answers by lock: `lockHash` is required with the API, the lock is fetched first, a pubkey
not in it is `PAYLOAD_INVALID` (issue `not_in_lock`), and a pubkey the lock has but `/state` leaves out is `new`); chain
fallback with `beaconUrl`: `POST /eth/v1/beacon/states/head/validators` and
`GET /eth/v1/beacon/states/head/pending_deposits`, pending queue read before the registry so a deposit moving from
the queue to the registry is not missed (2.16 `existingDeposits.ts`). Without API and `beaconUrl`: `API_DISABLED`.
A malformed or incomplete answer (missing pubkey, duplicate result, bad credentials) or a failed beacon request is
`STATUS_UNAVAILABLE`, never a guessed `new`. (2.16)

The writes that read status (`prepareDeposit`, `prepareWithdraw`, `prepareConsolidate`, `prepareEoaWithdraw`) take
the same `beaconUrl` / `lockHash` options. A source that is configured and fails makes the write throw; the status
checks are skipped (with `DEPOSIT_EXISTENCE_UNCHECKED` for deposits) only when there is no source at all.

`queued` is deliberately broad; `beaconStatus` tells the cases apart. They behave differently for a second deposit:
a registry `pending_initialized` / `pending_queued` validator can still take the rest of a chunked activation deposit,
while an app may refuse further deposits to a `pending_deposit` pubkey until the queue processes it (the launchpad
does). `beaconStatus` is `"pending_deposit"` for a pubkey only in the queue and absent for `new`.

### deposits.prepareDeposit

Tag: `chain` (uses `deposits.status` when available). Inputs:

```
{ deposits: Deposit[], kind: "deposit" | "topUp" (default "deposit"),
  via: { ovm: Address } | { batch: true },          # OVM.deposit, or the batch deposit contract
  expectedWithdrawalAddress: Address?,               # required with batch; with ovm it is the OVM address
  from: Address? }                                   # sender, for the role check; default the wallet account
```

Checks:

1. `deposits.verifyDepositData` with `expectedWithdrawalAddress` = the OVM address (via ovm) or the given address
   (via batch; required, `PAYLOAD_INVALID`). (2.15; 2.15 let `eoa.deposit` omit the address, v3 does not)
2. Via ovm: `ovm.verify(ovm)` is `obol`, else `OVM_NOT_OBOL` (notObol) or `PROVENANCE_UNKNOWN` (unknown). The
   principal is at stake, so unknown is an error here. (new; 2.16 rule)
3. Via ovm: the sender is the owner or holds `DEPOSIT_ROLE` (`owner()`, `rolesOf(from)`), else `OVM_ROLE_MISSING`
   (the call would revert). (new)
4. Via batch with credentials pointing at a contract that `ovm.verify` says is `obol`: Finding `OVM_STAKE_NOT_TRACKED`
   (warning). The batch contract does not raise `amountOfPrincipalStake`, so the principal would later be routed as
   rewards unless the owner calls `setAmountOfPrincipalStake`. (new; from `ObolValidatorManager.deposit`)
5. Existence, when `deposits.status` can answer (API or `beaconUrl`; else Finding `DEPOSIT_EXISTENCE_UNCHECKED`,
   info):
   - a pending deposit for the pubkey has different or unknown credentials → `DEPOSIT_CONFLICT` (2.16);
   - `kind: "topUp"` and the pubkey is `new` → `DEPOSIT_TOP_UP_TARGET_MISSING` (new);
   - `kind: "deposit"` and the validator exists → Finding `DEPOSIT_IS_TOP_UP` (warning: credentials are ignored, the
     validator keeps its own) (2.16 message);
   - same-credential deposits already queued → Finding `DEPOSIT_ALREADY_QUEUED` (info) (2.16);
   - `kind: "topUp"` to an `exited` validator → Finding `TOP_UP_EXITED_VALIDATOR` (warning) (new);
   - the validator has `0x01` (or `0x00`) credentials and `balance` + queued amounts + this deposit > 32 ETH →
     Finding `TOP_UP_ABOVE_EFFECTIVE_CAP` (warning: the excess is swept back to the withdrawal address by the next
     partial-withdrawal sweep, not staked) (new).

   `DEPOSIT_ALREADY_QUEUED` is info because a chunked activation deposit is legitimate. An app may treat it as a stop
   for `beaconStatus = "pending_deposit"`.
6. The target contract has code: the OVM (2.15 implicit), or the chain's batch deposit contract
   (`0xcD7a6C118Ac8F6544BC5076F2D8Fb86D2C546756` mainnet, `0x4c9506eE2fCd962f03022D9d8ebf6f7828abEfaf` Hoodi), else
   `CONTRACT_NOT_AVAILABLE`.

Output: `Prepared<DepositPreview>[]`:

- via ovm: one per deposit (through Multicall3 the OVM would see Multicall3 as the sender, and anyone can call
  Multicall3, so it must not hold `DEPOSIT_ROLE`), `OVM.deposit(pubkey, withdrawal_credentials,
  signature, deposit_data_root)`, `value = amount`. (2.15 `depositOVM`)
- via batch: one per 500 deposits, `batchDeposit((pubKey, withdrawalCredentials, signature, amount)[])` (the
  contract computes each deposit data root itself; check 1 has already verified ours), `value` = sum of amounts.
  (2.15 `submitEOABatchDeposit`)

`DepositPreview = { pubkeys: Pubkey[], total: bigint, kind }`.

A Safe that holds `DEPOSIT_ROLE` can still deposit to several validators with one signature: it batches the
`Prepared[]` requests with Safe `MultiSend` (a `delegatecall`, so the Safe stays `msg.sender` and its role applies).
Planning top-ups (how much each validator needs to reach the next whole-ETH effective balance) is left to the app.

## ovm

ObolValidatorManager (`obol-splits/src/ovm`). Factories: mainnet `0x2c26B5A373294CaccBd3DE817D9B7C6aea7De584`
(deployed at block 23919948), Hoodi `0x5754C8665B7e7BF15E83fCdF6d9636684B782b12` (block 1735335).

### ovm.OVM_ROLES / ovm.expectedWithdrawalCredentials

Tag: `pure`. `OVM_ROLES = { WITHDRAWAL: 0x01, CONSOLIDATION: 0x02, SET_BENEFICIARY: 0x04, RECOVER_FUNDS: 0x08,
SET_REWARD: 0x10, DEPOSIT: 0x20 }` (matches the contract constants). The owner may call every role-gated function.
`expectedWithdrawalCredentials(ovm, prefix: "0x01" | "0x02")` = `prefix ‖ 11 zero bytes ‖ ovm`, lowercase. (2.16)

### ovm.verify

Tag: `api+chain`. Input: `ovm: Address`. Output: `{ status: "obol" | "notObol" | "unknown", source: Source,
factoryAddress: Address, reason: string, creationTxHash: Hash32? }`. (2.16 `OVM.verify`, launchpad rules)

1. `getCode(ovm)`: a read error → `unknown` / chain. Empty code, or an EIP-7702 delegation (`0xef0100…`) → `notObol` /
   chain.
2. API creation record (new `GET /v1/ovm/:network/:address`; interim `GET /v1/eth/contract-creation/:network/:address`):
   if it is for this address and names a creating factory, `obol` / api when it equals the chain's OVM factory, else
   `notObol` / api. No record or an API error → step 3.
3. Chain: `eth_getLogs` on the factory for `CreateObolValidatorManager(address indexed ovm, address indexed owner,
   address beneficiary, address rewardRecipient, uint64 principalThreshold)` with `topic1 = ovm`, from the factory
   deployment block to head in 50,000-block chunks (a few at a time), stopping at the first match: found → `obol` /
   chain with `creationTxHash`; none → `notObol` / chain; any failed chunk → `unknown` / chain.

Never decided by a bytecode or function-signature probe: a look-alike contract would pass. "Could not check" is always
`unknown`, never `notObol`.

### ovm.getState

Tag: `api+chain` (money values always `chain`). Input: `ovm`. Output:

```
{ address, blockNumber: uint, owner, principalRecipient, rewardRecipient,
  amountOfPrincipalStake: bigint, fundsPendingWithdrawal: bigint, principalThreshold: bigint (wei),
  version: string?, balance: bigint, pullBalances: { principalRecipient: bigint, rewardRecipient: bigint },
  distributable: bigint, principalPayout: bigint, rewardPayout: bigint,   # what distributeFunds() would pay now
  principalOnBeaconChain: bigint?,                                         # API only, see below
  findings: Finding[], source }
```

Chain read: one Multicall3 `aggregate3` of `owner`, `principalRecipient`, `rewardRecipient`, `amountOfPrincipalStake`,
`fundsPendingWithdrawal`, `principalThreshold` (gwei → wei), `version` (may fail: `null`), `getEthBalance(ovm)`,
`getBlockNumber`; then `getPullBalance` of both recipients at that block. Any required getter failing →
`OVM_READ_FAILED`. Does not check provenance; call `verify`. (2.16)

`distributable`, `principalPayout` and `rewardPayout` follow `ObolValidatorManager._distributeFunds` (vectors
`distribution.json` `routing`): `distributable = balance − fundsPendingWithdrawal`; if `distributable ≥
principalThreshold` and `amountOfPrincipalStake > 0`, principal gets `min(distributable, amountOfPrincipalStake)` and
rewards the rest; otherwise rewards get everything. One call gives a page its "to distribute" figure and routing.

**`amountOfPrincipalStake` is a routing counter, not a measure of stake.** Anyone holding `DEPOSIT_ROLE` raises it
with each `OVM.deposit`, including deposits to validators with other credentials, and repeating a deposit with the
same ETH (exit, redeposit) raises it again; at distribution the excess comes out of rewards. Never use it for
incentives, TVS or "staked" figures. With the API, `principalOnBeaconChain` is the ETH the beacon chain credited to
validators with this OVM's credentials minus principal already paid out (indexed by the API); when it differs from
`amountOfPrincipalStake` by more than 1 ETH, `findings` has `PRINCIPAL_STAKE_MISMATCH` (warning) with both values.
Without the API both are absent.

### ovm.getValidators

Tag: `api`. Input: `ovm`. Output: `{ validators: { pubkey, lockHash: Hash32?, status, beaconStatus, balance: bigint?,
withdrawalCredentials: Hex32 }[], blockNumber }`: every validator, in any cluster, whose credentials (or queued
deposit's credentials) point at the OVM. Source: the new `GET /v1/ovm/:network/:address` (`validators`). Statuses as
`deposits.status`.

### ovm.getRoleHolders

Tag: `api+chain`. Input: `ovm`. Output: `{ owner, holders: { address, roles: uint, roleNames: string[], isOwner:
bool }[], source, blockNumber }`.

1. Candidates from `RolesUpdated(address indexed user, uint256 indexed roles)` logs of the OVM from the factory deployment
   block: API (new OVM endpoint; interim `GET /v1/eth/logs/:network?address&topic0&fromBlock`, used only if
   `status = "1"` and not truncated) plus an RPC scan of the last 50,000 blocks; else a full chunked RPC scan. A failed
   full scan → `OVM_ROLE_EVENTS_UNAVAILABLE`. (2.16)
2. `owner()` and `rolesOf(candidate)` in one `aggregate3` at head; `owner()` failing → `OVM_READ_FAILED`.
3. The owner is always the first holder (with its roles, possibly 0); other candidates with roles 0 are dropped.

Roles shown come from `rolesOf`, never from the events alone.

### ovm.prepareWithdraw

Tag: `chain`. Inputs: `{ ovm: Address, requests: { pubkey: Pubkey, amount: bigint }[], fee: bigint?,
excessFeeRecipient: Address?, from: Address?, acknowledgeFullExit: true? }`. `amount = 0` is a full exit (EIP-7002).

Checks:

1. At least one request; each `amount` whole gwei and ≤ 2^64−1 gwei (`PAYLOAD_INVALID`). (2.15 schema; units new)
   Any `amount = 0` requires `acknowledgeFullExit: true`, else `FULL_EXIT_NOT_ACKNOWLEDGED`: an exit is
   irreversible and takes the validator offline, and 0 is too easy to pass by accident. (new)
2. `excessFeeRecipient` (default: `from`, else the wallet account) is non-zero. (2.15)
3. `ovm.verify`: `notObol` → `OVM_NOT_OBOL`; `unknown` → Finding `PROVENANCE_UNKNOWN` (warning). (new)
4. Sender is owner or holds `WITHDRAWAL` (`OVM_ROLE_MISSING`). (new)
5. Fee: read the EIP-7002 fee (`eth_call` to `0x00000961Ef480Eb55e80D19ad83579A64c007002` with empty data; empty or
   failed → `FEE_READ_FAILED`), then resolve the total: default `2 × fee × n` (the OVM refunds excess); a given `fee`
   must be in `[fee × n, max(10 × fee, 1 gwei) × n]`, else `FEE_OUT_OF_RANGE`. Vectors `request_fees.json`. (2.15)
6. With `deposits.status` available, per pubkey (Findings, warning): credentials do not point at the OVM →
   `WITHDRAW_CREDENTIALS_NOT_OVM` (the request is ignored, the fee is kept); `amount > 0` and credentials are not
   `0x02` → `WITHDRAW_PARTIAL_REQUIRES_COMPOUNDING`; validator not `active` → `WITHDRAW_VALIDATOR_NOT_ACTIVE`. (new)
Output: `Prepared<{ requests: { pubkey, amount, routedAs, principalPart, rewardPart }[], totalFee: bigint,
maxFeePerRequest: bigint }>` with
`OVM.withdraw(pubKeys, amounts_gwei, maxFeePerWithdrawal = floor(totalFee / n), excessFeeRecipient)`,
`value = totalFee`. The contract requires `value ≥ maxFeePerWithdrawal × n` and `currentFee ≤ maxFeePerWithdrawal`.

`routedAs` (`"principal" | "reward" | "mixed"`) says how a distribution right after this request's ETH arrives would
route it, if nothing else arrives: the routing above applied to `distributable + amount` (for a full exit, `amount` is
the validator's balance from `deposits.status`, else `routedAs` is absent). With the default 16 ETH threshold, a
withdrawal of 16 ETH or more is paid as principal while `amountOfPrincipalStake` lasts.

### ovm.prepareConsolidate

Tag: `chain`. Inputs: `{ ovm, requests: { sources: Pubkey[], target: Pubkey }[], acknowledgeStakeMovesToTarget: true,
fee: bigint?, excessFeeRecipient: Address?, from: Address? }`.

Checks:

1. `acknowledgeStakeMovesToTarget` is exactly `true`, else `CONSOLIDATION_NOT_ACKNOWLEDGED` (checked first, also for
   untyped callers). (2.16)
2. Each request has 1–63 sources (contract limit; else it reverts) (`PAYLOAD_INVALID`). (new, from contract)
3. Provenance and role (`CONSOLIDATION`) as `prepareWithdraw` 3–4.
4. Fee as `prepareWithdraw` 5 with the EIP-7251 predeploy `0x0000BBdDc7CE488642fb579F8B00f3a590007251` and
   n = total sources; read failure `FEE_READ_FAILED`. (2.16)
5. With status (warnings): a target not `active` or without `0x02` credentials → `CONSOLIDATION_TARGET_NOT_COMPOUNDING`;
   source and target with different credentials → `CONSOLIDATION_CREDENTIALS_DIFFER`. (new; EIP-7251 rules)

Output: `OVM.consolidate((srcPubKeys, targetPubKey)[], maxFeePerConsolidation = floor(totalFee / n),
excessFeeRecipient)`, `value = totalFee`.

### ovm.prepareDistribute

Tag: `chain`. Inputs: `{ ovm, mode: "push" | "pull" (default "push") }`. Calls `distributeFunds()` or
`distributeFundsPull()` (anyone may call).

1. Provenance as `prepareWithdraw` 3.
2. Read state on-chain (`getState`); `distributable = 0` → `NOTHING_TO_DISTRIBUTE`.

Preview: the routing of `distribution.json` `routing` (`distributable`, `principalPayout`, `rewardPayout`) with the
recipients. Use `splits.prepareDistribution` to also distribute the splits behind the recipients.

`ovm.previewDistribute(input)` (`chain`) runs the same reads and returns `preview & { blockNumber, checks }` without
throwing for `NOTHING_TO_DISTRIBUTE` (zeros instead), so a page can show the figures with the button disabled. It is
not a `Prepared`, so it cannot be sent by mistake.

### ovm role and ownership writes

Tag: `chain`. Thin wrappers; each returns `Prepared<{ function, args }>` calling the OVM function of the same name.
Shared checks: `ovm` provenance as `prepareWithdraw` 3; the sender's authority as below (`OVM_ROLE_MISSING` /
`NOT_OVM_OWNER`), read on-chain. (2.16 wrappers; authority checks new)

| Operation | Contract call | Authority | Input checks |
|---|---|---|---|
| `prepareGrantRoles` | `grantRoles(user, roles)` | owner | `user` non-zero; `roles` non-zero subset of `OVM_ROLES` |
| `prepareRevokeRoles` | `revokeRoles(user, roles)` | owner | same |
| `prepareRenounceRoles` | `renounceRoles(roles)` | sender holds them | `roles` as above |
| `prepareRequestOwnershipHandover` | `requestOwnershipHandover()` | anyone (the new owner) | – |
| `prepareCancelOwnershipHandover` | `cancelOwnershipHandover()` | requester | – |
| `prepareCompleteOwnershipHandover` | `completeOwnershipHandover(pendingOwner)` | owner | `pendingOwner` non-zero; `ownershipHandoverExpiresAt(pendingOwner)` > now, else `OWNERSHIP_HANDOVER_NOT_PENDING` |
| `prepareTransfer` | `transfer(newBeneficiary, newOwner)` | owner | both non-zero |
| `prepareSetBeneficiary` | `setBeneficiary(newBeneficiary)` | owner or `SET_BENEFICIARY` | non-zero |
| `prepareSetRewardRecipient` | `setRewardRecipient(newRewardRecipient)` | owner or `SET_REWARD` | non-zero |
| `prepareSetAmountOfPrincipalStake` | `setAmountOfPrincipalStake(amount)` | owner or `SET_BENEFICIARY` | `amount` uint256 wei |
| `prepareSweep` | `sweep(beneficiary, amount)` | anyone; owner when `beneficiary` is set | `amount` ≤ principal recipient's pull balance (0 = all); `beneficiary` default zero (= principal recipient) |
| `prepareWithdrawPullBalance` | `withdrawPullBalance(account)` | anyone | `account` non-zero; pull balance 0 → `NOTHING_TO_DISTRIBUTE` |
| `prepareRecoverFunds` | `recoverFunds(token, recipient)` | owner or `RECOVER_FUNDS` | both non-zero |

Previews and findings on these writes:

- `prepareSetAmountOfPrincipalStake`: preview `{ current, next, delta }` (wei, `delta` signed): raising it by 32 ETH
  means reward recipients get 32 ETH less at the next distribution.
- `prepareTransfer` and `prepareCompleteOwnershipHandover`: Finding `ROLES_SURVIVE_TRANSFER` (warning) listing the
  current non-owner role holders (`ovm.getRoleHolders`), since a transfer does not revoke roles. Absent when there are
  none; if the holders cannot be read, Finding `ROLE_HOLDERS_UNCHECKED` (info).
- `prepareGrantRoles`: Finding `ROLE_GRANT_CONSOLIDATION` (warning) when `roles` includes `CONSOLIDATION` (the holder
  can consolidate every validator into one it controls, moving the whole stake); Finding
  `ROLE_GRANT_DEPOSIT_TO_PRINCIPAL` (warning) when `roles` includes `DEPOSIT` and `user` is the principal recipient
  (it can raise `amountOfPrincipalStake` and take rewards as principal; see `getState`).

`transferOwnership` and `renounceOwnership` are not wrapped: `transfer` and the two-step handover cover the use, and
renouncing leaves an OVM without an owner. (2.16 did not wrap them either.)

## splits

0xSplits v2 PullSplit factory `0x5cbA88D55Cec83caD5A105Ad40C8c9aF20bE21d1`, Warehouse
`0x8fb66F38cF86A3d5e8768f8F1754A24A6c661Fb8` (both chains), default salt
`0x2fa740d39f3b04b2c7ef4e9f9e1a6e38f4c72c1a91d8595d5d31a3adf17c6b12`. RAF recipient: mainnet
`0xDe5aE4De36c966747Ea7DF13BD9589642e2B1D0d`, Hoodi `0x43F641fA70e09f0326ac66b4Ef0C416EaEcBC6f5`.

### splits.percent / splits.formatPercent / splits.splitParams

Tag: `pure`. Vectors `split_shares.json`.

- `percent(p: string | number)` → ppm: matches `^\d{1,3}(\.\d{1,4})?$`, result in `[1, 1_000_000]`, else
  `PAYLOAD_INVALID`. No float arithmetic. (2.16 `percentToShares`)
- `formatPercent(ppm)` → the shortest decimal string with at most 4 decimals (`333333` → `"33.3333"`).
- `splitParams(recipients: { address, share: bigint }[], distributionIncentive: uint)` → `SplitParams`:
  1. At least one recipient; valid, unique (case-insensitive) addresses; shares positive integers; sum exactly
     `1_000_000`. Else `PAYLOAD_INVALID` with `issue` `empty_recipients`, `invalid_address`, `duplicate_address`,
     `share_not_positive_integer` or `sum_mismatch`. (2.16 `readShares`, 2.15 float tolerance dropped)
  2. `distributionIncentive` ≤ 65535 (`PAYLOAD_INVALID`). (2.15 `distributorFeePercent ≤ 6.5535`)
  3. Recipients sorted by numeric address; `totalAllocation` = sum.

### splits.predictSplit

Tag: `chain`. Inputs: `{ params: SplitParams, owner: Address (zero = immutable), salt: Hash32? }`. Output: `{ address,
exists: bool }` from the factory's `predictDeterministicAddress(params, owner, salt)` and `isDeployed(params, owner,
salt)`. A failed `isDeployed` call is an error (`CHAIN_READ_FAILED`), not `exists: false`. (2.15 treated a failed
check as not deployed)

### splits.prepareCreateSplit

Tag: `chain`. Inputs: `{ recipients: { address, share }[], distributionIncentive: uint? (0), owner: Address? (zero),
salt: Hash32? }`. No RAF share is added here; presets add it.

1. `splitParams` checks.
2. Factory code equals the expected bytecode, else `CONTRACT_NOT_AVAILABLE`. (2.15 `isContractAvailable`)
3. `predictSplit`; `exists` → `SPLIT_ALREADY_EXISTS` (carries `address`; nothing to send).

Output: `Prepared<{ address, params }>` calling `createSplitDeterministic(params, owner, creator = 0x0, salt)` on the
factory.

### splits.getSplit

Tag: `api+chain` (state always `chain`). Inputs: `{ address, params: SplitParams?, ovm: Address? }` (the API source
is keyed by OVM, so it is asked only when `ovm` is given; `prepareDistribution` passes it). Output: `{ address, splitHash:
Hash32, owner, paused, balance: bigint, warehouseBalance: bigint, params: SplitParams?, paramsSource: Source |
"input" | null }`.

1. `getCode(address)` is non-empty and not an EIP-7702 delegation (`0xef0100…`), else `SPLIT_NOT_FOUND`. This comes
   first: a precompile (e.g. `0x…02`, SHA-256) has no code but answers every call with 32 non-zero bytes, so
   "`splitHash()` returned non-zero" alone accepts it. (new; 2.16 and the 0xSplits SDK lack it)
2. `splitHash()`, `owner()`, `paused()`, balance and Warehouse balance in one `aggregate3`. A failed call or a zero
   `splitHash` → `SPLIT_NOT_FOUND`. (2.16)
3. Params: the input `params`; else the API (`GET /v1/ovm/:network/:address` lists the params of the OVM's split
   recipients, and a split endpoint may follow); else the chain: the latest `SplitUpdated(Split)` log of the split, or,
   if it never updated, the factory's `SplitCreated(address indexed split, Split splitParams, …)` log with `topic1 =
   address` (chunked scan from the factory deployment block, as `ovm.verify` 3). Whatever the source,
   `keccak256(abi.encode((address[], uint256[], uint256, uint16)))` of the params must equal `splitHash`: for input
   params a mismatch is `SPLIT_PARAMS_MISMATCH`; an API or log answer that does not match is discarded and the next
   source tried. No matching params → `params: null`, `paramsSource: null` (not an error; `prepareDistribution` then
   throws `SPLIT_PARAMS_REQUIRED` if it needs them).

### splits.prepareDistribution

Tag: `chain`. Inputs:

```
{ ovm: Address?, rewardSplit: SplitParams & { address: Address? }?, principalSplit: (same)?,
  recipients: Address[]?,          # whose balances to withdraw; default every split recipient except the RAF
  minWithdraw: bigint? (1),        # skip a leg (OVM distribution, split distribution, recipient withdrawal) below this
  distributor: Address?, from: Address? }
```

Reads in two `aggregate3` calls pinned to one block: the OVM first (its recipients name the splits), then the splits
and balances. Vectors `distribution.json` (`routing`, `split_distribution`, `prepare`).
(2.16 `prepareDistribution`)

1. At least one of `ovm`, `rewardSplit`, `principalSplit` (`PAYLOAD_INVALID`). Split params: allocations match
   recipients in length, non-negative integers, positive sum equal to `totalAllocation`.
2. With `ovm`: provenance as `prepareWithdraw` 3; read balance, `fundsPendingWithdrawal`, `amountOfPrincipalStake`,
   `principalThreshold`, both recipients; failure → `OVM_READ_FAILED`. Routing as `ObolValidatorManager._distributeFunds`.
3. A split's `address` defaults to the OVM's matching recipient; one given and different from it →
   `SPLIT_NOT_OVM_RECIPIENT`; no address and no `ovm` → `PAYLOAD_INVALID`.
4. Reward and principal split at the same address: params must hash the same (else `SPLIT_PARAMS_MISMATCH`); it is
   distributed once with both payouts.
5. An OVM recipient that is a SplitV2 split (as `getSplit` 1–2) and has no params from the input → params from
   `getSplit` 3; none → `SPLIT_PARAMS_REQUIRED` (its funds would stay undistributed).
6. Each split's on-chain `splitHash` equals the params hash, else `SPLIT_PARAMS_MISMATCH`.
7. A split with something to distribute that is `paused` and not owned by the sender → `SPLIT_PAUSED`.
8. Splits with a non-zero `distributionIncentive` need `distributor` (default the sender), else `PAYLOAD_INVALID`.
9. No calls result → `NOTHING_TO_DISTRIBUTE`. (2.16 threw this at send)

`splits.previewDistribution(input)` runs the same reads and returns `{ preview, checks, blockNumber }` without
throwing for `NOTHING_TO_DISTRIBUTE`, for a page that shows greyed-out legs with the button disabled. Other errors
(e.g. `SPLIT_PAUSED`) still throw. A recipient in the withdrawal set whose withdrawal is left out keeps `withdraw:
true` and gets a `skipReason`.

Calls (`aggregate3` on Multicall3, in this order):

1. `distributeFunds()` on the OVM if `distributable ≥ minWithdraw` (`allowFailure: false`).
2. Per split with `distributable ≥ minWithdraw`: `distribute(params, NATIVE_TOKEN, distributor)` (`allowFailure:
   false`), where `distributable = max(splitBalance + incoming − 1, 0) + max(warehouseBalance − 1, 0)`.
3. Per withdrawn recipient whose amount (balance after the distributions, minus the 1 wei left) is `≥ minWithdraw`:
   Warehouse `withdraw(owner, NATIVE_TOKEN)` if withdrawals are not paused for it (or it is the transaction origin);
   SplitMain v1 `withdraw(account, 1, [])`. Both `allowFailure: true`: a zero balance or a paused owner reverts that
   call alone.

With the default `minWithdraw = 1` wei every non-empty leg is included (2.16 behaviour). Legs below it are still
listed in the preview with a `skipReason`.

Preview: `{ blockNumber, ovm?: { address, distributable, principalPayout, rewardPayout, principalRecipient,
rewardRecipient, skipReason? }, splits: { address, kind, distributable, distributorReward, skipReason? }[],
recipients: { address, fromOvm, fromRewardSplit, fromPrincipalSplit, warehouseBalance, splitMainBalance, withdraw:
bool, skipReason?, toWallet }[] }`. `skipReason` is set exactly when a leg is left out: `"nothing"` (0 after the 1 wei
kept), `"dust"` (positive but below `minWithdraw`) or `"paused"` (recipients only: Warehouse withdrawals paused and
the sender cannot bypass it). Each split
recipient gets `floor((distributable − distributorReward) × allocation / totalAllocation)`, with `distributorReward =
floor(distributable × distributionIncentive / 1e6)`; withdrawals leave 1 wei.

Notes:

- Warehouse `withdraw` skips the pause check when `msg.sender` or `tx.origin` is the owner. Through Multicall3 only
  `tx.origin` can match, which is the sender only when the sender is an EOA. For a Safe or other contract sender, the
  pause exemption does not apply: Finding `RECIPIENT_WITHDRAW_PAUSED` (info) for each skipped recipient, and the
  sender gets no exemption. (new; 2.16 assumed the sender is `tx.origin`)
- After mining, `splits.distributionFromReceipt(receipt)` (pure) reads Warehouse `Withdraw` (native token), SplitMain
  `Withdrawal` and OVM `DistributeFunds` logs, matching each log's emitting address. (2.16 `parseDistributionReceipt`)

## setup

### setup.prepareCreateOvm

Tag: `chain`. Inputs: `{ owner: Address, principalRecipient: Address, rewardRecipient: Address, principalThreshold:
bigint (wei, default 16 ETH) }`. Any addresses: a split, an EOA, a Safe.

1. All three addresses non-zero (factory and constructor revert otherwise). (2.15 schema + contract)
2. `principalThreshold` whole gwei, 16 ETH ≤ t ≤ 2048 ETH. (2.15 minimum 16; maximum from the factory)
3. Factory code equals the expected bytecode, else `CONTRACT_NOT_AVAILABLE`. (2.15)
4. A recipient with no code: Finding `RECIPIENT_NOT_CONTRACT` (info), to catch a split address that was predicted but
   not created yet. (new)

Output: `Prepared<{ factory: Address }>` calling `createObolValidatorManager(owner, principalRecipient,
rewardRecipient, thresholdGwei)`. The OVM address is not known before mining; read it with `ovmFromReceipt`.

### setup.prepareCreateSplit

The same operation as [`splits.prepareCreateSplit`](#splitspreparecreatesplit), exported here for setup flows.

### setup.prepareOvmWithSplits

Tag: `chain`. Inputs:

```
{ owner: Address, principalThreshold: bigint?,
  reward: { split: { recipients, distributionIncentive?, owner?, salt? } } | { address: Address },
  principal: { split: (same) } | { address: Address } }
```

1. Each `split` passes `splitParams`; `predictSplit` gives its address and `exists`.
2. `prepareCreateOvm` checks with the predicted / given addresses. Multicall3 code check (`CONTRACT_NOT_AVAILABLE`).
3. Existing splits are skipped: Finding `SPLIT_REUSED` (info) with the address. (2.15)

Output: `Prepared<{ rewardRecipient: { address, created: bool }, principalRecipient: (same) }>`:

- some split to create: Multicall3 `aggregate3([createSplitDeterministic…, createObolValidatorManager(…)])`, all
  `allowFailure: false`;
- nothing to create: the direct factory call of `prepareCreateOvm`.

Idempotent for the splits only: each send creates a new OVM. A retry after an unknown outcome should first look for
the earlier `CreateObolValidatorManager` event (by owner, `topic2`).

### setup.ovmFromReceipt

Tag: `pure` (takes `{ chainId }` for the factory address; the client fills it). Input: a receipt. Output: `{ ovm,
owner, principalRecipient, rewardRecipient, principalThreshold }` from
the `CreateObolValidatorManager` log **emitted by the chain's OVM factory**. None → `OVM_CREATE_EVENT_MISSING`; more
than one → `OVM_CREATE_EVENT_AMBIGUOUS`. (2.15 matched the event signature on any address)

### setup presets

Tag: `pure`. Data on top of the builders; each returns the `prepareOvmWithSplits` input.

| Preset | Reward recipient | Principal recipient |
|---|---|---|
| `rewardsSplit({ recipients, principalRecipient, owner })` | split: recipients (sum 990000) + RAF 10000 | the given address |
| `totalSplit({ recipients, owner, principalRecipients? })` | split: recipients + RAF | split: `principalRecipients` (sum 1e6, no RAF) or Split Everything |
| `solo({ owner, recipient })` | split: recipient 990000 + RAF | `recipient` |
| `lidoCsm(...)` | per-chain CSM addresses | per-chain CSM addresses |

Share rules (vectors `split_shares.json` `ovm_split_params`): reward shares sum to exactly 990000; RAF added with
10000; Split Everything gives each reward recipient its reward share plus `floor(10000 / n)`, and `10000 mod n` to the
first recipient in numeric address order. (2.16 `getOVMSplitParams`)

> Open: CSM addresses and roles per chain (not in 2.15 or 2.16).

## incentives

Merkle distributors (`MerkleDistributorWithDeadline`) paying OBOL: token mainnet
`0x0B010000b7624eb9B3DfBC279673C76E9D29D5F7`, Hoodi `0x6407a4f5cfa1ccb0ef9e6cfb9ee12bf9756262c3`.

### incentives.get

Tag: `api`. Input: `address`. Output: `{ operatorAddress, contractAddress, index: uint, amount: bigint, merkleProof:
Hash32[] } | null` (`null` when the API returns `contract_address: ""`). Source:
`GET /v1/address/incentives/:network/:address`. (2.15)

### incentives.isClaimed

Tag: `chain`. Inputs: `{ contractAddress, index: uint }` → `isClaimed(index)`. (2.15)

### incentives.prepareClaim

Tag: `api+chain` (API data, every check on chain). Input: `address`. (2.15 `preflightIncentivesClaim`)

Checks; each failure is an issue `{ code, message, hint }`:

1. `incentives.get`: 404 → `INCENTIVES_NOT_FOUND`; other API error → `INCENTIVES_FETCH_FAILED`; empty record →
   `NO_INCENTIVES`.
2. `operatorAddress` equals `address` (`OPERATOR_ADDRESS_MISMATCH`); contract address, index (safe non-negative
   integer), amount (decimal integer), proof (32-byte hashes) well-formed (`INVALID_INCENTIVES_DATA`). Stop here if any.
3. The contract has code (`CONTRACT_NOT_DEPLOYED`) and its code, with the 8 immutables and the metadata trailer zeroed,
   hashes to the reference build (`UNKNOWN_DISTRIBUTOR`). Stop here if any.
4. `token()` is the chain's OBOL token (`UNEXPECTED_TOKEN`).
5. Folding the proof (sorted-pair keccak256) over `keccak256(abi.encodePacked(uint256 index, address account, uint256
   amount))` gives `merkleRoot()` (`INVALID_PROOF`).
6. `isClaimed(index)` (`ALREADY_CLAIMED`); latest block timestamp ≤ `endTime()` (`CLAIM_WINDOW_CLOSED`;
   `CHAIN_READ_FAILED` if the block cannot be read).

Outcome: only `ALREADY_CLAIMED` (possibly with `CLAIM_WINDOW_CLOSED`) → throw `ALREADY_CLAIMED` (nothing to do; treat
as success). Any other issue → `INCENTIVES_PREFLIGHT_FAILED` with `issues`. Otherwise
`Prepared<{ amount, contractAddress }>` calling `claim(index, account, amount, merkleProof)`.

`incentives.preflight(address)` returns `{ ok, issues }` from the same checks without throwing. (2.15 `preflightClaim`)

## exits

Partial exits are collected by the Obol API from each operator and aggregated once a threshold is reached.

### exits.verifyPartialExit

Tag: `pure`. Inputs: `{ cluster: { operators: { enr }[], forkVersion: Hex4, threshold: uint, validators: {
distributedPublicKey, publicShares[] }[] }, payload: { shareIdx: uint, partialExits: ExitBlob[], signature: Hex65 },
existing: ExistingExit? }`. Output: the blobs that are new (already stored ones are dropped). (2.15
`validateExitBlobs`)

1. `1 ≤ shareIdx ≤ operators` (`EXIT_SHARE_INDEX_INVALID`).
2. The payload signature (secp256k1, 64 or 65 bytes) over the SSZ root of the partial exits payload is by the ENR key
   of operator `shareIdx` (`EXIT_PAYLOAD_SIGNATURE_INVALID`; an unparsable ENR is `PAYLOAD_INVALID`).
3. `forkVersion` is a chain in the chain table with a Capella fork version and a genesis validators root (mainnet,
   Hoodi), else `UNSUPPORTED_CHAIN`.
4. Per blob: the pubkey is a validator of the cluster (`EXIT_VALIDATOR_NOT_IN_CLUSTER`) with a public share at
   `shareIdx` (`EXIT_SHARE_INDEX_INVALID`).
5. Against `existing` for the same pubkey: same `validator_index` (`EXIT_VALIDATOR_INDEX_MISMATCH`); epoch not lower
   (`EXIT_EPOCH_REGRESSION`); same epoch and a different stored signature for this share (`EXIT_SIGNATURE_CONFLICT`);
   same epoch and same signature: dropped as already stored.
6. The partial signature verifies against the public share over the `VoluntaryExit{epoch, validator_index}` signing
   root in domain `DOMAIN_VOLUNTARY_EXIT 0x04000000` with the Capella fork and genesis validators root
   (`EXIT_PARTIAL_SIGNATURE_INVALID`).

Since EIP-7044 (Deneb) voluntary exits are always signed with the Capella fork version and the chain's genesis
validators root, so both come from the chain table (mainnet `0x03000000` /
`0x4b363db94e286120d76eb905340fdd4e54bfe9f06bf33ff6cf5ad27f511bfe95`, Hoodi `0x40000910` /
`0x212f13fc4df078b6cb7db228f1c8307566dcecf900867401a92023d7ba99cb5f`) and this is `pure`; there are no overrides.
Gnosis and Sepolia have no genesis validators root in the table, so their exits are `UNSUPPORTED_CHAIN`. 2.15 fetched
the root from a beacon URL.

### exits.aggregate

Tag: `pure`. Inputs: `{ existing: ExistingExit, threshold: uint, chainId: uint }` (the chain table gives the exit
domain for step 4, as in `exits.verifyPartialExit`; the client fills `chainId`; a chain without a genesis validators
root is `UNSUPPORTED_CHAIN`). `ExistingExit = { publicKey, epoch, validatorIndex, partialSignatures: { [0-based share
key]: Hex96 | "" } }`, epochs and indexes as decimal uint64 strings. Output: `{ publicKey, signedExitMessage: {
message: { epoch, validatorIndex }, signature: Hex96 } }`.

1. Signatures are 96-byte hex (`EXIT_SIGNATURE_MALFORMED`); empty entries are ignored.
2. At least `threshold` signatures (`EXIT_NOT_ENOUGH_SHARES`).
3. **Threshold aggregation**: Lagrange interpolation at 0 over the first `threshold` shares by share index
   (index = stored key + 1), as Charon `tbls.ThresholdAggregate`. Must pass distributed-validator-specs
   `bls_threshold.json` `threshold_aggregates`.
4. The result verifies against the validator's group pubkey for the exit message (`EXIT_PARTIAL_SIGNATURE_INVALID`
   otherwise; catches a bad stored share). (new)

> 2.15 `recombineExitBlobs` sums the signatures (plain aggregate). Run against `bls_threshold.json`, that gives none
> of the four expected quorum signatures, so its output is not a valid exit signature. v3 must not carry it over.

### exits BLS helpers

Tag: `pure`. `blsVerify(pubkey, message, signature)`, `blsAggregate(signatures)` (plain),
`blsThresholdAggregate({ index, signature }[])`, `blsRecoverPubkey({ index, pubshare }[])`. Vectors:
`bls_threshold.json` (all arrays).

## terms

### terms.hasAccepted

Tag: `api`. Input: `address?` (default the wallet account; neither → `WALLET_REQUIRED`). Output: `bool` from
`GET /v1/termsAndConditions/:address` `isTermsAndConditionsSigned`. (2.15)

### terms.accept

Tag: `api` (+ wallet). Input: `{ ifNotAccepted: bool? }`. Signs `TermsAndConditions { terms_and_conditions_hash,
version: 1 }` with the domain without `chainId` and posts `{ address, version, terms_and_conditions_hash, fork_version
}` to `POST /v1/termsAndConditions`. With `ifNotAccepted`, `hasAccepted` first and return without signing. 409 →
`API_CONFLICT` (already accepted). (2.15)

## send

### send

Tag: wallet. Input: `Prepared`. Output: `{ hash: Hash32, contractWallet: bool, wait(options?: { onReplaced?,
timeoutMs?, confirmations? }) }`.

1. `prepared.request.chainId` equals the client chain and the wallet chain, else `CHAIN_MISMATCH`.
2. `request` fields are well-formed (`to` an address, `data` hex, `value` ≥ 0), else `PREPARED_INVALID`.
3. The wallet rejects or fails before returning a hash: `TX_REJECTED` (nothing was sent).
4. Returns as soon as the wallet returns a hash.

`wait` uses viem `waitForTransactionReceipt`; every error carries `hash`:

- receipt `status = 0` → `TX_REVERTED` (nothing moved; retry is safe);
- replaced with viem reason `cancelled` or `replaced` (a different call was mined with the nonce) → `TX_REPLACED`
  (with the replacement's hash); `repriced` (same call, higher gas) resolves with the replacement's receipt, reported
  through `onReplaced`;
- no receipt within `timeoutMs` → `TX_UNCONFIRMED` (it may still be mined).

**Contract wallets.** A Safe connected over WalletConnect returns its `safeTxHash` from `sendTransaction`; that hash
never appears on-chain, and waiting for a receipt would time out silently. `send` therefore checks the wallet account
with `getCode`: non-empty code that is not an EIP-7702 delegation means a contract wallet, and the result has
`contractWallet: true`. For a contract wallet, `wait` does not look for a receipt of `hash`: it watches the account for
the Safe `ExecutionSuccess(bytes32 txHash, uint256 payment)` / `ExecutionFailure(bytes32 txHash, uint256 payment)` log
with `txHash = hash`, from the block `send` returned at, and resolves with the receipt of the transaction that emitted
it (`ExecutionFailure` → `TX_REVERTED`; nothing within `timeoutMs`, default 30 minutes for contract wallets →
`TX_UNCONFIRMED` with `contractWallet: true`). A contract wallet that is not a Safe never emits these, so it ends in
`TX_UNCONFIRMED`; its app tracks execution itself. This is chain-only (no Safe Transaction Service) and is the only
Safe-specific code. (2.15 waited for `ExecutionSuccess` the same way)

`waitForContractWalletExecution({ publicClient, account, safeTxHash, fromBlock, timeoutMs })` (`chain`) exposes the
same rule for apps that send through their own wallet layer (wagmi) and only need the waiting part.

See [`lifecycles.md`](lifecycles.md#transaction).

## Not placed in the module table

2.15 features the design's module table does not list. Specified here so their checks are not lost.

### withdrawals.prepareEoaWithdraw (2.15 `eoa.requestWithdrawal`)

Tag: `chain`. A withdrawal request sent by the validator's withdrawal address directly to the EIP-7002 predeploy.
Inputs: `{ pubkey, amount: bigint (wei, whole gwei; 0 = full exit), fee: bigint?, acknowledgeFullExit: true? }`.

1. Fee as `ovm.prepareWithdraw` 5 with default multiplier **1**: the predeploy keeps any excess. (2.15)
2. With status: credentials must point at the sender (`0x01`/`0x02` + sender), else Finding
   `WITHDRAW_CREDENTIALS_NOT_SENDER` (warning; the request is ignored and the fee kept). (new)
3. Full exit (`acknowledgeFullExit`) and partial rules as `prepareWithdraw` 1 and 6.

Output: `Prepared` to `0x00000961Ef480Eb55e80D19ad83579A64c007002`, `data = pubkey ‖ uint64_be(amount_gwei)`,
`value = fee`.

### legacy.getOwrTranches (2.15 `getOWRTranches`)

Tag: `chain`. Reads an existing OptimisticWithdrawalRecipient's tranches. Kept as a read (design: reads of existing
legacy contracts stay).

Placed in two small modules: `withdrawals` (direct EIP-7002 requests from a withdrawal address) and `legacy` (reads
of OWR and SplitMain v1 contracts, no creation).

## Open questions

Resolved after the launchpad review (2026-10-18); kept here with the answer so the reasoning is not lost.

1. **cluster.getLock**: yes, check the returned hashes (`API_RESPONSE_MISMATCH`).
2. **cluster.watch**: client polling with backoff as specified; an API stream later.
3. **deposits.status**: `queued` stays broad; `beaconStatus` carries the raw beacon name.
4. **splits.getSplit params**: input, then the API, then `SplitUpdated` / `SplitCreated` logs, always checked
   against `splitHash`.
5. **setup presets, Lido CSM**: still open: addresses and roles per chain to be confirmed with the Lido integration.
6. **Prepared staleness**: `blockNumber` on every `Prepared` that reads state; `send` does not refuse.
7. **exits genesis validators root**: per-chain table; the operation is `pure`.
8. **Full exits**: explicit `acknowledgeFullExit: true` (`FULL_EXIT_NOT_ACKNOWLEDGED`).
9. **prepareCreateSplit on an existing split**: throws `SPLIT_ALREADY_EXISTS` with the address.
10. **Unplaced 2.15 features**: `withdrawals` and `legacy` modules.
11. **Error class names**: two classes. `ObolError` (`code`, `message`, `hint?`, `cause?`, plus the fields each code
    lists) and `ObolApiError extends ObolError` (adds `status`, `endpoint`, `method`, `body`). Callers switch on
    `code`; there is no class per code, which also maps directly to a Go error type with a code.
12. **Address strictness**: all-lowercase, all-uppercase or valid EIP-55 accepted; mixed case with a bad checksum
    rejected; outputs checksummed.
