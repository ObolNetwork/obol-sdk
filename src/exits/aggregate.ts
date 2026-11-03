import { Type } from '@sinclair/typebox';
import { fromHexString } from '@chainsafe/ssz';
import { bytesToHex, type Hex } from 'viem';
import { blsThresholdAggregateSignatures, blsVerify } from '../internal/bls.js';
import { ObolError } from '../errors.js';
import { decode, invalid, sameHex, T } from '../schema.js';
import { exitSigningRoot } from './ssz.js';
import {
  FullExitResponseSchema,
  StoredExitBlobSchema,
  type FullExitBlob,
  type FullExitResponse,
  type StoredExitBlob,
} from './types.js';
import {
  canonicalUint64,
  exitNetwork,
  storedShares,
} from './verifyPartialExit.js';

export const AggregateSchema = Type.Object({
  validator: Type.Object({
    distributedPublicKey: T.Pubkey,
    publicShares: Type.Array(T.Pubkey, { minItems: 1 }),
  }),
  exit: Type.Union([StoredExitBlobSchema, FullExitResponseSchema]),
  threshold: Type.Integer({ minimum: 1 }),
  chainId: Type.Integer({ minimum: 1 }),
});

export interface AggregateInput {
  /** The validator from the cluster lock: group key and public shares in operator order. */
  validator: { distributedPublicKey: string; publicShares: string[] };
  /** The stored exit (`exitblobs` document) or the API's full exit response. */
  exit: StoredExitBlob | FullExitResponse;
  threshold: number;
  /** The validator's chain (selects the exit domain). Set by the client. */
  chainId: number;
}

const BLS_SIGNATURE = /^0x[0-9a-fA-F]{192}$/;

/** Partial signatures by 0-based operator position; empty or missing ones left out. */
const partialsOf = (
  exit: StoredExitBlob | FullExitResponse,
): Map<number, string> => {
  const partials = new Map<number, string>();
  if ('signatures' in exit) {
    exit.signatures.forEach((signature, i) => {
      if (signature !== null && signature !== '') partials.set(i, signature);
    });
  } else {
    for (const [i, share] of storedShares(exit)) {
      if (share.partial_exit_signature !== '') {
        partials.set(i, share.partial_exit_signature);
      }
    }
  }
  return partials;
};

/**
 * Combines the partial exit signatures of a validator into its signed
 * voluntary exit, as Charon does:
 *
 * 1. each partial is checked against its operator's public share for the
 *    exit message (a malformed or invalid one is left out, so one bad stored
 *    share does not block the exit);
 * 2. at least `threshold` valid partials (else EXIT_NOT_ENOUGH_SHARES,
 *    listing the valid and invalid positions);
 * 3. threshold aggregation (Lagrange interpolation at 0, Charon
 *    `tbls.ThresholdAggregate`) over the first `threshold` valid partials by
 *    share index (position + 1);
 * 4. the result verifies against the validator's group key.
 *
 * A stored exit must be for `validator` (PAYLOAD_INVALID otherwise).
 *
 * @throws PAYLOAD_INVALID, UNSUPPORTED_CHAIN, EXIT_NOT_ENOUGH_SHARES,
 *   EXIT_PARTIAL_SIGNATURE_INVALID (the aggregate does not verify: the public
 *   shares do not belong to the group key).
 */
export const aggregate = (input: AggregateInput): FullExitBlob => {
  const { validator, exit, threshold, chainId } = decode(
    AggregateSchema,
    input,
  );
  const pubkey = validator.distributedPublicKey.toLowerCase() as Hex;
  if ('publickey' in exit && !sameHex(exit.publickey, pubkey)) {
    throw invalid(
      'exit.publickey',
      `is not the validator ${pubkey}`,
      'validator_mismatch',
    );
  }
  const message = {
    epoch: canonicalUint64(exit.epoch, 'exit.epoch'),
    validator_index: canonicalUint64(
      exit.validator_index,
      'exit.validator_index',
    ),
  };
  const network = exitNetwork(chainId, 'exits.aggregate');
  const root = exitSigningRoot(
    message,
    network.capellaForkVersion,
    network.genesisValidatorsRoot,
  );

  const valid: Array<[number, Uint8Array]> = [];
  const invalidShares: number[] = [];
  const positions = [...partialsOf(exit).entries()].sort(([a], [b]) => a - b);
  for (const [position, signature] of positions) {
    const share = validator.publicShares[position];
    let ok = false;
    if (share !== undefined && BLS_SIGNATURE.test(signature)) {
      const bytes = fromHexString(signature);
      ok = blsVerify(fromHexString(share), root, bytes);
      if (ok) valid.push([position + 1, bytes]);
    }
    if (!ok) invalidShares.push(position + 1);
  }
  if (valid.length < threshold) {
    throw new ObolError(
      'EXIT_NOT_ENOUGH_SHARES',
      `${valid.length} valid partial signatures for ${pubkey}, ${threshold} needed${
        invalidShares.length > 0
          ? ` (invalid: shares ${invalidShares.join(', ')})`
          : ''
      }`,
      {
        hint: 'Wait for more operators; re-collect the invalid shares',
        details: {
          pubkey,
          threshold,
          valid: valid.map(([index]) => index),
          invalid: invalidShares,
        },
      },
    );
  }

  const signature = blsThresholdAggregateSignatures(
    new Map(valid.slice(0, threshold)),
  );
  if (!blsVerify(fromHexString(pubkey), root, signature)) {
    throw new ObolError(
      'EXIT_PARTIAL_SIGNATURE_INVALID',
      `The aggregated exit signature does not verify against ${pubkey}`,
      {
        hint: 'Check that the public shares are the lock shares of this validator',
        details: { pubkey },
      },
    );
  }
  return {
    public_key: pubkey,
    signed_exit_message: { message, signature: bytesToHex(signature) },
  };
};
