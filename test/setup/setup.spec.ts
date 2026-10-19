import { decodeFunctionData, parseEther, type Address, type Hex } from 'viem';
import {
  createOvmEvent,
  multicall3Abi,
  ovmFactoryAbi,
  pullSplitFactoryAbi,
} from '../../src/abi.js';
import {
  createSetupModule,
  ovmFromReceipt,
  prepareCreateOvm,
  prepareOvmWithSplits,
  rewardsSplit,
  solo,
  totalSplit,
} from '../../src/setup/index.js';
import { MAINNET_MULTICALL3_BYTECODE } from '../bytecodes.js';
import { ZERO_ADDRESS } from '../../src/schema.js';
import type { SplitParams } from '../../src/types.js';
import { fakeChain } from '../helpers/fakeChain.js';
import {
  addr,
  caught,
  eventLog,
  factoryContract,
  HOODI,
  OVM_FACTORY_CODE,
} from '../splits/helpers.js';

const OWNER = addr(0x0e);
const A = addr(0xa1);
const B = addr(0xb2);
const SPLIT_CONTRACT = addr(0x5c);
const MULTICALL_CODE = MAINNET_MULTICALL3_BYTECODE as Hex;

// Predicts a split address from its first allocation, so different params
// give different addresses.
const predicted = (p: SplitParams): Address =>
  addr(0x1000 + Number(p.allocations[0] / 1000n));

const chainWith = (
  opts: {
    existing?: Address[];
    ovmFactoryCode?: Hex;
    multicallCode?: Hex;
    code?: Record<string, Hex>;
  } = {},
) =>
  fakeChain({
    contracts: {
      [HOODI.pullSplitFactory]: factoryContract(p => ({
        address: predicted(p),
        exists: (opts.existing ?? []).includes(predicted(p)),
      })),
    },
    code: {
      [HOODI.ovmFactory.address]: opts.ovmFactoryCode ?? OVM_FACTORY_CODE,
      [HOODI.multicall3]: opts.multicallCode ?? MULTICALL_CODE,
      [SPLIT_CONTRACT]: '0x6080604052',
      ...opts.code,
      ...Object.fromEntries(
        (opts.existing ?? []).map(a => [a, '0x6080604052']),
      ),
    },
  });

describe('setup.prepareCreateOvm', () => {
  const input = {
    owner: OWNER,
    principalRecipient: A,
    rewardRecipient: SPLIT_CONTRACT,
  };

  it('builds createObolValidatorManager with the threshold in gwei', async () => {
    const chain = chainWith();
    const prepared = await prepareCreateOvm(chain.context(), {
      ...input,
      principalThreshold: parseEther('32'),
    });
    expect(prepared.request.to).toBe(HOODI.ovmFactory.address);
    expect(prepared.preview).toEqual({ factory: HOODI.ovmFactory.address });
    expect(
      decodeFunctionData({ abi: ovmFactoryAbi, data: prepared.request.data })
        .args,
    ).toEqual([OWNER, A, SPLIT_CONTRACT, 32_000_000_000n]);
    // A has no code: info finding; the split recipient has code.
    expect(
      prepared.checks.map(c => [c.code, c.severity, c.details?.address]),
    ).toEqual([['RECIPIENT_NOT_CONTRACT', 'info', A]]);
  });

  it('defaults the threshold to 16 ETH', async () => {
    const prepared = await prepareCreateOvm(chainWith().context(), input);
    expect(
      decodeFunctionData({ abi: ovmFactoryAbi, data: prepared.request.data })
        .args?.[3],
    ).toBe(16_000_000_000n);
  });

  it.each<[string, object, string]>([
    ['a zero owner', { owner: ZERO_ADDRESS }, 'owner'],
    [
      'a zero reward recipient',
      { rewardRecipient: ZERO_ADDRESS },
      'rewardRecipient',
    ],
    [
      'a threshold below 16 ETH',
      { principalThreshold: parseEther('15') },
      'principalThreshold',
    ],
    [
      'a threshold above 2048 ETH',
      { principalThreshold: parseEther('2049') },
      'principalThreshold',
    ],
    [
      'a threshold that is not whole gwei',
      { principalThreshold: parseEther('16') + 1n },
      'principalThreshold',
    ],
  ])('rejects %s', async (_name, change, path) => {
    const error = await caught(
      prepareCreateOvm(chainWith().context(), { ...input, ...change }),
    );
    expect(error.code).toBe('PAYLOAD_INVALID');
    expect((error.details.issues as Array<{ path: string }>)[0].path).toBe(
      path,
    );
  });

  it('throws CONTRACT_NOT_AVAILABLE when the factory code differs', async () => {
    const chain = chainWith({ ovmFactoryCode: '0x6080604052' });
    const error = await caught(prepareCreateOvm(chain.context(), input));
    expect(error.code).toBe('CONTRACT_NOT_AVAILABLE');
    expect(error.details.address).toBe(HOODI.ovmFactory.address);
  });
});

describe('setup.prepareOvmWithSplits', () => {
  const recipients = [
    { address: A, share: 600_000 },
    { address: B, share: 400_000 },
  ];
  const otherRecipients = [
    { address: A, share: 300_000 },
    { address: B, share: 700_000 },
  ];

  it('creates new splits and the OVM in one aggregate3', async () => {
    const chain = chainWith();
    const prepared = await prepareOvmWithSplits(chain.context(), {
      owner: OWNER,
      reward: { split: { recipients } },
      principal: { split: { recipients: otherRecipients, owner: OWNER } },
    });
    expect(prepared.request.to).toBe(HOODI.multicall3);
    const calls = decodeFunctionData({
      abi: multicall3Abi,
      data: prepared.request.data,
    }).args?.[0] as ReadonlyArray<{
      target: Address;
      allowFailure: boolean;
      callData: Hex;
    }>;
    expect(calls.map(c => [c.target, c.allowFailure])).toEqual([
      [HOODI.pullSplitFactory, false],
      [HOODI.pullSplitFactory, false],
      [HOODI.ovmFactory.address, false],
    ]);
    const principalCreate = decodeFunctionData({
      abi: pullSplitFactoryAbi,
      data: calls[1].callData,
    });
    expect(principalCreate.args?.[1]).toBe(OWNER);
    const createOvm = decodeFunctionData({
      abi: ovmFactoryAbi,
      data: calls[2].callData,
    });
    expect(createOvm.args).toEqual([
      OWNER,
      addr(0x1000 + 300),
      addr(0x1000 + 600),
      16_000_000_000n,
    ]);
    expect(prepared.preview).toEqual({
      rewardRecipient: { address: addr(0x1000 + 600), created: true },
      principalRecipient: { address: addr(0x1000 + 300), created: true },
    });
    expect(prepared.checks).toEqual([]);
  });

  it('reuses existing splits and calls the factory directly', async () => {
    const existing = addr(0x1000 + 600);
    const chain = chainWith({ existing: [existing] });
    const prepared = await prepareOvmWithSplits(chain.context(), {
      owner: OWNER,
      reward: { split: { recipients } },
      principal: { address: A },
    });
    expect(prepared.request.to).toBe(HOODI.ovmFactory.address);
    expect(prepared.preview.rewardRecipient).toEqual({
      address: existing,
      created: false,
    });
    expect(prepared.checks.map(c => [c.code, c.details?.address])).toEqual([
      ['SPLIT_REUSED', existing],
      ['RECIPIENT_NOT_CONTRACT', A],
    ]);
  });

  it('creates one split used for both recipients once', async () => {
    const prepared = await prepareOvmWithSplits(chainWith().context(), {
      owner: OWNER,
      reward: { split: { recipients } },
      principal: { split: { recipients } },
    });
    const calls = decodeFunctionData({
      abi: multicall3Abi,
      data: prepared.request.data,
    }).args?.[0] as unknown[];
    expect(calls).toHaveLength(2);
    expect(prepared.preview.principalRecipient.created).toBe(true);
  });

  it('needs exactly one of split and address per side', async () => {
    const error = await caught(
      prepareOvmWithSplits(chainWith().context(), {
        owner: OWNER,
        reward: { split: { recipients }, address: A } as never,
        principal: { address: A },
      }),
    );
    expect(error.code).toBe('PAYLOAD_INVALID');
  });

  it('checks Multicall3 and the split factory when creating', async () => {
    const chain = chainWith({ multicallCode: '0x6080604052' });
    const error = await caught(
      prepareOvmWithSplits(chain.context(), {
        owner: OWNER,
        reward: { split: { recipients } },
        principal: { address: A },
      }),
    );
    expect(error.code).toBe('CONTRACT_NOT_AVAILABLE');
    expect(error.details.address).toBe(HOODI.multicall3);
  });

  it('runs the presets through the bound module', async () => {
    const setup = createSetupModule(chainWith().context());
    const input = setup.solo({ owner: OWNER, recipient: A });
    const prepared = await setup.prepareOvmWithSplits(input);
    expect(prepared.preview.principalRecipient).toEqual({
      address: A,
      created: false,
    });
    expect(prepared.preview.rewardRecipient.created).toBe(true);
  });
});

describe('setup presets', () => {
  it('rewardsSplit adds the RAF to the reward split only', () => {
    const input = rewardsSplit({
      chainId: 560048,
      owner: OWNER,
      principalRecipient: A,
      recipients: [{ address: B, share: 990_000 }],
      splitOwner: OWNER,
      principalThreshold: parseEther('20'),
    });
    expect(input).toEqual({
      owner: OWNER,
      principalThreshold: parseEther('20'),
      reward: {
        split: {
          recipients: [
            { address: B, share: 990_000n },
            { address: HOODI.rafRecipient, share: 10_000n },
          ],
          distributionIncentive: 0,
          owner: OWNER,
        },
      },
      principal: { address: A },
    });
  });

  it('totalSplit spreads the RAF share over the principal split', () => {
    const input = totalSplit({
      chainId: 560048,
      owner: OWNER,
      recipients: [
        { address: A, share: 495_000 },
        { address: B, share: 495_000 },
      ],
    });
    expect(input.principal).toEqual({
      split: {
        recipients: [
          { address: A, share: 500_000n },
          { address: B, share: 500_000n },
        ],
        distributionIncentive: 0,
      },
    });
  });

  it('solo pays principal to the recipient', () => {
    const input = solo({ chainId: 1, owner: OWNER, recipient: A });
    expect(input.principal).toEqual({ address: A });
    expect('split' in input.reward && input.reward.split.recipients).toEqual([
      { address: A, share: 990_000n },
      { address: '0xDe5aE4De36c966747Ea7DF13BD9589642e2B1D0d', share: 10_000n },
    ]);
  });

  it('refuses the RAF as a reward recipient', async () => {
    const error = await caught(() =>
      solo({ chainId: 560048, owner: OWNER, recipient: HOODI.rafRecipient }),
    );
    expect((error.details.issues as Array<{ issue?: string }>)[0].issue).toBe(
      'duplicate_address',
    );
  });
});

describe('setup.ovmFromReceipt', () => {
  const created = (address: Address, ovm: Address) =>
    eventLog(
      address,
      createOvmEvent,
      {
        ovm,
        owner: OWNER,
        beneficiary: A,
        rewardRecipient: B,
        principalThreshold: 16_000_000_000n,
      },
      1n,
    );

  it('reads the event emitted by the factory, ignoring other emitters', () => {
    const receipt = {
      logs: [
        created(addr(0xbad), addr(1)),
        created(HOODI.ovmFactory.address, addr(2)),
      ],
    };
    expect(ovmFromReceipt(receipt, { chainId: 560048 })).toEqual({
      ovm: addr(2),
      owner: OWNER,
      principalRecipient: A,
      rewardRecipient: B,
      principalThreshold: parseEther('16'),
    });
    expect(
      createSetupModule(chainWith().context()).ovmFromReceipt(receipt).ovm,
    ).toBe(addr(2));
  });

  it('reports a missing or ambiguous event', async () => {
    expect(
      (
        await caught(() =>
          ovmFromReceipt(
            { logs: [created(addr(0xbad), addr(1))] },
            { chainId: 560048 },
          ),
        )
      ).code,
    ).toBe('OVM_CREATE_EVENT_MISSING');
    const two = {
      logs: [
        created(HOODI.ovmFactory.address, addr(1)),
        created(HOODI.ovmFactory.address, addr(2)),
      ],
    };
    expect(
      (await caught(() => ovmFromReceipt(two, { chainId: 560048 }))).code,
    ).toBe('OVM_CREATE_EVENT_AMBIGUOUS');
  });
});
