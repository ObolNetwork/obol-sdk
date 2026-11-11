// The Obol API deposit-status answer, entry by entry: which malformed or
// inconsistent entry is refused with which message (the first check that
// fails decides it), and the exact status a well-formed one becomes.
import type { Hex } from 'viem';
import { getDepositStatus } from '../../src/deposits/status.js';
import { fakeApi, fakeChain } from '../helpers/fakeChain.js';
import {
  caught,
  credentials,
  ETH,
  GWEI,
  OVM,
  PUBKEY_A,
} from '../ovm/ovmFixture.js';

const ROUTE = 'POST /v1/validators/hoodi/deposit-status';
const CREDS = credentials('01', OVM);
const OTHER_CREDS = credentials(
  '01',
  '0x3000000000000000000000000000000000000003',
);
const ZERO_CREDS = `0x${'00'.repeat(32)}` as Hex;
const FAR_FUTURE = (2n ** 64n - 1n).toString();
const BALANCE = (32n * ETH + 5n * GWEI).toString();
const EFFECTIVE = (32n * ETH).toString();

const registry = (extra: object = {}): Record<string, unknown> => ({
  pubkey: PUBKEY_A,
  status: 'active',
  beaconStatus: 'active_ongoing',
  index: 7,
  balance: BALANCE,
  effectiveBalance: EFFECTIVE,
  withdrawalCredentials: CREDS,
  pendingDeposits: [],
  ...extra,
});

const deposit = (
  credentials: unknown = CREDS,
  signatureValid?: unknown,
  amount: unknown = ETH.toString(),
): Record<string, unknown> => ({
  amount,
  withdrawalCredentials: credentials,
  ...(signatureValid !== undefined ? { signatureValid } : {}),
});

const queued = (extra: object = {}): Record<string, unknown> => ({
  pubkey: PUBKEY_A,
  status: 'queued',
  beaconStatus: 'pending_deposit',
  index: null,
  balance: null,
  effectiveBalance: null,
  withdrawalCredentials: CREDS,
  pendingDeposits: [deposit()],
  ...extra,
});

const fresh = (extra: object = {}): Record<string, unknown> => ({
  pubkey: PUBKEY_A,
  status: 'new',
  beaconStatus: null,
  index: null,
  balance: null,
  effectiveBalance: null,
  withdrawalCredentials: null,
  pendingDeposits: [],
  ...extra,
});

const read = async (entry: unknown): Promise<unknown> => {
  const api = fakeApi({ [ROUTE]: () => ({ validators: [entry] }) });
  const [status] = await getDepositStatus(
    fakeChain().context(api),
    [PUBKEY_A],
    { pendingRetry: { tries: 1 } },
  );
  return status;
};

const refusal = async (entry: unknown): Promise<string> => {
  const error = await caught(read(entry));
  expect(error.code).toBe('STATUS_UNAVAILABLE');
  return error.message;
};

const FOR = ` for ${PUBKEY_A}`;

describe('deposit-status entries (Obol API)', () => {
  it.each<[string, unknown, string]>([
    ['a null entry', null, 'a malformed pubkey'],
    ['a short pubkey', registry({ pubkey: '0x12' }), 'a malformed pubkey'],
    [
      'a pubkey that is not a string, before its unknown status',
      registry({ pubkey: 7, status: 'gone' }),
      'a malformed pubkey',
    ],
    [
      'an unknown status',
      registry({ status: 'gone' }),
      `an unknown status${FOR}`,
    ],
    [
      'a status that is not a string',
      registry({ status: 1 }),
      `an unknown status${FOR}`,
    ],
    [
      'an unknown status before malformed pending deposits',
      registry({ status: 'gone', pendingDeposits: null }),
      `an unknown status${FOR}`,
    ],
    [
      'pending deposits that are not a list',
      registry({ pendingDeposits: {} }),
      `malformed pending deposits${FOR}`,
    ],
    [
      'malformed pending deposits before a malformed signaturesPending',
      registry({ pendingDeposits: undefined, signaturesPending: 'no' }),
      `malformed pending deposits${FOR}`,
    ],
    [
      'a malformed signaturesPending',
      registry({ signaturesPending: 'no', credentialsConflict: 1 }),
      `a malformed signaturesPending${FOR}`,
    ],
    [
      'a malformed credentialsConflict',
      registry({ signaturesPending: false, credentialsConflict: 1 }),
      `a malformed credentialsConflict${FOR}`,
    ],
    [
      'a decided credentialsConflict while signatures are pending',
      queued({ signaturesPending: true, credentialsConflict: false }),
      `a credentialsConflict inconsistent with signaturesPending${FOR}`,
    ],
    [
      'a null credentialsConflict without pending signatures',
      queued({ signaturesPending: false, credentialsConflict: null }),
      `a credentialsConflict inconsistent with signaturesPending${FOR}`,
    ],
    [
      'a null credentialsConflict without signaturesPending',
      registry({ credentialsConflict: null }),
      `a credentialsConflict inconsistent with signaturesPending${FOR}`,
    ],
    [
      'an inconsistent credentialsConflict before a malformed deposit',
      queued({
        signaturesPending: false,
        credentialsConflict: null,
        pendingDeposits: [deposit('0x01')],
      }),
      `a credentialsConflict inconsistent with signaturesPending${FOR}`,
    ],
    [
      'a pending deposit amount in ETH',
      queued({ pendingDeposits: [deposit(CREDS, undefined, '1.5')] }),
      `a malformed pending deposit amount${FOR}`,
    ],
    [
      'a pending deposit that is null',
      queued({ pendingDeposits: [null] }),
      `a malformed pending deposit amount${FOR}`,
    ],
    [
      'a malformed amount before malformed credentials',
      queued({ pendingDeposits: [deposit('0x01', undefined, 5)] }),
      `a malformed pending deposit amount${FOR}`,
    ],
    [
      'malformed pending deposit credentials',
      queued({ pendingDeposits: [deposit('0x01')] }),
      `malformed pending deposit credentials${FOR}`,
    ],
    [
      'pending deposit credentials that are not a string',
      queued({ pendingDeposits: [deposit(), deposit(null)] }),
      `malformed pending deposit credentials${FOR}`,
    ],
    [
      'malformed credentials before a malformed signatureValid',
      queued({ pendingDeposits: [deposit('0x01', 'yes')] }),
      `malformed pending deposit credentials${FOR}`,
    ],
    [
      'a malformed signatureValid',
      queued({ pendingDeposits: [deposit(CREDS, 'yes')] }),
      `a malformed pending deposit signatureValid${FOR}`,
    ],
    [
      'a malformed deposit before an inconsistent new status',
      fresh({ index: 1, pendingDeposits: [deposit('0x01')] }),
      `malformed pending deposit credentials${FOR}`,
    ],
    [
      'a new status with a beacon status',
      fresh({ beaconStatus: 'active_ongoing' }),
      `an inconsistent new status${FOR}`,
    ],
    [
      'a new status with an index',
      fresh({ index: 7 }),
      `an inconsistent new status${FOR}`,
    ],
    [
      'a new status with a queued deposit',
      fresh({ pendingDeposits: [deposit()] }),
      `an inconsistent new status${FOR}`,
    ],
    [
      'a new status with pending signatures',
      fresh({ signaturesPending: true, credentialsConflict: null }),
      `an inconsistent new status${FOR}`,
    ],
    [
      'a status that is not the beacon status',
      registry({ status: 'exited' }),
      `a beacon status that is not exited${FOR}`,
    ],
    [
      'a beacon status that is not a string',
      registry({ beaconStatus: null }),
      `a beacon status that is not active${FOR}`,
    ],
    [
      'a wrong beacon status before malformed credentials',
      registry({
        beaconStatus: 'exited_slashed',
        withdrawalCredentials: '0x01',
      }),
      `a beacon status that is not active${FOR}`,
    ],
    [
      'malformed withdrawal credentials',
      registry({ withdrawalCredentials: '0x01' }),
      `malformed withdrawal credentials${FOR}`,
    ],
    [
      'withdrawal credentials that are not a string',
      registry({ withdrawalCredentials: 1 }),
      `malformed withdrawal credentials${FOR}`,
    ],
    [
      'malformed credentials of a queued validator, before its index',
      queued({ withdrawalCredentials: '0x01', index: 7 }),
      `malformed withdrawal credentials${FOR}`,
    ],
    [
      'a queued status with an index',
      queued({ index: 7 }),
      `a queued status without a queued deposit${FOR}`,
    ],
    [
      'a queued status without deposits',
      queued({ pendingDeposits: [] }),
      `a queued status without a queued deposit${FOR}`,
    ],
    [
      'credentials that are not the first validly signed deposit',
      queued({
        signaturesPending: false,
        credentialsConflict: false,
        withdrawalCredentials: OTHER_CREDS,
        pendingDeposits: [deposit(OTHER_CREDS, false), deposit(CREDS, true)],
      }),
      `withdrawal credentials that are not the first validly signed deposit's${FOR}`,
    ],
    [
      'credentials although no deposit is validly signed',
      queued({
        signaturesPending: false,
        credentialsConflict: false,
        pendingDeposits: [deposit(CREDS, false)],
      }),
      `withdrawal credentials that are not the first validly signed deposit's${FOR}`,
    ],
    [
      'credentials decided although an unchecked deposit comes first',
      queued({
        signaturesPending: true,
        credentialsConflict: null,
        pendingDeposits: [deposit(OTHER_CREDS, null), deposit(CREDS, true)],
      }),
      `withdrawal credentials that are not the first validly signed deposit's${FOR}`,
    ],
    [
      'an unchecked deposit without pending signatures',
      queued({
        signaturesPending: false,
        credentialsConflict: false,
        withdrawalCredentials: null,
        pendingDeposits: [deposit(CREDS, null)],
      }),
      `an unchecked queued deposit without signaturesPending${FOR}`,
    ],
    [
      'an unchecked deposit on an API without signaturesPending',
      queued({ pendingDeposits: [deposit(CREDS, true), deposit(CREDS, null)] }),
      `an unchecked queued deposit without signaturesPending${FOR}`,
    ],
    [
      'a credentialsConflict its deposits contradict (claimed)',
      queued({
        signaturesPending: false,
        credentialsConflict: true,
        pendingDeposits: [deposit(CREDS, true), deposit(CREDS, true)],
      }),
      `a credentialsConflict that its queued deposits contradict${FOR}`,
    ],
    [
      'a credentialsConflict its deposits contradict (denied)',
      queued({
        signaturesPending: false,
        credentialsConflict: false,
        pendingDeposits: [deposit(CREDS, true), deposit(OTHER_CREDS, true)],
      }),
      `a credentialsConflict that its queued deposits contradict${FOR}`,
    ],
    [
      'a queued status without credentials (no signature checks)',
      queued({ withdrawalCredentials: null }),
      `a queued status without withdrawal credentials${FOR}`,
    ],
    [
      'pending signatures on a registered validator',
      registry({ signaturesPending: true, credentialsConflict: null }),
      `signaturesPending for a registered validator${FOR}`,
    ],
    [
      'pending signatures before missing credentials',
      registry({
        signaturesPending: true,
        credentialsConflict: null,
        withdrawalCredentials: null,
        index: '7',
      }),
      `signaturesPending for a registered validator${FOR}`,
    ],
    [
      'a registered validator without credentials, before its index',
      registry({ withdrawalCredentials: null, index: '7' }),
      `malformed withdrawal credentials${FOR}`,
    ],
    [
      'an index that is a string',
      registry({ index: '7' }),
      `a malformed validator index${FOR}`,
    ],
    [
      'a negative index',
      registry({ index: -1 }),
      `a malformed validator index${FOR}`,
    ],
    [
      'a fractional index',
      registry({ index: 1.5 }),
      `a malformed validator index${FOR}`,
    ],
    [
      'a null index',
      registry({ index: null }),
      `a malformed validator index${FOR}`,
    ],
    [
      'a malformed index before a malformed epoch',
      registry({ index: null, activationEpoch: 'x' }),
      `a malformed validator index${FOR}`,
    ],
    [
      'a malformed activation epoch, before the exit epoch',
      registry({ activationEpoch: 'x', exitEpoch: 5 }),
      `a malformed activation epoch${FOR}`,
    ],
    [
      'an exit epoch that is a number',
      registry({ activationEpoch: '1', exitEpoch: 5 }),
      `a malformed exit epoch${FOR}`,
    ],
    [
      'a malformed exit epoch before pending partial withdrawals',
      registry({ exitEpoch: '-1', pendingPartialWithdrawals: 'x' }),
      `a malformed exit epoch${FOR}`,
    ],
    [
      'malformed pending partial withdrawals, before the balance',
      registry({ pendingPartialWithdrawals: null, balance: '32.5' }),
      `a malformed pending partial withdrawals${FOR}`,
    ],
    [
      'a balance in ETH, before the effective balance',
      registry({ balance: '32.5', effectiveBalance: null }),
      `a malformed balance${FOR}`,
    ],
    [
      'a missing effective balance',
      registry({ effectiveBalance: null }),
      `a malformed effective balance${FOR}`,
    ],
  ])('refuses %s', async (_name, entry, what) => {
    expect(await refusal(entry)).toBe(`The Obol API returned ${what}`);
  });

  it('reads a registered validator, with and without the later fields', async () => {
    expect(await read(registry())).toEqual({
      pubkey: PUBKEY_A,
      status: 'active',
      source: 'api',
      beaconStatus: 'active_ongoing',
      validatorIndex: 7,
      withdrawalCredentials: CREDS,
      balance: BigInt(BALANCE),
      effectiveBalance: BigInt(EFFECTIVE),
      pendingDeposits: [],
    });
    expect(
      await read(
        registry({
          pubkey: PUBKEY_A.toUpperCase().replace('0X', '0x'),
          withdrawalCredentials: CREDS.toUpperCase().replace('0X', '0x'),
          index: 0,
          activationEpoch: '12',
          exitEpoch: FAR_FUTURE,
          pendingPartialWithdrawals: '0',
          signaturesPending: false,
          credentialsConflict: false,
          pendingDeposits: [deposit(ZERO_CREDS, null, '5')],
        }),
      ),
    ).toEqual({
      pubkey: PUBKEY_A,
      status: 'active',
      source: 'api',
      beaconStatus: 'active_ongoing',
      validatorIndex: 0,
      withdrawalCredentials: CREDS,
      balance: BigInt(BALANCE),
      effectiveBalance: BigInt(EFFECTIVE),
      activationEpoch: 12n,
      exitEpoch: null,
      pendingPartialWithdrawals: 0n,
      signaturesPending: false,
      credentialsConflict: false,
      pendingDeposits: [
        { amount: 5n, withdrawalCredentials: ZERO_CREDS, signatureValid: null },
      ],
    });
    expect(
      await read(
        registry({
          status: 'exited',
          beaconStatus: 'withdrawal_done',
          activationEpoch: null,
          exitEpoch: '99',
        }),
      ),
    ).toMatchObject({
      status: 'exited',
      activationEpoch: null,
      exitEpoch: 99n,
    });
  });

  it('reads a new pubkey', async () => {
    expect(await read(fresh())).toEqual({
      pubkey: PUBKEY_A,
      status: 'new',
      source: 'api',
      pendingDeposits: [],
    });
    expect(
      await read(
        fresh({ signaturesPending: false, credentialsConflict: false }),
      ),
    ).toEqual({
      pubkey: PUBKEY_A,
      status: 'new',
      source: 'api',
      signaturesPending: false,
      credentialsConflict: false,
      pendingDeposits: [],
    });
  });

  it('reads a queued validator from an API without signature checks', async () => {
    expect(
      await read(
        queued({ pendingDeposits: [deposit(), deposit(OTHER_CREDS)] }),
      ),
    ).toEqual({
      pubkey: PUBKEY_A,
      status: 'queued',
      source: 'api',
      beaconStatus: 'pending_deposit',
      withdrawalCredentials: CREDS,
      pendingDeposits: [
        { amount: ETH, withdrawalCredentials: CREDS },
        { amount: ETH, withdrawalCredentials: OTHER_CREDS },
      ],
    });
  });

  it('reads a queued validator with checked signatures', async () => {
    expect(
      await read(
        queued({
          signaturesPending: false,
          credentialsConflict: true,
          pendingDeposits: [
            deposit(OTHER_CREDS, false),
            deposit(CREDS, true),
            deposit(OTHER_CREDS, true),
            deposit(ZERO_CREDS, true),
          ],
        }),
      ),
    ).toEqual({
      pubkey: PUBKEY_A,
      status: 'queued',
      source: 'api',
      beaconStatus: 'pending_deposit',
      withdrawalCredentials: CREDS,
      signaturesPending: false,
      credentialsConflict: true,
      pendingDeposits: [
        {
          amount: ETH,
          withdrawalCredentials: OTHER_CREDS,
          signatureValid: false,
        },
        { amount: ETH, withdrawalCredentials: CREDS, signatureValid: true },
        {
          amount: ETH,
          withdrawalCredentials: OTHER_CREDS,
          signatureValid: true,
        },
        {
          amount: ETH,
          withdrawalCredentials: ZERO_CREDS,
          signatureValid: true,
        },
      ],
    });
    // None valid: no credentials, and that is not an error.
    expect(
      await read(
        queued({
          signaturesPending: false,
          credentialsConflict: false,
          withdrawalCredentials: null,
          pendingDeposits: [deposit(CREDS, false)],
        }),
      ),
    ).toEqual({
      pubkey: PUBKEY_A,
      status: 'queued',
      source: 'api',
      beaconStatus: 'pending_deposit',
      signaturesPending: false,
      credentialsConflict: false,
      pendingDeposits: [
        { amount: ETH, withdrawalCredentials: CREDS, signatureValid: false },
      ],
    });
  });

  it('reads a queued validator while signatures are pending', async () => {
    // Decided: the first deposit is validly signed, a later one unchecked.
    expect(
      await read(
        queued({
          signaturesPending: true,
          credentialsConflict: null,
          pendingDeposits: [deposit(CREDS, true), deposit(OTHER_CREDS, null)],
        }),
      ),
    ).toEqual({
      pubkey: PUBKEY_A,
      status: 'queued',
      source: 'api',
      beaconStatus: 'pending_deposit',
      withdrawalCredentials: CREDS,
      signaturesPending: true,
      credentialsConflict: null,
      pendingDeposits: [
        { amount: ETH, withdrawalCredentials: CREDS, signatureValid: true },
        {
          amount: ETH,
          withdrawalCredentials: OTHER_CREDS,
          signatureValid: null,
        },
      ],
    });
    // Undecided: an unchecked deposit first, so no credentials.
    expect(
      await read(
        queued({
          signaturesPending: true,
          credentialsConflict: null,
          withdrawalCredentials: null,
          pendingDeposits: [deposit(OTHER_CREDS, null), deposit(CREDS, null)],
        }),
      ),
    ).toEqual({
      pubkey: PUBKEY_A,
      status: 'queued',
      source: 'api',
      beaconStatus: 'pending_deposit',
      signaturesPending: true,
      credentialsConflict: null,
      pendingDeposits: [
        {
          amount: ETH,
          withdrawalCredentials: OTHER_CREDS,
          signatureValid: null,
        },
        { amount: ETH, withdrawalCredentials: CREDS, signatureValid: null },
      ],
    });
    // Pending on an API that sends no per-deposit results yet: the given
    // credentials are not taken.
    expect(
      await read(
        queued({ signaturesPending: true, credentialsConflict: null }),
      ),
    ).toEqual({
      pubkey: PUBKEY_A,
      status: 'queued',
      source: 'api',
      beaconStatus: 'pending_deposit',
      signaturesPending: true,
      credentialsConflict: null,
      pendingDeposits: [{ amount: ETH, withdrawalCredentials: CREDS }],
    });
  });
});
