/**
 * terms: Obol terms and conditions (spec/operations.md "terms").
 */
import type { Address, Hex } from 'viem';
import {
  accountAddress,
  requireApi,
  requireWallet,
  type Context,
} from '../context.js';
import { ObolError } from '../errors.js';
import { checksum, decode, T } from '../schema.js';
import { Type } from '@sinclair/typebox';

/** Version and hash of the current terms (https://obol.org/terms.pdf); same values as 2.x `constants.ts`. */
export const TERMS_AND_CONDITIONS_VERSION = 1;
export const TERMS_AND_CONDITIONS_HASH: Hex =
  '0xd33721644e8f3afab1495a74abe3523cec12d48b8da6cb760972492ca3f1a273';

/** `TermsAndConditions` typed data; the domain has no `chainId`. */
export const termsTypedData = () =>
  ({
    domain: { name: 'Obol', version: '1' },
    types: {
      TermsAndConditions: [
        { name: 'terms_and_conditions_hash', type: 'string' },
        { name: 'version', type: 'uint256' },
      ],
    },
    primaryType: 'TermsAndConditions',
    message: {
      terms_and_conditions_hash: TERMS_AND_CONDITIONS_HASH,
      version: BigInt(TERMS_AND_CONDITIONS_VERSION),
    },
  }) as const;

/**
 * Whether `address` (default: the wallet account) accepted the current
 * terms, from `GET /v1/termsAndConditions/:address`.
 *
 * @throws PAYLOAD_INVALID, WALLET_REQUIRED (no address and no wallet
 *   account), API_DISABLED, API_*.
 */
export const hasAccepted = async (
  ctx: Context,
  address?: Address,
): Promise<boolean> => {
  let target: Address;
  if (address !== undefined) {
    target = checksum(decode(T.Address, address, 'address'));
  } else {
    const account = ctx.walletClient?.account;
    if (account === undefined) {
      throw new ObolError(
        'WALLET_REQUIRED',
        'terms.hasAccepted needs an address or a walletClient with an account',
        { hint: 'Pass the address, or a walletClient to createObolClient' },
      );
    }
    target = accountAddress(account);
  }
  const response = await requireApi(ctx, 'terms.hasAccepted').request<{
    isTermsAndConditionsSigned?: unknown;
  }>(`/v1/termsAndConditions/${target}`);
  return response?.isTermsAndConditionsSigned === true;
};

const AcceptSchema = Type.Object(
  { ifNotAccepted: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);

/**
 * Accepts the current terms: signs `TermsAndConditions` with the wallet
 * (EIP-712, domain without `chainId`) and posts it. With `ifNotAccepted`,
 * checks `hasAccepted` first and returns without signing if so.
 *
 * @returns `signed: false` when skipped because already accepted.
 * @throws WALLET_REQUIRED, CHAIN_MISMATCH, API_DISABLED, API_* (API_CONFLICT:
 *   already accepted).
 */
export const accept = async (
  ctx: Context,
  input: { ifNotAccepted?: boolean } = {},
): Promise<{ signed: boolean }> => {
  const { ifNotAccepted = false } = decode(AcceptSchema, input);
  const api = requireApi(ctx, 'terms.accept');
  const { walletClient, account } = await requireWallet(ctx, 'terms.accept');
  const address = accountAddress(account);
  if (ifNotAccepted && (await hasAccepted(ctx, address))) {
    return { signed: false };
  }
  const signature = await walletClient.signTypedData({
    account,
    ...termsTypedData(),
  });
  await api.request('/v1/termsAndConditions', {
    method: 'POST',
    body: {
      address: checksum(address),
      version: TERMS_AND_CONDITIONS_VERSION,
      terms_and_conditions_hash: TERMS_AND_CONDITIONS_HASH,
      fork_version: ctx.chain.forkVersion,
    },
    headers: { Authorization: `Bearer ${signature}` },
  });
  return { signed: true };
};

/** The terms module bound to a client context. */
export interface TermsModule {
  hasAccepted: (address?: Address) => Promise<boolean>;
  accept: (input?: { ifNotAccepted?: boolean }) => Promise<{ signed: boolean }>;
}

export const createTermsModule = (ctx: Context): TermsModule => ({
  hasAccepted: async (address?: Address) => await hasAccepted(ctx, address),
  accept: async (input: { ifNotAccepted?: boolean } = {}) =>
    await accept(ctx, input),
});
