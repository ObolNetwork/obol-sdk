import {
  concat,
  getAddress,
  getBytes,
  Interface,
  isAddress,
  isHexString,
  keccak256,
  solidityPackedKeccak256,
} from 'ethers';
import {
  type ClaimableIncentives,
  type PreflightIssue,
  type PreflightResult,
  type ProviderType,
} from '../types.js';
import { MerkleDistributorABI } from '../abi/MerkleDistributorWithDeadline.js';
import {
  MERKLE_DISTRIBUTOR_RUNTIME,
  OBOL_TOKEN_ADDRESS,
} from '../constants.js';

const distributorInterface = new Interface(MerkleDistributorABI.abi);

/**
 * Computes the Merkle Distributor leaf for a claim:
 * `keccak256(abi.encodePacked(index, account, amount))`.
 */
export const merkleDistributorLeaf = (
  index: bigint,
  account: string,
  amount: bigint,
): string =>
  solidityPackedKeccak256(
    ['uint256', 'address', 'uint256'],
    [index, account, amount],
  );

/**
 * Folds a Merkle proof into a root using sorted-pair keccak256, matching
 * OpenZeppelin `MerkleProof.processProof`.
 */
export const processMerkleProof = (leaf: string, proof: string[]): string =>
  proof.reduce((node, sibling) => {
    const [a, b] =
      BigInt(node) < BigInt(sibling) ? [node, sibling] : [sibling, node];
    return keccak256(concat([a, b]));
  }, leaf);

/**
 * Returns keccak256 of `code` with the per-deployment immutables and the
 * metadata trailer zeroed (see {@link MERKLE_DISTRIBUTOR_RUNTIME}), or `null`
 * if the code length does not match the reference build.
 */
export const maskedDistributorCodeHash = (code: string): string | null => {
  const { codeLength, metadataLength, immutableOffsets } =
    MERKLE_DISTRIBUTOR_RUNTIME;
  const bytes = new Uint8Array(getBytes(code));
  if (bytes.length !== codeLength) {
    return null;
  }
  for (const offset of immutableOffsets) {
    bytes.fill(0, offset, offset + 32);
  }
  bytes.fill(0, codeLength - 2 - metadataLength, codeLength - 2);
  return keccak256(bytes);
};

const readDistributor = async (
  provider: ProviderType,
  contractAddress: string,
  method: 'merkleRoot' | 'token' | 'endTime' | 'isClaimed',
  args: unknown[] = [],
): Promise<unknown> => {
  const data = distributorInterface.encodeFunctionData(method, args);
  const result = await provider.call({ to: contractAddress, data });
  return distributorInterface.decodeFunctionResult(method, result)[0];
};

const isBytes32 = (value: unknown): value is string =>
  typeof value === 'string' && isHexString(value, 32);

const malformedDataIssue = (field: string): PreflightIssue => ({
  code: 'INVALID_INCENTIVES_DATA',
  message: `Incentives data from the API has an invalid ${field}`,
  hint: 'Do not claim; report the address to Obol so the incentives data can be checked.',
});

/**
 * Read-only checks run before claiming incentives. Verifies that the API data
 * belongs to `requestedAddress`, that the proof matches the distributor's
 * on-chain root, that the distributor is a known `MerkleDistributorWithDeadline`
 * paying out OBOL on this chain, and that the claim is still open.
 *
 * @internal Used by {@link Incentives.preflightClaim}.
 */
export const preflightIncentivesClaim = async ({
  requestedAddress,
  incentivesData,
  chainId,
  provider,
}: {
  requestedAddress: string;
  incentivesData: ClaimableIncentives;
  chainId: number;
  provider: ProviderType | undefined | null;
}): Promise<PreflightResult> => {
  const issues: PreflightIssue[] = [];
  const done = (): PreflightResult => ({ ok: issues.length === 0, issues });

  const {
    operator_address: operatorAddress,
    contract_address: contractAddress,
    index,
    amount,
    merkle_proof: merkleProof,
  } = incentivesData;

  if (
    typeof operatorAddress !== 'string' ||
    !isAddress(operatorAddress) ||
    operatorAddress.toLowerCase() !== requestedAddress.toLowerCase()
  ) {
    issues.push({
      code: 'OPERATOR_ADDRESS_MISMATCH',
      message: `Incentives data is for ${String(operatorAddress)}, not the requested address ${requestedAddress}`,
      hint: 'Do not claim; request incentives for the address you intend to claim for.',
    });
  }
  if (typeof contractAddress !== 'string' || !isAddress(contractAddress)) {
    issues.push(malformedDataIssue('contract_address'));
  }
  if (!Number.isSafeInteger(index) || index < 0) {
    issues.push(malformedDataIssue('index'));
  }
  if (typeof amount !== 'string' || !/^[0-9]+$/.test(amount)) {
    issues.push(malformedDataIssue('amount'));
  }
  if (!Array.isArray(merkleProof) || !merkleProof.every(isBytes32)) {
    issues.push(malformedDataIssue('merkle_proof'));
  }
  if (issues.length > 0) {
    return done();
  }

  if (!provider) {
    issues.push({
      code: 'PROVIDER_REQUIRED',
      message: 'A provider is required to check the claim on-chain',
      hint: 'Pass a provider to the Client, or a signer connected to one.',
    });
    return done();
  }

  const code = await provider.getCode(contractAddress);
  if (!code || code === '0x') {
    issues.push({
      code: 'CONTRACT_NOT_DEPLOYED',
      message: `Merkle Distributor contract is not available at address ${contractAddress}`,
      hint: 'Check that the client chainId and provider match the network of the incentives.',
    });
    return done();
  }
  if (maskedDistributorCodeHash(code) !== MERKLE_DISTRIBUTOR_RUNTIME.codeHash) {
    issues.push({
      code: 'UNKNOWN_DISTRIBUTOR',
      message: `Contract at ${contractAddress} is not a recognised Obol Merkle Distributor`,
      hint: 'Do not claim; report the contract address to Obol.',
    });
    return done();
  }

  const [onChainRoot, token, endTime, claimed, block] = await Promise.all([
    readDistributor(provider, contractAddress, 'merkleRoot') as Promise<string>,
    readDistributor(provider, contractAddress, 'token') as Promise<string>,
    readDistributor(provider, contractAddress, 'endTime') as Promise<bigint>,
    readDistributor(provider, contractAddress, 'isClaimed', [
      BigInt(index),
    ]) as Promise<boolean>,
    provider.getBlock('latest'),
  ]);

  const expectedToken = OBOL_TOKEN_ADDRESS[chainId];
  if (!expectedToken) {
    issues.push({
      code: 'UNSUPPORTED_CHAIN',
      message: `No OBOL token is configured for chain ${chainId}`,
      hint: 'Claim incentives on a supported chain (mainnet or Hoodi).',
    });
  } else if (getAddress(token) !== getAddress(expectedToken)) {
    issues.push({
      code: 'UNEXPECTED_TOKEN',
      message: `Distributor pays out ${token}, not the OBOL token ${expectedToken}`,
      hint: 'Do not claim; report the contract address to Obol.',
    });
  }

  const root = processMerkleProof(
    merkleDistributorLeaf(BigInt(index), operatorAddress, BigInt(amount)),
    merkleProof,
  );
  if (root.toLowerCase() !== onChainRoot.toLowerCase()) {
    issues.push({
      code: 'INVALID_PROOF',
      message:
        'Merkle proof does not match the distributor root for this index, account and amount',
      hint: 'Do not claim; the incentives data may be stale. Fetch it again or contact Obol.',
    });
  }

  if (claimed) {
    issues.push({
      code: 'ALREADY_CLAIMED',
      message: `Incentives at index ${index} have already been claimed`,
      hint: 'Nothing to do.',
    });
  }

  if (!block) {
    issues.push({
      code: 'CHAIN_READ_FAILED',
      message: 'Could not read the latest block to check the claim deadline',
      hint: 'Retry, or check the provider.',
    });
  } else if (BigInt(block.timestamp) > endTime) {
    issues.push({
      code: 'CLAIM_WINDOW_CLOSED',
      message: `Claim window of ${contractAddress} ended at ${endTime.toString()} (unix time)`,
      hint: 'Unclaimed incentives can no longer be claimed from this distributor.',
    });
  }

  return done();
};
