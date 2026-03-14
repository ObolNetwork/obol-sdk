# CLAUDE.md — Obol SDK Agent Guide

## Project Overview

**@obolnetwork/obol-sdk** is a TypeScript SDK for managing Distributed Validators (DVs) on Ethereum. It runs in both **browser and Node.js** environments. The SDK provides cluster lifecycle management, reward splitting via smart contracts, incentive claims, exit validation, and EOA operations.

- **Package**: `@obolnetwork/obol-sdk` (v2.11.9)
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

# Lint
yarn lint          # with --fix
yarn lint-ci       # CI mode, no fix

# Format
yarn prettier      # with --write
yarn prettier-ci   # check only

# E2E tests (from test/sdk-package/)
cd test/sdk-package && yarn install && yarn build && yarn test:e2e
```

## Project Structure

```
src/
├── index.ts          # Main Client class — primary entry point (all public methods)
├── base.ts           # Base class with HTTP request abstraction
├── types.ts          # All TypeScript types and interfaces
├── errors.ts         # Custom errors: ConflictError, SignerRequiredError, UnsupportedChainError
├── constants.ts      # Chain configs, contract addresses, fork mappings
├── services.ts       # Standalone exports (validateClusterLock)
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

test/
├── fixtures.ts       # Shared test data (addresses, cluster locks, validators)
├── client/           # Client method and validation tests
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
- `@chainsafe/bls` is kept external (WASM initialization issues when bundled)
- `ethers` is kept external (~2MB, consumers already have it)
- `@chainsafe/enr` is bundled (ESM-only package)
- Browser build defines `process.env` as empty and `global` as `globalThis`

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

**Standalone** (`import { validateClusterLock } from '@obolnetwork/obol-sdk'`)
| Function | Description |
|----------|-------------|
| `validateClusterLock(lock, safeRpcUrl?)` | Verify cluster lock cryptographic validity |

### Key Types (from `src/types.ts`)

- **ClusterPayload**: Input for `createClusterDefinition` — `{ name, operators (min 4), validators (min 1), deposit_amounts?, compounding?, target_gas_limit? }`
- **ClusterDefinition**: Full cluster config with `config_hash`, `threshold`, `fork_version`, `uuid`, etc.
- **ClusterLock**: Post-DKG result with `distributed_validators`, `signature_aggregate`, `lock_hash`
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

## Testing

### Test Framework

- **Jest 29** with `ts-jest/presets/default-esm`
- ESM module support via `NODE_OPTIONS=--experimental-vm-modules`
- `maxWorkers: 50%`

### Running Tests

```bash
# Unit tests only
yarn test

# E2E tests (requires PRIVATE_KEY and DEL_AUTH env vars)
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
| `@chainsafe/bls` | BLS signature verification |
| `@chainsafe/ssz` | SSZ serialization for consensus types |
| `@chainsafe/enr` | Ethereum Node Record parsing |
| `@safe-global/protocol-kit` | Safe multisig wallet integration |
| `ajv` | JSON schema payload validation |
| `cross-fetch` | Isomorphic HTTP fetch |

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

## CI/CD

- **PR checks**: lint, prettier, build, unit tests, E2E tests (GitHub Actions)
- **Release**: `release-it` bumps version, creates release PR with `release` label
- **Publish**: Triggered on merged PR with `release` label → npm publish
- **Node version in CI**: 22.x

## Do Not

- Do not read `src/bytecodes.ts` unless specifically working on contract deployments — it's 200KB of hex bytecodes
- Do not modify contract ABIs in `src/abi/` unless updating to new contract versions
- Do not skip AJV validation — all payloads must be validated before API/contract calls
- Do not use `jest.mock()` — use `jest.unstable_mockModule()` for ESM compatibility
- Do not hardcode test addresses — use `TEST_ADDRESSES` from `test/fixtures.ts`
