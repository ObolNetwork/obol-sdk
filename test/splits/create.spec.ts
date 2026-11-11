import { decodeFunctionData, type Address } from 'viem';
import { pullSplitFactoryAbi } from '../../src/abi.js';
import {
  DEFAULT_SPLIT_SALT,
  predictSplit,
  prepareCreateSplit,
} from '../../src/splits/create.js';
import { createSplitsModule } from '../../src/splits/index.js';
import { ZERO_ADDRESS } from '../../src/schema.js';
import { fakeChain } from '../helpers/fakeChain.js';
import { addr, caught, factoryContract, HOODI } from './helpers.js';

const A = addr(0xa1);
const B = addr(0xb2);
const PREDICTED = addr(0x5911);
const recipients = [
  { address: B, share: 300_000 },
  { address: A, share: 700_000 },
];

const chainWith = (
  exists = false,
  opts: { code?: `0x${string}`; revert?: boolean } = {},
) => {
  const seen: Array<{ owner: Address; salt: string }> = [];
  const chain = fakeChain({
    contracts: {
      [HOODI.pullSplitFactory]: factoryContract((_p, owner, salt) => {
        if (opts.revert === true) throw new Error('boom');
        seen.push({ owner, salt });
        return { address: PREDICTED, exists };
      }, opts.code),
    },
  });
  return { chain, seen };
};

describe('splits.predictSplit', () => {
  const params = {
    recipients: [A, B],
    allocations: [700_000n, 300_000n],
    totalAllocation: 1_000_000n,
    distributionIncentive: 0,
  };

  it('returns the factory address and exists flag', async () => {
    const { chain, seen } = chainWith(true);
    await expect(
      predictSplit(chain.context(), { params, owner: ZERO_ADDRESS }),
    ).resolves.toEqual({ address: PREDICTED, exists: true });
    expect(seen[0].salt).toBe(DEFAULT_SPLIT_SALT);
  });

  it('reports a failed isDeployed call as CHAIN_READ_FAILED', async () => {
    const { chain } = chainWith(false, { revert: true });
    expect(
      (
        await caught(
          predictSplit(chain.context(), { params, owner: ZERO_ADDRESS }),
        )
      ).code,
    ).toBe('CHAIN_READ_FAILED');
  });

  it('rejects params whose allocations do not sum to the total', async () => {
    const { chain } = chainWith();
    const error = await caught(
      predictSplit(chain.context(), {
        params: { ...params, totalAllocation: 999n },
        owner: ZERO_ADDRESS,
      }),
    );
    expect(error.code).toBe('PAYLOAD_INVALID');
  });

  it('is unavailable on chains without the contracts', async () => {
    const chain = fakeChain({ chainId: 100 });
    expect(
      (
        await caught(
          predictSplit(chain.context(), { params, owner: ZERO_ADDRESS }),
        )
      ).code,
    ).toBe('UNSUPPORTED_CHAIN');
  });
});

describe('splits.prepareCreateSplit', () => {
  it('builds createSplitDeterministic with sorted params', async () => {
    const { chain, seen } = chainWith();
    const owner = addr(0x0e);
    const prepared = await createSplitsModule(
      chain.context(),
    ).prepareCreateSplit({
      recipients,
      owner,
      distributionIncentive: 5,
    });
    expect(prepared.request.to).toBe(HOODI.pullSplitFactory);
    expect(prepared.request.chainId).toBe(560048);
    expect(prepared.blockNumber).toBe(2_000_000n);
    expect(prepared.preview.address).toBe(PREDICTED);
    expect(prepared.preview.params.recipients).toEqual([A, B]);
    expect(seen[0].owner).toBe(owner);
    const { functionName, args } = decodeFunctionData({
      abi: pullSplitFactoryAbi,
      data: prepared.request.data,
    });
    expect(functionName).toBe('createSplitDeterministic');
    expect(args).toEqual([
      {
        recipients: [A, B],
        allocations: [700_000n, 300_000n],
        totalAllocation: 1_000_000n,
        distributionIncentive: 5,
      },
      owner,
      ZERO_ADDRESS,
      DEFAULT_SPLIT_SALT,
    ]);
  });

  it('throws SPLIT_ALREADY_EXISTS with the address', async () => {
    const { chain } = chainWith(true);
    const error = await caught(
      prepareCreateSplit(chain.context(), { recipients }),
    );
    expect(error.code).toBe('SPLIT_ALREADY_EXISTS');
    expect(error.details.address).toBe(PREDICTED);
  });

  it('throws CONTRACT_NOT_AVAILABLE when the factory code differs', async () => {
    const { chain } = chainWith(false, { code: '0x6080604052' });
    const error = await caught(
      prepareCreateSplit(chain.context(), { recipients }),
    );
    expect(error.code).toBe('CONTRACT_NOT_AVAILABLE');
    expect(error.details.address).toBe(HOODI.pullSplitFactory);
  });

  it('checks shares before any chain read', async () => {
    const { chain } = chainWith();
    const error = await caught(
      prepareCreateSplit(chain.context(), {
        recipients: [{ address: A, share: 10 }],
      }),
    );
    expect(error.code).toBe('PAYLOAD_INVALID');
    expect(chain.requests).toHaveLength(0);
  });

  // rc.12: recipients whose share could never be withdrawn. Addresses are
  // written out (0xSplits v2 deployments, the Hoodi OVM factory, the beacon
  // deposit contract), not read from the SDK's chain table.
  describe('unusable recipients', () => {
    const ZERO = '0x0000000000000000000000000000000000000000';
    const withRecipient = (address: string) => [
      { address: A, share: 700_000 },
      { address, share: 300_000 },
    ];
    const issueOf = async (
      input: Parameters<typeof prepareCreateSplit>[1],
      chain = chainWith().chain,
    ) => {
      const error = await caught(prepareCreateSplit(chain.context(), input));
      expect(error.code).toBe('PAYLOAD_INVALID');
      return (error.details.issues as Array<{ issue?: string }>)[0].issue;
    };

    it('refuses the zero address', async () => {
      expect(await issueOf({ recipients: withRecipient(ZERO) })).toBe(
        'zero_address',
      );
    });

    it.each([
      ['SplitsWarehouse', '0x8fb66F38cF86A3d5e8768f8F1754A24A6c661Fb8'],
      ['PullSplitFactory', '0x5cbA88D55Cec83caD5A105Ad40C8c9aF20bE21d1'],
      ['OVM factory (Hoodi)', '0x5754C8665B7e7BF15E83fCdF6d9636684B782b12'],
      ['deposit contract', '0x00000000219ab540356cBB839Cbe05303d7705Fa'],
      ['EIP-7002 predeploy', '0x00000961Ef480Eb55e80D19ad83579A64c007002'],
      ['EIP-7251 predeploy', '0x0000BBdDc7CE488642fb579F8B00f3a590007251'],
      // Lower-case spelling of the Warehouse: compared case-insensitively.
      [
        'SplitsWarehouse (lower case)',
        '0x8fb66f38cf86a3d5e8768f8f1754a24a6c661fb8',
      ],
    ])('refuses %s as a recipient (protocol_contract)', async (_n, address) => {
      const { chain } = chainWith();
      expect(await issueOf({ recipients: withRecipient(address) }, chain)).toBe(
        'protocol_contract',
      );
      // Refused before any chain read.
      expect(chain.requests).toHaveLength(0);
    });

    it("refuses the split's own predicted address (self_recipient)", async () => {
      expect(await issueOf({ recipients: withRecipient(PREDICTED) })).toBe(
        'self_recipient',
      );
    });

    it('Multicall3 stays a PUBLIC_FORWARDER_AS_RECIPIENT error', async () => {
      const error = await caught(
        prepareCreateSplit(chainWith().chain.context(), {
          recipients: withRecipient(
            '0xcA11bde05977b3631167028862bE2a173976CA11',
          ),
        }),
      );
      expect(error.code).toBe('PUBLIC_FORWARDER_AS_RECIPIENT');
    });

    it('the bound module refuses them too', async () => {
      const error = await caught(
        createSplitsModule(chainWith().chain.context()).prepareCreateSplit({
          recipients: withRecipient(ZERO),
        }),
      );
      expect(error.code).toBe('PAYLOAD_INVALID');
    });
  });

  it('rejects a malformed salt', async () => {
    const { chain } = chainWith();
    const error = await caught(
      prepareCreateSplit(chain.context(), { recipients, salt: '0x1234' }),
    );
    expect(error.code).toBe('PAYLOAD_INVALID');
  });
});
