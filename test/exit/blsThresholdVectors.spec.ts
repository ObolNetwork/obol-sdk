// Runs the BLS threshold test vectors from ObolNetwork/distributed-validator-specs
// (test/fixtures/spec/bls_threshold.json, see test/fixtures/spec/README.md)
// against the SDK's threshold signature aggregation and exit recombination.
import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { fromHexString } from '@chainsafe/ssz';
import {
  blsAggregateSignatures,
  blsThresholdAggregateSignatures,
  blsVerify,
} from '../../src/blsUtils.js';
import { Exit } from '../../src/exits/exit.js';

type Partial = {
  name: string;
  input: { share_idx: number; secret_hex: string };
  pubshare_hex: string;
  signature_hex: string;
};

type AggregateCase = {
  name: string;
  input: { share_indices: number[] };
  signature_hex: string;
};

const vectors = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../fixtures/spec/bls_threshold.json',
    ),
    'utf8',
  ),
) as {
  message_hex: string;
  group_pubkey_hex: string;
  group_signature_hex: string;
  partials: Partial[];
  threshold_aggregates: AggregateCase[];
  plain_aggregate: AggregateCase[];
};

const message = fromHexString(vectors.message_hex);
const groupPubkey = fromHexString(vectors.group_pubkey_hex);
const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const partialByShareIdx = new Map(
  vectors.partials.map(p => [p.input.share_idx, p]),
);

const partialFor = (shareIdx: number): Partial => {
  const partial = partialByShareIdx.get(shareIdx);
  if (!partial) throw new Error(`no partial for share ${shareIdx}`);
  return partial;
};

const signaturesFor = (shareIndices: number[]): Map<number, Uint8Array> =>
  new Map(
    shareIndices.map(idx => [
      idx,
      fromHexString(partialFor(idx).signature_hex),
    ]),
  );

describe('bls_threshold spec vectors', () => {
  it('has threshold aggregate cases', () => {
    expect(vectors.threshold_aggregates.length).toBeGreaterThan(0);
  });

  it.each(vectors.partials.map(p => [p.name, p] as const))(
    'partial %s verifies against its public share',
    (_name, partial) => {
      expect(
        blsVerify(
          fromHexString(partial.pubshare_hex),
          message,
          fromHexString(partial.signature_hex),
        ),
      ).toBe(true);
    },
  );

  describe('blsThresholdAggregateSignatures', () => {
    it.each(vectors.threshold_aggregates.map(c => [c.name, c] as const))(
      '%s',
      (_name, testCase) => {
        const sig = blsThresholdAggregateSignatures(
          signaturesFor(testCase.input.share_indices),
        );
        expect(toHex(sig)).toBe(testCase.signature_hex);
        expect(blsVerify(groupPubkey, message, sig)).toBe(true);
      },
    );

    it('is independent of insertion order', () => {
      const sig = blsThresholdAggregateSignatures(signaturesFor([4, 1, 3]));
      expect(toHex(sig)).toBe(vectors.group_signature_hex);
    });

    it('recovers the group signature from all four shares', () => {
      const sig = blsThresholdAggregateSignatures(signaturesFor([1, 2, 3, 4]));
      expect(toHex(sig)).toBe(vectors.group_signature_hex);
    });

    it('does not verify with fewer than threshold shares', () => {
      const sig = blsThresholdAggregateSignatures(signaturesFor([1, 2]));
      expect(blsVerify(groupPubkey, message, sig)).toBe(false);
    });

    it('does not verify when a share is assigned the wrong index', () => {
      const sigs = signaturesFor([1, 2, 3]);
      const wrong = new Map([
        [1, sigs.get(1) as Uint8Array],
        [2, sigs.get(2) as Uint8Array],
        [4, sigs.get(3) as Uint8Array],
      ]);
      const sig = blsThresholdAggregateSignatures(wrong);
      expect(blsVerify(groupPubkey, message, sig)).toBe(false);
    });

    it('differs from plain aggregation, which does not verify', () => {
      for (const testCase of vectors.plain_aggregate) {
        const plain = blsAggregateSignatures([
          ...signaturesFor(testCase.input.share_indices).values(),
        ]);
        expect(toHex(plain)).toBe(testCase.signature_hex);
        expect(toHex(plain)).not.toBe(vectors.group_signature_hex);
        expect(blsVerify(groupPubkey, message, plain)).toBe(false);
      }
    });

    it.each([0, -1, 1.5, Number.NaN])('rejects share index %p', idx => {
      const sigs = signaturesFor([1, 2]);
      sigs.set(idx, fromHexString(partialFor(3).signature_hex));
      expect(() => blsThresholdAggregateSignatures(sigs)).toThrow(
        'invalid share index',
      );
    });

    it('rejects an empty set', () => {
      expect(() => blsThresholdAggregateSignatures(new Map())).toThrow(
        'empty signature set',
      );
    });

    it('rejects a signature that is not a G2 point', () => {
      const sigs = signaturesFor([1, 2]);
      sigs.set(3, new Uint8Array(96).fill(0xff));
      expect(() => blsThresholdAggregateSignatures(sigs)).toThrow();
    });
  });

  describe('Exit.recombineExitBlobs', () => {
    const exit = new Exit(1, null);

    it.each(vectors.threshold_aggregates.map(c => [c.name, c] as const))(
      '%s',
      async (_name, testCase) => {
        // shares_exit_data is keyed by 0-based operator index
        const shares: Record<string, { partial_exit_signature: string }> = {};
        for (const idx of testCase.input.share_indices) {
          shares[String(idx - 1)] = {
            partial_exit_signature: '0x' + partialFor(idx).signature_hex,
          };
        }
        const result = await exit.recombineExitBlobs({
          public_key: '0x' + vectors.group_pubkey_hex,
          epoch: '1',
          validator_index: '1',
          shares_exit_data: [shares],
        });
        const sig = result.signed_exit_message.signature;
        expect(sig).toBe('0x' + testCase.signature_hex);
        expect(blsVerify(groupPubkey, message, fromHexString(sig))).toBe(true);
      },
    );
  });
});
