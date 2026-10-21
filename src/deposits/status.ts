/**
 * deposits.status (spec/operations.md "deposits.status"): what the beacon
 * chain holds for each pubkey, from the Obol API or, as fallback, a beacon
 * node. A malformed or incomplete answer is STATUS_UNAVAILABLE, never a
 * guessed `new`.
 */
import { Type } from '@sinclair/typebox';
import { parseEther, type Hex } from 'viem';
import { requireContracts } from '../chains.js';
import type { Context } from '../context.js';
import { ObolApiError, ObolError, isObolError } from '../errors.js';
import { decode, invalid, T, trimTrailingSlashes } from '../schema.js';
import type { PendingRetry, Source, StatusSource } from '../types.js';
import { gweiToWei } from '../units.js';

export type DepositStatusName = 'new' | 'queued' | 'active' | 'exited';

export interface PendingDeposit {
  amount: bigint;
  /**
   * Absent when the source does not report them: the interim
   * `/v1/state/:lockHash` answer gives only the sum of top-ups queued for a
   * registry validator.
   */
  withdrawalCredentials?: Hex;
  /**
   * Obol API, pubkeys only in the queue: whether the deposit's BLS signature
   * is valid (the beacon chain skips queued deposits with an invalid one
   * until a valid one creates the validator); null when not checked (a
   * registered validator's top-up, whose signature does not matter, or while
   * `signaturesPending`). Absent when the source does not check signatures
   * (the beacon fallback, the interim `/v1/state/:lockHash`, an older API);
   * such a deposit is treated as possibly valid.
   */
  signatureValid?: boolean | null;
}

export interface DepositStatus {
  pubkey: Hex;
  status: DepositStatusName;
  source: Source;
  /** Raw beacon status; `pending_deposit` for a pubkey only in the queue; absent for `new`. */
  beaconStatus?: string;
  validatorIndex?: number;
  /**
   * The registry entry's credentials or, queue only, the ones the validator
   * will be created with: from the Obol API, the first validly signed queued
   * deposit's once every deposit before it is checked (so possibly while
   * `signaturesPending`; absent while an unchecked deposit comes first, or
   * when none is valid); from a source without signature checks, the first
   * queued deposit's.
   */
  withdrawalCredentials?: Hex;
  balance?: bigint;
  effectiveBalance?: bigint;
  /**
   * Registry validators: the activation epoch, or null while none is
   * assigned. Absent when the source does not report it (the interim
   * `/v1/state/:lockHash` answer, an API before deposit-status had it) and
   * for pubkeys not in the registry.
   */
  activationEpoch?: bigint | null;
  /** Registry validators: the exit epoch, or null while no exit is initiated. Absent as `activationEpoch`. */
  exitEpoch?: bigint | null;
  /**
   * Registry validators: the sum of their entries in the beacon chain's
   * pending partial withdrawal queue (EIP-7002), wei. Absent as
   * `activationEpoch`.
   */
  pendingPartialWithdrawals?: bigint;
  pendingDeposits: PendingDeposit[];
  /**
   * Obol API: true while the signatures of this queue-only pubkey's queued
   * deposits are still being checked (usually within a slot; `deposits.status`
   * re-reads a few times first, see `pendingRetry`). The credentials it will
   * get may already be decided (`withdrawalCredentials` set: every deposit up
   * to the first validly signed one is checked). False for registered and new pubkeys. Absent
   * when the source does not check signatures.
   */
  signaturesPending?: boolean;
  /**
   * Obol API: whether validly signed queued deposits carry different
   * withdrawal credentials (the first one applies); null while
   * `signaturesPending`. Absent when the source does not report it.
   */
  credentialsConflict?: boolean | null;
  /**
   * With `expectedWithdrawalAddress`: whether the credentials the validator
   * has (or, queued only, will get: see `effectiveCredentials`) are `0x01` /
   * `0x02` for that address; null when there are none yet, including while
   * undecided (`signaturesPending` with an unchecked deposit first).
   */
  credentialsMatch?: boolean | null;
}

export const DepositStatusOptionsSchema = Type.Object(
  {
    /** Beacon node REST URL, for the chain fallback. */
    beaconUrl: Type.Optional(Type.String({ minLength: 1 })),
    /**
     * The cluster lock the pubkeys belong to. The Obol API answers status by
     * lock (`GET /v1/state/:lockHash`) until the by-pubkey endpoint exists.
     */
    lockHash: Type.Optional(T.Hash32),
    /** Sets `credentialsMatch` on each status. */
    expectedWithdrawalAddress: Type.Optional(T.Address),
    /** Re-reads while an Obol API entry has `signaturesPending`. */
    pendingRetry: Type.Optional(
      Type.Object(
        {
          tries: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
          delayMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 60_000 })),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export interface DepositStatusOptions extends StatusSource {
  /** Sets `credentialsMatch` on each status. */
  expectedWithdrawalAddress?: string;
}

/** The `StatusSource` fields of a write's input schema. */
export const StatusSourceFields = {
  beaconUrl: DepositStatusOptionsSchema.properties.beaconUrl,
  lockHash: DepositStatusOptionsSchema.properties.lockHash,
  pendingRetry: DepositStatusOptionsSchema.properties.pendingRetry,
};

/** The `StatusSource` part of a decoded input, without absent keys. */
export const statusSourceOf = (input: StatusSource): StatusSource => ({
  ...(input.beaconUrl !== undefined ? { beaconUrl: input.beaconUrl } : {}),
  ...(input.lockHash !== undefined ? { lockHash: input.lockHash } : {}),
  ...(input.pendingRetry !== undefined
    ? { pendingRetry: input.pendingRetry }
    : {}),
});

/** Beacon FAR_FUTURE_EPOCH: no epoch assigned. */
export const FAR_FUTURE_EPOCH = 2n ** 64n - 1n;

export const PENDING_DEPOSIT = 'pending_deposit';

/** Beacon status name → SDK status; null for a name the SDK does not know. */
export const statusFromBeacon = (
  beaconStatus: string,
): DepositStatusName | null => {
  if (beaconStatus === PENDING_DEPOSIT) return 'queued';
  if (beaconStatus === 'pending_initialized') return 'queued';
  if (beaconStatus === 'pending_queued') return 'queued';
  if (beaconStatus.startsWith('active_')) return 'active';
  if (beaconStatus.startsWith('exited_')) return 'exited';
  if (beaconStatus.startsWith('withdrawal_')) return 'exited';
  return null;
};

/** Whether `getDepositStatus` has a source for these options. */
export const canReadStatus = (
  ctx: Context,
  options: DepositStatusOptions,
): boolean => options.beaconUrl !== undefined || ctx.api !== null;

const ZERO_CREDENTIALS = `0x${'0'.repeat(64)}`;

/**
 * Queued deposits that may still create or fund the validator: all but those
 * whose signature the source found invalid (an unchecked one is kept).
 */
export const possiblyValidDeposits = (
  status: DepositStatus,
): PendingDeposit[] =>
  status.pendingDeposits.filter(p => p.signatureValid !== false);

/**
 * Whether a queued deposit can be the one that creates the validator: not
 * known to be invalid, and either known valid or with non-zero credentials
 * (a zero-credential top-up has no valid signature for a new validator, so
 * an unchecked one is skipped).
 */
export const canCreateValidator = (p: PendingDeposit): boolean =>
  p.signatureValid === true ||
  (p.signatureValid !== false &&
    p.withdrawalCredentials !== undefined &&
    p.withdrawalCredentials.toLowerCase() !== ZERO_CREDENTIALS);

/**
 * Queue only, signatures checked by the source: the first validly signed
 * deposit's credentials when every deposit before it is checked, else
 * undefined (none valid, or an unchecked one first: undecided). Later
 * deposits do not matter; the chain applies them as top-ups.
 */
const decidedCredentials = (
  deposits: readonly PendingDeposit[],
): Hex | undefined => {
  for (const p of deposits) {
    if (p.signatureValid === true) return p.withdrawalCredentials;
    if (p.signatureValid !== false) return undefined;
  }
  return undefined;
};

/**
 * The credentials a validator has, or (no registry entry yet) will get. With
 * signature checks (Obol API), the first validly signed queued deposit's once
 * every deposit before it is checked, so possibly while `signaturesPending`;
 * undefined while an unchecked deposit comes first (never guessed). Without
 * them, the first queued deposit that can create it (`canCreateValidator`).
 */
export const effectiveCredentials = (
  status: DepositStatus,
): Hex | undefined => {
  if (status.validatorIndex !== undefined) return status.withdrawalCredentials;
  if (status.pendingDeposits.some(p => p.signatureValid !== undefined)) {
    return decidedCredentials(status.pendingDeposits);
  }
  if (status.signaturesPending === true) return undefined;
  return status.pendingDeposits.find(canCreateValidator)?.withdrawalCredentials;
};

const credentialsMatch = (
  credentials: Hex | undefined,
  address: string,
): boolean | null => {
  if (credentials === undefined) return null;
  const c = credentials.toLowerCase();
  const prefix = c.slice(0, 4);
  return (
    (prefix === '0x01' || prefix === '0x02') &&
    c.slice(4, 26) === '0'.repeat(22) &&
    c.slice(-40) === address.toLowerCase().slice(2)
  );
};

const PUBKEY = /^0x[0-9a-f]{96}$/;
const CREDENTIALS = /^0x[0-9a-f]{64}$/;
const DECIMAL = /^\d+$/;
const ETH_DECIMAL = /^\d+(\.\d{1,18})?$/;

const unavailable = (message: string, cause?: unknown): ObolError =>
  new ObolError('STATUS_UNAVAILABLE', message, {
    hint: 'Retry; do not assume the validator is new',
    ...(cause !== undefined ? { cause } : {}),
  });

const lowerString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value.toLowerCase() : undefined;

/* ------------------------------------------------------------------------ */
/* Obol API: POST /v1/validators/:network/deposit-status                     */
/* ------------------------------------------------------------------------ */

/** Pubkeys per deposit-status request (the API's limit). */
export const DEPOSIT_STATUS_BATCH = 500;
/** Default `pendingRetry`. */
const PENDING_TRIES = 3;
const PENDING_DELAY_MS = 8_000;
const STATUS_NAMES = new Set<string>(['new', 'queued', 'active', 'exited']);

const weiString = (value: unknown, what: string, pubkey: string): bigint => {
  if (typeof value !== 'string' || !DECIMAL.test(value)) {
    throw unavailable(
      `The Obol API returned a malformed ${what} for ${pubkey}`,
    );
  }
  return BigInt(value);
};

const depositStatusEntry = (raw: unknown): DepositStatus => {
  const entry = (raw ?? {}) as Record<string, unknown>;
  const pubkey = lowerString(entry.pubkey);
  if (pubkey === undefined || !PUBKEY.test(pubkey)) {
    throw unavailable('The Obol API returned a malformed pubkey');
  }
  const bad = (what: string): never => {
    throw unavailable(`The Obol API returned ${what} for ${pubkey}`);
  };
  const status = entry.status;
  if (typeof status !== 'string' || !STATUS_NAMES.has(status)) {
    return bad('an unknown status');
  }
  if (!Array.isArray(entry.pendingDeposits)) {
    return bad('malformed pending deposits');
  }
  // Signature fields were added to the route later: absent on a deployment
  // without them, and then left absent here.
  const pending = entry.signaturesPending;
  if (pending !== undefined && typeof pending !== 'boolean') {
    return bad('a malformed signaturesPending');
  }
  const conflict = entry.credentialsConflict;
  if (
    conflict !== undefined &&
    conflict !== null &&
    typeof conflict !== 'boolean'
  ) {
    return bad('a malformed credentialsConflict');
  }
  if (
    pending === true
      ? conflict === true || conflict === false
      : conflict === null
  ) {
    return bad('a credentialsConflict inconsistent with signaturesPending');
  }
  const pendingDeposits = (entry.pendingDeposits as unknown[]).map(item => {
    const deposit = (item ?? {}) as Record<string, unknown>;
    const credentials = lowerString(deposit.withdrawalCredentials);
    const amount = weiString(deposit.amount, 'pending deposit amount', pubkey);
    if (credentials === undefined || !CREDENTIALS.test(credentials)) {
      return bad('malformed pending deposit credentials');
    }
    const valid = deposit.signatureValid;
    if (valid !== undefined && valid !== null && typeof valid !== 'boolean') {
      return bad('a malformed pending deposit signatureValid');
    }
    const parsed: PendingDeposit = {
      amount,
      withdrawalCredentials: credentials as Hex,
    };
    if (valid !== undefined) parsed.signatureValid = valid;
    return parsed;
  });
  const signatureFields = {
    ...(pending !== undefined ? { signaturesPending: pending } : {}),
    ...(conflict !== undefined ? { credentialsConflict: conflict } : {}),
  };
  if (status === 'new') {
    if (
      entry.beaconStatus !== null ||
      entry.index !== null ||
      pendingDeposits.length > 0 ||
      pending === true
    ) {
      return bad('an inconsistent new status');
    }
    return {
      pubkey: pubkey as Hex,
      status,
      source: 'api',
      ...signatureFields,
      pendingDeposits,
    };
  }
  const beaconStatus = entry.beaconStatus;
  if (
    typeof beaconStatus !== 'string' ||
    statusFromBeacon(beaconStatus) !== status
  ) {
    return bad(`a beacon status that is not ${status}`);
  }
  const rawCredentials = entry.withdrawalCredentials;
  const credentials = lowerString(rawCredentials);
  if (
    rawCredentials !== null &&
    (credentials === undefined || !CREDENTIALS.test(credentials))
  ) {
    return bad('malformed withdrawal credentials');
  }
  if (beaconStatus === PENDING_DEPOSIT) {
    if (entry.index !== null || pendingDeposits.length === 0) {
      return bad('a queued status without a queued deposit');
    }
    const checked = pendingDeposits.some(p => p.signatureValid !== undefined);
    if (checked) {
      // The API walks the queue in order: the credentials are the first
      // validly signed deposit's once every deposit before it is checked
      // (later ones are top-ups), else null (none valid, or an unchecked
      // deposit first). So they may be decided while signatures are pending.
      if (
        (decidedCredentials(pendingDeposits) ?? null) !== (credentials ?? null)
      ) {
        return bad(
          "withdrawal credentials that are not the first validly signed deposit's",
        );
      }
    }
    if (pending !== true && checked) {
      if (pendingDeposits.some(p => p.signatureValid === null)) {
        return bad('an unchecked queued deposit without signaturesPending');
      }
      const valid = pendingDeposits.filter(p => p.signatureValid === true);
      const distinct = new Set(
        valid
          .map(p => p.withdrawalCredentials)
          .filter(c => c !== ZERO_CREDENTIALS),
      );
      const disagree = distinct.size > 1;
      if (conflict !== undefined && conflict !== disagree) {
        return bad('a credentialsConflict that its queued deposits contradict');
      }
    } else if (pending !== true && credentials === undefined) {
      return bad('a queued status without withdrawal credentials');
    }
    return {
      pubkey: pubkey as Hex,
      status: 'queued',
      source: 'api',
      beaconStatus,
      // Null while undecided (or none valid): left absent.
      ...(credentials !== undefined && (pending !== true || checked)
        ? { withdrawalCredentials: credentials as Hex }
        : {}),
      ...signatureFields,
      pendingDeposits,
    };
  }
  if (pending === true) {
    return bad('signaturesPending for a registered validator');
  }
  if (credentials === undefined) {
    return bad('malformed withdrawal credentials');
  }
  const index = entry.index;
  if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) {
    return bad('a malformed validator index');
  }
  // Added to the route later: absent on a deployment without them.
  const epoch = (value: unknown, what: string): bigint | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== 'string' || !DECIMAL.test(value)) {
      return bad(`a malformed ${what}`);
    }
    const n = BigInt(value);
    return n === FAR_FUTURE_EPOCH ? null : n;
  };
  const activationEpoch = epoch(entry.activationEpoch, 'activation epoch');
  const exitEpoch = epoch(entry.exitEpoch, 'exit epoch');
  const pendingPartialWithdrawals =
    entry.pendingPartialWithdrawals === undefined
      ? undefined
      : weiString(
          entry.pendingPartialWithdrawals,
          'pending partial withdrawals',
          pubkey,
        );
  return {
    pubkey: pubkey as Hex,
    status: status as DepositStatusName,
    source: 'api',
    beaconStatus,
    validatorIndex: index,
    withdrawalCredentials: credentials as Hex,
    balance: weiString(entry.balance, 'balance', pubkey),
    effectiveBalance: weiString(
      entry.effectiveBalance,
      'effective balance',
      pubkey,
    ),
    ...(activationEpoch !== undefined ? { activationEpoch } : {}),
    ...(exitEpoch !== undefined ? { exitEpoch } : {}),
    ...(pendingPartialWithdrawals !== undefined
      ? { pendingPartialWithdrawals }
      : {}),
    ...signatureFields,
    pendingDeposits,
  };
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, ms));
};

const fromDepositStatusApi = async (
  ctx: Context,
  pubkeys: Hex[],
  retry: PendingRetry,
): Promise<Map<string, DepositStatus>> => {
  const api = ctx.api;
  if (api === null) throw new Error('unreachable: API disabled');
  const tries = retry.tries ?? PENDING_TRIES;
  const delayMs = retry.delayMs ?? PENDING_DELAY_MS;
  const readChunk = async (chunk: Hex[]): Promise<DepositStatus[]> => {
    const body = await api.request<{ validators?: unknown }>(
      `/v1/validators/${ctx.chain.network}/deposit-status`,
      { method: 'POST', body: { pubkeys: chunk } },
    );
    if (!Array.isArray(body?.validators)) {
      throw unavailable('The Obol API returned a malformed deposit status');
    }
    const requested = new Set<string>(chunk);
    const seen = new Set<string>();
    const statuses = (body.validators as unknown[]).map(raw => {
      const status = depositStatusEntry(raw);
      if (!requested.has(status.pubkey)) {
        throw unavailable(
          `The Obol API returned ${status.pubkey}, which was not requested`,
        );
      }
      if (seen.has(status.pubkey)) {
        throw unavailable(`The Obol API returned ${status.pubkey} twice`);
      }
      seen.add(status.pubkey);
      return status;
    });
    const missing = chunk.find(p => !seen.has(p));
    if (missing !== undefined) {
      throw unavailable(`The Obol API left out ${missing}`);
    }
    return statuses;
  };
  const found = new Map<string, DepositStatus>();
  for (let i = 0; i < pubkeys.length; i += DEPOSIT_STATUS_BATCH) {
    const chunk = pubkeys.slice(i, i + DEPOSIT_STATUS_BATCH);
    // Queued deposit signatures are checked in the background: re-read the
    // batch while an entry is pending, then return it as pending.
    let statuses = await readChunk(chunk);
    for (
      let attempt = 1;
      attempt < tries && statuses.some(s => s.signaturesPending === true);
      attempt++
    ) {
      await sleep(delayMs * 2 ** (attempt - 1));
      statuses = await readChunk(chunk);
    }
    for (const status of statuses) found.set(status.pubkey, status);
  }
  return found;
};

/* ------------------------------------------------------------------------ */
/* Obol API (interim: GET /v1/state/:lockHash)                               */
/* ------------------------------------------------------------------------ */

const ethToWei = (value: unknown, what: string): bigint => {
  if (typeof value !== 'string' || !ETH_DECIMAL.test(value)) {
    throw unavailable(`The Obol API returned a malformed ${what}`);
  }
  return parseEther(value);
};

const optionalEthToWei = (value: unknown, what: string): bigint | undefined =>
  value === null || value === undefined ? undefined : ethToWei(value, what);

const apiEntry = (pubkey: Hex, raw: unknown): DepositStatus => {
  if (raw === null || typeof raw !== 'object') {
    throw unavailable(`The Obol API returned a malformed state for ${pubkey}`);
  }
  const entry = raw as Record<string, unknown>;
  const beaconStatus = entry.status;
  const status =
    typeof beaconStatus === 'string' ? statusFromBeacon(beaconStatus) : null;
  if (typeof beaconStatus !== 'string' || status === null) {
    throw unavailable(`The Obol API returned an unknown status for ${pubkey}`);
  }
  const credentials = lowerString(entry.withdrawal_credentials);
  if (credentials === undefined || !CREDENTIALS.test(credentials)) {
    throw unavailable(
      `The Obol API returned malformed withdrawal credentials for ${pubkey}`,
    );
  }
  const queued = optionalEthToWei(
    entry.pending_partial_deposits,
    'pending deposit amount',
  );
  if (beaconStatus === PENDING_DEPOSIT) {
    if (queued === undefined || queued === 0n) {
      throw unavailable(
        `The Obol API reported ${pubkey} as queued without a deposit amount`,
      );
    }
    return {
      pubkey,
      status,
      source: 'api',
      beaconStatus,
      withdrawalCredentials: credentials as Hex,
      // The API reports the credentials of the first queued deposit, which
      // are the ones the validator will be created with.
      pendingDeposits: [
        { amount: queued, withdrawalCredentials: credentials as Hex },
      ],
    };
  }
  const index = entry.index;
  if (typeof index !== 'string' || !DECIMAL.test(index)) {
    throw unavailable(`The Obol API returned a malformed index for ${pubkey}`);
  }
  const balance = optionalEthToWei(entry.balance, 'balance');
  const effectiveBalance = optionalEthToWei(
    entry.effective_balance,
    'effective balance',
  );
  return {
    pubkey,
    status,
    source: 'api',
    beaconStatus,
    validatorIndex: Number(index),
    withdrawalCredentials: credentials as Hex,
    ...(balance !== undefined ? { balance } : {}),
    ...(effectiveBalance !== undefined ? { effectiveBalance } : {}),
    pendingDeposits:
      queued !== undefined && queued > 0n ? [{ amount: queued }] : [],
  };
};

const fromApi = async (
  ctx: Context,
  pubkeys: Hex[],
  lockHash: Hex,
): Promise<Map<string, DepositStatus>> => {
  const api = ctx.api;
  if (api === null) throw new Error('unreachable: API disabled');
  // The state endpoint omits pubkeys that are neither registered nor queued,
  // and also pubkeys outside the lock. Check membership first, so that an
  // omitted pubkey can be read as `new`.
  const lock = await api.request<{
    lock_hash?: unknown;
    distributed_validators?: unknown;
  }>(`/v1/lock/${lockHash}`);
  if (
    typeof lock?.lock_hash === 'string' &&
    lock.lock_hash.toLowerCase() !== lockHash.toLowerCase()
  ) {
    throw new ObolError(
      'API_RESPONSE_MISMATCH',
      `The Obol API returned lock ${lock.lock_hash} for ${lockHash}`,
      { hint: 'Report it; do not use the answer' },
    );
  }
  if (!Array.isArray(lock?.distributed_validators)) {
    throw unavailable(`The Obol API returned a malformed lock ${lockHash}`);
  }
  const inLock = new Set(
    (lock.distributed_validators as unknown[]).map(dv =>
      lowerString(
        (dv as { distributed_public_key?: unknown } | null)
          ?.distributed_public_key,
      ),
    ),
  );
  pubkeys.forEach((pubkey, i) => {
    if (!inLock.has(pubkey)) {
      throw invalid(
        `pubkeys[${i}]`,
        `is not a validator of lock ${lockHash}`,
        'not_in_lock',
      );
    }
  });

  const body = await api.request<unknown>(`/v1/state/${lockHash}`);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw unavailable('The Obol API returned a malformed state answer');
  }
  const requested = new Set<string>(pubkeys);
  const found = new Map<string, DepositStatus>();
  for (const [key, raw] of Object.entries(body)) {
    const pubkey = key.toLowerCase();
    if (!PUBKEY.test(pubkey)) {
      throw unavailable(`The Obol API returned a malformed pubkey (${key})`);
    }
    if (found.has(pubkey)) {
      throw unavailable(`The Obol API returned ${pubkey} twice`);
    }
    if (!requested.has(pubkey)) continue;
    found.set(pubkey, apiEntry(pubkey as Hex, raw));
  }
  return found;
};

/* ------------------------------------------------------------------------ */
/* Beacon node fallback                                                      */
/* ------------------------------------------------------------------------ */

const BEACON_CHUNK = 500;
const BEACON_TIMEOUT_MS = 30_000;

const normalizeBeaconUrl = (beaconUrl: string): string => {
  let url: URL;
  try {
    url = new URL(beaconUrl);
  } catch {
    throw invalid('beaconUrl', 'must be an http(s) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw invalid('beaconUrl', 'must be an http(s) URL');
  }
  return trimTrailingSlashes(url.toString());
};

const beaconData = async (
  url: string,
  what: string,
  body?: unknown,
): Promise<unknown[]> => {
  let response: Response;
  try {
    response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(BEACON_TIMEOUT_MS),
    });
  } catch (cause) {
    throw unavailable(`Beacon node ${what} request failed`, cause);
  }
  if (!response.ok) {
    throw unavailable(
      `Beacon node ${what} request failed with HTTP ${response.status}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (cause) {
    throw unavailable(`Malformed beacon node ${what} response`, cause);
  }
  const data = (parsed as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    throw unavailable(`Malformed beacon node ${what} response`);
  }
  return data;
};

const gweiString = (value: unknown, what: string): bigint => {
  if (typeof value !== 'string' || !DECIMAL.test(value)) {
    throw unavailable(`Malformed beacon node ${what}`);
  }
  return gweiToWei(BigInt(value));
};

const beaconEpoch = (value: unknown, what: string): bigint | null => {
  if (typeof value !== 'string' || !DECIMAL.test(value)) {
    throw unavailable(`Malformed beacon node ${what}`);
  }
  const n = BigInt(value);
  return n === FAR_FUTURE_EPOCH ? null : n;
};

/** Beacon PENDING_PARTIAL_WITHDRAWALS_LIMIT (Electra). */
export const PENDING_PARTIAL_WITHDRAWALS_LIMIT = 2 ** 27;

/** What the beacon fallback read besides the statuses. */
export interface BeaconQueues {
  /** Length of the pending partial withdrawal queue. */
  pendingPartialWithdrawals: number;
}

const beaconQueues = new WeakMap<Map<string, DepositStatus>, BeaconQueues>();

/** The queue lengths read with these statuses, when they came from a beacon node. */
export const queuesOf = (
  statuses: Map<string, DepositStatus>,
): BeaconQueues | undefined => beaconQueues.get(statuses);

const fromBeacon = async (
  pubkeys: Hex[],
  beaconUrl: string,
): Promise<Map<string, DepositStatus>> => {
  const base = normalizeBeaconUrl(beaconUrl);
  const requested = new Set<string>(pubkeys);

  // The pending queue is read before the registry, so a deposit that moves
  // from the queue into the registry between the two requests is still seen.
  const pending = new Map<string, PendingDeposit[]>();
  const rows = await beaconData(
    `${base}/eth/v1/beacon/states/head/pending_deposits`,
    'pending_deposits',
  );
  for (const row of rows as Array<Record<string, unknown> | null>) {
    const pubkey = lowerString(row?.pubkey);
    const credentials = lowerString(row?.withdrawal_credentials);
    if (
      pubkey === undefined ||
      !PUBKEY.test(pubkey) ||
      credentials === undefined ||
      !CREDENTIALS.test(credentials)
    ) {
      throw unavailable('Malformed beacon node pending_deposits response');
    }
    if (!requested.has(pubkey)) continue;
    const entries = pending.get(pubkey) ?? [];
    entries.push({
      amount: gweiString(row?.amount, 'pending deposit amount'),
      withdrawalCredentials: credentials as Hex,
    });
    pending.set(pubkey, entries);
  }

  // Pending partial withdrawals, by validator index (gwei amounts).
  const partialRows = await beaconData(
    `${base}/eth/v1/beacon/states/head/pending_partial_withdrawals`,
    'pending_partial_withdrawals',
  );
  const partialsByIndex = new Map<string, bigint>();
  for (const row of partialRows as Array<Record<string, unknown> | null>) {
    const index = row?.validator_index;
    if (typeof index !== 'string' || !DECIMAL.test(index)) {
      throw unavailable(
        'Malformed beacon node pending_partial_withdrawals response',
      );
    }
    const amount = gweiString(row?.amount, 'pending partial withdrawal amount');
    const key = BigInt(index).toString();
    partialsByIndex.set(key, (partialsByIndex.get(key) ?? 0n) + amount);
  }

  const found = new Map<string, DepositStatus>();
  for (let i = 0; i < pubkeys.length; i += BEACON_CHUNK) {
    const ids = pubkeys.slice(i, i + BEACON_CHUNK);
    const validators = await beaconData(
      `${base}/eth/v1/beacon/states/head/validators`,
      'validators',
      { ids },
    );
    for (const raw of validators as Array<Record<string, unknown> | null>) {
      const validator = raw?.validator as Record<string, unknown> | undefined;
      const pubkey = lowerString(validator?.pubkey);
      const credentials = lowerString(validator?.withdrawal_credentials);
      const beaconStatus = raw?.status;
      const status =
        typeof beaconStatus === 'string'
          ? statusFromBeacon(beaconStatus)
          : null;
      if (
        pubkey === undefined ||
        !PUBKEY.test(pubkey) ||
        credentials === undefined ||
        !CREDENTIALS.test(credentials) ||
        typeof raw?.index !== 'string' ||
        !DECIMAL.test(raw.index) ||
        typeof beaconStatus !== 'string' ||
        status === null ||
        beaconStatus === PENDING_DEPOSIT
      ) {
        throw unavailable('Malformed beacon node validators response');
      }
      if (!requested.has(pubkey)) continue;
      if (found.has(pubkey)) {
        throw unavailable(`Beacon node returned ${pubkey} twice`);
      }
      found.set(pubkey, {
        pubkey: pubkey as Hex,
        status,
        source: 'chain',
        beaconStatus,
        validatorIndex: Number(raw.index),
        withdrawalCredentials: credentials as Hex,
        balance: gweiString(raw.balance, 'balance'),
        effectiveBalance: gweiString(
          validator?.effective_balance,
          'effective balance',
        ),
        activationEpoch: beaconEpoch(
          validator?.activation_epoch,
          'activation epoch',
        ),
        exitEpoch: beaconEpoch(validator?.exit_epoch, 'exit epoch'),
        pendingPartialWithdrawals:
          partialsByIndex.get(BigInt(raw.index).toString()) ?? 0n,
        pendingDeposits: pending.get(pubkey) ?? [],
      });
    }
  }
  for (const [pubkey, entries] of pending) {
    if (found.has(pubkey)) continue;
    found.set(pubkey, {
      pubkey: pubkey as Hex,
      status: 'queued',
      source: 'chain',
      beaconStatus: PENDING_DEPOSIT,
      withdrawalCredentials: entries[0].withdrawalCredentials,
      pendingDeposits: entries,
    });
  }
  beaconQueues.set(found, { pendingPartialWithdrawals: partialRows.length });
  return found;
};

/* ------------------------------------------------------------------------ */

/** Thrown when the API has neither endpoint for this call and no beaconUrl. */
const ENDPOINT_UNAVAILABLE = 'endpoint_unavailable';

/** An API failure falls back to the beacon node when there is one. */
const apiOrBeacon = async (
  read: () => Promise<Map<string, DepositStatus>>,
  beaconUrl: string | undefined,
): Promise<Map<string, DepositStatus> | undefined> => {
  try {
    return await read();
  } catch (error) {
    if (!(error instanceof ObolApiError) || beaconUrl === undefined) {
      throw error;
    }
    return undefined;
  }
};

const fromApiSources = async (
  ctx: Context,
  pubkeys: Hex[],
  opts: StatusSource,
): Promise<Map<string, DepositStatus> | undefined> => {
  try {
    return await fromDepositStatusApi(ctx, pubkeys, opts.pendingRetry ?? {});
  } catch (error) {
    // 404: an API without the deposit-status route (not deployed yet).
    if (!isObolError(error, 'API_NOT_FOUND')) {
      if (error instanceof ObolApiError && opts.beaconUrl !== undefined) {
        return undefined;
      }
      throw error;
    }
  }
  if (opts.lockHash !== undefined) {
    return await apiOrBeacon(
      async () => await fromApi(ctx, pubkeys, opts.lockHash as Hex),
      opts.beaconUrl,
    );
  }
  if (opts.beaconUrl !== undefined) return undefined;
  throw new ObolError(
    'STATUS_UNAVAILABLE',
    'The Obol API does not serve deposit status by pubkey yet',
    {
      hint: 'Pass lockHash (the lock of the pubkeys) or a beaconUrl',
      details: { reason: ENDPOINT_UNAVAILABLE },
    },
  );
};

/**
 * deposits.status (`api+chain`): one status per input pubkey, in input order.
 *
 * Sources: the Obol API (`POST /v1/validators/:network/deposit-status`, up
 * to 500 pubkeys per request, a batch re-read per `pendingRetry` while an
 * entry has `signaturesPending`, then returned as it is); while that route
 * answers 404, the interim
 * `GET /v1/state/:lockHash` when `lockHash` is given (the pubkeys must
 * belong to that lock: `PAYLOAD_INVALID` / `not_in_lock`). Else, or if the
 * API request fails, the beacon node at `beaconUrl` (pending queue read
 * before the registry). Neither: `API_DISABLED` (API off) or
 * `STATUS_UNAVAILABLE` (API without the route). A malformed, duplicate,
 * incomplete or unknown answer is `STATUS_UNAVAILABLE`. With
 * `expectedWithdrawalAddress`, each status has `credentialsMatch`.
 */
export const getDepositStatus = async (
  ctx: Context,
  pubkeys: readonly string[],
  options: DepositStatusOptions = {},
): Promise<DepositStatus[]> => (await readStatuses(ctx, pubkeys, options)).list;

const readStatuses = async (
  ctx: Context,
  pubkeys: readonly string[],
  options: DepositStatusOptions,
): Promise<{
  list: DepositStatus[];
  queues?: BeaconQueues;
}> => {
  const input = decode(Type.Array(T.Pubkey), pubkeys, 'pubkeys');
  const opts = decode(DepositStatusOptionsSchema, options, 'options');
  requireContracts(ctx.chain.id, 'deposits.status');
  const unique = [...new Set(input.map(p => p.toLowerCase() as Hex))];

  let found: Map<string, DepositStatus> | undefined;
  let queues: BeaconQueues | undefined;
  let source: Source = 'api';
  if (ctx.api !== null) {
    found = await fromApiSources(ctx, unique, opts);
  }
  if (found === undefined) {
    if (opts.beaconUrl === undefined) {
      throw new ObolError(
        'API_DISABLED',
        'deposits.status needs the Obol API or a beaconUrl, and the client was built with api: false',
        { hint: 'Enable the API, or pass beaconUrl' },
      );
    }
    found = await fromBeacon(unique, opts.beaconUrl);
    queues = queuesOf(found);
    source = 'chain';
  }
  const expected = opts.expectedWithdrawalAddress;
  const list = input.map(raw => {
    const pubkey = raw.toLowerCase() as Hex;
    const status: DepositStatus = found?.get(pubkey) ?? {
      pubkey,
      status: 'new',
      source,
      pendingDeposits: [],
    };
    return expected === undefined
      ? status
      : {
          ...status,
          credentialsMatch: credentialsMatch(
            effectiveCredentials(status),
            expected,
          ),
        };
  });
  return { list, ...(queues !== undefined ? { queues } : {}) };
};

/**
 * `getDepositStatus` when a source is available (see `canReadStatus`),
 * keyed by lowercase pubkey; null when there is none, including an Obol API
 * without the deposit-status route and no `lockHash` / `beaconUrl`. Errors
 * from an available source are thrown, not turned into "unchecked".
 */
export const statusIfAvailable = async (
  ctx: Context,
  pubkeys: readonly string[],
  options: DepositStatusOptions,
): Promise<Map<string, DepositStatus> | null> => {
  if (!canReadStatus(ctx, options)) return null;
  try {
    const { list, queues } = await readStatuses(ctx, pubkeys, options);
    const map = new Map(list.map(s => [s.pubkey, s]));
    if (queues !== undefined) beaconQueues.set(map, queues);
    return map;
  } catch (error) {
    if (
      isObolError(error, 'STATUS_UNAVAILABLE') &&
      error.details.reason === ENDPOINT_UNAVAILABLE
    ) {
      return null;
    }
    throw error;
  }
};
