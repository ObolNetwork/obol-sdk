import { fromHexString } from '@chainsafe/ssz';
import {
  FORK_MAPPING,
  type BlsSignatureCheck,
  type DepositKind,
  type ValidatorDeposit,
} from '../types.js';
import { blsVerify } from '../blsUtils.js';
import { ObolSdkError } from '../errors.js';
import {
  computeDepositMsgRoot,
  depositDomainForFork,
  signingRoot,
} from './common.js';
import { depositDataContainer } from './sszTypes.js';
import { verifyBlsChecksParallel } from './parallelPool.js';

export type VerifyDepositPayloadOptions = {
  /** Chain the deposits are sent on; selects the genesis fork version for the signing domain. */
  chainId: number;
  /** When set, withdrawal credentials must be 0x01/0x02 credentials for this address. */
  expectedWithdrawalAddress?: string;
  /**
   * `'topUp'`: the caller asserts every deposit is a top-up to an existing
   * validator, so the BLS signature is not checked, withdrawal credentials
   * may be all zero instead of pointing at `expectedWithdrawalAddress`, and
   * the amount may be up to 2048 ETH (the validator's credential type is not
   * known here). Defaults to `'deposit'`.
   */
  kind?: DepositKind;
};

const WEI_PER_GWEI = BigInt(1_000_000_000);
// The deposit contract rejects deposits below 1 ETH.
export const MIN_DEPOSIT_WEI = BigInt(1) * WEI_PER_GWEI * WEI_PER_GWEI;
// MAX_EFFECTIVE_BALANCE for 0x00 / 0x01 credentials.
export const MAX_DEPOSIT_WEI = BigInt(32) * WEI_PER_GWEI * WEI_PER_GWEI;
// MAX_EFFECTIVE_BALANCE_ELECTRA for 0x02 (compounding) credentials.
export const MAX_COMPOUNDING_DEPOSIT_WEI =
  BigInt(2048) * WEI_PER_GWEI * WEI_PER_GWEI;

const ETH1_CREDENTIAL_PADDING = '0'.repeat(22);
const ZERO_CREDENTIALS = `0x${'0'.repeat(64)}`;
const ZERO_SIGNATURE = /^0x0{192}$/i;

const fail = (index: number, reason: string): never => {
  throw new Error(`Invalid deposit at index ${index}: ${reason}`);
};

// SSZ zero-pads short byte vectors and ignores bytes past the end, so a
// wrong-length field can still match the root and signature of a valid one.
const hexOfBytes = (bytes: number): RegExp =>
  new RegExp(`^0x[0-9a-f]{${bytes * 2}}$`, 'i');
const HEX_FIELDS = [
  { key: 'pubkey', bytes: 48, pattern: hexOfBytes(48) },
  { key: 'withdrawal_credentials', bytes: 32, pattern: hexOfBytes(32) },
  { key: 'signature', bytes: 96, pattern: hexOfBytes(96) },
  { key: 'deposit_data_root', bytes: 32, pattern: hexOfBytes(32) },
] as const;

/**
 * Checks deposit data before ETH is sent to a deposit contract:
 * - `pubkey`, `withdrawal_credentials`, `signature` and `deposit_data_root`
 *   are 0x-prefixed hex of exactly 48, 32, 96 and 32 bytes;
 * - `amount` (wei) is a whole number of gwei, at least 1 ETH, and at most
 *   32 ETH (0x00 / 0x01 credentials) or 2048 ETH (0x02 credentials, and
 *   any top-up);
 * - withdrawal credentials have a known prefix and, if
 *   `expectedWithdrawalAddress` is given, point at that address (top-ups may
 *   instead use all-zero credentials);
 * - `deposit_data_root` matches the recomputed SSZ root of the deposit;
 * - the BLS signature is valid for the chain's deposit domain, unless
 *   `kind` is `'topUp'`.
 *
 * For `kind: 'deposit'` (the default), an all-zero signature (as used for
 * top-ups) is refused with an {@link ObolSdkError} coded
 * `DEPOSIT_LOOKS_LIKE_TOP_UP`.
 *
 * @throws Error naming the first invalid deposit.
 */
export const verifyDepositPayloads = async (
  deposits: ValidatorDeposit[],
  {
    chainId,
    expectedWithdrawalAddress,
    kind = 'deposit',
  }: VerifyDepositPayloadOptions,
): Promise<void> => {
  const isTopUp = kind === 'topUp';
  const forkVersion = FORK_MAPPING[chainId] as string | undefined;
  if (!isTopUp && !forkVersion) {
    throw new Error(
      `Cannot verify deposit signatures on chain ${chainId}: unknown fork version`,
    );
  }
  const depositDomain = forkVersion
    ? depositDomainForFork(forkVersion)
    : undefined;

  const checks: BlsSignatureCheck[] = [];
  // Deposit index of each entry in `checks`.
  const checkIndexes: number[] = [];

  deposits.forEach((deposit, index) => {
    for (const { key, bytes, pattern } of HEX_FIELDS) {
      const value: unknown = deposit[key];
      if (typeof value !== 'string' || !pattern.test(value)) {
        fail(index, `${key} must be ${bytes} bytes (0x + ${bytes * 2} hex)`);
      }
    }

    if (!isTopUp && ZERO_SIGNATURE.test(deposit.signature)) {
      throw new ObolSdkError(
        `Invalid deposit at index ${index}: the signature is all zero, as for a top-up to an existing validator`,
        'DEPOSIT_LOOKS_LIKE_TOP_UP',
        "Pass kind: 'topUp' for top-ups to existing validators; a zero-signature deposit to a new validator is rejected by the beacon chain and the ETH is not recoverable.",
      );
    }
    const amountWei = BigInt(deposit.amount);
    if (amountWei % WEI_PER_GWEI !== BigInt(0)) {
      fail(index, 'amount must be a whole number of gwei (amount is in wei)');
    }
    if (amountWei < MIN_DEPOSIT_WEI) {
      fail(index, 'amount must be at least 1 ETH (amount is in wei)');
    }

    const credentials = deposit.withdrawal_credentials.toLowerCase();
    const prefix = credentials.slice(0, 4);
    if (prefix !== '0x00' && prefix !== '0x01' && prefix !== '0x02') {
      fail(index, `unsupported withdrawal credentials prefix ${prefix}`);
    }
    if (
      prefix !== '0x00' &&
      credentials.slice(4, 4 + ETH1_CREDENTIAL_PADDING.length) !==
        ETH1_CREDENTIAL_PADDING
    ) {
      fail(index, 'malformed execution withdrawal credentials');
    }

    // A top-up is credited to the existing validator, whose credential type
    // is not known here, so allow up to the compounding maximum.
    const limitPrefix = isTopUp ? '0x02' : prefix;
    const maxAmount =
      limitPrefix === '0x02' ? MAX_COMPOUNDING_DEPOSIT_WEI : MAX_DEPOSIT_WEI;
    if (amountWei > maxAmount) {
      fail(
        index,
        isTopUp
          ? 'amount exceeds 2048 ETH, the maximum for a top-up'
          : `amount exceeds ${limitPrefix === '0x02' ? 2048 : 32} ETH for ${prefix} withdrawal credentials`,
      );
    }

    if (
      expectedWithdrawalAddress &&
      !(isTopUp && credentials === ZERO_CREDENTIALS)
    ) {
      const address = credentials.slice(-40);
      if (
        prefix === '0x00' ||
        address !== expectedWithdrawalAddress.toLowerCase().slice(2)
      ) {
        fail(
          index,
          `withdrawal credentials do not point at ${expectedWithdrawalAddress}`,
        );
      }
    }

    const amountGwei = (amountWei / WEI_PER_GWEI).toString();
    const depositDataRoot = depositDataContainer.hashTreeRoot({
      pubkey: fromHexString(deposit.pubkey),
      withdrawal_credentials: fromHexString(deposit.withdrawal_credentials),
      amount: amountWei / WEI_PER_GWEI,
      signature: fromHexString(deposit.signature),
    });
    if (
      Buffer.from(depositDataRoot).toString('hex') !==
      deposit.deposit_data_root.toLowerCase().slice(2)
    ) {
      fail(index, 'deposit_data_root does not match the deposit fields');
    }

    if (!isTopUp && depositDomain) {
      checkIndexes.push(index);
      checks.push({
        pubkey: fromHexString(deposit.pubkey),
        message: signingRoot(
          depositDomain,
          computeDepositMsgRoot({
            pubkey: deposit.pubkey,
            withdrawal_credentials: deposit.withdrawal_credentials,
            amount: amountGwei,
          }),
        ),
        signature: fromHexString(deposit.signature),
      });
    }
  });

  if (checks.length === 0) {
    return;
  }
  let batchValid = false;
  try {
    batchValid = await verifyBlsChecksParallel(checks);
  } catch {
    // Malformed signature or pubkey (not a curve point): found below.
  }
  if (batchValid) {
    return;
  }

  // The batch check failed: find the first invalid signature to report it.
  const badIndex = checks.findIndex(check => {
    try {
      return !blsVerify(check.pubkey, check.message, check.signature);
    } catch {
      return true;
    }
  });
  fail(
    badIndex === -1 ? checkIndexes[0] : checkIndexes[badIndex],
    `invalid deposit signature for chain ${chainId}`,
  );
};
