import { decodeFunctionData, type Hex } from 'viem';
import { ovmAbi } from '../../src/abi.js';
import { CHAINS, currentEpoch } from '../../src/chains.js';
import { prepareConsolidate, prepareWithdraw } from '../../src/ovm/withdraw.js';
import { checkWithdrawalRequests } from '../../src/ovm/requestRules.js';
import type { DepositStatus } from '../../src/deposits/status.js';
import { fakeApi } from '../helpers/fakeChain.js';
import {
  BEACON_URL,
  caught,
  credentials,
  ETH,
  GWEI,
  HOLDER,
  mockBeacon,
  OTHER,
  OVM,
  ovmChain,
  OWNER,
  PUBKEY_A,
  PUBKEY_B,
  PUBKEY_C,
  registryRow,
} from './ovmFixture.js';

const codes = (checks: Array<{ code: string }>): string[] =>
  checks.map(c => c.code);

describe('ovm.prepareWithdraw', () => {
  const base = {
    ovm: OVM,
    requests: [{ pubkey: PUBKEY_A, amount: 2n * ETH }],
    from: OWNER,
  };

  it('encodes OVM.withdraw with gwei amounts and the default fee', async () => {
    const chain = ovmChain({ withdrawalFee: 7n });
    const result = await prepareWithdraw(chain.context(), {
      ...base,
      requests: [
        { pubkey: PUBKEY_A, amount: 2n * ETH },
        { pubkey: PUBKEY_B, amount: GWEI },
      ],
    });
    expect(result.request).toMatchObject({
      to: OVM,
      value: 2n * GWEI,
      chainId: 560048,
    });
    expect(result.blockNumber).toBe(2_000_000n);
    expect(result.kind).toBe('withdraw');
    // No status source: the beacon chain rules are reported unchecked.
    expect(codes(result.checks)).toEqual(['VALIDATOR_STATUS_UNCHECKED']);
    const { functionName, args } = decodeFunctionData({
      abi: ovmAbi,
      data: result.request.data,
    });
    expect(functionName).toBe('withdraw');
    // Default: the top of the range, max(10 × 7 wei, 1 gwei) per request.
    expect(args).toEqual([[PUBKEY_A, PUBKEY_B], [2n * GWEI, 1n], GWEI, OWNER]);
    expect(result.preview.totalFee).toBe(2n * GWEI);
    expect(result.preview.maxFeePerRequest).toBe(GWEI);
  });

  it('defaults to 10 × the current fee above the 1 gwei floor', async () => {
    const chain = ovmChain({ withdrawalFee: 3n * GWEI });
    const result = await prepareWithdraw(chain.context(), base);
    expect(result.request.value).toBe(30n * GWEI);
    expect(result.preview.maxFeePerRequest).toBe(30n * GWEI);
  });

  it('previews routing of the arriving ETH', async () => {
    // Nothing held, stake 32 ETH, threshold 16 ETH.
    const chain = ovmChain({ ovmBalance: ETH });
    const result = await prepareWithdraw(chain.context(), {
      ...base,
      requests: [
        { pubkey: PUBKEY_A, amount: 16n * ETH }, // 17 ETH ≥ threshold: principal
        { pubkey: PUBKEY_B, amount: 10n * ETH }, // 11 ETH < threshold: reward
        { pubkey: PUBKEY_C, amount: 40n * ETH }, // 41 ETH: 32 principal, the rest reward
      ],
    });
    expect(result.preview.requests).toEqual([
      {
        pubkey: PUBKEY_A,
        amount: 16n * ETH,
        routedAs: 'principal',
        principalPart: 16n * ETH,
        rewardPart: 0n,
      },
      {
        pubkey: PUBKEY_B,
        amount: 10n * ETH,
        routedAs: 'reward',
        principalPart: 0n,
        rewardPart: 10n * ETH,
      },
      {
        pubkey: PUBKEY_C,
        amount: 40n * ETH,
        routedAs: 'mixed',
        principalPart: 32n * ETH,
        rewardPart: 8n * ETH,
      },
    ]);
  });

  it('requires acknowledgeFullExit for amount 0', async () => {
    const chain = ovmChain();
    const input = { ...base, requests: [{ pubkey: PUBKEY_A, amount: 0n }] };
    expect(await caught(prepareWithdraw(chain.context(), input))).toMatchObject(
      {
        code: 'FULL_EXIT_NOT_ACKNOWLEDGED',
      },
    );
    const ok = await prepareWithdraw(chain.context(), {
      ...input,
      acknowledgeFullExit: true,
    });
    // No status source: the exit amount is unknown, so no routing.
    expect(ok.preview.requests[0].routedAs).toBeUndefined();
  });

  it.each([
    ['not whole gwei', 1n],
    ['above 2^64-1 gwei', 2n ** 64n * GWEI],
  ])('rejects an amount %s', async (_name, amount) => {
    const error = await caught(
      prepareWithdraw(ovmChain().context(), {
        ...base,
        requests: [{ pubkey: PUBKEY_A, amount }],
      }),
    );
    expect(error.code).toBe('PAYLOAD_INVALID');
    expect(error.details.issues[0].path).toBe('requests[0].amount');
  });

  it('rejects no requests and a zero excessFeeRecipient', async () => {
    expect(
      (
        await caught(
          prepareWithdraw(ovmChain().context(), { ...base, requests: [] }),
        )
      ).code,
    ).toBe('PAYLOAD_INVALID');
    const error = await caught(
      prepareWithdraw(ovmChain().context(), {
        ...base,
        excessFeeRecipient: '0x0000000000000000000000000000000000000000',
      }),
    );
    expect(error.details.issues[0].path).toBe('excessFeeRecipient');
  });

  it('needs a sender', async () => {
    const error = await caught(
      prepareWithdraw(ovmChain().context(), { ...base, from: undefined }),
    );
    expect(error.code).toBe('PAYLOAD_INVALID');
  });

  it('uses the wallet account as sender and refund address', async () => {
    const chain = ovmChain({ walletAccount: OWNER });
    const result = await prepareWithdraw(chain.context(), {
      ...base,
      from: undefined,
    });
    const { args } = decodeFunctionData({
      abi: ovmAbi,
      data: result.request.data,
    });
    expect(args[3]).toBe(OWNER);
  });

  it('throws OVM_ROLE_MISSING without WITHDRAWAL and accepts a holder', async () => {
    const chain = ovmChain({
      state: { roles: { [HOLDER]: 0x01n, [OTHER]: 0x02n } },
    });
    expect(
      await caught(prepareWithdraw(chain.context(), { ...base, from: OTHER })),
    ).toMatchObject({
      code: 'OVM_ROLE_MISSING',
      details: { from: OTHER, role: 'WITHDRAWAL' },
    });
    await expect(
      prepareWithdraw(chain.context(), { ...base, from: HOLDER }),
    ).resolves.toBeDefined();
  });

  it('throws OVM_NOT_OBOL and warns PROVENANCE_UNKNOWN', async () => {
    expect(
      (
        await caught(
          prepareWithdraw(ovmChain({ provenance: 'notObol' }).context(), base),
        )
      ).code,
    ).toBe('OVM_NOT_OBOL');
    const result = await prepareWithdraw(
      ovmChain({ provenance: 'unknown' }).context(),
      base,
    );
    expect(codes(result.checks)).toEqual([
      'PROVENANCE_UNKNOWN',
      'VALIDATOR_STATUS_UNCHECKED',
    ]);
  });

  it('checks a given fee and reports fee read failures', async () => {
    const chain = ovmChain({ withdrawalFee: 10n });
    expect(
      await caught(prepareWithdraw(chain.context(), { ...base, fee: 9n })),
    ).toMatchObject({ code: 'FEE_OUT_OF_RANGE' });
    const ok = await prepareWithdraw(chain.context(), { ...base, fee: 10n });
    expect(ok.request.value).toBe(10n);
    const broken = ovmChain({
      raw: { '0x00000961Ef480Eb55e80D19ad83579A64c007002': () => '0x' },
    });
    expect((await caught(prepareWithdraw(broken.context(), base))).code).toBe(
      'FEE_READ_FAILED',
    );
  });

  describe('with a status source (process_withdrawal_request)', () => {
    let restore: () => void = () => {};
    afterEach(() => restore());
    const now = currentEpoch(CHAINS[560048]) as bigint;
    const compounding = credentials('02', OVM);
    const run = async (
      requests: Array<{ pubkey: Hex; amount: bigint }>,
      rows: unknown[],
      partials: Array<{ validator_index: string; amount: string }> = [],
    ) => {
      restore = mockBeacon([], rows, partials);
      return await prepareWithdraw(ovmChain().context(), {
        ...base,
        beaconUrl: BEACON_URL,
        acknowledgeFullExit: true,
        requests,
      });
    };
    const rejected = async (
      requests: Array<{ pubkey: Hex; amount: bigint }>,
      rows: unknown[],
      partials: Array<{ validator_index: string; amount: string }> = [],
    ) => await caught(run(requests, rows, partials));

    it('accepts a partial above 32 ETH and an exit, with no findings', async () => {
      const result = await run(
        [
          { pubkey: PUBKEY_A, amount: ETH },
          { pubkey: PUBKEY_B, amount: 0n },
        ],
        [
          registryRow(PUBKEY_A, 'active_ongoing', compounding, 40n * ETH, {
            index: '1',
          }),
          registryRow(PUBKEY_B, 'active_ongoing', compounding, 32n * ETH, {
            index: '2',
          }),
        ],
      );
      expect(result.checks).toEqual([]);
      expect(result.preview.requests.map(r => r.amount)).toEqual([ETH, 0n]);
    });

    it('rejects a validator that is not active (VALIDATOR_NOT_ACTIVE)', async () => {
      expect(
        await rejected(
          [{ pubkey: PUBKEY_A, amount: 0n }],
          [registryRow(PUBKEY_A, 'pending_queued', compounding)],
        ),
      ).toMatchObject({
        code: 'VALIDATOR_NOT_ACTIVE',
        details: { pubkey: PUBKEY_A },
      });
      // Not in the registry at all.
      expect(
        (await rejected([{ pubkey: PUBKEY_A, amount: 0n }], [])).code,
      ).toBe('VALIDATOR_NOT_ACTIVE');
    });

    it('rejects credentials that do not point at the OVM (CREDENTIALS_NOT_SOURCE)', async () => {
      for (const c of [credentials('02', OTHER), `0x00${'11'.repeat(31)}`]) {
        expect(
          await rejected(
            [{ pubkey: PUBKEY_A, amount: 0n }],
            [registryRow(PUBKEY_A, 'active_ongoing', c as Hex)],
          ),
        ).toMatchObject({
          code: 'CREDENTIALS_NOT_SOURCE',
          details: { pubkey: PUBKEY_A, source: OVM },
        });
      }
    });

    it('rejects an exiting or exited validator (VALIDATOR_EXITING)', async () => {
      for (const status of ['active_exiting', 'exited_unslashed']) {
        expect(
          (
            await rejected(
              [{ pubkey: PUBKEY_A, amount: ETH }],
              [registryRow(PUBKEY_A, status, compounding, 40n * ETH)],
            )
          ).code,
        ).toBe('VALIDATOR_EXITING');
      }
    });

    it('rejects a request within 256 epochs of activation (VALIDATOR_TOO_NEW)', async () => {
      const error = await rejected(
        [{ pubkey: PUBKEY_A, amount: 0n }],
        [
          registryRow(PUBKEY_A, 'active_ongoing', compounding, 32n * ETH, {
            activationEpoch: (now - 10n).toString(),
          }),
        ],
      );
      expect(error).toMatchObject({
        code: 'VALIDATOR_TOO_NEW',
        details: {
          activationEpoch: now - 10n,
          eligibleEpoch: now + 246n,
        },
      });
    });

    it('rejects a full exit behind pending partials (EXIT_BLOCKED_BY_PENDING_WITHDRAWAL)', async () => {
      const row = registryRow(PUBKEY_A, 'active_ongoing', compounding);
      expect(
        await rejected(
          [{ pubkey: PUBKEY_A, amount: 0n }],
          [row],
          [{ validator_index: '42', amount: '1000000000' }],
        ),
      ).toMatchObject({
        code: 'EXIT_BLOCKED_BY_PENDING_WITHDRAWAL',
        details: { pendingPartialWithdrawals: ETH },
      });
      // A partial earlier in the same batch counts too.
      const rich = registryRow(
        PUBKEY_A,
        'active_ongoing',
        compounding,
        40n * ETH,
      );
      expect(
        (
          await rejected(
            [
              { pubkey: PUBKEY_A, amount: ETH },
              { pubkey: PUBKEY_A, amount: 0n },
            ],
            [rich],
          )
        ).code,
      ).toBe('EXIT_BLOCKED_BY_PENDING_WITHDRAWAL');
    });

    it('rejects a partial without 0x02 credentials (PARTIAL_REQUIRES_COMPOUNDING)', async () => {
      expect(
        (
          await rejected(
            [{ pubkey: PUBKEY_A, amount: ETH }],
            [
              registryRow(
                PUBKEY_A,
                'active_ongoing',
                credentials('01', OVM),
                40n * ETH,
              ),
            ],
          )
        ).code,
      ).toBe('PARTIAL_REQUIRES_COMPOUNDING');
    });

    it('rejects a partial below 32 ETH effective balance (EFFECTIVE_BALANCE_TOO_LOW)', async () => {
      expect(
        (
          await rejected(
            [{ pubkey: PUBKEY_A, amount: ETH }],
            [
              registryRow(PUBKEY_A, 'active_ongoing', compounding, 33n * ETH, {
                effectiveBalanceWei: 31n * ETH,
              }),
            ],
          )
        ).code,
      ).toBe('EFFECTIVE_BALANCE_TOO_LOW');
    });

    it('rejects a partial with no excess (NO_EXCESS_BALANCE)', async () => {
      expect(
        (
          await rejected(
            [{ pubkey: PUBKEY_A, amount: ETH }],
            [registryRow(PUBKEY_A, 'active_ongoing', compounding, 32n * ETH)],
          )
        ).code,
      ).toBe('NO_EXCESS_BALANCE');
      expect(
        (
          await rejected(
            [{ pubkey: PUBKEY_A, amount: ETH }],
            [registryRow(PUBKEY_A, 'active_ongoing', compounding, 34n * ETH)],
            [{ validator_index: '42', amount: '2000000000' }],
          )
        ).code,
      ).toBe('NO_EXCESS_BALANCE');
    });

    it('caps a partial to the excess, less what is pending (WITHDRAW_AMOUNT_CAPPED)', async () => {
      const result = await run(
        [{ pubkey: PUBKEY_A, amount: 10n * ETH }],
        [registryRow(PUBKEY_A, 'active_ongoing', compounding, 36n * ETH)],
        [{ validator_index: '42', amount: '1000000000' }],
      );
      expect(result.preview.requests[0]).toMatchObject({
        pubkey: PUBKEY_A,
        amount: 3n * ETH,
        requestedAmount: 10n * ETH,
      });
      expect(result.checks).toEqual([
        expect.objectContaining({
          code: 'WITHDRAW_AMOUNT_CAPPED',
          severity: 'info',
          subject: { pubkey: PUBKEY_A },
        }),
      ]);
      const { args } = decodeFunctionData({
        abi: ovmAbi,
        data: result.request.data,
      });
      expect(args[1]).toEqual([(3n * ETH) / GWEI]);
    });

    it('routes a full exit by the validator balance', async () => {
      const result = await run(
        [{ pubkey: PUBKEY_A, amount: 0n }],
        [registryRow(PUBKEY_A, 'active_ongoing', compounding, 32n * ETH)],
      );
      expect(result.checks).toEqual([]);
      expect(result.preview.requests[0]).toMatchObject({
        routedAs: 'principal',
        principalPart: 32n * ETH,
      });
    });

    it('reports checks the API answer cannot support as VALIDATOR_STATUS_UNCHECKED', async () => {
      // An API deployment without the epochs and pending partials.
      const api = fakeApi({
        'POST /v1/validators/hoodi/deposit-status': () => ({
          validators: [
            {
              pubkey: PUBKEY_A,
              status: 'active',
              beaconStatus: 'active_ongoing',
              index: 42,
              balance: (40n * ETH).toString(),
              effectiveBalance: (32n * ETH).toString(),
              withdrawalCredentials: compounding,
              pendingDeposits: [],
            },
          ],
        }),
      });
      const result = await prepareWithdraw(ovmChain().context(api), {
        ...base,
        requests: [{ pubkey: PUBKEY_A, amount: ETH }],
      });
      expect(result.checks).toEqual([
        expect.objectContaining({
          code: 'VALIDATOR_STATUS_UNCHECKED',
          subject: { pubkey: PUBKEY_A },
          details: {
            checks: ['activation epoch', 'pending partial withdrawals'],
          },
        }),
      ]);
    });

    it('reads the epochs and pending partials from the API deposit status', async () => {
      const api = fakeApi({
        'POST /v1/validators/hoodi/deposit-status': () => ({
          validators: [
            {
              pubkey: PUBKEY_A,
              status: 'active',
              beaconStatus: 'active_ongoing',
              index: 42,
              balance: (32n * ETH).toString(),
              effectiveBalance: (32n * ETH).toString(),
              activationEpoch: '10',
              exitEpoch: null,
              pendingPartialWithdrawals: ETH.toString(),
              withdrawalCredentials: compounding,
              pendingDeposits: [],
            },
          ],
        }),
      });
      expect(
        await caught(
          prepareWithdraw(ovmChain().context(api), {
            ...base,
            acknowledgeFullExit: true,
            requests: [{ pubkey: PUBKEY_A, amount: 0n }],
          }),
        ),
      ).toMatchObject({ code: 'EXIT_BLOCKED_BY_PENDING_WITHDRAWAL' });
    });
  });
});

describe('ovm.prepareConsolidate', () => {
  const base = {
    ovm: OVM,
    requests: [{ sources: [PUBKEY_A, PUBKEY_B], target: PUBKEY_C }],
    acknowledgeStakeMovesToTarget: true as const,
    from: OWNER,
  };

  it('encodes OVM.consolidate with the fee over all sources', async () => {
    const chain = ovmChain({ consolidationFee: 5n });
    const result = await prepareConsolidate(chain.context(), base);
    // Default: the top of the range, max(10 × 5 wei, 1 gwei) per source.
    expect(result.request.value).toBe(2n * GWEI);
    const { functionName, args } = decodeFunctionData({
      abi: ovmAbi,
      data: result.request.data,
    });
    expect(functionName).toBe('consolidate');
    expect(args).toEqual([
      [{ srcPubKeys: [PUBKEY_A, PUBKEY_B], targetPubKey: PUBKEY_C }],
      GWEI,
      OWNER,
    ]);
    expect(result.preview).toEqual({
      requests: [{ sources: [PUBKEY_A, PUBKEY_B], target: PUBKEY_C }],
      totalFee: 2n * GWEI,
      maxFeePerRequest: GWEI,
    });
  });

  it('requires the acknowledgement first, also for untyped callers', async () => {
    for (const ack of [undefined, false, 'true']) {
      const error = await caught(
        prepareConsolidate(ovmChain().context(), {
          ...base,
          acknowledgeStakeMovesToTarget: ack,
          ovm: 'not an address',
        } as any),
      );
      expect(error.code).toBe('CONSOLIDATION_NOT_ACKNOWLEDGED');
    }
  });

  it('limits sources to 1–63', async () => {
    for (const sources of [[], Array.from({ length: 64 }, () => PUBKEY_A)]) {
      const error = await caught(
        prepareConsolidate(ovmChain().context(), {
          ...base,
          requests: [{ sources: sources as Hex[], target: PUBKEY_C }],
        }),
      );
      expect(error.code).toBe('PAYLOAD_INVALID');
    }
  });

  it('needs CONSOLIDATION', async () => {
    const chain = ovmChain({ state: { roles: { [OTHER]: 0x01n } } });
    expect(
      await caught(
        prepareConsolidate(chain.context(), { ...base, from: OTHER }),
      ),
    ).toMatchObject({
      code: 'OVM_ROLE_MISSING',
      details: { role: 'CONSOLIDATION' },
    });
  });

  it('reports a fee read failure', async () => {
    const chain = ovmChain({
      raw: { '0x0000BBdDc7CE488642fb579F8B00f3a590007251': () => '0x' },
    });
    expect((await caught(prepareConsolidate(chain.context(), base))).code).toBe(
      'FEE_READ_FAILED',
    );
  });

  describe('with a status source (process_consolidation_request)', () => {
    let restore: () => void = () => {};
    afterEach(() => restore());
    const now = currentEpoch(CHAINS[560048]) as bigint;
    const rows = (
      a: Hex,
      b: Hex,
      c: Hex,
      extra: Record<string, { activationEpoch?: string; status?: string }> = {},
    ) =>
      [
        [PUBKEY_A, a, '1'],
        [PUBKEY_B, b, '2'],
        [PUBKEY_C, c, '3'],
      ].map(([pubkey, creds, index]) =>
        registryRow(
          pubkey as Hex,
          extra[pubkey]?.status ?? 'active_ongoing',
          creds as Hex,
          32n * ETH,
          { index, activationEpoch: extra[pubkey]?.activationEpoch },
        ),
      );
    const run = async (
      validators: unknown[],
      requests = base.requests,
      partials: Array<{ validator_index: string; amount: string }> = [],
    ) => {
      restore = mockBeacon([], validators, partials);
      return await prepareConsolidate(ovmChain().context(), {
        ...base,
        requests,
        beaconUrl: BEACON_URL,
      });
    };

    it('accepts 0x01 sources into a 0x02 target of the same address', async () => {
      const result = await run(
        rows(
          credentials('01', OVM),
          credentials('02', OVM),
          credentials('02', OVM),
        ),
      );
      expect(result.checks).toEqual([]);
    });

    it('warns when the target belongs to another address (CONSOLIDATION_CREDENTIALS_DIFFER)', async () => {
      const result = await run(
        rows(
          credentials('01', OVM),
          credentials('01', OVM),
          credentials('02', OTHER),
        ),
      );
      expect(result.checks).toEqual([
        expect.objectContaining({
          code: 'CONSOLIDATION_CREDENTIALS_DIFFER',
          subject: { pubkey: PUBKEY_A },
        }),
        expect.objectContaining({
          code: 'CONSOLIDATION_CREDENTIALS_DIFFER',
          subject: { pubkey: PUBKEY_B },
        }),
      ]);
    });

    it('rejects a target without 0x02 credentials', async () => {
      expect(
        (
          await caught(
            run(
              rows(
                credentials('01', OVM),
                credentials('01', OVM),
                credentials('01', OVM),
              ),
            ),
          )
        ).code,
      ).toBe('CONSOLIDATION_TARGET_NOT_COMPOUNDING');
    });

    it('rejects a source whose credentials do not point at the OVM', async () => {
      expect(
        await caught(
          run(
            rows(
              credentials('01', OTHER),
              credentials('01', OVM),
              credentials('02', OVM),
            ),
          ),
        ),
      ).toMatchObject({
        code: 'CREDENTIALS_NOT_SOURCE',
        details: { pubkey: PUBKEY_A },
      });
    });

    it('rejects an inactive or exiting source or target', async () => {
      const ok = [
        credentials('01', OVM),
        credentials('01', OVM),
        credentials('02', OVM),
      ] as const;
      expect(
        (
          await caught(
            run(rows(...ok, { [PUBKEY_A]: { status: 'pending_queued' } })),
          )
        ).code,
      ).toBe('VALIDATOR_NOT_ACTIVE');
      expect(
        (
          await caught(
            run(rows(...ok, { [PUBKEY_C]: { status: 'active_exiting' } })),
          )
        ).code,
      ).toBe('VALIDATOR_EXITING');
    });

    it('rejects a source within 256 epochs of activation', async () => {
      const ok = [
        credentials('01', OVM),
        credentials('01', OVM),
        credentials('02', OVM),
      ] as const;
      expect(
        (
          await caught(
            run(
              rows(...ok, { [PUBKEY_B]: { activationEpoch: now.toString() } }),
            ),
          )
        ).code,
      ).toBe('VALIDATOR_TOO_NEW');
    });

    it('rejects a source with pending partial withdrawals', async () => {
      const ok = [
        credentials('01', OVM),
        credentials('01', OVM),
        credentials('02', OVM),
      ] as const;
      expect(
        await caught(
          run(rows(...ok), base.requests, [
            { validator_index: '2', amount: '1' },
          ]),
        ),
      ).toMatchObject({
        code: 'CONSOLIDATION_BLOCKED_BY_PENDING_WITHDRAWAL',
        details: { pubkey: PUBKEY_B },
      });
    });

    it('switches a 0x01 validator to compounding (source = target)', async () => {
      const result = await run(
        rows(
          credentials('01', OVM),
          credentials('01', OVM),
          credentials('02', OVM),
          {
            // The switch has no shard committee period.
            [PUBKEY_A]: { activationEpoch: now.toString() },
          },
        ),
        [{ sources: [PUBKEY_A], target: PUBKEY_A }],
      );
      expect(result.checks).toEqual([]);
      expect(
        (
          await caught(
            run(
              rows(
                credentials('02', OVM),
                credentials('01', OVM),
                credentials('02', OVM),
              ),
              [{ sources: [PUBKEY_A], target: PUBKEY_A }],
            ),
          )
        ).code,
      ).toBe('CONSOLIDATION_ALREADY_COMPOUNDING');
    });
  });
});

describe('checkWithdrawalRequests', () => {
  const status = (balance: bigint): DepositStatus => ({
    pubkey: PUBKEY_A,
    status: 'active',
    source: 'chain',
    beaconStatus: 'active_ongoing',
    validatorIndex: 1,
    withdrawalCredentials: credentials('02', OVM),
    balance,
    effectiveBalance: 32n * ETH,
    activationEpoch: 0n,
    exitEpoch: null,
    pendingPartialWithdrawals: 0n,
    pendingDeposits: [],
  });
  const check = (balance: bigint) =>
    checkWithdrawalRequests(
      { chain: CHAINS[560048] },
      [{ pubkey: PUBKEY_A, amount: ETH }],
      new Map([[PUBKEY_A, status(balance)]]),
      { address: OVM, what: 'the OVM' },
    );

  it('refuses a partial whose excess rounds down to 0 gwei (never a 0 amount, which is a full exit)', () => {
    let error: unknown;
    try {
      check(32n * ETH + GWEI - 1n);
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({ code: 'NO_EXCESS_BALANCE' });
  });

  it('caps to a 1 gwei excess', () => {
    expect(check(32n * ETH + GWEI).requests[0]).toMatchObject({
      amount: GWEI,
      requestedAmount: ETH,
    });
  });
});
