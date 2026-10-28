### Changelog

All notable changes to this project will be documented in this file. Dates are displayed in UTC.

#### [v3.0.0-rc.11](https://github.com/ObolNetwork/obol-sdk/compare/v3.0.0-rc.10...v3.0.0-rc.11)

> 28 October 2026

- fix(cluster): `cluster.prepareDefinition` creates only v1.10.0 and later definitions (`PAYLOAD_INVALID` at `version` for v1.6.0 to v1.8.0, which sign less of the definition and which the Obol API rejects for new clusters); older versions remain hashable and verifiable for existing clusters
- docs: `KNOWN_ISSUES.md` describes the 3.x API, with 2.x items in their own section
- Includes 2.15.2 from main (#254 to #257; the 2.x-only splits and error changes do not apply to 3.x)

#### [v3.0.0-rc.10](https://github.com/ObolNetwork/obol-sdk/compare/v3.0.0-rc.9...v3.0.0-rc.10)

> 27 October 2026

The last release candidate before 3.0.0. [MIGRATION.md](MIGRATION.md) "From 3.0.0-rc.9 to rc.10".

- `prepareDefinition` defaults `targetGasLimit` to 200,000,000 (was 36,000,000), matching `charon create cluster`.
  This changes the `config_hash` of a definition prepared with the default.
- `ObolApiError` carries `requestId` (the response's `X-Request-Id`, also appended to the message) and, on a 429,
  `retryAfterSeconds` (from `Retry-After`). A 451 (sanctioned address) gets its own hint instead of "retry later".
- From 2.15.1: `computeDepositMsgRoot` refuses a deposit pubkey or withdrawal credentials of the wrong length instead
  of letting SSZ zero-pad or truncate them.
- Internal refactors for SonarCloud (smaller functions in deposit, lock and simulation code), with every check, error
  and finding in the same order.
- `.sonarcloud.properties` scopes the analysis to the SDK and its tests (not the fuzz harness or generated files).

#### [v3.0.0-rc.9](https://github.com/ObolNetwork/obol-sdk/compare/v3.0.0-rc.8...v3.0.0-rc.9)

> 23 October 2026

Obol API request headers, from the obol-api production log review. No API changes.
[MIGRATION.md](MIGRATION.md) "From 3.0.0-rc.8 to rc.9".

**Changed**

- `Content-Type: application/json` only on requests with a body: a GET from a browser no longer needs a CORS
  preflight.
- In Node, `User-Agent: obol-sdk/<version>`, so the API can tell SDK traffic apart. Not set in browsers.

**Fixed**

- Deposit messages are hashed only from a 48-byte pubkey and 32-byte withdrawal credentials (SSZ would zero-pad or
  truncate others). Inputs were already length-checked by their schemas; the same fix ships in 2.x as #253.

#### [v3.0.0-rc.8](https://github.com/ObolNetwork/obol-sdk/compare/v3.0.0-rc.7...v3.0.0-rc.8)

> 22 October 2026

Log scans on capped, slow RPCs. No API changes. [MIGRATION.md](MIGRATION.md) "From 3.0.0-rc.7 to rc.8".

**Fixed**

- `eth_getLogs` scans start at 10,000-block windows and double after each round that works, up to 50,000, and never
  grow back to a refused size (was: 50,000 first, halving on each refusal). On eRPC, which caps the range and takes
  about 28 s to refuse, `ovm.getRoleHolders` took minutes or failed.
- The "use an RPC that serves `eth_getLogs`" hints say 1,000 blocks, the smallest window a scan uses (said 50,000).

#### [v3.0.0-rc.7](https://github.com/ObolNetwork/obol-sdk/compare/v3.0.0-rc.6...v3.0.0-rc.7)

> 22 October 2026

Fixes from the Launchpad OVM page on mainnet. No API changes. [MIGRATION.md](MIGRATION.md) "From 3.0.0-rc.6 to rc.7".

**Fixed**

- `ovm.verify`: a contract that does not answer the OVM getters is `notObol` (source `chain`) when the API gives no
  verdict, without the factory log scan (Multicall3 ended `unknown` after a long scan on public RPCs).
- `ovm.verify` takes only an `obol` verdict from the API OVM record; its `notObol` goes to the chain checks, since
  it can be an answer cached before the OVM was deployed or indexed (a just-deployed OVM read `notObol` / api).
- Multicall3 reads pinned to a block are retried once at `latest` when the RPC refuses that block (public non-archive
  RPCs behind load balancers), instead of failing with `CHAIN_READ_FAILED` (`ovm.getRoleHolders` showed "couldn't
  read the role holders").

#### [v3.0.0-rc.6](https://github.com/ObolNetwork/obol-sdk/compare/v3.0.0-rc.5...v3.0.0-rc.6)

> 21 October 2026

Queued deposit signatures from the Obol API deposit-status route (obol-api #1047). Additive.
[MIGRATION.md](MIGRATION.md) "From 3.0.0-rc.5 to rc.6".

**Required for the updated API**

- `deposits.status` asks `POST /v1/validators/:network/deposit-status` for at most 500 pubkeys per request (was
  1000), the updated API's limit; larger inputs are batched.

**Added**

- `DepositStatus.signaturesPending` and `credentialsConflict`, and `PendingDeposit.signatureValid`, from the Obol
  API (absent from a source that does not check signatures: a beacon node, the interim `/v1/state`, an older API).
  A queue-only pubkey's `withdrawalCredentials` are the first validly signed queued deposit's once every deposit
  before it is checked (as obol-api walks the queue in order), so possibly while `signaturesPending`; absent while
  an unchecked deposit comes first or when none is valid (rc.5 rejected the API's `null` there as
  `STATUS_UNAVAILABLE`).
- `pendingRetry: { tries?, delayMs? }` on `deposits.status` and the writes that read status (`StatusSource`, type
  `PendingRetry`): while an entry has `signaturesPending`, its batch is re-read (default 3 requests, waiting 8 s then
  16 s); still pending, the entry is returned as it is.
- `prepareDeposit` check 5: a queue-only pubkey still `signaturesPending` with undecided credentials is
  `STATUS_UNAVAILABLE` with details `{ reason: 'signatures_pending', pubkey }` (never guessed); with decided
  credentials it proceeds, and the unchecked later deposits count as possibly valid for `DEPOSIT_CONFLICT`; queued deposits with `signatureValid: false` are
  skipped when choosing the credentials that apply (`null` counts as possibly valid), for conflicts, the
  already-queued count and the 32 ETH cap sum; on `credentialsConflict: true`, `DEPOSIT_CONFLICT` when this
  deposit's credentials differ from the first validly signed one's, else the new warning finding
  `QUEUED_CREDENTIALS_CONFLICT` (subject the pubkey). A top-up to a pubkey whose queued deposits are all invalid is
  `DEPOSIT_TOP_UP_TARGET_MISSING`. The zero-credential top-up rule is unchanged.
- `deposits.status` checks the new fields for consistency (`STATUS_UNAVAILABLE` otherwise): pending only on a
  queue-only entry and with `credentialsConflict: null`; the credentials those of the first validly signed deposit
  when every deposit before it is checked, and `null` otherwise (none valid, or an unchecked one first), pending or
  not; and `credentialsConflict` agreeing with the deposits. `credentialsMatch` is `null` while the credentials are
  undecided.
- EIP-1271: contract-wallet signatures (`verifyTypedDataSignature`, `verifyLock` / `verifyDefinition` definition
  signatures) also pass with the legacy `isValidSignature(bytes, bytes)` → `0x20c13b0b` of Safes before 1.3.0,
  called with the 32-byte EIP-712 hash as `data` (as Safe 1.3.0's CompatibilityFallbackHandler forwards it and 2.x's
  protocol-kit called it). Each magic counts only from its own function.
- `verifyTypedDataSignature` accepts eth-sig-util's `TypedMessage`: `EIP712TypedData.domain` is looser (`salt` as
  hex or bytes, converted; `verifyingContract` any string; `chainId` number or bigint) and `primaryType` may be a
  number (from a `keyof` type). Malformed typed data is `false`, not a throw.
- `signal?: AbortSignal` on `cluster.verifyLock`, `cluster.isValidLock` and `deposits.verifyDepositData`: checked
  before the run and at every yield point; an abort throws the new error code `ABORTED` (details `{ operation }`,
  `cause` the signal's reason; `isValidLock` throws it, never `false`). The way for a server to bound the CPU per
  request (`AbortSignal.timeout(ms)`); a non-AbortSignal value is `PAYLOAD_INVALID`.
- `exits.blsVerify(pubkey, message, signature, { bls? })`: verifies with the given `BlsBackend` (blst on a
  server); type `BlsVerifyOptions`. Documented: malformed hex is `PAYLOAD_INVALID` (2.x returned `false`).

**Changed**

- `experimental.legacy.getOwrTranches` no longer requires a chain with Obol contracts: it reads only the OWR, so it
  works on any client chain, Gnosis and Sepolia included (was `UNSUPPORTED_CHAIN` there).

**Docs**

- MIGRATION.md (from the obol-api migration): the `blsVerify`, `validateAddressSignature`, hash and ENR rows made
  precise; servers reuse 2.x's `RPC_MAINNET` / `RPC_HOODI` / `RPC_GNOSIS` / `RPC_SEPOLIA` to build `publicClients`;
  `signal` for deadlines; blst platforms and warming it at boot; `viem/chains` under `module: commonjs` +
  `moduleResolution: node10` (ox `.ts` sources type-checked despite `skipLibCheck`: use `defineChain` or `bundler`).
  README "Create a client" and "Servers" notes to match.

**Unchanged**

- The beacon fallback does not check signatures: every queued deposit counts as possibly valid (spec
  "deposits.status", source 3), so an invalidly signed queued deposit with other credentials is still a
  `DEPOSIT_CONFLICT` there.

#### [v3.0.0-rc.5](https://github.com/ObolNetwork/obol-sdk/compare/v3.0.0-rc.4...v3.0.0-rc.5)

> 21 October 2026

Review fixes for the obol-api and Launchpad migrations. Additive except for the two changes under **Breaking**.
[MIGRATION.md](MIGRATION.md) has "Verifying locks on a server", a row for every 2.x export the two consumers use, and
"From 3.0.0-rc.4 to rc.5".

**Breaking**

- `cluster.verifyLock` reports a definition signature it could not check as the new step
  `definition_signature_unverifiable` (was `definition_signature_invalid`): one that does not recover to its signer
  when no public client for the lock's chain was given, so a contract wallet (Safe) could not be asked (EIP-1271).
  A signature known to be invalid still fails as `definition_signature_invalid`, and wins when both occur.
  `verifyDefinition` (and `DEFINITION_INVALID` from `cluster.accept`) reports the issue `signature_unverifiable`.
- `send` passes the client's viem chain to `sendTransaction` (was `walletClient.chain ?? null`), so viem re-checks
  the wallet chain at send time: a wallet switched after the wallet check is `CHAIN_MISMATCH` (nothing sent).
  `Context` has an optional `viemChain` (set by `createObolContext`; a hand-built context falls back to a minimal
  chain with the same id).

**Added**

- `isValidLock(lock, options?)` (root, `cluster`, `/cluster`, bound `obol.cluster.isValidLock`): `verifyLock` at
  `level: 'full'` as a boolean, the drop-in for 2.x `validateClusterLock`; a malformed lock (`PAYLOAD_INVALID`) is
  `false`, malformed options and other errors are thrown.
- `publicClients` on `verifyLock`, `verifyDefinition` and `isValidLock`: public clients by chain id, or a function
  of the chain id, for EIP-1271 definition signatures of locks on several chains (2.x had built-in RPCs). The bound
  module adds the client's own `publicClient` for its chain.
- `@obolnetwork/obol-sdk/blst` (Node only): `loadBlstBackend()` and `blstBackendFrom(module)`, the `BlsBackend` over
  `@chainsafe/blst`, now an optional peer dependency loaded with a dynamic import by this entry only. New code
  `BLS_BACKEND_UNAVAILABLE`.
- `verifyTypedDataSignature({ address, signature, typedData, chainId?, publicClient?, publicClients? })` (root and
  `cluster`): EIP-712 signature check for an account (recovery) or a contract wallet (EIP-1271), for 2.x
  `validateAddressSignature` / `validateEOASignature`; types `EIP712TypedData`, `PublicClients`,
  `SignatureClients`.
- `cluster.parseEnr(enr)` / `cluster.isValidEnr(enr)` for 2.x `ENR.decodeTxt`; type `cluster.ClusterValidator`.
- MIGRATION.md: "Verifying locks on a server" (obol-api: `isValidLock`, the blst backend, `publicClients`,
  `PAYLOAD_INVALID` → 400, `full` only) and "Every other 2.x export" (`ENR`, `clusterConfigOrDefinitionHash`,
  `signCreatorConfigHashPayload`, `SPLITS_V2_SALT`, `PRINCIPAL_THRESHOLD`, `CHAIN_CONFIGURATION`,
  `ClaimableIncentives`, `ClusterValidator`, ...). README "Servers".

**Fixed**

- `ovm.prepareWithdraw` / `withdrawals.prepareEoaWithdraw`: a partial withdrawal whose excess balance is under
  1 gwei is `NO_EXCESS_BALANCE`; the cap could round it to amount 0, which EIP-7002 treats as a full exit.
- Trailing `/` of `api.baseUrl` and `beaconUrl` are trimmed with a linear scan instead of a regular expression
  (CodeQL polynomial-regex alerts); the e2e workflow has `permissions: contents: read`.
- The spec and TSDoc say that `verifyLock` recomputes `config_hash` (it binds the definition signatures to the
  definition), with tests for an edited definition, a recomputed `config_hash` under old signatures, and a
  self-consistent lock carrying another cluster's `config_hash`.

#### [v3.0.0-rc.4](https://github.com/ObolNetwork/obol-sdk/compare/v3.0.0-rc.3...v3.0.0-rc.4)

> 21 October 2026

Freezes the public shape before 3.0 and hardens behaviour. **Pin this release exactly: it breaks rc.3 call sites.**
After rc.4 only additive changes are planned until 3.0. [MIGRATION.md](MIGRATION.md) has before / after snippets.

**Breaking**

- `Prepared` has a `kind` discriminant (`deposit`, `withdraw`, `consolidate`, `distribute`, `distribution`,
  `createOvm`, `ovmWithSplits`, `createSplit`, `claim`, `eoaWithdraw`, `role`, `ownership`, `recipient`,
  `principalStake`, `sweep`, `withdrawPullBalance`, `recoverFunds`) and is typed `Prepared<K>` with
  `preview: PreviewByKind[K]`; `AnyPrepared` is the union. `send` and `simulate` take `AnyPrepared` and refuse a value
  without a known `kind` (`PREPARED_INVALID`).
- One preview shape: `ovm.previewDistribute` returns `{ preview, checks, blockNumber }` (was the preview flattened);
  `DistributionPreview` no longer has `blockNumber` (it is the top-level one).
- `DistributionPreview` recipients: `toWallet` is replaced by `alreadyWaiting` (Warehouse + SplitMain balance before
  this transaction) next to `fromThisDistribution`; the preview has `minWithdraw`.
- `splits.prepareDistribution` / `previewDistribution` withdraw for every split recipient by default, the Obol RAF
  address included (`includeRaf: false` leaves it out, with `RAF_LEFT_IN_WAREHOUSE`).
- `ovm.prepareSetBeneficiary({ newBeneficiary })` is `ovm.prepareSetPrincipalRecipient({ newPrincipalRecipient })`;
  `prepareTransfer` takes `newPrincipalRecipient`; `prepareSweep` takes `to` (was `beneficiary`).
- `splits.getSplit` returns `null` for an address that is not a split (was `SPLIT_NOT_FOUND`, now removed);
  `ovm.getState` returns `null` for an address that is not an OVM (was `OVM_READ_FAILED`). Read failures still throw.
- Null versus absent, one rule: `null` = asked, no data; absent = not asked. `OvmState.principalOnBeaconChain` is
  `null` when the API had no value; `ovm.getValidators` entries always carry `lockHash`, `beaconStatus` and `balance`
  (`null` when unknown) and its `blockNumber` is `bigint | null`.
- Error codes renamed to one pattern (subject first): `INVALID_BASE_URL` → `BASE_URL_INVALID`, `NOT_AN_OPERATOR` →
  `ACCOUNT_NOT_OPERATOR`, `NOT_OVM_OWNER` → `OVM_OWNER_REQUIRED`, `ROLE_TO_PUBLIC_FORWARDER` →
  `PUBLIC_FORWARDER_AS_ROLE_HOLDER`, `OWNER_TO_PUBLIC_FORWARDER` → `PUBLIC_FORWARDER_AS_OWNER`,
  `RECIPIENT_IS_PUBLIC_FORWARDER` → `PUBLIC_FORWARDER_AS_RECIPIENT`, `EXIT_EPOCH_REGRESSION` → `EXIT_EPOCH_MISMATCH`;
  incentive issues `INVALID_INCENTIVES_DATA` → `INCENTIVES_DATA_INVALID`, `UNKNOWN_DISTRIBUTOR` →
  `DISTRIBUTOR_UNKNOWN`, `UNEXPECTED_TOKEN` → `TOKEN_MISMATCH`, `INVALID_PROOF` → `PROOF_INVALID`. Removed:
  `SPLIT_NOT_FOUND`, `EXIT_SIGNATURE_MALFORMED`, and the findings `WITHDRAW_PARTIAL_REQUIRES_COMPOUNDING`,
  `WITHDRAW_CREDENTIALS_NOT_OVM`, `WITHDRAW_CREDENTIALS_NOT_SENDER`, `WITHDRAW_VALIDATOR_NOT_ACTIVE` (now errors, below).
- `ovm.prepareWithdraw`, `withdrawals.prepareEoaWithdraw` and `ovm.prepareConsolidate` throw for every request the
  beacon chain would ignore (Electra `process_withdrawal_request` / `process_consolidation_request`): new codes
  `VALIDATOR_NOT_ACTIVE`, `VALIDATOR_EXITING`, `VALIDATOR_TOO_NEW`, `CREDENTIALS_NOT_SOURCE`,
  `EXIT_BLOCKED_BY_PENDING_WITHDRAWAL`, `PARTIAL_REQUIRES_COMPOUNDING`, `EFFECTIVE_BALANCE_TOO_LOW`,
  `NO_EXCESS_BALANCE`, `CONSOLIDATION_BLOCKED_BY_PENDING_WITHDRAWAL`, `CONSOLIDATION_ALREADY_COMPOUNDING`;
  `CONSOLIDATION_TARGET_NOT_COMPOUNDING` is an error (was a warning). A partial amount above the excess balance is sent
  capped (`requestedAmount` in the preview, `WITHDRAW_AMOUNT_CAPPED`).
- `simulate` and `legacy` moved under `experimental`: `obol.experimental.simulate`, `obol.experimental.legacy`, and
  the `experimental` namespace / `@obolnetwork/obol-sdk/experimental` entry. `FullSimulation.gasUsed` is
  `gas.used`.
- Exits use the Obol API wire and storage formats as they are (snake_case): `PartialExitBlob`,
  `PartialExitsPayload`, `StoredExitBlob` (with `shares_exit_data`, also wrapped in an array), `FullExitResponse`,
  `FullExitBlob`. `verifyPartialExit` takes `existing` as a list or a map of stored exits and checks each blob against
  its own pubkey's; the payload root is of the partial exits sorted by validator index; the payload signature must be
  65 bytes (high-s accepted, as the API does); the epoch must equal the stored one. `aggregate({ validator, exit,
  threshold })` takes a stored exit or the API's full exit response, verifies each partial against its public share and
  uses any `threshold` valid ones.
- Module namespaces and entries export explicit lists of the documented API. Gone from the namespaces: internals
  (`readOvmCore`, `requestAmountGwei`, `credentialsPointAt`, the merkle helpers, …), the TypeBox schema constants, and
  the functions that take a `Context` (use the client, or `create<Module>Module(createObolContext(config))`).
  `ObolClient` is an explicit interface, as is every `<Module>Module`.
- Inputs take plain `string` for hex and addresses (still checked at runtime); outputs stay `Hex` / `Address`.
- On-chain integers are `bigint` in outputs: `splits.percent` returns `bigint`; `SPLITS_SCALE` and `RAF_SHARE` are
  `bigint`. Split allocations accept `number | bigint`.
- `ObolError` is generic over its code: `ObolError<C>['details']` is `ObolErrorDetails[C]`, and
  `isObolError(error, code)` narrows it. `Finding.code` is `FindingCode`.
- `cluster.verifyLock` follows Charon where it differed (found by a differential fuzz of 10k mutated locks against
  Charon): a new step `definition_invalid` (an unknown fork version for every flow, `num_validators` other than the
  number of validators, `deposit_amounts` outside Charon's rules); deposits for amounts outside `deposit_amounts` (or
  Charon's defaults when it is empty, 32 ETH only for v1.6 / v1.7) are `deposit_amount_unexpected`; `compounding` is
  read from v1.10.0 on only; node signatures must be 65 bytes with a recovery id that recovers the ENR key (high-s
  accepted, like Charon); point encodings must be canonical.

**Added**

- `ObolErrorCode` / `FindingCode` unions (`OBOL_ERROR_CODES`, `FINDING_CODES`), `ObolErrorDetails`, and
  `Finding.subject` (`{ pubkey } | { address } | { index }`) on every finding about one item.
- `isStale(prepared, head, maxAgeBlocks)`.
- `api: { baseUrl, allowLocal: true }` allows `http(s)://localhost[:port]` and `http(s)://127.0.0.1[:port]`.
- `deposits.status` reads `activationEpoch`, `exitEpoch` and `pendingPartialWithdrawals` from
  `POST /v1/validators/:network/deposit-status` (obol-api #1047) and from the beacon fallback (registry epochs,
  `pending_partial_withdrawals`). Checks the source cannot support are reported as `VALIDATOR_STATUS_UNCHECKED`
  (info); `PARTIAL_WITHDRAWAL_QUEUE_FULL` (warning) from a beacon node.
- `ObolChain.genesisTime` (mainnet, Hoodi) and `currentEpoch(chain)`.
- `simulate` result `gas: { used, baseFeePerGas, priorityFeePerGas, estimatedFee }`; balance changes stay gas-free.
- `TX_REPLACED` details carry `reason` (`cancelled` / `replaced`) and `replacement`; `send` documents re-keying a
  stored hash on `repriced` in `onReplaced`.
- Per-module entry points (`@obolnetwork/obol-sdk/cluster`, `/deposits`, `/ovm`, `/splits`, `/setup`,
  `/incentives`, `/terms`, `/withdrawals`, `/exits`, `/experimental`) for ESM, CJS and types, with
  `createObolContext`; `"sideEffects": false`. A reads-only `ovm` import carries no BLS or SSZ code.
- API Extractor report (`etc/obol-sdk.api.md`, `yarn api:check` in CI), bundle-size budget (`yarn size:check` in CI),
  JSON Schemas of every operation input (`spec/schemas/`, `yarn spec:schemas`, checked by a test), and a test that
  `spec/errors.md`, the code unions and the codes in `src/` agree.
- Mainnet-fork e2e mode (`yarn test:e2e:mainnet`, `E2E_CHAIN=mainnet`, `RPC_MAINNET`).
- The differential lock fuzz harness (`test/fuzz/`, `yarn test:fuzz`; with a built `charon-oracle` it compares with
  Charon), its minimized disagreements as regression tests, and a seeded decoder fuzz in `yarn test`.
- `MIGRATION.md`: every 2.x method mapped to v3, and the rc.3 → rc.4 changes.

**Fixed**

- Log scans (`ovm.verify`, `ovm.getRoleHolders`, `splits.getSplit`) adapt to RPCs that cap `eth_getLogs` by block
  range or by result count: on a range / limit refusal the window halves (from 50,000 down to 1,000 blocks) and the
  working size is remembered per `PublicClient`. One-event scans (`ovm.verify`, `SplitCreated`) read newest first, so
  a recently created OVM resolves in one request. A genuine failure still gives `unknown`, never `notObol`.
- Non-canonical BLS encodings (a field element at or above the modulus, which the decoder reduced) were accepted for
  public shares, group keys and signatures in `verifyLock`, `verifyDepositData` and the exit helpers. They are refused,
  as blst and Charon refuse them.
- `verifyLock` accepted 64-byte node signatures and a wrong recovery id, and refused a valid high-s signature.
- Vectors from the 2.16 code were re-run on v3 (`distribution.json`, with the deliberate differences recorded per
  case), and the runners compare every field.

#### [v3.0.0-rc.3](https://github.com/ObolNetwork/obol-sdk/compare/v3.0.0-rc.2...v3.0.0-rc.3)

> 21 October 2026

Fixes from the Launchpad integration of rc.2.

**Changed**

- `ovm.prepareWithdraw` and `ovm.prepareConsolidate` default the fee to the top of the accepted range,
  `max(10 × current fee, 1 gwei) × n`, instead of `2 × current fee × n`. The OVM refunds the excess to
  `excessFeeRecipient`, so a fee rise before the transaction is mined no longer makes it revert.
  `withdrawals.prepareEoaWithdraw` keeps exactly the current fee (the predeploy keeps any excess). Vectors
  `request_fees.json` now give the default as `default: "cap" | "minimum"`.
- `ovm.verify` reads `provenance` from the Obol API OVM record (`GET /v1/ovm/:network/:address`): `obol` / `notObol`
  are trusted only for a record of this address (and this chain's factory), `unknown` defers to the chain. When the
  endpoint is unavailable, the interim `/v1/eth/contract-creation` record is trusted only when its `contractAddress`
  is present and equals the OVM; otherwise the factory logs decide.
- `ovm.getRoleHolders` takes candidates from the OVM record's `roles` (re-read with `rolesOf`), falling back to the
  interim log index, and always checks the chain's public forwarders.
- `OvmApiRecord` is typed and parsed: `network`, `provenance`, `owner`, `principalRecipient`, `rewardRecipient`,
  `principalThreshold`, `amountOfPrincipalStake`, `fundsPendingWithdrawal`, `balance`, `version`, `pullBalances`,
  `roles`, `splits` (with `splitHash`), `validators`, `principalOnBeaconChain` and `notes`; malformed fields are left
  out, and a record for another address or network is `API_RESPONSE_MISMATCH`. Money values used by `prepare*` are
  still read on chain. `ovm.getValidators` accepts `new` entries with `beaconStatus: null`.
- The ESM builds ship `dist/esm/package.json` and `dist/browser/package.json` with `{ "type": "module" }`, so Node
  loads them as ES modules without the `MODULE_TYPELESS_PACKAGE_JSON` warning.

**Added**

- Public forwarders: `ChainContracts.publicForwarders` (mainnet Multicall3, Multicall2 and Multicall; Hoodi
  Multicall3). `ovm.prepareGrantRoles` refuses to grant a role to one (`ROLE_TO_PUBLIC_FORWARDER`), and
  `ovm.prepareTransfer` / `ovm.prepareCompleteOwnershipHandover` refuse one as the new owner
  (`OWNER_TO_PUBLIC_FORWARDER`): anyone can make calls through them. Creating an OVM or split with a public forwarder as owner or recipient is refused too (`OWNER_TO_PUBLIC_FORWARDER`, `RECIPIENT_IS_PUBLIC_FORWARDER`). `ovm.getState` and `ovm.getRoleHolders` (new
  `findings` field) warn `PUBLIC_FORWARDER_HOLDS_ROLE` when one already owns the OVM or holds a role.
- `splits.prepareDistribution` / `previewDistribution`: each recipient row has `fromThisDistribution` (`fromOvm +
  fromRewardSplit + fromPrincipalSplit + distributorReward`). `toWallet` is documented precisely: it includes the
  Warehouse (and SplitMain) balance the recipient already had, from any split, when its withdrawal is included.

#### [v3.0.0-rc.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.15.0...v3.0.0-rc.2)

> 19 October 2026

First release candidate of SDK v3, a rewrite. **Breaking:** nothing from the 2.x API is kept. What every operation
checks, reads and returns, and every error code, is specified in [`spec/`](spec/README.md). A migration guide from
2.x follows.

**Changed**

- Built on viem: `createObolClient({ chain, publicClient, walletClient?, api? })` replaces `new Client(config, signer,
  provider)`. `viem@^2` is a peer dependency.
- Prepare, then send: every write is a `prepare*` operation that runs its checks and returns a `Prepared` transaction
  (`request`, `checks` findings, `preview`, `blockNumber`). The caller's wallet layer sends it, or `send` does.
- Modules: `cluster`, `deposits`, `ovm`, `splits`, `setup`, `incentives`, `exits`, `terms`, `withdrawals` and
  `legacy`, bound to the client and also exported as namespaces, so pure functions (hashing, lock verification,
  share math, exit aggregation) work without a client.
- One error class, `ObolError` (`ObolApiError` for API responses), with a stable `code`, a `hint` and `details`,
  replaces the 2.x error hierarchy.
- Inputs are validated with TypeBox schemas instead of AJV.
- Incentive claims, EOA withdrawals and OWR reads carry over as `incentives.prepareClaim`,
  `withdrawals.prepareEoaWithdraw` and `legacy.getOwrTranches`.
- `cluster.verifyLock` is faster on one thread: every point is decoded once, share binding uses finite differences
  (point subtractions; only the first `threshold` points are subgroup-checked), `signature_aggregate` reuses the
  decoded shares, and deposit and builder signatures are checked in randomised batches of 32 with a one-by-one
  fallback. Its result has `level` and, for a per-validator failure, `validator`. A 1k-validator lock: about 80 s
  instead of 2 minutes in pure JS.
- `cluster.verifyLock` yields to the event loop every `yieldMs` (default 50) instead of using worker threads.
- `deposits.fromLock` verifies at level `attested` plus the BLS signatures of the validators it returns
  (`verify: 'full'` for every check), so a 10k-validator lock takes seconds plus about 25 ms per checked signature;
  `LOCK_INVALID` carries the failing validator as `index`.
- `deposits.status` reads `POST /v1/validators/:network/deposit-status` (every queued deposit with its own
  credentials) and no longer needs `lockHash`; until that route is deployed it falls back to `/v1/state/:lockHash`
  (with `lockHash`) or the beacon node.
- `deposits.prepareDeposit`: a queued deposit with all-zero credentials (a top-up) is not a `DEPOSIT_CONFLICT`.

**New**

- `cluster.verifyLock` reports the first failing step; `cluster.watch` follows signatures and the lock.
- `deposits.status` and the existence checks in `deposits.prepareDeposit` (pending deposits, top-ups, balances).
- OVM provenance (`ovm.verify`), state, role and validator reads; withdraw, consolidate and distribute with
  previews; role and ownership writes.
- SplitV2 integer share math, distribution routing and previews; `setup` flows and presets for OVM with splits.
- `exits.aggregate` does threshold (Lagrange) aggregation and checks the result against the group key (2.x summed the
  partials); exit domains come from the chain table (EIP-7044), with no beacon node needed.
- JSON test vectors in `spec/vectors/`, plus the distributed-validator-specs vectors.
- `cluster.verifyLock` options `level` (`'attested'` | `'full'`), `signatures` (which validators' BLS signatures
  `attested` checks), `yieldMs` and `bls`: an injectable `BlsBackend` (default `cluster.nobleBls`, pure JS). The TSDoc
  has a ~30-line adapter over `@chainsafe/blst` for Node servers; the SDK never imports a native module.
- `deposits.fromLock` option `validators` (indexes or group pubkeys) and result field `validators`.
- `deposits.status` option `expectedWithdrawalAddress` and per-pubkey `credentialsMatch`.
- `simulate(prepared, { from })` (bound as `obol.simulate`): runs any `Prepared` request on the node without sending
  it (`eth_simulateV1`, else `debug_traceCall`, else `eth_call` only) and returns success or the decoded revert
  (custom errors of the OVM, factories, splits and Warehouse; the failing call of a Multicall3 batch), gas, ETH and
  Warehouse balance changes, decoded events, state changes (roles, ownership, recipients, created contracts,
  `amountOfPrincipalStake` / `fundsPendingWithdrawal`, withdrawal / consolidation requests, deposits), plain-language
  `summary` lines and `matchesPreview`, a comparison with the operation's own preview. New codes
  `SIMULATION_FAILED`, `SIMULATION_UNAVAILABLE`, `SIMULATION_REVERTED`, `SIMULATION_PREVIEW_MISMATCH`,
  `SIMULATION_CONTRACT_WALLET`, `SIMULATION_UNTRUSTED_EVENT`. It simulates on the latest block by default and only
  interprets events from contracts with a known role in the transaction.
- `splits.prepareDistribution` / `previewDistribution` recipient rows carry `distributorReward` (the incentives the
  distributor is credited; 0 for other rows).

**Removed**

- ethers support, and with it `@safe-global/*`, `@metamask/eth-sig-util`, AJV, `semver` and `uuid`.
- The 2.x `Client` and all its methods and sub-modules (`splits`, `eoa`, `incentives`, `exit`), the standalone
  `validateClusterLock` and the whole-lock validation worker, and creation of OWR / SplitMain contracts.
- The lock verification chunk workers (`lockWorker.js` bundle), the per-process concurrency limit
  (`OBOL_SDK_MAX_CONCURRENT_LOCK_VALIDATIONS`) and the `LOCK_VERIFICATION_TIMEOUT` / `LOCK_VERIFICATION_BUSY` codes.
  A server that needs a deadline or a limit applies it around the call.

**Fixed**

- Batched BLS checks (lock deposit and builder registration signatures, deposit data) require each signature to be
  valid on its own; batches are checked with random weights. The same fix ships in 2.15.1.
#### [v2.15.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.15.1...v2.15.2)

> 28 October 2026

- fix(verification): `verifyDepositPayloads` (used by `eoa.deposit`, `splits.deposit` and `getDepositData`) requires exact lengths for `pubkey`, `withdrawal_credentials`, `signature` and `deposit_data_root` before hashing, and `computeDepositMsgRoot` for `pubkey` and `withdrawal_credentials`; short or overlong values were padded or truncated by SSZ and could pass with a valid root and signature [`#253`](https://github.com/ObolNetwork/obol-sdk/pull/253)
- fix: requests send `Content-Type: application/json` only when they have a body, and `User-Agent: Obol-SDK/<version>` only in Node, so a browser GET to the Obol API is a simple CORS request without a preflight; caller headers still override the defaults
- feat(errors): `ObolApiError` (and its subclasses) has `requestId` from the response `X-Request-Id` header; quote it when reporting a failed request to Obol
- feat(errors): `RateLimitError` has `retryAfterSeconds` from the response `Retry-After` header (delta-seconds, or an HTTP-date converted to seconds from now, at least 0; undefined when absent or unparseable)
- feat(errors): `ObolApiErrorInit` takes optional response `headers`; body fields named `requestId` or `retryAfterSeconds` are not copied onto the error (they stay in `body`)

#### [v2.15.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.15.0...v2.15.1)

> 21 October 2026

- fix(verification): require each signature in a batched BLS check (cluster lock deposit and builder registration signatures, deposit payloads) to be valid on its own; batches are now checked with random weights
- fix(verification): reject non-canonical BLS point encodings (field elements ≥ p), which consensus clients reject

#### [v2.15.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.14.0...v2.15.0)

> 17 October 2026

Fixes:

- fix(verification): cluster definition and lock hashes match the distributed-validator-specs `cluster_hashing` test vectors: deposit amounts are hashed as uint64 bigints (amounts above 2^53 lost precision with `parseInt`), and null or missing lists (operators, validators, `deposit_amounts`, `partial_deposit_data`, Charon's Go nil slices) and missing name / timestamp hash as empty instead of throwing. Malformed deposit amounts (empty, non-decimal, out of the uint64 range) are rejected instead of hashing as `NaN`
- fix(verification): `validateClusterLock` recomputes the definition's `config_hash` and rejects locks where it does not match the config fields
- fix(verification): node (ENR) and exit payload secp256k1 signatures are verified with `@noble/curves` instead of `elliptic`; signatures must be 64 or 65 bytes of hex with low-s, malformed signatures return `false` instead of throwing, and `verifyExitPayloadSignature` decodes the ENR public key correctly
- fix(validation): stricter cluster definition and split payload validation. Split allocations must be within (0, 100] and are summed at contract precision (1e4 per percent) instead of as floats; V1 SplitMain recipients must sum to exactly 100%, OVM / SplitV2 recipients may be off by one 1e-4 % unit per recipient (SplitV2 takes the sum as its total, e.g. three shares of 33.3333...%). Recipient and operator addresses must be hex addresses without case-insensitive duplicates; zero withdrawal and fee recipient addresses and unknown definition fields are rejected
- fix: `createClusterDefinition` only accepts the definition versions in `SUPPORTED_DEFINITION_VERSIONS` (`InvalidArgumentError` otherwise)
- fix: `getClusterDefinition`, `getClusterLock`, `getClusterLockByHash`, `acceptClusterDefinition`, `hasAcceptedTerms` and `incentives.getIncentivesByAddress` validate hash and address arguments before calling the API and URL-encode them
- fix: `acceptClusterDefinition` fetches and verifies the definition before signing (returned and recomputed `config_hash` match, network matches the client) and checks the signer is an operator (`DefinitionVerificationError`, `NotAnOperatorError`); it fills `version` from the definition when omitted (a different `version` is rejected) and returns the definition unchanged if this operator already accepted with the same ENR
- fix: methods that send transactions or sign chain-bound EIP-712 data throw `ChainMismatchError` when the signer's provider is on a different chain than the client
- fix: the `Client` constructor throws `UnsupportedChainError` for chain IDs other than Mainnet (1), Hoodi (560048), Gnosis (100) and Sepolia (11155111); Gnosis and Sepolia are for cluster definitions and locks only (no splitter contracts)
- fix: conflicts are detected by HTTP status 409, and `ConflictError` carries the API's message
- fix(eoa, splits): `eoa.deposit` and `splits.deposit` verify deposit data before sending ETH: recomputed `deposit_data_root`, BLS signature for the chain, amount between 1 ETH and 32 ETH (2048 ETH for 0x02 credentials), withdrawal credentials pointing at the OVM / optional `expectedWithdrawalAddress`. Signatures that are not valid curve points are reported as an invalid deposit signature
- fix(eoa, splits): top-ups to existing validators are sent with `kind: 'topUp'` (default `'deposit'`): no BLS check, the expected or all-zero withdrawal credentials, up to 2048 ETH. Without it, a deposit with an all-zero signature is refused with an `ObolSdkError` coded `DEPOSIT_LOOKS_LIKE_TOP_UP`, since it would be lost if the validator does not exist
- fix(eoa, splits): `requestWithdrawal` checks fees against the current EIP-7002 fee read from the withdrawal request contract; `requiredFee` / `withdrawalFees` are optional, and `allocation` is converted to gwei without float precision loss
- fix(eoa): when `requiredFee` is omitted, `eoa.requestWithdrawal` sends exactly the current EIP-7002 fee, since the EIP-7002 contract keeps any excess (`splits.requestWithdrawal` keeps its 2× default, as the OVM refunds the excess); `resolveWithdrawalFee` takes an optional `defaultMultiplier`
- fix(eoa): correct the batch deposit error message and keep the original error as `cause`
- fix(exits): `recombineExitBlobs` threshold-aggregates partial exit signatures like Charon's `tbls.ThresholdAggregate`, weighting each by its Lagrange coefficient for the share indices present (operator index + 1); it previously summed them, which does not produce the validator's signature. Share index keys that are not non-negative integers and signatures that are not valid G2 points are rejected. The result matches the distributed-validator-specs `bls_threshold` test vectors
- fix(splits): OVM deployment only reads the `CreateObolValidatorManager` event from logs emitted by the chain's configured OVM factory; `extractOvmAddressFromReceipt` takes the factory address as a second argument
- fix(splits): `splits.requestWithdrawal` refunds unused EIP-7002 fees to a new optional `excessFeeRecipient`, defaulting to the signer; refunds were previously sent to the OVM and distributed as rewards
- fix(splits): `splits.deposit` and `splits.requestWithdrawal` from a contract wallet (e.g. a Safe over WalletConnect) wait for the Safe's execution instead of the wallet-returned hash, which never appears on-chain, as the `eoa` methods already do
- fix(splits): `distributorFeePercent` is converted to SplitV2's `distributionIncentive` scale (1e6 = 100%); it was passed through unscaled, so 1 meant 0.0001% and fractional values failed to encode. The maximum is now 6.5535% (the uint16 limit) instead of 10%, and the default stays 0. Split addresses predicted with a non-zero fee change
- fix(incentives): `claimIncentives` runs a pre-flight check first, also available read-only as `incentives.preflightClaim(address)`: the API data is for the requested address, the Merkle proof matches the distributor's on-chain root, the distributor matches the reference `MerkleDistributorWithDeadline` build and pays out OBOL for the chain, and the claim window is open. Failures throw `IncentivesPreflightError` (with `issues`); addresses without incentives are reported as `NO_INCENTIVES` instead of failing inside the contract call, and API errors other than 404 as `INCENTIVES_FETCH_FAILED`. `isClaimed` validates its arguments, and incentive helpers no longer log to the console

Additions:

- feat(errors): typed Obol API errors (`ObolApiError` with `NotFoundError`, `ValidationError`, `UnauthorizedError`, `ConflictError`, `RateLimitError`) carrying `status`, `endpoint`, `method`, `body` and a `hint`; error body fields stay readable on the error, and non-JSON error bodies no longer cause a parse error
- feat(errors): `ObolSdkError` base class (with `code` and `hint`) for local check errors (`ChainMismatchError`, `DefinitionVerificationError`, `NotAnOperatorError`, `IncentivesPreflightError`); payload validation throws `PayloadValidationError` (code `PAYLOAD_INVALID`, with the AJV `errors`) and malformed hash / address arguments throw `InvalidArgumentError` (code `INVALID_ARGUMENT`), both keeping their previous messages
- feat(errors): when `splits.deposit`, `splits.requestWithdrawal`, `eoa.deposit`, `eoa.requestWithdrawal` or `incentives.claimIncentives` fails after a transaction was broadcast, it throws `TransactionSubmissionError` (code `TX_FAILED_AFTER_SEND`) with the mined `txHashes`, the unconfirmed `pendingTxHash`, `pendingStatus` (`reverted`: nothing moved; `unconfirmed`: it may still be mined) and the original `cause`; its message is unchanged
- feat: the same methods take an optional second argument `{ onSent }` (`WriteOptions`), called with each transaction hash as soon as it is broadcast (for a contract wallet, the wallet's own hash)
- feat: configurable request timeout (`timeoutMs`, default 30s, `0` disables it) that throws `RequestTimeoutError`
- feat: `hasAcceptedTerms(address?)` and `acceptObolLatestTermsAndConditions({ ifNotAccepted: true })`
- feat(deposits): `getDepositData(lockHash, { verify?, amount? })` returns validated deposit payloads (wei) from a cluster lock, ready for `eoa.deposit` / `splits.deposit` (shared `ValidatorDeposit` type); `depositDataFromLock` does the same for a lock already in hand
- feat: export the EIP-7002 withdrawal fee helpers `getWithdrawalRequestFee`, `resolveWithdrawalFee` and `WITHDRAWAL_REQUEST_CONTRACT_ADDRESS`
- feat: `getOWRTranches` works with a provider and no signer
- feat: accept any ethers v6 `Signer` / `Provider` (`HDNodeWallet`, `NonceManager`, custom `AbstractSigner`) without casts; remove the unused `cross-fetch` and `elliptic` dependencies; relax `engines.node` to `>= 20`
- note: `SignerType` is now the ethers `Signer` interface. TypeScript callers that read members specific to `Wallet` / `JsonRpcSigner` from `client.signer` (e.g. `client.signer.address`) need a narrowing check such as `instanceof Wallet`; this is a type-only change with no runtime effect
- docs: `splits.requestWithdrawal` amounts are in gwei; `createObolRewardsSplit` and `createObolTotalSplit` are deprecated for new clusters in favour of the OVM methods (they have no EIP-7002 withdrawal path)

#### [v2.14.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.13.2...v2.14.0)

> 21 July 2026

- chore(release): v2.14.0 [`#232`](https://github.com/ObolNetwork/obol-sdk/pull/232)
- fix(safe): use Client provider for reads and Safe gas estimation [`#231`](https://github.com/ObolNetwork/obol-sdk/pull/231)

#### [v2.13.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.13.1...v2.13.2)

> 17 July 2026

- chore(release): v2.13.2 [`#230`](https://github.com/ObolNetwork/obol-sdk/pull/230)
- fix: support Safe wallets in EOA withdrawal/exit and batch deposit [`#228`](https://github.com/ObolNetwork/obol-sdk/pull/228)

#### [v2.13.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.13.0...v2.13.1)

> 10 July 2026

- chore(release): v2.13.1 [`#227`](https://github.com/ObolNetwork/obol-sdk/pull/227)
- fix: support Safe wallets in OVM/splitter deployment flows [`#226`](https://github.com/ObolNetwork/obol-sdk/pull/226)

#### [v2.13.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.12.6...v2.13.0)

> 8 July 2026

- chore(release): v2.13.0 [`#225`](https://github.com/ObolNetwork/obol-sdk/pull/225)
- Add v1.11.0 cluster definition hashing with List[Bytes65,32] signatures. [`#220`](https://github.com/ObolNetwork/obol-sdk/pull/220)

#### [v2.12.6](https://github.com/ObolNetwork/obol-sdk/compare/v2.12.5...v2.12.6)

> 2 June 2026

- chore(release): v2.12.6 [`#219`](https://github.com/ObolNetwork/obol-sdk/pull/219)
- fix: move @noble/curves to devDependencies to prevent consumer dep conflicts [`#218`](https://github.com/ObolNetwork/obol-sdk/pull/218)

#### [v2.12.5](https://github.com/ObolNetwork/obol-sdk/compare/v2.12.4...v2.12.5)

> 22 May 2026

- chore(release): v2.12.5 [`#217`](https://github.com/ObolNetwork/obol-sdk/pull/217)
- fix: raise lock validation worker timeouts for large clusters [`#216`](https://github.com/ObolNetwork/obol-sdk/pull/216)

#### [v2.12.4](https://github.com/ObolNetwork/obol-sdk/compare/v2.12.3...v2.12.4)

> 21 May 2026

- chore(release): v2.12.4 [`#215`](https://github.com/ObolNetwork/obol-sdk/pull/215)
- Hanan/worker timeout [`#214`](https://github.com/ObolNetwork/obol-sdk/pull/214)

#### [v2.12.3](https://github.com/ObolNetwork/obol-sdk/compare/v2.12.2...v2.12.3)

> 21 May 2026

- chore(release): v2.12.3 [`#213`](https://github.com/ObolNetwork/obol-sdk/pull/213)
- Hanan/timeoutError+ConcurrentRequests [`#212`](https://github.com/ObolNetwork/obol-sdk/pull/212)

#### [v2.12.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.12.1...v2.12.2)

> 21 May 2026

- chore(release): v2.12.2 [`#211`](https://github.com/ObolNetwork/obol-sdk/pull/211)
- fix(security): stop auto-loading .env and allowlist Obol API baseUrl [`#210`](https://github.com/ObolNetwork/obol-sdk/pull/210)

#### [v2.12.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.12.0...v2.12.1)

> 20 May 2026

- chore(release): v2.12.1 [`#209`](https://github.com/ObolNetwork/obol-sdk/pull/209)
- perf: run lock validation off main thread, parallelize BLS operations [`#208`](https://github.com/ObolNetwork/obol-sdk/pull/208)

#### [v2.12.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.13...v2.12.0)

> 15 May 2026

- chore(release): v2.12.0 [`#207`](https://github.com/ObolNetwork/obol-sdk/pull/207)
- Fix/lock share binding validation [`#199`](https://github.com/ObolNetwork/obol-sdk/pull/199)

#### [v2.11.13](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.12...v2.11.13)

> 11 May 2026

- chore(release): v2.11.13 [`#206`](https://github.com/ObolNetwork/obol-sdk/pull/206)
- Feat/export enr [`#204`](https://github.com/ObolNetwork/obol-sdk/pull/204)
- fix: sign release PR commits for branch protection compliance [`#205`](https://github.com/ObolNetwork/obol-sdk/pull/205)

#### [v2.11.12](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.11...v2.11.12)

> 8 May 2026

- chore(release): v2.11.12 [`#203`](https://github.com/ObolNetwork/obol-sdk/pull/203)
- Fix/release pr lockfile sync [`#202`](https://github.com/ObolNetwork/obol-sdk/pull/202)

#### [v2.11.11](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.10...v2.11.11)

> 8 May 2026

- fix(release): sync subproject lockfiles before dependency upgrades [`#201`](https://github.com/ObolNetwork/obol-sdk/pull/201)
- Chore/update dependencies [`#198`](https://github.com/ObolNetwork/obol-sdk/pull/198)
- chore: update dependencies to latest stable versions [`#193`](https://github.com/ObolNetwork/obol-sdk/pull/193)
- fix: pin GitHub Actions to SHA for supply chain security [`#183`](https://github.com/ObolNetwork/obol-sdk/pull/183)
- fix: enforce semantic commits in Renovate config [`#186`](https://github.com/ObolNetwork/obol-sdk/pull/186)
- fix: enforce node signatures count equals operators count in validate… [`#189`](https://github.com/ObolNetwork/obol-sdk/pull/189)
- Update actions/github-script action to v9 [`#187`](https://github.com/ObolNetwork/obol-sdk/pull/187)
- Updates claude.md to consider outside parties [`#188`](https://github.com/ObolNetwork/obol-sdk/pull/188)
- Update peter-evans/create-pull-request action to v8 [`#175`](https://github.com/ObolNetwork/obol-sdk/pull/175)
- Update ffurrer2/extract-release-notes action to v3 [`#169`](https://github.com/ObolNetwork/obol-sdk/pull/169)
- Update actions/checkout action to v6 [`#168`](https://github.com/ObolNetwork/obol-sdk/pull/168)
- Update actions/setup-node action to v6 [`#158`](https://github.com/ObolNetwork/obol-sdk/pull/158)
- Update README.md [`#64`](https://github.com/ObolNetwork/obol-sdk/pull/64)
- Update ffurrer2/extract-release-notes action to v2.3.0 [`#106`](https://github.com/ObolNetwork/obol-sdk/pull/106)
- fix: use Node 24 with --ignore-scripts for OIDC publishing [`#192`](https://github.com/ObolNetwork/obol-sdk/pull/192)
- fix: use Node 22.x for @chainsafe/blst compatibility [`#191`](https://github.com/ObolNetwork/obol-sdk/pull/191)
- chore: migrate npm publishing to OIDC trusted publishers [`#190`](https://github.com/ObolNetwork/obol-sdk/pull/190)
- update claude.md [`#184`](https://github.com/ObolNetwork/obol-sdk/pull/184)
- chore: use yarn cache in release-pr workflow [`248de15`](https://github.com/ObolNetwork/obol-sdk/commit/248de15f0f942b174570f62bea2363698ec06a3a)

#### [v2.11.10](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.9...v2.11.10)

> 16 March 2026

- chore(release): v2.11.10 [`#182`](https://github.com/ObolNetwork/obol-sdk/pull/182)
- remove holesky [`#181`](https://github.com/ObolNetwork/obol-sdk/pull/181)
- improve sdk docs and error handling [`#180`](https://github.com/ObolNetwork/obol-sdk/pull/180)

#### [v2.11.9](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.8...v2.11.9)

> 30 January 2026

- chore(release): v2.11.9 [`#179`](https://github.com/ObolNetwork/obol-sdk/pull/179)
- support delegated EOA [`#178`](https://github.com/ObolNetwork/obol-sdk/pull/178)
- fix docs [`#176`](https://github.com/ObolNetwork/obol-sdk/pull/176)
- Fix: Correct method name in signature validator [`#177`](https://github.com/ObolNetwork/obol-sdk/pull/177)

#### [v2.11.8](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.7...v2.11.8)

> 9 December 2025

- chore(release): v2.11.8 [`#174`](https://github.com/ObolNetwork/obol-sdk/pull/174)
- Hanan/fix ovm deposit [`#173`](https://github.com/ObolNetwork/obol-sdk/pull/173)

#### [v2.11.7](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.6...v2.11.7)

> 5 December 2025

- chore(release): v2.11.7 [`#172`](https://github.com/ObolNetwork/obol-sdk/pull/172)
- new ovm [`#171`](https://github.com/ObolNetwork/obol-sdk/pull/171)
- Hanna/recombine signature fix [`#170`](https://github.com/ObolNetwork/obol-sdk/pull/170)

#### [v2.11.6](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.5...v2.11.6)

> 11 November 2025

- chore(release): v2.11.6 [`#167`](https://github.com/ObolNetwork/obol-sdk/pull/167)
- accept 0 for full withdrawal [`#166`](https://github.com/ObolNetwork/obol-sdk/pull/166)

#### [v2.11.5](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.5-rc.2...v2.11.5)

> 7 November 2025

- chore(release): v2.11.5 [`#165`](https://github.com/ObolNetwork/obol-sdk/pull/165)
- return checksummed ovm address [`#164`](https://github.com/ObolNetwork/obol-sdk/pull/164)

#### [v2.11.5-rc.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.5-rc.1...v2.11.5-rc.2)

> 23 October 2025

- [Release] v2.11.5-rc.2 [`#162`](https://github.com/ObolNetwork/obol-sdk/pull/162)
- add js extension to missed files [`#161`](https://github.com/ObolNetwork/obol-sdk/pull/161)

#### [v2.11.5-rc.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.5-rc.0...v2.11.5-rc.1)

> 16 October 2025

- [Release] v2.11.5 [`#160`](https://github.com/ObolNetwork/obol-sdk/pull/160)
- remove ot used function [`#159`](https://github.com/ObolNetwork/obol-sdk/pull/159)
- Hanan/browser bundler config [`#157`](https://github.com/ObolNetwork/obol-sdk/pull/157)

#### [v2.11.5-rc.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.4...v2.11.5-rc.0)

> 3 October 2025

- [Release] v2.11.5-rc.0 [`#156`](https://github.com/ObolNetwork/obol-sdk/pull/156)
- fix critical vulnerabilities [`#155`](https://github.com/ObolNetwork/obol-sdk/pull/155)

#### [v2.11.4](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.3...v2.11.4)

> 19 September 2025

- chore(release): v2.11.4 [`#154`](https://github.com/ObolNetwork/obol-sdk/pull/154)
- update ovm factory info [`#153`](https://github.com/ObolNetwork/obol-sdk/pull/153)

#### [v2.11.3](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.2...v2.11.3)

> 18 September 2025

- chore(release): v2.11.3 [`#152`](https://github.com/ObolNetwork/obol-sdk/pull/152)
- update  validation for deposit_amounts [`#151`](https://github.com/ObolNetwork/obol-sdk/pull/151)

#### [v2.11.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.1...v2.11.2)

> 15 August 2025

- chore(release): v2.11.2 [`#148`](https://github.com/ObolNetwork/obol-sdk/pull/148)
- Hanan/deposit methods [`#147`](https://github.com/ObolNetwork/obol-sdk/pull/147)

#### [v2.11.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.0...v2.11.1)

> 15 August 2025

- chore(release): v2.11.1 [`#146`](https://github.com/ObolNetwork/obol-sdk/pull/146)
- Hanan/deposit methods [`#145`](https://github.com/ObolNetwork/obol-sdk/pull/145)

#### [v2.11.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.10.2...v2.11.0)

> 14 August 2025

- chore(release): v2.11.0 [`#144`](https://github.com/ObolNetwork/obol-sdk/pull/144)
- Hanan/deposit methods [`#143`](https://github.com/ObolNetwork/obol-sdk/pull/143)

#### [v2.10.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.10.1...v2.10.2)

> 12 August 2025

- chore(release): v2.10.2 [`#141`](https://github.com/ObolNetwork/obol-sdk/pull/141)
- hoodi support [`#139`](https://github.com/ObolNetwork/obol-sdk/pull/139)

#### [v2.10.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.10.0...v2.10.1)

> 7 August 2025

- chore(release): v2.10.1 [`#138`](https://github.com/ObolNetwork/obol-sdk/pull/138)
- Hanan/await tx [`#137`](https://github.com/ObolNetwork/obol-sdk/pull/137)

#### [v2.10.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.9.1...v2.10.0)

> 6 August 2025

- chore(release): v2.10.0 [`#136`](https://github.com/ObolNetwork/obol-sdk/pull/136)
- Hanan/eoa withdrawal [`#135`](https://github.com/ObolNetwork/obol-sdk/pull/135)

#### [v2.9.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.9.0...v2.9.1)

> 26 July 2025

- chore(release): v2.9.1 [`#134`](https://github.com/ObolNetwork/obol-sdk/pull/134)
- Hanan/ovm request withdrawal [`#133`](https://github.com/ObolNetwork/obol-sdk/pull/133)

#### [v2.9.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.8.1...v2.9.0)

> 25 July 2025

- chore(release): v2.9.0 [`#132`](https://github.com/ObolNetwork/obol-sdk/pull/132)
- Hanan/ovm request withdrawal [`#131`](https://github.com/ObolNetwork/obol-sdk/pull/131)

#### [v2.8.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.8.0...v2.8.1)

> 27 June 2025

- chore(release): v2.8.1 [`#130`](https://github.com/ObolNetwork/obol-sdk/pull/130)
- use splitv2Factory contract instead of sdk [`#129`](https://github.com/ObolNetwork/obol-sdk/pull/129)

#### [v2.8.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.7.0...v2.8.0)

> 25 June 2025

- chore(release): v2.8.0 [`#128`](https://github.com/ObolNetwork/obol-sdk/pull/128)
- Hanan/ovm methods [`#126`](https://github.com/ObolNetwork/obol-sdk/pull/126)

#### [v2.7.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.6.0...v2.7.0)

> 11 June 2025

- chore(release): v2.7.0 [`#125`](https://github.com/ObolNetwork/obol-sdk/pull/125)
- Adding BLS aggregation for exits [`#123`](https://github.com/ObolNetwork/obol-sdk/pull/123)

#### [v2.6.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.5.1...v2.6.0)

> 6 June 2025

- chore(release): v2.6.0 [`#122`](https://github.com/ObolNetwork/obol-sdk/pull/122)
- Update release-pr.yml [`#121`](https://github.com/ObolNetwork/obol-sdk/pull/121)
- Exit sdk commands [`#120`](https://github.com/ObolNetwork/obol-sdk/pull/120)

#### [v2.5.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.5.0...v2.5.1)

> 30 May 2025

- chore(release): v2.5.1 [`#117`](https://github.com/ObolNetwork/obol-sdk/pull/117)
- default compounding to false [`#116`](https://github.com/ObolNetwork/obol-sdk/pull/116)

#### [v2.5.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.4.6...v2.5.0)

> 23 May 2025

- chore(release): v2.5.0 [`#114`](https://github.com/ObolNetwork/obol-sdk/pull/114)
- default to v1.10.0 [`#111`](https://github.com/ObolNetwork/obol-sdk/pull/111)

#### [v2.4.6](https://github.com/ObolNetwork/obol-sdk/compare/v2.4.5...v2.4.6)

> 24 March 2025

- chore(release): v2.4.6 [`#105`](https://github.com/ObolNetwork/obol-sdk/pull/105)
- fix incentives type and accept rpcul in validateClusterLock [`#104`](https://github.com/ObolNetwork/obol-sdk/pull/104)

#### [v2.4.5](https://github.com/ObolNetwork/obol-sdk/compare/v2.4.4...v2.4.5)

> 20 March 2025

- chore(release): v2.4.5 [`#103`](https://github.com/ObolNetwork/obol-sdk/pull/103)
- Hanna/small fix [`#102`](https://github.com/ObolNetwork/obol-sdk/pull/102)

#### [v2.4.4](https://github.com/ObolNetwork/obol-sdk/compare/v2.4.3...v2.4.4)

> 19 March 2025

- chore(release): v2.4.4 [`#101`](https://github.com/ObolNetwork/obol-sdk/pull/101)
- remove not needed assignment [`#100`](https://github.com/ObolNetwork/obol-sdk/pull/100)

#### [v2.4.3](https://github.com/ObolNetwork/obol-sdk/compare/v2.4.2...v2.4.3)

> 18 March 2025

- chore(release): v2.4.3 [`#98`](https://github.com/ObolNetwork/obol-sdk/pull/98)
- add hoodi [`#97`](https://github.com/ObolNetwork/obol-sdk/pull/97)

#### [v2.4.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.4.1...v2.4.2)

> 14 March 2025

- chore(release): v2.4.2 [`#96`](https://github.com/ObolNetwork/obol-sdk/pull/96)
- fetch incentives by network [`#95`](https://github.com/ObolNetwork/obol-sdk/pull/95)

#### [v2.4.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.4.0...v2.4.1)

> 13 March 2025

- chore(release): v2.4.1 [`#94`](https://github.com/ObolNetwork/obol-sdk/pull/94)
- expect a provider in client [`#93`](https://github.com/ObolNetwork/obol-sdk/pull/93)

#### [v2.4.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.3.0...v2.4.0)

> 13 March 2025

- chore(release): v2.4.0 [`#92`](https://github.com/ObolNetwork/obol-sdk/pull/92)
- incentives methods [`#90`](https://github.com/ObolNetwork/obol-sdk/pull/90)

#### [v2.3.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.2.4...v2.3.0)

> 6 March 2025

- chore(release): v2.3.0 [`#89`](https://github.com/ObolNetwork/obol-sdk/pull/89)
- feat: add getIncentivesByAddress method to fetch incentives for a given address [`#77`](https://github.com/ObolNetwork/obol-sdk/pull/77)

#### [v2.2.4](https://github.com/ObolNetwork/obol-sdk/compare/v2.2.3...v2.2.4)

> 24 February 2025

- chore(release): v2.2.4 [`#87`](https://github.com/ObolNetwork/obol-sdk/pull/87)
- Hanan/v1.10.0 [`#86`](https://github.com/ObolNetwork/obol-sdk/pull/86)

#### [v2.2.3](https://github.com/ObolNetwork/obol-sdk/compare/v2.2.2...v2.2.3)

> 21 February 2025

- chore(release): v2.2.3 [`#85`](https://github.com/ObolNetwork/obol-sdk/pull/85)
- v1.10.0 [`#81`](https://github.com/ObolNetwork/obol-sdk/pull/81)
- feat: add renovate.json [`#75`](https://github.com/ObolNetwork/obol-sdk/pull/75)

#### [v2.2.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.2.1...v2.2.2)

> 7 February 2025

- chore(release): v2.2.2 [`#74`](https://github.com/ObolNetwork/obol-sdk/pull/74)
- fix environment variable check and update readme [`#73`](https://github.com/ObolNetwork/obol-sdk/pull/73)

#### [v2.2.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.2.0...v2.2.1)

> 7 February 2025

- chore(release): v2.2.1 [`#72`](https://github.com/ObolNetwork/obol-sdk/pull/72)
- fix verify eoa and safe signatures when publishing a lock [`#71`](https://github.com/ObolNetwork/obol-sdk/pull/71)

#### [v2.2.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.1.2...v2.2.0)

> 7 February 2025

- chore(release): v2.2.0 [`#69`](https://github.com/ObolNetwork/obol-sdk/pull/69)
- Hanan/support safe [`#68`](https://github.com/ObolNetwork/obol-sdk/pull/68)

#### [v2.1.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.1.1...v2.1.2)

> 8 January 2025

- chore(release): v2.1.2 [`#66`](https://github.com/ObolNetwork/obol-sdk/pull/66)
- Hanan/safe fix [`#65`](https://github.com/ObolNetwork/obol-sdk/pull/65)

#### [v2.1.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.1.0...v2.1.1)

> 23 October 2024

- chore(release): v2.1.1 [`#62`](https://github.com/ObolNetwork/obol-sdk/pull/62)
- Add owr tranch function [`#61`](https://github.com/ObolNetwork/obol-sdk/pull/61)

#### [v2.1.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.0.1...v2.1.0)

> 10 October 2024

- chore(release): v2.1.0 [`#60`](https://github.com/ObolNetwork/obol-sdk/pull/60)
- a warning and some improvements [`#59`](https://github.com/ObolNetwork/obol-sdk/pull/59)
- Hanan/create split [`#57`](https://github.com/ObolNetwork/obol-sdk/pull/57)

#### [v2.0.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.0.0...v2.0.1)

> 6 August 2024

- chore(release): v2.0.1 [`#55`](https://github.com/ObolNetwork/obol-sdk/pull/55)
- Hanan/null deposit amounts [`#54`](https://github.com/ObolNetwork/obol-sdk/pull/54)
- accept a null value for deposit_amounts [`#52`](https://github.com/ObolNetwork/obol-sdk/pull/52)

### [v2.0.0](https://github.com/ObolNetwork/obol-sdk/compare/v1.0.17...v2.0.0)

> 30 July 2024

- [Release] v2.0.0 [`#50`](https://github.com/ObolNetwork/obol-sdk/pull/50)

#### [v1.0.17](https://github.com/ObolNetwork/obol-sdk/compare/v1.0.16...v1.0.17)

> 2 July 2024

- fix release action [`#49`](https://github.com/ObolNetwork/obol-sdk/pull/49)
- [Release] v1.0.17 [`#48`](https://github.com/ObolNetwork/obol-sdk/pull/48)
- use v1.8.0 in cluster creation [`#32`](https://github.com/ObolNetwork/obol-sdk/pull/32)
- chore(release): v1.0.17 [`#47`](https://github.com/ObolNetwork/obol-sdk/pull/47)
- revert back to using git changelog [`#46`](https://github.com/ObolNetwork/obol-sdk/pull/46)
- Hanan/ta nd c [`#44`](https://github.com/ObolNetwork/obol-sdk/pull/44)

#### [v1.0.16](https://github.com/ObolNetwork/obol-sdk/compare/v1.0.15...v1.0.16)

> 24 May 2024

- chore(release): v1.0.16 [`#43`](https://github.com/ObolNetwork/obol-sdk/pull/43)
- Hanan/tandc [`#42`](https://github.com/ObolNetwork/obol-sdk/pull/42)

#### [v1.0.15](https://github.com/ObolNetwork/obol-sdk/compare/v1.0.14...v1.0.15)

> 22 May 2024

- chore(release): v1.0.15 [`#41`](https://github.com/ObolNetwork/obol-sdk/pull/41)
- add acceptTermsAndConditions method [`#39`](https://github.com/ObolNetwork/obol-sdk/pull/39)

#### [v1.0.14](https://github.com/ObolNetwork/obol-sdk/compare/v1.0.13...v1.0.14)

> 6 May 2024

- chore(release): v1.0.14 [`#40`](https://github.com/ObolNetwork/obol-sdk/pull/40)
- Fix publish step in release [`#38`](https://github.com/ObolNetwork/obol-sdk/pull/38)

#### [v1.0.13](https://github.com/ObolNetwork/obol-sdk/compare/v1.0.12...v1.0.13)

> 18 March 2024

- Update changelog [`#37`](https://github.com/ObolNetwork/obol-sdk/pull/37)
- Fix release WF [`#36`](https://github.com/ObolNetwork/obol-sdk/pull/36)
- chore(release): v1.0.13 [`#35`](https://github.com/ObolNetwork/obol-sdk/pull/35)
- add contribution guidelines [`#34`](https://github.com/ObolNetwork/obol-sdk/pull/34)
- support v1.8.0 [`#31`](https://github.com/ObolNetwork/obol-sdk/pull/31)
- update e2e during release [`#25`](https://github.com/ObolNetwork/obol-sdk/pull/25)
- Luke/Fix changelog [`#24`](https://github.com/ObolNetwork/obol-sdk/pull/24)
- Add a workflow to create a release PR [`#19`](https://github.com/ObolNetwork/obol-sdk/pull/19)
- fix changelog generation [`c16e588`](https://github.com/ObolNetwork/obol-sdk/commit/c16e5881773b47b7b7e02f3241888c49ed70077c)
- Create label-issues.yml [`0f1252f`](https://github.com/ObolNetwork/obol-sdk/commit/0f1252f24badba89251a3595cb5d57a0790e5faf)
- change to upgrade [`430bbc0`](https://github.com/ObolNetwork/obol-sdk/commit/430bbc05325f5b5f713b52952fd16954cf1396d6)

#### v1.0.12

> 27 February 2024

- Fix sdk deployment [`#18`](https://github.com/ObolNetwork/obol-sdk/pull/18)
- Hanan/update sdk [`#17`](https://github.com/ObolNetwork/obol-sdk/pull/17)
- Hanan/update sdk [`#16`](https://github.com/ObolNetwork/obol-sdk/pull/16)
- Hanan/update sdk [`#15`](https://github.com/ObolNetwork/obol-sdk/pull/15)
- Hanan/get cluster lock [`#12`](https://github.com/ObolNetwork/obol-sdk/pull/12)
- Hanan/config cluster method [`#3`](https://github.com/ObolNetwork/obol-sdk/pull/3)
- poc for obol-sdk [`#1`](https://github.com/ObolNetwork/obol-sdk/pull/1)
- Bump json5 from 2.2.1 to 2.2.3 [`#3`](https://github.com/ObolNetwork/obol-sdk/pull/3)
- add artifacts files [`76fe25c`](https://github.com/ObolNetwork/obol-sdk/commit/76fe25cf95733651b70d2e0d99f593994364a8c3)
- drop build info [`7265292`](https://github.com/ObolNetwork/obol-sdk/commit/7265292cb6b9264f4fe61bd4929a6d1acf495a15)
- add typechain files [`5e29b6a`](https://github.com/ObolNetwork/obol-sdk/commit/5e29b6adad0bc630d301a6274a58a678276ee773)
