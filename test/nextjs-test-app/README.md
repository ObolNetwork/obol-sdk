# Obol SDK Next.js Test App

This is a test application to verify the Obol SDK works correctly in browser/Next.js environments.

## Quick Start

```bash
# From this directory
npm install
npm run dev
```

Then open http://localhost:3002 (or whatever port Next.js assigns)

## Features

### 1. Connect MetaMask
- Click "Connect MetaMask" to connect your wallet
- Make sure MetaMask is installed
- Shows your connected address

### 2. Accept Terms & Conditions
- After connecting MetaMask, click "Accept Terms & Conditions"
- This will sign the Obol terms using your wallet
- Tests the `acceptObolLatestTermsAndConditions()` method

### 3. Run SDK Tests
- Click "Run SDK Tests" to test basic SDK functionality
- Tests import, instantiation, modules, and API calls
- Works without wallet connection

## What This Tests

- ✅ MetaMask integration with ethers.js
- ✅ Wallet connection in browser
- ✅ Terms and conditions acceptance (real SDK method!)
- ✅ SDK import in browser environment
- ✅ Client instantiation with and without signer
- ✅ Module accessibility (incentives, exit, splits, eoa)
- ✅ API method execution
- ✅ Browser environment detection
- ✅ Dependency bundling vs externalization

## Expected Behavior

- All tests should pass if SDK is correctly configured
- MetaMask connection should work smoothly
- Terms acceptance should trigger MetaMask signature request
- Clear errors if peer dependencies are missing
- No webpack/bundler warnings about Node.js modules

## Development

- `npm run dev` - Start development server
- `npm run build` - Build for production

## Dependencies

This test app includes:
- `ethers` - Required for wallet interaction
- `@obolnetwork/obol-sdk` - Local SDK (file:../../)
- `next`, `react`, `react-dom` - Next.js framework

**Note:** This demonstrates the minimum browser installation (SDK + ethers). For full SDK features, you'd also need `@chainsafe/bls` and optionally `@safe-global/protocol-kit`.