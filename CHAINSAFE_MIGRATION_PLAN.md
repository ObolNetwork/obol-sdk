# ChainSafe Migration Plan and Technical Notes

This file captures the current recommendation so we do not need to re-derive the same plan each time.

## Scope

Repos in scope:

- `obol-sdk`
- `obol-api`
- `dv-launchpad`

Packages in scope:

- `@chainsafe/bls` → **replaced by `@noble/curves`**
- `@chainsafe/blst` → **removed (was native peer dep of @chainsafe/bls)**
- `@chainsafe/ssz` → **stays pinned at 0.14.x (see below)**
- `@chainsafe/enr` → **already at latest (6.0.1) in obol-sdk**
- `@chainsafe/discv5` → **stays pinned in obol-api (see below)**

---

## Resolved: @chainsafe/bls → @noble/curves

**Status: Done in obol-sdk.**

`@noble/curves` (by Paul Miller) is a pure-TypeScript BLS12-381 implementation that:

- Ships both CJS (`./bls12-381.js`) and ESM (`./esm/bls12-381.js`) — no module format problem
- Has no native addon, no WASM — no node-gyp, no platform rebuild issues in CI
- Is independently audited
- Is used by ethers, viem, wagmi, and the wider Ethereum tooling stack
- Implements the same ETH2 BLS spec (NUL DST, G1 pubkeys / G2 signatures) — cryptographically compatible with existing signatures

### Why this works without an ESM migration

`@noble/curves` is CJS-compatible. The installed `./bls12-381.js` is `"use strict"; exports...` CommonJS.
This means:
- `obol-sdk` CJS build continues working
- `obol-api` (NestJS/CJS) can use it too — separate PR
- `dv-launchpad` frontend can use it (it has the ESM build too)

### Operations mapped

| @chainsafe/bls | @noble/curves (via longSignatures) |
|---|---|
| `await init('herumi')` | Not needed (fully synchronous) |
| `bls.bls.verify(pk, msg, sig)` | `blsVerify(pk, msg, sig)` |
| `bls.bls.verifyAggregate(pks, msg, sig)` | `blsVerifyAggregate(pks, msg, sig)` |
| `bls.bls.verifyMultiple(pks, msgs, sig)` | `blsVerifyMultiple(pks, msgs, sig)` |
| `bls.bls.aggregateSignatures(sigs)` | `blsAggregateSignatures(sigs)` |

All wrappers live in `src/blsUtils.ts`.

---

## Not changing: @chainsafe/ssz

**Status: Stays pinned at 0.14.x.**

`@chainsafe/ssz` 1.x sets `type: "module"` — it is ESM-only. Upgrading it requires:
- Dropping CJS output from `obol-sdk` (breaking change for consumers)
- Full NestJS ESM migration in `obol-api` (multi-week project)

SSZ is a **serialization library for protocol-defined types** (DepositData, VoluntaryExit, etc.).
The types are specified by the Ethereum consensus spec and do not change. There is no security
concern from staying on 0.14.3 — it is stable and correct.

If we ever do a dedicated ESM migration program, SSZ would upgrade as part of that.

---

## Not changing: @chainsafe/discv5 in obol-api

**Status: Stays at 0.5.x in obol-api.**

`obol-api` uses `@chainsafe/discv5` only to get `ENR` for parsing.
`@chainsafe/enr` 6.x is ESM-only — same problem as bls 7+. Using it in obol-api would break the
NestJS/CJS build. The discv5 0.5.1 transitive dep already provides enr 5.x which is CJS-compatible.

**dv-launchpad** can use `@chainsafe/enr` directly (frontend/ESM — fine).

---

## ESM-Only Decision by Repo

### `obol-sdk`

Not recommended to switch to ESM-only.

Reason:

- Public package currently serves both CJS and ESM consumers.
- ESM-only migration is potentially breaking for downstream users and `obol-api`.

Recommendation:

- Keep dual output. Plan ESM-only as a major-version project with explicit migration guide if needed.

### `obol-api`

Possible to move toward ESM, but treat as a dedicated separate project — not bundled with dependency bumps.

### `dv-launchpad`

ESM-only packages are acceptable. Keep strict client/server import hygiene.
Validate with `next build` and Playwright before concluding migration safety.

---

## Remaining Gap

The only remaining ChainSafe debt after the BLS replacement:

| Package | Repo | Current | Latest | Blocker |
|---|---|---|---|---|
| `@chainsafe/ssz` | obol-sdk, obol-api | 0.14.3 | 1.4.0 | ESM-only in 1.x |
| `@chainsafe/ssz` | dv-launchpad | 0.9.4 | 1.4.0 | ESM-only in 1.x; also behind obol-sdk |
| `@chainsafe/discv5` | obol-api | 0.5.1 | latest | ESM-only in newer versions |

The dv-launchpad SSZ version (0.9.4) should be caught up to 0.14.3 for consistency with the other
repos — even if we are not going to 1.x yet. This is a safe same-API bump.

If the team decides to do a dedicated ESM migration:
1. Migrate `obol-api` to ESM (NestJS supports it, but impacts tooling and all imports)
2. Drop CJS output from `obol-sdk` (major version bump, migration guide required)
3. Upgrade `@chainsafe/ssz` to 1.x in both repos

Treat that as a separate tracked project with its own cost/benefit analysis.

---

## Practical Rules During Dependency Changes

- Upgrade one dependency family at a time, not all at once.
- Keep PRs small and reversible.
- Verify each step with:
  - `obol-sdk`: `yarn build && yarn test`
  - `obol-api`: lint + tests
  - `dv-launchpad`: build + Playwright
