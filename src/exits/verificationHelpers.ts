import { ContainerType, ByteVectorType, fromHexString } from '@chainsafe/ssz';

// From obol-api/src/verification/common.ts
export const GENESIS_VALIDATOR_ROOT_HEX_STRING =
  '0x0000000000000000000000000000000000000000000000000000000000000000'; // Added 0x prefix

const ForkDataType = new ContainerType({
  currentVersion: new ByteVectorType(4),
  genesisValidatorsRoot: new ByteVectorType(32),
});

const SigningRootType = new ContainerType({
  objectRoot: new ByteVectorType(32),
  domain: new ByteVectorType(32),
});

/**
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/phase0/beacon-chain.md#compute_fork_data_root
 * @param currentVersion - Uint8Array of the current fork version.
 * @param genesisValidatorsRoot - Uint8Array of the genesis validators root.
 * @returns Uint8Array - The 32-byte fork data root.
 */
function computeForkDataRoot(
  currentVersion: Uint8Array,
  genesisValidatorsRoot: Uint8Array,
): Uint8Array {
  const forkDataVal = ForkDataType.defaultValue();
  forkDataVal.currentVersion = currentVersion;
  forkDataVal.genesisValidatorsRoot = genesisValidatorsRoot;
  return Buffer.from(ForkDataType.hashTreeRoot(forkDataVal).buffer);
}

/**
 * Computes the domain for a given domain type, fork version, and genesis state.
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/phase0/beacon-chain.md#compute_domain
 * @param domainType - Uint8Array representing the domain type (e.g., DOMAIN_VOLUNTARY_EXIT).
 * @param forkVersionString - Hex string of the fork version (e.g., Capella fork version).
 * @param genesisValidatorsRootOverride - Optional Uint8Array to override the default genesis validators root.
 * @returns Uint8Array - The 32-byte domain.
 */
export function computeDomain(
  domainType: Uint8Array, // Should be 4 bytes
  forkVersionString: string, // Hex string, e.g., '0x03000000'
  genesisValidatorsRootOverride?: Uint8Array, // 32 bytes
): Uint8Array {
  const forkVersionBytes = fromHexString(
    forkVersionString.substring(2, forkVersionString.length),
  );

  if (forkVersionBytes.length !== 4) {
    throw new Error('Fork version must be 4 bytes');
  }
  if (domainType.length !== 4) {
    throw new Error('Domain type must be 4 bytes');
  }

  const actualGenesisValidatorsRoot =
    genesisValidatorsRootOverride ??
    fromHexString(GENESIS_VALIDATOR_ROOT_HEX_STRING.substring(2));

  if (actualGenesisValidatorsRoot.length !== 32) {
    throw new Error('genesisValidatorsRoot must be 32 bytes');
  }
  const forkDataRoot = computeForkDataRoot(
    forkVersionBytes,
    actualGenesisValidatorsRoot,
  );
  const domain = new Uint8Array(32);
  domain.set(domainType);
  domain.set(forkDataRoot.subarray(0, 28), 4); // Set the remaining 28 bytes from forkDataRoot
  return domain;
}

/**
 * Computes the signing root for an SSZ object and a domain.
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/phase0/beacon-chain.md#compute_signing_root
 * @param sszObjectRoot - Uint8Array of the hash tree root of the SSZ object.
 * @param domain - Uint8Array of the domain.
 * @returns Uint8Array - The 32-byte signing root.
 */
function computeSigningRoot(
  sszObjectRoot: Uint8Array, // Should be 32 bytes
  domain: Uint8Array, // Should be 32 bytes
): Uint8Array {
  if (sszObjectRoot.length !== 32) {
    throw new Error('SSZ object root must be 32 bytes');
  }
  if (domain.length !== 32) {
    throw new Error('Domain must be 32 bytes');
  }

  const val = SigningRootType.defaultValue();
  val.objectRoot = sszObjectRoot;
  val.domain = domain;
  return Buffer.from(SigningRootType.hashTreeRoot(val).buffer);
}

/**
 * Convenience wrapper for computeSigningRoot.
 * @param domain - Uint8Array of the domain.
 * @param messageBuffer - Buffer of the message (SSZ object root).
 * @returns Uint8Array - The signing root.
 */
export function signingRoot(
  domain: Uint8Array,
  messageBuffer: Buffer, // Assumed to be the 32-byte sszObjectRoot
): Uint8Array {
  const sszObjectRootU8 = Uint8Array.from(messageBuffer);
  return computeSigningRoot(sszObjectRootU8, domain);
}
