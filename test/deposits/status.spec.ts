import { jest } from '@jest/globals';
import type { Hex } from 'viem';
import { ObolApiError } from '../../src/errors.js';
import {
  canReadStatus,
  getDepositStatus,
  statusFromBeacon,
} from '../../src/deposits/status.js';
import { fakeApi, fakeChain } from '../helpers/fakeChain.js';
import {
  caught,
  credentials,
  ETH,
  GWEI,
  OVM,
  PUBKEY_A,
  PUBKEY_B,
  PUBKEY_C,
} from '../ovm/ovmFixture.js';

const LOCK = `0x${'11'.repeat(32)}` as Hex;
const CREDS = credentials('01', OVM);
const OTHER_CREDS = credentials('02', OVM);
const BEACON = 'http://beacon.local:5052/';

const lockRoute = (pubkeys: Hex[]) => () => ({
  lock_hash: LOCK,
  distributed_validators: pubkeys.map(p => ({ distributed_public_key: p })),
});

const apiWith = (
  state: unknown,
  pubkeys: Hex[] = [PUBKEY_A, PUBKEY_B, PUBKEY_C],
) =>
  fakeApi({
    [`/v1/lock/${LOCK}`]: lockRoute(pubkeys),
    [`/v1/state/${LOCK}`]: () => state,
  });

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const mockBeacon = (pending: unknown[], validators: unknown[]) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = jest.fn(async (url: any, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/pending_deposits')) {
      return jsonResponse({ data: pending });
    }
    return jsonResponse({ data: validators });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return calls;
};

const registryRow = (pubkey: Hex, status: string, extra: object = {}) => ({
  index: '42',
  balance: (32n * GWEI + 5n).toString(),
  status,
  validator: {
    pubkey,
    withdrawal_credentials: CREDS,
    effective_balance: (32n * GWEI).toString(),
  },
  ...extra,
});

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

describe('deposits.status', () => {
  it('maps beacon status names', () => {
    expect(statusFromBeacon('pending_deposit')).toBe('queued');
    expect(statusFromBeacon('pending_initialized')).toBe('queued');
    expect(statusFromBeacon('pending_queued')).toBe('queued');
    expect(statusFromBeacon('active_ongoing')).toBe('active');
    expect(statusFromBeacon('active_slashed')).toBe('active');
    expect(statusFromBeacon('exited_unslashed')).toBe('exited');
    expect(statusFromBeacon('withdrawal_done')).toBe('exited');
    expect(statusFromBeacon('sleeping')).toBeNull();
  });

  describe('from the Obol API (/v1/state/:lockHash)', () => {
    it('maps registry, queue-only and missing pubkeys', async () => {
      const api = apiWith({
        [PUBKEY_A]: {
          index: '7',
          status: 'active_ongoing',
          balance: '32.000000005',
          effective_balance: '32',
          withdrawal_credentials: CREDS,
          pending_partial_withdrawals: '0',
          pending_partial_deposits: '1',
        },
        [PUBKEY_B.toUpperCase().replace('0X', '0x')]: {
          index: null,
          status: 'pending_deposit',
          balance: null,
          effective_balance: null,
          withdrawal_credentials: CREDS,
          pending_partial_withdrawals: null,
          pending_partial_deposits: '32',
        },
      });
      const ctx = fakeChain().context(api);
      expect(canReadStatus(ctx, { lockHash: LOCK })).toBe(true);
      const [a, b, c] = await getDepositStatus(
        ctx,
        [PUBKEY_A, PUBKEY_B, PUBKEY_C],
        {
          lockHash: LOCK,
        },
      );
      expect(a).toEqual({
        pubkey: PUBKEY_A,
        status: 'active',
        source: 'api',
        beaconStatus: 'active_ongoing',
        validatorIndex: 7,
        withdrawalCredentials: CREDS,
        balance: 32n * ETH + 5n * GWEI,
        effectiveBalance: 32n * ETH,
        pendingDeposits: [{ amount: ETH }],
      });
      expect(b).toEqual({
        pubkey: PUBKEY_B,
        status: 'queued',
        source: 'api',
        beaconStatus: 'pending_deposit',
        withdrawalCredentials: CREDS,
        pendingDeposits: [{ amount: 32n * ETH, withdrawalCredentials: CREDS }],
      });
      expect(c).toEqual({
        pubkey: PUBKEY_C,
        status: 'new',
        source: 'api',
        pendingDeposits: [],
      });
    });

    it('refuses a pubkey outside the lock (it would read as new)', async () => {
      const api = apiWith({}, [PUBKEY_A]);
      const error = await caught(
        getDepositStatus(fakeChain().context(api), [PUBKEY_A, PUBKEY_B], {
          lockHash: LOCK,
        }),
      );
      expect(error.code).toBe('PAYLOAD_INVALID');
      expect(error.details.issues[0]).toMatchObject({
        path: 'pubkeys[1]',
        issue: 'not_in_lock',
      });
    });

    it.each([
      [
        'an unknown status',
        { status: 'sleeping', index: '1', withdrawal_credentials: CREDS },
      ],
      [
        'bad credentials',
        {
          status: 'active_ongoing',
          index: '1',
          withdrawal_credentials: '0x01',
        },
      ],
      [
        'a missing index',
        { status: 'active_ongoing', withdrawal_credentials: CREDS },
      ],
      [
        'a bad balance',
        {
          status: 'active_ongoing',
          index: '1',
          withdrawal_credentials: CREDS,
          balance: '1e3',
        },
      ],
      [
        'a queued entry without amount',
        {
          status: 'pending_deposit',
          withdrawal_credentials: CREDS,
          pending_partial_deposits: null,
        },
      ],
    ])('throws STATUS_UNAVAILABLE for %s', async (_name, entry) => {
      const error = await caught(
        getDepositStatus(
          fakeChain().context(apiWith({ [PUBKEY_A]: entry })),
          [PUBKEY_A],
          {
            lockHash: LOCK,
          },
        ),
      );
      expect(error.code).toBe('STATUS_UNAVAILABLE');
    });

    it('throws STATUS_UNAVAILABLE for a duplicate or malformed pubkey key', async () => {
      const entry = {
        status: 'active_ongoing',
        index: '1',
        withdrawal_credentials: CREDS,
      };
      const dup = apiWith({
        [PUBKEY_A]: entry,
        [PUBKEY_A.toUpperCase().replace('0X', '0x')]: entry,
      });
      expect(
        (
          await caught(
            getDepositStatus(fakeChain().context(dup), [PUBKEY_A], {
              lockHash: LOCK,
            }),
          )
        ).code,
      ).toBe('STATUS_UNAVAILABLE');
      const bad = apiWith({ '0x1234': entry });
      expect(
        (
          await caught(
            getDepositStatus(fakeChain().context(bad), [PUBKEY_A], {
              lockHash: LOCK,
            }),
          )
        ).code,
      ).toBe('STATUS_UNAVAILABLE');
      const notObject = apiWith([]);
      expect(
        (
          await caught(
            getDepositStatus(fakeChain().context(notObject), [PUBKEY_A], {
              lockHash: LOCK,
            }),
          )
        ).code,
      ).toBe('STATUS_UNAVAILABLE');
    });

    it('throws API_RESPONSE_MISMATCH for another lock', async () => {
      const api = fakeApi({
        [`/v1/lock/${LOCK}`]: () => ({
          lock_hash: `0x${'22'.repeat(32)}`,
          distributed_validators: [],
        }),
      });
      expect(
        (
          await caught(
            getDepositStatus(fakeChain().context(api), [PUBKEY_A], {
              lockHash: LOCK,
            }),
          )
        ).code,
      ).toBe('API_RESPONSE_MISMATCH');
    });

    it('falls back to the beacon node when the API fails', async () => {
      const api = fakeApi({
        [`/v1/lock/${LOCK}`]: () => {
          throw new ObolApiError('API_ERROR', 'down', {
            status: 502,
            endpoint: '/v1/lock',
            method: 'GET',
          });
        },
      });
      mockBeacon([], [registryRow(PUBKEY_A, 'active_ongoing')]);
      const [a] = await getDepositStatus(fakeChain().context(api), [PUBKEY_A], {
        lockHash: LOCK,
        beaconUrl: BEACON,
      });
      expect(a).toMatchObject({ status: 'active', source: 'chain' });
    });

    it('throws the API error without a beacon node', async () => {
      const api = fakeApi({});
      const error = await caught(
        getDepositStatus(fakeChain().context(api), [PUBKEY_A], {
          lockHash: LOCK,
        }),
      );
      expect(error.message).toMatch(/no route/);
    });
  });

  describe('from a beacon node', () => {
    it('reads the queue before the registry and maps every case', async () => {
      const calls = mockBeacon(
        [
          {
            pubkey: PUBKEY_B,
            withdrawal_credentials: CREDS,
            amount: (32n * GWEI).toString(),
            slot: '1',
          },
          {
            pubkey: PUBKEY_B,
            withdrawal_credentials: OTHER_CREDS,
            amount: GWEI.toString(),
            slot: '2',
          },
          {
            pubkey: PUBKEY_A,
            withdrawal_credentials: CREDS,
            amount: GWEI.toString(),
            slot: '3',
          },
          {
            pubkey: `0x${'ff'.repeat(48)}`,
            withdrawal_credentials: CREDS,
            amount: '1',
            slot: '4',
          },
        ],
        [registryRow(PUBKEY_A, 'pending_initialized')],
      );
      const result = await getDepositStatus(
        fakeChain().context(),
        [PUBKEY_A, PUBKEY_B, PUBKEY_C],
        { beaconUrl: BEACON },
      );
      expect(calls.map(c => c.url)).toEqual([
        'http://beacon.local:5052/eth/v1/beacon/states/head/pending_deposits',
        'http://beacon.local:5052/eth/v1/beacon/states/head/validators',
      ]);
      expect(JSON.parse(String(calls[1].init?.body))).toEqual({
        ids: [PUBKEY_A, PUBKEY_B, PUBKEY_C],
      });
      expect(result[0]).toEqual({
        pubkey: PUBKEY_A,
        status: 'queued',
        source: 'chain',
        beaconStatus: 'pending_initialized',
        validatorIndex: 42,
        withdrawalCredentials: CREDS,
        balance: 32n * ETH + 5n * GWEI,
        effectiveBalance: 32n * ETH,
        pendingDeposits: [{ amount: ETH, withdrawalCredentials: CREDS }],
      });
      expect(result[1]).toEqual({
        pubkey: PUBKEY_B,
        status: 'queued',
        source: 'chain',
        beaconStatus: 'pending_deposit',
        withdrawalCredentials: CREDS,
        pendingDeposits: [
          { amount: 32n * ETH, withdrawalCredentials: CREDS },
          { amount: ETH, withdrawalCredentials: OTHER_CREDS },
        ],
      });
      expect(result[2]).toEqual({
        pubkey: PUBKEY_C,
        status: 'new',
        source: 'chain',
        pendingDeposits: [],
      });
    });

    it('works with the API disabled and keeps input order and duplicates', async () => {
      mockBeacon([], [registryRow(PUBKEY_A, 'exited_unslashed')]);
      const result = await getDepositStatus(
        fakeChain().context(),
        [PUBKEY_A, PUBKEY_A],
        { beaconUrl: BEACON },
      );
      expect(result.map(r => r.status)).toEqual(['exited', 'exited']);
    });

    it.each([
      [
        'a duplicate result',
        [],
        [
          registryRow(PUBKEY_A, 'active_ongoing'),
          registryRow(PUBKEY_A, 'active_ongoing'),
        ],
      ],
      [
        'a missing pubkey',
        [],
        [{ ...registryRow(PUBKEY_A, 'active_ongoing'), validator: {} }],
      ],
      [
        'bad credentials',
        [{ pubkey: PUBKEY_A, withdrawal_credentials: '0x01', amount: '1' }],
        [],
      ],
      ['an unknown status', [], [registryRow(PUBKEY_A, 'sleeping')]],
      [
        'a bad amount',
        [{ pubkey: PUBKEY_A, withdrawal_credentials: CREDS, amount: '-1' }],
        [],
      ],
    ])(
      'throws STATUS_UNAVAILABLE for %s',
      async (_name, pending, validators) => {
        mockBeacon(pending as unknown[], validators as unknown[]);
        const error = await caught(
          getDepositStatus(fakeChain().context(), [PUBKEY_A], {
            beaconUrl: BEACON,
          }),
        );
        expect(error.code).toBe('STATUS_UNAVAILABLE');
      },
    );

    it('throws STATUS_UNAVAILABLE for an HTTP error or a body without data', async () => {
      global.fetch = (async () =>
        jsonResponse({}, 500)) as unknown as typeof fetch;
      expect(
        (
          await caught(
            getDepositStatus(fakeChain().context(), [PUBKEY_A], {
              beaconUrl: BEACON,
            }),
          )
        ).code,
      ).toBe('STATUS_UNAVAILABLE');
      global.fetch = (async () =>
        jsonResponse({ nope: 1 })) as unknown as typeof fetch;
      expect(
        (
          await caught(
            getDepositStatus(fakeChain().context(), [PUBKEY_A], {
              beaconUrl: BEACON,
            }),
          )
        ).code,
      ).toBe('STATUS_UNAVAILABLE');
    });

    it('rejects a beaconUrl that is not http(s)', async () => {
      const error = await caught(
        getDepositStatus(fakeChain().context(), [PUBKEY_A], {
          beaconUrl: 'ftp://x',
        }),
      );
      expect(error.code).toBe('PAYLOAD_INVALID');
    });
  });

  describe('without a source', () => {
    it('throws API_DISABLED with api: false and no beaconUrl', async () => {
      const ctx = fakeChain().context();
      expect(canReadStatus(ctx, {})).toBe(false);
      expect((await caught(getDepositStatus(ctx, [PUBKEY_A]))).code).toBe(
        'API_DISABLED',
      );
    });

    it('asks for a lockHash with the API on and no beaconUrl', async () => {
      const error = await caught(
        getDepositStatus(fakeChain().context(fakeApi({})), [PUBKEY_A]),
      );
      expect(error.code).toBe('PAYLOAD_INVALID');
      expect(error.details.issues[0].path).toBe('options.lockHash');
    });

    it('rejects malformed pubkeys', async () => {
      const error = await caught(
        getDepositStatus(fakeChain().context(), ['0x12' as Hex]),
      );
      expect(error.code).toBe('PAYLOAD_INVALID');
    });
  });
});
