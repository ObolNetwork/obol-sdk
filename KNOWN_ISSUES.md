# Known Issues

This document lists findings that have already been submitted and reviewed for the Obol SDK (`@obolnetwork/obol-sdk`). Every item below has been evaluated by the Obol Security Team and is either resolved, accepted as a design trade-off, or determined not to be a vulnerability.

**Please do not resubmit these findings or close variants of them.** Duplicate submissions will not be eligible for a reward.

Many of these findings follow from the SDK's trust model: it is a client library that acts for its caller, with the caller's signer, against the Obol API and RPC endpoints the caller chooses. Behavior that falls within the assumptions below is not considered a vulnerability. The deployed contracts have their own list in [`obol-splits/KNOWN_ISSUES.md`](https://github.com/ObolNetwork/obol-splits/blob/main/KNOWN_ISSUES.md). Before submitting a report, please review the [bug bounty program](https://docs.obol.org/advanced-and-troubleshooting/security/bug-bounty) scope.

If you believe you have found a new, distinct issue, please report it to the Obol Security Team at [security@obol.tech](mailto:security@obol.tech).

## Trust Model

* **Trust in the configured Obol API (`baseUrl`):** The SDK talks to the API the caller configures (by default the production Obol API) and returns its responses to the caller. Reports that assume a malicious or compromised API, or a caller who points the SDK at one, are out of scope. Where the SDK acts on API data it checks it locally first: `acceptClusterDefinition` recomputes the `config_hash` and checks the network before signing, `claimIncentives` checks the distributor contract and Merkle proof on-chain, and `validateClusterLock` verifies a lock without trusting the API.
* **Trust in the configured RPC, beacon node and signer:** On-chain reads (contract checks, address predictions, Safe signature checks via `safeRpcUrl`, withdrawal fees) and beacon node reads (exit validation) trust the endpoints the caller provides, and transactions are signed by the caller's signer. A malicious RPC, beacon node or wallet is out of scope.
* **Caller-supplied parameters:** Addresses, recipients, percentages, controllers and owners passed to the SDK are the caller's choice. Deploying contracts that pay or are controlled by an address the caller supplied is intended, including mutable splits (`controllerAddress`) and SplitV2 / OVM owners who can later change recipients. The Obol Retroactive Funding recipient is appended to splits by design.

## Cluster Definitions & Locks

* **Legacy cluster versions (< v1.10.0):** Reports that legacy (v1.6.0 to v1.8.0) definitions or locks can be created or accepted with weaker signature coverage. The SDK no longer creates or joins definitions below v1.10.0 (`MIN_SUPPORTED_CLUSTER_VERSION`), and the Obol API rejects them for new clusters. Existing legacy locks still hash and validate so running clusters keep working.
* **`validateClusterLock` versus Charon:** `validateClusterLock` covers the cryptographic and structural checks implemented in the SDK. Charon applies further runtime rules, so a lock that passes here and is rejected by Charon (or a rule enforced only by Charon) is not a vulnerability. Charon is the final gate before a cluster operates.
* **Lock without partial deposit data falling back to `deposit_data` — resolved:** Reports that a v1.8.0+ lock whose validators have an empty or missing `partial_deposit_data` (with `deposit_amounts: null`) passed `validateClusterLock`, after which `getDepositData` / `depositDataFromLock` used the validator's `deposit_data`, which lock verification does not cover for these versions. Building such a lock needs the cluster's own operators (a solo creator or a colluding threshold). Since 2.15.3 (and in 3.0), validation rejects a v1.8.0+ validator without partial deposit data, and `deposit_data` is only read from locks before v1.8.0.
* **Lock validation cost:** Validating a large lock is CPU-bound. The SDK runs it in worker threads where available, caps concurrent validations and times out long runs; size limits and rate limiting for untrusted input are the responsibility of the service calling it.

## Exits

* **Exit helpers do not broadcast:** `client.exit.validateExitBlobs` and `recombineExitBlobs` are client-side helpers that return data; the Obol API and Charon run their own exit checks, and the beacon node verifies the aggregate signature. `recombineExitBlobs` verifies the partials and the aggregate only when given its options argument (cluster config and genesis validators root or beacon node URL, since 2.15.4); without it, a blob with too few or invalid partials comes back with an invalid signature and no error. A cluster member submitting exits for a different epoch stalls that validator's exit only for the cluster, and is undone with `charon exit delete`.
* **Same-epoch exit treated as already processed — resolved:** Reports that `validateExitBlobs` skipped an exit blob as already processed when stored data existed for the same validator and epoch but held no signature from this operator. Since 2.15.3 such a blob is validated as new. This had no security impact: recombination rejects duplicate share indices.

## Terms and Conditions

* **Terms and conditions signature has no chain ID:** The EIP-712 signature that `acceptObolLatestTermsAndConditions` creates to accept Obol's terms and conditions uses a domain with only `name` and `version`, and no `chainId`. This is deliberate: the terms are the same on every network, so one acceptance by an address covers all of them. The Obol API stores one acceptance per address and terms version, and re-submitting an accepted one changes nothing. The `fork_version` sent with it only selects the chain on which a contract wallet (ERC-1271) signature is checked. The API does not serve the signature back: `GET /v1/termsAndConditions/{address}` returns only whether the address has accepted. Replaying the signature, on another network or by another party, can only record an acceptance its signer already gave.

## Splits & Deployments

* **SplitMain split address front-running (`createObolRewardsSplit` / `createObolTotalSplit`) — resolved:** Reports that the SDK freezes a predicted SplitMain address as an OWR reward recipient and that a front-run `createSplit` diverts rewards. Immutable splits (no `controllerAddress`, the default) have a deterministic address over their recipients and fees, so a front-run can only deploy the same split or cause a revert. For mutable splits (with a `controllerAddress`), the SDK no longer predicts an address: it deploys the split first and uses the address from its `CreateSplit` event. Both methods are deprecated in favor of the OVM and SplitV2 methods, whose split addresses are deterministic.
* **Deploy front-running causing a revert:** A third party can deploy the same deterministic split, OVM or SplitV2 contract first, causing the SDK's deployment transaction to revert. Funds cannot be redirected this way, and re-running the method detects and reuses the existing contract.
* **Top-up deposits skip BLS verification:** With `kind: 'topUp'`, `eoa.deposit` and `splits.deposit` do not verify deposit signatures, because top-ups to existing validators do not need them. The caller asserts each deposit is a top-up; deposits that look like top-ups are refused under the default `kind: 'deposit'`.
* **Gnosis and Sepolia:** These chains are accepted for cluster definitions and locks only. Splitter, EOA and other contract methods throw `UnsupportedChainError` there.
