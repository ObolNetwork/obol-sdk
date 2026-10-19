# Errors and findings

Every error is an `ObolError` with a stable `code` (API errors are `ObolApiError`, a subclass with the HTTP fields), a `message` (not normative), an optional `hint` and `cause`, and
the extra fields listed. Findings (`Prepared.checks`, or `issues` in a result) have a `code` and a `severity`.
"2.15" names the 2.15 code or class that had the same meaning; codes are reused where the meaning is the same.

Operation names refer to [`operations.md`](operations.md).

## Errors

### Input, client and chain

| Code | Meaning | Thrown by | Caller should | 2.15 |
|---|---|---|---|---|
| `PAYLOAD_INVALID` | An input failed its schema: missing field, wrong type or length, bad address or checksum, out-of-range integer, share sum. Fields: `issues: { path, message, issue? }[]`. | every operation (G1) | fix the listed fields | `PAYLOAD_INVALID` (`PayloadValidationError`); also replaces `INVALID_ARGUMENT` (`InvalidArgumentError`, one issue with the argument's path) |
| `UNSUPPORTED_CHAIN` | The chain is not supported at all, or not for this operation (contracts only on mainnet and Hoodi), or a pure check needs a fork version the SDK does not know. Fields: `chainId`, `operation`. | `createObolClient`, G2, `verifyDepositData`, `exits.verifyPartialExit` | use mainnet or Hoodi | `UnsupportedChainError` (no code) |
| `CHAIN_MISMATCH` | `publicClient`, `walletClient` or a `Prepared` is on another chain than the client. Fields: `expectedChainId`, `actualChainId`. | `createObolClient`, every signing operation, `send` | switch the wallet's chain, or build the client for the wallet's chain | `CHAIN_MISMATCH` |
| `WALLET_REQUIRED` | The operation signs or sends and the client has no `walletClient` (or no account). | `cluster.create`, `cluster.accept`, `terms.*`, `send` | pass a `walletClient` | `SignerRequiredError` (no code) |
| `INVALID_BASE_URL` | `api.baseUrl` is not an Obol API host. | `createObolClient` | use one of the allowed base URLs, or `api: false` | `InvalidBaseUrlError` (no code) |
| `API_DISABLED` | An `api` operation was called with `api: false`. | `api` operations; `deposits.status` without `beaconUrl` | enable the API, or use the chain-only operation | new |
| `CONTRACT_NOT_AVAILABLE` | A contract the operation calls has no code or not the expected code (factory, Multicall3, batch deposit, OVM target). Fields: `address`. | `prepareCreateOvm`, `prepareCreateSplit`, `prepareOvmWithSplits`, `prepareDeposit` | check the chain; contact Obol if it persists | plain `Error` ("Required factory contracts are not available") |
| `CHAIN_READ_FAILED` | A chain read needed for a check failed (RPC error, call reverted where it must not). | `splits.predictSplit`, reads inside `prepareX` | retry, or use another RPC | new (2.15 treated some as "not deployed") |

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
| `NOT_AN_OPERATOR` | The wallet account is not an operator of the definition. Fields: `address`, `configHash`. | `cluster.accept` | use the wallet of one of the operator addresses | `NOT_AN_OPERATOR` |
| `LOCK_INVALID` | A lock failed `verifyLock` or its deposit data is malformed. Fields: `step` and `issue` (see `verifyLock`), with `index` for a per-validator step; or `issue` (`deposit_data_missing`, `deposit_data_invalid`, `fork_version_mismatch`) and `index`. | `deposits.fromLock` | do not deposit; report the lock | plain `Error` ("Cluster lock failed validation", "Invalid deposit data for validator N") |

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
| `NOT_OVM_OWNER` | An owner-only call from another account. Fields: `from`, `owner`. | `prepareGrantRoles`, `prepareRevokeRoles`, `prepareTransfer`, `prepareCompleteOwnershipHandover`, `prepareSweep` with `beneficiary` | send from the owner | new |
| `OWNERSHIP_HANDOVER_NOT_PENDING` | No unexpired handover request from `pendingOwner`. | `prepareCompleteOwnershipHandover` | have the new owner call `requestOwnershipHandover` (valid 48 h) | new |
| `FULL_EXIT_NOT_ACKNOWLEDGED` | A withdrawal request with amount 0 (a full exit) without `acknowledgeFullExit: true`. | `prepareWithdraw`, `prepareEoaWithdraw` | confirm the validator should exit, then pass it; or pass the partial amount | new |
| `CONSOLIDATION_NOT_ACKNOWLEDGED` | `acknowledgeStakeMovesToTarget: true` missing. | `prepareConsolidate` | confirm the targets are yours, then pass it | 2.16 `CONSOLIDATION_NOT_ACKNOWLEDGED` |
| `FEE_OUT_OF_RANGE` | A given request fee is below the current fee × n or above max(10 × fee, 1 gwei) × n. Fields: `fee`, `minimum`, `maximum`. | `prepareWithdraw`, `prepareConsolidate`, `prepareEoaWithdraw` | omit the fee to use the default, or pass one in range | plain `Error` ("Withdrawal fee … below / far above …") |
| `FEE_READ_FAILED` | The EIP-7002 / EIP-7251 predeploy fee could not be read. | same | retry; check the chain is post-Pectra | plain `Error` |

### Splits and setup

| Code | Meaning | Thrown by | Caller should | 2.16 |
|---|---|---|---|---|
| `SPLIT_ALREADY_EXISTS` | The split is already deployed at the predicted address. Fields: `address`. | `splits.prepareCreateSplit` | use `address`; nothing to send | new |
| `SPLIT_NOT_FOUND` | The address is not a SplitV2 split (no code, an EIP-7702 delegation, a failed call or a zero `splitHash`). | `splits.getSplit` | check the address | new |
| `SPLIT_PARAMS_MISMATCH` | Split params do not hash to the split's on-chain `splitHash`, or reward and principal params differ for one address. Fields: `address`. | `getSplit`, `prepareDistribution` | pass the exact params the split was created with | `InvalidArgumentError` |
| `SPLIT_PARAMS_REQUIRED` | An OVM recipient is a SplitV2 split but no params were given; its funds would stay undistributed. Fields: `address`, `kind`. | `prepareDistribution` | pass its params as `rewardSplit` / `principalSplit` | `InvalidArgumentError` |
| `SPLIT_NOT_OVM_RECIPIENT` | A given split address is not the OVM's recipient of that kind. | `prepareDistribution` | omit the address or fix it | `InvalidArgumentError` |
| `SPLIT_PAUSED` | A split with funds to distribute is paused and the sender is not its owner. | `prepareDistribution` | ask the owner to unpause it | `SPLIT_PAUSED` |
| `NOTHING_TO_DISTRIBUTE` | No call would move anything (zero balances, dust only). | `prepareDistribution`, `ovm.prepareDistribute`, `prepareWithdrawPullBalance` | prepare again later | `NOTHING_TO_DISTRIBUTE` (at send) |
| `OVM_CREATE_EVENT_MISSING` | No `CreateObolValidatorManager` log from the chain's factory in the receipt. | `setup.ovmFromReceipt` | check the receipt is the create transaction | plain `Error` |
| `OVM_CREATE_EVENT_AMBIGUOUS` | More than one such log. | `setup.ovmFromReceipt` | read the addresses from the logs yourself | new |

### Incentives

| Code | Meaning | Thrown by | Caller should | 2.15 |
|---|---|---|---|---|
| `INCENTIVES_PREFLIGHT_FAILED` | A claim check failed. Fields: `issues` (finding codes below, severity `warning`). | `incentives.prepareClaim` | act on the first issue's hint; do not claim | `INCENTIVES_PREFLIGHT_FAILED` |
| `ALREADY_CLAIMED` | The incentives at this index were already claimed (the closed claim window is ignored then). | `incentives.prepareClaim` | nothing to do; treat as success | 2.15 returned `{ txHash: null }` |

### Exits

| Code | Meaning | Thrown by | Caller should |
|---|---|---|---|
| `EXIT_SHARE_INDEX_INVALID` | `shareIdx` outside `1..operators`, or no public share at it for a validator. | `exits.verifyPartialExit` | reject the payload |
| `EXIT_PAYLOAD_SIGNATURE_INVALID` | The payload signature is not by operator `shareIdx`'s ENR key (or is not 64/65 bytes). | `exits.verifyPartialExit` | reject the payload |
| `EXIT_VALIDATOR_NOT_IN_CLUSTER` | A blob's pubkey is not a validator of the cluster. | `exits.verifyPartialExit` | reject the blob |
| `EXIT_VALIDATOR_INDEX_MISMATCH` | The blob's `validator_index` differs from the stored exit for the pubkey. | `exits.verifyPartialExit` | reject the blob |
| `EXIT_EPOCH_REGRESSION` | The blob's epoch is lower than the stored exit's. | `exits.verifyPartialExit` | reject the blob |
| `EXIT_SIGNATURE_CONFLICT` | Same epoch, different partial signature than stored for this share. | `exits.verifyPartialExit` | reject the blob |
| `EXIT_PARTIAL_SIGNATURE_INVALID` | A partial signature does not verify against the public share, or the aggregate does not verify against the group key. | `exits.verifyPartialExit`, `exits.aggregate` | reject; for an aggregate, re-check stored partials |
| `EXIT_SIGNATURE_MALFORMED` | A stored partial signature is not 96 bytes of hex. | `exits.aggregate` | drop or re-collect that partial |
| `EXIT_NOT_ENOUGH_SHARES` | Fewer partial signatures than the threshold. | `exits.aggregate` | wait for more operators |

All exit errors were plain `Error`s in 2.15.

### Sending

| Code | Meaning | Thrown by | Caller should | 2.15 |
|---|---|---|---|---|
| `PREPARED_INVALID` | `send` got a malformed `Prepared`. | `send` | pass the value `prepareX` returned | 2.16 `InvalidArgumentError` |
| `TX_REJECTED` | The wallet refused or failed before returning a hash; nothing was sent. | `send` | retry if the user wants | new |
| `TX_REVERTED` | Mined with `status = 0`; nothing moved. Fields: `hash`, `receipt`. | `wait` | retry is safe; read the revert reason | `TX_FAILED_AFTER_SEND` with `pendingStatus: "reverted"` |
| `TX_REPLACED` | A different transaction was mined with the nonce (viem `cancelled` / `replaced`). Fields: `hash`, `replacement`. | `wait` | retry is safe for this call | new |
| `TX_UNCONFIRMED` | No receipt within the timeout (for a contract wallet: no Safe execution log); it may still be mined or executed. Fields: `hash`, `contractWallet`. | `wait` | watch the hash before retrying, so nothing is sent twice | `TX_FAILED_AFTER_SEND` with `pendingStatus: "unconfirmed"` |

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
| `PROVENANCE_UNKNOWN` [warning] | OVM provenance could not be checked (outside `prepareDeposit`). | OVM writes, `prepareDistribution` | retry `ovm.verify` before relying on the contract |
| `WITHDRAW_PARTIAL_REQUIRES_COMPOUNDING` [warning] | Partial withdrawal for a validator without `0x02` credentials: the beacon chain ignores it and keeps the fee. | `prepareWithdraw`, `prepareEoaWithdraw` | consolidate to `0x02` first, or exit |
| `WITHDRAW_CREDENTIALS_NOT_OVM` [warning] | The validator's credentials do not point at this OVM: the request is ignored, fee kept. | `prepareWithdraw` | use the OVM the validator points at |
| `WITHDRAW_CREDENTIALS_NOT_SENDER` [warning] | Direct EIP-7002 request from an address that is not the validator's withdrawal address. | `prepareEoaWithdraw` | send from the withdrawal address |
| `WITHDRAW_VALIDATOR_NOT_ACTIVE` [warning] | The validator is not active (queued or exited). | `prepareWithdraw` | wait for activation, or drop the request |
| `CONSOLIDATION_TARGET_NOT_COMPOUNDING` [warning] | Target not active or without `0x02` credentials. | `prepareConsolidate` | switch the target to `0x02` first |
| `CONSOLIDATION_CREDENTIALS_DIFFER` [warning] | Source and target have different withdrawal credentials. | `prepareConsolidate` | check the pubkeys |
| `PRINCIPAL_STAKE_MISMATCH` [warning] | `amountOfPrincipalStake` differs by more than 1 ETH from the principal the beacon chain credited to this OVM's validators (API `principalOnBeaconChain`). Distributions may pay rewards out as principal, or the reverse. Fields: `amountOfPrincipalStake`, `principalOnBeaconChain`. | `ovm.getState` | review deposits made via `OVM.deposit`; the owner can correct it with `prepareSetAmountOfPrincipalStake` |
| `ROLES_SURVIVE_TRANSFER` [warning] | A transfer or ownership handover keeps the current non-owner role holders. Fields: `holders`. | `prepareTransfer`, `prepareCompleteOwnershipHandover` | revoke roles that should not survive, before or after |
| `ROLE_HOLDERS_UNCHECKED` [info] | Role holders could not be read, so `ROLES_SURVIVE_TRANSFER` was not checked. | same | check `ovm.getRoleHolders` later |
| `ROLE_GRANT_CONSOLIDATION` [warning] | Granting `CONSOLIDATION`: the holder can move the whole stake into a validator it controls. | `prepareGrantRoles` | grant only to an address you would trust with the stake |
| `ROLE_GRANT_DEPOSIT_TO_PRINCIPAL` [warning] | Granting `DEPOSIT` to the principal recipient: it can raise `amountOfPrincipalStake` and take rewards as principal. | `prepareGrantRoles` | grant `DEPOSIT` to someone else |
| `RECIPIENT_WITHDRAW_PAUSED` [info] | A recipient paused Warehouse withdrawals and the sender cannot bypass it; its withdrawal is left out. | `prepareDistribution` | the recipient withdraws itself |
| `SPLIT_REUSED` [info] | A split already exists at the predicted address and is reused, not created. | `prepareOvmWithSplits` | none |
| `RECIPIENT_NOT_CONTRACT` [info] | An OVM recipient has no code (an EOA, or a split not created yet). | `prepareCreateOvm` | if it should be a split, create it first or use `prepareOvmWithSplits` |

Incentive claim issues (`INCENTIVES_PREFLIGHT_FAILED.issues`, and `incentives.preflight`), all from 2.15:
`NO_INCENTIVES`, `INCENTIVES_NOT_FOUND`, `INCENTIVES_FETCH_FAILED`, `OPERATOR_ADDRESS_MISMATCH`,
`INVALID_INCENTIVES_DATA`, `CONTRACT_NOT_DEPLOYED`, `UNKNOWN_DISTRIBUTOR`, `UNSUPPORTED_CHAIN`, `UNEXPECTED_TOKEN`,
`INVALID_PROOF`, `ALREADY_CLAIMED`, `CLAIM_WINDOW_CLOSED`, `CHAIN_READ_FAILED`. Their meaning is the check of the same
name in `incentives.prepareClaim`. (2.15's `PROVIDER_REQUIRED` is gone: v3 always has a `publicClient`.)
