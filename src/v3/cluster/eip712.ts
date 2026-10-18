/**
 * EIP-712 messages of cluster definitions (distributed-validator-specs
 * "EIP-712 Signature Computation"): signing with a viem WalletClient, and
 * checking a signature for an EOA (recovery) or a contract wallet (EIP-1271).
 */
import {
  hashTypedData,
  isHex,
  parseAbi,
  recoverTypedDataAddress,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type TypedDataDefinition,
  type WalletClient,
} from 'viem';
import { getCodeKind } from '../chainUtils.js';
import { sameAddress } from '../schema.js';

export const EIP712_DOMAIN_NAME = 'Obol';
export const EIP712_DOMAIN_VERSION = '1';

export type ClusterTypedData = TypedDataDefinition<
  Record<string, Array<{ name: string; type: string }>>,
  string
>;

const typedData = (
  chainId: number,
  primaryType: string,
  field: string,
  value: string,
): ClusterTypedData => ({
  domain: {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId,
  },
  types: { [primaryType]: [{ name: field, type: 'string' }] },
  primaryType,
  message: { [field]: value },
});

/** `CreatorConfigHash { creator_config_hash }`, signed by the creator. */
export const creatorConfigHashTypedData = (
  configHash: string,
  chainId: number,
): ClusterTypedData =>
  typedData(chainId, 'CreatorConfigHash', 'creator_config_hash', configHash);

/** `OperatorConfigHash { operator_config_hash }`, signed by each operator. */
export const operatorConfigHashTypedData = (
  configHash: string,
  chainId: number,
): ClusterTypedData =>
  typedData(chainId, 'OperatorConfigHash', 'operator_config_hash', configHash);

/** `ENR { enr }`, signed by each operator. */
export const enrTypedData = (enr: string, chainId: number): ClusterTypedData =>
  typedData(chainId, 'ENR', 'enr', enr);

export const signTypedData = async (
  walletClient: WalletClient,
  account: Account | Address,
  data: ClusterTypedData,
): Promise<Hex> => {
  const args = { account, ...data };
  return await walletClient.signTypedData(
    args as Parameters<WalletClient['signTypedData']>[0],
  );
};

const erc1271Abi = parseAbi([
  'function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)',
]);
const ERC1271_MAGIC = '0x1626ba7e';

/**
 * Whether `signature` signs `data` for `address`: by ECDSA recovery, or, when
 * that fails and a `publicClient` on `chainId` is given and `address` has
 * contract code, by the contract's EIP-1271 `isValidSignature` (Safe
 * wallets). Never throws; a failed check is `false`.
 */
export const isValidTypedDataSignature = async ({
  address,
  signature,
  data,
  publicClient,
}: {
  address: string;
  signature: string | undefined;
  data: ClusterTypedData;
  publicClient?: PublicClient;
}): Promise<boolean> => {
  if (typeof signature !== 'string' || !isHex(signature)) return false;
  if (signature.length === 132) {
    try {
      const recovered = await recoverTypedDataAddress({ ...data, signature });
      if (sameAddress(recovered, address)) return true;
    } catch {
      // Not a recoverable signature; may still be a contract wallet's.
    }
  }
  const domainChainId = Number(data.domain?.chainId);
  if (
    publicClient === undefined ||
    publicClient.chain?.id !== domainChainId ||
    !/^0x[0-9a-fA-F]{40}$/.test(address)
  ) {
    return false;
  }
  try {
    const target = address as Address;
    if ((await getCodeKind(publicClient, target)) !== 'contract') return false;
    const result = await publicClient.readContract({
      address: target,
      abi: erc1271Abi,
      functionName: 'isValidSignature',
      args: [hashTypedData(data), signature],
    });
    return result.toLowerCase() === ERC1271_MAGIC;
  } catch {
    return false;
  }
};
