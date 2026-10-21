import { ENR } from '@chainsafe/enr';
import { Type } from '@sinclair/typebox';
import { fromHexString } from '@chainsafe/ssz';
import type { Hex } from 'viem';
import { blsVerify } from '../internal/bls.js';
import { secp256k1VerifyDigest } from '../internal/secp256k1.js';
import { CHAINS, chainIdForForkVersion } from '../chains.js';
import { ObolError, type ObolErrorOptions } from '../errors.js';
import { decode, invalid, sameHex, T } from '../schema.js';
import { MAX_UINT64 } from '../units.js';
import {
  exitSigningRoot,
  partialExitsPayloadRoot,
  sortedPartialExits,
} from './ssz.js';
import {
  PartialExitsPayloadSchema,
  StoredExitBlobSchema,
  type PartialExitBlob,
  type PartialExitsPayload,
  type ShareExitData,
  type StoredExitBlob,
} from './types.js';

export const ForkVersion = Type.String({
  pattern: '^0x[0-9a-fA-F]{8}$',
  description: 'fork version (4 bytes)',
});

const ClusterSchema = Type.Object({
  operators: Type.Array(Type.Object({ enr: Type.String() })),
  forkVersion: ForkVersion,
  validators: Type.Array(
    Type.Object({
      distributedPublicKey: T.Pubkey,
      publicShares: Type.Array(T.Pubkey),
    }),
  ),
});

export const VerifyPartialExitSchema = Type.Object({
  cluster: ClusterSchema,
  payload: PartialExitsPayloadSchema,
  existing: Type.Optional(
    Type.Union([
      Type.Array(StoredExitBlobSchema),
      Type.Record(Type.String(), StoredExitBlobSchema),
    ]),
  ),
});

/** The parts of a cluster lock exit verification needs. */
export interface ExitCluster {
  /** In lock order: operator `share_idx` is `operators[share_idx - 1]`. */
  operators: Array<{ enr: string }>;
  /** The lock's genesis fork version (selects the chain). */
  forkVersion: string;
  validators: Array<{ distributedPublicKey: string; publicShares: string[] }>;
}

export interface VerifyPartialExitInput {
  cluster: ExitCluster;
  /** The operator's submission, as the Obol API receives it. */
  payload: PartialExitsPayload;
  /**
   * The exits already stored for the cluster's validators, as the Obol API
   * stores them: a list, or a map keyed by pubkey. Every blob's pubkey is
   * looked up here.
   */
  existing?: StoredExitBlob[] | Record<string, StoredExitBlob>;
}

const exitError = <
  C extends
    | 'EXIT_SHARE_INDEX_INVALID'
    | 'EXIT_PAYLOAD_SIGNATURE_INVALID'
    | 'EXIT_VALIDATOR_NOT_IN_CLUSTER'
    | 'EXIT_VALIDATOR_INDEX_MISMATCH'
    | 'EXIT_EPOCH_MISMATCH'
    | 'EXIT_SIGNATURE_CONFLICT'
    | 'EXIT_PARTIAL_SIGNATURE_INVALID',
>(
  code: C,
  message: string,
  details: ObolError<C>['details'],
): ObolError<C> =>
  new ObolError<C>(
    code,
    message,
    ...([{ hint: 'Reject the payload', details }] as unknown as [
      ObolErrorOptions<C>,
    ]),
  );

/**
 * A uint64 decimal string in canonical form (no leading zeros); PAYLOAD_INVALID
 * when it does not fit in uint64. The schema has checked the digits.
 */
export const canonicalUint64 = (value: string, path: string): string => {
  const n = BigInt(value);
  if (n > MAX_UINT64) throw invalid(path, 'must fit in uint64');
  return n.toString();
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

/**
 * The stored shares of an exit, by 0-based operator position. The Obol API
 * may expose `shares_exit_data` wrapped in an array; the entries are merged.
 */
export const storedShares = (
  stored: StoredExitBlob,
): Map<number, ShareExitData> => {
  const groups = Array.isArray(stored.shares_exit_data)
    ? stored.shares_exit_data
    : [stored.shares_exit_data];
  const shares = new Map<number, ShareExitData>();
  for (const group of groups) {
    for (const [key, share] of Object.entries(group)) {
      shares.set(Number(key), share);
    }
  }
  return shares;
};

const storedByPubkey = (
  existing: VerifyPartialExitInput['existing'],
): Map<string, StoredExitBlob> => {
  const list =
    existing === undefined
      ? []
      : Array.isArray(existing)
        ? existing
        : Object.values(existing);
  return new Map(list.map(blob => [blob.publickey.toLowerCase(), blob]));
};

const normalizeBlob = (
  blob: PartialExitBlob,
  path: string,
): PartialExitBlob => {
  const { message, signature } = blob.signed_exit_message;
  return {
    public_key: blob.public_key.toLowerCase(),
    signed_exit_message: {
      message: {
        epoch: canonicalUint64(message.epoch, `${path}.message.epoch`),
        validator_index: canonicalUint64(
          message.validator_index,
          `${path}.message.validator_index`,
        ),
      },
      signature: signature.toLowerCase(),
    },
  };
};

/**
 * Verifies an operator's partial exits payload, as the Obol API does before
 * storing it:
 *
 * 1. `share_idx` is between 1 and the number of operators;
 * 2. the payload signature is 65 bytes and is by operator `share_idx`'s ENR
 *    key over the payload's SSZ root, with `partial_exits` sorted by
 *    validator index (high-s accepted, as the API does);
 * 3. the cluster's `forkVersion` is a chain with a known Capella fork
 *    version and genesis validators root (mainnet, Hoodi);
 * 4. each blob's pubkey is a cluster validator with a public share at
 *    `share_idx`;
 * 5. against the stored exit for the same pubkey: the same validator index
 *    and the same epoch; a stored partial for this share must be the same
 *    signature (then the blob is dropped as already stored);
 * 6. each partial signature verifies against the public share for the exit
 *    message in the EIP-7044 exit domain.
 *
 * Decimal strings with leading zeros are accepted and returned canonical.
 *
 * @returns The blobs not stored yet, normalised (lowercase hex, canonical
 *   decimals), sorted by validator index.
 * @throws PAYLOAD_INVALID (also for an unparsable ENR or a value above
 *   uint64), UNSUPPORTED_CHAIN, EXIT_SHARE_INDEX_INVALID,
 *   EXIT_PAYLOAD_SIGNATURE_INVALID, EXIT_VALIDATOR_NOT_IN_CLUSTER,
 *   EXIT_VALIDATOR_INDEX_MISMATCH, EXIT_EPOCH_MISMATCH,
 *   EXIT_SIGNATURE_CONFLICT, EXIT_PARTIAL_SIGNATURE_INVALID.
 */
export const verifyPartialExit = (
  input: VerifyPartialExitInput,
): PartialExitBlob[] => {
  const { cluster, payload, existing } = decode(VerifyPartialExitSchema, input);
  const blobs = payload.partial_exits.map((blob, i) =>
    normalizeBlob(blob, `payload.partial_exits[${i}].signed_exit_message`),
  );
  const stored = storedByPubkey(existing);
  for (const [pubkey, blob] of stored) {
    canonicalUint64(blob.epoch, `existing[${pubkey}].epoch`);
    canonicalUint64(
      blob.validator_index,
      `existing[${pubkey}].validator_index`,
    );
  }

  const shareIdx = payload.share_idx;
  if (shareIdx < 1 || shareIdx > cluster.operators.length) {
    throw exitError(
      'EXIT_SHARE_INDEX_INVALID',
      `share_idx ${shareIdx} is not between 1 and ${cluster.operators.length}`,
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
  if (
    payload.signature.length !== 2 + 65 * 2 ||
    !secp256k1VerifyDigest(
      enrKey,
      partialExitsPayloadRoot(blobs, shareIdx),
      payload.signature,
      { lowS: false },
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

  const fresh: PartialExitBlob[] = [];
  for (const blob of sortedPartialExits(blobs)) {
    const { message, signature } = blob.signed_exit_message;
    const pubkey = blob.public_key as Hex;
    const validator = cluster.validators.find(v =>
      sameHex(v.distributedPublicKey, pubkey),
    );
    if (validator === undefined) {
      throw exitError(
        'EXIT_VALIDATOR_NOT_IN_CLUSTER',
        `${pubkey} is not a validator of the cluster`,
        { pubkey },
      );
    }
    const publicShare = validator.publicShares[shareIdx - 1];
    if (publicShare === undefined) {
      throw exitError(
        'EXIT_SHARE_INDEX_INVALID',
        `No public share ${shareIdx} for validator ${pubkey}`,
        { shareIdx, pubkey },
      );
    }

    const previous = stored.get(pubkey);
    if (previous !== undefined) {
      const storedIndex = BigInt(previous.validator_index).toString();
      if (storedIndex !== message.validator_index) {
        throw exitError(
          'EXIT_VALIDATOR_INDEX_MISMATCH',
          `Validator index ${message.validator_index} differs from the stored ${storedIndex} for ${pubkey}`,
          {
            pubkey,
            validatorIndex: message.validator_index,
            storedValidatorIndex: storedIndex,
          },
        );
      }
      const storedEpoch = BigInt(previous.epoch).toString();
      if (storedEpoch !== message.epoch) {
        throw exitError(
          'EXIT_EPOCH_MISMATCH',
          `Exit epoch ${message.epoch} differs from the stored ${storedEpoch} for ${pubkey}`,
          { pubkey, epoch: message.epoch, storedEpoch },
        );
      }
      const share = storedShares(previous).get(shareIdx - 1);
      if (share !== undefined && share.partial_exit_signature !== '') {
        if (!sameHex(share.partial_exit_signature, signature)) {
          throw exitError(
            'EXIT_SIGNATURE_CONFLICT',
            `A different partial signature is stored for share ${shareIdx} of ${pubkey}`,
            { pubkey, shareIdx },
          );
        }
        continue;
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
        `Invalid partial exit signature by share ${shareIdx} for ${pubkey}`,
        { pubkey, shareIdx },
      );
    }
    fresh.push(blob);
  }
  return fresh;
};
