/**
 * deposits.fromLock: deposit data from a cluster lock, verified by default
 * (spec/operations.md "deposits.fromLock").
 */
import { Type } from '@sinclair/typebox';
import type { Hex, PublicClient } from 'viem';
import { CHAINS } from '../chains.js';
import type { BlsBackend } from '../cluster/blsBackend.js';
import type { PublicClients } from '../cluster/eip712.js';
import { verifyLock } from '../cluster/verifyLock.js';
import { LockSchema, type ClusterLock } from '../cluster/schema.js';
import { ObolError } from '../errors.js';
import { decode, invalid, rejectUnknownKeys, T } from '../schema.js';
import type { Deposit } from '../types.js';
import { GWEI, MAX_UINT64 } from '../units.js';
import { depositDataRoot } from './assertDepositData.js';

export interface FromLockOptions {
  /**
   * The deposit amount to return (wei). Required when the lock holds
   * deposit data for more than one amount (Charon's default is 1 ETH and
   * 32 ETH per validator): the SDK never picks one, since each choice sends
   * a different amount of ETH. Without it such a lock throws
   * DEPOSIT_AMOUNT_REQUIRED, whose `details.available` lists the amounts.
   */
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
  /** For contract-wallet definition signatures during verification (on the lock's chain). */
  publicClient?: PublicClient;
  /** Passed to `cluster.verifyLock`: clients by chain id for contract-wallet definition signatures. */
  publicClients?: PublicClients;
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
  /**
   * One deposit per returned validator, all of the same amount: `amount`
   * when given, else the lock's only amount. Always present.
   */
  deposits: Deposit[];
}

export const FromLockOptionsSchema = Type.Object(
  {
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
  },
  {
    additionalProperties: false,
    description:
      'The options a schema can describe. The options object also takes publicClient, publicClients and bls; any other key is PAYLOAD_INVALID.',
  },
);

/** Every key of `FromLockOptions`; any other key is PAYLOAD_INVALID. */
const FROM_LOCK_OPTION_KEYS = [
  'amount',
  'verify',
  'validators',
  'chainId',
  'publicClient',
  'publicClients',
  'yieldMs',
  'bls',
] as const;

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

type DecodedFromLockOptions = Omit<
  FromLockOptions,
  'publicClient' | 'publicClients' | 'bls'
>;

/** The options `FromLockOptionsSchema` checks, without the clients and backend. */
const decodeOptions = (options: FromLockOptions): DecodedFromLockOptions => {
  rejectUnknownKeys(options, FROM_LOCK_OPTION_KEYS, 'options');
  return decode(
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
};

/** The lock's `fork_version` must be `chainId`'s (when given). */
const checkForkVersion = (
  lock: ClusterLock,
  chainId: number | undefined,
): void => {
  const forkVersion = lock.cluster_definition.fork_version.toLowerCase();
  if (chainId !== undefined && CHAINS[chainId]?.forkVersion !== forkVersion) {
    throw lockInvalid(
      `The lock's fork_version ${forkVersion} is not chain ${chainId}'s`,
      { issue: 'fork_version_mismatch' },
    );
  }
};

/** Runs `cluster.verifyLock` as `verify` asks; throws LOCK_INVALID on failure. */
const verifyForDeposits = async (
  lock: ClusterLock,
  selected: number[],
  verify: 'attested' | 'full' | true,
  options: FromLockOptions,
  yieldMs: number | undefined,
): Promise<void> => {
  const level = verify === 'full' ? 'full' : 'attested';
  const result = await verifyLock(lock, {
    level,
    ...(level === 'attested' ? { signatures: selected } : {}),
    ...(options.publicClient !== undefined
      ? { publicClient: options.publicClient }
      : {}),
    ...(options.publicClients !== undefined
      ? { publicClients: options.publicClients }
      : {}),
    ...(yieldMs !== undefined ? { yieldMs } : {}),
    ...(options.bls !== undefined ? { bls: options.bls } : {}),
  });
  if (!result.ok) {
    const issue = result.issue !== undefined ? ` (${result.issue})` : '';
    throw lockInvalid(
      `Cluster lock failed verification at ${result.step}${issue}`,
      {
        step: result.step,
        issue: result.issue,
        ...(result.validator !== undefined ? { index: result.validator } : {}),
      },
    );
  }
};

type LockValidator = ClusterLock['distributed_validators'][number];

/**
 * The deposit data the lock hash covers, and nothing else: `deposit_data`
 * for a v1.6.0 / v1.7.0 lock, `partial_deposit_data` from v1.8.0. The other
 * field is not signed by the DKG for that version and is never returned: a
 * legacy lock that carries `partial_deposit_data` entries is refused
 * (`partial_deposit_data_unexpected`, as `cluster.verifyLock` does), and a
 * v1.8.0+ lock's `deposit_data` is ignored.
 */
const rawDepositData = (
  validator: LockValidator,
  legacyLayout: boolean,
  index: number,
): RawDeposit[] => {
  const partial = validator.partial_deposit_data;
  const hasPartial =
    partial !== undefined && partial !== null && partial.length > 0;
  if (legacyLayout) {
    if (hasPartial) {
      throw lockInvalid(
        `Validator ${index} of a pre-v1.8.0 lock has partial_deposit_data, which that lock's hash does not cover`,
        { issue: 'partial_deposit_data_unexpected', index },
      );
    }
    return validator.deposit_data !== undefined ? [validator.deposit_data] : [];
  }
  return hasPartial ? partial : [];
};

/** Locks before v1.8.0 keep one `deposit_data` per validator. */
const isLegacyLayout = (lock: ClusterLock): boolean =>
  ['v1.6.0', 'v1.7.0'].includes(lock.cluster_definition.version);

/** The selected validators' deposits by amount (wei), in lock order. */
const collectDeposits = (
  validators: LockValidator[],
  selected: number[],
  legacyLayout: boolean,
): Map<bigint, Deposit[]> => {
  const depositsByAmount = new Map<bigint, Deposit[]>();
  for (const index of selected) {
    const validator = validators[index];
    const raw = rawDepositData(validator, legacyLayout, index);
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
  return depositsByAmount;
};

const compareBigints = (a: bigint, b: bigint): number => {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};

/**
 * One deposit per selected validator for `amount` (throws
 * DEPOSIT_AMOUNT_NOT_IN_LOCK if not every one has it). Without `amount`:
 * the lock's only amount, or DEPOSIT_AMOUNT_REQUIRED when it has several.
 * An amount is never chosen for the caller.
 */
const pickDeposits = (
  amount: bigint | undefined,
  amounts: bigint[],
  depositsByAmount: Map<bigint, Deposit[]>,
  selected: number[],
): Deposit[] => {
  // The amounts every selected validator has a deposit for.
  const available = amounts.filter(
    a => depositsByAmount.get(a)?.length === selected.length,
  );
  if (amount === undefined) {
    if (amounts.length !== 1) {
      throw new ObolError(
        'DEPOSIT_AMOUNT_REQUIRED',
        `The lock has deposit data for ${amounts.length} amounts (${amounts.join(', ')} wei): pass the one to deposit as options.amount`,
        {
          hint: 'Each amount is a separate deposit per validator. Pass amount (wei), e.g. 32 ETH to activate the validators at once, or read depositsByAmount to deposit in parts',
          details: { available },
        },
      );
    }
    amount = amounts[0];
  }
  const deposits = depositsByAmount.get(amount);
  if (deposits?.length !== selected.length) {
    throw new ObolError(
      'DEPOSIT_AMOUNT_NOT_IN_LOCK',
      `Not every requested validator in the lock has a deposit of ${amount} wei`,
      {
        hint: 'Pick one of the available amounts',
        details: { amount, available },
      },
    );
  }
  return deposits;
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
 * (v1.8.0+) or `deposit_data` (v1.6.0, v1.7.0), read only from the field
 * that version's lock hash covers (a legacy lock with `partial_deposit_data`
 * entries is LOCK_INVALID `partial_deposit_data_unexpected`, also with
 * `verify: false`); each deposit has well-formed pubkey,
 * credentials and signature, a positive gwei amount, the validator's group
 * pubkey, and a `deposit_data_root` that matches (computed when absent). A
 * second deposit of one amount for a validator is ignored. With `amount`,
 * every returned validator must have a deposit of it. Without `amount`, the
 * lock must hold deposit data for exactly one amount: a lock with several
 * (Charon's default is 1 ETH and 32 ETH) throws DEPOSIT_AMOUNT_REQUIRED
 * with the amounts in `details.available`; `deposits` is never left out and
 * an amount is never chosen for the caller.
 *
 * @throws PAYLOAD_INVALID (also `options.validators` not in the lock, issue
 *   `not_in_lock`); LOCK_INVALID (`step` and `index` from verifyLock, or
 *   `issue` `fork_version_mismatch`, `deposit_data_missing`,
 *   `deposit_data_invalid`); DEPOSIT_AMOUNT_REQUIRED (`available`);
 *   DEPOSIT_AMOUNT_NOT_IN_LOCK (`amount`, `available`).
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
  } = decodeOptions(options);
  const selected = selectValidators(lock, requested);

  checkForkVersion(lock, chainId);

  if (verify !== false) {
    await verifyForDeposits(lock, selected, verify, options, yieldMs);
  }

  const validators = lock.distributed_validators;
  if (validators.length === 0) {
    throw lockInvalid('The lock has no distributed validators', {
      issue: 'deposit_data_missing',
    });
  }
  const depositsByAmount = collectDeposits(
    validators,
    selected,
    isLegacyLayout(lock),
  );

  const amounts = [...depositsByAmount.keys()].sort(compareBigints);
  const deposits = pickDeposits(amount, amounts, depositsByAmount, selected);

  return {
    lockHash: lock.lock_hash.toLowerCase() as Hex,
    validators: selected,
    amounts,
    depositsByAmount,
    deposits,
  };
};
