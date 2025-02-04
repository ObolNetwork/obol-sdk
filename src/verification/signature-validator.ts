import { ethers } from 'ethers';
import {
  SignTypedDataVersion,
  TypedDataUtils,
  TypedMessage,
} from '@metamask/eth-sig-util';
import Safe from '@safe-global/protocol-kit';
import { PROVIDER_MAP } from '../constants';
import { hashTypedData } from '@safe-global/protocol-kit/dist/src/utils';
import { EIP712TypedData } from '@safe-global/safe-core-sdk-types';
import { isContractAvailable, getProvider } from '../utils';

export const validateAddressSignature = async ({
  address,
  token,
  data,
  chainId,
}: {
  address: string;
  token: string;
  data: TypedMessage<any>;
  chainId: number;
}): Promise<boolean> => {
  try {
    const provider = getProvider(chainId);
    if (provider) {
      const contractAddress = await isContractAvailable(address, provider);
      if (contractAddress) {
        return await validateSmartContractSignature({
          token,
          data: data as unknown as EIP712TypedData,
          address,
          chainId,
        });
      }
    }
    return validateEOASignature({ token, data, address });
  } catch (error) {
    return validateEOASignature({ token, data, address });
  }
};

export const validateEOASignature = ({
  token,
  data,
  address,
}: {
  token: string;
  data: TypedMessage<any>;
  address: string;
}): boolean => {
  try {
    const sig = ethers.Signature.from(token);
    const digest = TypedDataUtils.eip712Hash(data, SignTypedDataVersion.V4);

    return (
      ethers.recoverAddress(digest, sig).toLowerCase() ===
      address.toLocaleLowerCase()
    );
  } catch (err) {
    console.error(`validate EOA Signature error: ${err}`);
    throw err;
  }
};

export const validateSmartContractSignature = async ({
  token,
  data,
  address,
  chainId,
}: {
  token: string;
  data: EIP712TypedData;
  address: string;
  chainId: number;
}): Promise<boolean> => {
  try {
    const provider = PROVIDER_MAP[chainId];
    const protocolKit = await Safe.init({
      provider,
      safeAddress: address,
    });
    const messageHash = hashTypedData(data);
    const isValidSignature = await protocolKit.isValidSignature(
      messageHash,
      token,
    );

    return isValidSignature;
  } catch (err: any) {
    throw new Error(
      `Error validating smart contract signature: ${err.message}`,
    );
  }
};
