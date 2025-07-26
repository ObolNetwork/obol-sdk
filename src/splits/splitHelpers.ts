import {
  type OWRTranches,
  type ClusterValidator,
  type ETH_ADDRESS,
  type SplitRecipient,
  type SignerType,
  type SplitV2Recipient,
  type OVMArgs,
  type ChainConfig,
} from '../types';
import { Contract, Interface, parseEther, ZeroAddress } from 'ethers';
import { OWRContract, OWRFactoryContract } from '../abi/OWR';
import { OVMFactoryContract, OVMContract } from '../abi/OVMFactory';
import { splitMainEthereumAbi } from '../abi/SplitMain';
import { MultiCallContract } from '../abi/Multicall';
import { CHAIN_CONFIGURATION } from '../constants';
import { splitV2FactoryAbi } from '../abi/splitV2FactoryAbi';

const splitMainContractInterface = new Interface(splitMainEthereumAbi);
const owrFactoryContractInterface = new Interface(OWRFactoryContract.abi);
const ovmFactoryContractInterface = new Interface(OVMFactoryContract.abi);
const splitV2FactoryInterface = new Interface(splitV2FactoryAbi);

type Call = {
  target: ETH_ADDRESS;
  callData: string;
};

type OWRArgs = {
  recoveryAddress: ETH_ADDRESS;
  principalRecipient: ETH_ADDRESS;
  amountOfPrincipalStake: number;
  predictedSplitterAddress: ETH_ADDRESS;
};

type SplitArgs = {
  accounts: ETH_ADDRESS[];
  percentAllocations: number[];
  distributorFee: number;
  controllerAddress: ETH_ADDRESS;
};

// Helper function to extract common recipient formatting logic
const formatRecipientsCommon = (
  recipients: SplitRecipient[] | SplitV2Recipient[],
): {
  sortedRecipients: any[];
  getAddress: (item: any) => string;
  getPercentAllocation: (item: any) => number;
} => {
  const copiedRecipients = [...recipients];

  // Handle both SplitRecipient and SplitV2Recipient types
  const getAddress = (item: any): string => item.account || item.address;
  const getPercentAllocation = (item: any): number => item.percentAllocation;

  // Has to be sorted when passed
  copiedRecipients.sort((a, b) => getAddress(a).localeCompare(getAddress(b)));

  return {
    sortedRecipients: copiedRecipients,
    getAddress,
    getPercentAllocation,
  };
};

export const formatSplitRecipients = (
  recipients: SplitRecipient[],
): { accounts: ETH_ADDRESS[]; percentAllocations: number[] } => {
  const { sortedRecipients, getAddress, getPercentAllocation } =
    formatRecipientsCommon(recipients);

  const accounts = sortedRecipients.map(item => getAddress(item));
  const percentAllocations = sortedRecipients.map(recipient => {
    const splitTostring = (getPercentAllocation(recipient) * 1e4).toFixed(0);
    return parseInt(splitTostring);
  });
  return { accounts, percentAllocations };
};

export const predictSplitterAddress = async ({
  signer,
  accounts,
  percentAllocations,
  chainId,
  distributorFee,
  controllerAddress,
}: {
  signer: SignerType;
  accounts: ETH_ADDRESS[];
  percentAllocations: number[];
  chainId: number;
  distributorFee: number;
  controllerAddress: ETH_ADDRESS;
}): Promise<ETH_ADDRESS> => {
  try {
    const splitMainContractInstance = new Contract(
      getChainConfig(chainId).SPLITMAIN_CONTRACT.address,
      splitMainEthereumAbi,
      signer,
    );

    let predictedSplitterAddress: string;

    if (controllerAddress === ZeroAddress) {
      try {
        predictedSplitterAddress =
          await splitMainContractInstance.predictImmutableSplitAddress(
            accounts,
            percentAllocations,
            distributorFee,
          );
      } catch (error: any) {
        throw new Error(
          `Failed to predict immutable splitter address: ${error.message ?? 'Contract call failed'}`,
        );
      }
    } else {
      try {
        // It throws on deployed Immutable splitter
        predictedSplitterAddress =
          await splitMainContractInstance.createSplit.staticCall(
            accounts,
            percentAllocations,
            distributorFee,
            controllerAddress,
          );
      } catch (error: any) {
        throw new Error(
          `Failed to predict mutable splitter address via static call: ${error.message ?? 'Static call failed'}`,
        );
      }
    }

    return predictedSplitterAddress;
  } catch (error: any) {
    // Re-throw if it's already our custom error
    if (error.message.includes('Failed to predict')) {
      throw error;
    }
    // Handle unexpected errors
    throw new Error(
      `Unexpected error in predictSplitterAddress: ${error.message ?? 'Unknown contract interaction error'}`,
    );
  }
};

export const handleDeployOWRAndSplitter = async ({
  signer,
  isSplitterDeployed,
  predictedSplitterAddress,
  accounts,
  percentAllocations,
  etherAmount,
  principalRecipient,
  chainId,
  distributorFee,
  controllerAddress,
  recoveryAddress,
}: {
  signer: SignerType;
  isSplitterDeployed: boolean;
  predictedSplitterAddress: ETH_ADDRESS;
  accounts: ETH_ADDRESS[];
  percentAllocations: number[];
  etherAmount: number;
  principalRecipient: ETH_ADDRESS;
  chainId: number;
  distributorFee: number;
  controllerAddress: ETH_ADDRESS;
  recoveryAddress: ETH_ADDRESS;
}): Promise<ClusterValidator> => {
  try {
    if (isSplitterDeployed) {
      let owrAddress: ETH_ADDRESS;
      try {
        owrAddress = await createOWRContract({
          owrArgs: {
            principalRecipient,
            amountOfPrincipalStake: etherAmount,
            predictedSplitterAddress,
            recoveryAddress,
          },
          signer,
          chainId,
        });
      } catch (error: any) {
        throw new Error(
          `Failed to create OWR contract with existing splitter: ${error.message ?? 'OWR contract creation failed'}`,
        );
      }
      return {
        withdrawal_address: owrAddress,
        fee_recipient_address: predictedSplitterAddress,
      };
    } else {
      let owrAddress: ETH_ADDRESS;
      let splitterAddress: ETH_ADDRESS;
      try {
        const result = await deploySplitterAndOWRContracts({
          owrArgs: {
            principalRecipient,
            amountOfPrincipalStake: etherAmount,
            predictedSplitterAddress,
            recoveryAddress,
          },
          splitterArgs: {
            accounts,
            percentAllocations,
            distributorFee,
            controllerAddress,
          },
          signer,
          chainId,
        });
        owrAddress = result.owrAddress;
        splitterAddress = result.splitterAddress;
      } catch (error: any) {
        throw new Error(
          `Failed to deploy both splitter and OWR contracts: ${error.message ?? 'Multicall contract deployment failed'}`,
        );
      }

      return {
        withdrawal_address: owrAddress,
        fee_recipient_address: splitterAddress,
      };
    }
  } catch (error: any) {
    // Re-throw if it's already our custom error
    if (error.message.includes('Failed to')) {
      throw error;
    }
    // Handle unexpected errors
    throw new Error(
      `Unexpected error in handleDeployOWRAndSplitter: ${error.message ?? 'Unknown error during contract deployment orchestration'}`,
    );
  }
};

const createOWRContract = async ({
  owrArgs,
  signer,
  chainId,
}: {
  owrArgs: OWRArgs;
  signer: SignerType;
  chainId: number;
}): Promise<ETH_ADDRESS> => {
  try {
    const OWRFactoryInstance = new Contract(
      getChainConfig(chainId).OWR_FACTORY_CONTRACT.address,
      OWRFactoryContract.abi,
      signer,
    );

    let tx;
    try {
      tx = await OWRFactoryInstance.createOWRecipient(
        owrArgs.recoveryAddress,
        owrArgs.principalRecipient,
        owrArgs.predictedSplitterAddress,
        parseEther(owrArgs.amountOfPrincipalStake.toString()),
      );
    } catch (error: any) {
      throw new Error(
        `Failed to submit OWR contract creation transaction: ${error.message ?? 'Transaction submission failed'}`,
      );
    }

    let receipt;
    try {
      receipt = await tx.wait();
    } catch (error: any) {
      throw new Error(
        `OWR contract creation transaction failed or was reverted: ${error.message ?? 'Transaction execution failed'}`,
      );
    }

    if (!receipt?.logs?.length) {
      throw new Error(
        'OWR contract creation transaction succeeded but no events were emitted - unable to determine contract address',
      );
    }

    const OWRAddressData = receipt.logs[0]?.topics[1];
    if (!OWRAddressData) {
      throw new Error(
        'OWR contract creation transaction succeeded but contract address could not be extracted from events',
      );
    }

    const formattedOWRAddress = '0x' + OWRAddressData.slice(26, 66);

    // Basic address validation
    if (
      formattedOWRAddress.length !== 42 ||
      !formattedOWRAddress.startsWith('0x')
    ) {
      throw new Error(
        `Invalid OWR contract address format: ${formattedOWRAddress}`,
      );
    }

    return formattedOWRAddress;
  } catch (error: any) {
    // Re-throw if it's already our custom error
    if (
      error.message.includes('Failed to') ||
      error.message.includes('OWR contract') ||
      error.message.includes('Invalid OWR')
    ) {
      throw error;
    }
    // Handle unexpected errors
    throw new Error(
      `Unexpected error in createOWRContract: ${error.message ?? 'Unknown error during OWR contract creation'}`,
    );
  }
};

export const deploySplitterContract = async ({
  signer,
  accounts,
  percentAllocations,
  chainId,
  distributorFee,
  controllerAddress,
}: {
  signer: SignerType;
  accounts: ETH_ADDRESS[];
  percentAllocations: number[];
  chainId: number;
  distributorFee: number;
  controllerAddress: ETH_ADDRESS;
}): Promise<ETH_ADDRESS> => {
  try {
    const splitMainContractInstance = new Contract(
      getChainConfig(chainId).SPLITMAIN_CONTRACT.address,
      splitMainEthereumAbi,
      signer,
    );

    let tx;
    try {
      tx = await splitMainContractInstance.createSplit(
        accounts,
        percentAllocations,
        distributorFee,
        controllerAddress,
      );
    } catch (error: any) {
      throw new Error(
        `Failed to submit splitter contract creation transaction: ${error.message ?? 'Transaction submission failed'}`,
      );
    }

    let receipt;
    try {
      receipt = await tx.wait();
    } catch (error: any) {
      throw new Error(
        `Splitter contract creation transaction failed or was reverted: ${error.message ?? 'Transaction execution failed'}`,
      );
    }

    if (!receipt?.logs?.length) {
      throw new Error(
        'Splitter contract creation transaction succeeded but no events were emitted - unable to determine contract address',
      );
    }

    const splitterAddressData = receipt.logs[0]?.topics[1];
    if (!splitterAddressData) {
      throw new Error(
        'Splitter contract creation transaction succeeded but contract address could not be extracted from events',
      );
    }

    const formattedSplitterAddress = '0x' + splitterAddressData.slice(26, 66);

    // Basic address validation
    if (
      formattedSplitterAddress.length !== 42 ||
      !formattedSplitterAddress.startsWith('0x')
    ) {
      throw new Error(
        `Invalid splitter contract address format: ${formattedSplitterAddress}`,
      );
    }

    return formattedSplitterAddress;
  } catch (error: any) {
    // Re-throw if it's already our custom error
    if (
      error.message.includes('Failed to') ||
      error.message.includes('Splitter contract') ||
      error.message.includes('Invalid splitter')
    ) {
      throw error;
    }
    // Handle unexpected errors
    throw new Error(
      `Unexpected error in deploySplitterContract: ${error.message ?? 'Unknown error during splitter contract creation'}`,
    );
  }
};

export const deploySplitterAndOWRContracts = async ({
  owrArgs,
  splitterArgs,
  signer,
  chainId,
}: {
  owrArgs: OWRArgs;
  splitterArgs: SplitArgs;
  signer: SignerType;
  chainId: number;
}): Promise<{ owrAddress: ETH_ADDRESS; splitterAddress: ETH_ADDRESS }> => {
  const executeCalls: Call[] = [];

  const splitTxData = encodeCreateSplitTxData(
    splitterArgs.accounts,
    splitterArgs.percentAllocations,
    splitterArgs.distributorFee,
    splitterArgs.controllerAddress,
  );

  const owrTxData = encodeCreateOWRecipientTxData(
    owrArgs.recoveryAddress,
    owrArgs.principalRecipient,
    owrArgs.predictedSplitterAddress,
    owrArgs.amountOfPrincipalStake,
  );

  executeCalls.push(
    {
      target: getChainConfig(chainId).SPLITMAIN_CONTRACT.address,
      callData: splitTxData,
    },
    {
      target: getChainConfig(chainId).OWR_FACTORY_CONTRACT.address,
      callData: owrTxData,
    },
  );

  const executeMultiCalls = await multicall(executeCalls, signer, chainId);

  const splitAddressData = executeMultiCalls?.logs[0]?.topics[1];
  const formattedSplitterAddress = '0x' + splitAddressData?.slice(26, 66);
  const owrAddressData = executeMultiCalls?.logs[1]?.topics[1];
  const formattedOwrAddress = '0x' + owrAddressData?.slice(26, 66);

  return {
    owrAddress: formattedOwrAddress,
    splitterAddress: formattedSplitterAddress,
  };
};

export const getOWRTranches = async ({
  owrAddress,
  signer,
}: {
  owrAddress: ETH_ADDRESS;
  signer: SignerType;
}): Promise<OWRTranches> => {
  try {
    const owrContract = new Contract(owrAddress, OWRContract.abi, signer);

    let res;
    try {
      res = await owrContract.getTranches();
    } catch (error: any) {
      throw new Error(
        `Failed to call getTranches on OWR contract at ${owrAddress}: ${error.message ?? 'Contract call failed'}`,
      );
    }

    if (!res) {
      throw new Error(
        `OWR contract at ${owrAddress} returned empty result for getTranches()`,
      );
    }

    return {
      principalRecipient: res.principalRecipient,
      rewardRecipient: res.rewardRecipient,
      amountOfPrincipalStake: res.amountOfPrincipalStake,
    };
  } catch (error: any) {
    // Re-throw if it's already our custom error
    if (
      error.message.includes('Failed to') ||
      error.message.includes('OWR contract')
    ) {
      throw error;
    }
    // Handle unexpected errors
    throw new Error(
      `Unexpected error in getOWRTranches: ${error.message ?? 'Unknown error while fetching OWR tranche data'}`,
    );
  }
};

export const multicall = async (
  calls: Call[],
  signer: SignerType,
  chainId: number,
): Promise<any> => {
  try {
    const chainConfig = getChainConfig(chainId);
    const multicallAddress = chainConfig.MULTICALL_CONTRACT.address;
    const multiCallContractInstance = new Contract(
      multicallAddress,
      MultiCallContract.abi,
      signer,
    );

    let tx;
    try {
      tx = await multiCallContractInstance.aggregate(calls);
    } catch (error: any) {
      throw new Error(
        `Failed to submit multicall transaction: ${error.message ?? 'Transaction submission failed'}`,
      );
    }

    let receipt;
    try {
      receipt = await tx.wait();
    } catch (error: any) {
      throw new Error(
        `Multicall transaction failed or was reverted: ${error.message ?? 'Transaction execution failed'}`,
      );
    }

    if (!receipt) {
      throw new Error(
        'Multicall transaction succeeded but no receipt was returned',
      );
    }

    return receipt;
  } catch (error: any) {
    // Re-throw if it's already our custom error
    if (
      error.message.includes('Failed to') ||
      error.message.includes('Multicall transaction')
    ) {
      throw error;
    }
    // Handle unexpected errors
    throw new Error(
      `Unexpected error in multicall: ${error.message ?? 'Unknown error during multicall execution'}`,
    );
  }
};

const encodeCreateSplitTxData = (
  accounts: ETH_ADDRESS[],
  percentAllocations: number[],
  distributorFee: number,
  controller: ETH_ADDRESS,
): ETH_ADDRESS => {
  return splitMainContractInterface.encodeFunctionData('createSplit', [
    accounts,
    percentAllocations,
    distributorFee,
    controller,
  ]);
};

const encodeCreateOWRecipientTxData = (
  recoveryAddress: ETH_ADDRESS,
  principalRecipient: ETH_ADDRESS,
  rewardRecipient: ETH_ADDRESS,
  amountOfPrincipalStake: number,
): ETH_ADDRESS => {
  return owrFactoryContractInterface.encodeFunctionData('createOWRecipient', [
    recoveryAddress,
    principalRecipient,
    rewardRecipient,
    parseEther(amountOfPrincipalStake.toString()),
  ]);
};

// OVM and SplitV2 Helper Functions

// Helper function to format recipients specifically for SplitV2 (returns SplitV2Recipient[])
export const formatRecipientsForSplitV2 = (
  splitRecipients: SplitRecipient[] | SplitV2Recipient[],
): SplitV2Recipient[] => {
  const { sortedRecipients, getAddress, getPercentAllocation } =
    formatRecipientsCommon(splitRecipients);

  return sortedRecipients
    .filter(item => getAddress(item) !== '')
    .map(item => ({
      address: getAddress(item),
      percentAllocation: parseFloat(getPercentAllocation(item).toString()),
    }));
};

// Helper function to create SplitV2 parameters
const createSplitV2Params = (
  recipients: SplitV2Recipient[],
  distributorFeePercent: number,
): {
  recipients: string[];
  allocations: number[];
  totalAllocation: number;
  distributionIncentive: number;
} => {
  const addresses = recipients.map(r => r.address);
  const allocations = recipients.map(r =>
    Math.floor(r.percentAllocation * 1e4),
  ); // Convert to basis points
  const totalAllocation = allocations.reduce(
    (sum, allocation) => sum + allocation,
    0,
  );

  return {
    recipients: addresses,
    allocations,
    totalAllocation,
    distributionIncentive: distributorFeePercent,
  };
};

export const predictSplitV2Address = async ({
  splitOwnerAddress,
  recipients,
  distributorFeePercent,
  salt,
  signer,
  chainId,
}: {
  splitOwnerAddress: string;
  recipients: SplitV2Recipient[];
  distributorFeePercent: number;
  salt: `0x${string}`;
  signer: SignerType;
  chainId: number;
}): Promise<string> => {
  try {
    const chainConfig = getChainConfig(chainId);
    if (!chainConfig?.SPLIT_V2_FACTORY_CONTRACT?.address) {
      throw new Error(`SplitV2 Factory not configured for chain ${chainId}`);
    }

    const splitV2FactoryContract = new Contract(
      chainConfig.SPLIT_V2_FACTORY_CONTRACT.address,
      splitV2FactoryAbi,
      signer,
    );

    const splitParams = createSplitV2Params(recipients, distributorFeePercent);

    const predictedAddress = await splitV2FactoryContract[
      'predictDeterministicAddress((address[],uint256[],uint256,uint16),address,bytes32)'
    ](splitParams, splitOwnerAddress, salt);

    return predictedAddress;
  } catch (error: any) {
    throw new Error(
      `Failed to predict SplitV2 address: ${error.message ?? 'SplitV2 contract call failed'}`,
    );
  }
};

export const isSplitV2Deployed = async ({
  splitOwnerAddress,
  recipients,
  distributorFeePercent,
  salt,
  signer,
  chainId,
}: {
  splitOwnerAddress: string;
  recipients: SplitV2Recipient[];
  distributorFeePercent: number;
  salt: `0x${string}`;
  signer: SignerType;
  chainId: number;
}): Promise<boolean> => {
  try {
    const chainConfig = getChainConfig(chainId);
    if (!chainConfig?.SPLIT_V2_FACTORY_CONTRACT?.address) {
      throw new Error(`SplitV2 Factory not configured for chain ${chainId}`);
    }

    const splitV2FactoryContract = new Contract(
      chainConfig.SPLIT_V2_FACTORY_CONTRACT.address,
      splitV2FactoryAbi,
      signer,
    );

    const splitParams = createSplitV2Params(recipients, distributorFeePercent);

    const [, exists] = await splitV2FactoryContract.isDeployed(
      splitParams,
      splitOwnerAddress,
      salt,
    );

    return exists;
  } catch (error: any) {
    // If the check fails, assume it's not deployed
    return false;
  }
};

export const deployOVMContract = async ({
  OVMOwnerAddress,
  principalRecipient,
  rewardRecipient,
  principalThreshold,
  signer,
  chainId,
}: {
  OVMOwnerAddress: string;
  principalRecipient: string;
  rewardRecipient: string;
  principalThreshold: number;
  signer: SignerType;
  chainId: number;
}): Promise<string> => {
  try {
    const chainConfig = getChainConfig(chainId);
    if (!chainConfig?.OVM_FACTORY_CONTRACT?.address) {
      throw new Error(`OVM Factory not configured for chain ${chainId}`);
    }

    const ovmFactoryContract = new Contract(
      chainConfig.OVM_FACTORY_CONTRACT.address,
      OVMFactoryContract.abi,
      signer,
    );

    const tx = await ovmFactoryContract.createObolValidatorManager(
      OVMOwnerAddress,
      principalRecipient,
      rewardRecipient,
      principalThreshold,
    );

    const receipt = await tx.wait();

    // Extract OVM address from logs
    const ovmAddressLog = receipt?.logs[1]?.topics[1];
    if (!ovmAddressLog) {
      throw new Error('Failed to extract OVM address from transaction logs');
    }

    const ovmAddress = '0x' + ovmAddressLog.slice(26, 66);
    return ovmAddress;
  } catch (error: any) {
    throw new Error(
      `Failed to deploy OVM contract: ${error.message ?? 'OVM deployment failed'}`,
    );
  }
};

export const deployOVMAndSplitV2 = async ({
  ovmArgs,
  rewardRecipients,
  isRewardsSplitterDeployed,
  distributorFeePercent,
  salt,
  signer,
  chainId,
  principalSplitRecipients,
  isPrincipalSplitDeployed,
  splitOwnerAddress,
}: {
  ovmArgs: OVMArgs;
  rewardRecipients: SplitV2Recipient[];
  isRewardsSplitterDeployed?: boolean;
  distributorFeePercent: number;
  salt: `0x${string}`;
  signer: SignerType;
  chainId: number;
  principalSplitRecipients?: SplitV2Recipient[];
  isPrincipalSplitDeployed?: boolean;
  splitOwnerAddress: string;
}): Promise<string> => {
  try {
    const chainConfig = getChainConfig(chainId);
    if (!chainConfig?.OVM_FACTORY_CONTRACT?.address) {
      throw new Error(`OVM Factory not configured for chain ${chainId}`);
    }

    if (!chainConfig?.SPLIT_V2_FACTORY_CONTRACT?.address) {
      throw new Error(`SplitV2 Factory not configured for chain ${chainId}`);
    }

    const executeCalls: Call[] = [];

    if (rewardRecipients && !isRewardsSplitterDeployed) {
      // Create rewards split call data
      const splitParams = createSplitV2Params(
        rewardRecipients,
        distributorFeePercent,
      );
      const rewardsSplitTxData = encodeCreateSplitV2DeterministicTxData(
        splitParams,
        splitOwnerAddress,
        salt,
      );

      executeCalls.push({
        target: chainConfig.SPLIT_V2_FACTORY_CONTRACT.address,
        callData: rewardsSplitTxData,
      });
    }

    // Create principal split call data if needed (for total split scenario)
    if (principalSplitRecipients && !isPrincipalSplitDeployed) {
      const principalSplitParams = createSplitV2Params(
        principalSplitRecipients,
        distributorFeePercent,
      );
      const principalSplitTxData = encodeCreateSplitV2DeterministicTxData(
        principalSplitParams,
        splitOwnerAddress,
        salt,
      );
      executeCalls.push({
        target: chainConfig.SPLIT_V2_FACTORY_CONTRACT.address,
        callData: principalSplitTxData,
      });
    }

    // Create OVM call data
    const ovmTxData = encodeCreateOVMTxData(
      ovmArgs.OVMOwnerAddress,
      ovmArgs.principalRecipient,
      ovmArgs.rewardRecipient,
      ovmArgs.principalThreshold,
    );

    executeCalls.push({
      target: chainConfig.OVM_FACTORY_CONTRACT.address,
      callData: ovmTxData,
    });

    // Execute multicall
    const executeMultiCalls = await multicall(executeCalls, signer, chainId);

    // Extract addresses from events
    let ovmAddress: string | undefined;
    const logsCount = executeMultiCalls?.logs?.length || 0;

    if (logsCount === 2) {
      ovmAddress = '0x' + executeMultiCalls?.logs[1]?.topics[1]?.slice(26, 66);
    } else if (logsCount === 5) {
      ovmAddress = '0x' + executeMultiCalls?.logs[4]?.topics[1]?.slice(26, 66);
    } else {
      ovmAddress = '0x' + executeMultiCalls?.logs[7]?.topics[1]?.slice(26, 66);
    }
    if (!ovmAddress) {
      throw new Error(
        'Failed to extract contract addresses from multicall events',
      );
    }

    return ovmAddress;
  } catch (error: any) {
    throw new Error(
      `Failed to deploy OVM and SplitV2: ${error.message ?? 'Deployment failed'}`,
    );
  }
};

const encodeCreateOVMTxData = (
  OVMOwnerAddress: string,
  principalRecipient: string,
  rewardRecipient: string,
  principalThreshold: number,
): string => {
  return ovmFactoryContractInterface.encodeFunctionData(
    'createObolValidatorManager',
    [OVMOwnerAddress, principalRecipient, rewardRecipient, principalThreshold],
  );
};

const encodeCreateSplitV2DeterministicTxData = (
  splitParams: {
    recipients: string[];
    allocations: number[];
    totalAllocation: number;
    distributionIncentive: number;
  },
  splitOwnerAddress: string,
  salt: `0x${string}`,
): string => {
  // creatorAddress can be kept as default https://docs.splits.org/sdk/splits-v2#createsplit
  return splitV2FactoryInterface.encodeFunctionData(
    'createSplitDeterministic',
    [splitParams, splitOwnerAddress, ZeroAddress, salt],
  );
};

// Helper function to safely get chain configuration
const getChainConfig = (chainId: number): ChainConfig => {
  const config = CHAIN_CONFIGURATION[chainId];
  if (!config) {
    throw new Error(`Chain configuration not found for chain ID ${chainId}`);
  }
  return config;
};

/**
 * Requests withdrawal from an OVM contract
 * @param ovmAddress - The address of the OVM contract
 * @param pubKeys - Array of validator public keys in bytes format
 * @param amounts - Array of withdrawal amounts in wei (uint64)
 * @param signer - The signer to use for the transaction
 * @returns Promise that resolves to the transaction hash
 */
export const requestWithdrawalFromOVM = async ({
  ovmAddress,
  pubKeys,
  amounts,
  withdrawalFees,
  signer,
}: {
  ovmAddress: string;
  pubKeys: string[];
  amounts: string[];
  withdrawalFees: string;
  signer: SignerType;
}): Promise<{ txHash: string }> => {
  try {
    // Convert string amounts to bigint
    const bigintAmounts = amounts.map(amount => BigInt(amount));

    const ovmContract = new Contract(ovmAddress, OVMContract.abi, signer);

    const tx = await ovmContract.requestWithdrawal(pubKeys, bigintAmounts, { value: BigInt(withdrawalFees) });
    const receipt = await tx.wait();

    return { txHash: receipt.hash };
  } catch (error: any) {
    throw new Error(
      `Failed to request withdrawal from OVM: ${error.message ?? 'Request withdrawal failed'}`,
    );
  }
};
