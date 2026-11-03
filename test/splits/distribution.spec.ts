import {
  encodeAbiParameters,
  encodeEventTopics,
  parseEther,
  type Address,
  type Hex,
} from 'viem';
import {
  NATIVE_TOKEN,
  ovmAbi,
  splitCreatedEvents,
  splitMainAbi,
  warehouseAbi,
} from '../../src/abi.js';
import {
  distributionFromReceipt,
  prepareDistribution,
  previewDistribution,
} from '../../src/splits/distribution.js';
import { createSplitsModule } from '../../src/splits/index.js';
import { ZERO_ADDRESS } from '../../src/schema.js';
import type { SplitParams } from '../../src/types.js';
import {
  fakeChain,
  type FakeContract,
  type FakeLog,
} from '../helpers/fakeChain.js';
import {
  addr,
  caught,
  decodeDistributionCalls,
  eventLog,
  HOODI,
  ovmContract,
  ovmCreatedLog,
  splitContract,
  splitMainContract,
  warehouseContract,
} from './helpers.js';

const OVM = addr(0x0f0f);
const REWARD = addr(0x6001);
const PRINCIPAL = addr(0x7001);
const A = addr(0xa1);
const B = addr(0xb2);
const SENDER = addr(0x5e);

const rewardParams: SplitParams = {
  recipients: [A, B, HOODI.rafRecipient],
  allocations: [500_000n, 490_000n, 10_000n],
  totalAllocation: 1_000_000n,
  distributionIncentive: 0,
};
const principalParams: SplitParams = {
  recipients: [A, B],
  allocations: [500_000n, 500_000n],
  totalAllocation: 1_000_000n,
  distributionIncentive: 0,
};

interface Scenario {
  ovmBalance?: bigint;
  principalRecipient?: Address;
  rewardRecipient?: Address;
  warehouse?: Record<string, bigint>;
  paused?: Record<string, boolean>;
  splitMain?: Record<string, bigint>;
  rewardSplit?: Partial<Parameters<typeof splitContract>[0]>;
  extraContracts?: Record<string, FakeContract>;
  code?: Record<string, `0x${string}`>;
  logs?: FakeLog[];
  provenanceLog?: boolean;
  getLogsFails?: boolean;
  walletAccount?: Address;
}

const scenario = (s: Scenario = {}) =>
  fakeChain({
    contracts: {
      [OVM]: ovmContract({
        balance: s.ovmBalance ?? 0n,
        amountOfPrincipalStake: parseEther('32'),
        principalRecipient: s.principalRecipient ?? PRINCIPAL,
        rewardRecipient: s.rewardRecipient ?? REWARD,
      }),
      [REWARD]: splitContract({
        params: rewardParams,
        owner: SENDER,
        ...s.rewardSplit,
      }),
      [PRINCIPAL]: splitContract({ params: principalParams, owner: SENDER }),
      [HOODI.warehouse]: warehouseContract(s.warehouse, s.paused),
      [HOODI.splitMain]: splitMainContract(s.splitMain),
      ...s.extraContracts,
    },
    balances: { [OVM]: s.ovmBalance ?? 0n },
    code: s.code ?? {},
    logs: [
      ...(s.provenanceLog === false ? [] : [ovmCreatedLog(OVM)]),
      ...(s.logs ?? []),
    ],
    ...(s.getLogsFails === true
      ? { getLogsError: () => new Error('refused') }
      : {}),
    ...(s.walletAccount !== undefined
      ? { walletAccount: s.walletAccount }
      : {}),
  });

const both = { rewardSplit: rewardParams, principalSplit: principalParams };

describe('splits.prepareDistribution', () => {
  it('leaves legs below minWithdraw out with a skipReason', async () => {
    const chain = scenario({
      ovmBalance: parseEther('1'),
      warehouse: { [A]: 100n, [B]: 1n },
    });
    const input = {
      ovm: OVM,
      ...both,
      from: SENDER,
      minWithdraw: parseEther('2'),
    };
    const error = await caught(prepareDistribution(chain.context(), input));
    expect(error.code).toBe('NOTHING_TO_DISTRIBUTE');

    const { preview, checks, blockNumber } = await previewDistribution(
      chain.context(),
      input,
    );
    expect(blockNumber).toBe(2_000_000n);
    expect(checks).toEqual([]);
    expect(preview.ovm?.skipReason).toBe('dust');
    expect(preview.splits.map(s => s.skipReason)).toEqual([
      'nothing',
      'nothing',
    ]);
    const byAddress = Object.fromEntries(
      preview.recipients.map(r => [r.address, r]),
    );
    expect(byAddress[A].skipReason).toBe('dust');
    expect(byAddress[B].skipReason).toBe('nothing');
    expect(byAddress[A].alreadyWaiting).toBe(100n);
    expect(byAddress[A].fromThisDistribution).toBe(0n);
    // The RAF is in the withdrawal set by default.
    expect(byAddress[HOODI.rafRecipient].withdraw).toBe(true);
    expect('blockNumber' in preview).toBe(false);
    expect(preview.minWithdraw).toBe(parseEther('2'));
  });

  it('withdraws the RAF by default; includeRaf: false leaves it with RAF_LEFT_IN_WAREHOUSE', async () => {
    const chain = scenario({
      ovmBalance: parseEther('1'),
      warehouse: { [HOODI.rafRecipient]: 500n },
    });
    const withRaf = await prepareDistribution(chain.context(), {
      ovm: OVM,
      ...both,
      from: SENDER,
    });
    const raf = withRaf.preview.recipients.find(
      r => r.address === HOODI.rafRecipient,
    )!;
    expect(raf).toMatchObject({ withdraw: true, alreadyWaiting: 500n });
    expect(raf.skipReason).toBeUndefined();
    expect(
      decodeDistributionCalls(withRaf.request.data, OVM).some(
        c => c.op === 'warehouse.withdraw' && c.owner === HOODI.rafRecipient,
      ),
    ).toBe(true);
    expect(withRaf.checks).toEqual([]);

    const without = await prepareDistribution(chain.context(), {
      ovm: OVM,
      ...both,
      from: SENDER,
      includeRaf: false,
    });
    const left = without.preview.recipients.find(
      r => r.address === HOODI.rafRecipient,
    )!;
    expect(left.withdraw).toBe(false);
    expect(without.checks).toEqual([
      expect.objectContaining({
        code: 'RAF_LEFT_IN_WAREHOUSE',
        severity: 'info',
        subject: { address: HOODI.rafRecipient },
        details: {
          address: HOODI.rafRecipient,
          amount: 500n + left.fromThisDistribution - 1n,
        },
      }),
    ]);
  });

  it('separates what this distribution credits from what reaches the wallet', async () => {
    // A already had 100 wei in the Warehouse before this distribution.
    const chain = scenario({
      ovmBalance: parseEther('1'),
      warehouse: { [A]: 100n },
    });
    const { preview } = await prepareDistribution(chain.context(), {
      ovm: OVM,
      ...both,
      from: SENDER,
    });
    for (const r of preview.recipients) {
      expect(r.fromThisDistribution).toBe(
        r.fromOvm +
          r.fromRewardSplit +
          r.fromPrincipalSplit +
          r.distributorReward,
      );
    }
    const a = preview.recipients.find(r => r.address === A)!;
    expect(a.fromThisDistribution).toBeGreaterThan(0n);
    expect(a.warehouseBalance).toBe(100n);
    // What was waiting is reported apart from this distribution's credit.
    expect(a.alreadyWaiting).toBe(100n);
  });

  it('includes a leg at exactly minWithdraw', async () => {
    const chain = scenario({ warehouse: { [A]: 101n } });
    const prepared = await prepareDistribution(chain.context(), {
      ovm: OVM,
      ...both,
      from: SENDER,
      minWithdraw: 100n,
    });
    expect(decodeDistributionCalls(prepared.request.data, OVM)).toEqual([
      {
        op: 'warehouse.withdraw',
        target: HOODI.warehouse,
        owner: A,
        allowFailure: true,
      },
    ]);
    expect(prepared.preview.ovm?.skipReason).toBe('nothing');
  });

  it('adds PROVENANCE_UNKNOWN when the factory logs cannot be read', async () => {
    const chain = scenario({ ovmBalance: parseEther('1'), getLogsFails: true });
    const prepared = await prepareDistribution(chain.context(), {
      ovm: OVM,
      ...both,
      from: SENDER,
    });
    expect(prepared.checks.map(c => [c.code, c.severity])).toEqual([
      ['PROVENANCE_UNKNOWN', 'warning'],
    ]);
  });

  it('throws OVM_NOT_OBOL for an OVM the factory did not create', async () => {
    const chain = scenario({
      ovmBalance: parseEther('1'),
      provenanceLog: false,
    });
    expect(
      (
        await caught(
          prepareDistribution(chain.context(), { ovm: OVM, ...both }),
        )
      ).code,
    ).toBe('OVM_NOT_OBOL');
  });

  it('gives a contract sender no pause exemption (RECIPIENT_WITHDRAW_PAUSED)', async () => {
    const safe = addr(0x5afe);
    const chain = scenario({
      warehouse: { [A]: 50n, [safe]: 50n },
      paused: { [A]: true, [safe]: true },
      code: { [safe]: '0x6080604052' },
    });
    const prepared = await previewDistribution(chain.context(), {
      ovm: OVM,
      ...both,
      recipients: [A, safe],
      from: safe,
    });
    const skipped = prepared.preview.recipients.filter(
      r => r.skipReason === 'paused',
    );
    expect(skipped.map(r => r.address)).toEqual([A, safe]);
    expect(
      prepared.checks.map(c => [c.code, c.severity, c.details?.address]),
    ).toEqual([
      ['RECIPIENT_WITHDRAW_PAUSED', 'info', A],
      ['RECIPIENT_WITHDRAW_PAUSED', 'info', safe],
    ]);
  });

  it('throws SPLIT_PAUSED for a paused split owned by a contract sender (Multicall3 is msg.sender)', async () => {
    const safe = addr(0x5afe);
    const chain = scenario({
      rewardSplit: { paused: true, owner: safe, balance: parseEther('1') },
      code: { [safe]: '0x6080604052' },
    });
    const error = await caught(
      prepareDistribution(chain.context(), {
        rewardSplit: { ...rewardParams, address: REWARD },
        from: safe,
      }),
    );
    expect(error.code).toBe('SPLIT_PAUSED');
    expect(error.details).toMatchObject({ address: REWARD, owner: safe });
  });

  it('lets an EOA owner distribute its paused split (tx.origin)', async () => {
    const chain = scenario({
      rewardSplit: { paused: true, owner: SENDER, balance: parseEther('1') },
    });
    const prepared = await prepareDistribution(chain.context(), {
      rewardSplit: { ...rewardParams, address: REWARD },
      from: SENDER,
    });
    expect(
      decodeDistributionCalls(prepared.request.data, OVM).map(c => c.op),
    ).toContain('split.distribute');
  });

  it('lets an EOA sender withdraw its own paused balance (tx.origin)', async () => {
    const chain = scenario({
      warehouse: { [SENDER]: 50n },
      paused: { [SENDER]: true },
      walletAccount: SENDER,
    });
    const prepared = await prepareDistribution(chain.context(), {
      ovm: OVM,
      ...both,
      recipients: [SENDER],
    });
    expect(prepared.checks).toEqual([]);
    expect(
      prepared.preview.recipients.find(r => r.address === SENDER),
    ).toMatchObject({ withdraw: true, alreadyWaiting: 50n });
    expect(
      prepared.preview.recipients.find(r => r.address === SENDER)?.skipReason,
    ).toBeUndefined();
  });

  it('finds params for an OVM recipient split in the SplitCreated log', async () => {
    const created = eventLog(
      HOODI.pullSplitFactory,
      splitCreatedEvents[1],
      {
        split: REWARD,
        splitParams: rewardParams,
        owner: SENDER,
        creator: ZERO_ADDRESS,
      },
      HOODI.ovmFactory.deployBlock + 5n,
    );
    const chain = scenario({
      ovmBalance: parseEther('1'),
      principalRecipient: A,
      logs: [created],
    });
    const prepared = await prepareDistribution(chain.context(), {
      ovm: OVM,
      from: SENDER,
    });
    expect(
      decodeDistributionCalls(prepared.request.data, OVM).map(c => c.op),
    ).toEqual([
      'ovm.distributeFunds',
      'split.distribute',
      // The split's recipients, the RAF included.
      'warehouse.withdraw',
      'warehouse.withdraw',
      'warehouse.withdraw',
    ]);
    expect(prepared.preview.splits[0]).toMatchObject({
      address: REWARD,
      kind: 'reward',
    });
  });

  it('throws SPLIT_PARAMS_REQUIRED when the params cannot be found', async () => {
    const chain = scenario({
      ovmBalance: parseEther('1'),
      principalRecipient: A,
    });
    const error = await caught(
      prepareDistribution(chain.context(), { ovm: OVM, from: SENDER }),
    );
    expect(error.code).toBe('SPLIT_PARAMS_REQUIRED');
    expect(error.details).toEqual({ address: REWARD, kind: 'reward' });
  });

  it('distributes one split once when it receives both payouts', async () => {
    const chain = scenario({
      ovmBalance: parseEther('40'),
      principalRecipient: REWARD,
      rewardRecipient: REWARD,
    });
    const prepared = await prepareDistribution(chain.context(), {
      ovm: OVM,
      rewardSplit: rewardParams,
      principalSplit: rewardParams,
      from: SENDER,
    });
    expect(prepared.preview.splits).toEqual([
      {
        address: REWARD,
        kind: 'reward',
        distributable: parseEther('40') - 1n,
        distributorReward: 0n,
      },
    ]);
    const mismatch = await caught(
      prepareDistribution(chain.context(), {
        ovm: OVM,
        rewardSplit: rewardParams,
        principalSplit: principalParams,
        from: SENDER,
      }),
    );
    expect(mismatch.code).toBe('SPLIT_PARAMS_MISMATCH');
  });

  it('pays the distribution incentive to the wallet account by default', async () => {
    const withIncentive = { ...rewardParams, distributionIncentive: 10_000 };
    const chain = scenario({
      rewardSplit: { params: withIncentive, balance: 1_000_001n },
      walletAccount: SENDER,
    });
    const prepared = await prepareDistribution(chain.context(), {
      rewardSplit: { ...withIncentive, address: REWARD },
      recipients: [SENDER],
    });
    const calls = decodeDistributionCalls(prepared.request.data);
    expect(calls[0]).toMatchObject({
      op: 'split.distribute',
      distributor: SENDER,
    });
    expect(prepared.preview.splits[0].distributorReward).toBe(10_000n);
    expect(
      prepared.preview.recipients.find(r => r.address === SENDER),
    ).toMatchObject({
      fromThisDistribution: 10_000n,
      alreadyWaiting: 0n,
      withdraw: true,
    });
  });

  it.each<[string, object]>([
    ['nothing to distribute named', {}],
    ['a split without address and without ovm', { rewardSplit: rewardParams }],
    [
      'an incentive without distributor or sender',
      {
        rewardSplit: {
          ...rewardParams,
          distributionIncentive: 1,
          address: REWARD,
        },
      },
    ],
    [
      'params whose total differs',
      {
        rewardSplit: { ...rewardParams, totalAllocation: 1n, address: REWARD },
      },
    ],
    ['minWithdraw 0', { ovm: OVM, minWithdraw: 0n }],
  ])('rejects %s (PAYLOAD_INVALID)', async (_name, input) => {
    const chain = scenario({
      rewardSplit: { params: { ...rewardParams, distributionIncentive: 1 } },
    });
    expect(
      (await caught(prepareDistribution(chain.context(), input))).code,
    ).toBe('PAYLOAD_INVALID');
  });

  it('is bound by createSplitsModule', async () => {
    const chain = scenario({ ovmBalance: parseEther('1') });
    const splits = createSplitsModule(chain.context());
    const prepared = await splits.prepareDistribution({
      ovm: OVM,
      ...both,
      from: SENDER,
    });
    expect(prepared.request.to).toBe(HOODI.multicall3);
    await expect(
      splits.previewDistribution({ ovm: OVM, ...both }),
    ).resolves.toHaveProperty('preview');
  });
});

describe('splits.distributionFromReceipt', () => {
  const log = (
    address: Address,
    abi: any,
    eventName: string,
    args: Record<string, unknown>,
  ) => {
    const event = abi.find(
      (i: any) => i.type === 'event' && i.name === eventName,
    );
    return eventLog(address, event, args, 1n);
  };

  it('sums withdrawals and reads the OVM payout from trusted emitters only', () => {
    const receipt = {
      logs: [
        log(HOODI.warehouse, warehouseAbi, 'Withdraw', {
          owner: A,
          token: NATIVE_TOKEN,
          withdrawer: SENDER,
          amount: 10n,
          reward: 0n,
        }),
        log(HOODI.warehouse, warehouseAbi, 'Withdraw', {
          owner: A,
          token: addr(0x70),
          withdrawer: SENDER,
          amount: 99n,
          reward: 0n,
        }),
        log(HOODI.splitMain, splitMainAbi, 'Withdrawal', {
          account: A,
          ethAmount: 5n,
          tokens: [],
          tokenAmounts: [],
        }),
        log(addr(0xbad), splitMainAbi, 'Withdrawal', {
          account: B,
          ethAmount: 7n,
          tokens: [],
          tokenAmounts: [],
        }),
        log(OVM, ovmAbi, 'DistributeFunds', {
          principalPayout: 3n,
          rewardPayout: 4n,
          pullOrPush: 0n,
        }),
        {
          address: HOODI.warehouse,
          topics: encodeEventTopics({
            abi: ovmAbi,
            eventName: 'DistributeFunds',
          }) as Hex[],
          data: encodeAbiParameters([{ type: 'uint256' }], [1n]),
          blockNumber: 1n,
        },
      ],
    };
    expect(
      distributionFromReceipt(receipt, { chainId: 560048, ovm: OVM }),
    ).toEqual({
      withdrawn: { [A]: 15n },
      ovmPayout: { principal: 3n, reward: 4n },
    });
    expect(distributionFromReceipt(receipt, { chainId: 560048 })).toEqual({
      withdrawn: { [A]: 15n },
    });
  });
});
