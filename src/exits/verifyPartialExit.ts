import { ENR } from '@chainsafe/enr';
import { Type } from '@sinclair/typebox';
import { fromHexString } from '@chainsafe/ssz';
import { blsVerify } from '../internal/bls.js';
import { secp256k1VerifyDigest } from '../internal/secp256k1.js';
import { CHAINS, chainIdForForkVersion } from '../chains.js';
import { ObolError } from '../errors.js';
import { decode, invalid, T } from '../schema.js';
import { MAX_UINT64 } from '../units.js';
import { exitSigningRoot, partialExitsPayloadRoot } from './ssz.js';
import {
  ExistingExitSchema,
  ExitBlobSchema,
  type ExitBlob,
  type ExistingExit,
  type ExitMessage,
} from './types.js';

export const ForkVersion = Type.String({
  pattern: '^0x[0-9a-fA-F]{8}$',
  description: 'fork version (4 bytes)',
});

const VerifyPartialExitSchema = Type.Object({
  cluster: Type.Object({
    operators: Type.Array(Type.Object({ enr: Type.String() })),
    forkVersion: ForkVersion,
    threshold: T.Uint,
    validators: Type.Array(
      Type.Object({
        distributedPublicKey: T.Pubkey,
        publicShares: Type.Array(T.Pubkey),
      }),
    ),
  }),
  payload: Type.Object({
    shareIdx: T.Uint,
    partialExits: Type.Array(ExitBlobSchema),
    signature: T.Hex,
  }),
  existing: Type.Optional(ExistingExitSchema),
});

export interface VerifyPartialExitInput {
  cluster: {
    operators: Array<{ enr: string }>;
    forkVersion: string;
    threshold: number;
    validators: Array<{ distributedPublicKey: string; publicShares: string[] }>;
  };
  payload: { shareIdx: number; partialExits: ExitBlob[]; signature: string };
  existing?: ExistingExit;
}

const exitError = (
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): ObolError =>
  new ObolError(code, message, { hint: 'Reject the payload', details });

/** Checks epoch and validator index fit in uint64 (the schema checks digits only). */
export const checkUint64 = (message: ExitMessage, path: string): void => {
  if (BigInt(message.epoch) > MAX_UINT64) {
    throw invalid(`${path}.epoch`, 'must fit in uint64');
  }
  if (BigInt(message.validatorIndex) > MAX_UINT64) {
    throw invalid(`${path}.validatorIndex`, 'must fit in uint64');
  }
};

/**
 * The exit domain inputs of a chain. Since EIP-7044 (Deneb) voluntary exits
 * are always signed with the Capella fork version and the chain's genesis
 * validators root, so both come from the chain table.
 *
 * @throws UNSUPPORTED_CHAIN for a chain without them.
 */
export const exitNetwork = (
  chainId: number | null,
  operation: string,
): { capellaForkVersion: string; genesisValidatorsRoot: string } => {
  const chain = chainId === null ? undefined : CHAINS[chainId];
  if (chain?.genesisValidatorsRoot === undefined) {
    throw new ObolError(
      'UNSUPPORTED_CHAIN',
      `Exits are not supported on chain ${String(chainId)}`,
      {
        hint: 'Use mainnet (1) or Hoodi (560048)',
        details: { chainId, operation },
      },
    );
  }
  return {
    capellaForkVersion: chain.capellaForkVersion,
    genesisValidatorsRoot: chain.genesisValidatorsRoot,
  };
};

const sameHex = (a: string, b: string): boolean =>
  a.toLowerCase() === b.toLowerCase();

/**
 * Verifies an operator's partial exits payload, as the Obol API does before
 * storing it:
 *
 * 1. `shareIdx` is between 1 and the number of operators;
 * 2. the payload signature (secp256k1, 64 or 65 bytes) over the payload's
 *    SSZ root is by operator `shareIdx`'s ENR key;
 * 3. the cluster's `forkVersion` is a chain with a known Capella fork
 *    version and genesis validators root (mainnet, Hoodi);
 * 4. each blob's pubkey is a cluster validator with a public share at
 *    `shareIdx`;
 * 5. against `existing` for the same pubkey: same validator index, epoch not
 *    lower, and at the same epoch no different stored signature for this
 *    share (the same one is dropped as already stored);
 * 6. each partial signature verifies against the public share for the exit
 *    message in the EIP-7044 exit domain.
 *
 * @returns The blobs not stored yet.
 * @throws PAYLOAD_INVALID (also for an unparsable ENR), UNSUPPORTED_CHAIN,
 *   EXIT_SHARE_INDEX_INVALID, EXIT_PAYLOAD_SIGNATURE_INVALID,
 *   EXIT_VALIDATOR_NOT_IN_CLUSTER, EXIT_VALIDATOR_INDEX_MISMATCH,
 *   EXIT_EPOCH_REGRESSION, EXIT_SIGNATURE_CONFLICT,
 *   EXIT_PARTIAL_SIGNATURE_INVALID.
 */
export const verifyPartialExit = (
  input: VerifyPartialExitInput,
): ExitBlob[] => {
  const { cluster, payload, existing } = decode(VerifyPartialExitSchema, input);
  payload.partialExits.forEach((blob, i) => {
    checkUint64(
      blob.signedExitMessage.message,
      `payload.partialExits[${i}].signedExitMessage.message`,
    );
  });
  if (existing !== undefined) checkUint64(existing, 'existing');

  const { shareIdx } = payload;
  if (shareIdx < 1 || shareIdx > cluster.operators.length) {
    throw exitError(
      'EXIT_SHARE_INDEX_INVALID',
      `shareIdx ${shareIdx} is not between 1 and ${cluster.operators.length}`,
      { shareIdx },
    );
  }

  let enrKey: Uint8Array;
  try {
    enrKey = ENR.decodeTxt(cluster.operators[shareIdx - 1].enr).publicKey;
  } catch {
    throw invalid(
      `cluster.operators[${shareIdx - 1}].enr`,
      'must be a valid ENR',
    );
  }
  const signatureBytes = (payload.signature.length - 2) / 2;
  if (
    (signatureBytes !== 64 && signatureBytes !== 65) ||
    !secp256k1VerifyDigest(
      enrKey,
      partialExitsPayloadRoot(payload.partialExits, shareIdx),
      payload.signature,
    )
  ) {
    throw exitError(
      'EXIT_PAYLOAD_SIGNATURE_INVALID',
      `The payload is not signed by operator ${shareIdx}'s ENR key`,
      { shareIdx },
    );
  }

  const network = exitNetwork(
    chainIdForForkVersion(cluster.forkVersion),
    'exits.verifyPartialExit',
  );

  const fresh: ExitBlob[] = [];
  for (const blob of payload.partialExits) {
    const { message, signature } = blob.signedExitMessage;
    const validator = cluster.validators.find(v =>
      sameHex(v.distributedPublicKey, blob.publicKey),
    );
    if (validator === undefined) {
      throw exitError(
        'EXIT_VALIDATOR_NOT_IN_CLUSTER',
        `${blob.publicKey} is not a validator of the cluster`,
        { pubkey: blob.publicKey },
      );
    }
    const publicShare = validator.publicShares[shareIdx - 1];
    if (publicShare === undefined) {
      throw exitError(
        'EXIT_SHARE_INDEX_INVALID',
        `No public share ${shareIdx} for validator ${blob.publicKey}`,
        { shareIdx, pubkey: blob.publicKey },
      );
    }

    if (existing !== undefined && sameHex(existing.publicKey, blob.publicKey)) {
      if (existing.validatorIndex !== message.validatorIndex) {
        throw exitError(
          'EXIT_VALIDATOR_INDEX_MISMATCH',
          `Validator index ${message.validatorIndex} differs from the stored ${existing.validatorIndex} for ${blob.publicKey}`,
          { pubkey: blob.publicKey },
        );
      }
      const epoch = BigInt(message.epoch);
      const storedEpoch = BigInt(existing.epoch);
      if (epoch < storedEpoch) {
        throw exitError(
          'EXIT_EPOCH_REGRESSION',
          `Exit epoch ${epoch} is lower than the stored ${storedEpoch} for ${blob.publicKey}`,
          { pubkey: blob.publicKey },
        );
      }
      if (epoch === storedEpoch) {
        const stored = existing.partialSignatures[String(shareIdx - 1)] ?? '';
        if (stored !== '') {
          if (!sameHex(stored, signature)) {
            throw exitError(
              'EXIT_SIGNATURE_CONFLICT',
              `A different partial signature is stored for share ${shareIdx} of ${blob.publicKey} at epoch ${epoch}`,
              { pubkey: blob.publicKey, shareIdx },
            );
          }
          continue;
        }
      }
    }

    const root = exitSigningRoot(
      message,
      network.capellaForkVersion,
      network.genesisValidatorsRoot,
    );
    if (
      !blsVerify(fromHexString(publicShare), root, fromHexString(signature))
    ) {
      throw exitError(
        'EXIT_PARTIAL_SIGNATURE_INVALID',
        `Invalid partial exit signature by share ${shareIdx} for ${blob.publicKey}`,
        { pubkey: blob.publicKey, shareIdx },
      );
    }
    fresh.push(blob);
  }
  return fresh;
};
