# CLAUDE.md — Obol SDK Agent Guide

This file has two audiences:
- **Agents helping users *consume* the SDK** → read [When to reach for this SDK](#when-to-reach-for-this-sdk) and skim the [API surface](#core-client-methods). Examples live in [`ObolNetwork/obol-sdk-examples`](https://github.com/ObolNetwork/obol-sdk-examples) — prefer adapting a working example over writing snippets from scratch.
- **Agents helping users *develop* the SDK itself** (the repo you're in) → keep reading from [Project Overview](#project-overview) down.

## When to reach for this SDK

`@obolnetwork/obol-sdk` is the programmatic path for preparing and managing Distributed Validator (DV) clusters. Route users here when they want to:

- **Prepare a cluster invitation** from code (not the hosted Launchpad UI) — `createClusterDefinition`, optionally pointing at pre-deployed OVM / splits contracts via `client.splits.*`.
- **Deploy reward/total splits** for a DV (OVM + SplitV2, or legacy OWR + SplitMain) — `client.splits.createValidatorManagerAndRewardsSplit`, etc.
- **Claim Obol incentives** on behalf of a cluster / operator — `client.incentives.*`.
- **Verify a cluster lock** without running Charon — the standalone `validateClusterLock` export.
- **Build exit flows** — `client.exit.*` for BLS partial exit verification and aggregation.
- **Request validator withdrawals / batch deposits via EOA** — `client.eoa.*`.

Route *elsewhere* when:
- User just wants to **create a cluster through a UI flow with friends** → point to [launchpad.obol.org](https://launchpad.obol.org) (hosted DKG orchestration). The SDK is the "do it from code" alternative.
- User wants to **run a DV node** (Charon + VC) → that's `charon-distributed-validator-node` (Docker Compose) or the `dv-pod` Helm chart, not the SDK. The SDK prepares clusters; it doesn't operate them.
- User asks about **Lido Simple DVT operator flow** → the SDK + `lido-charon-distributed-validator-node` together; see the LCDVN repo's CLAUDE.md.
- The user's task is a **one-shot cluster definition, DKG run, or lock inspection** and they're comfortable on the command line → the [`charon` CLI binary](https://docs.obol.org/docs/charon/charon-cli-reference) (or `obolnetwork/charon` Docker image) offers direct equivalents like `charon create cluster`, `charon create dkg`, `charon dkg`, and `charon alpha add-validators`. Often a single `docker run obolnetwork/charon:latest …` invocation is easier than bootstrapping a Node.js project around this SDK, especially for scripting / CI use. Reach for the SDK when the user needs programmatic control (invitations, splits, incentive claims, exit flows, custom payloads) or is integrating into an existing TypeScript/Node app.

**Canonical consumer reference**: [`ObolNetwork/obol-sdk-examples`](https://github.com/ObolNetwork/obol-sdk-examples) ships full working TS/JS examples. Always skim its `TS-Example/index.ts` first.

---

## Project Overview

**@obolnetwork/obol-sdk** is a TypeScript SDK for managing Distributed Validators (DVs) on Ethereum. It runs in both **browser and Node.js** environments. The SDK provides cluster lifecycle management, reward splitting via smart contracts, incentive claims, exit validation, and EOA operations.

- **Package**: `@obolnetwork/obol-sdk` (v2.11.10)
- **Language**: TypeScript (~5.9)
- **Node**: >= 16
- **Package Manager**: yarn (`yarn@1.22.22`)

## Quick Commands

```bash
# Install dependencies
yarn install

# Build (clean + tsup + types)
yarn build

# Run unit tests (excludes E2E)
yarn test

# Watch mode during development
yarn test --watch

# Lint
yarn lint          # with --fix
yarn lint-ci       # CI mode, no fix

# Format
yarn prettier      # with --write
yarn prettier-ci   # check only

# E2E tests (from test/sdk-package/)
cd test/sdk-package && yarn install && yarn build && yarn test:e2e
```

**Development workflow**: make changes → `yarn build` → `yarn test`. For faster iteration on a specific area, use `yarn test --watch` or run Jest directly on a single file:

```bash
npx jest test/client/methods.test.ts --watch
```

## Project Structure

```
src/
├── index.ts          # Main Client class — primary entry point (all public methods)
├── base.ts           # Base class with HTTP request abstraction
├── types.ts          # All TypeScript types and interfaces
├── errors.ts         # Custom errors: ConflictError, SignerRequiredError, UnsupportedChainError
├── constants.ts      # Chain configs, contract addresses, fork mappings
├── services.ts       # Standalone exports (validateClusterLock → worker or sync)
├── utils.ts          # Utility functions
├── schema.ts         # AJV JSON schemas for payload validation
├── ajv.ts            # AJV setup with custom validation keywords
├── bytecodes.ts      # Contract bytecodes (large file, do not read unless needed)
├── abi/              # Smart contract ABIs
├── eoa/              # EOA module: withdrawals and batch deposits
├── exits/            # Exit validation: BLS signature verification
├── incentives/       # Incentive claims from Merkle Distributors
├── splits/           # Contract deployment: OVM, SplitV2, SplitMain
└── verification/     # Cluster lock verification (SSZ, ECDSA, BLS)
    ├── common.ts     # isValidClusterLock, depositBlsCheck, builderBlsCheck
    ├── parallelPool.ts           # Chunk workers + validateClusterLockInWorker
    ├── lockWorker.ts             # worker_threads chunk entry (CJS/ESM dist only)
    └── clusterLockValidationWorker.ts  # Whole-lock validation off main thread

test/
├── fixtures.ts       # Shared test data (addresses, cluster locks, validators)
├── client/           # Client method and validation tests
├── verification/     # parallelPool.spec.ts (sync fallback in jest)
├── perf/             # parallelBench.mjs, blsBench.mjs (run after yarn build)
├── eoa/              # EOA functionality tests
├── exit/             # Exit signature and verification tests
├── incentives/       # Incentive claim tests
├── splits/           # Split contract tests
├── sdk-package/      # E2E tests (separate package, real blockchain)
└── nextjs-test-app/  # Next.js integration test app
```

## Build System

Uses **tsup** to produce three outputs:
1. **CJS** → `dist/cjs/src/` (Node.js CommonJS)
2. **ESM** → `dist/esm/src/` (Node.js ES Modules)
3. **Browser** → `dist/browser/src/` (Browser ESM with polyfills)

Types are generated separately via `tsc --emitDeclarationOnly` → `dist/types/`.

Key build notes:
- `@noble/curves` is bundled in the browser build (pure JS, safe to bundle); kept external in Node builds
- `ethers` is kept external (~2MB, consumers already have it)
- `@chainsafe/enr` is bundled (ESM-only package)
- Browser build defines `process.env` as empty and `global` as `globalThis`
- **CJS/ESM Node** also emit separate bundles for `lockWorker.js` and
  `clusterLockValidationWorker.js` (see `tsup.config.ts`). **Browser** build does
  not — `validateClusterLock` falls back to sync there.

## Architecture

### Client Class (`src/index.ts`)

The `Client` class is the main entry point. It extends `Base` and exposes namespaced sub-modules:

```typescript
const client = new Client(
  { chainId: 1, baseUrl?: string },
  signer?: Wallet | JsonRpcSigner,    // required for write ops
  provider?: Provider                  // required for on-chain reads
);

// Namespaced modules
client.splits.*       // OVM/SplitV2/SplitMain deployment
client.eoa.*          // EOA withdrawals and batch deposits
client.incentives.*   // Claim Obol rewards
client.exit.*         // Verify/recombine exit signatures
```

### Core Client Methods

| Method | Signer? | Description |
|--------|---------|-------------|
| `acceptObolLatestTermsAndConditions()` | Yes | EIP-712 T&C acceptance (required before writes) |
| `createClusterDefinition(payload)` | Yes | Register new cluster, returns `config_hash` |
| `acceptClusterDefinition(operatorPayload, configHash)` | Yes | Operator joins cluster |
| `getClusterDefinition(configHash)` | No | Fetch cluster definition |
| `getClusterLock(configHash)` | No | Fetch cluster lock (post-DKG) |
| `getClusterLockByHash(lockHash)` | No | Fetch lock by lock_hash |
| `createObolRewardsSplit(payload)` | Yes | Deploy OWR + SplitMain (Mainnet/Hoodi only) |
| `createObolTotalSplit(payload)` | Yes | Deploy SplitMain only (Mainnet/Hoodi only) |
| `getOWRTranches(owrAddress)` | Yes | Read OWR contract state |

### Sub-Module Methods

**client.splits**
| Method | Description |
|--------|-------------|
| `createValidatorManagerAndRewardsSplit(payload)` | Deploy OVM + SplitV2 for rewards splitting |
| `createValidatorManagerAndTotalSplit(payload)` | Deploy OVM + SplitV2 for total splitting |
| `requestWithdrawal(payload)` | Submit withdrawal to OVM contract |
| `deposit(payload)` | Deposit validators to OVM |

**client.eoa**
| Method | Description |
|--------|-------------|
| `requestWithdrawal(payload)` | Request validator withdrawal via EOA contract |
| `deposit(payload)` | Batch deposit validators (up to 500 per tx) |

**client.incentives**
| Method | Description |
|--------|-------------|
| `claimIncentives(address)` | Claim from Merkle Distributor |
| `isClaimed(contractAddress, index)` | Check claim status |
| `getIncentivesByAddress(address)` | Fetch claimable incentive data |

**client.exit**
| Method | Description |
|--------|-------------|
| `verifyPartialExitSignature(...)` | Verify BLS partial exit signature |
| `verifyExitPayloadSignature(enr, payload)` | Verify ECDSA exit payload signature |
| `validateExitBlobs(config, payload, beaconUrl, existing)` | Comprehensive exit blob validation |
| `recombineExitBlobs(exitBlob)` | Aggregate partial BLS signatures |

### Standalone Exports

**`validateClusterLock`** (`import { validateClusterLock } from '@obolnetwork/obol-sdk'`)

Verifies the cryptographic validity of a cluster lock file without requiring a `Client` instance. Checks BLS key aggregates, ECDSA operator signatures, and SSZ merkle proofs. Passing here is **necessary but not sufficient** for Charon — Charon has additional runtime rules.

```typescript
import { validateClusterLock } from '@obolnetwork/obol-sdk';

const isValid = await validateClusterLock(lockObject, safeRpcUrl?);
```

**Performance (large locks, Node CJS — e.g. obol-api):**

Validation is CPU-bound on `@noble/curves` (pure JS BLS; no native `blst`). A
1k-validator lock can take **~60s** of crypto. The SDK already handles this in
two ways — **do not tell consumers to add their own workers** unless they use a
non-CJS bundle:

| Layer | When | Purpose |
|-------|------|---------|
| **Validation worker** | ≥50 validators, CJS, worker file found | Runs entire `isValidClusterLock` off the API main thread → avoids **502** when obol-api validates during `POST /lock` |
| **Chunk workers** (`lockWorker.js`) | Large share-binding / batch BLS / pubkey aggregation | Uses multiple cores *inside* validation (~57s vs ~103s on 1k lock vs 2.12.0) |

Entry: `src/services.ts` → `validateClusterLockInWorker` in `parallelPool.ts`,
else sync `isValidClusterLock` in `common.ts`.

**Build behavior:**

- **CJS Node** (obol-api): full worker path ✅ — workers at
  `dist/cjs/src/verification/*.js`; `getWorkerPath` checks both `__dirname` and
  `__dirname/verification` because `parallelPool` is bundled into `index.js`
  (`__dirname` = `dist/cjs/src`). **Publish only after `yarn build`.**
- **ESM Node / Jest / source**: sync fallback (worker paths do not resolve)
- **Browser**: sync only (no worker bundles)

**Worker failure semantics:** whole-lock timeout (120s) or per-chunk BLS timeout (60s) → **`ClusterLockValidationTimeoutError`** (HTTP **504** in obol-api); worker crash / missing file → sync fallback (`null`). See plan doc.

**When changing validation logic**, read **`PARALLEL_VALIDATION_PLAN.md`** first.
Key types: `BlsSignatureCheck` in `src/types.ts`. Deposit/builder flow:
`depositBlsCheck` / `builderBlsCheck` → `verifyBlsChecksParallel` (signatures
verified once, not twice). Lock has **one** `signature_aggregate`; many operator
pubkeys are aggregated in `verifyAggregateParallel` (~5% of wall time).

**Do not** add `blst` or opt-in profiling without an explicit product decision.
Bench chunk workers after build: `node test/perf/parallelBench.mjs`.

### Key Types (from `src/types.ts`)

- **ClusterPayload**: Input for `createClusterDefinition` — `{ name, operators (min 4), validators (min 1), deposit_amounts?, compounding?, target_gas_limit? }`
- **ClusterDefinition**: Full cluster config with `config_hash`, `threshold`, `fork_version`, `uuid`, etc.
- **ClusterLock**: Post-DKG result with `distributed_validators`, `signature_aggregate`, `lock_hash`
- **BlsSignatureCheck**: `{ pubkey, message, signature }` — one batch BLS verify unit
- **RewardsSplitPayload / TotalSplitPayload**: V1 SplitMain payloads
- **OVMRewardsSplitPayload / OVMTotalSplitPayload**: V2 OVM+SplitV2 payloads
- **SplitRecipient**: `{ account, percentAllocation }` (V1)
- **SplitV2Recipient**: `{ address, percentAllocation }` (V2)
- **SignerType**: `JsonRpcSigner | Wallet`
- **ProviderType**: `Provider | JsonRpcProvider | JsonRpcApiProvider | BrowserProvider`

### Error Classes (`src/errors.ts`)

- **SignerRequiredError**: Write method called without signer
- **UnsupportedChainError**: Operation not supported on chain (e.g., splits on Sepolia)
- **ConflictError**: Duplicate resource (e.g., cluster already posted)

### Supported Chains

| Chain | ID | Splits | Default |
|-------|----|--------|---------|
| Mainnet | 1 | Yes | No |
| Hoodi | 560048 | Yes | Yes |
| Gnosis | 100 | No | No |
| Sepolia | 11155111 | No | No |

### Validation

All payloads are validated via **AJV** schemas before API/contract calls. Custom keywords handle:
- Unique operator addresses (min 4 operators)
- Percent allocation totals (must sum to 100%)
- RAF (Retroactive Funding) auto-appending
- Deposit data format validation (pubkey, withdrawal_credentials, signature lengths)

### Authentication Pattern

Write operations use **EIP-712 typed-data signing**. The signature is passed as `Authorization: Bearer {signature}` header. No session/token management — the signature is the proof of authorization.

## SDK as Public API Surface

**This SDK is the official programmatic interface to Obol for external developers.**

Any capability added to `obol-api` that external clients could reasonably use should be exposed via a corresponding SDK method. When you add or update an API endpoint:

1. Add the corresponding method to the SDK `Client` class (or a sub-module)
2. Add types to `src/types.ts`
3. Add AJV validation schema to `src/schema.ts` if the method takes a payload
4. Write unit tests in `test/<module>/`
5. Add an example in `obol-sdk-examples/TS-Example/index.ts` (see that repo's CLAUDE.md)

This keeps the SDK in sync with the API and ensures external developers always have a typed, validated, documented way to interact with the platform.

## Testing

### Test Framework

- **Jest 29** with `ts-jest/presets/default-esm`
- ESM module support via `NODE_OPTIONS=--experimental-vm-modules`
- `maxWorkers: 50%`

### Running Tests

```bash
# Unit tests only (fast, no network)
yarn test

# Single file
npx jest test/client/methods.test.ts

# Watch mode
yarn test --watch

# E2E tests (requires PRIVATE_KEY and DEL_AUTH env vars, hits real Hoodi testnet)
cd test/sdk-package
yarn install
yarn build
yarn test:e2e
```

### Unit Test Patterns

Tests are in `test/` organized by module. Key conventions:

**Structure:**
```typescript
describe('ClassName', () => {
  describe('methodName', () => {
    it('should do something', async () => { ... });
  });
});
```

**Mock Patterns (ESM):**
```typescript
// ESM module mocking (required for top-level imports)
await jest.unstable_mockModule('./path/to/module.js', () => ({
  __esModule: true,
  functionName: jest.fn(),
}));
// Dynamic import AFTER mock setup
const { TestedClass } = await import('./path/to/tested.js');

// Spy mocking
jest.spyOn(object, 'method').mockResolvedValue(value);

// Global fetch mock
global.fetch = jest.fn();
```

**Test Data:** Use `test/fixtures.ts` for shared addresses (`TEST_ADDRESSES`), cluster locks, and validator data. Do not hardcode test addresses — import from fixtures.

**Assertions:**
```typescript
expect(result).toEqual(expected);
expect(fn).toHaveBeenCalledWith(args);
await expect(asyncFn()).rejects.toThrow('message');
```

**Timeouts:**
- Unit tests: default Jest timeout
- Methods tests: `jest.setTimeout(20000)`
- E2E tests: `jest.setTimeout(100000)`

### E2E Tests (`test/sdk-package/`)

- Separate package with its own `package.json` and `jest-e2e.json`
- Tests real blockchain interactions on **Hoodi testnet**
- Requires env vars: `PRIVATE_KEY`, `DEL_AUTH`, `RPC_HOODI`
- Uses actual signers, providers, and HTTP requests
- Tests: cluster creation, lock polling, contract deployments
- Cleanup: `afterAll` hooks delete test resources via API

### Writing New Tests

**Unit test for a new Client method:**
1. Add test file in appropriate `test/<module>/` directory
2. Mock external dependencies with `jest.unstable_mockModule`
3. Import tested module dynamically after mocks
4. Use fixtures from `test/fixtures.ts`
5. Test success path, error cases, and edge conditions

**E2E test:**
1. Add to `test/sdk-package/cluster.spec.ts` or create new file
2. Use real signer from `PRIVATE_KEY` env var
3. Use `--runInBand` (tests run sequentially)
4. Clean up created resources in `afterAll`

## Environment Variables

```bash
# RPCs (used for on-chain reads and tests)
RPC_MAINNET=https://ethereum-rpc.publicnode.com
RPC_HOODI=https://ethereum-hoodi-rpc.publicnode.com
RPC_GNOSIS=...
RPC_SEPOLIA=...

# E2E only
PRIVATE_KEY=...   # Hoodi testnet signer
DEL_AUTH=...      # API deletion auth token
```

## Code Style

- **Prettier**: single quotes, trailing commas, 80 char width, 2-space indent, no parens on single arrow params
- **ESLint**: `standard-with-typescript` base, strict TypeScript disabled for some rules
- **Pre-commit**: Husky runs lint-staged (eslint --fix + prettier --write)
- When adding code, match existing patterns in the file

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `ethers` ^6 | Ethereum wallet, provider, contract interactions |
| `@noble/curves` | BLS12-381 signature verification (replaces @chainsafe/bls) |
| `@chainsafe/ssz` | SSZ serialization for consensus types |
| `@chainsafe/enr` | Ethereum Node Record parsing |
| `@safe-global/protocol-kit` | Safe multisig wallet integration |
| `ajv` | JSON schema payload validation |
| `cross-fetch` | Isomorphic HTTP fetch |

## Dependencies policy

When adding a new dependency:
- Use the **latest stable exact version** (e.g. `"some-lib": "3.2.1"` not `"^3.2.1"`)
- Verify compatibility with both Node.js and browser build targets — some packages are Node-only
- Check for peer dependency conflicts with `ethers ^6`, `@noble/curves`, and `typescript ~5.9`
- Run `yarn build` and `yarn test` after adding to confirm all three build outputs still work

## Release and Publishing

**Never publish from local.** The release process is:

1. Make changes, open a PR, get it reviewed and merged to `main`
2. Manually trigger the **"Release PR"** GitHub Actions workflow — this bumps the version via `release-it` and opens a release PR with the `release` label
3. Review and merge the release PR
4. Manually trigger the **"Publish Obol-SDK to NPM"** workflow — this publishes the package to npm

Version bumping follows semantic versioning:
- **Patch**: bug fixes, no API changes
- **Minor**: new methods, new supported chains, backwards-compatible additions
- **Major**: breaking changes to the `Client` API, removed methods, type signature changes

## CI/CD

- **PR checks**: lint, prettier, build, unit tests, E2E tests (GitHub Actions)
- **Node version in CI**: 24.x

## Common Patterns When Modifying Code

### Adding a New Client Method

1. Add types to `src/types.ts`
2. Add validation schema to `src/schema.ts` with AJV keyword if needed
3. Implement in `src/index.ts` (or sub-module file)
4. If it requires signer, check `this.signer` and throw `SignerRequiredError`
5. If chain-restricted, check `chainId` and throw `UnsupportedChainError`
6. Validate payload with AJV before API/contract call
7. Add unit test in `test/<module>/`
8. Add E2E test in `test/sdk-package/` if it involves real chain interaction
9. Add example in `obol-sdk-examples/TS-Example/index.ts`

### Adding a New Sub-Module

1. Create `src/<module>/<module>.ts` with class extending needed patterns
2. Create `src/<module>/<module>Helpers.ts` for helper functions
3. Instantiate in `Client` constructor and expose as `this.<module>`
4. Pass `signer`, `chainId`, `provider`, and `request` function to constructor
5. Export types from `src/types.ts`
6. Add tests in `test/<module>/`

### Adding Support for a New Chain

1. Add chain ID and fork versions to `src/constants.ts` (`FORK_MAPPING`, `CAPELLA_FORK_MAPPING`)
2. Add contract addresses to the chain config objects
3. Update `FORK_MAPPING` enum in `src/types.ts`
4. Add RPC env var to `.env.template`
5. Update supported chain checks in relevant methods

### Contract Interaction Pattern

```typescript
// Predict address before deploying (idempotent)
const predictedAddress = await predictContractAddress(...);
const isDeployed = await isContractAvailable(predictedAddress, provider);
if (isDeployed) return predictedAddress; // skip deployment
// Deploy if not exists
const tx = await deployContract(...);
```

## Do Not

- Do not read `src/bytecodes.ts` unless specifically working on contract deployments — it's 200KB of hex bytecodes
- Do not modify contract ABIs in `src/abi/` unless updating to new contract versions
- Do not skip AJV validation — all payloads must be validated before API/contract calls
- Do not use `jest.mock()` — use `jest.unstable_mockModule()` for ESM compatibility
- Do not hardcode test addresses — use `TEST_ADDRESSES` from `test/fixtures.ts`
- Do not publish to npm from local — always use the GitHub Actions workflow

## Related products

- **[`ObolNetwork/obol-sdk-examples`](https://github.com/ObolNetwork/obol-sdk-examples)** — canonical consumer examples (TypeScript, JavaScript, Lido script). Adapt from these before writing snippets from scratch.
- **[Obol API](https://api.obol.tech)** — the hosted service this SDK talks to. `baseUrl` defaults to production. Private source; treat as a black box with EIP-712 Bearer auth.
- **[launchpad.obol.org](https://launchpad.obol.org)** — hosted UI equivalent for cluster creation + DKG. The SDK is the "code path"; Launchpad is the "UI path".
- **[`charon` CLI / `obolnetwork/charon` Docker image](https://docs.obol.org/docs/charon/charon-cli-reference)** — command-line equivalent for creation / DKG / lock operations. Often simpler than a Node.js project for one-shot tasks.
- **`charon-distributed-validator-node`** (CDVN) — stock Docker Compose launcher for running a DV node. Operates clusters this SDK prepares.
- **`lido-charon-distributed-validator-node`** (LCDVN) — Lido Simple DVT variant. Used with the SDK for Lido operator flows.
- **`obol-splits`** — reference Solidity contracts (OVM, SplitV2, SplitMain, OWR) the SDK deploys on behalf of users.

## Key docs

- **Lock validation performance / workers**: `PARALLEL_VALIDATION_PLAN.md` (in this repo)
- SDK TypeDoc reference: https://obolnetwork.github.io/obol-sdk
- Obol SDK quickstart: https://docs.obol.org/docs/advanced/quickstart-sdk
- Charon CLI reference: https://docs.obol.org/docs/charon/charon-cli-reference
- DKG ceremony: https://docs.obol.org/docs/start/dkg
- Obol Terms of Service: https://obol.org/terms.pdf
- Canonical agent index: https://obol.org/llms.txt
