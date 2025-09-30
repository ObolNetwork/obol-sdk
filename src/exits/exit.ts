import { ENR } from '@chainsafe/enr';
import * as elliptic from 'elliptic';
import bls from '@chainsafe/bls';
import {
  ByteVectorType,
  ContainerType,
  fromHexString,
  ListCompositeType,
  UintNumberType,
} from '@chainsafe/ssz';
import type {
  ProviderType,
  ExitClusterConfig,
  ExitValidationPayload,
  ExitValidationBlob,
  ExitValidationMessage,
  SignedExitValidationMessage,
  ExistingExitValidationBlobData,
  FullExitBlob,
} from '../types';
import { getCapellaFork, getGenesisValidatorsRoot } from './ethUtils.js';
import { computeDomain, signingRoot } from './verificationHelpers.js';

// Constants from obol-api/src/verification/exit.ts (assuming these might be needed or were in the original context)
const DOMAIN_VOLUNTARY_EXIT = '0x04000000';

// SSZ Type Definitions (adapted from obol-api/src/verification/exit.ts)
const SSZExitMessageType = new ContainerType({
  epoch: new UintNumberType(8),
  validator_index: new UintNumberType(8),
});

const SSZPartialExitsPayloadType = new ContainerType({
  partial_exits: new ListCompositeType(
    new ContainerType({
      public_key: new ByteVectorType(48),
      signed_exit_message: new ContainerType({
        message: new ContainerType({
          epoch: new UintNumberType(8),
          validator_index: new UintNumberType(8),
        }),
        signature: new ByteVectorType(96),
      }),
    }),
    65536,
  ),
  share_idx: new UintNumberType(8),
});

/**
 * Exit validation and verification class for Obol distributed validators.
 *
 * This class provides functionality to validate and verify voluntary exit signatures
 * for distributed validators in an Obol cluster. It handles both partial exit signatures
 * from individual operators and payload signatures that authorize exit operations.
 *
 * The class supports:
 * - Verification of BLS signatures for partial exit messages
 * - Verification of ECDSA signatures for exit payload authorization
 * - Validation of exit blobs against cluster configuration
 * - Duplicate detection and epoch validation
 *
 * @example
 * ```typescript
 * const exit = new Exit(1, provider); // Mainnet with provider
 *
 * // Verify a partial exit signature
 * const isValid = await exit.verifyPartialExitSignature(
 *   publicShareKey,
 *   signedExitMessage,
 *   forkVersion,
 *   genesisValidatorsRoot
 * );
 *
 * // Validate exit blobs for a cluster
 * const validBlobs = await exit.validateExitBlobs(
 *   clusterConfig,
 *   exitsPayload,
 *   beaconNodeApiUrl,
 *   existingBlobData
 * );
 * ```
 */
export class Exit {
  public readonly chainId: number;
  public readonly provider: ProviderType | undefined | null;

  /**
   * Creates a new Exit instance for validator exit operations.
   *
   * @param chainId - The Ethereum chain ID (e.g., 1 for mainnet, 5 for goerli)
   * @param provider - Optional Ethereum provider for blockchain interactions
   *
   * @example
   * ```typescript
   * // For mainnet with a provider
   * const exit = new Exit(1, provider);
   *
   * // For goerli testnet without provider
   * const exit = new Exit(5, null);
   * ```
   */
  constructor(chainId: number, provider: ProviderType | undefined | null) {
    this.chainId = chainId;
    this.provider = provider;
  }

  /**
   * Safely parse a string integer to number, using BigInt to avoid precision loss
   * for large values beyond JavaScript's safe integer limit (2^53 - 1).
   * Throws an error if the value exceeds the safe range for a 64-bit unsigned integer.
   */
  private static safeParseInt(value: string): number {
    const bigIntValue = BigInt(value);

    // Check if value is within the range of a 64-bit unsigned integer
    const MAX_UINT64 = BigInt('0xFFFFFFFFFFFFFFFF');
    if (bigIntValue < 0 || bigIntValue > MAX_UINT64) {
      throw new Error(
        `Value ${value} is outside the valid range for a 64-bit unsigned integer`,
      );
    }

    // Convert to number - SSZ library should handle values even if they exceed JS safe integer limits
    return Number(bigIntValue);
  }

  private static computePartialExitMessageRoot(
    msg: ExitValidationMessage,
  ): Buffer {
    const sszValue = SSZExitMessageType.defaultValue();

    sszValue.epoch = Exit.safeParseInt(msg.epoch);
    sszValue.validator_index = Exit.safeParseInt(msg.validator_index);
    return Buffer.from(SSZExitMessageType.hashTreeRoot(sszValue).buffer);
  }

  private static computeExitPayloadRoot(exits: ExitValidationPayload): string {
    // Remove sorting since SSZ list ordering guarantees order
    // This eliminates the O(n log n) sort and improves performance
    const sszValue = SSZPartialExitsPayloadType.defaultValue();
    sszValue.partial_exits = exits.partial_exits.map(pe => ({
      public_key: fromHexString(pe.public_key),
      signed_exit_message: {
        message: {
          epoch: Exit.safeParseInt(pe.signed_exit_message.message.epoch),
          validator_index: Exit.safeParseInt(
            pe.signed_exit_message.message.validator_index,
          ),
        },
        signature: fromHexString(pe.signed_exit_message.signature),
      },
    }));
    sszValue.share_idx = exits.share_idx;

    return Buffer.from(
      SSZPartialExitsPayloadType.hashTreeRoot(sszValue).buffer,
    ).toString('hex');
  }

  /**
   * Verifies a partial exit signature from a distributed validator operator.
   *
   * This method validates that a partial exit signature was correctly signed by the
   * operator's share of the distributed validator's private key. It performs BLS
   * signature verification using the appropriate fork version and genesis validators root.
   *
   * @param publicShareKey - The operator's public share key (BLS public key, hex string with or without 0x prefix)
   * @param signedExitMessage - The signed exit message containing the exit details and signature
   * @param forkVersion - The Ethereum fork version (e.g., "0x00000000" for mainnet)
   * @param genesisValidatorsRootString - The genesis validators root for the network (hex string)
   *
   * @returns Promise resolving to true if the signature is valid, false otherwise
   *
   * @throws {Error} When unable to determine the Capella fork version for the given network
   * @throws {Error} When BLS library initialization or verification fails
   *
   * @example
   * ```typescript
   * const isValid = await exit.verifyPartialExitSignature(
   *   "0x1234...abcd", // operator's public share key
   *   {
   *     message: { epoch: "12345", validator_index: "67890" },
   *     signature: "0xabcd...1234"
   *   },
   *   "0x00000000", // mainnet fork version
   *   "0x4b363db94e286120d76eb905340fdd4e54bfe9f06bf33ff6cf5ad27f511bfe95"
   * );
   * ```
   */
  async verifyPartialExitSignature(
    publicShareKey: string,
    signedExitMessage: SignedExitValidationMessage,
    forkVersion: string,
    genesisValidatorsRootString: string,
  ): Promise<boolean> {
    await bls.init();
    const capellaForkVersionString = await getCapellaFork(forkVersion);
    if (!capellaForkVersionString) {
      throw new Error(
        `Could not determine Capella fork version for base fork: ${forkVersion}`,
      );
    }

    const partialExitMessageBuffer = Exit.computePartialExitMessageRoot(
      signedExitMessage.message,
    );

    const exitDomain = computeDomain(
      fromHexString(DOMAIN_VOLUNTARY_EXIT),
      capellaForkVersionString,
      fromHexString(genesisValidatorsRootString),
    );

    const messageSigningRoot = signingRoot(
      exitDomain,
      partialExitMessageBuffer,
    );

    return bls.verify(
      fromHexString(publicShareKey),
      messageSigningRoot,
      fromHexString(signedExitMessage.signature),
    );
  }

  /**
   * Verifies the exit payload signature using the operator's ENR.
   *
   * This method validates that an exit payload was signed by the correct operator
   * using ECDSA signature verification. The signature is verified against the
   * operator's public key extracted from their ENR (Ethereum Node Record).
   *
   * @param enrString - The operator's ENR string containing their identity and public key
   * @param exitsPayload - The exit validation payload containing partial exits and operator signature
   *
   * @returns Promise resolving to true if the payload signature is valid, false otherwise
   *
   * @throws {Error} When the ENR string is invalid or cannot be decoded
   * @throws {Error} When the signature format is invalid (must be 130 hex characters)
   * @throws {Error} When signature verification encounters an error
   *
   * @example
   * ```typescript
   * const isValid = await exit.verifyExitPayloadSignature(
   *   "enr:-LK4QFo_n0dUm4PKejSOXf8JkSWq5EINV0XhG1zY00d...", // operator ENR
   *   {
   *     partial_exits: [exitBlob1, exitBlob2],
   *     share_idx: 1,
   *     signature: "0x1234...abcd" // ECDSA signature (130 hex chars)
   *   }
   * );
   * ```
   */
  async verifyExitPayloadSignature(
    enrString: string,
    exitsPayload: ExitValidationPayload,
  ): Promise<boolean> {
    const partialExitsDtoHashRoot = Exit.computeExitPayloadRoot(exitsPayload);
    const ec = new elliptic.ec('secp256k1');

    let pubKeyHex;
    try {
      pubKeyHex = ENR.decodeTxt(enrString).publicKey.toString();
    } catch (e: any) {
      throw new Error(
        `Invalid ENR string: ${enrString}. Error: ${e.message ?? String(e)}`,
      );
    }

    const sigHex = exitsPayload.signature.startsWith('0x')
      ? exitsPayload.signature.substring(2)
      : exitsPayload.signature;

    if (sigHex.length !== 130) {
      throw new Error(
        `Invalid signature length. Expected 130 hex chars (r + s), got ${sigHex.length}`,
      );
    }

    const r = sigHex.slice(0, 64);
    const s = sigHex.slice(64, 128);

    const enrSignature = { r, s };

    try {
      return ec
        .keyFromPublic(pubKeyHex, 'hex')
        .verify(
          partialExitsDtoHashRoot,
          enrSignature as elliptic.ec.SignatureOptions,
        );
    } catch (e: any) {
      throw new Error(
        `Signature verification failed: ${e.message ?? String(e)}`,
      );
    }
  }

  private async validateOperatorAndPayload(
    clusterConfig: ExitClusterConfig,
    exitsPayload: ExitValidationPayload,
  ): Promise<string> {
    const operatorIndex = exitsPayload.share_idx - 1;
    if (
      operatorIndex < 0 ||
      operatorIndex >= clusterConfig.definition.operators.length
    ) {
      throw new Error(
        `Invalid share_idx ${exitsPayload.share_idx} for ${clusterConfig.definition.operators.length} operators.`,
      );
    }
    const operatorEnr = clusterConfig.definition.operators[operatorIndex].enr;

    const isPayloadSignatureValid = await this.verifyExitPayloadSignature(
      operatorEnr,
      exitsPayload,
    );
    if (!isPayloadSignatureValid) {
      throw new Error('Incorrect payload signature for partial exits.');
    }

    return operatorEnr;
  }

  private async getNetworkParameters(
    forkVersion: string,
    beaconNodeApiUrl: string,
  ): Promise<{ genesisValidatorsRoot: string; capellaForkVersion: string }> {
    const genesisValidatorsRootString =
      await getGenesisValidatorsRoot(beaconNodeApiUrl);
    if (!genesisValidatorsRootString) {
      throw new Error('Could not retrieve genesis validators root.');
    }

    const capellaForkVersionString = await getCapellaFork(forkVersion);
    if (!capellaForkVersionString) {
      throw new Error(
        `Unsupported network: Could not determine Capella fork for ${forkVersion}`,
      );
    }

    return {
      genesisValidatorsRoot: genesisValidatorsRootString,
      capellaForkVersion: capellaForkVersionString,
    };
  }

  private findValidatorInCluster(
    clusterConfig: ExitClusterConfig,
    publicKey: string,
    operatorIndex: number,
  ): { validator: any; publicShare: string } {
    const validatorInCluster = clusterConfig.distributed_validators.find(
      dv =>
        (dv.distributed_public_key.startsWith('0x')
          ? dv.distributed_public_key
          : '0x' + dv.distributed_public_key
        ).toLowerCase() ===
        (publicKey.startsWith('0x')
          ? publicKey
          : '0x' + publicKey
        ).toLowerCase(),
    );

    if (!validatorInCluster) {
      throw new Error(
        `Public key ${publicKey} not found in the cluster's distributed validators.`,
      );
    }

    const publicShareForOperator =
      validatorInCluster.public_shares[operatorIndex];
    if (!publicShareForOperator) {
      throw new Error(
        `Public share for operator index ${operatorIndex} not found for validator ${publicKey}`,
      );
    }

    return {
      validator: validatorInCluster,
      publicShare: publicShareForOperator,
    };
  }

  private async validateExistingBlobData(
    exitBlob: ExitValidationBlob,
    existingBlob: ExistingExitValidationBlobData | null,
    operatorIndex: number,
  ): Promise<boolean> {
    if (!existingBlob) {
      return false;
    }

    // Check if existing blob data is for this public key
    const normalizeKey = (key: string): string =>
      (key.startsWith('0x') ? key : '0x' + key).toLowerCase();

    if (
      normalizeKey(existingBlob.public_key) !==
      normalizeKey(exitBlob.public_key)
    ) {
      return false; // Existing blob data is for a different validator
    }

    if (
      existingBlob.validator_index !==
      exitBlob.signed_exit_message.message.validator_index
    ) {
      throw new Error(
        `Validator index mismatch for already processed exit for public key ${exitBlob.public_key}. Expected ${existingBlob.validator_index}, got ${exitBlob.signed_exit_message.message.validator_index}.`,
      );
    }

    const currentEpoch = Exit.safeParseInt(
      exitBlob.signed_exit_message.message.epoch,
    );
    const existingEpoch = Exit.safeParseInt(existingBlob.epoch);

    if (currentEpoch < existingEpoch) {
      throw new Error(
        `New exit epoch ${currentEpoch} is not greater than existing exit epoch ${existingEpoch} for validator ${exitBlob.public_key}.`,
      );
    } else if (currentEpoch === existingEpoch) {
      const operatorShareIndexString = String(operatorIndex);
      if (
        existingBlob.shares_exit_data?.[0]?.[operatorShareIndexString]
          ?.partial_exit_signature &&
        existingBlob.shares_exit_data[0][operatorShareIndexString]
          .partial_exit_signature !== exitBlob.signed_exit_message.signature
      ) {
        throw new Error(
          `Signature mismatch for validator ${exitBlob.public_key}, operator index ${operatorIndex} at epoch ${currentEpoch}. Received different signature than existing.`,
        );
      }
      return true; // Already processed
    }

    return false;
  }

  private async processExitBlob(
    exitBlob: ExitValidationBlob,
    clusterConfig: ExitClusterConfig,
    operatorIndex: number,
    genesisValidatorsRoot: string,
    existingBlobData: ExistingExitValidationBlobData | null,
  ): Promise<ExitValidationBlob | null> {
    const { publicShare } = this.findValidatorInCluster(
      clusterConfig,
      exitBlob.public_key,
      operatorIndex,
    );

    const alreadyProcessed = await this.validateExistingBlobData(
      exitBlob,
      existingBlobData,
      operatorIndex,
    );

    if (alreadyProcessed) {
      return null;
    }

    const isPartialSignatureValid = await this.verifyPartialExitSignature(
      publicShare,
      exitBlob.signed_exit_message,
      clusterConfig.definition.fork_version,
      genesisValidatorsRoot,
    );

    if (!isPartialSignatureValid) {
      throw new Error(
        `Invalid partial exit signature for validator ${exitBlob.public_key} by operator index ${operatorIndex}.`,
      );
    }

    return exitBlob;
  }

  /**
   * Validates exit blobs against cluster configuration and existing data.
   *
   * This method performs comprehensive validation of exit blobs including:
   * - Operator authorization and payload signature verification
   * - Network parameter validation (genesis root, fork version)
   * - Public key validation against cluster configuration
   * - Partial signature verification for each exit blob
   * - Duplicate detection and epoch progression validation
   * - Signature consistency checks for existing exits
   *
   * @param clusterConfig - The cluster configuration containing operators and distributed validators
   * @param exitsPayload - The exit validation payload with partial exits and operator info
   * @param beaconNodeApiUrl - The beacon node API URL for network parameter retrieval
   * @param existingBlobData - Existing exit blob data for duplicate detection, or null if none exists
   *
   * @returns Promise resolving to an array of validated, non-duplicate exit blobs
   *
   * @throws {Error} When share_idx is invalid or out of bounds for the cluster operators
   * @throws {Error} When payload signature verification fails
   * @throws {Error} When network parameters cannot be retrieved or are invalid
   * @throws {Error} When a public key is not found in the cluster's distributed validators
   * @throws {Error} When a partial exit signature is invalid
   * @throws {Error} When exit epoch validation fails (new epoch not greater than existing)
   * @throws {Error} When validator index mismatches with existing data
   * @throws {Error} When signature mismatches for the same epoch and operator
   *
   * @example
   * ```typescript
   * const validExitBlobs = await exit.validateExitBlobs(
   *   {
   *     definition: {
   *       operators: [{ enr: "enr:-LK4Q..." }],
   *       fork_version: "0x00000000",
   *       threshold: 1
   *     },
   *     distributed_validators: [{
   *       distributed_public_key: "0x1234...abcd",
   *       public_shares: ["0x5678...efgh"]
   *     }]
   *   },
   *   {
   *     partial_exits: [exitBlob],
   *     share_idx: 1,
   *     signature: "0x1234...abcd"
   *   },
   *   "http://localhost:5052",
   *   existingBlobData // or null for new exits
   * );
   * ```
   */
  async validateExitBlobs(
    clusterConfig: ExitClusterConfig,
    exitsPayload: ExitValidationPayload,
    beaconNodeApiUrl: string,
    existingBlobData: ExistingExitValidationBlobData | null,
  ): Promise<ExitValidationBlob[]> {
    await this.validateOperatorAndPayload(clusterConfig, exitsPayload);

    const { genesisValidatorsRoot } = await this.getNetworkParameters(
      clusterConfig.definition.fork_version,
      beaconNodeApiUrl,
    );

    const operatorIndex = exitsPayload.share_idx - 1;
    const validNonDuplicateBlobs: ExitValidationBlob[] = [];

    for (const currentExitBlob of exitsPayload.partial_exits) {
      const processedBlob = await this.processExitBlob(
        currentExitBlob,
        clusterConfig,
        operatorIndex,
        genesisValidatorsRoot,
        existingBlobData,
      );

      if (processedBlob) {
        validNonDuplicateBlobs.push(processedBlob);
      }
    }

    return validNonDuplicateBlobs;
  }

  /**
   * Recombines exit blobs into a single exit blob.
   *
   * This method aggregates partial exit signatures from multiple operators into a single exit blob.
   * It ensures that the signatures are properly ordered and aggregated according to the operator indices.
   *
   * @param exitBlob - The existing exit blob data containing partial exit signatures
   *
   * @returns Promise resolving to a single exit blob with aggregated signatures
   *
   * @throws {Error} When no valid signatures are found for aggregation
   * @throws {Error} When signature length is invalid
   * @throws {Error} When signature parsing fails
   *
   * @example
   * ```typescript
   * const aggregatedExitBlob = await exit.recombineExitBlobs(existingBlobData);
   * ```
   */
  async recombineExitBlobs(
    exitBlob: ExistingExitValidationBlobData,
  ): Promise<FullExitBlob> {

    // Map to store signatures by their share index (matching Go's map[int]tbls.Signature)
    const signaturesByIndex = new Map<number, Uint8Array>();

    // Extract signatures from shares_exit_data (equivalent to er.Signatures in Go)
    if (!exitBlob.shares_exit_data || exitBlob.shares_exit_data.length === 0) {
      throw new Error('No shares exit data available for aggregation');
    }
    const signaturesMap = exitBlob.shares_exit_data[0] || {};
    for (const [sigIdxStr, sigData] of Object.entries(signaturesMap)) {
      const sigStr = sigData.partial_exit_signature;

      if (!sigStr || sigStr.length === 0) {
        // ignore, the associated share index didn't push a partial signature yet
        continue;
      }

      if (sigStr.length < 2) {
        throw new Error(`Signature string has invalid size: ${sigStr.length}`);
      }

      // Remove 0x prefix and ensure it's 96 bytes (192 hex chars)
      const cleanSigStr = sigStr.startsWith('0x')
        ? sigStr.substring(2)
        : sigStr;
      if (cleanSigStr.length !== 192) {
        throw new Error(
          `Invalid signature length. Expected 192 hex chars (96 bytes), got ${cleanSigStr.length}`,
        );
      }

      try {
        const sigBytes = fromHexString(cleanSigStr);
        // Convert string index to number and add 1 (matching Go's sigIdx+1)
        const sigIdx = parseInt(sigIdxStr, 10);
        signaturesByIndex.set(sigIdx + 1, sigBytes);
      } catch (err) {
        throw new Error(`Invalid partial signature: ${String(err)}`);
      }
    }

    if (signaturesByIndex.size === 0) {
      throw new Error('No valid signatures found for aggregation');
    }

    // Sort by index and extract signatures in correct order
    const sortedIndices = Array.from(signaturesByIndex.keys()).sort(
      (a, b) => a - b,
    );
    const rawSignatures = sortedIndices.map(idx => {
      const signature = signaturesByIndex.get(idx);
      if (signature === undefined) {
        throw new Error(`Missing signature for index ${idx}`);
      }
      return signature;
    });

    // Aggregate signatures (equivalent to tbls.ThresholdAggregate in Go)
    // Note: @chainsafe/bls doesn't have explicit threshold aggregation, but ordering should be preserved
    const fullSig = bls.aggregateSignatures(rawSignatures);

    return {
      public_key: exitBlob.public_key,
      signed_exit_message: {
        message: {
          epoch: exitBlob.epoch,
          validator_index: exitBlob.validator_index,
        },
        signature: '0x' + Buffer.from(fullSig).toString('hex'),
      },
    };
  }
}
