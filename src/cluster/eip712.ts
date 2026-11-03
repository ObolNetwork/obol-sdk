/**
 * EIP-712 messages of cluster definitions (distributed-validator-specs
 * "EIP-712 Signature Computation"): signing with a viem WalletClient, and
 * checking a signature for an EOA (recovery) or a contract wallet (EIP-1271).
 * EIP-1271 needs a public client on the signer's chain: the caller passes it
 * (`publicClient`, or `publicClients` by chain id); the SDK has no RPCs.
 */
import {
  bytesToHex,
  hashTypedData,
  isAddress,
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
import { invalid, sameAddress } from '../schema.js';

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
 * The pre-final EIP-1271 interface that Safes before 1.3.0 implement
 * (`ISignatureValidator`, Safe 1.1.1 / 1.2.0): `_data` is the signed data,
 * which for a hash is the 32-byte hash as bytes, as Safe 1.3.0's
 * CompatibilityFallbackHandler forwards `isValidSignature(bytes32, bytes)`
 * (`abi.encode(_dataHash)`) and Safe protocol-kit (2.x) called it.
 */
const legacyErc1271Abi = parseAbi([
  'function isValidSignature(bytes data, bytes signature) view returns (bytes4)',
]);
const LEGACY_ERC1271_MAGIC = '0x20c13b0b';

/**
 * EIP-1271 on a contract: `isValidSignature(bytes32, bytes)` returning
 * `0x1626ba7e`, else the legacy `isValidSignature(bytes, bytes)` returning
 * `0x20c13b0b`. A revert or any other answer is a refusal.
 */
const contractAccepts = async (
  publicClient: PublicClient,
  address: Address,
  hash: Hex,
  signature: Hex,
): Promise<boolean> => {
  try {
    const result = await publicClient.readContract({
      address,
      abi: erc1271Abi,
      functionName: 'isValidSignature',
      args: [hash, signature],
    });
    if (result.toLowerCase() === ERC1271_MAGIC) return true;
  } catch {
    // Reverted (a refusal, or no such function): try the legacy interface.
  }
  try {
    const result = await publicClient.readContract({
      address,
      abi: legacyErc1271Abi,
      functionName: 'isValidSignature',
      args: [hash, signature],
    });
    return result.toLowerCase() === LEGACY_ERC1271_MAGIC;
  } catch {
    return false;
  }
};

/**
 * Public clients for contract-wallet (EIP-1271) signature checks: one per
 * chain id, or a function that returns the client for a chain id (or
 * undefined). Each client must be on the chain it is given for; one on
 * another chain is ignored.
 */
export type PublicClients =
  | Record<number, PublicClient>
  | ((chainId: number) => PublicClient | undefined);

/** The clients a contract-wallet signature check may use. */
export interface SignatureClients {
  /** A client for one chain: used for signatures on its own chain only. */
  publicClient?: PublicClient;
  /** Clients by chain id, for a caller that checks signatures of several chains (a server). */
  publicClients?: PublicClients;
}

/** PAYLOAD_INVALID unless `publicClients` is absent, a function or an object. */
export const assertSignatureClients = (
  clients: SignatureClients,
  path: string,
): void => {
  const { publicClients } = clients;
  if (
    publicClients !== undefined &&
    typeof publicClients !== 'function' &&
    (typeof publicClients !== 'object' || publicClients === null)
  ) {
    throw invalid(
      `${path}.publicClients`,
      'must be an object of PublicClients by chain id, or a function of the chain id',
    );
  }
};

/**
 * The client for `chainId`: from `publicClients`, else `publicClient` when it
 * is on that chain; undefined when neither is.
 */
export const clientForChain = (
  clients: SignatureClients,
  chainId: number,
): PublicClient | undefined => {
  const { publicClient, publicClients } = clients;
  const listed =
    typeof publicClients === 'function'
      ? publicClients(chainId)
      : publicClients?.[chainId];
  if (listed !== undefined && listed.chain?.id === chainId) return listed;
  return publicClient?.chain?.id === chainId ? publicClient : undefined;
};

/**
 * - `valid`: the signature recovers to `address` (ECDSA), or `address` is a
 *   contract that accepts it (EIP-1271);
 * - `invalid`: it does not, and `address` was checked on chain (an account,
 *   or a contract that refuses it), or the signature is not hex;
 * - `unverifiable`: it does not recover to `address`, and no client for the
 *   chain was given, so a contract wallet could not be asked.
 */
export type TypedDataSignatureCheck = 'valid' | 'invalid' | 'unverifiable';

/**
 * Checks `signature` over `data` for `address`: ECDSA recovery first; when
 * that fails, EIP-1271 `isValidSignature` on `address` with the client for
 * `chainId` (default: the typed data domain's chain id): `0x1626ba7e` from
 * `isValidSignature(bytes32, bytes)`, or the legacy `0x20c13b0b` from
 * `isValidSignature(bytes, bytes)` with the 32-byte hash as data (Safes
 * before 1.3.0). Never throws.
 */
export const checkTypedDataSignature = async ({
  address,
  signature,
  data,
  chainId,
  ...clients
}: {
  address: string;
  signature: string | undefined;
  data: ClusterTypedData;
  chainId?: number;
} & SignatureClients): Promise<TypedDataSignatureCheck> => {
  if (typeof signature !== 'string' || !isHex(signature)) return 'invalid';
  if (signature.length === 132) {
    try {
      const recovered = await recoverTypedDataAddress({ ...data, signature });
      if (sameAddress(recovered, address)) return 'valid';
    } catch {
      // Not a recoverable signature; may still be a contract wallet's.
    }
  }
  if (!isAddress(address, { strict: false })) return 'invalid';
  const chain = chainId ?? Number(data.domain?.chainId);
  const publicClient = Number.isSafeInteger(chain)
    ? clientForChain(clients, chain)
    : undefined;
  if (publicClient === undefined) return 'unverifiable';
  try {
    if ((await getCodeKind(publicClient, address)) !== 'contract') {
      return 'invalid';
    }
    return (await contractAccepts(
      publicClient,
      address,
      hashTypedData(data),
      signature,
    ))
      ? 'valid'
      : 'invalid';
  } catch {
    // The code read or the hashing failed.
    return 'invalid';
  }
};

/**
 * EIP-712 typed data as viem and `eth_signTypedData_v4` take it, loose
 * enough for eth-sig-util's `TypedMessage` (a `salt` as bytes, a string
 * `verifyingContract`, a `keyof` `primaryType`). An `EIP712Domain` entry in
 * `types` is accepted (and must match `domain`).
 */
export interface EIP712TypedData {
  domain?: {
    name?: string;
    version?: string;
    chainId?: number | bigint;
    verifyingContract?: string;
    /** Hex, or bytes (an `ArrayBuffer` or typed array) converted to hex. */
    salt?: string | ArrayBuffer | ArrayBufferView;
  };
  types: Record<string, ReadonlyArray<{ name: string; type: string }>>;
  /** A number (from a `keyof` type) is read as its string form. */
  primaryType: string | number;
  message: Record<string, unknown>;
}

const saltHex = (salt: string | ArrayBuffer | ArrayBufferView): string => {
  if (typeof salt === 'string') return salt;
  const bytes = ArrayBuffer.isView(salt)
    ? new Uint8Array(salt.buffer, salt.byteOffset, salt.byteLength)
    : new Uint8Array(salt);
  return bytesToHex(bytes);
};

/** viem's shape: `salt` as hex, `primaryType` as a string. */
const toViemTypedData = (typedData: EIP712TypedData): ClusterTypedData => {
  const { domain, primaryType } = typedData;
  const normalized =
    domain?.salt !== undefined && typeof domain.salt !== 'string'
      ? { ...domain, salt: saltHex(domain.salt) }
      : domain;
  return {
    ...typedData,
    ...(normalized !== undefined ? { domain: normalized } : {}),
    primaryType: String(primaryType),
  } as unknown as ClusterTypedData;
};

/**
 * verifyTypedDataSignature (pure; `chain` for a contract-wallet signer):
 * whether `signature` is `address`'s EIP-712 signature of `typedData`, by
 * ECDSA recovery or, for a contract wallet such as a Safe, EIP-1271
 * `isValidSignature` (also the legacy `isValidSignature(bytes, bytes)` →
 * `0x20c13b0b` of Safes before 1.3.0, as 2.x accepted). The 2.x `validateAddressSignature` /
 * `validateEOASignature`.
 *
 * **Contract wallets need a client for their chain.** 2.x fell back to
 * built-in RPCs; v3 has none. Pass `publicClients` (by chain id) or a
 * `publicClient` on `chainId` (default: the domain's `chainId`). Without
 * one, a signature that does not recover to `address` is `false`, even if
 * `address` is a Safe that would accept it.
 *
 * `typedData` is viem's shape (`domain`, `types`, `primaryType`,
 * `message`); an `EIP712Domain` entry in `types` is accepted, and so is
 * eth-sig-util's `TypedMessage` (a bytes `salt` is converted to hex). Never
 * throws: a malformed signature or typed data is `false` (2.x threw on a
 * malformed signature).
 */
export const verifyTypedDataSignature = async ({
  address,
  signature,
  typedData,
  chainId,
  publicClient,
  publicClients,
}: {
  address: string;
  signature: string;
  typedData: EIP712TypedData;
  /** Chain of a contract-wallet signer; default `typedData.domain.chainId`. */
  chainId?: number;
} & SignatureClients): Promise<boolean> => {
  let data: ClusterTypedData;
  try {
    data = toViemTypedData(typedData);
  } catch {
    return false;
  }
  return (
    (await checkTypedDataSignature({
      address,
      signature,
      data,
      ...(chainId !== undefined ? { chainId } : {}),
      ...(publicClient !== undefined ? { publicClient } : {}),
      ...(publicClients !== undefined ? { publicClients } : {}),
    })) === 'valid'
  );
};
