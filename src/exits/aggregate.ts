import { Type } from '@sinclair/typebox';
import { fromHexString } from '@chainsafe/ssz';
import { bytesToHex, type Hex } from 'viem';
import { blsThresholdAggregateSignatures, blsVerify } from '../internal/bls.js';
import { ObolError } from '../errors.js';
import { decode } from '../schema.js';
import { exitSigningRoot } from './ssz.js';
import {
  ExistingExitSchema,
  type ExistingExit,
  type SignedExit,
} from './types.js';
import { checkUint64, exitNetwork } from './verifyPartialExit.js';

const AggregateSchema = Type.Object({
  existing: ExistingExitSchema,
  threshold: Type.Integer({ minimum: 1 }),
  chainId: Type.Integer({ minimum: 1 }),
});

export interface AggregateInput {
  existing: ExistingExit;
  threshold: number;
  /** The validator's chain (selects the exit domain). Set by the client. */
  chainId: number;
}

const BLS_SIGNATURE = /^0x[0-9a-fA-F]{192}$/;

/**
 * Combines the stored partial exit signatures of a validator into its
 * signed voluntary exit:
 *
 * 1. stored signatures are 96-byte hex (empty entries are ignored);
 * 2. there are at least `threshold` of them;
 * 3. threshold aggregation (Lagrange interpolation at 0, as Charon
 *    `tbls.ThresholdAggregate`) over the first `threshold` by share index
 *    (stored key + 1);
 * 4. the result verifies against the validator's group pubkey for the exit
 *    message.
 *
 * @throws PAYLOAD_INVALID, UNSUPPORTED_CHAIN, EXIT_SIGNATURE_MALFORMED,
 *   EXIT_NOT_ENOUGH_SHARES, EXIT_PARTIAL_SIGNATURE_INVALID.
 */
export const aggregate = (input: AggregateInput): SignedExit => {
  const { existing, threshold, chainId } = decode(AggregateSchema, input);
  checkUint64(existing, 'existing');
  const network = exitNetwork(chainId, 'exits.aggregate');

  const partials: Array<[number, Uint8Array]> = [];
  for (const [key, signature] of Object.entries(existing.partialSignatures)) {
    if (signature === '') continue;
    if (!BLS_SIGNATURE.test(signature)) {
      throw new ObolError(
        'EXIT_SIGNATURE_MALFORMED',
        `The stored partial signature of share ${Number(key) + 1} is not 96 bytes of hex`,
        {
          hint: 'Drop or re-collect that partial',
          details: { shareIdx: Number(key) + 1 },
        },
      );
    }
    partials.push([Number(key) + 1, fromHexString(signature)]);
  }
  if (partials.length < threshold) {
    throw new ObolError(
      'EXIT_NOT_ENOUGH_SHARES',
      `${partials.length} partial signatures, ${threshold} needed`,
      { hint: 'Wait for more operators' },
    );
  }
  const quorum = partials.sort(([a], [b]) => a - b).slice(0, threshold);

  let signature: Uint8Array;
  try {
    signature = blsThresholdAggregateSignatures(new Map(quorum));
  } catch (cause) {
    throw new ObolError(
      'EXIT_SIGNATURE_MALFORMED',
      'A stored partial signature is not a valid BLS signature',
      { hint: 'Drop or re-collect the stored partials', cause },
    );
  }

  const message = {
    epoch: existing.epoch,
    validatorIndex: existing.validatorIndex,
  };
  const root = exitSigningRoot(
    message,
    network.capellaForkVersion,
    network.genesisValidatorsRoot,
  );
  if (!blsVerify(fromHexString(existing.publicKey), root, signature)) {
    throw new ObolError(
      'EXIT_PARTIAL_SIGNATURE_INVALID',
      `The aggregated exit signature does not verify against ${existing.publicKey}`,
      { hint: 'Re-check the stored partial signatures' },
    );
  }
  return {
    publicKey: existing.publicKey.toLowerCase() as Hex,
    signedExitMessage: { message, signature: bytesToHex(signature) },
  };
};
