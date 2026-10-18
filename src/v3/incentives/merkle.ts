/** MerkleDistributorWithDeadline helpers: ABI, leaf and proof, code fingerprint. */
import {
  concat,
  encodePacked,
  hexToBytes,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';

export const merkleDistributorAbi = parseAbi([
  'function claim(uint256 index, address account, uint256 amount, bytes32[] merkleProof)',
  'function isClaimed(uint256 index) view returns (bool)',
  'function merkleRoot() view returns (bytes32)',
  'function token() view returns (address)',
  'function endTime() view returns (uint256)',
]);

/**
 * Reference runtime code of the Obol `MerkleDistributorWithDeadline` build:
 * its length, the offsets of the 8 per-deployment immutables (32 bytes each),
 * the length of the metadata trailer, and keccak256 of the code with those
 * zeroed. Same values as 2.x `MERKLE_DISTRIBUTOR_RUNTIME`.
 */
export const MERKLE_DISTRIBUTOR_RUNTIME = {
  codeLength: 2437,
  metadataLength: 51,
  immutableOffsets: [155, 656, 715, 893, 952, 1103, 1386, 1496],
  codeHash:
    '0x24b74a2b834aa0d14e312af3a4d4be7e62ceb7fc67c822bc3612cff4329d04c8',
} as const;

/** `keccak256(abi.encodePacked(uint256 index, address account, uint256 amount))`. */
export const merkleLeaf = (
  index: bigint,
  account: Address,
  amount: bigint,
): Hex =>
  keccak256(
    encodePacked(['uint256', 'address', 'uint256'], [index, account, amount]),
  );

/** Folds a proof with sorted-pair keccak256 (OpenZeppelin `MerkleProof.processProof`). */
export const processProof = (leaf: Hex, proof: readonly Hex[]): Hex =>
  proof.reduce<Hex>((node, sibling) => {
    const [a, b] =
      BigInt(node) < BigInt(sibling) ? [node, sibling] : [sibling, node];
    return keccak256(concat([a, b]));
  }, leaf);

/**
 * keccak256 of `code` with the immutables and metadata trailer zeroed, or
 * null when its length differs from the reference build.
 */
export const maskedDistributorCodeHash = (code: Hex): Hex | null => {
  const { codeLength, metadataLength, immutableOffsets } =
    MERKLE_DISTRIBUTOR_RUNTIME;
  const bytes = hexToBytes(code);
  if (bytes.length !== codeLength) return null;
  for (const offset of immutableOffsets) bytes.fill(0, offset, offset + 32);
  bytes.fill(0, codeLength - 2 - metadataLength, codeLength - 2);
  return keccak256(bytes);
};
