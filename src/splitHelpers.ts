import { ClusterValidator, ETH_ADDRESS, SplitRecipient } from "./types";
import { Contract, Interface, parseEther, Signer } from "ethers";
import { OWRFactoryContract } from "./abi/OWR";
import { splitMainEthereumAbi } from "./abi/SplitMain";
import { MultiCallContract } from "./abi/Multicall"

const splitMainContractInterface = new Interface(splitMainEthereumAbi);
const owrFactoryContractInterface = new Interface(OWRFactoryContract.abi);



//Define them in constants and map them to each chainId
export const SPLITMAIN_ADDRESS = "0xfC8a305728051367797DADE6Aa0344E0987f5286";
export const MULTICALL_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
export const OWR_FACTORY_ADDRESS = "0xc0961353fcc43a99e3041db07ac646720e116256"
export const RETROACTIVE_FUNDING_ADDRESS = "0x43F641fA70e09f0326ac66b4Ef0C416EaEcBC6f5"

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


export const predictSplitterAddress = async ({ signer, accounts, percentAllocations }: { signer: Signer, accounts: ETH_ADDRESS[], percentAllocations: number[] }): Promise<ETH_ADDRESS> => {

    const splitMainContractInstance = new Contract(
        SPLITMAIN_ADDRESS,
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


export const handleDeployRewardsSplitter = async ({ signer, isSplitterDeployed, predictedSplitterAddress, accounts, percentAllocations, validatorsSize, principalRecipient }: { signer: Signer, isSplitterDeployed: boolean, predictedSplitterAddress: ETH_ADDRESS, accounts: ETH_ADDRESS[], percentAllocations: number[], validatorsSize: number, principalRecipient: ETH_ADDRESS }): Promise<ClusterValidator> => {

    try {
        if (isSplitterDeployed) {
            const owrAddress = await createOWRContract({
                principalRecipient,
                splitterAddress: predictedSplitterAddress,
                amountOfPrincipalStake: validatorsSize * 32,
                signer
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
                signer
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
}: {
    principalRecipient: ETH_ADDRESS,
    splitterAddress: ETH_ADDRESS,
    amountOfPrincipalStake: number,
    signer: Signer,
}): Promise<ETH_ADDRESS> => {
    try {
        const OWRFactoryInstance = new Contract(
            OWR_FACTORY_ADDRESS,
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
}: {
    owrArgs: OWRArgs,
    splitterArgs: SplitArgs,
    signer: Signer,
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
                target: SPLITMAIN_ADDRESS,
                callData: splitTxData,
            },
            {
                target: OWR_FACTORY_ADDRESS,
                callData: owrTxData,
            },
        );

        const executeMultiCalls = await multicall(executeCalls, signer);

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
): Promise<any> => {
    const multiCallContractInstance = new Contract(
        MULTICALL_ADDRESS,
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

















