import { ClusterValidator, ETH_ADDRESS, SplitRecipient } from "./types";
import { Contract, Interface, parseEther, Signer } from "ethers";
import { OWRFactoryContract } from "./abi/OWR";
import { splitMainEthereumAbi } from "./abi/SplitMain";
import { MultiCallContract } from "./abi/Multicall"
import { CHAIN_CONFIGURATION } from "./constants";

const splitMainContractInterface = new Interface(splitMainEthereumAbi);
const owrFactoryContractInterface = new Interface(OWRFactoryContract.abi);

//Define them in constants and map them to each chainId

export const RETROACTIVE_FUNDING_SPLIT = 1

//Double check if we need them as params with defaults 
const DISTRIBUTOR_FEE = 0;
const RECOVERY_ADDRESS = "0x0000000000000000000000000000000000000000"
const controller = "0x0000000000000000000000000000000000000000";


type Call = {
    target: ETH_ADDRESS;
    callData: string;
}

type OWRArgs = {
    recoveryAddress?: ETH_ADDRESS;
    principalRecipient: ETH_ADDRESS;
    amountOfPrincipalStake: number;
    predictedSplitterAddress: ETH_ADDRESS;
}

type SplitArgs = {
    accounts: ETH_ADDRESS[];
    percentAllocations: number[];
    distributorFee?: number;
    controller?: ETH_ADDRESS;
}


export const formatSplitRecipients = (recipients: SplitRecipient[]): { accounts: ETH_ADDRESS[], percentAllocations: number[] } => {
    //Has to be sorted when passed
    recipients.sort((a, b) =>
        a.account.localeCompare(b.account),
    );
    const accounts = recipients.map(
        (item) => item.account,
    );
    const percentAllocations = recipients.map((recipient) => {
        const splitTostring = (recipient.percentAllocation * 1e4).toFixed(0);
        return parseInt(splitTostring);
    });
    return { accounts, percentAllocations }
}


export const predictSplitterAddress = async ({ signer, accounts, percentAllocations, chainId }: { signer: Signer, accounts: ETH_ADDRESS[], percentAllocations: number[], chainId: number }): Promise<ETH_ADDRESS> => {

    const splitMainContractInstance = new Contract(
        CHAIN_CONFIGURATION[chainId].SPLITMAIN_ADDRESS,
        splitMainEthereumAbi,
        signer,
    );

    const predictedSplitAddress =
        await splitMainContractInstance.predictImmutableSplitAddress(
            accounts,
            percentAllocations,
            DISTRIBUTOR_FEE,
        );

    return predictedSplitAddress
}


export const handleDeployRewardsSplitter = async ({ signer, isSplitterDeployed, predictedSplitterAddress, accounts, percentAllocations, validatorsSize, principalRecipient, chainId }: { signer: Signer, isSplitterDeployed: boolean, predictedSplitterAddress: ETH_ADDRESS, accounts: ETH_ADDRESS[], percentAllocations: number[], validatorsSize: number, principalRecipient: ETH_ADDRESS, chainId: number }): Promise<ClusterValidator> => {

    try {
        if (isSplitterDeployed) {
            const owrAddress = await createOWRContract({
                principalRecipient,
                splitterAddress: predictedSplitterAddress,
                amountOfPrincipalStake: validatorsSize * 32,
                signer,
                chainId
            });
            return { withdrawal_address: owrAddress, fee_recipient_address: predictedSplitterAddress }

        } else {

            const { owrAddress, splitterAddress } = await deployImmutableSplitterAndOWRContracts({
                owrArgs: {
                    principalRecipient,
                    amountOfPrincipalStake: validatorsSize * 32,
                    predictedSplitterAddress
                },
                splitterArgs: {
                    accounts: accounts,
                    percentAllocations: percentAllocations,
                },
                signer,
                chainId
            }
            );


            return { withdrawal_address: owrAddress, fee_recipient_address: splitterAddress }

        }



    } catch (e: any) {
        throw new Error(e)
    }
};

//Not needed now cause we use MultiCall Contract

const createOWRContract = async ({
    principalRecipient,
    splitterAddress,
    amountOfPrincipalStake,
    signer,
    chainId
}: {
    principalRecipient: ETH_ADDRESS,
    splitterAddress: ETH_ADDRESS,
    amountOfPrincipalStake: number,
    signer: Signer,
    chainId: number
}): Promise<ETH_ADDRESS> => {
    try {
        const OWRFactoryInstance = new Contract(
            CHAIN_CONFIGURATION[chainId].OWR_FACTORY_ADDRESS,
            OWRFactoryContract.abi,
            signer,
        );

        //check we need staticCall or staticCallResult
        const OWRContractAddress = await OWRFactoryInstance.createOWRecipient.staticCall(
            RECOVERY_ADDRESS,
            principalRecipient,
            splitterAddress,
            parseEther(amountOfPrincipalStake.toString()),
        );

        const tx = await OWRFactoryInstance.createOWRecipient(
            RECOVERY_ADDRESS,
            principalRecipient,
            splitterAddress,
            parseEther(amountOfPrincipalStake.toString()),
        );

        await tx.wait();

        return OWRContractAddress;
    } catch (e: any) {
        throw new Error(e);
    }
}

export const deployImmutableSplitterAndOWRContracts = async ({
    owrArgs,
    splitterArgs,
    signer,
    chainId
}: {
    owrArgs: OWRArgs,
    splitterArgs: SplitArgs,
    signer: Signer,
    chainId: number
}): Promise<{ owrAddress: ETH_ADDRESS; splitterAddress: ETH_ADDRESS }> => {
    const executeCalls: Call[] = [];
    splitterArgs.distributorFee = DISTRIBUTOR_FEE;
    splitterArgs.controller = controller;

    owrArgs.recoveryAddress = RECOVERY_ADDRESS;
    try {
        const splitTxData = encodeCreateSplitTxData(
            splitterArgs.accounts,
            splitterArgs.percentAllocations,
            splitterArgs.distributorFee,
            splitterArgs.controller,
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
        const multicallAddess = CHAIN_CONFIGURATION[chainId].MULTICALL_ADDRESS

        const executeMultiCalls = await multicall(executeCalls, signer, multicallAddess);

        const splitAddressData = executeMultiCalls?.logs[0]?.topics[1];

        const sliceSplitAddress = "0x" + splitAddressData?.slice(26, 66);

        const owrAddress = executeMultiCalls?.logs[1]?.topics[1];

        const sliceOwrAddress = "0x" + owrAddress?.slice(26, 66);

        return {
            owrAddress: sliceOwrAddress,
            splitterAddress: sliceSplitAddress,
        };
    } catch (e: any) {
        throw new Error(e);
    }
}

export const multicall = async (
    calls: Call[],
    signer: Signer,
    multicallAddress: string
): Promise<any> => {
    const multiCallContractInstance = new Contract(
        multicallAddress,
        MultiCallContract.abi,
        signer,
    );
    const tx = await multiCallContractInstance.aggregate(calls);
    const receipt = await tx.wait();
    return receipt;
}

const encodeCreateSplitTxData = (
    accounts: ETH_ADDRESS[],
    percentAllocations: number[],
    distributorFee: number,
    controller: ETH_ADDRESS,
): ETH_ADDRESS => {

    return splitMainContractInterface.encodeFunctionData("createSplit", [
        accounts,
        percentAllocations,
        distributorFee,
        controller,
    ]);
}

const encodeCreateOWRecipientTxData = (
    recoveryAddress: ETH_ADDRESS,
    principalRecipient: ETH_ADDRESS,
    rewardRecipient: ETH_ADDRESS,
    amountOfPrincipalStake: number,
): ETH_ADDRESS => {
    return owrFactoryContractInterface.encodeFunctionData("createOWRecipient", [
        recoveryAddress,
        principalRecipient,
        rewardRecipient,
        parseEther(amountOfPrincipalStake.toString()),
    ]);
}

















