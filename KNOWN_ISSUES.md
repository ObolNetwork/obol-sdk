# Known Issues

This document lists findings that have already been submitted and reviewed for the Obol SDK (`@obolnetwork/obol-sdk`). Every item below has been evaluated by the Obol Security Team and is either resolved, accepted as a design trade-off, or determined not to be a vulnerability.

**Please do not resubmit these findings or close variants of them.** Duplicate submissions will not be eligible for a reward.

The entries describe SDK 3.x (viem, `createObolClient`). Items specific to the 2.x maintenance line (ethers, `Client`) are listed separately at the end.

Many of these findings follow from the SDK's trust model: it is a client library that acts for its caller, with the caller's wallet, against the Obol API and the viem clients the caller passes. Behavior that falls within the assumptions below is not considered a vulnerability. The deployed contracts have their own list in [`obol-splits/KNOWN_ISSUES.md`](https://github.com/ObolNetwork/obol-splits/blob/main/KNOWN_ISSUES.md). Before submitting a report, please review the [bug bounty program](https://docs.obol.org/advanced-and-troubleshooting/security/bug-bounty) scope.

If you believe you have found a new, distinct issue, please report it to the Obol Security Team at [security@obol.tech](mailto:security@obol.tech).

## Trust Model

- **Trust in the Obol API (`api`):** The SDK talks to the Obol API the caller configures (by default the production API; `api.baseUrl` is limited to Obol hosts, plus localhost with `allowLocal`; `api: false` makes the client chain-only) and returns its responses to the caller. Reports that assume a malicious or compromised API are out of scope. Where the SDK acts on API data it checks it locally first: `cluster.accept` verifies the fetched definition (recomputed `config_hash`, fork version, signatures) before signing, `incentives.preflight` / `prepareClaim` check the distributor's code, Merkle root and proof on-chain, and `cluster.verifyLock` verifies a lock without trusting the API.
- **Trust in the caller's clients and wallet:** The SDK has no RPC endpoints of its own. On-chain reads (contract code checks, address predictions, EIP-1271 signatures through `publicClient` / `publicClients`, withdrawal fees) trust the viem clients the caller passes, and transactions are built for the caller's wallet to sign and send. A malicious RPC or wallet is out of scope.
- **Caller-supplied parameters:** Addresses, recipients, shares, owners and role holders passed to the SDK are the caller's choice. Preparing contracts that pay or are controlled by an address the caller supplied is intended, including SplitV2 and OVM owners who can later change recipients or grant roles.
- **Prepare, then send:** Every write returns a `Prepared` transaction with the checks it ran and a preview; nothing is sent until the caller sends it. A `Prepared` built from state that has since changed (see `blockNumber` and `isStale`) is the caller's to refresh.

## Cluster Definitions & Locks

- **Legacy cluster versions (< v1.10.0):** Reports that v1.6.0 to v1.8.0 definitions or locks have weaker signature coverage. `cluster.prepareDefinition` creates and `cluster.accept` joins only v1.10.0 and later, and the Obol API rejects new definitions and locks below v1.10.0. The SDK still hashes and verifies the older versions so existing clusters stay readable.
- **`cluster.verifyLock` versus Charon:** `cluster.verifyLock` and `isValidLock` cover the distributed-validator-specs lock checks implemented in the SDK. Charon applies further runtime rules, so a lock that passes here and is rejected by Charon (or a rule enforced only by Charon) is not a vulnerability. Charon is the final gate before a cluster operates. `level: 'attested'` deliberately skips the BLS checks Charon performed in the DKG before the operators signed the lock hash.
- **Lock without partial deposit data:** Reports that a v1.8.0+ lock whose validators have empty or missing `partial_deposit_data` passes verification and that deposits are then taken from `deposit_data`. `cluster.verifyLock` fails such a lock (`deposit_data_invalid`, `deposit_data_missing`), and `deposits.fromLock` verifies the lock first. 2.x accepted it until 2.15.3 (see below).
- **Lock verification cost:** Verifying a large lock is CPU-bound and runs on the calling thread (pure JS by default; the native `@obolnetwork/obol-sdk/blst` backend on Node servers). It yields every `yieldMs` and stops on `signal`, but has no built-in size, time or concurrency limits: those are the responsibility of the service calling it with untrusted input.

## Deposits, OVM & Splits

- **Deploy front-running causing a revert:** A third party can create the same deterministic SplitV2 split first, so the SDK's creation transaction reverts. Funds cannot be redirected this way, and preparing again reuses the existing split (`SPLIT_REUSED`). OVM addresses are read from the factory's `CreateObolValidatorManager` event in the receipt, not predicted.
- **Top-up deposits skip BLS verification:** With `kind: 'topUp'`, `deposits.verifyDepositData` and `deposits.prepareDeposit` do not verify deposit signatures, because top-ups to existing validators do not need them. The caller asserts each deposit is a top-up; under the default `kind: 'deposit'`, a deposit with an all-zero signature is refused (`DEPOSIT_LOOKS_LIKE_TOP_UP`).
- **Gnosis and Sepolia:** These chains are accepted for cluster files and terms only. Contract operations throw `UNSUPPORTED_CHAIN` there (except `experimental.legacy.getOwrTranches`, which only reads an existing OWR).

## Terms and Conditions

- **Terms and conditions signature has no chain ID:** The EIP-712 signature that `terms.accept` (2.x: `acceptObolLatestTermsAndConditions`) creates to accept Obol's terms and conditions uses a domain with only `name` and `version`, and no `chainId`. This is deliberate: the terms are the same on every network, so one acceptance by an address covers all of them. The Obol API stores one acceptance per address and terms version, and re-submitting an accepted one changes nothing. The `fork_version` sent with it only selects the chain on which a contract wallet (ERC-1271) signature is checked. The API does not serve the signature back: `GET /v1/termsAndConditions/{address}` returns only whether the address has accepted. Replaying the signature, on another network or by another party, can only record an acceptance its signer already gave.

## SDK 2.x

- **SplitMain split address front-running (`createObolRewardsSplit` / `createObolTotalSplit`) — resolved in 2.15.2:** Reports that the SDK freezes a predicted SplitMain address as an OWR reward recipient and that a front-run `createSplit` diverts rewards. Immutable splits (no `controllerAddress`, the default) have a deterministic address over their recipients and fees, so a front-run can only deploy the same split or cause a revert. For mutable splits (with a `controllerAddress`), 2.15.2 no longer predicts an address: it deploys the split first and uses the address from its `CreateSplit` event. SDK 3.x does not create SplitMain or OWR contracts.
- **Lock without partial deposit data — resolved in 2.15.3:** Before 2.15.3, `validateClusterLock` accepted a v1.8.0+ lock whose validators had empty or missing `partial_deposit_data` (with `deposit_amounts: null`), and `getDepositData` then used the validator's `deposit_data`, which lock verification does not cover for those versions. Building such a lock needs the cluster's own operators (a solo creator or a colluding threshold).
- **Same-epoch exit treated as already processed (`validateExitBlobs`) — resolved in 2.15.3:** A same-epoch blob was skipped as already processed when the stored data held no signature from this operator. No security impact: the helper does not broadcast, recombination rejects duplicate share indices and the beacon node verifies the aggregate.
- **Trust model:** 2.x follows the same model with its own names: the configured `baseUrl`, the ethers provider and signer (including `safeRpcUrl` for Safe signature checks), and the beacon node URL passed for exit validation.
