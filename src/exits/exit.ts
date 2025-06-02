import { ENR } from '@chainsafe/discv5';
import * as elliptic from 'elliptic';
import { init, verify } from '@chainsafe/bls';
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
  HttpRequestFunc,
} from '../types';
import { getCapellaFork, getGenesisValidatorsRoot } from './ethUtils';
import { computeDomain, signingRoot } from './verificationHelpers';

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

export class Exit {
  public readonly chainId: number;
  private readonly request: HttpRequestFunc;
  public readonly provider: ProviderType | undefined | null;

  constructor(
    chainId: number,
    request: HttpRequestFunc,
    provider: ProviderType | undefined | null,
  ) {
    this.chainId = chainId;
    this.request = request;
    this.provider = provider;
  }

  private static computePartialExitMessageRoot(
    msg: ExitValidationMessage,
  ): Buffer {
    const sszValue = SSZExitMessageType.defaultValue();
    sszValue.epoch = parseInt(msg.epoch, 10);
    sszValue.validator_index = parseInt(msg.validator_index, 10);
    return Buffer.from(SSZExitMessageType.hashTreeRoot(sszValue).buffer);
  }

  private static computeExitPayloadRoot(exits: ExitValidationPayload): string {
    const sortedPartialExits = [...exits.partial_exits].sort(
      (a, b) =>
        parseInt(a.signed_exit_message.message.validator_index, 10) -
        parseInt(b.signed_exit_message.message.validator_index, 10),
    );

    const sszValue = SSZPartialExitsPayloadType.defaultValue();
    sszValue.partial_exits = sortedPartialExits.map(pe => ({
      public_key: fromHexString(pe.public_key.substring(2)),
      signed_exit_message: {
        message: {
          epoch: parseInt(pe.signed_exit_message.message.epoch, 10),
          validator_index: parseInt(
            pe.signed_exit_message.message.validator_index,
            10,
          ),
        },
        signature: fromHexString(pe.signed_exit_message.signature.substring(2)),
      },
    }));
    sszValue.share_idx = exits.share_idx;

    return Buffer.from(
      SSZPartialExitsPayloadType.hashTreeRoot(sszValue).buffer,
    ).toString('hex');
  }

  async verifyPartialExitSignature(
    publicShareKey: string,
    signedExitMessage: SignedExitValidationMessage,
    forkVersion: string,
    genesisValidatorsRootString: string,
  ): Promise<boolean> {
    await init('herumi');

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
      fromHexString(DOMAIN_VOLUNTARY_EXIT.substring(2)),
      capellaForkVersionString,
      fromHexString(genesisValidatorsRootString.substring(2)),
    );

    const messageSigningRoot = signingRoot(
      exitDomain,
      partialExitMessageBuffer,
    );

    return verify(
      fromHexString(publicShareKey.substring(2)),
      messageSigningRoot,
      fromHexString(signedExitMessage.signature.substring(2)),
    );
  }

  async verifyExitPayloadSignature(
    enrString: string,
    exitsPayload: ExitValidationPayload,
  ): Promise<boolean> {
    const partialExitsDtoHashRoot = Exit.computeExitPayloadRoot(exitsPayload);
    const ec = new elliptic.ec('secp256k1');

    let pubKeyHex;
    try {
      pubKeyHex = ENR.decodeTxt(enrString).publicKey.toString('hex');
    } catch (e: any) {
      throw new Error(
        `Invalid ENR string: ${enrString}. Error: ${e.message || String(e)}`,
      );
    }

    const sigHex = exitsPayload.signature.startsWith('0x')
      ? exitsPayload.signature.substring(2)
      : exitsPayload.signature;

    if (sigHex.length !== 128) {
      throw new Error(
        `Invalid signature length. Expected 128 hex chars (r + s), got ${sigHex.length}`,
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
        `Signature verification failed: ${e.message || String(e)}`,
      );
    }
  }

  async validateExitBlobs(
    clusterConfig: ExitClusterConfig,
    exitsPayload: ExitValidationPayload,
    beaconNodeApiUrl: string,
    getExistingBlobData: (
      publicKey: string,
    ) => Promise<ExistingExitValidationBlobData | null>,
  ): Promise<ExitValidationBlob[]> {
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

    const genesisValidatorsRootString = await getGenesisValidatorsRoot(
      clusterConfig.definition.fork_version,
      beaconNodeApiUrl,
      this.request, // Use this.request
    );
    if (!genesisValidatorsRootString) {
      throw new Error('Could not retrieve genesis validators root.');
    }

    const capellaForkVersionString = await getCapellaFork(
      clusterConfig.definition.fork_version,
    );
    if (!capellaForkVersionString) {
      throw new Error(
        `Unsupported network: Could not determine Capella fork for ${clusterConfig.definition.fork_version}`,
      );
    }

    const validNonDuplicateBlobs: ExitValidationBlob[] = [];

    for (const currentExitBlob of exitsPayload.partial_exits) {
      const validatorInCluster = clusterConfig.distributed_validators.find(
        dv =>
          (dv.distributed_public_key.startsWith('0x')
            ? dv.distributed_public_key
            : '0x' + dv.distributed_public_key
          ).toLowerCase() ===
          (currentExitBlob.public_key.startsWith('0x')
            ? currentExitBlob.public_key
            : '0x' + currentExitBlob.public_key
          ).toLowerCase(),
      );

      if (!validatorInCluster) {
        throw new Error(
          `Public key ${currentExitBlob.public_key} not found in the cluster's distributed validators.`,
        );
      }

      const publicShareForOperator =
        validatorInCluster.public_shares[operatorIndex];
      if (!publicShareForOperator) {
        throw new Error(
          `Public share for operator index ${operatorIndex} not found for validator ${currentExitBlob.public_key}`,
        );
      }

      const existingBlob = await getExistingBlobData(
        currentExitBlob.public_key,
      );
      let alreadyProcessed = false;

      if (existingBlob) {
        if (
          existingBlob.validator_index !==
          currentExitBlob.signed_exit_message.message.validator_index
        ) {
          throw new Error(
            `Validator index mismatch for already processed exit for public key ${currentExitBlob.public_key}. Expected ${existingBlob.validator_index}, got ${currentExitBlob.signed_exit_message.message.validator_index}.`,
          );
        }

        const currentEpoch = parseInt(
          currentExitBlob.signed_exit_message.message.epoch,
          10,
        );
        const existingEpoch = parseInt(existingBlob.epoch, 10);

        if (currentEpoch < existingEpoch) {
          throw new Error(
            `New exit epoch ${currentEpoch} is not greater than existing exit epoch ${existingEpoch} for validator ${currentExitBlob.public_key}.`,
          );
        } else if (currentEpoch === existingEpoch) {
          alreadyProcessed = true;
          const operatorShareIndexString = String(operatorIndex);
          if (
            existingBlob.shares_exit_data?.[0]?.[operatorShareIndexString]
              ?.partial_exit_signature &&
            existingBlob.shares_exit_data[0][operatorShareIndexString]
              .partial_exit_signature !==
              currentExitBlob.signed_exit_message.signature
          ) {
            throw new Error(
              `Signature mismatch for validator ${currentExitBlob.public_key}, operator index ${operatorIndex} at epoch ${currentEpoch}. Received different signature than existing.`,
            );
          }
        }
      }

      if (alreadyProcessed) {
        continue;
      }

      const isPartialSignatureValid = await this.verifyPartialExitSignature(
        publicShareForOperator,
        currentExitBlob.signed_exit_message,
        clusterConfig.definition.fork_version,
        genesisValidatorsRootString,
      );

      if (!isPartialSignatureValid) {
        throw new Error(
          `Invalid partial exit signature for validator ${currentExitBlob.public_key} by operator index ${operatorIndex}.`,
        );
      }

      validNonDuplicateBlobs.push(currentExitBlob);
    }
    return validNonDuplicateBlobs;
  }
}
