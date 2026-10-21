/**
 * deposits.fromLock: deposit data from a cluster lock, verified by default
 * (spec/operations.md "deposits.fromLock").
 */
import { Type } from '@sinclair/typebox';
import type { Hex, PublicClient } from 'viem';
import { CHAINS } from '../chains.js';
import type { BlsBackend } from '../cluster/blsBackend.js';
import { verifyLock } from '../cluster/verifyLock.js';
import { LockSchema, type ClusterLock } from '../cluster/schema.js';
import { ObolError } from '../errors.js';
import { decode, invalid, T } from '../schema.js';
import type { Deposit } from '../types.js';
import { GWEI, MAX_UINT64 } from '../units.js';
import { depositDataRoot } from './verifyDepositData.js';

export interface FromLockOptions {
  /** The deposit amount to return (wei). */
  amount?: bigint;
  /**
   * How to run `cluster.verifyLock` first: `true` / `'attested'` (default)
   * checks the lock at level `attested` plus the BLS signatures of the
   * returned validators; `'full'` runs every check; `false` none.
   */
  verify?: boolean | 'attested' | 'full';
  /**
   * Only these validators, by index in the lock or by group pubkey (default
   * all). Results stay in lock order.
   */
  validators?: Array<number | string>;
  /** The chain the deposits are for; the lock's `fork_version` must match it. Set by the client. */
  chainId?: number;
  /** For contract-wallet definition signatures during verification. */
  publicClient?: PublicClient;
  /** Passed to `cluster.verifyLock`. */
  yieldMs?: number;
  /** Passed to `cluster.verifyLock`. */
  bls?: BlsBackend;
}

export interface LockDeposits {
  lockHash: Hex;
  /** Indexes in the lock of the validators returned, ascending. */
  validators: number[];
  /** Distinct amounts in the lock (wei), ascending. */
  amounts: bigint[];
  /** One deposit per returned validator that has it, in lock order, by amount (wei). */
  depositsByAmount: Map<bigint, Deposit[]>;
  /** One deposit per returned validator for `amount`, or for the only amount. */
  deposits?: Deposit[];
}

export const FromLockOptionsSchema = Type.Object({
  amount: Type.Optional(T.Wei),
  verify: Type.Optional(
    Type.Union([
      Type.Boolean(),
      Type.Literal('attested'),
      Type.Literal('full'),
    ]),
  ),
  validators: Type.Optional(
    Type.Array(Type.Union([T.Uint, T.Pubkey]), { minItems: 1 }),
  ),
  chainId: Type.Optional(T.Uint),
  yieldMs: Type.Optional(T.Uint),
});

/** Indexes of the requested validators, ascending and distinct. */
const selectValidators = (
  lock: ClusterLock,
  requested: Array<number | string> | undefined,
): number[] => {
  const count = lock.distributed_validators.length;
  if (requested === undefined) return [...Array(count).keys()];
  const byKey = new Map(
    lock.distributed_validators.map((v, i) => [
      v.distributed_public_key.toLowerCase(),
      i,
    ]),
  );
  const indexes = requested.map((entry, i) => {
    const index =
      typeof entry === 'number' ? entry : byKey.get(entry.toLowerCase());
    if (index === undefined || index >= count) {
      throw invalid(
        `options.validators[${i}]`,
        'is not a validator of the lock',
        'not_in_lock',
      );
    }
    return index;
  });
  return [...new Set(indexes)].sort((a, b) => a - b);
};

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
 * Checks: the lock's `fork_version` is `chainId`'s (when given);
 * `cluster.verifyLock` passes (by default at level `attested` with the BLS
 * signatures (deposits and builder registration) of the returned
 * validators: for a 10k-validator lock about 2 s plus about 25 ms per
 * signature with the default backend; `verify: 'full'` for every check); every returned validator has `partial_deposit_data`
 * (v1.8.0+) or `deposit_data`; each deposit has well-formed pubkey,
 * credentials and signature, a positive gwei amount, the validator's group
 * pubkey, and a `deposit_data_root` that matches (computed when absent). A
 * second deposit of one amount for a validator is ignored. With `amount`,
 * every returned validator must have a deposit of it.
 *
 * @throws PAYLOAD_INVALID (also `options.validators` not in the lock, issue
 *   `not_in_lock`); LOCK_INVALID (`step` and `index` from verifyLock, or
 *   `issue` `fork_version_mismatch`, `deposit_data_missing`,
 *   `deposit_data_invalid`); DEPOSIT_AMOUNT_NOT_IN_LOCK (`amount`,
 *   `available`).
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
    validators: requested,
    yieldMs,
  } = decode(
    FromLockOptionsSchema,
    {
      ...(options.amount !== undefined ? { amount: options.amount } : {}),
      ...(options.verify !== undefined ? { verify: options.verify } : {}),
      ...(options.chainId !== undefined ? { chainId: options.chainId } : {}),
      ...(options.validators !== undefined
        ? { validators: options.validators }
        : {}),
      ...(options.yieldMs !== undefined ? { yieldMs: options.yieldMs } : {}),
    },
    'options',
  );
  const selected = selectValidators(lock, requested);

  const forkVersion = lock.cluster_definition.fork_version.toLowerCase();
  if (chainId !== undefined && CHAINS[chainId]?.forkVersion !== forkVersion) {
    throw lockInvalid(
      `The lock's fork_version ${forkVersion} is not chain ${chainId}'s`,
      { issue: 'fork_version_mismatch' },
    );
  }

  if (verify !== false) {
    const level = verify === 'full' ? 'full' : 'attested';
    const result = await verifyLock(lock, {
      level,
      ...(level === 'attested' ? { signatures: selected } : {}),
      ...(options.publicClient !== undefined
        ? { publicClient: options.publicClient }
        : {}),
      ...(yieldMs !== undefined ? { yieldMs } : {}),
      ...(options.bls !== undefined ? { bls: options.bls } : {}),
    });
    if (!result.ok) {
      throw lockInvalid(
        `Cluster lock failed verification at ${result.step}${result.issue !== undefined ? ` (${result.issue})` : ''}`,
        {
          step: result.step,
          issue: result.issue,
          ...(result.validator !== undefined
            ? { index: result.validator }
            : {}),
        },
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
  for (const index of selected) {
    const validator = validators[index];
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
  }

  const amounts = [...depositsByAmount.keys()].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  let deposits: Deposit[] | undefined;
  if (amount !== undefined) {
    deposits = depositsByAmount.get(amount);
    if (deposits === undefined || deposits.length !== selected.length) {
      throw new ObolError(
        'DEPOSIT_AMOUNT_NOT_IN_LOCK',
        `Not every requested validator in the lock has a deposit of ${amount} wei`,
        {
          hint: 'Pick one of the available amounts',
          details: {
            amount,
            available: amounts.filter(
              a => depositsByAmount.get(a)?.length === selected.length,
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
    validators: selected,
    amounts,
    depositsByAmount,
    ...(deposits !== undefined ? { deposits } : {}),
  };
};
