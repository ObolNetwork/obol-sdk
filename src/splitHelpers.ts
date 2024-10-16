import {
  type OWRTranches,
  type ClusterValidator,
  type ETH_ADDRESS,
  type SplitRecipient,
} from './types';
import {
  Contract,
  Interface,
  parseEther,
  ZeroAddress,
  type Signer,
} from 'ethers';
import { OWRContract, OWRFactoryContract } from './abi/OWR';
import { splitMainEthereumAbi } from './abi/SplitMain';
import { MultiCallContract } from './abi/Multicall';
import { CHAIN_CONFIGURATION } from './constants';

const splitMainContractInterface = new Interface(splitMainEthereumAbi);
const owrFactoryContractInterface = new Interface(OWRFactoryContract.abi);

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

export const formatSplitRecipients = (
  recipients: SplitRecipient[],
): { accounts: ETH_ADDRESS[]; percentAllocations: number[] } => {
  // Has to be sorted when passed
  recipients.sort((a, b) => a.account.localeCompare(b.account));
  const accounts = recipients.map(item => item.account);
  const percentAllocations = recipients.map(recipient => {
    const splitTostring = (recipient.percentAllocation * 1e4).toFixed(0);
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
  signer: Signer;
  accounts: ETH_ADDRESS[];
  percentAllocations: number[];
  chainId: number;
  distributorFee: number;
  controllerAddress: ETH_ADDRESS;
}): Promise<ETH_ADDRESS> => {
  try {
    let predictedSplitterAddress: string;
    const splitMainContractInstance = new Contract(
      CHAIN_CONFIGURATION[chainId].SPLITMAIN_ADDRESS.address,
      splitMainEthereumAbi,
      signer,
    );

    if (controllerAddress === ZeroAddress) {
      predictedSplitterAddress =
        await splitMainContractInstance.predictImmutableSplitAddress(
          accounts,
          percentAllocations,
          distributorFee,
        );
    } else {
      // It throws on deployed Immutable splitter
      predictedSplitterAddress =
        await splitMainContractInstance.createSplit.staticCall(
          accounts,
          percentAllocations,
          distributorFee,
          controllerAddress,
        );
    }

    return predictedSplitterAddress;
  } catch (e) {
    throw e;
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
  signer: Signer;
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
      const owrAddress = await createOWRContract({
        owrArgs: {
          principalRecipient,
          amountOfPrincipalStake: etherAmount,
          predictedSplitterAddress,
          recoveryAddress,
        },
        signer,
        chainId,
      });
      return {
        withdrawal_address: owrAddress,
        fee_recipient_address: predictedSplitterAddress,
      };
    } else {
      const { owrAddress, splitterAddress } =
        await deploySplitterAndOWRContracts({
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

      return {
        withdrawal_address: owrAddress,
        fee_recipient_address: splitterAddress,
      };
    }
  } catch (e) {
    throw e;
  }
};

const createOWRContract = async ({
  owrArgs,
  signer,
  chainId,
}: {
  owrArgs: OWRArgs;
  signer: Signer;
  chainId: number;
}): Promise<ETH_ADDRESS> => {
  try {
    const OWRFactoryInstance = new Contract(
      CHAIN_CONFIGURATION[chainId].OWR_FACTORY_ADDRESS.address,
      OWRFactoryContract.abi,
      signer,
    );

    const tx = await OWRFactoryInstance.createOWRecipient(
      owrArgs.recoveryAddress,
      owrArgs.principalRecipient,
      owrArgs.predictedSplitterAddress,
      parseEther(owrArgs.amountOfPrincipalStake.toString()),
    );

    const receipt = await tx.wait();
    const OWRAddressData = receipt?.logs[0]?.topics[1];
    const formattedOWRAddress = '0x' + OWRAddressData?.slice(26, 66);

    return formattedOWRAddress;
  } catch (e) {
    throw e;
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
  signer: Signer;
  accounts: ETH_ADDRESS[];
  percentAllocations: number[];
  chainId: number;
  distributorFee: number;
  controllerAddress: ETH_ADDRESS;
}): Promise<ETH_ADDRESS> => {
  try {
    const splitMainContractInstance = new Contract(
      CHAIN_CONFIGURATION[chainId].SPLITMAIN_ADDRESS.address,
      splitMainEthereumAbi,
      signer,
    );
    const tx = await splitMainContractInstance.createSplit(
      accounts,
      percentAllocations,
      distributorFee,
      controllerAddress,
    );

    const receipt = await tx.wait();
    const splitterAddressData = receipt?.logs[0]?.topics[1];
    const formattedSplitterAddress = '0x' + splitterAddressData?.slice(26, 66);

    return formattedSplitterAddress;
  } catch (e) {
    throw e;
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
  signer: Signer;
  chainId: number;
}): Promise<{ owrAddress: ETH_ADDRESS; splitterAddress: ETH_ADDRESS }> => {
  const executeCalls: Call[] = [];
  try {
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
        target: CHAIN_CONFIGURATION[chainId].SPLITMAIN_ADDRESS.address,
        callData: splitTxData,
      },
      {
        target: CHAIN_CONFIGURATION[chainId].OWR_FACTORY_ADDRESS.address,
        callData: owrTxData,
      },
    );
    const multicallAddess =
      CHAIN_CONFIGURATION[chainId].MULTICALL_ADDRESS.address;

    const executeMultiCalls = await multicall(
      executeCalls,
      signer,
      multicallAddess,
    );

    const splitAddressData = executeMultiCalls?.logs[0]?.topics[1];
    const formattedSplitterAddress = '0x' + splitAddressData?.slice(26, 66);
    const owrAddressData = executeMultiCalls?.logs[1]?.topics[1];
    const formattedOwrAddress = '0x' + owrAddressData?.slice(26, 66);

    return {
      owrAddress: formattedOwrAddress,
      splitterAddress: formattedSplitterAddress,
    };
  } catch (e) {
    throw e;
  }
};

export const getOWRTranches = async ({
  owrAddress,
  signer,
}: {
  owrAddress: ETH_ADDRESS;
  signer: Signer;
}): Promise<OWRTranches> => {
  const owrContract = new Contract(owrAddress, OWRContract.abi, signer);
  const res = await owrContract.getTranches();

  return {
    principalRecipient: res.principalRecipient,
    rewardRecipient: res.rewardRecipient,
    amountOfPrincipalStake: res.amountOfPrincipalStake
  }
};

export const multicall = async (
  calls: Call[],
  signer: Signer,
  multicallAddress: string,
): Promise<any> => {
  const multiCallContractInstance = new Contract(
    multicallAddress,
    MultiCallContract.abi,
    signer,
  );
  const tx = await multiCallContractInstance.aggregate(calls);
  const receipt = await tx.wait();
  return receipt;
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
