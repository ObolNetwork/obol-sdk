import {
  type OWRTranches,
  type ClusterValidator,
  type ETH_ADDRESS,
  type SplitRecipient,
  type SignerType,
  type SplitV2Recipient,
  type OVMArgs,
  type ChainConfig,
} from '../types.js';
import {
  Contract,
  dataSlice,
  type EventLog,
  id,
  Interface,
  parseEther,
  ZeroAddress,
  getAddress as toChecksumAddress,
  type JsonRpcSigner,
  type TransactionReceipt,
} from 'ethers';
import { OWRContract, OWRFactoryContract } from '../abi/OWR.js';
import { OVMFactoryContract, OVMContract } from '../abi/OVM.js';
import { splitMainEthereumAbi } from '../abi/SplitMain.js';
import { CHAIN_CONFIGURATION, ETHER_TO_GWEI } from '../constants.js';
import { splitV2FactoryAbi } from '../abi/splitV2FactoryAbi.js';
import { MultiCall3Contract } from '../abi/Multicall3.js';
import { isContractAvailable } from '../utils.js';

const splitMainContractInterface = new Interface(splitMainEthereumAbi);
const owrFactoryContractInterface = new Interface(OWRFactoryContract.abi);
const ovmFactoryContractInterface = new Interface(OVMFactoryContract.abi);
const splitV2FactoryInterface = new Interface(splitV2FactoryAbi);
const multicall3ContractInterface = new Interface(MultiCall3Contract.abi);

// Safe multisig execution needs co-signers, so allow a long collection window.
const SAFE_EXECUTION_TIMEOUT_MS = 30 * 60_000;

// Finds the OVM factory's CreateObolValidatorManager event in a receipt by
// event signature. Position-based log indexing breaks when extra events are
// interleaved, so match by topic instead.
export const extractOvmAddressFromReceipt = (
  receipt: TransactionReceipt,
): string => {
  for (const log of receipt?.logs ?? []) {
    try {
      const parsed = ovmFactoryContractInterface.parseLog({
        topics: [...log.topics],
        data: log.data,
      });
      if (parsed?.name === 'CreateObolValidatorManager') {
        return toChecksumAddress(parsed.args.ovm as string);
      }
    } catch {
      // Not an OVM factory event; keep scanning.
    }
  }
  throw new Error(
    'CreateObolValidatorManager event not found in transaction logs',
  );
};

// True when the signer is a smart-contract wallet (e.g. a Safe) going through
// a JSON-RPC connection. Local Wallet signers are always EOAs.
export const isContractWalletSigner = async (
  signer: SignerType,
): Promise<boolean> => {
  if (!signer.provider || !('sendUncheckedTransaction' in signer)) {
    return false;
  }
  return await isContractAvailable(await signer.getAddress(), signer.provider);
};

const SAFE_EXECUTION_SUCCESS_TOPIC = id('ExecutionSuccess(bytes32,uint256)');

// True when the receipt contains the Safe's ExecutionSuccess log for the
// safeTxHash the wallet returned at submission — the txHash is indexed on
// Safe v1.4.1+ and the leading data word on v1.3.0. This binds an on-chain
// transaction to OUR submission, so a concurrent OVM creation for the same
// owner (even by a third party, since the factory is permissionless) can
// never be mistaken for ours.
export const receiptMatchesSafeTx = (
  receipt: TransactionReceipt | null,
  safeAddress: string,
  safeTxHash: string,
): boolean =>
  receipt?.logs?.some(log => {
    if (
      log.address?.toLowerCase() !== safeAddress.toLowerCase() ||
      log.topics[0] !== SAFE_EXECUTION_SUCCESS_TOPIC
    ) {
      return false;
    }
    const loggedHash =
      log.topics.length > 1 ? log.topics[1] : dataSlice(log.data, 0, 32);
    return loggedHash?.toLowerCase() === safeTxHash.toLowerCase();
  }) ?? false;

// Submits a deployment from a contract wallet (e.g. a Safe) and resolves the
// created OVM address. Safe wallets return an internal safeTxHash that never
// appears on-chain, so tx.wait() would hang forever; instead ethers watches
// the factory's CreateObolValidatorManager events for `owner`, and each
// candidate is accepted only when its transaction is provably ours: either
// its hash equals the wallet-returned hash, or its receipt carries our
// Safe's ExecutionSuccess(safeTxHash).
const submitViaContractWalletAndResolveOvm = async ({
  signer,
  to,
  data,
  factoryAddress,
  owner,
  timeoutMs = SAFE_EXECUTION_TIMEOUT_MS,
}: {
  signer: JsonRpcSigner;
  to: string;
  data: string;
  factoryAddress: string;
  owner: string;
  timeoutMs?: number;
}): Promise<string> => {
  const provider = signer.provider;
  const safeAddress = await signer.getAddress();
  const factory = new Contract(
    factoryAddress,
    OVMFactoryContract.abi,
    provider,
  );
  const filter = factory.filters.CreateObolValidatorManager(null, owner);
  // Captured before submission so the backfill below cannot miss an
  // execution mined before the wallet call returned (e.g. a 1-of-1 Safe).
  const startBlock = await provider.getBlockNumber();

  const isOurs = async (
    candidateTxHash: string,
    submittedHash: string,
  ): Promise<boolean> => {
    if (candidateTxHash.toLowerCase() === submittedHash.toLowerCase()) {
      return true; // the wallet returned a real transaction hash
    }
    const receipt = await provider
      .getTransactionReceipt(candidateTxHash)
      .catch(() => null);
    return receiptMatchesSafeTx(receipt, safeAddress, submittedHash);
  };

  return await new Promise<string>((resolve, reject) => {
    let submittedHash: string | null = null;
    let settled = false;

    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void factory.off(filter, listener);
      finish();
    };

    const consider = (ovm: string, candidateTxHash: string): void => {
      // Before submission returns we cannot match; the backfill re-checks.
      if (!submittedHash || settled) return;
      void isOurs(candidateTxHash, submittedHash).then(ours => {
        if (ours) {
          settle(() => {
            resolve(toChecksumAddress(ovm));
          });
        }
        // Not ours (someone else's OVM for this owner): keep listening.
      });
    };

    const listener = (...args: unknown[]): void => {
      const payload = args[args.length - 1] as
        | { log?: { transactionHash?: string } }
        | undefined;
      const txHash = payload?.log?.transactionHash;
      if (txHash) consider(String(args[0]), txHash);
    };

    const timer = setTimeout(() => {
      settle(() => {
        reject(
          new Error(
            'Timed out waiting for the Safe transaction to be executed. Once all owners have signed and it executes, retry to continue.',
          ),
        );
      });
    }, timeoutMs);

    void factory.on(filter, listener);
    signer
      .sendUncheckedTransaction({ to, data })
      .then(async hash => {
        submittedHash = hash;
        // Backfill events mined between startBlock and now.
        const past = await factory.queryFilter(filter, startBlock);
        for (const ev of past) {
          const ovm = (ev as EventLog).args?.[0] as string | undefined;
          if (ovm) consider(ovm, ev.transactionHash);
        }
      })
      .catch((err: Error) => {
        settle(() => {
          reject(err);
        });
      });
  });
};

/**
 * Submits an arbitrary transaction from a contract wallet (e.g. a Safe) and
 * resolves the EXECUTED on-chain transaction hash. Safe wallets return an
 * internal safeTxHash that never appears on-chain, so tx.wait() would hang
 * forever; instead ethers watches the Safe's own ExecutionSuccess logs and
 * resolves when one carries the wallet-returned hash (or when the wallet
 * returned a real transaction hash, e.g. a 1-of-1 Safe).
 *
 * Used by flows that need no data out of the receipt (EOA withdrawal
 * requests, batch deposits) — unlike OVM deployment, which additionally
 * resolves the created contract address.
 */
export const submitViaContractWalletAndWait = async ({
  signer,
  to,
  data,
  value,
  timeoutMs = SAFE_EXECUTION_TIMEOUT_MS,
}: {
  signer: JsonRpcSigner;
  to: string;
  data: string;
  value?: bigint;
  timeoutMs?: number;
}): Promise<string> => {
  const provider = signer.provider;
  const safeAddress = await signer.getAddress();
  const filter = {
    address: safeAddress,
    topics: [SAFE_EXECUTION_SUCCESS_TOPIC],
  };
  // Captured before submission so the backfill below cannot miss an
  // execution mined before the wallet call returned (e.g. a 1-of-1 Safe).
  const startBlock = await provider.getBlockNumber();

  const matchesSubmission = (
    log: { transactionHash?: string; topics: readonly string[]; data: string },
    submittedHash: string,
  ): boolean => {
    if (log.transactionHash?.toLowerCase() === submittedHash.toLowerCase()) {
      return true; // the wallet returned a real transaction hash
    }
    const loggedHash =
      log.topics.length > 1 ? log.topics[1] : dataSlice(log.data, 0, 32);
    return loggedHash?.toLowerCase() === submittedHash.toLowerCase();
  };

  return await new Promise<string>((resolve, reject) => {
    let submittedHash: string | null = null;
    let settled = false;

    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void provider.off(filter, listener);
      finish();
    };

    const consider = (log: {
      transactionHash?: string;
      topics: readonly string[];
      data: string;
    }): void => {
      // Before submission returns we cannot match; the backfill re-checks.
      if (!submittedHash || settled) return;
      if (matchesSubmission(log, submittedHash) && log.transactionHash) {
        const executedHash = log.transactionHash;
        settle(() => {
          resolve(executedHash);
        });
      }
    };

    const listener = (log: {
      transactionHash?: string;
      topics: readonly string[];
      data: string;
    }): void => {
      consider(log);
    };

    const timer = setTimeout(() => {
      settle(() => {
        reject(
          new Error(
            'Timed out waiting for the Safe transaction to be executed. Once all owners have signed and it executes, retry to continue.',
          ),
        );
      });
    }, timeoutMs);

    void provider.on(filter, listener);
    signer
      .sendUncheckedTransaction({ to, data, ...(value ? { value } : {}) })
      .then(async hash => {
        submittedHash = hash;
        // Backfill logs mined between startBlock and now.
        const past = await provider.getLogs({
          ...filter,
          fromBlock: startBlock,
        });
        for (const log of past) {
          consider(log);
        }
      })
      .catch((err: Error) => {
        settle(() => {
          reject(err);
        });
      });
  });
};

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
          `Failed to deploy both splitter and OWR contracts: ${error.message ?? 'Multicall3 contract deployment failed'}`,
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

  const executeMultiCalls = await multicall3(executeCalls, signer, chainId);

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

export const multicall3 = async (
  calls: Call[],
  signer: SignerType,
  chainId: number,
): Promise<any> => {
  try {
    const chainConfig = getChainConfig(chainId);
    const multicall3Address = chainConfig.MULTICALL3_CONTRACT.address;
    const multiCall3ContractInstance = new Contract(
      multicall3Address,
      MultiCall3Contract.abi,
      signer,
    );

    let tx;
    try {
      tx = await multiCall3ContractInstance.aggregate(calls);
    } catch (error: any) {
      throw new Error(
        `Failed to submit multicall3 transaction: ${error.message ?? 'Transaction submission failed'}`,
      );
    }

    let receipt;
    try {
      receipt = await tx.wait();
    } catch (error: any) {
      throw new Error(
        `Multicall3 transaction failed or was reverted: ${error.message ?? 'Transaction execution failed'}`,
      );
    }

    if (!receipt) {
      throw new Error(
        'Multicall3 transaction succeeded but no receipt was returned',
      );
    }

    return receipt;
  } catch (error: any) {
    // Re-throw if it's already our custom error
    if (
      error.message.includes('Failed to') ||
      error.message.includes('Multicall3 transaction')
    ) {
      throw error;
    }
    // Handle unexpected errors
    throw new Error(
      `Unexpected error in multicall3: ${error.message ?? 'Unknown error during multicall3 execution'}`,
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

    const createArgs = [
      OVMOwnerAddress,
      principalRecipient,
      rewardRecipient,
      principalThreshold * ETHER_TO_GWEI,
    ];

    if (
      'sendUncheckedTransaction' in signer &&
      (await isContractWalletSigner(signer))
    ) {
      return await submitViaContractWalletAndResolveOvm({
        signer,
        to: chainConfig.OVM_FACTORY_CONTRACT.address,
        data: ovmFactoryContractInterface.encodeFunctionData(
          'createObolValidatorManager',
          createArgs,
        ),
        factoryAddress: chainConfig.OVM_FACTORY_CONTRACT.address,
        owner: OVMOwnerAddress,
      });
    }

    const tx = await ovmFactoryContract.createObolValidatorManager(
      ...createArgs,
    );
    const receipt = (await tx.wait()) as TransactionReceipt;
    return extractOvmAddressFromReceipt(receipt);
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
      ovmArgs.principalThreshold * ETHER_TO_GWEI,
    );

    executeCalls.push({
      target: chainConfig.OVM_FACTORY_CONTRACT.address,
      callData: ovmTxData,
    });

    if (
      'sendUncheckedTransaction' in signer &&
      (await isContractWalletSigner(signer))
    ) {
      return await submitViaContractWalletAndResolveOvm({
        signer,
        to: chainConfig.MULTICALL3_CONTRACT.address,
        data: multicall3ContractInterface.encodeFunctionData('aggregate', [
          executeCalls,
        ]),
        factoryAddress: chainConfig.OVM_FACTORY_CONTRACT.address,
        owner: ovmArgs.OVMOwnerAddress,
      });
    }

    // Execute multicall3
    const executeMultiCalls = (await multicall3(
      executeCalls,
      signer,
      chainId,
    )) as TransactionReceipt;

    // Extract the OVM address from the factory event by signature, robust to
    // interleaved events.
    return extractOvmAddressFromReceipt(executeMultiCalls);
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
 * @param withdrawalFees - Total withdrawal fees in wei
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
    if (pubKeys.length === 0) {
      throw new Error('pubKeys array cannot be empty');
    }
    // Convert string amounts to bigint
    const bigintAmounts = amounts.map(amount => BigInt(amount));

    // Calculate maxFeePerWithdrawal as withdrawalFees / pubKeys.length
    const maxFeePerWithdrawal = BigInt(withdrawalFees) / BigInt(pubKeys.length);

    // Use ovmAddress as excessFeeRecipient
    const excessFeeRecipient = ovmAddress;

    const ovmContract = new Contract(ovmAddress, OVMContract.abi, signer);

    const tx = await ovmContract.withdraw(
      pubKeys,
      bigintAmounts,
      maxFeePerWithdrawal,
      excessFeeRecipient,
      {
        value: BigInt(withdrawalFees),
      },
    );
    const receipt = await tx.wait();

    return { txHash: receipt.hash };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : 'Request withdrawal failed';
    throw new Error(`Failed to request withdrawal from OVM: ${errorMessage}`);
  }
};

/**
 * Deposits to OVM contract by sending individual transactions for each deposit.
 * @param ovmAddress - The address of the OVM contract
 * @param deposits - Array of deposit objects with all required parameters
 * @param signer - The signer to use for the transaction
 * @returns Promise that resolves to an array of transaction hashes
 */
export const depositOVM = async ({
  ovmAddress,
  deposits,
  signer,
}: {
  ovmAddress: string;
  deposits: Array<{
    pubkey: string;
    withdrawal_credentials: string;
    signature: string;
    deposit_data_root: string;
    amount: string;
  }>;
  signer: SignerType;
}): Promise<{ txHashes: string[] }> => {
  try {
    const ovmContract = new Contract(ovmAddress, OVMContract.abi, signer);
    const txHashes: string[] = [];

    // Process each deposit as a separate transaction
    // Multicall3 cannot be used because it doesn't have the DEPOSIT_ROLE
    for (const deposit of deposits) {
      const tx = await ovmContract.deposit(
        deposit.pubkey,
        deposit.withdrawal_credentials,
        deposit.signature,
        deposit.deposit_data_root,
        {
          value: BigInt(deposit.amount),
        },
      );

      const receipt = await tx.wait();
      if (receipt?.hash) {
        txHashes.push(receipt.hash as string);
      }
    }

    return { txHashes };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : 'Deposit failed';
    throw new Error(`Failed to deposit to OVM: ${errorMessage}`);
  }
};
