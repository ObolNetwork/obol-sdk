import { fromHexString } from '@chainsafe/ssz';
import {
  FORK_MAPPING,
  type BlsSignatureCheck,
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
   * The caller asserts every deposit is a top-up to an existing validator:
   * the BLS signature is not checked, withdrawal credentials may be all zero
   * instead of pointing at `expectedWithdrawalAddress`, and the amount may be
   * up to 2048 ETH (the validator's credential type is not known here).
   */
  skipSignatureVerification?: boolean;
  /**
   * Indexes (into `deposits`) of top-ups to validators that already exist.
   * Their BLS signature is not checked, and their withdrawal credentials may
   * be all zero instead of pointing at `expectedWithdrawalAddress`. The other
   * checks still apply.
   *
   * As a map, the values are the existing validators' withdrawal credentials
   * (from the beacon node): the maximum amount of those top-ups then follows
   * the validator's credentials (2048 ETH for 0x02, else 32 ETH) instead of
   * the deposit's own, which do not apply to a top-up.
   */
  topUps?: ReadonlySet<number> | ReadonlyMap<number, string>;
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

/**
 * Checks deposit data before ETH is sent to a deposit contract:
 * - `amount` (wei) is a whole number of gwei, at least 1 ETH, and at most
 *   32 ETH (0x00 / 0x01 credentials) or 2048 ETH (0x02 credentials); for
 *   top-ups with known validator credentials, the validator's credentials
 *   decide the limit;
 * - withdrawal credentials have a known prefix and, if
 *   `expectedWithdrawalAddress` is given, point at that address (top-ups
 *   listed in `topUps` may instead use all-zero credentials);
 * - `deposit_data_root` matches the recomputed SSZ root of the deposit;
 * - the BLS signature is valid for the chain's deposit domain, unless
 *   `skipSignatureVerification` is set or the deposit is in `topUps`.
 *
 * With `skipSignatureVerification`, every deposit is treated as a top-up
 * (see {@link VerifyDepositPayloadOptions}). Without it and without `topUps`,
 * an all-zero signature (as used for top-ups) is refused with an
 * {@link ObolSdkError} coded `DEPOSIT_LOOKS_LIKE_TOP_UP`.
 *
 * @throws Error naming the first invalid deposit.
 */
export const verifyDepositPayloads = async (
  deposits: ValidatorDeposit[],
  {
    chainId,
    expectedWithdrawalAddress,
    skipSignatureVerification,
    topUps,
  }: VerifyDepositPayloadOptions,
): Promise<void> => {
  const forkVersion = FORK_MAPPING[chainId] as string | undefined;
  if (!skipSignatureVerification && !forkVersion) {
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
    if (
      !skipSignatureVerification &&
      topUps === undefined &&
      ZERO_SIGNATURE.test(deposit.signature)
    ) {
      throw new ObolSdkError(
        `Invalid deposit at index ${index}: the signature is all zero, as for a top-up to an existing validator`,
        'DEPOSIT_LOOKS_LIKE_TOP_UP',
        'Pass skipSignatureVerification: true for top-ups to existing validators, or beaconUrl to have the SDK check; a zero-signature deposit to a new validator is rejected by the beacon chain and the ETH is not recoverable.',
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

    const isTopUp =
      skipSignatureVerification === true || topUps?.has(index) === true;
    // A top-up is credited to the existing validator, so its credentials set
    // the maximum effective balance. Without them (caller-asserted top-ups),
    // allow up to the compounding maximum.
    const validatorCredentials =
      topUps instanceof Map && topUps.has(index)
        ? topUps.get(index)
        : undefined;
    const limitPrefix = validatorCredentials
      ? validatorCredentials.toLowerCase().slice(0, 4)
      : skipSignatureVerification === true
        ? '0x02'
        : prefix;
    const maxAmount =
      limitPrefix === '0x02' ? MAX_COMPOUNDING_DEPOSIT_WEI : MAX_DEPOSIT_WEI;
    if (amountWei > maxAmount) {
      fail(
        index,
        validatorCredentials
          ? `amount exceeds ${limitPrefix === '0x02' ? 2048 : 32} ETH for a top-up to a validator with ${limitPrefix} withdrawal credentials`
          : skipSignatureVerification === true
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
      amount: Number(amountGwei),
      signature: fromHexString(deposit.signature),
    });
    if (
      Buffer.from(depositDataRoot).toString('hex') !==
      deposit.deposit_data_root.toLowerCase().slice(2)
    ) {
      fail(index, 'deposit_data_root does not match the deposit fields');
    }

    if (!skipSignatureVerification && !isTopUp && depositDomain) {
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
