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

- **Legacy cluster versions (< v1.10.0):** Reports that v1.6.0 to v1.8.0 definitions or locks have weaker signature coverage. The SDK still hashes and verifies them so existing clusters stay readable, and `cluster.prepareDefinition` accepts these versions when asked explicitly (the default is v1.11.0). The Obol API rejects new definitions and locks below v1.10.0, so such a cluster cannot be published through it.
- **`cluster.verifyLock` versus Charon:** `cluster.verifyLock` and `isValidLock` cover the distributed-validator-specs lock checks implemented in the SDK. Charon applies further runtime rules, so a lock that passes here and is rejected by Charon (or a rule enforced only by Charon) is not a vulnerability. Charon is the final gate before a cluster operates. `level: 'attested'` deliberately skips the BLS checks Charon performed in the DKG before the operators signed the lock hash.
- **Lock verification cost:** Verifying a large lock is CPU-bound and runs on the calling thread (pure JS by default; the native `@obolnetwork/obol-sdk/blst` backend on Node servers). It yields every `yieldMs` and stops on `signal`, but has no built-in size, time or concurrency limits: those are the responsibility of the service calling it with untrusted input.

## Deposits, OVM & Splits

- **Deploy front-running causing a revert:** A third party can create the same deterministic SplitV2 split first, so the SDK's creation transaction reverts. Funds cannot be redirected this way, and preparing again reuses the existing split (`SPLIT_REUSED`). OVM addresses are read from the factory's `CreateObolValidatorManager` event in the receipt, not predicted.
- **Top-up deposits skip BLS verification:** With `kind: 'topUp'`, `deposits.verifyDepositData` and `deposits.prepareDeposit` do not verify deposit signatures, because top-ups to existing validators do not need them. The caller asserts each deposit is a top-up; under the default `kind: 'deposit'`, a deposit with an all-zero signature is refused (`DEPOSIT_LOOKS_LIKE_TOP_UP`).
- **Gnosis and Sepolia:** These chains are accepted for cluster files and terms only. Contract operations throw `UNSUPPORTED_CHAIN` there (except `experimental.legacy.getOwrTranches`, which only reads an existing OWR).

## SDK 2.x

- **SplitMain split address front-running (`createObolRewardsSplit` / `createObolTotalSplit`) — resolved in 2.15.2:** Reports that the SDK freezes a predicted SplitMain address as an OWR reward recipient and that a front-run `createSplit` diverts rewards. Immutable splits (no `controllerAddress`, the default) have a deterministic address over their recipients and fees, so a front-run can only deploy the same split or cause a revert. For mutable splits (with a `controllerAddress`), 2.15.2 no longer predicts an address: it deploys the split first and uses the address from its `CreateSplit` event. SDK 3.x does not create SplitMain or OWR contracts.
- **Trust model:** 2.x follows the same model with its own names: the configured `baseUrl`, the ethers provider and signer (including `safeRpcUrl` for Safe signature checks), and the beacon node URL passed for exit validation.
