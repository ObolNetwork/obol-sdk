# SDK test vectors

Conformance fixtures for the SDK-level rules in [`../operations.md`](../operations.md). Cluster file hashing, lock
verification and BLS threshold aggregation are not here: they use the distributed-validator-specs suites
(`cluster_hashing.json`, `bls_threshold.json`; see [`../README.md`](../README.md#relation-to-distributed-validator-specs)).

## Suites

| File | Covers | Operations | Cases |
|---|---|---|---|
| `split_shares.json` | `percent()` parsing; reward / total split parameters with the RAF share and Split Everything spreading; address order | `splits.percent`, `splits.splitParams`, setup presets | `percent` 14, `ovm_split_params` 18 |
| `distribution.json` | OVM `distributeFunds` routing; PullSplit distribution amounts; the calls and per-recipient preview of a distribution | `ovm.prepareDistribute`, `splits.prepareDistribution` | `routing` 8, `split_distribution` 4, `prepare` 12 |
| `request_fees.json` | EIP-7002 / EIP-7251 fee default and bounds | `ovm.prepareWithdraw`, `ovm.prepareConsolidate`, `eoaWithdraw` | `cases` 16 |
| `deposit_checks.json` | Outcome and reason of the pure deposit checks: valid, wrong credentials, bad root, zero signature as deposit vs top-up, amount bounds, signature for another chain, signatures valid only in sum | `deposits.verifyDepositData`, `deposits.prepareDeposit` 1 | `cases` 31 |

Not yet written (design: "setup calldata"): `setup_calldata.json` for `prepareCreateSplit` / `prepareOvmWithSplits`
request encoding. It needs a fork or recorded factory answers for the predicted addresses.

## File format

Same shape as the distributed-validator-specs suites:

- `suite`: equals the filename without `.json`.
- `description`: the rule the suite pins, with any formula needed to read it.
- `provenance`: `source` (`sdk`), `sdk_ref` (the branch and commit the values came from), `generated_by`, `note`.
- Shared constants where useful (`constants`, `addresses`).
- One or more arrays of cases. Each case has a `name` unique within its array, an `input` object, and the expected
  outputs as sibling keys. A `notes` field explains a case that pins a subtle rule.

Rejection cases carry `accepted` (`false`) and `reason`: an error code from [`../errors.md`](../errors.md). Where a code
covers several rules, `issue` names the rule (for example `DEPOSIT_INVALID` / `root_mismatch`) and `index` the
failing item. Accepted cases have `accepted: true` and `reason: null`. The reason is part of the contract: the check
order in `operations.md` decides which rule fires first, and the vectors pin it.

Encoding inside the files:

- Byte strings: `0x`-prefixed lowercase hex. Addresses in expected outputs: EIP-55 checksummed. Compare addresses
  case-insensitively unless a case says otherwise.
- Wei amounts and every value the SDK types as `bigint` (allocations, totals): decimal strings.
- Small integers that are numbers in the API (input shares ≤ 1e6, chain ids, indexes, `distributionIncentive`): JSON
  numbers. `percent` inputs are strings or numbers on purpose (both are accepted).

## Provenance

`source: sdk` means the expected values came out of the existing SDK code, by running it, not by hand:

- `request_fees.json` and `deposit_checks.json`: the trimmed 2.15 code on `feat/sdk-v3` (`src/withdrawalFee.ts`
  `resolveWithdrawalFee`, `src/verification/depositPayload.ts` `verifyDepositPayloads`), with the deposits of
  `test/fixtures.ts`. Error messages were mapped to the v3 `reason` / `issue`.
- `split_shares.json` and `distribution.json`: the shelved 2.16 work (`src/splits/splitShares.ts`,
  `src/splits/distribution.ts`), unreleased. The `prepare` cases ran `prepareDistribution` against a fake provider that
  answers like `test/splits/distribution.spec.ts` `makeChain`, so the chain state in each `input` is exactly what the
  code saw.

Cases mirror the existing unit tests, plus boundary pairs (at the limit, one over) and a few cases added to pin a rule
the tests leave implicit (address order by numeric value, a seven-recipient Split Everything remainder). The
generators were scratch scripts bundling the SDK sources with esbuild; they are not checked in.

What the vectors do not prove: the SplitV2 PullSplit distribute amount (`(split balance − 1) + (warehouse balance −
1)`) is 2.16's reading and was not re-checked against the SplitV2 source; the Warehouse `withdraw` rules were checked
against `SplitsWarehouse.sol` (`balance − 1`, pause skipped for `msg.sender` / `tx.origin`).

## Running

A runner loads each file, maps `input` onto the client's function, and asserts the outputs, `accepted` and `reason`
(and `issue` / `index` when present). The TypeScript runner (`test/spec/vectors.spec.ts`) comes with milestone 2. A
change to a rule changes the suite in the same commit, with the provenance updated.
