import { decodeFunctionData, type Hex } from 'viem';
import { ovmAbi } from '../../src/abi.js';
import { prepareConsolidate, prepareWithdraw } from '../../src/ovm/withdraw.js';
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
      value: 28n,
      chainId: 560048,
    });
    expect(result.blockNumber).toBe(2_000_000n);
    expect(result.checks).toEqual([]);
    const { functionName, args } = decodeFunctionData({
      abi: ovmAbi,
      data: result.request.data,
    });
    expect(functionName).toBe('withdraw');
    expect(args).toEqual([[PUBKEY_A, PUBKEY_B], [2n * GWEI, 1n], 14n, OWNER]);
    expect(result.preview.totalFee).toBe(28n);
    expect(result.preview.maxFeePerRequest).toBe(14n);
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
    expect(codes(result.checks)).toEqual(['PROVENANCE_UNKNOWN']);
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

  describe('with a status source', () => {
    let restore: () => void = () => {};
    afterEach(() => restore());

    it('warns about credentials, partials without 0x02 and inactive validators', async () => {
      restore = mockBeacon(
        [],
        [
          registryRow(PUBKEY_A, 'active_ongoing', credentials('01', OVM)),
          registryRow(PUBKEY_B, 'active_ongoing', credentials('02', OTHER)),
          registryRow(PUBKEY_C, 'exited_unslashed', credentials('02', OVM)),
        ],
      );
      const result = await prepareWithdraw(ovmChain().context(), {
        ...base,
        beaconUrl: BEACON_URL,
        requests: [
          { pubkey: PUBKEY_A, amount: ETH },
          { pubkey: PUBKEY_B, amount: ETH },
          { pubkey: PUBKEY_C, amount: ETH },
        ],
      });
      expect(codes(result.checks)).toEqual([
        'WITHDRAW_PARTIAL_REQUIRES_COMPOUNDING',
        'WITHDRAW_CREDENTIALS_NOT_OVM',
        'WITHDRAW_VALIDATOR_NOT_ACTIVE',
      ]);
    });

    it('routes a full exit by the validator balance', async () => {
      restore = mockBeacon(
        [],
        [
          registryRow(
            PUBKEY_A,
            'active_ongoing',
            credentials('02', OVM),
            32n * ETH,
          ),
        ],
      );
      const result = await prepareWithdraw(ovmChain().context(), {
        ...base,
        beaconUrl: BEACON_URL,
        acknowledgeFullExit: true,
        requests: [{ pubkey: PUBKEY_A, amount: 0n }],
      });
      expect(result.checks).toEqual([]);
      expect(result.preview.requests[0]).toMatchObject({
        routedAs: 'principal',
        principalPart: 32n * ETH,
      });
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
    expect(result.request.value).toBe(20n);
    const { functionName, args } = decodeFunctionData({
      abi: ovmAbi,
      data: result.request.data,
    });
    expect(functionName).toBe('consolidate');
    expect(args).toEqual([
      [{ srcPubKeys: [PUBKEY_A, PUBKEY_B], targetPubKey: PUBKEY_C }],
      10n,
      OWNER,
    ]);
    expect(result.preview).toEqual({
      requests: [{ sources: [PUBKEY_A, PUBKEY_B], target: PUBKEY_C }],
      totalFee: 20n,
      maxFeePerRequest: 10n,
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

  describe('with a status source', () => {
    let restore: () => void = () => {};
    afterEach(() => restore());

    it('accepts 0x01 sources into a 0x02 target of the same address', async () => {
      restore = mockBeacon(
        [],
        [
          registryRow(PUBKEY_A, 'active_ongoing', credentials('01', OVM)),
          registryRow(PUBKEY_B, 'active_ongoing', credentials('02', OVM)),
          registryRow(PUBKEY_C, 'active_ongoing', credentials('02', OVM)),
        ],
      );
      const result = await prepareConsolidate(ovmChain().context(), {
        ...base,
        beaconUrl: BEACON_URL,
      });
      expect(result.checks).toEqual([]);
    });

    it('warns for a non-compounding target and differing credentials', async () => {
      restore = mockBeacon(
        [],
        [
          registryRow(PUBKEY_A, 'active_ongoing', credentials('01', OTHER)),
          registryRow(PUBKEY_B, 'active_ongoing', credentials('01', OVM)),
          registryRow(PUBKEY_C, 'active_ongoing', credentials('01', OVM)),
        ],
      );
      const result = await prepareConsolidate(ovmChain().context(), {
        ...base,
        beaconUrl: BEACON_URL,
      });
      expect(codes(result.checks)).toEqual([
        'CONSOLIDATION_TARGET_NOT_COMPOUNDING',
        'CONSOLIDATION_CREDENTIALS_DIFFER',
      ]);
    });
  });
});
