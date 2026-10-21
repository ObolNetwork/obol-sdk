import { jest } from '@jest/globals';
import type { Hex } from 'viem';
import { ObolApiError } from '../../src/errors.js';
import {
  canReadStatus,
  effectiveCredentials,
  getDepositStatus,
  statusFromBeacon,
  statusIfAvailable,
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

const mockBeacon = (
  pending: unknown[],
  validators: unknown[],
  partials: unknown[] = [],
) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = jest.fn(async (url: any, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/pending_deposits')) {
      return jsonResponse({ data: pending });
    }
    if (String(url).endsWith('/pending_partial_withdrawals')) {
      return jsonResponse({ data: partials });
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
    activation_epoch: status === 'pending_initialized' ? FAR_FUTURE : '100',
    exit_epoch: FAR_FUTURE,
  },
  ...extra,
});

const FAR_FUTURE = (2n ** 64n - 1n).toString();

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

  describe('from the Obol API (POST /v1/validators/:network/deposit-status)', () => {
    const ROUTE = 'POST /v1/validators/hoodi/deposit-status';
    const ZERO = `0x${'00'.repeat(32)}` as Hex;
    const OTHER = '0x3000000000000000000000000000000000000003';
    const wei = (amount: bigint): string => amount.toString();
    const registry = (pubkey: Hex, extra: object = {}): object => ({
      pubkey,
      status: 'active',
      beaconStatus: 'active_ongoing',
      index: 7,
      balance: wei(32n * ETH + 5n * GWEI),
      effectiveBalance: wei(32n * ETH),
      withdrawalCredentials: CREDS,
      pendingDeposits: [],
      ...extra,
    });
    const queued = (pubkey: Hex, deposits: Array<[bigint, Hex]>): object => ({
      pubkey,
      status: 'queued',
      beaconStatus: 'pending_deposit',
      index: null,
      balance: null,
      effectiveBalance: null,
      withdrawalCredentials: deposits[0][1],
      pendingDeposits: deposits.map(([amount, credentials]) => ({
        amount: wei(amount),
        withdrawalCredentials: credentials,
      })),
    });
    const fresh = (pubkey: Hex): object => ({
      pubkey,
      status: 'new',
      beaconStatus: null,
      index: null,
      balance: null,
      effectiveBalance: null,
      withdrawalCredentials: null,
      pendingDeposits: [],
    });
    const serving = (answer: (pubkeys: Hex[]) => unknown[]) =>
      fakeApi({
        [ROUTE]: body => ({
          validators: answer((body as { pubkeys: Hex[] }).pubkeys),
        }),
      });

    it('reads activationEpoch, exitEpoch and pendingPartialWithdrawals (#1047)', async () => {
      const api = serving(() => [
        registry(PUBKEY_A, {
          activationEpoch: '12345',
          exitEpoch: null,
          pendingPartialWithdrawals: wei(2n * ETH),
        }),
        registry(PUBKEY_B, {
          beaconStatus: 'active_exiting',
          activationEpoch: '10',
          exitEpoch: '67890',
          pendingPartialWithdrawals: '0',
        }),
      ]);
      const [a, b] = await getDepositStatus(fakeChain().context(api), [
        PUBKEY_A,
        PUBKEY_B,
      ]);
      expect(a).toMatchObject({
        activationEpoch: 12345n,
        exitEpoch: null,
        pendingPartialWithdrawals: 2n * ETH,
      });
      expect(b).toMatchObject({ activationEpoch: 10n, exitEpoch: 67890n });
    });

    it.each([
      ['a malformed activation epoch', { activationEpoch: 12 }],
      ['a malformed exit epoch', { exitEpoch: '-1' }],
      [
        'malformed pending partial withdrawals',
        { pendingPartialWithdrawals: '1.5' },
      ],
    ])('throws STATUS_UNAVAILABLE for %s', async (_n, extra) => {
      const api = serving(() => [registry(PUBKEY_A, extra)]);
      expect(
        (await caught(getDepositStatus(fakeChain().context(api), [PUBKEY_A])))
          .code,
      ).toBe('STATUS_UNAVAILABLE');
    });

    it('maps registry, queue-only and new pubkeys; no lockHash needed', async () => {
      const api = serving(() => [
        registry(PUBKEY_A, {
          pendingDeposits: [{ amount: wei(ETH), withdrawalCredentials: ZERO }],
        }),
        queued(PUBKEY_B, [
          [32n * ETH, CREDS],
          [ETH, OTHER_CREDS],
        ]),
        fresh(PUBKEY_C),
      ]);
      const ctx = fakeChain().context(api);
      expect(canReadStatus(ctx, {})).toBe(true);
      const [a, b, c, a2] = await getDepositStatus(ctx, [
        PUBKEY_A,
        PUBKEY_B.toUpperCase().replace('0X', '0x') as Hex,
        PUBKEY_C,
        PUBKEY_A,
      ]);
      expect(api.calls).toEqual([
        {
          method: 'POST',
          endpoint: '/v1/validators/hoodi/deposit-status',
          body: { pubkeys: [PUBKEY_A, PUBKEY_B, PUBKEY_C] },
        },
      ]);
      expect(a).toEqual({
        pubkey: PUBKEY_A,
        status: 'active',
        source: 'api',
        beaconStatus: 'active_ongoing',
        validatorIndex: 7,
        withdrawalCredentials: CREDS,
        balance: 32n * ETH + 5n * GWEI,
        effectiveBalance: 32n * ETH,
        pendingDeposits: [{ amount: ETH, withdrawalCredentials: ZERO }],
      });
      expect(a2).toEqual(a);
      expect(b).toEqual({
        pubkey: PUBKEY_B,
        status: 'queued',
        source: 'api',
        beaconStatus: 'pending_deposit',
        withdrawalCredentials: CREDS,
        pendingDeposits: [
          { amount: 32n * ETH, withdrawalCredentials: CREDS },
          { amount: ETH, withdrawalCredentials: OTHER_CREDS },
        ],
      });
      expect(c).toEqual({
        pubkey: PUBKEY_C,
        status: 'new',
        source: 'api',
        pendingDeposits: [],
      });
    });

    it('asks for at most 500 pubkeys per request', async () => {
      const pubkeys = Array.from(
        { length: 1001 },
        (_, i) => `0x${i.toString(16).padStart(96, '0')}` as Hex,
      );
      const api = serving(requested => requested.map(fresh));
      const statuses = await getDepositStatus(
        fakeChain().context(api),
        pubkeys,
      );
      expect(statuses).toHaveLength(1001);
      expect(
        api.calls.map(c => (c.body as { pubkeys: Hex[] }).pubkeys.length),
      ).toEqual([500, 500, 1]);
    });

    describe('queued deposit signatures', () => {
      const checked = (
        pubkey: Hex,
        deposits: Array<[bigint, Hex, boolean | null]>,
        extra: object = {},
      ): object => {
        const valid = deposits.filter(([, , v]) => v === true);
        const distinct = new Set(
          valid.map(([, c]) => c).filter(c => c !== ZERO),
        );
        return {
          ...(queued(pubkey, [[0n, ZERO]]) as object),
          withdrawalCredentials: valid[0]?.[1] ?? null,
          signaturesPending: false,
          credentialsConflict: distinct.size > 1,
          pendingDeposits: deposits.map(([amount, c, signatureValid]) => ({
            amount: wei(amount),
            withdrawalCredentials: c,
            signatureValid,
          })),
          ...extra,
        };
      };
      const pending = (pubkey: Hex): object =>
        checked(
          pubkey,
          [
            [32n * ETH, credentials('01', OTHER), null],
            [32n * ETH, CREDS, null],
          ],
          {
            withdrawalCredentials: null,
            signaturesPending: true,
            credentialsConflict: null,
          },
        );

      it('reads signatureValid, signaturesPending and credentialsConflict', async () => {
        const api = serving(() => [
          registry(PUBKEY_A, {
            signaturesPending: false,
            credentialsConflict: false,
            pendingDeposits: [
              {
                amount: wei(ETH),
                withdrawalCredentials: ZERO,
                signatureValid: null,
              },
            ],
          }),
          checked(PUBKEY_B, [
            [32n * ETH, credentials('01', OTHER), false],
            [32n * ETH, CREDS, true],
          ]),
          {
            ...(fresh(PUBKEY_C) as object),
            signaturesPending: false,
            credentialsConflict: false,
          },
        ]);
        const [a, b, c] = await getDepositStatus(
          fakeChain().context(api),
          [PUBKEY_A, PUBKEY_B, PUBKEY_C],
          { expectedWithdrawalAddress: OVM },
        );
        expect(a).toMatchObject({
          signaturesPending: false,
          credentialsConflict: false,
          pendingDeposits: [
            { amount: ETH, withdrawalCredentials: ZERO, signatureValid: null },
          ],
        });
        // The invalid first deposit is skipped: the valid second one applies.
        expect(b).toEqual({
          pubkey: PUBKEY_B,
          status: 'queued',
          source: 'api',
          beaconStatus: 'pending_deposit',
          withdrawalCredentials: CREDS,
          signaturesPending: false,
          credentialsConflict: false,
          pendingDeposits: [
            {
              amount: 32n * ETH,
              withdrawalCredentials: credentials('01', OTHER),
              signatureValid: false,
            },
            {
              amount: 32n * ETH,
              withdrawalCredentials: CREDS,
              signatureValid: true,
            },
          ],
          credentialsMatch: true,
        });
        expect(c).toMatchObject({
          status: 'new',
          signaturesPending: false,
          credentialsMatch: null,
        });
      });

      it('leaves the signature fields absent for an older API answer', async () => {
        const api = serving(() => [
          queued(PUBKEY_A, [
            [32n * ETH, credentials('01', OTHER)],
            [32n * ETH, CREDS],
          ]),
        ]);
        const [a] = await getDepositStatus(
          fakeChain().context(api),
          [PUBKEY_A],
          {
            expectedWithdrawalAddress: OVM,
          },
        );
        expect(a).not.toHaveProperty('signaturesPending');
        expect(a).not.toHaveProperty('credentialsConflict');
        expect(a.pendingDeposits[0]).not.toHaveProperty('signatureValid');
        // No signature checks: the first queued deposit's credentials apply.
        expect(a.withdrawalCredentials).toBe(credentials('01', OTHER));
        expect(a.credentialsMatch).toBe(false);
      });

      it('has no credentials when no queued deposit is validly signed', async () => {
        const api = serving(() => [
          checked(PUBKEY_A, [[32n * ETH, CREDS, false]]),
        ]);
        const [a] = await getDepositStatus(
          fakeChain().context(api),
          [PUBKEY_A],
          {
            expectedWithdrawalAddress: OVM,
          },
        );
        expect(a).not.toHaveProperty('withdrawalCredentials');
        expect(a.credentialsMatch).toBeNull();
      });

      it('re-reads the batch while signatures are pending', async () => {
        let n = 0;
        const api = serving(() => {
          n++;
          return [
            registry(PUBKEY_A),
            n === 1
              ? pending(PUBKEY_B)
              : checked(PUBKEY_B, [
                  [32n * ETH, credentials('01', OTHER), false],
                  [32n * ETH, CREDS, true],
                ]),
          ];
        });
        const [, b] = await getDepositStatus(
          fakeChain().context(api),
          [PUBKEY_A, PUBKEY_B],
          { pendingRetry: { delayMs: 0 } },
        );
        expect(api.calls).toHaveLength(2);
        expect(api.calls[1].body).toEqual({ pubkeys: [PUBKEY_A, PUBKEY_B] });
        expect(b).toMatchObject({
          signaturesPending: false,
          withdrawalCredentials: CREDS,
        });
      });

      it('returns the entry as pending after the retries, without credentials', async () => {
        const api = serving(() => [pending(PUBKEY_A)]);
        const [a] = await getDepositStatus(
          fakeChain().context(api),
          [PUBKEY_A],
          {
            expectedWithdrawalAddress: OVM,
            pendingRetry: { delayMs: 0 },
          },
        );
        expect(api.calls).toHaveLength(3);
        expect(a).toMatchObject({
          status: 'queued',
          signaturesPending: true,
          credentialsConflict: null,
          credentialsMatch: null,
        });
        expect(a).not.toHaveProperty('withdrawalCredentials');
        expect(a.pendingDeposits.map(p => p.signatureValid)).toEqual([
          null,
          null,
        ]);

        const once = serving(() => [pending(PUBKEY_A)]);
        await getDepositStatus(fakeChain().context(once), [PUBKEY_A], {
          pendingRetry: { tries: 1 },
        });
        expect(once.calls).toHaveLength(1);
      });

      // The API decides the credentials once every deposit up to the first
      // validly signed one is checked; later deposits may still be pending.
      const decided = (pubkey: Hex, extra: object = {}): object =>
        checked(
          pubkey,
          [
            [32n * ETH, credentials('01', OTHER), false],
            [32n * ETH, CREDS, true],
            [ETH, credentials('01', OTHER), null],
          ],
          {
            withdrawalCredentials: CREDS,
            signaturesPending: true,
            credentialsConflict: null,
            ...extra,
          },
        );

      it('returns decided credentials while later signatures are pending', async () => {
        const api = serving(() => [decided(PUBKEY_A)]);
        const [a] = await getDepositStatus(
          fakeChain().context(api),
          [PUBKEY_A],
          { expectedWithdrawalAddress: OVM, pendingRetry: { tries: 1 } },
        );
        expect(a).toMatchObject({
          status: 'queued',
          signaturesPending: true,
          credentialsConflict: null,
          withdrawalCredentials: CREDS,
          credentialsMatch: true,
        });
        expect(effectiveCredentials(a)).toBe(CREDS);
      });

      it.each<[string, object]>([
        [
          'credentials while an unchecked deposit comes first',
          pending(PUBKEY_A),
        ],
        ['no credentials once decided', decided(PUBKEY_A)],
      ])('throws STATUS_UNAVAILABLE for %s', async (name, entry) => {
        const api = serving(() => [
          {
            ...entry,
            withdrawalCredentials: name.startsWith('no') ? null : CREDS,
          },
        ]);
        expect(
          (
            await caught(
              getDepositStatus(fakeChain().context(api), [PUBKEY_A], {
                pendingRetry: { tries: 1 },
              }),
            )
          ).code,
        ).toBe('STATUS_UNAVAILABLE');
      });

      it('waits 8 s, then 16 s, by default', async () => {
        jest.useFakeTimers();
        try {
          const api = serving(() => [pending(PUBKEY_A)]);
          const read = getDepositStatus(fakeChain().context(api), [PUBKEY_A]);
          await jest.advanceTimersByTimeAsync(7_999);
          expect(api.calls).toHaveLength(1);
          await jest.advanceTimersByTimeAsync(1);
          expect(api.calls).toHaveLength(2);
          await jest.advanceTimersByTimeAsync(15_999);
          expect(api.calls).toHaveLength(2);
          await jest.advanceTimersByTimeAsync(1);
          expect((await read)[0].signaturesPending).toBe(true);
          expect(api.calls).toHaveLength(3);
        } finally {
          jest.useRealTimers();
        }
      });

      it('rejects a malformed pendingRetry', async () => {
        const api = serving(() => []);
        for (const pendingRetry of [
          { tries: 0 },
          { delayMs: -1 },
          { retries: 2 },
        ]) {
          expect(
            (
              await caught(
                getDepositStatus(fakeChain().context(api), [PUBKEY_A], {
                  pendingRetry: pendingRetry as any,
                }),
              )
            ).code,
          ).toBe('PAYLOAD_INVALID');
        }
      });

      it.each<[string, object]>([
        ['a malformed signaturesPending', { signaturesPending: 'no' }],
        ['a malformed credentialsConflict', { credentialsConflict: 1 }],
        [
          'a null credentialsConflict without pending signatures',
          { credentialsConflict: null },
        ],
        [
          'a credentialsConflict while signatures are pending',
          { signaturesPending: true, withdrawalCredentials: null },
        ],
        [
          'credentials that are not the first validly signed deposit',
          { withdrawalCredentials: credentials('01', OTHER) },
        ],
        ['a contradicted credentialsConflict', { credentialsConflict: true }],
        [
          'a malformed signatureValid',
          {
            pendingDeposits: [
              {
                amount: wei(ETH),
                withdrawalCredentials: CREDS,
                signatureValid: 'yes',
              },
            ],
          },
        ],
        [
          'an unchecked deposit without pending signatures',
          {
            pendingDeposits: [
              {
                amount: wei(ETH),
                withdrawalCredentials: CREDS,
                signatureValid: null,
              },
            ],
          },
        ],
      ])('throws STATUS_UNAVAILABLE for %s', async (_name, extra) => {
        const api = serving(() => [
          checked(
            PUBKEY_A,
            [
              [32n * ETH, credentials('01', OTHER), false],
              [32n * ETH, CREDS, true],
            ],
            extra,
          ),
        ]);
        expect(
          (await caught(getDepositStatus(fakeChain().context(api), [PUBKEY_A])))
            .code,
        ).toBe('STATUS_UNAVAILABLE');
      });

      it('throws STATUS_UNAVAILABLE for pending signatures on a registered or new pubkey', async () => {
        for (const entry of [
          registry(PUBKEY_A, {
            signaturesPending: true,
            credentialsConflict: null,
          }),
          {
            ...(fresh(PUBKEY_A) as object),
            signaturesPending: true,
            credentialsConflict: null,
          },
        ]) {
          const api = serving(() => [entry]);
          expect(
            (
              await caught(
                getDepositStatus(fakeChain().context(api), [PUBKEY_A]),
              )
            ).code,
          ).toBe('STATUS_UNAVAILABLE');
        }
      });
    });

    it.each<[string, (pubkeys: Hex[]) => unknown[]]>([
      ['a pubkey left out', p => p.slice(1).map(fresh)],
      ['a pubkey twice', p => [...p.map(fresh), fresh(p[0])]],
      ['a pubkey not asked for', p => [...p.map(fresh), fresh(PUBKEY_C)]],
      ['an unknown status', p => [registry(p[0], { status: 'gone' })]],
      [
        'a status that is not the beacon status',
        p => [registry(p[0], { status: 'exited' })],
      ],
      ['a malformed index', p => [registry(p[0], { index: '7' })]],
      ['a balance in ETH', p => [registry(p[0], { balance: '32.5' })]],
      [
        'malformed credentials',
        p => [registry(p[0], { withdrawalCredentials: '0x01' })],
      ],
      [
        'a queued status without deposits',
        p => [
          { ...(queued(p[0], [[ETH, CREDS]]) as object), pendingDeposits: [] },
        ],
      ],
      [
        'a new pubkey with deposits',
        p => [
          {
            ...(fresh(p[0]) as object),
            pendingDeposits: [{ amount: '1', withdrawalCredentials: CREDS }],
          },
        ],
      ],
    ])('throws STATUS_UNAVAILABLE for %s', async (_name, answer) => {
      const error = await caught(
        getDepositStatus(fakeChain().context(serving(answer)), [
          PUBKEY_A,
          PUBKEY_B,
        ]),
      );
      expect(error.code).toBe('STATUS_UNAVAILABLE');
    });

    it('falls back to /v1/state/:lockHash while the route answers 404', async () => {
      const api = apiWith({});
      const [a] = await getDepositStatus(fakeChain().context(api), [PUBKEY_A], {
        lockHash: LOCK,
      });
      expect(a).toMatchObject({ status: 'new', source: 'api' });
      expect(api.calls.map(c => c.endpoint)).toEqual([
        '/v1/validators/hoodi/deposit-status',
        `/v1/lock/${LOCK}`,
        `/v1/state/${LOCK}`,
      ]);
    });

    it('falls back to the beacon node for a 404 without lockHash, or an API failure', async () => {
      mockBeacon([], [registryRow(PUBKEY_A, 'active_ongoing')]);
      const [a] = await getDepositStatus(
        fakeChain().context(fakeApi({})),
        [PUBKEY_A],
        { beaconUrl: BEACON },
      );
      expect(a).toMatchObject({ status: 'active', source: 'chain' });
      const down = fakeApi({
        [ROUTE]: () => {
          throw new ObolApiError('API_ERROR', 'down', {
            status: 502,
            endpoint: '/v1/validators/hoodi/deposit-status',
            method: 'POST',
          });
        },
      });
      const [b] = await getDepositStatus(
        fakeChain().context(down),
        [PUBKEY_A],
        {
          beaconUrl: BEACON,
        },
      );
      expect(b).toMatchObject({ source: 'chain' });
      expect(
        (await caught(getDepositStatus(fakeChain().context(down), [PUBKEY_A])))
          .code,
      ).toBe('API_ERROR');
    });

    it('treats an API without the route and no fallback as no source for writes', async () => {
      const ctx = fakeChain().context(fakeApi({}));
      expect(await statusIfAvailable(ctx, [PUBKEY_A], {})).toBeNull();
      const broken = fakeChain().context(serving(() => []));
      expect(
        (await caught(statusIfAvailable(broken, [PUBKEY_A], {}))).code,
      ).toBe('STATUS_UNAVAILABLE');
    });

    it('sets credentialsMatch with expectedWithdrawalAddress', async () => {
      const pubkeys = [
        PUBKEY_A,
        PUBKEY_B,
        PUBKEY_C,
        `0x${'d4'.repeat(48)}` as Hex,
      ];
      const api = serving(() => [
        registry(PUBKEY_A),
        // A queued zero-credential top-up does not set the credentials.
        queued(PUBKEY_B, [
          [ETH, ZERO],
          [32n * ETH, OTHER_CREDS],
        ]),
        fresh(PUBKEY_C),
        registry(pubkeys[3], { withdrawalCredentials: credentials('00', OVM) }),
      ]);
      const ctx = fakeChain().context(api);
      const statuses = await getDepositStatus(ctx, pubkeys, {
        expectedWithdrawalAddress: OVM,
      });
      expect(statuses.map(s => s.credentialsMatch)).toEqual([
        true,
        true,
        null,
        false,
      ]);
      const other = await getDepositStatus(ctx, pubkeys, {
        expectedWithdrawalAddress: OTHER,
      });
      expect(other.map(s => s.credentialsMatch)).toEqual([
        false,
        false,
        null,
        false,
      ]);
      const without = await getDepositStatus(ctx, pubkeys);
      expect(without[0]).not.toHaveProperty('credentialsMatch');
    });
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
        'http://beacon.local:5052/eth/v1/beacon/states/head/pending_partial_withdrawals',
        'http://beacon.local:5052/eth/v1/beacon/states/head/validators',
      ]);
      expect(JSON.parse(String(calls[2].init?.body))).toEqual({
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
        activationEpoch: null,
        exitEpoch: null,
        pendingPartialWithdrawals: 0n,
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

    it('sums pending partial withdrawals by validator index and reads the epochs', async () => {
      mockBeacon(
        [],
        [
          registryRow(PUBKEY_A, 'active_ongoing'),
          {
            ...registryRow(PUBKEY_B, 'active_exiting', { index: '43' }),
          },
        ],
        [
          {
            validator_index: '42',
            amount: GWEI.toString(),
            withdrawable_epoch: '9',
          },
          {
            validator_index: '42',
            amount: (2n * GWEI).toString(),
            withdrawable_epoch: '9',
          },
          { validator_index: '7', amount: '5', withdrawable_epoch: '9' },
        ],
      );
      const [a, b] = await getDepositStatus(
        fakeChain().context(),
        [PUBKEY_A, PUBKEY_B],
        { beaconUrl: BEACON },
      );
      expect(a).toMatchObject({
        activationEpoch: 100n,
        exitEpoch: null,
        pendingPartialWithdrawals: 3n * ETH,
      });
      expect(b).toMatchObject({ pendingPartialWithdrawals: 0n });
    });

    it('throws STATUS_UNAVAILABLE for a malformed pending partial withdrawal', async () => {
      mockBeacon(
        [],
        [registryRow(PUBKEY_A, 'active_ongoing')],
        [{ validator_index: 'x', amount: '1' }],
      );
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

    it('asks for a lockHash or beaconUrl while the API lacks deposit-status', async () => {
      const error = await caught(
        getDepositStatus(fakeChain().context(fakeApi({})), [PUBKEY_A]),
      );
      expect(error.code).toBe('STATUS_UNAVAILABLE');
      expect(error.details).toEqual({ reason: 'endpoint_unavailable' });
    });

    it('rejects malformed pubkeys', async () => {
      const error = await caught(
        getDepositStatus(fakeChain().context(), ['0x12' as Hex]),
      );
      expect(error.code).toBe('PAYLOAD_INVALID');
    });
  });
});
