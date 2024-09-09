import {
  type SplitterReturnedType,
  type ETH_ADDRESS,
  type SplitRecipient,
} from './types';
import { Contract, Interface, parseEther, ZeroAddress, type Signer } from 'ethers';
import { OWRFactoryContract } from './abi/OWR';
import { splitMainEthereumAbi } from './abi/SplitMain';
import { MultiCallContract } from './abi/Multicall';
import { CHAIN_CONFIGURATION } from './constants';

const splitMainContractInterface = new Interface(splitMainEthereumAbi);
const owrFactoryContractInterface = new Interface(OWRFactoryContract.abi);

// Double check if we need them as params with defaults
const RECOVERY_ADDRESS = '0x0000000000000000000000000000000000000000';

type Call = {
  target: ETH_ADDRESS;
  callData: string;
};

type OWRArgs = {
  recoveryAddress?: ETH_ADDRESS;
  principalRecipient: ETH_ADDRESS;
  amountOfPrincipalStake: number;
  predictedSplitterAddress: ETH_ADDRESS;
};

type SplitArgs = {
  accounts: ETH_ADDRESS[];
  percentAllocations: number[];
  distributorFee?: number;
  controllerAddress?: ETH_ADDRESS;
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
  controllerAddress
}: {
  signer: Signer;
  accounts: ETH_ADDRESS[];
  percentAllocations: number[];
  chainId: number;
  distributorFee: number,
  controllerAddress: ETH_ADDRESS
}): Promise<ETH_ADDRESS> => {
  try {
    let predictedSplitterAddress: string;
    const splitMainContractInstance = new Contract(
      CHAIN_CONFIGURATION[chainId].SPLITMAIN_ADDRESS,
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
      //It throws on deployed Immutable splitter
      predictedSplitterAddress =
        await splitMainContractInstance.createSplit.staticCall(
          accounts,
          percentAllocations,
          distributorFee,
          controllerAddress,
        )
    }

    return predictedSplitterAddress;
  } catch (e) {
    throw e
  }
};

export const handleDeployOWRAndSplitter = async ({
  signer,
  isSplitterDeployed,
  predictedSplitterAddress,
  accounts,
  percentAllocations,
  validatorsSize,
  principalRecipient,
  chainId,
  distributorFee,
  controllerAddress
}: {
  signer: Signer;
  isSplitterDeployed: boolean;
  predictedSplitterAddress: ETH_ADDRESS;
  accounts: ETH_ADDRESS[];
  percentAllocations: number[];
  validatorsSize: number;
  principalRecipient: ETH_ADDRESS;
  chainId: number;
  distributorFee: number;
  controllerAddress: ETH_ADDRESS
}): Promise<SplitterReturnedType> => {
  try {
    if (isSplitterDeployed) {
      const owrAddress = await createOWRContract({
        principalRecipient,
        splitterAddress: predictedSplitterAddress,
        amountOfPrincipalStake: validatorsSize * 32,
        signer,
        chainId,
      });
      return {
        withdrawalAddress: owrAddress,
        feeRecipientAddress: predictedSplitterAddress,
      };
    } else {
      const { owrAddress, splitterAddress } =
        await deploySplitterAndOWRContracts({
          owrArgs: {
            principalRecipient,
            amountOfPrincipalStake: validatorsSize * 32,
            predictedSplitterAddress,
          },
          splitterArgs: {
            accounts,
            percentAllocations,
          },
          signer,
          chainId,
          distributorFee,
          controllerAddress
        });

      return {
        withdrawalAddress: owrAddress,
        feeRecipientAddress: splitterAddress,
      };
    }
  } catch (e) {
    throw e;
  }
};

const createOWRContract = async ({
  principalRecipient,
  splitterAddress,
  amountOfPrincipalStake,
  signer,
  chainId,
}: {
  principalRecipient: ETH_ADDRESS;
  splitterAddress: ETH_ADDRESS;
  amountOfPrincipalStake: number;
  signer: Signer;
  chainId: number;
}): Promise<ETH_ADDRESS> => {
  try {
    const OWRFactoryInstance = new Contract(
      CHAIN_CONFIGURATION[chainId].OWR_FACTORY_ADDRESS,
      OWRFactoryContract.abi,
      signer,
    );

    const tx = await OWRFactoryInstance.createOWRecipient(
      RECOVERY_ADDRESS,
      principalRecipient,
      splitterAddress,
      parseEther(amountOfPrincipalStake.toString()),
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
  controllerAddress
}: {
  signer: Signer;
  accounts: ETH_ADDRESS[];
  percentAllocations: number[];
  chainId: number;
  distributorFee: number,
  controllerAddress: ETH_ADDRESS
}) => {

  try {

    const splitMainContractInstance = new Contract(
      CHAIN_CONFIGURATION[chainId].SPLITMAIN_ADDRESS,
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
    const formattedSplitterAddress = "0x" + splitterAddressData?.slice(26, 66);

    return formattedSplitterAddress;
  } catch (e) {
    throw e;
  }

}
export const deploySplitterAndOWRContracts = async ({
  owrArgs,
  splitterArgs,
  signer,
  chainId,
  distributorFee,
  controllerAddress
}: {
  owrArgs: OWRArgs;
  splitterArgs: SplitArgs;
  signer: Signer;
  chainId: number;
  distributorFee: number,
  controllerAddress: ETH_ADDRESS
}): Promise<{ owrAddress: ETH_ADDRESS; splitterAddress: ETH_ADDRESS }> => {
  const executeCalls: Call[] = [];
  splitterArgs.distributorFee = distributorFee;
  splitterArgs.controllerAddress = controllerAddress;

  owrArgs.recoveryAddress = RECOVERY_ADDRESS;
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
        target: CHAIN_CONFIGURATION[chainId].SPLITMAIN_ADDRESS,
        callData: splitTxData,
      },
      {
        target: CHAIN_CONFIGURATION[chainId].OWR_FACTORY_ADDRESS,
        callData: owrTxData,
      },
    );
    const multicallAddess = CHAIN_CONFIGURATION[chainId].MULTICALL_ADDRESS;

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
