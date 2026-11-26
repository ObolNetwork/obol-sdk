// checkWithdrawalRequests: the EIP-7002 rules of one batch. Which rule a
// request breaks first, what is reported as unchecked when the status source
// did not give a field, and how a batch counts its own earlier partials.
import type { Hex } from 'viem';
import { CHAINS } from '../../src/chains.js';
import type { DepositStatus } from '../../src/deposits/status.js';
import { ObolError } from '../../src/errors.js';
import { checkWithdrawalRequests } from '../../src/ovm/requestRules.js';
import {
  credentials,
  ETH,
  GWEI,
  OVM,
  PUBKEY_A,
  PUBKEY_B,
} from './ovmFixture.js';

const COMPOUNDING = credentials('02', OVM);

const active = (extra: Partial<DepositStatus> = {}): DepositStatus => ({
  pubkey: PUBKEY_A,
  status: 'active',
  source: 'chain',
  beaconStatus: 'active_ongoing',
  validatorIndex: 1,
  withdrawalCredentials: COMPOUNDING,
  balance: 40n * ETH,
  effectiveBalance: 32n * ETH,
  activationEpoch: 0n,
  exitEpoch: null,
  pendingPartialWithdrawals: 0n,
  pendingDeposits: [],
  ...extra,
});

/** `status` without the given fields (a source that did not report them). */
const without = (
  status: DepositStatus,
  ...keys: Array<keyof DepositStatus>
): DepositStatus => {
  const copy: Record<string, unknown> = { ...status };
  for (const key of keys) delete copy[key];
  return copy as unknown as DepositStatus;
};

const check = (
  requests: Array<{ pubkey: Hex; amount: bigint }>,
  statuses: DepositStatus[],
): ReturnType<typeof checkWithdrawalRequests> =>
  checkWithdrawalRequests(
    { chain: CHAINS[560048] },
    requests,
    new Map(statuses.map(s => [s.pubkey, s])),
    { address: OVM, what: 'the OVM' },
  );

const refusal = (
  requests: Array<{ pubkey: Hex; amount: bigint }>,
  statuses: DepositStatus[],
): ObolError => {
  try {
    check(requests, statuses);
  } catch (error) {
    expect(error).toBeInstanceOf(ObolError);
    return error as ObolError;
  }
  throw new Error('expected the batch to be refused');
};

const uncheckedOf = (
  result: ReturnType<typeof checkWithdrawalRequests>,
): Array<{ pubkey: unknown; checks: unknown }> =>
  result.checks.map(f => {
    expect(f.code).toBe('VALIDATOR_STATUS_UNCHECKED');
    return {
      pubkey: (f.subject as { pubkey?: Hex } | undefined)?.pubkey,
      checks: (f.details as { checks: string[] }).checks,
    };
  });

const EXIT = [{ pubkey: PUBKEY_A, amount: 0n }];
const PARTIAL = [{ pubkey: PUBKEY_A, amount: ETH }];

describe('checkWithdrawalRequests: full exits', () => {
  it('passes a full exit with nothing pending, unchanged', () => {
    expect(check(EXIT, [active()])).toEqual({
      requests: [{ pubkey: PUBKEY_A, amount: 0n }],
      checks: [],
    });
  });

  it('refuses a full exit while partial withdrawals are pending', () => {
    const error = refusal(EXIT, [active({ pendingPartialWithdrawals: 5n })]);
    expect(error.code).toBe('EXIT_BLOCKED_BY_PENDING_WITHDRAWAL');
    expect(error.message).toBe(
      `${PUBKEY_A} has 5 wei of partial withdrawals pending: the beacon chain ignores a full exit until they are processed, and keeps the fee`,
    );
    expect(error.details).toEqual({
      pubkey: PUBKEY_A,
      pendingPartialWithdrawals: 5n,
    });
  });

  it('reports the pending withdrawals as unchecked when the source has none', () => {
    const result = check(EXIT, [
      without(active(), 'pendingPartialWithdrawals'),
    ]);
    expect(result.requests).toEqual([{ pubkey: PUBKEY_A, amount: 0n }]);
    expect(uncheckedOf(result)).toEqual([
      { pubkey: PUBKEY_A, checks: ['pending partial withdrawals'] },
    ]);
  });

  it('a full exit needs neither 0x02 credentials nor an effective balance', () => {
    expect(
      check(EXIT, [
        active({
          withdrawalCredentials: credentials('01', OVM),
          effectiveBalance: 16n * ETH,
          balance: 16n * ETH,
        }),
      ]),
    ).toEqual({ requests: [{ pubkey: PUBKEY_A, amount: 0n }], checks: [] });
  });

  it('counts a partial earlier in the batch as pending for a later exit', () => {
    const error = refusal(
      [
        { pubkey: PUBKEY_A, amount: ETH },
        { pubkey: PUBKEY_A, amount: 0n },
      ],
      [active()],
    );
    expect(error.code).toBe('EXIT_BLOCKED_BY_PENDING_WITHDRAWAL');
    expect(error.details).toEqual({
      pubkey: PUBKEY_A,
      pendingPartialWithdrawals: ETH,
    });
  });
});

describe('checkWithdrawalRequests: partial withdrawals', () => {
  it('passes a partial within the excess, unchanged', () => {
    expect(check(PARTIAL, [active()])).toEqual({
      requests: [{ pubkey: PUBKEY_A, amount: ETH }],
      checks: [],
    });
  });

  it('passes a request without a status through, unchecked here', () => {
    expect(
      check(
        [
          { pubkey: PUBKEY_B, amount: 3n },
          { pubkey: PUBKEY_A, amount: ETH },
        ],
        [active()],
      ),
    ).toEqual({
      requests: [
        { pubkey: PUBKEY_B, amount: 3n },
        { pubkey: PUBKEY_A, amount: ETH },
      ],
      checks: [],
    });
  });

  it('refuses a partial without 0x02 credentials', () => {
    const withdrawalCredentials = credentials('01', OVM);
    const error = refusal(PARTIAL, [active({ withdrawalCredentials })]);
    expect(error.code).toBe('PARTIAL_REQUIRES_COMPOUNDING');
    expect(error.message).toBe(
      `${PUBKEY_A} does not have 0x02 credentials: the beacon chain ignores a partial withdrawal and keeps the fee`,
    );
    expect(error.details).toEqual({ pubkey: PUBKEY_A, withdrawalCredentials });
  });

  it('checks the credentials before the effective balance', () => {
    expect(
      refusal(PARTIAL, [
        active({
          withdrawalCredentials: credentials('01', OVM),
          effectiveBalance: 31n * ETH,
        }),
      ]).code,
    ).toBe('PARTIAL_REQUIRES_COMPOUNDING');
  });

  it('refuses a partial below 32 ETH of effective balance', () => {
    const error = refusal(PARTIAL, [active({ effectiveBalance: 31n * ETH })]);
    expect(error.code).toBe('EFFECTIVE_BALANCE_TOO_LOW');
    expect(error.message).toBe(
      `${PUBKEY_A} has an effective balance of ${31n * ETH} wei, below 32 ETH: the beacon chain ignores a partial withdrawal and keeps the fee`,
    );
    expect(error.details).toEqual({
      pubkey: PUBKEY_A,
      effectiveBalance: 31n * ETH,
    });
  });

  it('checks the effective balance before the excess', () => {
    expect(
      refusal(PARTIAL, [
        active({ effectiveBalance: 31n * ETH, balance: 31n * ETH }),
      ]).code,
    ).toBe('EFFECTIVE_BALANCE_TOO_LOW');
  });

  it('reports each field the source did not give, and still caps the amount', () => {
    const result = check(
      [{ pubkey: PUBKEY_A, amount: 10n * ETH }],
      [without(active(), 'withdrawalCredentials', 'effectiveBalance')],
    );
    expect(result.requests).toEqual([
      { pubkey: PUBKEY_A, amount: 8n * ETH, requestedAmount: 10n * ETH },
    ]);
    expect(result.checks.map(f => f.code)).toEqual([
      'WITHDRAW_AMOUNT_CAPPED',
      'VALIDATOR_STATUS_UNCHECKED',
    ]);
    expect(result.checks[1].details).toEqual({
      checks: ['credentials', 'effective balance'],
    });
  });

  it('passes a partial through when the balance or the pending amount is unknown', () => {
    const noBalance = check(PARTIAL, [without(active(), 'balance')]);
    expect(noBalance.requests).toEqual([{ pubkey: PUBKEY_A, amount: ETH }]);
    expect(uncheckedOf(noBalance)).toEqual([
      { pubkey: PUBKEY_A, checks: ['balance'] },
    ]);
    const noPending = check(PARTIAL, [
      without(active(), 'pendingPartialWithdrawals'),
    ]);
    expect(noPending.requests).toEqual([{ pubkey: PUBKEY_A, amount: ETH }]);
    expect(uncheckedOf(noPending)).toEqual([
      { pubkey: PUBKEY_A, checks: ['pending partial withdrawals'] },
    ]);
    const neither = check(PARTIAL, [
      without(
        active(),
        'balance',
        'pendingPartialWithdrawals',
        'effectiveBalance',
      ),
    ]);
    expect(uncheckedOf(neither)).toEqual([
      { pubkey: PUBKEY_A, checks: ['effective balance', 'balance'] },
    ]);
  });

  it('refuses a partial with nothing above 32 ETH plus what is pending', () => {
    const error = refusal(PARTIAL, [
      active({ balance: 33n * ETH, pendingPartialWithdrawals: ETH }),
    ]);
    expect(error.code).toBe('NO_EXCESS_BALANCE');
    expect(error.details).toEqual({
      pubkey: PUBKEY_A,
      balance: 33n * ETH,
      pendingPartialWithdrawals: ETH,
    });
  });

  it('caps later partials of one validator by the earlier ones of the batch', () => {
    const result = check(
      [
        { pubkey: PUBKEY_A, amount: 5n * ETH },
        { pubkey: PUBKEY_A, amount: 5n * ETH },
      ],
      [active()],
    );
    expect(result.requests).toEqual([
      { pubkey: PUBKEY_A, amount: 5n * ETH },
      { pubkey: PUBKEY_A, amount: 3n * ETH, requestedAmount: 5n * ETH },
    ]);
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({
      code: 'WITHDRAW_AMOUNT_CAPPED',
      subject: { pubkey: PUBKEY_A },
      details: { requestedAmount: 5n * ETH, amount: 3n * ETH },
    });
    expect(
      refusal(
        [
          { pubkey: PUBKEY_A, amount: 8n * ETH },
          { pubkey: PUBKEY_A, amount: GWEI },
        ],
        [active()],
      ).code,
    ).toBe('NO_EXCESS_BALANCE');
  });
});
