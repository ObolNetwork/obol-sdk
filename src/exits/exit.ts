import { ENR } from '@chainsafe/enr';
import { blsVerify, blsThresholdAggregateSignatures } from '../blsUtils.js';
import { secp256k1VerifyDigest } from '../secp256k1Utils.js';
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
  RecombineExitBlobsOptions,
} from '../types.js';
import { ExitRecombineError, InvalidArgumentError } from '../errors.js';
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
 * Validates and verifies voluntary exit signatures for Obol distributed validators.
 *
 * Do not instantiate directly; access via `client.exit`.
 *
 * Available methods:
 * - {@link Exit.verifyPartialExitSignature} – verify a BLS partial exit signature
 * - {@link Exit.verifyExitPayloadSignature} – verify an ECDSA exit payload signature
 * - {@link Exit.validateExitBlobs} – validate exit blobs against cluster config
 * - {@link Exit.recombineExitBlobs} – aggregate partial signatures into a full exit blob
 *
 * All methods are read-only (no on-chain transactions). No signer is required.
 *
 * @example
 * ```typescript
 * const client = new Client({ chainId: 1 }, signer, provider);
 *
 * // Verify a partial exit signature
 * const isValid = await client.exit.verifyPartialExitSignature(
 *   publicShareKey,
 *   signedExitMessage,
 *   forkVersion,
 *   genesisValidatorsRoot,
 * );
 *
 * // Validate exit blobs for a cluster
 * const validBlobs = await client.exit.validateExitBlobs(
 *   clusterConfig,
 *   exitsPayload,
 *   beaconNodeApiUrl,
 *   existingBlobData,
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
   * const client = new Client({ chainId: 1 }, signer, provider);
   * const exit = client.exit; // Access via client, do not instantiate directly
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
    const messageSigningRoot = await Exit.exitSigningRoot(
      signedExitMessage.message,
      forkVersion,
      genesisValidatorsRootString,
    );

    return blsVerify(
      fromHexString(publicShareKey),
      messageSigningRoot,
      fromHexString(signedExitMessage.signature),
    );
  }

  /**
   * The signing root of a voluntary exit message: the message root in the
   * exit domain of the Capella fork matching `forkVersion` (EIP-7044).
   */
  private static async exitSigningRoot(
    message: ExitValidationMessage,
    forkVersion: string,
    genesisValidatorsRootString: string,
  ): Promise<Uint8Array> {
    const capellaForkVersionString = await getCapellaFork(forkVersion);
    if (!capellaForkVersionString) {
      throw new Error(
        `Could not determine Capella fork version for base fork: ${forkVersion}`,
      );
    }

    const exitDomain = computeDomain(
      fromHexString(DOMAIN_VOLUNTARY_EXIT),
      capellaForkVersionString,
      fromHexString(genesisValidatorsRootString),
    );

    return signingRoot(exitDomain, Exit.computePartialExitMessageRoot(message));
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
   *   (including high-s signatures and public keys that are not valid secp256k1 points)
   *
   * @throws {Error} When the ENR string is invalid or cannot be decoded
   * @throws {Error} When the signature is not 64 or 65 bytes of hex (`r || s`, optionally followed by the recovery id)
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

    let publicKey: Uint8Array;
    try {
      publicKey = ENR.decodeTxt(enrString).publicKey;
    } catch (e: any) {
      throw new Error(
        `Invalid ENR string: ${enrString}. Error: ${e.message ?? String(e)}`,
      );
    }

    const sigHex = exitsPayload.signature.startsWith('0x')
      ? exitsPayload.signature.substring(2)
      : exitsPayload.signature;

    if (sigHex.length !== 128 && sigHex.length !== 130) {
      throw new Error(
        `Invalid signature length. Expected 128 or 130 hex chars (r + s, optionally + v), got ${sigHex.length}`,
      );
    }

    if (!/^[0-9a-fA-F]*$/.test(sigHex)) {
      throw new Error('Invalid signature. Expected a hex string');
    }

    return secp256k1VerifyDigest(
      publicKey,
      fromHexString(partialExitsDtoHashRoot),
      exitsPayload.signature,
    );
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
      const storedSignature =
        existingBlob.shares_exit_data?.[0]?.[String(operatorIndex)]
          ?.partial_exit_signature;
      // Same epoch but nothing stored for this operator yet: not processed,
      // validate it like a new blob.
      if (!storedSignature) {
        return false;
      }
      if (storedSignature !== exitBlob.signed_exit_message.signature) {
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
   * This method threshold-aggregates partial exit signatures from multiple operators into a
   * single exit blob, matching Charon's `tbls.ThresholdAggregate`: each partial signature is
   * weighted by its Lagrange coefficient at x=0, where the share index of the signature keyed
   * by operator index `i` (0-based) is `i + 1`.
   *
   * **Pass `options` to get a verified result.** With `options`, each partial signature is
   * verified against its operator's public share (invalid ones are left out), at least
   * `threshold` valid partials are required, the first `threshold` valid partials by share
   * index are aggregated, and the result is verified against the validator public key.
   * Failures throw {@link ExitRecombineError} instead of returning an invalid blob.
   *
   * **Without `options`, nothing is verified:** every provided partial is aggregated and the
   * result is returned as is. With fewer than `threshold` partials, or one invalid partial,
   * the returned signature is invalid and no error is thrown; verify it against the validator
   * public key before broadcasting.
   *
   * @param exitBlob - The existing exit blob data containing partial exit signatures
   * @param options - The cluster (threshold, fork version, public shares) and the genesis
   *   validators root (or a beacon node API URL to read it from); enables verification
   *
   * @returns Promise resolving to a single exit blob with aggregated signatures
   *
   * @throws {Error} When no valid signatures are found for aggregation
   * @throws {Error} When signature length is invalid
   * @throws {Error} When signature parsing fails or a signature is not a valid G2 point
   *   (without `options`; with `options` such a partial is left out as invalid)
   * @throws {Error} When a share index key is not a non-negative integer or is duplicated
   * @throws {InvalidArgumentError} With `options`: the threshold is not a positive integer,
   *   not exactly one of `genesisValidatorsRoot` / `beaconNodeApiUrl` is given, or the
   *   validator is not in `clusterConfig`
   * @throws {ExitRecombineError} With `options`: `EXIT_NOT_ENOUGH_SHARES` when fewer than
   *   `threshold` partials verify, `EXIT_PARTIAL_SIGNATURE_INVALID` when the aggregate does
   *   not verify against the validator public key
   *
   * @example
   * ```typescript
   * // Verified (recommended)
   * const exitBlob = await exit.recombineExitBlobs(existingBlobData, {
   *   clusterConfig, // e.g. the ExitClusterConfig passed to validateExitBlobs
   *   beaconNodeApiUrl: "http://localhost:5052", // or genesisValidatorsRoot
   * });
   *
   * // Unverified: check the signature yourself before broadcasting
   * const aggregatedExitBlob = await exit.recombineExitBlobs(existingBlobData);
   * ```
   */
  async recombineExitBlobs(
    exitBlob: ExistingExitValidationBlobData,
    options?: RecombineExitBlobsOptions,
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

      // Keys are 0-based operator indices; the share index is sigIdx+1
      // (matching Go's sigIdx+1). Reject anything that is not a canonical
      // non-negative integer so two keys cannot map to the same share.
      if (!/^(0|[1-9]\d*)$/.test(sigIdxStr)) {
        throw new Error(`Invalid share index: ${sigIdxStr}`);
      }
      const shareIdx = Number(sigIdxStr) + 1;
      if (!Number.isSafeInteger(shareIdx)) {
        throw new Error(`Invalid share index: ${sigIdxStr}`);
      }
      if (signaturesByIndex.has(shareIdx)) {
        throw new Error(
          `Duplicate partial signature for share index ${shareIdx}`,
        );
      }

      let sigBytes: Uint8Array;
      try {
        sigBytes = fromHexString(cleanSigStr);
      } catch (err) {
        throw new Error(`Invalid partial signature: ${String(err)}`);
      }
      signaturesByIndex.set(shareIdx, sigBytes);
    }

    if (signaturesByIndex.size === 0) {
      throw new Error('No valid signatures found for aggregation');
    }

    if (options) {
      return await this.recombineVerified(exitBlob, signaturesByIndex, options);
    }

    // Threshold aggregation (equivalent to tbls.ThresholdAggregate in Go):
    // each partial signature is weighted by its Lagrange coefficient at x=0
    // for the set of share indices present, using every provided partial.
    let fullSig: Uint8Array;
    try {
      fullSig = blsThresholdAggregateSignatures(signaturesByIndex);
    } catch (err) {
      throw new Error(
        `Failed to threshold-aggregate partial signatures: ${String(err)}`,
      );
    }

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

  /**
   * The verified path of {@link Exit.recombineExitBlobs}, following v3's
   * `exits.aggregate`.
   */
  private async recombineVerified(
    exitBlob: ExistingExitValidationBlobData,
    signaturesByIndex: Map<number, Uint8Array>,
    options: RecombineExitBlobsOptions,
  ): Promise<FullExitBlob> {
    const { clusterConfig, beaconNodeApiUrl } = options;
    const { threshold, fork_version: forkVersion } = clusterConfig.definition;
    if (!Number.isSafeInteger(threshold) || threshold < 1) {
      throw new InvalidArgumentError(
        `Invalid threshold ${String(threshold)}: must be a positive integer`,
        'options.clusterConfig.definition.threshold',
      );
    }
    if (
      (options.genesisValidatorsRoot === undefined) ===
      (beaconNodeApiUrl === undefined)
    ) {
      throw new InvalidArgumentError(
        'Pass exactly one of genesisValidatorsRoot or beaconNodeApiUrl',
        'options',
      );
    }
    const normalizeKey = (key: string): string =>
      (key.startsWith('0x') ? key : '0x' + key).toLowerCase();
    const publicKey = normalizeKey(exitBlob.public_key);
    const validator = clusterConfig.distributed_validators.find(
      dv => normalizeKey(dv.distributed_public_key) === publicKey,
    );
    if (!validator) {
      throw new InvalidArgumentError(
        `Public key ${exitBlob.public_key} not found in the cluster's distributed validators.`,
        'options.clusterConfig',
      );
    }

    const genesisValidatorsRoot =
      options.genesisValidatorsRoot ??
      (await this.getNetworkParameters(forkVersion, beaconNodeApiUrl as string))
        .genesisValidatorsRoot;

    const message = {
      epoch: exitBlob.epoch,
      validator_index: exitBlob.validator_index,
    };
    const root = await Exit.exitSigningRoot(
      message,
      forkVersion,
      genesisValidatorsRoot,
    );

    // Check each partial against its operator's public share; an invalid one
    // is left out so one bad stored share does not block the exit.
    const valid: Array<[number, Uint8Array]> = [];
    const invalidShares: number[] = [];
    const shareIndices = [...signaturesByIndex.keys()].sort((a, b) => a - b);
    for (const shareIdx of shareIndices) {
      const signature = signaturesByIndex.get(shareIdx) as Uint8Array;
      const publicShare = validator.public_shares[shareIdx - 1];
      let ok = false;
      if (publicShare !== undefined) {
        try {
          ok = blsVerify(fromHexString(publicShare), root, signature);
        } catch {
          ok = false; // malformed public share hex
        }
      }
      if (ok) {
        valid.push([shareIdx, signature]);
      } else {
        invalidShares.push(shareIdx);
      }
    }
    const validShares = valid.map(([shareIdx]) => shareIdx);

    if (valid.length < threshold) {
      throw new ExitRecombineError(
        `${valid.length} valid partial exit signatures for ${publicKey}, ${threshold} needed${
          invalidShares.length > 0
            ? ` (invalid: shares ${invalidShares.join(', ')})`
            : ''
        }`,
        'EXIT_NOT_ENOUGH_SHARES',
        publicKey,
        validShares,
        invalidShares,
      );
    }

    const fullSig = blsThresholdAggregateSignatures(
      new Map(valid.slice(0, threshold)),
    );
    if (!blsVerify(fromHexString(publicKey), root, fullSig)) {
      throw new ExitRecombineError(
        `The aggregated exit signature does not verify against ${publicKey}`,
        'EXIT_PARTIAL_SIGNATURE_INVALID',
        publicKey,
        validShares,
        invalidShares,
      );
    }

    return {
      public_key: exitBlob.public_key,
      signed_exit_message: {
        message,
        signature: '0x' + Buffer.from(fullSig).toString('hex'),
      },
    };
  }
}
