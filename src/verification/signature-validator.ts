/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { ethers } from 'ethers';
import {
  SignTypedDataVersion,
  TypedDataUtils,
  type TypedMessage,
} from '@metamask/eth-sig-util';
import Safe from '@safe-global/protocol-kit';
import { PROVIDER_MAP } from '../constants';
import { hashTypedData } from '@safe-global/protocol-kit/dist/src/utils';
import { type EIP712TypedData } from '@safe-global/safe-core-sdk-types';
import { isContractAvailable, getProvider } from '../utils';
import { type SafeRpcUrl } from '../types';

export const validateAddressSignature = async ({
  address,
  token,
  data,
  chainId,
  safeRpcUrl,
}: {
  address: string;
  token: string;
  data: TypedMessage<any>;
  chainId: number;
  safeRpcUrl?: SafeRpcUrl;
}): Promise<boolean> => {
  try {
    const provider = getProvider(chainId, safeRpcUrl);
    if (provider) {
      const contractAddress = await isContractAvailable(address, provider);
      if (contractAddress) {
        return await validateSmartContractSignature({
          token,
          data: data as unknown as EIP712TypedData,
          address,
          chainId,
          safeRpcUrl,
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
  safeRpcUrl,
}: {
  token: string;
  data: EIP712TypedData;
  address: string;
  chainId: number;
  safeRpcUrl?: SafeRpcUrl;
}): Promise<boolean> => {
  try {
    const safeProvider = safeRpcUrl ?? PROVIDER_MAP[chainId];
    console.log("ll"+safeProvider+"safeProviderrrrrrr")
    console.log("ll"+address+"address")

    const protocolKit = await Safe.init({
      provider: safeProvider,
      safeAddress: address,
    });
    const messageHash = hashTypedData(data);
    const isValidSignature = await protocolKit.isValidSignature(
      messageHash,
      token,
    );

    return isValidSignature;
  } catch (err: any) {
    console.log(err, "whyyyyyyyy")

    throw new Error(
      `Error validating smart contract signature: ${err.message}`,
    );
  }
};
