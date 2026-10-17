// @ts-nocheck
import { jest } from '@jest/globals';
import { AbiCoder, Interface } from 'ethers';
import { predictSplitV2Address } from '../../src/splits/splitHelpers.js';
import { splitV2FactoryAbi } from '../../src/abi/splitV2FactoryAbi.js';
import { TEST_ADDRESSES } from '../fixtures.js';

const factory = new Interface(splitV2FactoryAbi);
const PREDICT =
  'predictDeterministicAddress((address[],uint256[],uint256,uint16),address,bytes32)';

const incentiveSentFor = async (distributorFeePercent: number) => {
  const call = jest.fn(async () =>
    AbiCoder.defaultAbiCoder().encode(
      ['address'],
      [TEST_ADDRESSES.SPLIT_OWNER],
    ),
  );
  await predictSplitV2Address({
    splitOwnerAddress: TEST_ADDRESSES.SPLIT_OWNER,
    recipients: [
      { address: TEST_ADDRESSES.REWARD_RECIPIENT_1, percentAllocation: 99 },
      { address: TEST_ADDRESSES.REWARD_RECIPIENT_2, percentAllocation: 1 },
    ],
    distributorFeePercent,
    salt: `0x${'00'.repeat(32)}`,
    signer: undefined,
    chainId: 560048,
    provider: { call },
  });
  const [params] = factory.decodeFunctionData(
    PREDICT,
    call.mock.calls[0][0].data,
  );
  return params.distributionIncentive;
};

describe('SplitV2 distributionIncentive', () => {
  it('scales distributorFeePercent to the SplitV2 1e6 scale', async () => {
    await expect(incentiveSentFor(0)).resolves.toBe(0n);
    await expect(incentiveSentFor(1)).resolves.toBe(10000n);
    await expect(incentiveSentFor(2.5)).resolves.toBe(25000n);
    await expect(incentiveSentFor(6.5535)).resolves.toBe(65535n);
  });
});
