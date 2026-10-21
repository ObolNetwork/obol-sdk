# Errors and findings

Every error is an `ObolError` with a stable `code` (API errors are `ObolApiError`, a subclass with the HTTP fields), a
`message` (not normative), an optional `hint` and `cause`, and the extra fields listed, in `details`. Findings
(`Prepared.checks`, or `issues` in a result) have a `code`, a `severity` and, when they are about one item, a stable
`subject` (`{ pubkey }`, `{ address }` or `{ index }`). "2.15" names the 2.15 code or class that had the same meaning;
codes are reused where the meaning is the same.

In TypeScript the codes are the `ObolErrorCode` and `FindingCode` unions (`OBOL_ERROR_CODES`, `FINDING_CODES` at
runtime) and `ObolErrorDetails` types the fields of each code; `isObolError(error, code)` narrows `details`.
`test/spec/conformance.spec.ts` checks that the codes below, those unions and the codes used in `src/` are the same
set.

**Naming.** A code names its subject first, then the condition: `DEFINITION_INVALID`, `OVM_READ_FAILED`,
`SPLIT_PARAMS_REQUIRED`. 3.0.0-rc.4 renamed the codes that did not follow it (`INVALID_BASE_URL` →
`BASE_URL_INVALID`, `NOT_AN_OPERATOR` → `ACCOUNT_NOT_OPERATOR`, `NOT_OVM_OWNER` → `OVM_OWNER_REQUIRED`,
`ROLE_TO_PUBLIC_FORWARDER` → `PUBLIC_FORWARDER_AS_ROLE_HOLDER`, `OWNER_TO_PUBLIC_FORWARDER` → `PUBLIC_FORWARDER_AS_OWNER`,
`RECIPIENT_IS_PUBLIC_FORWARDER` → `PUBLIC_FORWARDER_AS_RECIPIENT`, `INVALID_INCENTIVES_DATA` → `INCENTIVES_DATA_INVALID`,
`UNKNOWN_DISTRIBUTOR` → `DISTRIBUTOR_UNKNOWN`, `UNEXPECTED_TOKEN` → `TOKEN_MISMATCH`, `INVALID_PROOF` →
`PROOF_INVALID`, `EXIT_EPOCH_REGRESSION` → `EXIT_EPOCH_MISMATCH`); the CHANGELOG lists every rename and removal.

Operation names refer to [`operations.md`](operations.md).

## Errors

### Input, client and chain

| Code | Meaning | Thrown by | Caller should | 2.15 |
|---|---|---|---|---|
| `PAYLOAD_INVALID` | An input failed its schema: missing field, wrong type or length, bad address or checksum, out-of-range integer, share sum. Fields: `issues: { path, message, issue? }[]`. | every operation (G1) | fix the listed fields | `PAYLOAD_INVALID` (`PayloadValidationError`); also replaces `INVALID_ARGUMENT` (`InvalidArgumentError`, one issue with the argument's path) |
| `UNSUPPORTED_CHAIN` | The chain is not supported at all, or not for this operation (contracts only on mainnet and Hoodi), or a pure check needs a fork version the SDK does not know. Fields: `chainId`, `operation`. | `createObolClient`, G2, `verifyDepositData`, `exits.verifyPartialExit` | use mainnet or Hoodi | `UnsupportedChainError` (no code) |
| `CHAIN_MISMATCH` | `publicClient`, `walletClient` or a `Prepared` is on another chain than the client. Fields: `expectedChainId`, `actualChainId`. | `createObolClient`, every signing operation, `send` | switch the wallet's chain, or build the client for the wallet's chain | `CHAIN_MISMATCH` |
| `WALLET_REQUIRED` | The operation signs or sends and the client has no `walletClient` (or no account). | `cluster.create`, `cluster.accept`, `terms.*`, `send` | pass a `walletClient` | `SignerRequiredError` (no code) |
| `BASE_URL_INVALID` | `api.baseUrl` is not an Obol API host. | `createObolClient` | use one of the allowed base URLs, or `api: false` | `InvalidBaseUrlError` (no code) |
| `API_DISABLED` | An `api` operation was called with `api: false`. Fields: `operation`. | `api` operations; `deposits.status` without `beaconUrl` | enable the API, or use the chain-only operation | new |
| `CONTRACT_NOT_AVAILABLE` | A contract the operation calls has no code or not the expected code (factory, Multicall3, batch deposit, OVM target). Fields: `address`. | `prepareCreateOvm`, `prepareCreateSplit`, `prepareOvmWithSplits`, `prepareDeposit` | check the chain; contact Obol if it persists | plain `Error` ("Required factory contracts are not available") |
| `CHAIN_READ_FAILED` | A chain read needed for a check failed (RPC error, call reverted where it must not). Fields: `what`. | `splits.predictSplit`, reads inside `prepareX` | retry, or use another RPC | new (2.15 treated some as "not deployed") |

### Obol API

All carry `status`, `endpoint`, `method`, `body`. `API_*` errors only describe the HTTP exchange; a 2xx answer that
fails a local check raises the check's own code.

| Code | Meaning | Caller should | 2.15 |
|---|---|---|---|
| `API_VALIDATION` | 400 / 422: the API rejected the request. | fix the request per the API message | `ValidationError` |
| `API_UNAUTHORIZED` | 401 / 403: signature or address not accepted; also terms not accepted. | check the wallet, chain and `terms.accept` | `UnauthorizedError` |
| `API_NOT_FOUND` | 404. | check the hash / address and chain; a lock may not exist yet | `NotFoundError` |
| `API_CONFLICT` | 409: the resource exists (definition, terms acceptance, ENR). | read the existing resource instead | `ConflictError` |
| `API_RATE_LIMIT` | 429. | back off and retry | `RateLimitError` |
| `API_TIMEOUT` | No response within `timeoutMs`. The API may have processed a write. | read the resource before retrying a write | `RequestTimeoutError` |
| `API_ERROR` | Any other non-2xx status, or an unparsable body. | retry later | `ObolApiError` |
| `API_RESPONSE_MISMATCH` | A 2xx answer is not for what was asked (a definition or lock whose hash differs from the requested one). | report it; do not use the answer | new |

### Cluster

| Code | Meaning | Thrown by | Caller should | 2.15 |
|---|---|---|---|---|
| `DEFINITION_INVALID` | A definition failed `verifyDefinition`: config hash mismatch, wrong `fork_version`, unsupported version, invalid signature, or a conflicting `version` input. Fields: `issues: { code, message }[]` (`config_hash_mismatch`, `fork_version_mismatch`, `version_unsupported`, `version_mismatch`, `signature_invalid`). | `cluster.accept`, `cluster.create`, `computeConfigHash` | do not sign it; check the config hash and the client chain | `DEFINITION_VERIFICATION_FAILED` (`DefinitionVerificationError`) |
| `ACCOUNT_NOT_OPERATOR` | The wallet account is not an operator of the definition. Fields: `address`, `configHash`. | `cluster.accept` | use the wallet of one of the operator addresses | `ACCOUNT_NOT_OPERATOR` |
| `LOCK_INVALID` | A lock failed `verifyLock` (see its steps; `definition_invalid` covers an unknown fork version, `num_validators` other than the number of validators and `deposit_amounts` outside Charon's rules) or its deposit data is malformed. Fields: `step` and `issue` (see `verifyLock`), with `index` for a per-validator step; or `issue` (`deposit_data_missing`, `deposit_data_invalid`, `fork_version_mismatch`) and `index`. | `deposits.fromLock` | do not deposit; report the lock | plain `Error` ("Cluster lock failed validation", "Invalid deposit data for validator N") |

2.15's `ClusterLockValidationTimeoutError` and `ClusterLockValidationBusyError` have no v3 code: `verifyLock` runs
on the calling thread with no workers, time limit or concurrency limit, and yields to the event loop (`yieldMs`). A
server that needs a deadline or a limit applies it around the call.

### Deposits

| Code | Meaning | Thrown by | Caller should | 2.15 |
|---|---|---|---|---|
| `DEPOSIT_INVALID` | A deposit failed a check. Fields: `index`, `issue`: `amount_not_whole_gwei`, `amount_below_minimum`, `amount_above_maximum`, `credentials_prefix_unknown`, `credentials_malformed`, `credentials_mismatch`, `root_mismatch`, `signature_invalid`. | `verifyDepositData`, `prepareDeposit` | do not send; regenerate the deposit data or fix the target | plain `Error` ("Invalid deposit at index N: …") |
| `DEPOSIT_LOOKS_LIKE_TOP_UP` | `kind: "deposit"` with an all-zero signature: a top-up payload. Sent to a new validator, the ETH is lost. Fields: `index`. | `verifyDepositData`, `prepareDeposit` | pass `kind: "topUp"` if the validator exists | `DEPOSIT_LOOKS_LIKE_TOP_UP` |
| `DEPOSIT_CONFLICT` | A pending deposit for the pubkey has different or unknown withdrawal credentials; the first processed deposit fixes them. Fields: `index`, `pubkey`, `existingCredentials?`. | `prepareDeposit` | do not send; find out who queued the other deposit | 2.16 `DepositConflictError` |
| `DEPOSIT_TOP_UP_TARGET_MISSING` | `kind: "topUp"` for a pubkey with no validator and no pending deposit; the deposit would be treated as new and fail its signature check. Fields: `index`, `pubkey`. | `prepareDeposit` | check the pubkey; send the full deposit data first | new |
| `DEPOSIT_AMOUNT_NOT_IN_LOCK` | The requested amount is not present for every validator of the lock. Fields: `amount`, `available: bigint[]`. | `deposits.fromLock` | pick one of `available` | plain `Error` |
| `STATUS_UNAVAILABLE` | The deposit status source failed, or answered incompletely or malformed. Also the Obol API without `POST /v1/validators/:network/deposit-status` (404) and neither `lockHash` nor `beaconUrl` given: `reason: "endpoint_unavailable"` (writes then skip the status checks, as with no source). | `deposits.status`, `ovm.getValidators`, writes that read status | retry; do not assume `new`; for `endpoint_unavailable`, pass `lockHash` or `beaconUrl` | 2.16 plain `Error` ("Malformed …") |

### OVM

| Code | Meaning | Thrown by | Caller should | 2.15 / 2.16 |
|---|---|---|---|---|
| `OVM_NOT_OBOL` | `ovm.verify` says the address was not created by the Obol OVM factory (or has no code). Fields: `address`, `source`. | `prepareDeposit`, OVM writes, `prepareDistribution` | check the address; never deposit to it | new |
| `PROVENANCE_UNKNOWN` | Provenance could not be checked (RPC refused the log scan, API down). Error in `prepareDeposit`; a warning Finding elsewhere. | `prepareDeposit` | retry, or use an RPC that serves `eth_getLogs` over 50,000 blocks | design |
| `OVM_READ_FAILED` | The address did not answer the OVM getters. | `ovm.getState`, `ovm.getRoleHolders`, `prepareDistribution`, OVM writes | check the address and chain; run `ovm.verify` | 2.16 `OVM_READ_FAILED` |
| `OVM_ROLE_EVENTS_UNAVAILABLE` | `RolesUpdated` events could not be read from any source. | `ovm.getRoleHolders` | retry later, or another RPC | 2.16 `OVM_ROLE_EVENTS_UNAVAILABLE` |
| `OVM_ROLE_MISSING` | The sender is neither the owner nor holds the role the call needs; it would revert. Fields: `from`, `role`. | `prepareDeposit` (ovm), `prepareWithdraw`, `prepareConsolidate`, role-gated writes | send from the owner or a role holder, or `prepareGrantRoles` first | new |
| `OVM_OWNER_REQUIRED` | An owner-only call from another account. Fields: `from`, `owner`. | `prepareGrantRoles`, `prepareRevokeRoles`, `prepareTransfer`, `prepareCompleteOwnershipHandover`, `prepareSweep` with `to` | send from the owner | new (rc.3 `NOT_OVM_OWNER`) |
| `PUBLIC_FORWARDER_AS_ROLE_HOLDER` | `user` is a public forwarder of the chain (Multicall3 and the like; see operations.md "Public forwarders"): it makes calls as itself for any caller, so anyone could use the roles. Fields: `user`, `roles`, `reason`. | `prepareGrantRoles` | grant the roles to the account or Safe that will send the calls | new (rc.3 `ROLE_TO_PUBLIC_FORWARDER`) |
| `PUBLIC_FORWARDER_AS_OWNER` | The new owner is a public forwarder: anyone could call every owner-only and role-gated function through it. Fields: `newOwner`, `path?`, `reason`. | `prepareTransfer`, `prepareCompleteOwnershipHandover`, `setup.prepareCreateOvm`, `prepareOvmWithSplits`, `splits.prepareCreateSplit` (OVM or split owner) | use the account or Safe that will manage the contract | new (rc.3 `OWNER_TO_PUBLIC_FORWARDER`) |
| `PUBLIC_FORWARDER_AS_RECIPIENT` | An OVM or split recipient is a public forwarder: anyone could move ETH it holds. Fields: `path`, `recipient`, `reason`. | `setup.prepareCreateOvm`, `prepareOvmWithSplits`, `splits.prepareCreateSplit` | use the account, Safe or split that should receive the funds | new (rc.3 `RECIPIENT_IS_PUBLIC_FORWARDER`) |
| `OWNERSHIP_HANDOVER_NOT_PENDING` | No unexpired handover request from `pendingOwner`. Fields: `pendingOwner`, `expiresAt`. | `prepareCompleteOwnershipHandover` | have the new owner call `requestOwnershipHandover` (valid 48 h) | new |
| `FULL_EXIT_NOT_ACKNOWLEDGED` | A withdrawal request with amount 0 (a full exit) without `acknowledgeFullExit: true`. | `prepareWithdraw`, `prepareEoaWithdraw` | confirm the validator should exit, then pass it; or pass the partial amount | new |
| `CONSOLIDATION_NOT_ACKNOWLEDGED` | `acknowledgeStakeMovesToTarget: true` missing. | `prepareConsolidate` | confirm the targets are yours, then pass it | 2.16 `CONSOLIDATION_NOT_ACKNOWLEDGED` |
| `FEE_OUT_OF_RANGE` | A given request fee is below the current fee × n or above max(10 × fee, 1 gwei) × n. Fields: `fee`, `minimum`, `maximum`. | `prepareWithdraw`, `prepareConsolidate`, `prepareEoaWithdraw` | omit the fee to use the default, or pass one in range | plain `Error` ("Withdrawal fee … below / far above …") |
| `FEE_READ_FAILED` | The EIP-7002 / EIP-7251 predeploy fee could not be read. Fields: `predeploy`. | same | retry; check the chain is post-Pectra | plain `Error` |

### Withdrawal and consolidation requests

The beacon chain ignores an execution-layer request that breaks one of its rules (Electra `process_withdrawal_request`,
EIP-7002; `process_consolidation_request`, EIP-7251) and keeps the fee, so each rule the status source lets the SDK
check is a blocking error. Every one carries `pubkey`. Without the data for a rule the SDK adds
`VALIDATOR_STATUS_UNCHECKED` (info) instead. All new in 3.0.0-rc.4 (rc.3 had some of them as warnings).

| Code | Meaning | Thrown by | Caller should |
|---|---|---|---|
| `VALIDATOR_NOT_ACTIVE` | The validator is not in the registry or not active yet. Fields: `status`. | `prepareWithdraw`, `prepareEoaWithdraw`, `prepareConsolidate` (source and target) | wait for activation, or drop the request (rc.3 warning `WITHDRAW_VALIDATOR_NOT_ACTIVE`) |
| `VALIDATOR_EXITING` | The validator's exit is initiated (`exit_epoch` set), or it has exited. Fields: `exitEpoch`. | same | drop the request |
| `VALIDATOR_TOO_NEW` | Fewer than 256 epochs (`SHARD_COMMITTEE_PERIOD`, about 27 h) since activation. Fields: `activationEpoch`, `eligibleEpoch`, `currentEpoch`. | `prepareWithdraw`, `prepareEoaWithdraw`, `prepareConsolidate` (source) | wait until `eligibleEpoch` |
| `CREDENTIALS_NOT_SOURCE` | The validator's withdrawal credentials are not `0x01` / `0x02` credentials of the address that sends the request (the OVM; the sender for a direct request; the OVM for a consolidation source). Fields: `withdrawalCredentials`, `source`. | same | send from the address the credentials point at (rc.3 warnings `WITHDRAW_CREDENTIALS_NOT_OVM`, `WITHDRAW_CREDENTIALS_NOT_SENDER`) |
| `EXIT_BLOCKED_BY_PENDING_WITHDRAWAL` | A full exit while partial withdrawals are pending for the validator (including partials earlier in the same transaction). Fields: `pendingPartialWithdrawals`. | `prepareWithdraw`, `prepareEoaWithdraw` | wait for them to be processed |
| `PARTIAL_REQUIRES_COMPOUNDING` | A partial withdrawal for a validator without `0x02` credentials. Fields: `withdrawalCredentials`. | same | consolidate to `0x02` first (source = target), or exit (rc.3 warning `WITHDRAW_PARTIAL_REQUIRES_COMPOUNDING`) |
| `EFFECTIVE_BALANCE_TOO_LOW` | A partial withdrawal with an effective balance below 32 ETH. Fields: `effectiveBalance`. | same | top up or wait (effective balance steps up at 32 + 1.25 ETH) |
| `NO_EXCESS_BALANCE` | A partial withdrawal while the balance is not above 32 ETH plus the pending partial withdrawals. Fields: `balance`, `pendingPartialWithdrawals`. | same | drop the request |
| `CONSOLIDATION_TARGET_NOT_COMPOUNDING` | The target of a consolidation (source ≠ target) does not have `0x02` credentials. Fields: `withdrawalCredentials`. | `prepareConsolidate` | switch the target to `0x02` first (rc.3 warning) |
| `CONSOLIDATION_BLOCKED_BY_PENDING_WITHDRAWAL` | The source has pending partial withdrawals. Fields: `pendingPartialWithdrawals`. | `prepareConsolidate` | wait for them to be processed |
| `CONSOLIDATION_ALREADY_COMPOUNDING` | A switch to compounding (source = target) for a validator that already has `0x02` credentials. | `prepareConsolidate` | drop the request |

### Splits and setup

| Code | Meaning | Thrown by | Caller should | 2.16 |
|---|---|---|---|---|
| `SPLIT_ALREADY_EXISTS` | The split is already deployed at the predicted address. Fields: `address`. | `splits.prepareCreateSplit` | use `address`; nothing to send | new |
| `SPLIT_PARAMS_MISMATCH` | Split params do not hash to the split's on-chain `splitHash`, or reward and principal params differ for one address. Fields: `address`. | `getSplit`, `prepareDistribution` | pass the exact params the split was created with | `InvalidArgumentError` |
| `SPLIT_PARAMS_REQUIRED` | An OVM recipient is a SplitV2 split but no params were given; its funds would stay undistributed. Fields: `address`, `kind`. | `prepareDistribution` | pass its params as `rewardSplit` / `principalSplit` | `InvalidArgumentError` |
| `SPLIT_NOT_OVM_RECIPIENT` | A given split address is not the OVM's recipient of that kind. | `prepareDistribution` | omit the address or fix it | `InvalidArgumentError` |
| `SPLIT_PAUSED` | A split with funds to distribute is paused and the sender is not its owner, or is its owner but a contract (through Multicall3 only an EOA owner passes the pause). Fields: `address`, `owner?`. | `prepareDistribution` | ask the owner to unpause it | `SPLIT_PAUSED` |
| `NOTHING_TO_DISTRIBUTE` | No call would move anything (zero balances, dust only). | `prepareDistribution`, `ovm.prepareDistribute`, `prepareWithdrawPullBalance` | prepare again later | `NOTHING_TO_DISTRIBUTE` (at send) |
| `OVM_CREATE_EVENT_MISSING` | No `CreateObolValidatorManager` log from the chain's factory in the receipt. | `setup.ovmFromReceipt` | check the receipt is the create transaction | plain `Error` |
| `OVM_CREATE_EVENT_AMBIGUOUS` | More than one such log. Fields: `ovms`. | `setup.ovmFromReceipt` | read the addresses from the logs yourself | new |

### Incentives

| Code | Meaning | Thrown by | Caller should | 2.15 |
|---|---|---|---|---|
| `INCENTIVES_PREFLIGHT_FAILED` | A claim check failed. Fields: `issues` (finding codes below, severity `warning`). | `incentives.prepareClaim` | act on the first issue's hint; do not claim | `INCENTIVES_PREFLIGHT_FAILED` |
| `ALREADY_CLAIMED` | The incentives at this index were already claimed (the closed claim window is ignored then). Fields: `index`. | `incentives.prepareClaim` | nothing to do; treat as success | 2.15 returned `{ txHash: null }` |

### Exits

Every exit error carries `pubkey` where it is about one validator.

| Code | Meaning | Thrown by | Caller should |
|---|---|---|---|
| `EXIT_SHARE_INDEX_INVALID` | `share_idx` outside `1..operators`, or no public share at it for a validator. Fields: `shareIdx`. | `exits.verifyPartialExit` | reject the payload |
| `EXIT_PAYLOAD_SIGNATURE_INVALID` | The payload signature is not 65 bytes, or not by operator `share_idx`'s ENR key over the payload root (partial exits sorted by validator index). Fields: `shareIdx`. | `exits.verifyPartialExit` | reject the payload |
| `EXIT_VALIDATOR_NOT_IN_CLUSTER` | A blob's pubkey is not a validator of the cluster. | `exits.verifyPartialExit` | reject the blob |
| `EXIT_VALIDATOR_INDEX_MISMATCH` | The blob's `validator_index` differs from the stored exit for the pubkey. Fields: `validatorIndex`, `storedValidatorIndex`. | `exits.verifyPartialExit` | reject the blob |
| `EXIT_EPOCH_MISMATCH` | The blob's epoch differs from the stored exit's (rc.3 `EXIT_EPOCH_REGRESSION`, which only refused a lower one). Fields: `epoch`, `storedEpoch`. | `exits.verifyPartialExit` | reject the blob |
| `EXIT_SIGNATURE_CONFLICT` | A different partial signature is stored for this share. Fields: `shareIdx`. | `exits.verifyPartialExit` | reject the blob |
| `EXIT_PARTIAL_SIGNATURE_INVALID` | A partial signature does not verify against the public share, or the aggregate does not verify against the group key (the public shares are not the validator's). Fields: `shareIdx?`. | `exits.verifyPartialExit`, `exits.aggregate` | reject; for an aggregate, check the public shares |
| `EXIT_NOT_ENOUGH_SHARES` | Fewer valid partial signatures than the threshold (malformed or invalid stored ones are left out). Fields: `threshold`, `valid`, `invalid` (share indexes). | `exits.aggregate` | wait for more operators; re-collect the invalid shares |

All exit errors were plain `Error`s in 2.15. rc.3's `EXIT_SIGNATURE_MALFORMED` is gone: `aggregate` skips a malformed
stored signature like an invalid one.

### Sending

| Code | Meaning | Thrown by | Caller should | 2.15 |
|---|---|---|---|---|
| `PREPARED_INVALID` | `send` or `simulate` got a malformed `Prepared` (no known `kind`, or a malformed `request`). | `send`, `simulate` | pass the value `prepareX` returned | 2.16 `InvalidArgumentError` |
| `TX_REJECTED` | The wallet refused or failed before returning a hash; nothing was sent. | `send` | retry if the user wants | new |
| `TX_REVERTED` | Mined with `status = 0`; nothing moved. Fields: `hash`, `receipt`. | `wait` | retry is safe; read the revert reason | `TX_FAILED_AFTER_SEND` with `pendingStatus: "reverted"` |
| `TX_REPLACED` | A different transaction was mined with the nonce. Fields: `hash`, `reason` (`cancelled` or `replaced`, from viem), `replacement` (its hash). A `repriced` replacement (a speed-up) is not an error: `wait` resolves with its receipt and reports it through `onReplaced`. | `wait` | retry is safe for this call | new |
| `TX_UNCONFIRMED` | No receipt within the timeout (for a contract wallet: no Safe execution log); it may still be mined or executed. Fields: `hash`, `contractWallet`. | `wait` | watch the hash before retrying, so nothing is sent twice | `TX_FAILED_AFTER_SEND` with `pendingStatus: "unconfirmed"` |
| `SIMULATION_FAILED` | The node failed to simulate (a transport error, a block it no longer has state for, an `eth_call` error that is not an execution failure), or a forced `backend` is not supported or fails. A revert is not this error: it is `success: false`. Fields: `backend`. | `simulate` | retry, simulate at the latest block, or use another RPC | new |

## Findings

`severity` in brackets. Findings never stop an operation.

| Code | Meaning | Emitted by | Caller should |
|---|---|---|---|
| `DEPOSIT_EXISTENCE_UNCHECKED` [info] | No deposit status source; `kind` was trusted. | `prepareDeposit` | enable the API or pass `beaconUrl` to have it checked |
| `DEPOSIT_IS_TOP_UP` [warning] | `kind: "deposit"` for an existing validator: it tops up, and its credentials are ignored. | `prepareDeposit` | confirm this is intended |
| `DEPOSIT_ALREADY_QUEUED` [info] | Deposits with the same credentials are already queued for the pubkey. | `prepareDeposit` | make sure this is not a repeat |
| `TOP_UP_ABOVE_EFFECTIVE_CAP` [warning] | Deposit to a `0x01` (or `0x00`) validator that takes its balance (with queued deposits) above 32 ETH; the excess is swept back to the withdrawal address, not staked. | `prepareDeposit` | deposit at most up to 32 ETH, or consolidate to `0x02` first |
| `TOP_UP_EXITED_VALIDATOR` [warning] | Top-up to an exited validator: the ETH is swept back to its withdrawal address, not staked. | `prepareDeposit` | do not top up |
| `OVM_STAKE_NOT_TRACKED` [warning] | Deposit to OVM credentials through the batch contract: `amountOfPrincipalStake` is not raised, so the principal would later be paid as rewards. | `prepareDeposit` | deposit via the OVM, or have the owner call `setAmountOfPrincipalStake` |
| `PROVENANCE_UNKNOWN` [warning] | OVM provenance could not be checked (outside `prepareDeposit`). Subject: the OVM. | OVM writes, `prepareDistribution` | retry `ovm.verify` before relying on the contract |
| `VALIDATOR_STATUS_UNCHECKED` [info] | The beacon chain request rules could not all be checked: no status source (`details.checks: ["all"]`), or the source did not give what a check needs (`details.checks` names them: `activation epoch`, `exit epoch`, `pending partial withdrawals`, `balance`, `effective balance`, `credentials` when the sender is unknown; `subject` is the validator). | `prepareWithdraw`, `prepareEoaWithdraw`, `prepareConsolidate` | pass `beaconUrl`, or use an API with the full deposit-status answer |
| `WITHDRAW_AMOUNT_CAPPED` [info] | A partial amount above what the validator can withdraw now (balance − 32 ETH − pending partials) was capped to it; the request and the preview carry the capped `amount` and the asked `requestedAmount`. | `prepareWithdraw`, `prepareEoaWithdraw` | none; the beacon chain would cap it the same way |
| `PARTIAL_WITHDRAWAL_QUEUE_FULL` [warning] | The beacon chain's pending partial withdrawal queue is full (2^27 entries; known only from a beacon node): a partial request is ignored. | `prepareWithdraw`, `prepareEoaWithdraw` | wait for the queue to drain |
| `CONSOLIDATION_CREDENTIALS_DIFFER` [warning] | Source and target have different withdrawal addresses: the stake moves out of this OVM (the chain allows it). | `prepareConsolidate` | check that the target is yours |
| `PRINCIPAL_STAKE_MISMATCH` [warning] | `amountOfPrincipalStake` differs by more than 1 ETH from the principal the beacon chain credited to this OVM's validators (API `principalOnBeaconChain`). Distributions may pay rewards out as principal, or the reverse. Fields: `amountOfPrincipalStake`, `principalOnBeaconChain`. | `ovm.getState` | review deposits made via `OVM.deposit`; the owner can correct it with `prepareSetAmountOfPrincipalStake` |
| `PUBLIC_FORWARDER_HOLDS_ROLE` [warning] | The owner or a role holder is a public forwarder (Multicall3 and the like): anyone can call the role-gated functions through it. Fields: `holders: { address, name, roles, roleNames, isOwner }[]`. | `ovm.getState`, `ovm.getRoleHolders` | revoke the forwarder's roles (or transfer ownership away from it) now |
| `ROLES_SURVIVE_TRANSFER` [warning] | A transfer or ownership handover keeps the current non-owner role holders. Fields: `holders`. | `prepareTransfer`, `prepareCompleteOwnershipHandover` | revoke roles that should not survive, before or after |
| `ROLE_HOLDERS_UNCHECKED` [info] | Role holders could not be read, so `ROLES_SURVIVE_TRANSFER` was not checked. | same | check `ovm.getRoleHolders` later |
| `ROLE_GRANT_CONSOLIDATION` [warning] | Granting `CONSOLIDATION`: the holder can move the whole stake into a validator it controls. | `prepareGrantRoles` | grant only to an address you would trust with the stake |
| `ROLE_GRANT_DEPOSIT_TO_PRINCIPAL` [warning] | Granting `DEPOSIT` to the principal recipient: it can raise `amountOfPrincipalStake` and take rewards as principal. | `prepareGrantRoles` | grant `DEPOSIT` to someone else |
| `RECIPIENT_WITHDRAW_PAUSED` [info] | A recipient paused Warehouse withdrawals and the sender cannot bypass it; its withdrawal is left out. Subject: the recipient. | `prepareDistribution` | the recipient withdraws itself |
| `RAF_LEFT_IN_WAREHOUSE` [info] | The Obol RAF address has a Warehouse balance and is not in the withdrawal set (`includeRaf: false`, or `recipients` without it). Fields: `address`, `amount` (what stays, after this distribution). | `prepareDistribution`, `previewDistribution` | none needed; include it to withdraw it too (anyone may) |
| `SPLIT_REUSED` [info] | A split already exists at the predicted address and is reused, not created. | `prepareOvmWithSplits` | none |
| `RECIPIENT_NOT_CONTRACT` [info] | An OVM recipient has no code (an EOA, or a split not created yet). | `prepareCreateOvm` | if it should be a split, create it first or use `prepareOvmWithSplits` |
| `SIMULATION_UNAVAILABLE` [info] | Neither `eth_simulateV1` nor `debug_traceCall` could simulate the request (the node lacks them or rejected the request); only success or revert was checked (`eth_call`), and the result is `limited`. Fields: `tried`, `skipped: { backend, reason }[]`. | `simulate` | use an RPC with `eth_simulateV1` to see balance changes and events |
| `SIMULATION_REVERTED` [warning] | The request reverts when simulated. Fields: `revertReason`. | `simulate` | do not send it; prepare again, or check the sender and state |
| `SIMULATION_PREVIEW_MISMATCH` [warning] | The simulation differs from the operation's `preview`. When the simulated block is not the prepared one, the message says the state moved since prepare. Fields: `differences`, `stateMoved`, `preparedBlockNumber?`, `blockNumber`. | `simulate` | prepare again and simulate the new transaction; if it persists at the same block, report it (an SDK bug) |
| `SIMULATION_UNTRUSTED_EVENT` [warning] | A contract with no known role in this transaction emitted a decodable event; it was listed (`trusted: false`) but not interpreted. Fields: `events: { address, name }[]`. | `simulate` | do not rely on it; the balance changes come from the trace |
| `SIMULATION_CONTRACT_WALLET` [info] | The sender is a contract wallet (a Safe): the call was simulated with it as `msg.sender`; its own signature, owner, threshold and nonce checks were not. Fields: `from`. | `simulate` | check the Safe transaction in the Safe app as well |

Incentive claim issues (`INCENTIVES_PREFLIGHT_FAILED.issues`, and `incentives.preflight`), from 2.15 (three renamed in
rc.4, see Naming): `NO_INCENTIVES`, `INCENTIVES_NOT_FOUND`, `INCENTIVES_FETCH_FAILED`, `OPERATOR_ADDRESS_MISMATCH`,
`INCENTIVES_DATA_INVALID`, `CONTRACT_NOT_DEPLOYED`, `DISTRIBUTOR_UNKNOWN`, `UNSUPPORTED_CHAIN`, `TOKEN_MISMATCH`,
`PROOF_INVALID`, `ALREADY_CLAIMED`, `CLAIM_WINDOW_CLOSED`, `CHAIN_READ_FAILED`. Their meaning is the check of the same
name in `incentives.prepareClaim`. (2.15's `PROVIDER_REQUIRED` is gone: v3 always has a `publicClient`.)
