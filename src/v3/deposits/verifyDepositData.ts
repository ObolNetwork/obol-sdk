/**
 * deposits.verifyDepositData: the pure deposit checks run before ETH is sent
 * to a deposit contract (spec/operations.md, vectors deposit_checks.json).
 */
import { fromHexString } from '@chainsafe/ssz';
import { Type } from '@sinclair/typebox';
import { bytesToHex, type Hex } from 'viem';
import { blsVerify } from '../../blsUtils.js';
import type { BlsSignatureCheck } from '../../types.js';
import {
  computeDepositMsgRoot,
  depositDomainForFork,
  signingRoot,
} from '../../verification/common.js';
import { verifyBlsChecksParallel } from '../../verification/parallelPool.js';
import { depositDataContainer } from '../../verification/sszTypes.js';
import { CHAINS } from '../chains.js';
import { ObolError } from '../errors.js';
import { decode, T } from '../schema.js';
import type { Deposit, DepositKind } from '../types.js';
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

const VerifyDepositDataSchema = Type.Object({
  deposits: Type.Array(DepositSchema),
  options: Type.Object({
    chainId: T.Uint,
    kind: Type.Optional(
      Type.Union([Type.Literal('deposit'), Type.Literal('topUp')]),
    ),
    expectedWithdrawalAddress: Type.Optional(T.Address),
  }),
});

export interface VerifyDepositDataOptions {
  chainId: number;
  kind?: DepositKind;
  expectedWithdrawalAddress?: string;
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

  const maximum =
    prefix === '0x02' || isTopUp ? MAX_COMPOUNDING_DEPOSIT : MAX_DEPOSIT;
  if (amount > maximum) {
    throw depositInvalid(
      index,
      'amount_above_maximum',
      `amount exceeds ${maximum / ETH} ETH${isTopUp ? ' for a top-up' : ` for ${prefix} credentials`}`,
    );
  }

  if (
    expectedWithdrawalAddress !== undefined &&
    !(isTopUp && credentials === ZERO_CREDENTIALS)
  ) {
    if (
      prefix === '0x00' ||
      credentials.slice(-40) !==
        expectedWithdrawalAddress.toLowerCase().slice(2)
    ) {
      throw depositInvalid(
        index,
        'credentials_mismatch',
        `withdrawal credentials do not point at ${expectedWithdrawalAddress}`,
      );
    }
  }

  const root = depositDataRoot({ ...deposit, amountGwei: amount / GWEI });
  if (root !== deposit.depositDataRoot.toLowerCase()) {
    throw depositInvalid(
      index,
      'root_mismatch',
      'depositDataRoot does not match the deposit fields',
    );
  }
};

const signatureCheck = (
  deposit: Deposit,
  domain: Uint8Array,
): BlsSignatureCheck => ({
  pubkey: fromHexString(deposit.pubkey),
  message: signingRoot(
    domain,
    computeDepositMsgRoot({
      pubkey: deposit.pubkey,
      withdrawal_credentials: deposit.withdrawalCredentials,
      amount: (deposit.amount / GWEI).toString(),
    }),
  ),
  signature: fromHexString(deposit.signature),
});

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
 *    domain of the chain's genesis fork (batch-verified; the first invalid
 *    index is reported).
 *
 * @throws PAYLOAD_INVALID; DEPOSIT_LOOKS_LIKE_TOP_UP (`index`);
 *   DEPOSIT_INVALID (`index`, `issue`); UNSUPPORTED_CHAIN when signatures
 *   must be checked on a chain without a known fork version.
 */
export const verifyDepositData = async (
  deposits: Deposit[],
  options: VerifyDepositDataOptions,
): Promise<void> => {
  const args = decode(VerifyDepositDataSchema, { deposits, options });
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
  const domain = depositDomainForFork(forkVersion);
  const checks = args.deposits.map(d => signatureCheck(d as Deposit, domain));
  let valid = false;
  try {
    valid = await verifyBlsChecksParallel(checks);
  } catch {
    // A signature or pubkey that is not a curve point: found below.
  }
  if (valid) return;
  const bad = checks.findIndex(
    c => !blsVerify(c.pubkey, c.message, c.signature),
  );
  throw depositInvalid(
    bad === -1 ? 0 : bad,
    'signature_invalid',
    `invalid deposit signature for chain ${chainId}`,
  );
};
