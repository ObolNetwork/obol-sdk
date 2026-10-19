# obol-sdk v3 spec

This directory specifies what the v3 SDK does, so that a second client (Go) can be written against the same
contract and checked with the same test vectors. It follows [`spec/DESIGN.md`](../spec/DESIGN.md).

| File | Contents |
|---|---|
| [`operations.md`](operations.md) | Every operation: tag, inputs, numbered checks, outputs, sources. Open questions at the end. |
| [`lifecycles.md`](lifecycles.md) | Cluster, transaction and deposit states, and which operation or event observes each. |
| [`errors.md`](errors.md) | Every error code and finding code: meaning, thrown by, what the caller should do. |
| [`vectors/`](vectors/README.md) | JSON test vectors for the SDK-level rules (shares, distribution, fees, deposit checks). |
| `schemas/` | (Milestone 2) JSON Schema generated from the TypeBox types. Not written yet. |

## Scope

In scope: what the SDK checks and builds before a transaction, what it reads from the chain and the Obol API, and
the errors it reports. Out of scope: running a node, DKG, wallet or Safe behaviour, and the API's own rules (the API
is treated as a black box that can be wrong or stale).

### Relation to distributed-validator-specs

Cluster files (definition and lock), their hashes, their EIP-712 signatures and lock verification are specified in
[ObolNetwork/distributed-validator-specs](https://github.com/ObolNetwork/distributed-validator-specs):

- [`docs/dv-spec/cluster-files.md`](https://github.com/ObolNetwork/distributed-validator-specs/blob/main/docs/dv-spec/cluster-files.md)
  for the file formats, hashing, signatures and "Verifying a Lock Before Use";
- [`test_vectors/cluster_hashing.json`](https://github.com/ObolNetwork/distributed-validator-specs/blob/main/test_vectors/cluster_hashing.json)
  (vendored in this repo as `test/fixtures/spec/cluster_hashing.json`) and
  [`test_vectors/bls_threshold.json`](https://github.com/ObolNetwork/distributed-validator-specs/blob/main/test_vectors/bls_threshold.json).

This spec does not repeat those rules. It says which SDK operation applies them and what error it reports. The SDK
suites here use the same file format and could later move into that repo as an SDK section (design open question 3).

## Conventions

### Units

- **ETH amounts are integers in wei** (`bigint` in TypeScript, `*big.Int` / `uint256` in Go) everywhere in inputs
  and outputs. The SDK converts to gwei where the chain wants it (deposit data `amount`, EIP-7002 / EIP-7251 request
  amounts, the OVM `principalThreshold`, cluster lock `amount` fields) and rejects a wei value that is not a whole
  number of gwei (`PAYLOAD_INVALID`, or `DEPOSIT_INVALID` for deposits).
- **Shares are integer parts per million**: `1_000_000` = 100%, the 0xSplits `PERCENTAGE_SCALE`. `percent("33.3333")`
  = `333333`. A percentage with more than 4 decimals is rejected, never rounded. The SplitV2 distribution incentive
  is also ppm (uint16, so at most 65535 = 6.5535%).
- Gas is not estimated or set by the SDK; the caller's wallet layer does that.

### Encodings

- **Hex** (`Hex`): `0x` prefix, lowercase in outputs, either case accepted in inputs. Fixed-length values are checked
  for length: pubkey 48 bytes, signature 96 bytes (BLS) or 65 bytes (secp256k1), withdrawal credentials 32 bytes,
  hashes and roots 32 bytes.
- **Addresses** (`Address`): inputs may be all-lowercase, all-uppercase or EIP-55 checksummed. A mixed-case input that
  is not a valid EIP-55 checksum is rejected (`PAYLOAD_INVALID`). Outputs are EIP-55 checksummed. Addresses are
  compared case-insensitively. The zero address is rejected wherever it would make a contract revert or burn funds
  (each operation says where).
- **Address order**: where the SDK sorts addresses (split recipients), it sorts by **numeric value** ascending, which
  equals sorting the lowercase hex. Sorting EIP-55 strings byte-wise gives a different order and a different split
  address (vector `split_shares` / `sort_is_numeric_not_checksum_bytes`).
- **Wire formats owned by others are kept as they are**: cluster files use their own encoding (gwei amounts as
  strings, see distributed-validator-specs); Obol API responses are decoded at the boundary.

### Type notation

Operations use a small notation: `Address`, `Hex`, `Hash32`, `Pubkey`, `bigint` (wei unless named otherwise),
`uint` (non-negative integer), `string`, `bool`, `T[]`, `T?` (optional), `A | B`, and `{ field: T }` records.
`Prepared<P>` and `Finding` are defined in [`operations.md`](operations.md#shared-types).

## Method tags

Every operation has one tag:

| Tag | Needs | With `api: false` |
|---|---|---|
| `pure` | nothing; a plain function, also exported without a client | same |
| `chain` | the `publicClient` (and the `walletClient` where it signs) | same |
| `api` | the Obol API | throws `API_DISABLED` |
| `api+chain` | the Obol API first, the chain as fallback | uses the chain only |

`api+chain` results say which source answered (`source: "api" | "chain"`). An `api+chain` read whose API answer is
used for display is never trusted for a value that moves money: `prepareX` re-reads it on-chain (design: "API
enrichment").

## Checks, errors and findings

- Each operation lists its checks in order. A check either **throws** an `ObolError` with a stable `code` (and stops
  the operation) or **emits a `Finding`** (`severity: "warning" | "info"`) into `Prepared.checks` or the result.
- An operation throws for anything that would lose funds or certainly revert, and warns for anything the caller should
  look at but may intend.
- The order of checks is normative where it decides which error is reported (vectors pin the reason, not only the
  rejection, as distributed-validator-specs does).
- Error and finding codes are listed in [`errors.md`](errors.md). Messages are not normative; codes and `issues` paths
  are.

## Vectors

[`vectors/README.md`](vectors/README.md) describes the file format. In short: one JSON file per suite, with `suite`,
`description`, `provenance` and one or more arrays of cases; each case has a unique `name`, an `input`, and the
expected outputs as sibling keys. Rejection cases carry `accepted: false` and `reason` (an error code from
`errors.md`); some also carry a finer `issue` slug.

Differences from the distributed-validator-specs format, on purpose: byte strings are `0x`-prefixed lowercase hex
(the SDK's own encoding), addresses in outputs are EIP-55 checksummed, and integers that can exceed 2^53 (wei,
shares as `bigint`) are decimal strings.

To run them, a client loads each file, maps `input` onto its own function, and compares the outputs and `reason`. The
TypeScript runners are `test/vectors/*.spec.ts`, one per suite.
