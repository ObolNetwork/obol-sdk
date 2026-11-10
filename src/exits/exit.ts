import { ENR } from '@chainsafe/enr';
import { blsVerify, blsThresholdAggregateSignatures } from '../blsUtils.js';
import { secp256k1VerifyDigest } from '../secp256k1Utils.js';
import {
  ByteVectorType,
  ContainerType,
  fromHexString,
  ListCompositeType,
  UintBigintType,
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
import {
  ExitRecombineError,
  InvalidArgumentError,
  UnsupportedChainError,
} from '../errors.js';
import { CAPELLA_FORK_MAPPING, EXIT_NETWORKS } from '../constants.js';
import { getCapellaFork, getGenesisValidatorsRoot } from './ethUtils.js';
import { computeDomain, signingRoot } from './verificationHelpers.js';

// Constants from obol-api/src/verification/exit.ts (assuming these might be needed or were in the original context)
const DOMAIN_VOLUNTARY_EXIT = '0x04000000';

// SSZ Type Definitions (adapted from obol-api/src/verification/exit.ts)
const SSZExitMessageType = new ContainerType({
  epoch: new UintBigintType(8),
  validator_index: new UintBigintType(8),
});

const SSZPartialExitsPayloadType = new ContainerType({
  partial_exits: new ListCompositeType(
    new ContainerType({
      public_key: new ByteVectorType(48),
      signed_exit_message: new ContainerType({
        message: new ContainerType({
          epoch: new UintBigintType(8),
          validator_index: new UintBigintType(8),
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
 * - {@link Exit.recombineExitBlobs} – aggregate partial signatures into a full exit blob, verified against the validator public key
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
   * Parses a uint64 decimal string. Only decimal digits are accepted (not the
   * hex, whitespace or sign forms `BigInt()` also parses), and the value stays
   * a bigint: a JavaScript number loses precision above 2^53 - 1.
   */
  private static safeParseInt(value: string, argument: string): bigint {
    return BigInt(Exit.canonicalUint64(value, argument));
  }

  private static computePartialExitMessageRoot(
    msg: ExitValidationMessage,
  ): Buffer {
    const sszValue = SSZExitMessageType.defaultValue();

    sszValue.epoch = Exit.safeParseInt(msg.epoch, 'epoch');
    sszValue.validator_index = Exit.safeParseInt(
      msg.validator_index,
      'validator_index',
    );
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
          epoch: Exit.safeParseInt(
            pe.signed_exit_message.message.epoch,
            'epoch',
          ),
          validator_index: Exit.safeParseInt(
            pe.signed_exit_message.message.validator_index,
            'validator_index',
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
   * @throws {InvalidArgumentError} When `epoch` or `validator_index` is not a decimal uint64 string
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
    return Exit.exitSigningRootForCapella(
      message,
      capellaForkVersionString,
      genesisValidatorsRootString,
    );
  }

  private static exitSigningRootForCapella(
    message: ExitValidationMessage,
    capellaForkVersion: string,
    genesisValidatorsRootString: string,
  ): Uint8Array {
    const exitDomain = computeDomain(
      fromHexString(DOMAIN_VOLUNTARY_EXIT),
      capellaForkVersion,
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
      'epoch',
    );
    const existingEpoch = Exit.safeParseInt(existingBlob.epoch, 'epoch');

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
   * @throws {InvalidArgumentError} When an `epoch` or `validator_index` is not a decimal uint64 string
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
   * Recombines the partial exit signatures of a validator into its signed
   * voluntary exit, and verifies it.
   *
   * The partial signatures are threshold-aggregated as Charon's
   * `tbls.ThresholdAggregate` does: each one is weighted by its Lagrange
   * coefficient at x=0, where the share index of the signature keyed by
   * operator index `i` (0-based) is `i + 1`.
   *
   * **The returned signature is always verified** against `exitBlob.public_key`
   * for the exit message, in the voluntary exit domain of the client's chain
   * (`chainId`; Capella fork version and genesis validators root from
   * {@link EXIT_NETWORKS}, no beacon node needed). If it does not verify (fewer
   * than the cluster's threshold of partials, an invalid partial, another
   * network, another epoch or validator index) the method throws
   * {@link ExitRecombineError} and returns nothing. There is no way to skip
   * this check.
   *
   * `options` add to that:
   * - `clusterConfig`: each partial is first verified against its operator's
   *   public share and invalid ones are left out (and named in the error), at
   *   least `definition.threshold` valid partials are required, and the first
   *   `threshold` valid partials by share index are aggregated. Its
   *   `definition.fork_version` must be the client chain's.
   * - `genesisValidatorsRoot` or `beaconNodeApiUrl` (at most one): on a chain
   *   in {@link EXIT_NETWORKS} the root is only compared with the chain's (a
   *   mismatch throws). On a chain without an entry (possible only when `Exit`
   *   is constructed directly), one of them and `clusterConfig` are required:
   *   they supply the exit domain.
   *
   * For a set of valid partials the result is the same with and without
   * `options`, and the same as before 2.16.0.
   *
   * @param exitBlob - The stored exit: validator public key, epoch, validator
   *   index and the partial exit signatures keyed by 0-based operator index
   * @param options - Optional cluster (per-partial verification, threshold)
   *   and genesis validators root source
   *
   * @returns Promise resolving to the exit blob with the aggregated, verified
   *   signature. `epoch` and `validator_index` are returned in canonical
   *   decimal form (leading zeros removed)
   *
   * @throws {ExitRecombineError} `EXIT_PARTIAL_SIGNATURE_INVALID` when the
   *   aggregate does not verify against the validator public key, or a partial
   *   is not a valid signature encoding (without `clusterConfig`);
   *   `EXIT_NOT_ENOUGH_SHARES` when fewer than `threshold` partials verify
   *   (with `clusterConfig`)
   * @throws {InvalidArgumentError} `public_key` is not 48 bytes of hex;
   *   `epoch` or `validator_index` is not a decimal uint64; `options` are
   *   inconsistent (both root sources, a malformed root, a threshold that is
   *   not a positive integer, a validator not in `clusterConfig`, a
   *   `fork_version` or genesis validators root that is not the client
   *   chain's)
   * @throws {UnsupportedChainError} The client's chain has no entry in
   *   {@link EXIT_NETWORKS} and `options` do not supply the exit domain
   * @throws {Error} No partial signatures; a partial signature that is not 96
   *   bytes of hex; a share index key that is not a non-negative integer or is
   *   duplicated; the beacon node did not return a genesis validators root
   *
   * @example
   * ```typescript
   * // Verified against the validator public key on the client's chain
   * const exitBlob = await client.exit.recombineExitBlobs(existingBlobData);
   *
   * // Also checks each partial against its public share and the threshold
   * const exitBlob = await client.exit.recombineExitBlobs(existingBlobData, {
   *   clusterConfig, // e.g. the ExitClusterConfig passed to validateExitBlobs
   * });
   * ```
   */
  async recombineExitBlobs(
    exitBlob: ExistingExitValidationBlobData,
    options: RecombineExitBlobsOptions = {},
  ): Promise<FullExitBlob> {
    if (
      typeof exitBlob.public_key !== 'string' ||
      !/^(0x)?[0-9a-fA-F]{96}$/.test(exitBlob.public_key)
    ) {
      throw new InvalidArgumentError(
        `Invalid public_key: expected 48 bytes of hex, got ${String(exitBlob.public_key)}`,
        'exitBlob.public_key',
      );
    }
    const message = {
      epoch: Exit.canonicalUint64(exitBlob.epoch, 'exitBlob.epoch'),
      validator_index: Exit.canonicalUint64(
        exitBlob.validator_index,
        'exitBlob.validator_index',
      ),
    };

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

    const network = await this.resolveExitNetwork(options);
    const root = Exit.exitSigningRootForCapella(
      message,
      network.capellaForkVersion,
      network.genesisValidatorsRoot,
    );
    const publicKey = Exit.normalizeKey(exitBlob.public_key);
    const providedShares = [...signaturesByIndex.keys()].sort((a, b) => a - b);

    let fullSig: Uint8Array;
    let validShares: number[] = [];
    let invalidShares: number[] = [];
    let mismatchHint: string;
    if (options.clusterConfig === undefined) {
      // Threshold aggregation (equivalent to tbls.ThresholdAggregate in Go):
      // each partial signature is weighted by its Lagrange coefficient at x=0
      // for the set of share indices present, using every provided partial.
      try {
        fullSig = blsThresholdAggregateSignatures(signaturesByIndex);
      } catch (err) {
        throw new ExitRecombineError(
          `Failed to threshold-aggregate partial signatures: ${String(err)}`,
          'EXIT_PARTIAL_SIGNATURE_INVALID',
          'A partial signature is not a valid BLS signature encoding. Re-collect it, or pass options.clusterConfig to leave invalid partials out.',
          { publicKey, providedShares, validShares, invalidShares },
        );
      }
      mismatchHint =
        `Possible causes: fewer partial signatures than the cluster's threshold; an invalid partial signature; the validator is not on ${network.description}; ` +
        'epoch or validator_index are not the ones the operators signed. ' +
        'Pass options.clusterConfig to check each partial against its public share and enforce the threshold.';
    } else {
      const partials = this.verifiedPartials(
        options.clusterConfig,
        publicKey,
        signaturesByIndex,
        root,
        network.description,
      );
      validShares = partials.validShares;
      invalidShares = partials.invalidShares;
      fullSig = blsThresholdAggregateSignatures(partials.toAggregate);
      mismatchHint =
        'The partial signatures verify against the public shares, but the public shares are not those of this validator public key. Check that clusterConfig is the cluster lock of this validator.';
    }

    // Never return a signature that is not the validator's.
    if (!blsVerify(fromHexString(publicKey), root, fullSig)) {
      throw new ExitRecombineError(
        `The exit signature aggregated from ${
          options.clusterConfig === undefined ? 'shares' : 'valid shares'
        } ${(options.clusterConfig === undefined
          ? providedShares
          : validShares
        ).join(
          ', ',
        )} does not verify against ${publicKey} on ${network.description}`,
        'EXIT_PARTIAL_SIGNATURE_INVALID',
        mismatchHint,
        { publicKey, providedShares, validShares, invalidShares },
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

  private static normalizeKey(key: string): string {
    return (key.startsWith('0x') ? key : '0x' + key).toLowerCase();
  }

  /**
   * A uint64 decimal string in canonical form (no leading zeros), as v3's
   * `canonicalUint64`. Anything `BigInt()` would also parse (hex, whitespace,
   * a sign, an empty string) is refused.
   */
  private static canonicalUint64(value: string, argument: string): string {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
      throw new InvalidArgumentError(
        `Invalid ${argument}: expected a decimal integer string, got ${JSON.stringify(value)}`,
        argument,
      );
    }
    const n = BigInt(value);
    if (n > BigInt('0xFFFFFFFFFFFFFFFF')) {
      throw new InvalidArgumentError(
        `Invalid ${argument}: ${value} does not fit in a 64-bit unsigned integer`,
        argument,
      );
    }
    return n.toString();
  }

  /**
   * The voluntary exit domain inputs for {@link Exit.recombineExitBlobs}: the
   * client chain's {@link EXIT_NETWORKS} entry, which `options` must agree
   * with, or for a chain without an entry what `options` supply.
   */
  private async resolveExitNetwork(
    options: RecombineExitBlobsOptions,
  ): Promise<{
    capellaForkVersion: string;
    genesisValidatorsRoot: string;
    /** For messages, e.g. `chain 1 (mainnet)`. */
    description: string;
  }> {
    const { clusterConfig, genesisValidatorsRoot, beaconNodeApiUrl } = options;
    if (genesisValidatorsRoot !== undefined && beaconNodeApiUrl !== undefined) {
      throw new InvalidArgumentError(
        'Pass at most one of genesisValidatorsRoot and beaconNodeApiUrl',
        'options',
      );
    }
    if (
      genesisValidatorsRoot !== undefined &&
      !/^(0x)?[0-9a-fA-F]{64}$/.test(genesisValidatorsRoot)
    ) {
      throw new InvalidArgumentError(
        `Invalid genesisValidatorsRoot: expected 32 bytes of hex, got ${String(genesisValidatorsRoot)}`,
        'options.genesisValidatorsRoot',
      );
    }
    const forkVersion = clusterConfig?.definition.fork_version;
    if (clusterConfig !== undefined && typeof forkVersion !== 'string') {
      throw new InvalidArgumentError(
        'Invalid fork_version: expected a hex string',
        'options.clusterConfig.definition.fork_version',
      );
    }
    const suppliedRoot = async (): Promise<string | undefined> => {
      if (genesisValidatorsRoot !== undefined) {
        return Exit.normalizeKey(genesisValidatorsRoot);
      }
      if (beaconNodeApiUrl === undefined) return undefined;
      const fetched = await getGenesisValidatorsRoot(beaconNodeApiUrl);
      if (!fetched || !/^(0x)?[0-9a-fA-F]{64}$/.test(fetched)) {
        throw new Error('Could not retrieve genesis validators root.');
      }
      return Exit.normalizeKey(fetched);
    };

    const known = EXIT_NETWORKS[this.chainId];
    if (known !== undefined) {
      const description = `chain ${this.chainId} (${known.name})`;
      if (
        forkVersion !== undefined &&
        forkVersion.toLowerCase() !== known.forkVersion
      ) {
        throw new InvalidArgumentError(
          `Invalid fork_version: the cluster's fork_version ${forkVersion} is not ${known.forkVersion} of ${description}. The cluster is on another network than this client; construct the client with the cluster's chainId.`,
          'options.clusterConfig.definition.fork_version',
        );
      }
      const root = await suppliedRoot();
      if (root !== undefined && root !== known.genesisValidatorsRoot) {
        throw new InvalidArgumentError(
          `Invalid genesis validators root: ${root}${
            beaconNodeApiUrl !== undefined ? ' (from the beacon node)' : ''
          } is not ${known.genesisValidatorsRoot} of ${description}. ${
            beaconNodeApiUrl !== undefined ? 'The beacon node' : 'The root'
          } is of another network than this client's.`,
          beaconNodeApiUrl !== undefined
            ? 'options.beaconNodeApiUrl'
            : 'options.genesisValidatorsRoot',
        );
      }
      return {
        capellaForkVersion: known.capellaForkVersion,
        genesisValidatorsRoot: known.genesisValidatorsRoot,
        description,
      };
    }

    // No constants for this chain: options must supply the exit domain. The
    // signature is never returned unverified.
    const capellaForkVersion =
      forkVersion === undefined
        ? undefined
        : CAPELLA_FORK_MAPPING[forkVersion.toLowerCase()];
    if (
      capellaForkVersion === undefined ||
      (genesisValidatorsRoot === undefined && beaconNodeApiUrl === undefined)
    ) {
      throw new UnsupportedChainError(
        this.chainId,
        'exit.recombineExitBlobs',
        `The exit signature cannot be verified without the chain's exit domain. Use one of the chains ${Object.keys(
          EXIT_NETWORKS,
        ).join(
          ', ',
        )}, or pass options.clusterConfig (its definition.fork_version must have a known Capella fork version) together with options.genesisValidatorsRoot or options.beaconNodeApiUrl`,
      );
    }
    return {
      capellaForkVersion,
      genesisValidatorsRoot: (await suppliedRoot()) as string,
      description: `chain ${this.chainId} (fork version ${String(forkVersion)}, the given genesis validators root)`,
    };
  }

  /**
   * Checks each partial signature against its operator's public share, as
   * v3's `exits.aggregate` does, and requires `threshold` valid ones. An
   * invalid partial is left out so one bad stored share does not block the
   * exit.
   */
  private verifiedPartials(
    clusterConfig: NonNullable<RecombineExitBlobsOptions['clusterConfig']>,
    publicKey: string,
    signaturesByIndex: Map<number, Uint8Array>,
    root: Uint8Array,
    networkDescription: string,
  ): {
    toAggregate: Map<number, Uint8Array>;
    validShares: number[];
    invalidShares: number[];
  } {
    const { threshold } = clusterConfig.definition;
    if (!Number.isSafeInteger(threshold) || threshold < 1) {
      throw new InvalidArgumentError(
        `Invalid threshold ${String(threshold)}: must be a positive integer`,
        'options.clusterConfig.definition.threshold',
      );
    }
    const validator = clusterConfig.distributed_validators.find(
      dv => Exit.normalizeKey(dv.distributed_public_key) === publicKey,
    );
    if (!validator) {
      throw new InvalidArgumentError(
        `Public key ${publicKey} not found in the cluster's distributed validators.`,
        'options.clusterConfig',
      );
    }

    const valid: Array<[number, Uint8Array]> = [];
    const invalidShares: number[] = [];
    const providedShares = [...signaturesByIndex.keys()].sort((a, b) => a - b);
    for (const shareIdx of providedShares) {
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
      let hint: string;
      if (valid.length === 0) {
        // Every operator signing badly is unlikely: the inputs are wrong.
        hint =
          `No partial signature verifies against its public share, which points at the inputs rather than the operators. Check that the validator is on ${networkDescription}, ` +
          'that clusterConfig is the cluster lock of this validator (public_shares in operator order), ' +
          'and that epoch and validator_index are the ones the operators signed.';
      } else if (invalidShares.length > 0) {
        hint = `Wait for more operators to submit partial exits, and re-collect the invalid shares (${invalidShares.join(', ')}).`;
      } else {
        hint = 'Wait for more operators to submit partial exits.';
      }
      throw new ExitRecombineError(
        `${valid.length} valid partial exit signatures for ${publicKey}, ${threshold} needed${
          invalidShares.length > 0
            ? ` (invalid: shares ${invalidShares.join(', ')})`
            : ''
        }`,
        'EXIT_NOT_ENOUGH_SHARES',
        hint,
        { publicKey, providedShares, validShares, invalidShares },
      );
    }

    return {
      toAggregate: new Map(valid.slice(0, threshold)),
      validShares,
      invalidShares,
    };
  }
}
