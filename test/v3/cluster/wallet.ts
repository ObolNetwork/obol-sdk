/**
 * A viem WalletClient over a local private-key account (signs EIP-712
 * locally), whose transport only answers eth_chainId.
 */
import {
  createWalletClient,
  custom,
  toHex,
  type Hex,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hoodi, mainnet } from 'viem/chains';
import type { Context } from '../../../src/v3/context.js';

export const KEYS = {
  creator: `0x${'11'.repeat(32)}` as Hex,
  operator: `0x${'22'.repeat(32)}` as Hex,
  other: `0x${'33'.repeat(32)}` as Hex,
};

export const accountOf = (key: Hex) => privateKeyToAccount(key);

export const localWallet = (
  key: Hex,
  chainId = 560048,
  chain = chainId === 1 ? mainnet : hoodi,
): WalletClient =>
  createWalletClient({
    account: privateKeyToAccount(key),
    chain,
    transport: custom({
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_chainId') return toHex(chainId);
        throw new Error(`localWallet: unsupported ${method}`);
      },
    }),
  });

export const withWallet = (
  ctx: Context,
  walletClient: WalletClient,
): Context => ({
  ...ctx,
  walletClient,
});
