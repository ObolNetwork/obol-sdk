import { fromHexString } from '@chainsafe/ssz';
import { depositDataContainer } from '../verification/sszTypes.js';
import {
  type ClusterLock,
  type DepositData,
  type ValidatorDeposit,
} from '../types.js';

/** Options for {@link Client.getDepositData} and {@link depositDataFromLock}. */
export type GetDepositDataOptions = {
  /**
   * Run the full cluster lock validation (operator signatures, hashes, every
   * deposit signature) before returning deposit data. Defaults to `true`.
   * Validation is CPU-bound and can take seconds for locks with many
   * validators; only turn it off if the lock was already validated.
   */
  verify?: boolean;

  /**
   * Deposit amount to return, in wei. Required when the lock carries more
   * than one deposit amount per validator (see `amounts` in the result).
   */
  amount?: string;

  /** RPC URL used to verify Safe wallet signatures in the lock. */
  safeRpcUrl?: string;
};

/** Deposit data extracted from a cluster lock. */
export type LockDepositData = {
  /** Hash of the lock the deposits were read from. */
  lockHash: string;

  /** Distinct deposit amounts present in the lock, in wei, ascending. */
  amounts: string[];

  /**
   * Deposits grouped by amount (wei): one entry per validator that has a
   * deposit of that amount, in lock order.
   */
  depositsByAmount: Record<string, ValidatorDeposit[]>;

  /**
   * One deposit per validator for the requested `amount`, or for the lock's
   * only amount. `undefined` when the lock has several amounts and none was
   * requested; pick one from `amounts` / `depositsByAmount`.
   */
  deposits?: ValidatorDeposit[];
};

const WEI_PER_GWEI = BigInt(1_000_000_000);

const with0x = (value: string): string =>
  value.startsWith('0x') || value.startsWith('0X') ? value : `0x${value}`;

const HEX_FIELDS: Array<{
  key: 'pubkey' | 'withdrawal_credentials' | 'signature' | 'deposit_data_root';
  bytes: number;
  optional?: boolean;
}> = [
  { key: 'pubkey', bytes: 48 },
  { key: 'withdrawal_credentials', bytes: 32 },
  { key: 'signature', bytes: 96 },
  // Not every lock carries the root; it is recomputed from the other fields.
  { key: 'deposit_data_root', bytes: 32, optional: true },
];

const toValidatorDeposit = (
  data: Partial<DepositData>,
  distributedPublicKey: string,
  validatorIndex: number,
): ValidatorDeposit => {
  const fail = (reason: string): never => {
    throw new Error(
      `Invalid deposit data for validator ${validatorIndex} in lock: ${reason}`,
    );
  };

  const fields: Partial<Record<(typeof HEX_FIELDS)[number]['key'], string>> =
    {};
  for (const { key, bytes, optional } of HEX_FIELDS) {
    const raw = data[key];
    if (optional && (raw === undefined || raw === null || raw === '')) continue;
    if (typeof raw !== 'string') fail(`missing ${key}`);
    const value = with0x(raw as string).toLowerCase();
    if (!new RegExp(`^0x[0-9a-f]{${bytes * 2}}$`).test(value)) {
      fail(`malformed ${key}`);
    }
    fields[key] = value;
  }

  if (fields.pubkey !== distributedPublicKey.toLowerCase()) {
    fail('deposit pubkey does not match the distributed public key');
  }

  const amount = String(data.amount ?? '');
  if (
    !/^[0-9]+$/.test(amount) ||
    BigInt(amount) === BigInt(0) ||
    !Number.isSafeInteger(Number(amount))
  ) {
    fail('missing or malformed amount');
  }

  const depositDataRoot =
    '0x' +
    Buffer.from(
      depositDataContainer.hashTreeRoot({
        pubkey: fromHexString(fields.pubkey as string),
        withdrawal_credentials: fromHexString(
          fields.withdrawal_credentials as string,
        ),
        amount: Number(amount),
        signature: fromHexString(fields.signature as string),
      }),
    ).toString('hex');
  if (
    fields.deposit_data_root !== undefined &&
    fields.deposit_data_root !== depositDataRoot
  ) {
    fail('deposit_data_root does not match the deposit fields');
  }

  return {
    pubkey: fields.pubkey as string,
    withdrawal_credentials: fields.withdrawal_credentials as string,
    signature: fields.signature as string,
    deposit_data_root: depositDataRoot,
    // Locks store amounts in gwei; the deposit payloads take wei.
    amount: (BigInt(amount) * WEI_PER_GWEI).toString(),
  };
};

/**
 * Extracts deposit payloads from a cluster lock without fetching or
 * validating it (see {@link Client.getDepositData} for the validated path).
 *
 * Reads `partial_deposit_data` (lock v1.8.0+, possibly several amounts per
 * validator) and falls back to the single `deposit_data` of older locks.
 * Amounts are converted from gwei (lock format) to wei (payload format) and
 * hex fields are 0x-prefixed (`deposit_data_root` is computed when the lock
 * omits it, and checked against the other fields when present), so the result can be passed to
 * `client.eoa.deposit({ deposits })` or `client.splits.deposit(...)` as is.
 *
 * @throws Error if a validator has no deposit data, a field is missing or
 *   malformed, a `deposit_data_root` does not match, a deposit pubkey differs from the validator's distributed
 *   public key, or `amount` is given and some validator has no deposit of
 *   that amount.
 */
export const depositDataFromLock = (
  lock: ClusterLock,
  { amount }: Pick<GetDepositDataOptions, 'amount'> = {},
): LockDepositData => {
  const depositsByAmount: Record<string, ValidatorDeposit[]> = {};
  const validators = lock.distributed_validators ?? [];
  if (validators.length === 0) {
    throw new Error('Cluster lock has no distributed validators');
  }

  validators.forEach((validator, index) => {
    const raw =
      validator.partial_deposit_data &&
      validator.partial_deposit_data.length > 0
        ? validator.partial_deposit_data
        : validator.deposit_data
          ? [validator.deposit_data]
          : [];
    if (raw.length === 0) {
      throw new Error(
        `Invalid deposit data for validator ${index} in lock: no deposit data`,
      );
    }

    const seen = new Set<string>();
    for (const data of raw) {
      const deposit = toValidatorDeposit(
        data,
        validator.distributed_public_key,
        index,
      );
      // A lock should not carry two deposits of one amount for a validator;
      // keep the first so each amount maps to one deposit per validator.
      if (seen.has(deposit.amount)) continue;
      seen.add(deposit.amount);
      (depositsByAmount[deposit.amount] ??= []).push(deposit);
    }
  });

  const amounts = Object.keys(depositsByAmount).sort((a, b) =>
    BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0,
  );

  let deposits: ValidatorDeposit[] | undefined;
  if (amount !== undefined) {
    if (!/^[0-9]+$/.test(amount)) {
      throw new Error('amount must be a whole number of wei');
    }
    const normalized = BigInt(amount).toString();
    deposits = depositsByAmount[normalized];
    if (!deposits || deposits.length !== validators.length) {
      throw new Error(
        `Not every validator in the lock has a deposit of ${normalized} wei; available amounts: ${amounts.join(', ')}`,
      );
    }
  } else if (amounts.length === 1) {
    // Every validator has at least one deposit, so all have this amount.
    deposits = depositsByAmount[amounts[0]];
  }

  return { lockHash: lock.lock_hash, amounts, depositsByAmount, deposits };
};
