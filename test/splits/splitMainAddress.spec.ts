// @ts-nocheck
// SplitMain (v1) mutable splits are created with CREATE, so their address
// depends on SplitMain's nonce. createObolRewardsSplit / createObolTotalSplit
// must not freeze a predicted mutable address as an OWR reward recipient or
// return one as the splitter. See KNOWN_ISSUES.md.
import { jest } from '@jest/globals';
import { ZeroAddress } from 'ethers';
import { type SignerType, type ProviderType } from '../../src/types.js';
import { TEST_ADDRESSES } from '../fixtures.js';

// @ts-expect-error - ESM mocking requires top-level await
await jest.unstable_mockModule('../../src/splits/splitHelpers.js', () => ({
  __esModule: true,
  formatSplitRecipients: jest.fn(),
  predictSplitterAddress: jest.fn(),
  handleDeployOWRAndSplitter: jest.fn(),
  deploySplitterContract: jest.fn(),
  deploySplitterAndOWRContracts: jest.fn(),
  getOWRTranches: jest.fn(),
  multicall3: jest.fn(),
  formatRecipientsForSplitV2: jest.fn(),
  predictSplitV2Address: jest.fn(),
  isSplitV2Deployed: jest.fn(),
  deployOVMContract: jest.fn(),
  deployOVMAndSplitV2: jest.fn(),
  requestWithdrawalFromOVM: jest.fn(),
  depositOVM: jest.fn(),
  isContractWalletSigner: jest.fn(async () => false),
  submitViaContractWalletAndWait: jest.fn(),
}));

// @ts-expect-error - ESM mocking requires top-level await
await jest.unstable_mockModule('../../src/utils.js', () => ({
  __esModule: true,
  hexWithout0x: jest.fn((hex: string) => hex.replace(/^0x/, '')),
  strToUint8Array: jest.fn((str: string) => new TextEncoder().encode(str)),
  definitionFlow: jest.fn(),
  findDeployedBytecode: jest.fn(),
  isContractAvailable: jest.fn(),
  getProvider: jest.fn(),
  assertSignerChain: jest.fn(async () => undefined),
}));

// @ts-expect-error - ESM mocking requires top-level await
await jest.unstable_mockModule('../../src/ajv.js', () => ({
  __esModule: true,
  VALID_DEPOSIT_AMOUNTS: [32000000000, 1000000000],
  VALID_NON_COMPOUNDING_AMOUNTS: [32000000000],
  validatePayload: jest.fn(data => data),
}));

const { Client } = await import('../../src/index.js');
const splitHelpers = await import('../../src/splits/splitHelpers.js');
const utils = await import('../../src/utils.js');

const mockPredict = splitHelpers.predictSplitterAddress as jest.Mock;
const mockDeploySplitter = splitHelpers.deploySplitterContract as jest.Mock;
const mockHandleDeploy = splitHelpers.handleDeployOWRAndSplitter as jest.Mock;
const mockFormat = splitHelpers.formatSplitRecipients as jest.Mock;
const mockIsContractAvailable = utils.isContractAvailable as jest.Mock;

// Roles only: none of these are contracts in the mocked chain.
const CONTROLLER = TEST_ADDRESSES.SPLIT_OWNER;
const PRINCIPAL = TEST_ADDRESSES.PRINCIPAL_RECIPIENT;
const DEPLOYED_SPLIT = TEST_ADDRESSES.PRINCIPAL_RECIPIENT_1;
const PREDICTED_SPLIT = TEST_ADDRESSES.PRINCIPAL_RECIPIENT_2;
const OWR = TEST_ADDRESSES.OVM_OWNER;

const splitRecipients = [
  { account: TEST_ADDRESSES.REWARD_RECIPIENT_1, percentAllocation: 49 },
  { account: TEST_ADDRESSES.REWARD_RECIPIENT_2, percentAllocation: 50 },
];

let client: InstanceType<typeof Client>;

beforeEach(() => {
  jest.clearAllMocks();
  const signer = {
    getAddress: jest.fn().mockResolvedValue(PRINCIPAL),
    provider: { getCode: jest.fn().mockResolvedValue('0x1234') },
  } as unknown as SignerType;
  const provider = {
    getCode: jest.fn().mockResolvedValue('0x1234'),
  } as unknown as ProviderType;
  client = new Client({ chainId: 1 }, signer, provider);
  mockFormat.mockReturnValue({
    accounts: splitRecipients.map(r => r.account),
    percentAllocations: [490000, 500000, 10000],
  });
  // Factory contract checks pass; the predicted split is not deployed.
  mockIsContractAvailable.mockImplementation(
    async (address: string) => address !== PREDICTED_SPLIT,
  );
  mockDeploySplitter.mockResolvedValue(DEPLOYED_SPLIT);
  mockPredict.mockResolvedValue(PREDICTED_SPLIT);
  mockHandleDeploy.mockImplementation(async args => ({
    withdrawal_address: OWR,
    fee_recipient_address: args.predictedSplitterAddress,
  }));
});

describe('createObolRewardsSplit split address', () => {
  const payload = {
    splitRecipients,
    principalRecipient: PRINCIPAL,
    etherAmount: 32,
    ObolRAFSplit: 1,
    distributorFee: 0,
    recoveryAddress: ZeroAddress,
  };

  it('deploys a mutable split first and points the OWR at its address', async () => {
    const result = await client.createObolRewardsSplit({
      ...payload,
      controllerAddress: CONTROLLER,
    });

    expect(mockPredict).not.toHaveBeenCalled();
    expect(mockDeploySplitter).toHaveBeenCalledWith(
      expect.objectContaining({ controllerAddress: CONTROLLER }),
    );
    expect(mockHandleDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        isSplitterDeployed: true,
        predictedSplitterAddress: DEPLOYED_SPLIT,
      }),
    );
    expect(mockDeploySplitter.mock.invocationCallOrder[0]).toBeLessThan(
      mockHandleDeploy.mock.invocationCallOrder[0],
    );
    expect(result).toEqual({
      withdrawal_address: OWR,
      fee_recipient_address: DEPLOYED_SPLIT,
    });
  });

  it('uses the deterministic immutable address when there is no controller', async () => {
    await client.createObolRewardsSplit({
      ...payload,
      controllerAddress: ZeroAddress,
    });

    expect(mockDeploySplitter).not.toHaveBeenCalled();
    expect(mockPredict).toHaveBeenCalledWith(
      expect.objectContaining({ controllerAddress: ZeroAddress }),
    );
    expect(mockHandleDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        isSplitterDeployed: false,
        predictedSplitterAddress: PREDICTED_SPLIT,
      }),
    );
  });
});

describe('createObolTotalSplit split address', () => {
  const payload = { splitRecipients, ObolRAFSplit: 1, distributorFee: 0 };

  it('always deploys a mutable split, even if the predicted address has code', async () => {
    mockIsContractAvailable.mockResolvedValue(true);

    const result = await client.createObolTotalSplit({
      ...payload,
      controllerAddress: CONTROLLER,
    });

    expect(mockPredict).not.toHaveBeenCalled();
    expect(mockDeploySplitter).toHaveBeenCalled();
    expect(result).toEqual({
      withdrawal_address: DEPLOYED_SPLIT,
      fee_recipient_address: DEPLOYED_SPLIT,
    });
  });

  it('reuses an existing immutable split', async () => {
    mockIsContractAvailable.mockResolvedValue(true);

    const result = await client.createObolTotalSplit({
      ...payload,
      controllerAddress: ZeroAddress,
    });

    expect(mockDeploySplitter).not.toHaveBeenCalled();
    expect(result).toEqual({
      withdrawal_address: PREDICTED_SPLIT,
      fee_recipient_address: PREDICTED_SPLIT,
    });
  });

  it('deploys an immutable split that does not exist yet', async () => {
    const result = await client.createObolTotalSplit({
      ...payload,
      controllerAddress: ZeroAddress,
    });

    expect(mockPredict).toHaveBeenCalled();
    expect(mockDeploySplitter).toHaveBeenCalled();
    expect(result.withdrawal_address).toEqual(DEPLOYED_SPLIT);
  });
});
