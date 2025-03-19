import { ethers } from 'ethers';
import { DefinitionFlow, PROVIDER_MAP } from './constants';
import { FORK_NAMES, type ProviderType, type ClusterDefinition } from './types';

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
  return !!code && code !== '0x' && code !== '0x0';
};

export const getProvider = (chainId: number): ethers.JsonRpcProvider => {
  const rpcUrl = PROVIDER_MAP[chainId];
  if (!rpcUrl || rpcUrl === 'undefined') {
    throw new Error(`No provider configured for ${FORK_NAMES[chainId]}`);
  }
  return new ethers.JsonRpcProvider(rpcUrl);
};
