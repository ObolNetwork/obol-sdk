/**
 * createObolClient (spec/operations.md "Client"): checks the chain, the viem
 * clients and the API settings once, then builds every module over one
 * Context.
 */
import { Type } from '@sinclair/typebox';
import type { Chain, PublicClient, WalletClient } from 'viem';
import { ObolApi } from './api.js';
import {
  ALLOWED_API_BASE_URLS,
  DEFAULT_API_BASE_URL,
  DEFAULT_API_TIMEOUT_MS,
  getObolChain,
} from './chains.js';
import type { Context } from './context.js';
import { ObolError } from './errors.js';
import { decode } from './schema.js';
import { send } from './send.js';
import type { Prepared } from './types.js';
import { createClusterModule } from './cluster/index.js';
import { createDepositsModule } from './deposits/index.js';
import { createExitsModule } from './exits/index.js';
import { createIncentivesModule } from './incentives/index.js';
import { createLegacyModule } from './legacy/index.js';
import { createOvmModule } from './ovm/index.js';
import { createSetupModule } from './setup/index.js';
import { createSplitsModule } from './splits/index.js';
import { createTermsModule } from './terms/index.js';
import { createWithdrawalsModule } from './withdrawals/index.js';

export interface ObolClientConfig {
  /** viem Chain: mainnet or Hoodi (Gnosis / Sepolia for cluster files only). */
  chain: Chain;
  publicClient: PublicClient;
  /** Needed for EIP-712 signatures and `send`. */
  walletClient?: WalletClient;
  /** Default: the Obol API at api.obol.tech, 30 s timeout. `false`: chain only. */
  api?: { baseUrl?: string; timeoutMs?: number } | false;
}

const ApiSettings = Type.Object(
  {
    baseUrl: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

const chainMismatch = (
  expected: number,
  actual: number,
  what: string,
): ObolError =>
  new ObolError(
    'CHAIN_MISMATCH',
    `${what} is on chain ${actual}, the client on ${expected}`,
    {
      hint: `Build ${what} for chain ${expected}`,
      details: { expectedChainId: expected, actualChainId: actual },
    },
  );

const buildApi = (config: ObolClientConfig['api']): ObolApi | null => {
  if (config === false) return null;
  const settings = decode(ApiSettings, config ?? {}, 'api');
  const baseUrl = (settings.baseUrl ?? DEFAULT_API_BASE_URL)
    .trim()
    .replace(/\/+$/, '');
  if (!(ALLOWED_API_BASE_URLS as readonly string[]).includes(baseUrl)) {
    throw new ObolError(
      'INVALID_BASE_URL',
      `api.baseUrl must be one of ${ALLOWED_API_BASE_URLS.join(', ')}`,
      {
        hint: 'EIP-712 signatures are sent as bearer tokens, so only Obol hosts are allowed; or pass api: false',
      },
    );
  }
  return new ObolApi({
    baseUrl,
    timeoutMs: settings.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
  });
};

// The client type is inferred from the modules.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const createObolClient = (config: ObolClientConfig) => {
  const chain = getObolChain(config.chain.id);
  const publicChainId = config.publicClient.chain?.id;
  if (publicChainId !== undefined && publicChainId !== chain.id) {
    throw chainMismatch(chain.id, publicChainId, 'publicClient');
  }
  const walletChainId = config.walletClient?.chain?.id;
  if (walletChainId !== undefined && walletChainId !== chain.id) {
    throw chainMismatch(chain.id, walletChainId, 'walletClient');
  }
  const ctx: Context = {
    chain,
    publicClient: config.publicClient,
    ...(config.walletClient !== undefined
      ? { walletClient: config.walletClient }
      : {}),
    api: buildApi(config.api),
  };
  return {
    chain,
    cluster: createClusterModule(ctx),
    deposits: createDepositsModule(ctx),
    ovm: createOvmModule(ctx),
    splits: createSplitsModule(ctx),
    setup: createSetupModule(ctx),
    incentives: createIncentivesModule(ctx),
    exits: createExitsModule(ctx),
    terms: createTermsModule(ctx),
    withdrawals: createWithdrawalsModule(ctx),
    legacy: createLegacyModule(ctx),
    send: async (prepared: Prepared<unknown>) => await send(ctx, prepared),
  };
};

export type ObolClient = ReturnType<typeof createObolClient>;
