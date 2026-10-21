/**
 * The client context without the modules: the chain, the viem clients and the
 * Obol API, checked once (spec/operations.md "createObolClient" 1–5). A
 * module entry (`@obolnetwork/obol-sdk/ovm`, ...) binds its module to it
 * without loading the others:
 *
 *   const ovm = createOvmModule(createObolContext({ chain, publicClient }))
 */
import { Type } from '@sinclair/typebox';
import type { Chain, PublicClient, WalletClient } from 'viem';
import { ObolApi } from './api.js';
import {
  ALLOWED_API_BASE_URLS,
  DEFAULT_API_BASE_URL,
  DEFAULT_API_TIMEOUT_MS,
  getObolChain,
  isAllowedApiBaseUrl,
} from './chains.js';
import type { Context } from './context.js';
import { ObolError } from './errors.js';
import { decode } from './schema.js';

export interface ObolClientConfig {
  /** viem Chain: mainnet or Hoodi (Gnosis / Sepolia for cluster files only). */
  chain: Chain;
  publicClient: PublicClient;
  /** Needed for EIP-712 signatures and `send`. */
  walletClient?: WalletClient;
  /**
   * Default: the Obol API at api.obol.tech, 30 s timeout. `false`: chain
   * only. `baseUrl` must be an Obol host; with `allowLocal: true` it may also
   * be `http(s)://localhost[:port]` or `http(s)://127.0.0.1[:port]` (a local
   * obol-api). EIP-712 signatures are sent to that host as bearer tokens, so
   * any other host is refused.
   */
  api?: { baseUrl?: string; timeoutMs?: number; allowLocal?: boolean } | false;
}

export const ApiSettings = Type.Object(
  {
    baseUrl: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
    allowLocal: Type.Optional(Type.Boolean()),
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
  const allowLocal = settings.allowLocal === true;
  if (!isAllowedApiBaseUrl(baseUrl, allowLocal)) {
    throw new ObolError(
      'BASE_URL_INVALID',
      `api.baseUrl must be one of ${ALLOWED_API_BASE_URLS.join(', ')}${
        allowLocal ? ', or http(s)://localhost or 127.0.0.1 with a port' : ''
      }`,
      {
        hint: allowLocal
          ? 'A local API is http(s)://localhost[:port] or http(s)://127.0.0.1[:port], without a path'
          : 'EIP-712 signatures are sent as bearer tokens, so only Obol hosts are allowed; pass allowLocal: true for a local API, or api: false',
        details: { baseUrl },
      },
    );
  }
  return new ObolApi({
    baseUrl,
    timeoutMs: settings.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
  });
};

/** Checks the configuration and builds the context every module is bound to. */
export const createObolContext = (config: ObolClientConfig): Context => {
  const chain = getObolChain(config.chain.id);
  const publicChainId = config.publicClient.chain?.id;
  if (publicChainId !== undefined && publicChainId !== chain.id) {
    throw chainMismatch(chain.id, publicChainId, 'publicClient');
  }
  const walletChainId = config.walletClient?.chain?.id;
  if (walletChainId !== undefined && walletChainId !== chain.id) {
    throw chainMismatch(chain.id, walletChainId, 'walletClient');
  }
  return {
    chain,
    publicClient: config.publicClient,
    ...(config.walletClient !== undefined
      ? { walletClient: config.walletClient }
      : {}),
    api: buildApi(config.api),
  };
};
