![Obol Logo](https://obol.org/obolnetwork.png)

<h1 align="center">Obol SDK</h1>

This repo contains the Obol Software Development Kit, for creating Distributed Validators with the help of the [Obol API](https://docs.obol.org/api).

## Quick Start

```typescript
import { Client } from "@obolnetwork/obol-sdk";
import { Wallet } from "ethers";

// 1. Create a client (Holesky testnet)
const signer = new Wallet(process.env.PRIVATE_KEY!);
const client = new Client({ chainId: 17000 }, signer);

// 2. Accept terms and conditions (required once per address)
await client.acceptObolLatestTermsAndConditions();

// 3. Create a cluster definition
const configHash = await client.createClusterDefinition({
  name: "my-cluster",
  operators: [{ address: "0xOperator1..." }, { address: "0xOperator2..." }],
  validators: [{
    fee_recipient_address: "0xFeeRecipient...",
    withdrawal_address: "0xWithdrawal...",
  }],
});

// 4. Retrieve the definition / lock (read-only, no signer needed)
const definition = await client.getClusterDefinition(configHash);
const lock = await client.getClusterLock(configHash);
```

## Getting Started

Checkout our [docs](https://docs.obol.org/docs/advanced/quickstart-sdk), [examples](https://github.com/ObolNetwork/obol-sdk-examples/), and SDK [reference](https://obolnetwork.github.io/obol-sdk). Further guides and walkthroughs coming soon.

## Terms and Conditions
To use obol-sdk and in order to be able to create a cluster definition or accept an invite to join a cluster, you must accept the [latest Obol terms and conditions](https://obol.org/terms.pdf) by calling acceptObolLatestTermsAndConditions.

## ⚠️ Important Security Notice:
If you're integrating this SDK with a **backend** (e.g., in Node.js), and you store a private key for executing splitter transactions, handle it with extreme caution. Ensure that:

- The private key is securely stored (e.g., in an `.env` file).
- Never commit or push your `.env` file containing the private key to version control.

## ⚡️ Integration with Safe Wallet

When integrating the Obol SDK with a **Safe Wallet**, you can either pass an RPC URL OR provide the `RPC_MAINNET` or `RPC_HOLESKY` or `RPC_GNOSIS` or `RPC_SEPOLIA` or `RPC_HOODI` environment variable, pointing to the correct network's RPC URL. This is required to interact with Safe kit.


## Contributing

Please review the following guidelines:

- [How to Report Bugs](#how-to-report-bugs)
- [How to Propose Changes](#how-to-propose-changes)
- [Code Review Process](#code-review-process)

### How to Report Bugs

If you encounter a bug or unexpected behavior, please follow these steps to report it:

1. Go to the "Issues" tab of this repository.
2. Click on the "Get started" button in the Bug report section.
3. Provide a clear title and description of the issue following the format provided.

### How to Propose Changes

If you'd like to propose improvements or new features, please follow these steps:

1. Fork this repository.
2. Create a new branch for your changes.
3. Make your changes and commit them with clear messages.
4. Open a pull request with a detailed description of the changes.

### Code Review Process

All contributions are reviewed before they are merged into the main branch. Please address any feedback provided during the review process.

Thank you for contributing to Obol-SDK!

## For AI Agents and Code Generators

If you are an LLM, code-generation agent, or tool using this SDK programmatically, follow these guidelines to avoid common mistakes:

- **Primary entrypoint:** `Client` from `@obolnetwork/obol-sdk`.
- **Constructor:** `new Client({ chainId }, signer?, provider?)` – `chainId` defaults to `17000` (Holesky).
- **All operations are namespaced** under the client instance. Do **not** construct HTTP requests manually.

### Client API Surface

| Namespace | Method | Description |
|-----------|--------|-------------|
| *(root)* | `acceptObolLatestTermsAndConditions()` | Accept T&C (required once before writes) |
| *(root)* | `createClusterDefinition(payload)` | Create a new cluster → returns `config_hash` |
| *(root)* | `acceptClusterDefinition(operatorPayload, configHash)` | Join a cluster as an operator |
| *(root)* | `getClusterDefinition(configHash)` | Fetch cluster definition (read-only) |
| *(root)* | `getClusterLock(configHash)` | Fetch cluster lock by config hash (read-only) |
| *(root)* | `getClusterLockByHash(lockHash)` | Fetch cluster lock by lock hash (read-only) |
| *(root)* | `createObolRewardsSplit(payload)` | Deploy OWR + splitter (rewards-only split) |
| *(root)* | `createObolTotalSplit(payload)` | Deploy splitter (total split) |
| *(root)* | `getOWRTranches(owrAddress)` | Read OWR tranche info (read-only on-chain) |
| `client.splits` | `createValidatorManagerAndRewardsSplit(payload)` | Deploy OVM + SplitV2 (rewards-only) |
| `client.splits` | `createValidatorManagerAndTotalSplit(payload)` | Deploy OVM + SplitV2 (total) |
| `client.splits` | `requestWithdrawal(payload)` | Request withdrawal from OVM |
| `client.splits` | `deposit(payload)` | Deposit to OVM contract |
| `client.incentives` | `getIncentivesByAddress(address)` | Fetch claimable incentives (read-only) |
| `client.incentives` | `isClaimed(contractAddress, index)` | Check if incentives claimed (read-only) |
| `client.incentives` | `claimIncentives(address)` | Claim incentives on-chain |
| `client.eoa` | `requestWithdrawal(payload)` | Request EOA withdrawal |
| `client.eoa` | `deposit(payload)` | Batch deposit validators |
| `client.exit` | `verifyPartialExitSignature(...)` | Verify BLS partial exit signature |
| `client.exit` | `verifyExitPayloadSignature(...)` | Verify ECDSA exit payload signature |
| `client.exit` | `validateExitBlobs(...)` | Validate exit blobs against cluster config |
| `client.exit` | `recombineExitBlobs(...)` | Aggregate partial exit signatures |

### Standalone Utilities

| Export | Description |
|--------|-------------|
| `validateClusterLock(lock, safeRpcUrl?)` | Verify a cluster lock's cryptographic validity |

### Key Rules

1. All request/response types are exported from the package root.
2. Error types exported: `ConflictError`, `SignerRequiredError`, `UnsupportedChainError`.
3. Methods that **write** (create, deploy, claim) require a `signer`. Methods that **read** (get, fetch) do not.
4. Supported chain IDs: `1` (Mainnet), `17000` (Holesky), `560048` (Hoodi), `100` (Gnosis), `11155111` (Sepolia).
5. Splitter/OVM deployment is only supported on chains 1, 17000, and 560048.

## Next.js / SSR Configuration

If using this SDK in **Next.js** or other SSR frameworks, add this minimal config to your `next.config.js`:

```javascript
webpack: (config, { isServer, webpack }) => {
  if (!isServer) {
    config.plugins.push(
      new webpack.DefinePlugin({
        'process.stdout.isTTY': 'false',
        'process.stderr.isTTY': 'false',
      })
    );
  } else {
    // Server: Externalize native dependencies
    config.externals = config.externals || [];
    config.externals.push({
      '@chainsafe/bls': 'commonjs @chainsafe/bls',
      '@chainsafe/blst': 'commonjs @chainsafe/blst',
      'bcrypto': 'commonjs bcrypto',
    });
  }
  
  // Ignore .node files
  config.plugins.push(
    new webpack.IgnorePlugin({ resourceRegExp: /\.node$/ })
  );
  
  return config;
}
```

