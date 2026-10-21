# AGENTS.md — Obol SDK Agent Guide

This file has two audiences:
- **Agents helping users *consume* the SDK** → read [When to reach for this SDK](#when-to-reach-for-this-sdk) and skim the [modules](#modules). The contract for every operation (inputs, numbered checks, outputs, error codes) is in [`spec/operations.md`](spec/operations.md); prefer it over guessing from type names. Examples live in [`ObolNetwork/obol-sdk-examples`](https://github.com/ObolNetwork/obol-sdk-examples) (still on 2.x until the v3 examples land; check the version before adapting one).
- **Agents helping users *develop* the SDK itself** (the repo you're in) → keep reading from [Project Overview](#project-overview) down.

## When to reach for this SDK

`@obolnetwork/obol-sdk` is the programmatic path for preparing and managing Distributed Validator (DV) clusters from TypeScript with viem. Route users here when they want to:

- **Prepare a cluster invitation** from code (not the hosted Launchpad UI): `cluster.prepareDefinition` → `cluster.create`, operators join with `cluster.accept`, and `cluster.watch` follows signatures and the lock.
- **Verify a cluster lock** without running Charon: `cluster.verifyLock` (also a plain export, no client needed).
- **Deposit validators** from a lock: `deposits.fromLock` → `deposits.prepareDeposit` (via an OVM or the batch deposit contract), with `deposits.status` for what the beacon chain already has.
- **Deploy and run an Obol Validator Manager (OVM) with splits**: `setup.prepareOvmWithSplits` and the presets, then `ovm.prepareWithdraw`, `ovm.prepareConsolidate`, `ovm.prepareDistribute` and the role / ownership writes; `splits.*` for SplitV2 reads, distributions and share math.
- **Claim Obol incentives**: `incentives.preflight` → `incentives.prepareClaim`.
- **Build exit flows**: `exits.verifyPartialExit` (what the Obol API checks before storing a partial) and `exits.aggregate` (threshold aggregation into a signed voluntary exit).
- **Request EIP-7002 withdrawals from an EOA-credentialed validator**: `withdrawals.prepareEoaWithdraw`.

Route *elsewhere* when:
- User just wants to **create a cluster through a UI flow with friends** → point to [launchpad.obol.org](https://launchpad.obol.org) (hosted DKG orchestration). The SDK is the "do it from code" alternative.
- User wants to **run a DV node** (Charon + VC) → that's `charon-distributed-validator-node` (Docker Compose) or the `dv-pod` Helm chart, not the SDK. The SDK prepares clusters; it doesn't operate them.
- User asks about **Lido Simple DVT operator flow** → the SDK + `lido-charon-distributed-validator-node` together; see the LCDVN repo's CLAUDE.md.
- The user's task is a **one-shot cluster definition, DKG run, or lock inspection** and they're comfortable on the command line → the [`charon` CLI binary](https://docs.obol.org/docs/charon/charon-cli-reference) (or `obolnetwork/charon` Docker image) offers direct equivalents like `charon create cluster`, `charon create dkg`, `charon dkg`, and `charon alpha add-validators`. Often a single `docker run obolnetwork/charon:latest …` invocation is easier than bootstrapping a Node.js project around this SDK, especially for scripting / CI use. Reach for the SDK when the user needs programmatic control (invitations, OVM and splits, incentive claims, exit flows, deposit checks) or is integrating into an existing TypeScript app.
- User is on **ethers** and can't move to viem → SDK 2.x (maintenance branch). v3 has no ethers support.

---

## Project Overview

**@obolnetwork/obol-sdk** v3 is a TypeScript SDK for managing Distributed Validators (DVs) on Ethereum, built on **viem**. It runs in both **browser and Node.js**. The design is in [`spec/DESIGN.md`](spec/DESIGN.md); in short:

- **Prepare, then send.** Every write is a `prepare*` operation that runs its checks and returns a `Prepared` transaction; the caller's wallet layer (wagmi, a Safe, a script) sends it. `send` is a small helper for scripts.
- **Chain-first, API-enriched.** Anything that can work from the chain alone does. The Obol API adds storage (definitions, locks) and indexed reads; `api: false` makes the client chain-only.
- **Spec-backed.** Operations, checks, error codes and lifecycles are in `spec/`, with JSON test vectors the tests run.

- **Package**: `@obolnetwork/obol-sdk` (see `package.json` for the current version)
- **Language**: TypeScript (~5.9)
- **Node**: >= 20
- **Package Manager**: yarn (`yarn@1.22.22`)
- **Peer dependency**: `viem@^2`

## Quick Commands

```bash
# Install dependencies
yarn install

# Build (clean + tsup + types)
yarn build

# Run unit tests (everything under test/)
yarn test

# End-to-end tests on an anvil fork of Hoodi (needs anvil; RPC_HOODI overrides the RPC)
yarn test:e2e

# Watch mode during development
yarn test --watch

# Type-check
npx tsc --noEmit -p tsconfig.json

# Lint
yarn lint          # with --fix
yarn lint-ci       # CI mode, no fix

# Format
yarn prettier      # with --write
yarn prettier-ci   # check only

# Public surface, bundle size, spec schemas
yarn api:check     # CI: fails on an API change not in etc/obol-sdk.api.md (yarn api:update to accept)
yarn size:check    # after yarn build; yarn size:update records a new budget
yarn spec:schemas  # regenerate spec/schemas/*.json (a unit test checks they are current)

# Fuzz: the lock mutation slice (noble vs blst; with CHARON_ORACLE also Charon)
yarn test:fuzz
```

**Development workflow**: make changes → `yarn test` → `yarn build`. For faster iteration, run Jest directly on one file:

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest test/deposits/prepareDeposit.spec.ts --watch
```

## Project Structure

```
src/
├── index.ts          # Package entry: createObolClient, errors, chains, send, module namespaces
├── client.ts         # createObolClient: binds every module to one Context (ObolClient interface, experimental)
├── clientContext.ts  # createObolContext: checks chain / clients / API settings (also re-exported by each module entry)
├── context.ts        # Context (chain, publicClient, walletClient?, api) and the wallet / API guards
├── chains.ts         # Chain table (fork versions, genesis validators roots, contract addresses), API hosts
├── api.ts            # Obol API HTTP client (typed errors, timeout)
├── errors.ts         # ObolError<C> / ObolApiError, isObolError (narrows details), common error builders
├── codes.ts          # ObolErrorCode / FindingCode unions and ObolErrorDetails (checked against spec/errors.md)
├── multicall.ts      # The one Multicall3 read helper (readMany / readValues)
├── schema.ts         # TypeBox helpers (T.*), decode → PAYLOAD_INVALID
├── types.ts          # Shared types: Prepared<K> / AnyPrepared / PreviewByKind, Finding, StatusSource, Deposit, SplitParams
├── units.ts          # ETH / GWEI constants and conversions
├── abi.ts            # Contract ABIs (viem `as const`)
├── chainUtils.ts     # Chain read helpers (CHAIN_READ_FAILED)
├── send.ts           # send + waitForContractWalletExecution (Safe)
├── simulate/         # simulate: backends (eth_simulateV1, debug_traceCall, eth_call), decoding, analysis, preview comparison
├── cluster/          # Definitions and locks: hashing, EIP-712, prepare/create/accept, verifyLock (+ BlsBackend), watch
├── deposits/         # fromLock, verifyDepositData, status, prepareDeposit
├── ovm/              # OVM reads (verify, state, roles, validators), routing, withdraw / consolidate / distribute, role writes;
│                     #   requestRules.ts: the beacon chain's EIP-7002 / EIP-7251 request rules
├── splits/           # SplitV2: share math, predict / create, getSplit, distributions
├── setup/            # OVM + splits creation flows and presets
├── incentives/       # Merkle distributor reads, preflight, prepareClaim
├── exits/            # verifyPartialExit, aggregate, BLS helpers, exit SSZ
├── terms/            # Terms and conditions (EIP-712)
├── withdrawals/      # EIP-7002 withdrawals for EOA-credentialed validators
├── legacy/           # Reads of 2.x-era OWR contracts (experimental)
├── experimental/     # The experimental entry: simulate, legacy
└── internal/         # Pure code carried over from 2.x (not exported)
    ├── types.ts      # Loose cluster file shapes read by the hashing code
    ├── definitionFlow.ts         # Group / Solo / Charon flow detection
    ├── bls.ts                    # BLS12-381 (@noble/curves): point decoding, finite differences, randomised batch, threshold aggregation
    ├── secp256k1.ts              # ENR-key signature verification
    ├── exitDomain.ts             # computeDomain / signingRoot for exits
    ├── yielder.ts                # createTick: yield to the event loop every yieldMs
    └── verification/
        ├── common.ts             # Config / definition / lock hashes (one-shot and sliced), deposit + builder fields and signing roots, node signatures
        ├── shareBinding.ts       # Step 5 for one validator (decode with the subgroup shortcut, finite differences)
        ├── signatureBatch.ts     # firstInvalidSignature: batches of 32, one-by-one fallback
        ├── sszTypes.ts           # Shared SSZ containers
        └── v1.6.0.ts … v1.11.0.ts  # Per-version SSZ hashing

test/
├── fixtures.ts       # Shared cluster locks, ENRs, deposit payloads
├── fixtures/spec/    # Vendored distributed-validator-specs vectors (cluster_hashing, bls_threshold)
├── bytecodes.ts      # Factory runtime code for fake chains (large; do not read unless needed)
├── helpers/          # fakeChain / fakeApi (EIP-1193 fake chain and API), syntheticLock (real-key locks), blstBackend (test-only adapter)
├── vectors/          # spec/vectors and distributed-validator-specs suites (VECTORS_REBASELINE=1 rewrites distribution.json)
├── spec/             # spec conformance (errors.md vs codes) and spec/schemas up to date
├── fuzz/             # differential lock fuzz (yarn test:fuzz; run.sh with Charon), regressions/, seeded decoder fuzz
└── <module>/         # One directory per src module (cluster, deposits, ovm, splits, setup, ...)

test-e2e/             # yarn test:e2e: anvil fork of Hoodi; yarn test:e2e:mainnet (E2E_CHAIN=mainnet) of mainnet
scripts/              # bundle-size.mjs (+ bundle-budget.json), spec-schemas.mjs / specSchemas.ts
etc/obol-sdk.api.md   # API Extractor report of the public surface
├── globalSetup.cjs   # Starts anvil on a free port (skips every suite if anvil or the RPC is missing)
└── helpers/          # Clients and funded signers on the fork, BLS deposits, OVM deploy, a Safe wallet
```

## Build System

Uses **tsup** to produce three outputs:
1. **CJS** → `dist/cjs/src/` (Node.js CommonJS)
2. **ESM** → `dist/esm/src/` (Node.js ES Modules)
3. **Browser** → `dist/browser/src/` (Browser ESM)

Types are generated separately via `tsc -b tsconfig.types.json` → `dist/types/src/`.

Key build notes:
- `viem` is a peer dependency and always external.
- `@noble/curves`, `@noble/hashes` and `@chainsafe/enr` (ESM-only) are bundled; `@chainsafe/ssz` and `@sinclair/typebox` are dependencies.
- Browser build defines `process.env` as empty and `global` as `globalThis`.
- One entry per module plus the root (`src/index.ts`, `src/<module>/index.ts`), with shared chunks (`splitting`), so classes such as `ObolError` exist once across entries; no worker bundle and no `worker_threads` / native imports in `dist`.
- `"sideEffects": false` in the package and in `dist/esm` / `dist/browser` (the nearest package.json decides for bundlers). `yarn size:check` bundles typical imports and checks them against `scripts/bundle-budget.json`; a reads-only `ovm` import must carry no BLS or SSZ code.
- The ESM builds get `dist/esm/package.json` and `dist/browser/package.json` (`{ "type": "module" }`, written by tsup
  `onSuccess`): the root package has no `type`, so without them Node would warn `MODULE_TYPELESS_PACKAGE_JSON`.

## Architecture

### Client (`src/client.ts`)

```typescript
import { createObolClient } from '@obolnetwork/obol-sdk';

const obol = createObolClient({
  chain: hoodi,              // viem Chain: mainnet or Hoodi (Gnosis / Sepolia for cluster files only)
  publicClient,              // viem PublicClient on the same chain (checked)
  walletClient,              // optional: EIP-712 signatures and send; its chain is re-checked before each use
  api: { baseUrl, timeoutMs } // optional; default api.obol.tech, 30 s; `false` = chain-only
});

obol.cluster.*  obol.deposits.*  obol.ovm.*  obol.splits.*  obol.setup.*
obol.incentives.*  obol.exits.*  obol.terms.*  obol.withdrawals.*
obol.experimental.simulate(prepared, { from })   // what it will do, before signing
obol.experimental.legacy.*
obol.send(prepared)
```

Every module is a `create<Module>Module(ctx)` that binds the module's functions to one `Context` and has an explicit `<Module>Module` interface. The same modules are exported as namespaces (`import { cluster, deposits } from '@obolnetwork/obol-sdk'`) and as subpath entries (`@obolnetwork/obol-sdk/ovm`, with `createObolContext`), so the pure functions work without a client and an app loads only the modules it uses. Module `index.ts` files are explicit export lists (no `export *`); the public surface is recorded in `etc/obol-sdk.api.md` (`yarn api:check` in CI; `yarn api:update` after a reviewed change).

**Method tags** (in TSDoc and `spec/operations.md`): `pure` (no client), `chain`, `api`, `api+chain` (API first, chain fallback). With `api: false`, `api+chain` methods use the chain and `api` methods throw `API_DISABLED`.

**Checks every operation runs** (spec G1–G4): inputs decoded against a TypeBox schema (`PAYLOAD_INVALID` with `issues[]`); contract operations need a chain with Obol contracts (`UNSUPPORTED_CHAIN`); signing and `send` need a wallet on the client chain (`WALLET_REQUIRED`, `CHAIN_MISMATCH`); API failures map to `API_*` codes.

### Prepare, then send

```typescript
type Prepared<K extends PreparedKind> = {
  kind: K;                // 'deposit' | 'withdraw' | 'distribution' | ... (spec/operations.md "Shared types")
  request: { to: Address; data: Hex; value: bigint; chainId: number };
  checks: Finding[];      // warnings / info; errors throw instead
  preview: PreviewByKind[K]; // what the transaction will do; narrows on kind
  blockNumber?: bigint;   // the block the checks read (isStale(prepared, head, maxAgeBlocks))
};
type AnyPrepared = /* union of every Prepared<K> */;
type Finding = { code: FindingCode; severity: 'warning' | 'info'; message: string; hint?: string;
                 subject?: { pubkey } | { address } | { index } };
// every preview* returns { preview, checks, blockNumber }
```

`send(prepared)` checks the wallet chain, sends `request` and returns `{ hash, contractWallet, wait }`; for a Safe, `wait` follows the Safe's `ExecutionSuccess`. Callers with their own wallet layer send `request` directly.

`simulate(prepared, { from })` (`src/simulate/`) runs `request` on the node without sending it: `eth_simulateV1`, else `debug_traceCall` (callTracer + prestateTracer diff), else `eth_call` (`limited: true`), detected once per client. It returns the decoded revert or balance changes (ETH, Warehouse), events, state changes, `summary` lines and `matchesPreview` (the preview compared with the simulation; a difference is an SDK bug). `prepare*` never simulates on its own. Tests replay JSON-RPC exchanges recorded on an anvil Hoodi fork (`test/simulate/fixtures`); `test/simulate/e2e.spec.ts` (opt-in, `SIMULATE_E2E=1`) re-records them with `SIMULATE_RECORD=1`.

### Modules

| Module | Main operations |
|--------|-----------------|
| `cluster` | `computeConfigHash` / `computeDefinitionHash` / `computeLockHash`, `prepareDefinition`, `create`, `accept`, `get`, `getLock`, `watch`, `verifyDefinition`, `verifyLock` |
| `deposits` | `fromLock`, `verifyDepositData`, `status`, `prepareDeposit` (via `{ ovm }` or `{ batch: true }`, `kind: 'deposit' \| 'topUp'`) |
| `ovm` | `verify` (provenance), `getState`, `getRoleHolders`, `getValidators`, `prepareWithdraw`, `prepareConsolidate`, `prepareDistribute` / `previewDistribute`, role and ownership writes (`prepareGrantRoles`, `prepareTransfer`, `prepareSetPrincipalRecipient`, ...) |
| `splits` | `percent` / `formatPercent` / `splitParams`, `predictSplit`, `prepareCreateSplit`, `getSplit`, `prepareDistribution` / `previewDistribution` |
| `setup` | `prepareCreateOvm`, `prepareCreateSplit`, `prepareOvmWithSplits`, `ovmFromReceipt`, presets (`rewardsSplit`, `totalSplit`, `solo`) |
| `incentives` | `get`, `isClaimed`, `preflight`, `prepareClaim` |
| `exits` | `verifyPartialExit`, `aggregate` (bound: `chainId` from the client) on the Obol API exit formats (snake_case, as stored), `blsVerify`, `blsAggregate`, `blsThresholdAggregate`, `blsRecoverPubkey` |
| `terms` | `hasAccepted`, `accept` |
| `withdrawals` | `prepareEoaWithdraw` |
| `experimental` | `simulate`, `legacy.getOwrTranches` (shapes may change in a minor release) |

Exits use the EIP-7044 domain: the Capella fork version and genesis validators root come from the chain table, so exits work on mainnet and Hoodi only (`UNSUPPORTED_CHAIN` elsewhere).

### Errors (`src/errors.ts`, `src/codes.ts`, codes in `spec/errors.md`)

One class, **`ObolError`** (`code`, `message`, `hint`, `details`), and **`ObolApiError`** for API responses (`status`, `endpoint`, ...). Codes are the `ObolErrorCode` / `FindingCode` unions in `src/codes.ts`, with `ObolErrorDetails` typing each code's `details`; `isObolError(error, code)` narrows. Every code, what throws it and what the caller should do is in `spec/errors.md`; `test/spec/conformance.spec.ts` fails when errors.md, `src/codes.ts` and the codes used in `src/` differ. Add a new code to errors.md and `src/codes.ts` first.

### Lock verification

`cluster.verifyLock(lock, { level, signatures, yieldMs, bls, publicClient })` runs the distributed-validator-specs "Verifying a Lock Before Use" steps and reports the first failing `step` (`{ ok, level, step?, issue?, validator? }`); a malformed lock or bad options is `PAYLOAD_INVALID`. The contract is `spec/operations.md` "cluster.verifyLock".

- **Levels.** `full` (default) runs everything. `attested` skips the BLS work Charon did in the DKG before the nodes signed `lock_hash` (share binding, `signature_aggregate`) and checks the deposit / builder BLS signatures of the validators in `signatures` only. `deposits.fromLock` uses `attested` with the validators it returns.
- **One thread, no workers.** Everything runs on the calling thread and awaits `tick()` (`src/internal/yielder.ts`) between units of work: it yields (`setImmediate`, else `setTimeout(0)`) once half of `yieldMs` (default 50) has passed. Long loops (lock / definition hashing per validator, share binding, signature batches, node signatures) must keep calling `tick`. There are no time limits or concurrency limits; servers apply their own around the call.
- **BLS backend.** `BlsBackend` (`src/cluster/blsBackend.ts`) is the injectable interface (`decodePublicKey`, `aggregatePublicKeys`, `onPolynomial`, `verify`, `createBatch`); `nobleBls` is the default. The SDK never imports a native module. The `@chainsafe/blst` adapter in its TSDoc is also `test/helpers/blstBackend.ts`; `test/cluster/blstCrossCheck.spec.ts` checks both backends agree (`@chainsafe/blst` is a test-only devDependency).
- **Share binding (step 5).** Y0 = group key, Yj = share j: they lie on one polynomial of degree < t iff every t-th forward difference is the identity (point subtractions only). Only Y0 … Y(t-1) are subgroup-checked; later points are then integer combinations of them. Identity points are rejected. `test/internal/shareBinding.spec.ts` compares it with Lagrange recovery.
- **Signatures (steps 6, 7, `verifyDepositData`).** `firstInvalidSignature` checks batches of 32 with random 64-bit weights per signature (subgroup-checked points), so a batch passes only if each signature is valid on its own; a failing batch is rechecked one by one to report the first invalid validator. Never replace this with a plain aggregate check: invalid signatures can cancel out in a sum (`test/cluster/verifyLockSynthetic.spec.ts` has the cases).
- **Cost** (one thread): pure JS about 25 ms per signature, so a 1k-validator lock with 3 signatures each is about 80 s `full`, 0.3 s `attested`; 10k `attested` about 2 s. With the blst adapter, 1k `full` about 1.3 s.

### Supported Chains (`src/chains.ts`)

| Chain | ID | Contracts | Exits |
|-------|----|-----------|-------|
| Mainnet | 1 | Yes | Yes |
| Hoodi | 560048 | Yes | Yes |
| Gnosis | 100 | No | No |
| Sepolia | 11155111 | No | No |

Gnosis and Sepolia are accepted for cluster files and terms only (existing Launchpad deployments and obol-api use them); contract operations throw `UNSUPPORTED_CHAIN` there. Don't steer new users to them: use Hoodi for testing and Mainnet for production. Any other chain throws `UNSUPPORTED_CHAIN` from `createObolClient`.

### Validation

All inputs are decoded with **TypeBox** schemas (`src/schema.ts`, `T.*` for hex, addresses, uints) before any API or contract call. Units: ETH amounts are `bigint` wei everywhere; shares are parts per million (`1_000_000` = 100%). See `spec/README.md` "Conventions".

### Authentication Pattern

API writes (cluster create / accept, terms) use **EIP-712 typed-data signatures** from the `walletClient`, sent as `Authorization: Bearer {signature}`. No session/token management: the signature is the proof of authorization. That is why `api.baseUrl` is restricted to Obol hosts (`BASE_URL_INVALID`); `api: { baseUrl, allowLocal: true }` also allows `http(s)://localhost[:port]` / `127.0.0.1[:port]` for a local obol-api.

## SDK as Public API Surface

**This SDK is the official programmatic interface to Obol for external developers.**

Any capability added to `obol-api` that external clients could reasonably use should be exposed via a corresponding SDK operation. When you add or update an API endpoint:

1. Specify the operation in `spec/operations.md` (tag, inputs, numbered checks, outputs) and any new codes in `spec/errors.md`
2. Implement it in the module (`src/<module>/`), with a TypeBox schema for its input, and bind it in `create<Module>Module`
3. Write unit tests in `test/<module>/` (and vectors in `spec/vectors/` for SDK-level rules)
4. Add or extend the matching example in `obol-sdk-examples`

This keeps the SDK in sync with the API and ensures external developers always have a typed, validated, documented way to interact with the platform.

## Testing

### Test Framework

- **Jest 29** with `ts-jest/presets/default-esm`
- ESM module support via `NODE_OPTIONS=--experimental-vm-modules`
- `yarn test` runs every `test/**/*.spec.ts` without network; the one exception, `test/simulate/e2e.spec.ts`, is skipped
  unless `SIMULATE_E2E=1` (it needs an anvil Hoodi fork at `SIMULATE_RPC_URL`)
- `yarn test:e2e` runs `test-e2e/*.e2e.ts` against an anvil fork of Hoodi at head (public RPC, or `RPC_HOODI`; it
  must serve historic `eth_getLogs`; the SDK shrinks the range for RPCs that cap it). `yarn test:e2e:mainnet`
  (`E2E_CHAIN=mainnet`) forks mainnet instead (`RPC_MAINNET`, else a public RPC that serves historic logs). It sends each `prepare*` result and compares the preview and findings
  with what was mined (balances, logs, contract state). CI runs it non-blocking (`.github/workflows/e2e.yml`). Run
  one e2e job at a time: it spawns anvil and makes many RPC requests.

### Unit Test Patterns

Tests are in `test/`, one directory per module. Key conventions:

- **Chain and API**: use `fakeChain()` / `fakeApi()` from `test/helpers/fakeChain.ts` (an EIP-1193 fake behind a real viem `PublicClient`, with fake contracts and logs) instead of mocking viem. `fakeChain().context(api)` gives a `Context`. `fakeApi` answers `POST /v1/validators/:network/deposit-status` with a 404 unless a test serves it (the route is not deployed yet).
- **Wallets**: `test/cluster/wallet.ts` has local accounts (`KEYS`, `localWallet`, `withWallet`).
- **Errors**: assert on `code` (and `details`), not on messages.
- **Vectors**: `test/vectors/` runs `spec/vectors/*.json` and the vendored distributed-validator-specs vectors; a rule change updates the vector first.
- **ESM mocks**: `jest.unstable_mockModule('../../src/...js', ...)` before a dynamic `import()` of the module under test.
- **Locks with real keys**: `syntheticLock(validators, operators, threshold, amounts)` in `test/helpers/syntheticLock.ts` builds a valid lock; its `seal` re-signs an edited copy so only the edited check fails.

## Environment Variables

The SDK reads no environment variables; RPCs come from the viem clients the caller passes.

## Code Style

- **Prettier**: single quotes, trailing commas, 80 char width, 2-space indent, no parens on single arrow params
- **ESLint**: `standard-with-typescript` base, strict TypeScript disabled for some rules
- **Pre-commit**: Husky runs lint-staged (eslint --fix + prettier --write)
- When adding code, match existing patterns in the file

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `viem` (peer) | Chains, clients, ABIs, encoding, EIP-712 |
| `@sinclair/typebox` | Input schemas and decoding |
| `@noble/curves` | BLS12-381 and secp256k1 (bundled) |
| `@chainsafe/ssz` | SSZ hashing of cluster files, deposits and exits |
| `@chainsafe/enr` | Ethereum Node Record parsing (bundled; ESM-only) |
| `@chainsafe/blst` (dev only) | Native BLS, to cross-check the pure-JS backend in tests; never imported by `src/` |

## Dependencies policy

When adding a new dependency:
- Use the **latest stable exact version** (e.g. `"some-lib": "3.2.1"` not `"^3.2.1"`)
- Verify compatibility with both Node.js and browser build targets — some packages are Node-only
- Check it works with the CJS build (ESM-only packages must be bundled via `noExternal`) and with `viem ^2`, `@noble/curves` and `typescript ~5.9`
- Run `yarn build` and `yarn test` after adding to confirm all three build outputs still work

## Release and Publishing

**Never publish from local.** The release process is:

1. Make changes, open a PR, get it reviewed and merged to `main`
2. Manually trigger the **"Release PR"** GitHub Actions workflow — this bumps the version via `release-it` and opens a release PR with the `release` label
3. Review and merge the release PR
4. Manually trigger the **"Publish Obol-SDK to NPM"** workflow — this publishes the package to npm

Version bumping follows semantic versioning:
- **Patch**: bug fixes, no API changes
- **Minor**: new operations, new supported chains, backwards-compatible additions
- **Major**: breaking changes to operation inputs or outputs, removed operations, changed error codes

## CI/CD

- **PR checks**: lint, prettier, build, unit tests (GitHub Actions, `.github/workflows/ci.yml`)
- **Node version in CI**: 24.x

## Common Patterns When Modifying Code

### Adding a New Operation

1. Write it in `spec/operations.md` first: tag, inputs, numbered checks with their codes, output
2. Add the TypeBox input schema next to the implementation and `decode` it first (G1)
3. Writes return `Prepared<Preview>`; non-blocking results are `Finding`s in `checks`, blocking ones throw `ObolError`
4. Chain-restricted: `requireContracts(ctx.chain.id, 'module.operation')`; signing: the wallet guard in `context.ts`; API: `requireApi(ctx)`
5. Bind it in the module's `create<Module>Module(ctx)` and export it from the module `index.ts`
6. Add unit tests in `test/<module>/` with `fakeChain` / `fakeApi`

### Adding Support for a New Chain

1. Add the chain to `CHAINS` in `src/chains.ts` (fork version, Capella fork version, genesis validators root, contracts if deployed)
2. Add the expected factory code hashes in `src/splits/chain.ts` if it has contracts
3. Update the chain tables in `spec/` and this file

### Contract Code Checks

Factories are checked by code hash (`EXPECTED_CODE_HASHES` in `src/splits/chain.ts`, precomputed keccak256 of the runtime code) before predicting or creating contracts; a mismatch is `CONTRACT_NOT_AVAILABLE`. The tests build matching fake contracts from `test/bytecodes.ts`.

## Do Not

- Do not read `test/bytecodes.ts` unless working on factory code checks — it's ~50KB of hex
- Do not import from `src/internal/` in new public API; it is carried-over pure code behind the modules
- Do not skip schema decoding — every input is decoded before API/contract calls
- Do not add ethers (or any second Ethereum library); use viem
- Do not use `jest.mock()` — use `jest.unstable_mockModule()` for ESM compatibility
- Do not import native modules (`@chainsafe/blst`, …) or `worker_threads` from `src/`; native speed comes in through a caller's `BlsBackend`
- Do not publish to npm from local — always use the GitHub Actions workflow

## Related products

- **[`ObolNetwork/obol-sdk-examples`](https://github.com/ObolNetwork/obol-sdk-examples)** — consumer examples (TypeScript, JavaScript, Lido script); 2.x until the v3 examples land.
- **[Obol API](https://api.obol.tech)** — the hosted service this SDK talks to. `api.baseUrl` defaults to production. Private source; treat as a black box with EIP-712 Bearer auth that can be wrong or stale.
- **[launchpad.obol.org](https://launchpad.obol.org)** — hosted UI equivalent for cluster creation + DKG. The SDK is the "code path"; Launchpad is the "UI path" (and v3's first consumer).
- **[`charon` CLI / `obolnetwork/charon` Docker image](https://docs.obol.org/docs/charon/charon-cli-reference)** — command-line equivalent for creation / DKG / lock operations. Often simpler than a Node.js project for one-shot tasks.
- **[`distributed-validator-specs`](https://github.com/ObolNetwork/distributed-validator-specs)** — cluster file formats, hashing, signatures and lock verification; the SDK runs its vectors.
- **`charon-distributed-validator-node`** (CDVN) — stock Docker Compose launcher for running a DV node. Operates clusters this SDK prepares.
- **`lido-charon-distributed-validator-node`** (LCDVN) — Lido Simple DVT variant. Used with the SDK for Lido operator flows.
- **`obol-splits`** — reference Solidity contracts (OVM, SplitV2, and the legacy OWR / SplitMain) the SDK prepares transactions for.

## Key docs

- **v3 spec**: `spec/DESIGN.md`, `spec/operations.md`, `spec/errors.md`, `spec/lifecycles.md`, `spec/vectors/` (in this repo)
- SDK TypeDoc reference: https://obolnetwork.github.io/obol-sdk
- Obol SDK quickstart: https://docs.obol.org/docs/advanced/quickstart-sdk
- Charon CLI reference: https://docs.obol.org/docs/charon/charon-cli-reference
- DKG ceremony: https://docs.obol.org/docs/start/dkg
- Obol Terms of Service: https://obol.org/terms.pdf
- Canonical agent index: https://obol.org/llms.txt
