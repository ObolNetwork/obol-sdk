import { ethers } from 'ethers';
import { DefinitionFlow, PROVIDER_MAP } from './constants.js';
import { ChainMismatchError } from './errors.js';
import {
  FORK_NAMES,
  type ProviderType,
  type ClusterDefinition,
  type SignerType,
} from './types.js';

export const hexWithout0x = (hex: string): string => {
  return hex.slice(2, hex.length);
};

export const strToUint8Array = (str: string): Uint8Array => {
  return new TextEncoder().encode(str);
};

export const definitionFlow = (
  clusterDefinition: ClusterDefinition,
): DefinitionFlow | null => {
  if (
    clusterDefinition.creator.address &&
    clusterDefinition.creator.config_signature &&
    clusterDefinition.operators.every(operator => {
      return (
        operator.address &&
        operator.config_signature &&
        operator.enr &&
        operator.enr_signature
      );
    })
  ) {
    return DefinitionFlow.Group;
  } else if (
    clusterDefinition.creator.address &&
    clusterDefinition.creator.config_signature &&
    clusterDefinition.operators.every(operator => {
      return (
        !operator.address &&
        !operator.config_signature &&
        operator.enr &&
        !operator.enr_signature
      );
    })
  ) {
    return DefinitionFlow.Solo;
  } else if (
    !clusterDefinition.creator.address &&
    !clusterDefinition.creator.config_signature &&
    clusterDefinition.operators.every(operator => {
      return (
        !operator.address &&
        !operator.config_signature &&
        operator.enr &&
        !operator.enr_signature
      );
    })
  ) {
    return DefinitionFlow.Charon;
  }
  return null;
};

export const findDeployedBytecode = async (
  contractAddress: string,
  provider: ProviderType,
): Promise<string> => {
  return await provider?.getCode(contractAddress);
};

export const isContractAvailable = async (
  contractAddress: string,
  provider: ProviderType,
  bytecode?: string,
): Promise<boolean> => {
  const code = await findDeployedBytecode(contractAddress, provider);

  if (bytecode) {
    return !!code && code === bytecode;
  }
  return (
    !!code && code !== '0x' && code !== '0x0' && !code.startsWith('0xef0100')
  ); // for delegated address;
};

export const getProvider = (
  chainId: number,
  rpcUrl?: string,
): ethers.JsonRpcProvider => {
  const resolvedRpcUrl = rpcUrl ?? PROVIDER_MAP[chainId];
  if (chainId && (!resolvedRpcUrl || resolvedRpcUrl === 'undefined')) {
    throw new Error(`No provider configured for ${FORK_NAMES[chainId]}`);
  }
  return new ethers.JsonRpcProvider(resolvedRpcUrl);
};

/**
 * Asserts that the signer's provider is on `chainId` before a transaction is
 * sent or chain-bound typed data is signed. Signers without a provider (e.g.
 * an offline `Wallet`) are not checked.
 *
 * @throws {ChainMismatchError} If the signer's provider reports another chain.
 */
export const assertSignerChain = async (
  signer: SignerType,
  chainId: number,
  method: string,
): Promise<void> => {
  const provider = signer.provider as
    | { getNetwork?: () => Promise<{ chainId: bigint | number }> }
    | null
    | undefined;
  if (typeof provider?.getNetwork !== 'function') {
    return;
  }
  const network = await provider.getNetwork();
  if (BigInt(network.chainId) !== BigInt(chainId)) {
    throw new ChainMismatchError(chainId, Number(network.chainId), method);
  }
};
