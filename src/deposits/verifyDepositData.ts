/**
 * deposits.verifyDepositData: the pure deposit checks run before ETH is sent
 * to a deposit contract (spec/operations.md, vectors deposit_checks.json).
 */
import { fromHexString } from '@chainsafe/ssz';
import { Type } from '@sinclair/typebox';
import { bytesToHex, type Hex } from 'viem';
import {
  computeDepositMsgRoot,
  depositDomainForFork,
  signingRoot,
} from '../internal/verification/common.js';
import {
  firstInvalidSignature,
  type SignatureItem,
} from '../internal/verification/signatureBatch.js';
import { depositDataContainer } from '../internal/verification/sszTypes.js';
import {
  assertSignal,
  createTick,
  throwIfAborted,
} from '../internal/yielder.js';
import { nobleBls, type BlsBackend } from '../cluster/blsBackend.js';
import { CHAINS } from '../chains.js';
import { ObolError } from '../errors.js';
import { decode, T } from '../schema.js';
import type { Deposit, DepositInput, DepositKind } from '../types.js';
import { ETH, GWEI } from '../units.js';

export const MIN_DEPOSIT = 1n * ETH;
/** MAX_EFFECTIVE_BALANCE for 0x00 / 0x01 credentials. */
export const MAX_DEPOSIT = 32n * ETH;
/** MAX_EFFECTIVE_BALANCE_ELECTRA for 0x02 credentials, and the cap for any top-up. */
export const MAX_COMPOUNDING_DEPOSIT = 2048n * ETH;

const ZERO_SIGNATURE = /^0x0{192}$/i;
const ZERO_CREDENTIALS = `0x${'0'.repeat(64)}`;

export const DepositSchema = Type.Object({
  pubkey: T.Pubkey,
  withdrawalCredentials: T.Credentials,
  signature: T.BlsSignature,
  depositDataRoot: T.Hash32,
  amount: T.Wei,
});

export const VerifyDepositDataSchema = Type.Object({
  deposits: Type.Array(DepositSchema),
  options: Type.Object({
    chainId: T.Uint,
    kind: Type.Optional(
      Type.Union([Type.Literal('deposit'), Type.Literal('topUp')]),
    ),
    expectedWithdrawalAddress: Type.Optional(T.Address),
    yieldMs: Type.Optional(T.Uint),
  }),
});

export interface VerifyDepositDataOptions {
  chainId: number;
  kind?: DepositKind;
  expectedWithdrawalAddress?: string;
  /** Longest stretch of signature work between event-loop yields, ms (default 50; 0 = never). */
  yieldMs?: number;
  /** BLS backend (default `cluster.nobleBls`). */
  bls?: BlsBackend;
  /**
   * Aborts the signature checks: checked at every yield point; an abort
   * throws `ABORTED` with the signal's reason as `cause`. Bounds the CPU a
   * server spends per request (e.g. `AbortSignal.timeout(5_000)`).
   */
  signal?: AbortSignal;
}

/** SSZ hash_tree_root of DepositData; `amountGwei` as on the wire. */
export const depositDataRoot = (fields: {
  pubkey: string;
  withdrawalCredentials: string;
  amountGwei: bigint;
  signature: string;
}): Hex =>
  bytesToHex(
    depositDataContainer.hashTreeRoot({
      pubkey: fromHexString(fields.pubkey),
      withdrawal_credentials: fromHexString(fields.withdrawalCredentials),
      amount: fields.amountGwei,
      signature: fromHexString(fields.signature),
    }),
  );

const depositInvalid = (
  index: number,
  issue: string,
  message: string,
): ObolError =>
  new ObolError(
    'DEPOSIT_INVALID',
    `Invalid deposit at index ${index}: ${message}`,
    {
      hint: 'Do not send; regenerate the deposit data or fix the target',
      details: { index, issue },
    },
  );

/** At most 2048 ETH for 0x02 credentials and top-ups, else 32 ETH. */
const checkMaximum = (
  amount: bigint,
  index: number,
  prefix: string,
  isTopUp: boolean,
): void => {
  const maximum =
    prefix === '0x02' || isTopUp ? MAX_COMPOUNDING_DEPOSIT : MAX_DEPOSIT;
  if (amount > maximum) {
    const target = isTopUp ? ' for a top-up' : ` for ${prefix} credentials`;
    throw depositInvalid(
      index,
      'amount_above_maximum',
      `amount exceeds ${maximum / ETH} ETH${target}`,
    );
  }
};

/**
 * With an expected withdrawal address, the credentials must be execution
 * credentials pointing at it (a top-up may leave them zero).
 */
const checkCredentialsTarget = (
  credentials: string,
  prefix: string,
  index: number,
  isTopUp: boolean,
  expectedWithdrawalAddress: string | undefined,
): void => {
  if (
    expectedWithdrawalAddress === undefined ||
    (isTopUp && credentials === ZERO_CREDENTIALS)
  ) {
    return;
  }
  if (
    prefix === '0x00' ||
    credentials.slice(-40) !== expectedWithdrawalAddress.toLowerCase().slice(2)
  ) {
    throw depositInvalid(
      index,
      'credentials_mismatch',
      `withdrawal credentials do not point at ${expectedWithdrawalAddress}`,
    );
  }
};

const checkDeposit = (
  deposit: Deposit,
  index: number,
  kind: DepositKind,
  expectedWithdrawalAddress: string | undefined,
): void => {
  const isTopUp = kind === 'topUp';
  if (!isTopUp && ZERO_SIGNATURE.test(deposit.signature)) {
    throw new ObolError(
      'DEPOSIT_LOOKS_LIKE_TOP_UP',
      `Deposit at index ${index} has an all-zero signature, as for a top-up to an existing validator`,
      {
        hint: "Pass kind: 'topUp' if the validator exists; a zero-signature deposit to a new validator is ignored by the beacon chain and the ETH is not recoverable",
        details: { index, issue: 'zero_signature' },
      },
    );
  }

  const { amount } = deposit;
  if (amount % GWEI !== 0n) {
    throw depositInvalid(
      index,
      'amount_not_whole_gwei',
      'amount must be a whole number of gwei (amount is in wei)',
    );
  }
  if (amount < MIN_DEPOSIT) {
    throw depositInvalid(
      index,
      'amount_below_minimum',
      'amount must be at least 1 ETH (amount is in wei)',
    );
  }

  const credentials = deposit.withdrawalCredentials.toLowerCase();
  const prefix = credentials.slice(0, 4);
  if (prefix !== '0x00' && prefix !== '0x01' && prefix !== '0x02') {
    throw depositInvalid(
      index,
      'credentials_prefix_unknown',
      `unknown withdrawal credentials prefix ${prefix}`,
    );
  }
  if (prefix !== '0x00' && credentials.slice(4, 26) !== '0'.repeat(22)) {
    throw depositInvalid(
      index,
      'credentials_malformed',
      'execution withdrawal credentials must have 11 zero bytes after the prefix',
    );
  }

  checkMaximum(amount, index, prefix, isTopUp);
  checkCredentialsTarget(
    credentials,
    prefix,
    index,
    isTopUp,
    expectedWithdrawalAddress,
  );

  const root = depositDataRoot({ ...deposit, amountGwei: amount / GWEI });
  if (root !== deposit.depositDataRoot.toLowerCase()) {
    throw depositInvalid(
      index,
      'root_mismatch',
      'depositDataRoot does not match the deposit fields',
    );
  }
};

const signatureItem = (
  bls: BlsBackend,
  deposit: Deposit,
  domain: Uint8Array,
): SignatureItem<unknown> => {
  let publicKey: unknown = null;
  try {
    publicKey = bls.decodePublicKey(fromHexString(deposit.pubkey), true);
  } catch {
    // Not a valid public key: the item is invalid.
  }
  return {
    publicKey,
    message: signingRoot(
      domain,
      computeDepositMsgRoot({
        pubkey: deposit.pubkey,
        withdrawal_credentials: deposit.withdrawalCredentials,
        amount: (deposit.amount / GWEI).toString(),
      }),
    ),
    signature: fromHexString(deposit.signature),
  };
};

/**
 * Checks deposits before ETH is sent, in order for each deposit, then the
 * signatures:
 *
 * 1. `kind: 'deposit'` with an all-zero signature: DEPOSIT_LOOKS_LIKE_TOP_UP;
 * 2. `amount` is whole gwei and at least 1 ETH;
 * 3. credentials prefix is `0x00`, `0x01` or `0x02`, and `0x01` / `0x02`
 *    have 11 zero bytes after it;
 * 4. `amount` is at most 2048 ETH for `0x02` credentials or a top-up, else
 *    32 ETH;
 * 5. with `expectedWithdrawalAddress`, the credentials are `0x01` / `0x02`
 *    for it (case-insensitive); a top-up may instead have all-zero
 *    credentials;
 * 6. `depositDataRoot` is the SSZ root of the deposit;
 * 7. for `kind: 'deposit'`, every BLS signature is valid in the deposit
 *    domain of the chain's genesis fork (randomised batches of 32, each
 *    signature must be valid on its own; the first invalid index is
 *    reported). The work yields to the event loop every `yieldMs`.
 *
 * With `options.signal`, an abort stops the signature checks at the next
 * yield point.
 *
 * @throws PAYLOAD_INVALID; ABORTED (`signal`); DEPOSIT_LOOKS_LIKE_TOP_UP (`index`);
 *   DEPOSIT_INVALID (`index`, `issue`); UNSUPPORTED_CHAIN when signatures
 *   must be checked on a chain without a known fork version.
 */
export const verifyDepositData = async (
  deposits: readonly DepositInput[],
  options: VerifyDepositDataOptions,
): Promise<void> => {
  const args = decode(VerifyDepositDataSchema, { deposits, options });
  const signal = options.signal;
  assertSignal(signal, 'options.signal');
  const kind = args.options.kind ?? 'deposit';
  const { chainId, expectedWithdrawalAddress } = args.options;
  args.deposits.forEach((deposit, index) => {
    checkDeposit(deposit as Deposit, index, kind, expectedWithdrawalAddress);
  });
  if (kind === 'topUp' || args.deposits.length === 0) return;

  const forkVersion = CHAINS[chainId]?.forkVersion;
  if (forkVersion === undefined) {
    throw new ObolError(
      'UNSUPPORTED_CHAIN',
      `Cannot verify deposit signatures on chain ${chainId}: unknown genesis fork version`,
      {
        hint: 'Use mainnet (1) or Hoodi (560048)',
        details: { chainId, operation: 'deposits.verifyDepositData' },
      },
    );
  }
  throwIfAborted(signal, 'deposits.verifyDepositData');
  const domain = depositDomainForFork(forkVersion);
  const bls = options.bls ?? nobleBls;
  const items = args.deposits.map(d =>
    signatureItem(bls, d as Deposit, domain),
  );
  const bad = await firstInvalidSignature(
    bls,
    items,
    createTick(
      args.options.yieldMs ?? 50,
      signal,
      'deposits.verifyDepositData',
    ),
  );
  if (bad === -1) return;
  throw depositInvalid(
    bad,
    'signature_invalid',
    `invalid deposit signature for chain ${chainId}`,
  );
};
