# ChainSafe Migration Plan and Technical Notes

This file captures the current recommendation so we do not need to re-derive the same plan each time.

## Scope

Repos in scope:

- `obol-sdk`
- `obol-api`
- `dv-launchpad`

Packages in scope:

- `@chainsafe/bls`
- `@chainsafe/blst`
- `@chainsafe/ssz`
- `@chainsafe/enr`
- `@chainsafe/discv5`

---

## Current State (What We Learned)

### Module format reality

- Newer ChainSafe releases are increasingly ESM-first (or ESM-only).
- `obol-sdk` still ships dual output including **CJS** (`dist/cjs`).
- `obol-api` (Nest) is still effectively CJS-oriented in runtime/build assumptions.
- `dv-launchpad` is a frontend bundle and can usually consume ESM, but has browser/runtime constraints.

### Practical implication

If we "upgrade all ChainSafe packages to latest" immediately in all repos, we are likely to break `obol-sdk` and `obol-api` build/runtime compatibility due to CJS/ESM mismatch.

### Runtime behavior and warnings

In browser contexts (especially `dv-launchpad`), crypto/discovery dependencies can log warnings when native/server paths are unavailable. This is expected unless imports and implementation selection are tightly controlled.

---

## blst / herumi / wasm / native: What It Means

`@chainsafe/bls` is an abstraction over multiple backends:

- **blst-native**
  - Uses native addon bindings.
  - Fastest in Node/server.
  - Can be fragile in CI/dev machines if prebuilds are missing and node-gyp toolchain is not ready.
- **herumi / wasm-backed path**
  - More portable across environments, including browser-compatible flows.
  - Slower than native in many cases.
  - Often used as fallback when native cannot load.
- **switchable implementation layer**
  - Package chooses an implementation depending on environment and availability.

Why we see logs in frontend:

- Browser cannot use native Node addons.
- Bundlers may include paths that are irrelevant in browser runtime, causing warnings/noise.
- Incorrect import boundaries (Node-only code in client bundles) can crash at runtime.

---

## Why Dynamic Imports May Not "Solve It"

Dynamic import can help only when used correctly and with static bundling constraints in mind.

### Common pitfalls

- Dynamic importing a module that still gets statically pulled by another import path.
- Dynamic importing Node-only modules from client components.
- Assuming runtime conditional import prevents bundler from analyzing or bundling server-only dependencies.
- Mixing server and client module graphs in Next.js without explicit boundaries.

### What is needed for dynamic import to be useful

- Clear environment split:
  - server-only files (Node-only deps),
  - client-safe files (browser-safe deps).
- No accidental re-export chain that pulls server-only code into client bundle.
- For Next.js:
  - keep Node-only modules in server-side contexts,
  - avoid importing them from client components/hooks.

Dynamic import is a tool, not a guarantee. Correct module boundaries are the real fix.

---

## ESM-Only Decision by Repo

### `obol-sdk`

Not recommended to switch to ESM-only immediately.

Reason:

- Public package currently serves both CJS and ESM consumers.
- ESM-only migration is potentially breaking for downstream users and `obol-api`.

Recommendation:

- Keep dual output during transition.
- Plan ESM-only as a major-version project with explicit migration guide.

### `obol-api`

Possible to move toward ESM, but not as part of quick ChainSafe bumps.

Reason:

- NestJS apps can be run in ESM, but this impacts tooling, tsconfig, test setup, runtime loader assumptions, and imports across the codebase.

Recommendation:

- Do not mix "ChainSafe upgrades" and "CJS->ESM migration" in one PR.
- If desired, execute ESM migration as a dedicated stream.

### `dv-launchpad`

ESM-only packages are acceptable in principle, but browser safety still matters.

Reason:

- Frontend bundling can consume ESM.
- Node-only transitive behavior can still leak and break client runtime if imports are not isolated.

Recommendation:

- Keep strict client/server import hygiene.
- Validate with `next build` and Playwright before concluding migration safety.

---

## Recommended Strategy (Phased)

## Phase 0 - Baseline freeze

- Keep known-good pins in `obol-sdk` and `obol-api`.
- Document constraints (this file + package comments).
- Ensure baseline build/tests are green.

## Phase 1 - Low-risk experiments in `dv-launchpad`

- Test newer ChainSafe versions where frontend can tolerate ESM better.
- Capture real breakages and required mitigations.
- Confirm Playwright + Next build stability.

## Phase 2 - `obol-sdk` compatibility track

- Keep CJS compatibility while testing incremental upgrades.
- Evaluate whether each package version still works with dual build output.
- Add compatibility wrappers where necessary.

## Phase 3 - `obol-api` consumer alignment

- Consume tested SDK output.
- Fix import/tooling mismatches.
- Validate lint + test + CI.

## Phase 4 - Optional ESM migration program

- If desired, run dedicated migration:
  - define target module policy per repo,
  - update build + test + runtime config,
  - publish migration notes for consumers.

---

## Practical Rules During Experiments

- Upgrade one dependency family step at a time, not all at once.
- Keep PRs small and reversible.
- Separate concerns:
  - dependency bump PRs
  - module-system migration PRs
  - test/runtime stabilization PRs
- Verify each step with:
  - `obol-sdk`: `yarn build && yarn test`
  - `obol-api`: lint + tests
  - `dv-launchpad`: build + Playwright

---

## Current Recommendation Summary

1. Do **not** force latest ChainSafe across all repos immediately.
2. Keep `obol-sdk` and `obol-api` on CJS-compatible line for now.
3. Use `dv-launchpad` for first controlled ESM-oriented experiments.
4. Treat ESM-only migration as a dedicated project if we choose to do it.
5. Revisit full latest-version adoption after compatibility track is complete.

