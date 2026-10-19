/**
 * deposits.fromLock: deposit data from a cluster lock, verified by default
 * (spec/operations.md "deposits.fromLock").
 */
import { Type } from '@sinclair/typebox';
import type { Hex, PublicClient } from 'viem';
import { CHAINS } from '../chains.js';
import { verifyLock } from '../cluster/verifyLock.js';
import { LockSchema, type ClusterLock } from '../cluster/schema.js';
import { ObolError } from '../errors.js';
import { decode, T } from '../schema.js';
import type { Deposit } from '../types.js';
import { GWEI, MAX_UINT64 } from '../units.js';
import { depositDataRoot } from './verifyDepositData.js';

export interface FromLockOptions {
  /** The deposit amount to return (wei). */
  amount?: bigint;
  /** Run `cluster.verifyLock` first (default true). */
  verify?: boolean;
  /** The chain the deposits are for; the lock's `fork_version` must match it. Set by the client. */
  chainId?: number;
  /** For contract-wallet definition signatures during verification. */
  publicClient?: PublicClient;
}

export interface LockDeposits {
  lockHash: Hex;
  /** Distinct amounts in the lock (wei), ascending. */
  amounts: bigint[];
  /** One deposit per validator that has it, in lock order, by amount (wei). */
  depositsByAmount: Map<bigint, Deposit[]>;
  /** One deposit per validator for `amount`, or for the lock's only amount. */
  deposits?: Deposit[];
}

const OptionsSchema = Type.Object({
  amount: Type.Optional(T.Wei),
  verify: Type.Optional(Type.Boolean()),
  chainId: Type.Optional(T.Uint),
});

const lockInvalid = (
  message: string,
  details: Record<string, unknown>,
): ObolError =>
  new ObolError('LOCK_INVALID', message, {
    hint: 'Do not deposit; report the lock',
    details,
  });

const HEX_FIELDS = [
  { key: 'pubkey', bytes: 48 },
  { key: 'withdrawal_credentials', bytes: 32 },
  { key: 'signature', bytes: 96 },
] as const;

type RawDeposit = NonNullable<
  ClusterLock['distributed_validators'][number]['deposit_data']
>;

const toDeposit = (
  raw: RawDeposit,
  distributedPublicKey: string,
  validatorIndex: number,
): Deposit => {
  const bad = (reason: string): never => {
    throw lockInvalid(
      `Invalid deposit data for validator ${validatorIndex}: ${reason}`,
      { issue: 'deposit_data_invalid', index: validatorIndex },
    );
  };
  const hex = (value: unknown, bytes: number, name: string): Hex => {
    if (typeof value !== 'string') return bad(`missing ${name}`);
    const prefixed = (
      value.startsWith('0x') ? value : `0x${value}`
    ).toLowerCase();
    if (!new RegExp(`^0x[0-9a-f]{${bytes * 2}}$`).test(prefixed)) {
      return bad(`malformed ${name}`);
    }
    return prefixed as Hex;
  };
  const [pubkey, withdrawalCredentials, signature] = HEX_FIELDS.map(f =>
    hex(raw[f.key], f.bytes, f.key),
  );
  if (pubkey !== distributedPublicKey.toLowerCase()) {
    bad('pubkey is not the distributed public key');
  }
  const amountText = String(raw.amount ?? '');
  if (!/^[0-9]+$/.test(amountText)) bad('missing or malformed amount');
  const amountGwei = BigInt(amountText);
  if (amountGwei === 0n || amountGwei > MAX_UINT64) bad('amount out of range');

  const root = depositDataRoot({
    pubkey,
    withdrawalCredentials,
    amountGwei,
    signature,
  });
  const stored = raw.deposit_data_root;
  if (stored !== undefined && stored !== '') {
    if (hex(stored, 32, 'deposit_data_root') !== root) {
      bad('deposit_data_root does not match the deposit fields');
    }
  }
  return {
    pubkey,
    withdrawalCredentials,
    signature,
    depositDataRoot: root,
    amount: amountGwei * GWEI,
  };
};

/**
 * Reads the deposit data of a cluster lock, as wei amounts ready for
 * `deposits.prepareDeposit`.
 *
 * Checks: the lock's `fork_version` is `chainId`'s (when given); with
 * `verify` (default), `cluster.verifyLock` passes; every validator has
 * `partial_deposit_data` (v1.8.0+) or `deposit_data`; each deposit has
 * well-formed pubkey, credentials and signature, a positive gwei amount,
 * the validator's group pubkey, and a `deposit_data_root` that matches
 * (computed when absent). A second deposit of one amount for a validator is
 * ignored. With `amount`, every validator must have a deposit of it.
 *
 * @throws PAYLOAD_INVALID; LOCK_INVALID (`step` from verifyLock, or `issue`
 *   `fork_version_mismatch`, `deposit_data_missing`, `deposit_data_invalid`);
 *   DEPOSIT_AMOUNT_NOT_IN_LOCK (`amount`, `available`);
 *   LOCK_VERIFICATION_TIMEOUT / LOCK_VERIFICATION_BUSY.
 */
export const fromLock = async (
  input: unknown,
  options: FromLockOptions = {},
): Promise<LockDeposits> => {
  const lock = decode(LockSchema, input, 'lock');
  const {
    amount,
    verify = true,
    chainId,
  } = decode(
    OptionsSchema,
    {
      ...(options.amount !== undefined ? { amount: options.amount } : {}),
      ...(options.verify !== undefined ? { verify: options.verify } : {}),
      ...(options.chainId !== undefined ? { chainId: options.chainId } : {}),
    },
    'options',
  );

  const forkVersion = lock.cluster_definition.fork_version.toLowerCase();
  if (chainId !== undefined && CHAINS[chainId]?.forkVersion !== forkVersion) {
    throw lockInvalid(
      `The lock's fork_version ${forkVersion} is not chain ${chainId}'s`,
      { issue: 'fork_version_mismatch' },
    );
  }

  if (verify) {
    const result = await verifyLock(lock, {
      ...(options.publicClient !== undefined
        ? { publicClient: options.publicClient }
        : {}),
    });
    if (!result.ok) {
      throw lockInvalid(
        `Cluster lock failed verification at ${result.step}${result.issue !== undefined ? ` (${result.issue})` : ''}`,
        { step: result.step, issue: result.issue },
      );
    }
  }

  const validators = lock.distributed_validators;
  if (validators.length === 0) {
    throw lockInvalid('The lock has no distributed validators', {
      issue: 'deposit_data_missing',
    });
  }
  const depositsByAmount = new Map<bigint, Deposit[]>();
  validators.forEach((validator, index) => {
    const raw =
      validator.partial_deposit_data !== undefined &&
      validator.partial_deposit_data !== null &&
      validator.partial_deposit_data.length > 0
        ? validator.partial_deposit_data
        : validator.deposit_data !== undefined
          ? [validator.deposit_data]
          : [];
    if (raw.length === 0) {
      throw lockInvalid(`Validator ${index} has no deposit data`, {
        issue: 'deposit_data_missing',
        index,
      });
    }
    const seen = new Set<bigint>();
    for (const data of raw) {
      const deposit = toDeposit(data, validator.distributed_public_key, index);
      if (seen.has(deposit.amount)) continue;
      seen.add(deposit.amount);
      const list = depositsByAmount.get(deposit.amount) ?? [];
      list.push(deposit);
      depositsByAmount.set(deposit.amount, list);
    }
  });

  const amounts = [...depositsByAmount.keys()].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  let deposits: Deposit[] | undefined;
  if (amount !== undefined) {
    deposits = depositsByAmount.get(amount);
    if (deposits === undefined || deposits.length !== validators.length) {
      throw new ObolError(
        'DEPOSIT_AMOUNT_NOT_IN_LOCK',
        `Not every validator in the lock has a deposit of ${amount} wei`,
        {
          hint: 'Pick one of the available amounts',
          details: {
            amount,
            available: amounts.filter(
              a => depositsByAmount.get(a)?.length === validators.length,
            ),
          },
        },
      );
    }
  } else if (amounts.length === 1) {
    deposits = depositsByAmount.get(amounts[0]);
  }

  return {
    lockHash: lock.lock_hash.toLowerCase() as Hex,
    amounts,
    depositsByAmount,
    ...(deposits !== undefined ? { deposits } : {}),
  };
};
