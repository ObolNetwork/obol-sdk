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
import { ObolApiError, ObolError } from '../errors.js';
import { decode, invalid, T } from '../schema.js';
import type { Source } from '../types.js';
import { gweiToWei } from '../units.js';

export type DepositStatusName = 'new' | 'queued' | 'active' | 'exited';

export interface PendingDeposit {
  amount: bigint;
  /**
   * Absent when the source does not report them: the interim API gives only
   * the sum of top-ups queued for a registry validator.
   */
  withdrawalCredentials?: Hex;
}

export interface DepositStatus {
  pubkey: Hex;
  status: DepositStatusName;
  source: Source;
  /** Raw beacon status; `pending_deposit` for a pubkey only in the queue; absent for `new`. */
  beaconStatus?: string;
  validatorIndex?: number;
  /** The registry entry's credentials, or the first queued deposit's. */
  withdrawalCredentials?: Hex;
  balance?: bigint;
  effectiveBalance?: bigint;
  pendingDeposits: PendingDeposit[];
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
  },
  { additionalProperties: false },
);
export interface DepositStatusOptions {
  beaconUrl?: string;
  lockHash?: Hex;
}

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
): boolean =>
  options.beaconUrl !== undefined ||
  (ctx.api !== null && options.lockHash !== undefined);

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
  return url.toString().replace(/\/+$/, '');
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
  return found;
};

/* ------------------------------------------------------------------------ */

/**
 * deposits.status (`api+chain`): one status per input pubkey, in input order.
 *
 * Sources: the Obol API when enabled and `lockHash` is given (the pubkeys
 * must belong to that lock: `PAYLOAD_INVALID` / `not_in_lock`); else, or if
 * the API request fails, the beacon node at `beaconUrl` (pending queue read
 * before the registry). Neither: `API_DISABLED` (API off) or
 * `PAYLOAD_INVALID` (API on, no `lockHash`). A malformed, duplicate or
 * unknown answer is `STATUS_UNAVAILABLE`.
 */
export const getDepositStatus = async (
  ctx: Context,
  pubkeys: Hex[],
  options: DepositStatusOptions = {},
): Promise<DepositStatus[]> => {
  const input = decode(Type.Array(T.Pubkey), pubkeys, 'pubkeys');
  const opts = decode(DepositStatusOptionsSchema, options, 'options');
  requireContracts(ctx.chain.id, 'deposits.status');
  const unique = [...new Set(input.map(p => p.toLowerCase() as Hex))];

  let found: Map<string, DepositStatus> | undefined;
  let source: Source = 'api';
  if (ctx.api !== null && opts.lockHash !== undefined) {
    try {
      found = await fromApi(ctx, unique, opts.lockHash as Hex);
    } catch (error) {
      // An API failure falls back to the beacon node when there is one.
      if (!(error instanceof ObolApiError) || opts.beaconUrl === undefined) {
        throw error;
      }
    }
  }
  if (found === undefined) {
    if (opts.beaconUrl === undefined) {
      if (ctx.api === null) {
        throw new ObolError(
          'API_DISABLED',
          'deposits.status needs the Obol API or a beaconUrl, and the client was built with api: false',
          { hint: 'Enable the API, or pass beaconUrl' },
        );
      }
      throw invalid(
        'options.lockHash',
        'pass the lock hash of the pubkeys (the Obol API answers by cluster lock), or a beaconUrl',
      );
    }
    found = await fromBeacon(unique, opts.beaconUrl);
    source = 'chain';
  }
  return input.map(raw => {
    const pubkey = raw.toLowerCase() as Hex;
    return (
      found?.get(pubkey) ?? {
        pubkey,
        status: 'new',
        source,
        pendingDeposits: [],
      }
    );
  });
};

/**
 * `getDepositStatus` when a source is available (see `canReadStatus`),
 * keyed by lowercase pubkey; null when there is none. Errors from an
 * available source are thrown, not turned into "unchecked".
 */
export const statusIfAvailable = async (
  ctx: Context,
  pubkeys: Hex[],
  options: DepositStatusOptions,
): Promise<Map<string, DepositStatus> | null> => {
  if (!canReadStatus(ctx, options)) return null;
  const statuses = await getDepositStatus(ctx, pubkeys, options);
  return new Map(statuses.map(s => [s.pubkey, s]));
};
