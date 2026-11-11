/**
 * warningsOf / warningCodes, and the types around acknowledgement. The
 * `@ts-expect-error` lines are type-level tests: ts-jest type-checks this
 * file, so a line that stops being an error fails the suite.
 */
import type { Address, Hex } from 'viem';
import {
  UNCHECKED_WARNING_CODES,
  type FindingCode,
  type FindingCodeFor,
  type WarningCode,
} from '../../src/findings.js';
import { isObolError, type ObolError } from '../../src/errors.js';
import {
  findingsToAcknowledge,
  send,
  warningCodes,
  warningsOf,
  type SendOptions,
  type SimulationForSend,
  type WarningCodeFor,
} from '../../src/send.js';
import type { AnyPrepared, Finding, Prepared } from '../../src/types.js';
import { fakeChain } from '../helpers/fakeChain.js';

const ACCOUNT = '0x2222222222222222222222222222222222222222' as Address;
const request = {
  to: ACCOUNT,
  data: '0x' as Hex,
  value: 1n,
  chainId: 560048,
};

const withdraw: Prepared<'withdraw'> = {
  kind: 'withdraw',
  request,
  checks: [
    {
      code: 'VALIDATOR_STATUS_UNCHECKED',
      severity: 'warning',
      message: 'validator A unchecked',
    },
    { code: 'WITHDRAW_AMOUNT_CAPPED', severity: 'info', message: 'capped' },
    {
      code: 'VALIDATOR_STATUS_UNCHECKED',
      severity: 'warning',
      message: 'validator B unchecked',
    },
    { code: 'PROVENANCE_UNKNOWN', severity: 'warning', message: 'unknown' },
  ],
  preview: { requests: [], totalFee: 1n, maxFeePerRequest: 1n },
};

const simulation: SimulationForSend = {
  request,
  findings: [
    { code: 'SIMULATION_UNAVAILABLE', severity: 'warning', message: 'no sim' },
    { code: 'SIMULATION_CONTRACT_WALLET', severity: 'info', message: 'safe' },
  ],
};

/** Compiles only when `A` and `B` are the same type. */
const sameType = <A, B>(
  ..._proof: [A] extends [B] ? ([B] extends [A] ? [] : [never]) : [never]
): void => {};

describe('warningsOf and warningCodes', () => {
  it('warningsOf returns the warnings, in order, with everything to show', () => {
    expect(warningsOf(withdraw).map(f => f.message)).toEqual([
      'validator A unchecked',
      'validator B unchecked',
      'unknown',
    ]);
    expect(warningsOf(withdraw, simulation).map(f => f.code)).toEqual([
      'VALIDATOR_STATUS_UNCHECKED',
      'VALIDATOR_STATUS_UNCHECKED',
      'PROVENANCE_UNKNOWN',
      'SIMULATION_UNAVAILABLE',
    ]);
  });

  it('warningCodes is the distinct codes, directly passable to send', async () => {
    expect(warningCodes(withdraw)).toEqual([
      'VALIDATOR_STATUS_UNCHECKED',
      'PROVENANCE_UNKNOWN',
    ]);
    expect(warningCodes(withdraw, simulation)).toEqual([
      'VALIDATOR_STATUS_UNCHECKED',
      'PROVENANCE_UNKNOWN',
      'SIMULATION_UNAVAILABLE',
    ]);
    const chain = fakeChain({ walletAccount: ACCOUNT });
    // The one-line confirm-and-send.
    await send(chain.context(), withdraw, {
      simulation,
      acknowledge: warningCodes(withdraw, simulation),
    });
    expect(chain.sent).toHaveLength(1);
    // Without the simulation's codes the simulation warning is still open.
    await expect(
      send(chain.context(), withdraw, {
        simulation,
        acknowledge: warningCodes(withdraw),
      }),
    ).rejects.toMatchObject({
      code: 'FINDINGS_NOT_ACKNOWLEDGED',
      details: { codes: ['SIMULATION_UNAVAILABLE'] },
    });
  });

  it('is empty for a transaction without warnings (send needs no options)', () => {
    const clean = { ...withdraw, checks: [withdraw.checks[1]] };
    expect(warningCodes(clean)).toEqual([]);
    expect(warningsOf(clean)).toEqual([]);
    expect(findingsToAcknowledge(clean)).toEqual([]);
  });

  it('acknowledges this transaction only: another one with a new warning is still refused', async () => {
    const chain = fakeChain({ walletAccount: ACCOUNT });
    const shown = warningCodes(withdraw);
    const later: Prepared<'withdraw'> = {
      ...withdraw,
      checks: [
        ...withdraw.checks,
        {
          code: 'PARTIAL_WITHDRAWAL_QUEUE_FULL',
          severity: 'warning',
          message: 'queue full',
        },
      ],
    };
    await expect(
      send(chain.context(), later, { acknowledge: shown }),
    ).rejects.toMatchObject({
      details: { codes: ['PARTIAL_WITHDRAWAL_QUEUE_FULL'] },
    });
    expect(chain.sent).toHaveLength(0);
  });

  it('refuses a simulation of another request', () => {
    const other = { ...simulation, request: { ...request, value: 2n } };
    expect(() => warningCodes(withdraw, other)).toThrow(
      expect.objectContaining({ code: 'PAYLOAD_INVALID' }),
    );
    expect(() => warningsOf(withdraw, other)).toThrow(
      expect.objectContaining({ code: 'PAYLOAD_INVALID' }),
    );
  });

  it('a fixed policy: UNCHECKED_WARNING_CODES accepts "could not check", not "does something else"', () => {
    expect(
      findingsToAcknowledge(withdraw, { acknowledge: UNCHECKED_WARNING_CODES }),
    ).toEqual([]);
    const consolidate: Prepared<'consolidate'> = {
      kind: 'consolidate',
      request,
      checks: [
        {
          code: 'VALIDATOR_STATUS_UNCHECKED',
          severity: 'warning',
          message: 'x',
        },
        {
          code: 'CONSOLIDATION_CREDENTIALS_DIFFER',
          severity: 'warning',
          message: 'stake leaves',
        },
      ],
      preview: { requests: [], totalFee: 1n, maxFeePerRequest: 1n },
    };
    expect(
      findingsToAcknowledge(consolidate, {
        acknowledge: UNCHECKED_WARNING_CODES,
      }).map(f => f.code),
    ).toEqual(['CONSOLIDATION_CREDENTIALS_DIFFER']);
  });

  it('the error tells an agent what happened and what to do, in full', async () => {
    const error: ObolError = await send(
      fakeChain({ walletAccount: ACCOUNT }).context(),
      withdraw,
      { simulation },
    ).then(
      () => {
        throw new Error('expected a rejection');
      },
      e => e,
    );
    expect(error.message).toBe(
      [
        'Not sent: 4 warning(s) on this withdraw transaction were not acknowledged.',
        '1. VALIDATOR_STATUS_UNCHECKED: validator A unchecked',
        '2. VALIDATOR_STATUS_UNCHECKED: validator B unchecked',
        '3. PROVENANCE_UNKNOWN: unknown',
        '4. SIMULATION_UNAVAILABLE: no sim',
      ].join('\n'),
    );
    expect(error.hint).toContain('Nothing was sent');
    expect(error.hint).toContain('report them to your operator and wait');
    expect(error.hint).toContain(
      "send(prepared, { acknowledge: ['VALIDATOR_STATUS_UNCHECKED', 'PROVENANCE_UNKNOWN', 'SIMULATION_UNAVAILABLE'] })",
    );
    expect(error.hint).toContain('warningCodes(prepared, simulation)');
    expect(error.hint).toContain('If they do not accept, do not send');
  });
});

describe('types (compile-time)', () => {
  it('Prepared<K>.checks and warningCodes are narrowed to the codes of the kind', () => {
    sameType<
      (typeof withdraw.checks)[number]['code'],
      | 'PROVENANCE_UNKNOWN'
      | 'VALIDATOR_STATUS_UNCHECKED'
      | 'WITHDRAW_AMOUNT_CAPPED'
      | 'PARTIAL_WITHDRAWAL_QUEUE_FULL'
    >();
    // Only the warnings of the kind: WITHDRAW_AMOUNT_CAPPED is info.
    sameType<
      ReturnType<typeof warningCodes<'withdraw'>>[number],
      | 'PROVENANCE_UNKNOWN'
      | 'VALIDATOR_STATUS_UNCHECKED'
      | 'PARTIAL_WITHDRAWAL_QUEUE_FULL'
      | 'SIMULATION_UNAVAILABLE'
      | 'SIMULATION_REVERTED'
      | 'SIMULATION_PREVIEW_MISMATCH'
      | 'SIMULATION_READS_INCOMPLETE'
      | 'SIMULATION_UNTRUSTED_EVENT'
    >();
    sameType<
      WarningCodeFor<'deposit'>,
      | 'DEPOSIT_EXISTENCE_UNCHECKED'
      | 'QUEUED_CREDENTIALS_CONFLICT'
      | 'TOP_UP_ABOVE_EFFECTIVE_CAP'
      | 'TOP_UP_EXITED_VALIDATOR'
      | 'TOP_UP_CREDENTIALS_FOREIGN'
      | 'OVM_STAKE_NOT_TRACKED'
    >();
    sameType<FindingCodeFor<'createSplit'>, never>();
    sameType<FindingCodeFor<'distribute'>, 'PROVENANCE_UNKNOWN'>();

    // A finding of another kind does not belong on a withdrawal.
    const wrongKind: Prepared<'withdraw'>['checks'][number] = {
      // @ts-expect-error TOP_UP_CREDENTIALS_FOREIGN is a deposit finding
      code: 'TOP_UP_CREDENTIALS_FOREIGN',
      severity: 'warning',
      message: '',
    };
    expect(wrongKind).toBeDefined();
  });

  it('acknowledge takes finding codes: no boolean, no "all", no typo', () => {
    const ok: SendOptions[] = [
      {},
      { acknowledge: [] },
      { acknowledge: ['VALIDATOR_STATUS_UNCHECKED'] },
      { acknowledge: warningCodes(withdraw) },
      { acknowledge: warningCodes(withdraw, simulation), simulation },
      { acknowledge: UNCHECKED_WARNING_CODES },
    ];
    // A policy annotated for one kind autocompletes that kind's codes.
    const policy: Array<FindingCodeFor<'withdraw'>> = [
      'PROVENANCE_UNKNOWN',
      // @ts-expect-error not a code a withdrawal can carry
      'SPLIT_REUSED',
    ];
    ok.push({ acknowledge: policy });
    const bad: SendOptions[] = [
      // @ts-expect-error a boolean is not an acknowledgement
      { acknowledge: true },
      // @ts-expect-error neither is 'all'
      { acknowledge: 'all' },
      // @ts-expect-error nor a single code
      { acknowledge: 'VALIDATOR_STATUS_UNCHECKED' },
      // @ts-expect-error a misspelt code
      { acknowledge: ['VALIDATOR_STATUS_UNCHEKED'] },
      // @ts-expect-error an error code is not a finding code
      { acknowledge: ['DEPOSIT_CONFLICT'] },
      // @ts-expect-error an unknown option
      { acknowledgeAll: true },
    ];
    expect(ok.length + bad.length).toBe(13);
  });

  it('isObolError(e, "FINDINGS_NOT_ACKNOWLEDGED") types the details', () => {
    const handle = (error: unknown): WarningCode[] => {
      if (!isObolError(error, 'FINDINGS_NOT_ACKNOWLEDGED')) return [];
      sameType<typeof error.details.codes, WarningCode[]>();
      sameType<typeof error.details.findings, Array<Finding<WarningCode>>>();
      const first: Finding<WarningCode> | undefined = error.details.findings[0];
      const subject = first?.subject;
      const hint: string | undefined = first?.hint;
      expect([subject, hint]).toBeDefined();
      return error.details.codes;
    };
    expect(handle(new Error('x'))).toEqual([]);
  });

  it('WarningCode is the codes whose severity is warning', () => {
    const warning: WarningCode = 'TOP_UP_CREDENTIALS_FOREIGN';
    // @ts-expect-error SPLIT_REUSED is info
    const info: WarningCode = 'SPLIT_REUSED';
    const any: FindingCode = info;
    expect([warning, any]).toHaveLength(2);
  });

  it('AnyPrepared carries any code', () => {
    const any: AnyPrepared = withdraw;
    expect(warningCodes(any)).toHaveLength(2);
  });
});
