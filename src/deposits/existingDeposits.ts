import { type ValidatorDeposit } from '../types.js';

/**
 * Verdict for one deposit from {@link checkExistingDeposits}:
 * - `new`: the beacon node has no validator for the pubkey (there may be
 *   pending deposits with the same withdrawal credentials; see `existing`).
 * - `top_up`: the pubkey is a validator with an index; the deposit adds to
 *   its balance. Withdrawal credentials and signature of a top-up are not
 *   used by the beacon chain.
 * - `conflict`: the pubkey has no index yet but a pending deposit with
 *   different withdrawal credentials is queued. Do not send this deposit.
 */
export type DepositCheckStatus = 'new' | 'top_up' | 'conflict';

/** Result of {@link checkExistingDeposits} for one input deposit. */
export type ExistingDepositCheck = {
  /** Validator pubkey (0x-prefixed, lowercase). */
  pubkey: string;

  status: DepositCheckStatus;

  /** What the beacon node already holds for this pubkey, if anything. */
  existing?: {
    /** Validator index, when the pubkey is in the validator registry. */
    index?: number;
    /** Withdrawal credentials of the registry entry or pending deposit. */
    withdrawal_credentials: string;
    source: 'registry' | 'pending';
  };

  /** Human-readable explanation of the verdict. */
  message: string;
};

/** Options for {@link checkExistingDeposits}. */
export type CheckExistingDepositsOptions = {
  /**
   * Beacon node REST API base URL for the chain the deposits are for
   * (e.g. `http://localhost:5052`). Must serve the Electra
   * `pending_deposits` endpoint.
   */
  beaconUrl: string;
};

/** Fields of a deposit needed for the check. */
export type DepositToCheck = Pick<
  ValidatorDeposit,
  'pubkey' | 'withdrawal_credentials'
>;

/**
 * Pubkeys per `GET /validators?id=` request. Kept below the 64 ids some
 * beacon nodes accept per request, and short enough (~5 KB) for common URL
 * length limits.
 */
export const BEACON_VALIDATORS_CHUNK_SIZE = 50;
/** Concurrent registry requests. */
export const BEACON_VALIDATORS_CHUNK_CONCURRENCY = 2;

type RegistryEntry = { index: number; withdrawal_credentials: string };
type PendingEntry = { withdrawal_credentials: string };

const PUBKEY_REGEX = /^0x[0-9a-f]{96}$/;
const CREDENTIALS_REGEX = /^0x[0-9a-f]{64}$/;

const normalizeBeaconUrl = (beaconUrl: string): string => {
  let url: URL;
  try {
    url = new URL(beaconUrl);
  } catch {
    throw new Error('beaconUrl must be a valid http(s) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('beaconUrl must be a valid http(s) URL');
  }
  return url.toString().replace(/\/+$/, '');
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const beaconGet = async (url: string, what: string): Promise<unknown[]> => {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (e: any) {
    throw new Error(
      `Beacon node ${what} request failed: ${e?.message ?? String(e)}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Beacon node ${what} request failed with HTTP ${response.status}`,
    );
  }
  let body: any;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Malformed beacon node ${what} response`);
  }
  if (!Array.isArray(body?.data)) {
    throw new Error(`Malformed beacon node ${what} response`);
  }
  return body.data;
};

const fetchRegistry = async (
  baseUrl: string,
  pubkeys: string[],
): Promise<Map<string, RegistryEntry>> => {
  const requested = new Set(pubkeys);
  const registry = new Map<string, RegistryEntry>();
  const chunks = chunkArray(pubkeys, BEACON_VALIDATORS_CHUNK_SIZE);
  let nextChunk = 0;

  const worker = async (): Promise<void> => {
    while (nextChunk < chunks.length) {
      const chunk = chunks[nextChunk++];
      const rows = await beaconGet(
        `${baseUrl}/eth/v1/beacon/states/head/validators?id=${chunk.join(',')}`,
        'validators',
      );
      for (const row of rows as any[]) {
        const pubkey = row?.validator?.pubkey;
        const credentials = row?.validator?.withdrawal_credentials;
        const index = Number(row?.index);
        if (
          typeof pubkey !== 'string' ||
          typeof credentials !== 'string' ||
          typeof row?.index !== 'string' ||
          !Number.isSafeInteger(index)
        ) {
          throw new Error('Malformed beacon node validators response');
        }
        const key = pubkey.toLowerCase();
        if (requested.has(key)) {
          registry.set(key, {
            index,
            withdrawal_credentials: credentials.toLowerCase(),
          });
        }
      }
    }
  };

  // Any failed chunk rejects the whole lookup: a partial registry would
  // read as "no validator" for the pubkeys in the missing chunk.
  await Promise.all(
    Array.from(
      { length: Math.min(BEACON_VALIDATORS_CHUNK_CONCURRENCY, chunks.length) },
      async () => {
        await worker();
      },
    ),
  );
  return registry;
};

const fetchPending = async (
  baseUrl: string,
  pubkeys: string[],
): Promise<Map<string, PendingEntry[]>> => {
  const requested = new Set(pubkeys);
  const pending = new Map<string, PendingEntry[]>();
  const rows = await beaconGet(
    `${baseUrl}/eth/v1/beacon/states/head/pending_deposits`,
    'pending_deposits',
  );
  for (const row of rows as Array<Record<string, unknown> | null>) {
    const pubkey = row?.pubkey;
    const credentials = row?.withdrawal_credentials;
    if (typeof pubkey !== 'string' || typeof credentials !== 'string') {
      throw new Error('Malformed beacon node pending_deposits response');
    }
    const key = pubkey.toLowerCase();
    if (!requested.has(key)) continue;
    const entries = pending.get(key) ?? [];
    entries.push({ withdrawal_credentials: credentials.toLowerCase() });
    pending.set(key, entries);
  }
  return pending;
};

const verdict = (
  pubkey: string,
  credentials: string,
  registry: Map<string, RegistryEntry>,
  pending: Map<string, PendingEntry[]>,
): ExistingDepositCheck => {
  const validator = registry.get(pubkey);
  if (validator) {
    const sameCredentials = validator.withdrawal_credentials === credentials;
    return {
      pubkey,
      status: 'top_up',
      existing: {
        index: validator.index,
        withdrawal_credentials: validator.withdrawal_credentials,
        source: 'registry',
      },
      message: sameCredentials
        ? `Validator ${validator.index} exists; this deposit is a top-up.`
        : `Validator ${validator.index} exists; this deposit is a top-up and its withdrawal credentials are not used (the validator keeps ${validator.withdrawal_credentials}).`,
    };
  }

  const queued = pending.get(pubkey) ?? [];
  const different = queued.find(
    entry => entry.withdrawal_credentials !== credentials,
  );
  if (different) {
    return {
      pubkey,
      status: 'conflict',
      existing: {
        withdrawal_credentials: different.withdrawal_credentials,
        source: 'pending',
      },
      message: `A pending deposit for this pubkey has different withdrawal credentials (${different.withdrawal_credentials}). Do not send this deposit.`,
    };
  }
  if (queued.length > 0) {
    return {
      pubkey,
      status: 'new',
      existing: { withdrawal_credentials: credentials, source: 'pending' },
      message: `${queued.length} pending deposit(s) with the same withdrawal credentials are already queued for this pubkey.`,
    };
  }
  return {
    pubkey,
    status: 'new',
    message: 'No validator or pending deposit found for this pubkey.',
  };
};

/**
 * Checks deposits against a beacon node's head state before they are sent,
 * returning one verdict per input deposit (same order):
 *
 * - pubkey unknown → `new`. A first deposit must carry a valid signature and
 *   the intended withdrawal credentials; those are not checked here.
 * - pubkey in the validator registry (has an index) → `top_up`. Any
 *   withdrawal credentials (including zero) and any signature are acceptable
 *   for a top-up.
 * - pubkey not in the registry but with a pending deposit whose withdrawal
 *   credentials differ from the deposit's → `conflict`.
 * - pubkey not in the registry with pending deposits that all have the same
 *   withdrawal credentials → `new`, with `existing.source: 'pending'`.
 *
 * Uses `GET /eth/v1/beacon/states/head/validators?id=...` (chunked, see
 * {@link BEACON_VALIDATORS_CHUNK_SIZE}) and
 * `GET /eth/v1/beacon/states/head/pending_deposits` (Electra). The deposit
 * contract's `DepositEvent` has no indexed fields, so logs cannot be
 * filtered by pubkey; the beacon state is the practical source.
 *
 * **Advisory only.** The check sees the beacon node's head state; it cannot
 * see the mempool or deposits in blocks the node has not processed yet, so
 * a competing deposit sent around the same time cannot be ruled out.
 *
 * If any beacon node request fails or returns a malformed body, the whole
 * call rejects; it never returns a partial result in which a missing answer
 * would read as "no existing deposit".
 *
 * @param deposits - Deposits to check (e.g. `deposits` from
 *   {@link Client.getDepositData}). Only `pubkey` and
 *   `withdrawal_credentials` are used.
 * @param options.beaconUrl - Beacon node REST API base URL.
 * @throws Error on an invalid `beaconUrl`, a malformed pubkey or withdrawal
 *   credentials, or any beacon node failure.
 *
 * @example
 * ```typescript
 * const checks = await checkExistingDeposits(deposits, {
 *   beaconUrl: "http://localhost:5052",
 * });
 * const blocked = checks.filter(c => c.status === "conflict");
 * ```
 */
export const checkExistingDeposits = async (
  deposits: DepositToCheck[],
  { beaconUrl }: CheckExistingDepositsOptions,
): Promise<ExistingDepositCheck[]> => {
  const baseUrl = normalizeBeaconUrl(beaconUrl);

  const normalized = deposits.map((deposit, index) => {
    const pubkey = String(deposit?.pubkey ?? '').toLowerCase();
    const credentials = String(
      deposit?.withdrawal_credentials ?? '',
    ).toLowerCase();
    if (!PUBKEY_REGEX.test(pubkey)) {
      throw new Error(`Invalid pubkey for deposit at index ${index}`);
    }
    if (!CREDENTIALS_REGEX.test(credentials)) {
      throw new Error(
        `Invalid withdrawal credentials for deposit at index ${index}`,
      );
    }
    return { pubkey, credentials };
  });
  if (normalized.length === 0) return [];

  const pubkeys = [...new Set(normalized.map(({ pubkey }) => pubkey))];

  // The pending queue is read before the registry, so a deposit that moves
  // from the queue into the registry between the two requests is still seen.
  const pending = await fetchPending(baseUrl, pubkeys);
  const registry = await fetchRegistry(baseUrl, pubkeys);

  return normalized.map(({ pubkey, credentials }) =>
    verdict(pubkey, credentials, registry, pending),
  );
};
