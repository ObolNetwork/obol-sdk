/**
 * What every module gets from the client: the chain, the viem clients and the
 * optional API. Modules are plain factories over a Context, so a second client
 * (or a test) can build one without the constructor.
 */
import {
  defineChain,
  getAddress,
  type Account,
  type Address,
  type Chain,
  type PublicClient,
  type WalletClient,
} from 'viem';
import type { ObolApi } from './api.js';
import { getObolChain, requireContracts, type ObolChain } from './chains.js';
import { ObolError } from './errors.js';

export interface Context {
  chain: ObolChain;
  /**
   * The viem Chain the client was built with (`createObolClient({ chain })`).
   * `send` passes it to `sendTransaction`, so viem re-checks the wallet chain
   * at send time. Absent on a hand-built context: a minimal viem Chain with
   * `chain.id` is used instead.
   */
  viemChain?: Chain;
  publicClient: PublicClient;
  walletClient?: WalletClient;
  /** null when the client was built with `api: false`. */
  api: ObolApi | null;
}

export const createContext = (args: Context): Context => {
  getObolChain(args.chain.id);
  return args;
};

/** G4: `api` operations need the API. */
export const requireApi = (ctx: Context, operation: string): ObolApi => {
  if (ctx.api === null) {
    throw new ObolError(
      'API_DISABLED',
      `${operation} needs the Obol API, and the client was built with api: false`,
      {
        hint: 'Enable the API, or use the chain-only operation',
        details: { operation },
      },
    );
  }
  return ctx.api;
};

export { requireContracts };

/**
 * G3: the wallet must exist, have an account, and be on the client chain.
 * Re-checked before every signature and send, because wallets switch chains.
 */
export const requireWallet = async (
  ctx: Context,
  operation: string,
): Promise<{ walletClient: WalletClient; account: Account | Address }> => {
  const walletClient = ctx.walletClient;
  const account = walletClient?.account;
  if (walletClient === undefined || account === undefined) {
    throw new ObolError(
      'WALLET_REQUIRED',
      `${operation} needs a walletClient with an account`,
      { hint: 'Pass walletClient to createObolClient' },
    );
  }
  const actual = await walletClient.getChainId();
  if (actual !== ctx.chain.id) {
    throw new ObolError(
      'CHAIN_MISMATCH',
      `The wallet is on chain ${actual}, the client on ${ctx.chain.id}`,
      {
        hint: "Switch the wallet's chain, or build the client for the wallet's chain",
        details: { expectedChainId: ctx.chain.id, actualChainId: actual },
      },
    );
  }
  return { walletClient, account };
};

/** The viem Chain of the context: the one the client was built with, else a minimal one with the same id. */
export const viemChainOf = (ctx: Context): Chain =>
  ctx.viemChain ??
  defineChain({
    id: ctx.chain.id,
    name: ctx.chain.name,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [] } },
  });

export const accountAddress = (account: Account | Address): Address =>
  typeof account === 'string' ? account : account.address;

/**
 * The sender for role checks: `from` (already decoded), else the wallet
 * account, else null. Checksummed.
 */
export const senderOf = (ctx: Context, from?: string): Address | null => {
  if (from !== undefined) return getAddress(from.toLowerCase());
  const account = ctx.walletClient?.account;
  return account !== undefined
    ? getAddress(accountAddress(account).toLowerCase())
    : null;
};
