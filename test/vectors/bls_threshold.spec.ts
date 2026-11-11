// distributed-validator-specs bls_threshold.json through the v3 BLS helpers.
import { readFileSync } from 'node:fs';
import type { Hex } from 'viem';
import {
  blsAggregate,
  blsRecoverPubkey,
  blsThresholdAggregate,
  blsVerify,
} from '../../src/exits/index.js';

const suite = JSON.parse(
  readFileSync('test/fixtures/spec/bls_threshold.json', 'utf8'),
);
const hex = (bare: string): Hex => `0x${bare}`;
const message = hex(suite.message_hex);
const groupPubkey = hex(suite.group_pubkey_hex);
const partial = (idx: number): any =>
  suite.partials.find((p: any) => p.input.share_idx === idx);

describe('vectors bls_threshold', () => {
  it.each<[string, any]>(suite.partials.map((p: any) => [p.name, p]))(
    'partials %s verifies against its public share',
    (_name, p) => {
      expect(
        blsVerify(hex(p.pubshare_hex), message, hex(p.signature_hex)),
      ).toBe(true);
    },
  );

  it('the group signature verifies against the group key', () => {
    expect(
      blsVerify(groupPubkey, message, hex(suite.group_signature_hex)),
    ).toBe(true);
  });

  it.each<[string, any]>(
    suite.threshold_aggregates.map((c: any) => [c.name, c]),
  )('threshold_aggregates %s', (_name, c) => {
    const signature = blsThresholdAggregate(
      c.input.share_indices.map((index: number) => ({
        index,
        signature: hex(partial(index).signature_hex),
      })),
    );
    expect(signature).toBe(hex(c.signature_hex));
    expect(blsVerify(groupPubkey, message, signature)).toBe(true);
  });

  it.each<[string, any]>(suite.recovery.map((c: any) => [c.name, c]))(
    'recovery %s',
    (_name, c) => {
      expect(
        blsRecoverPubkey(
          c.input.share_indices.map((index: number) => ({
            index,
            pubshare: hex(partial(index).pubshare_hex),
          })),
        ),
      ).toBe(hex(c.pubkey_hex));
    },
  );

  it.each<[string, any]>(suite.plain_aggregate.map((c: any) => [c.name, c]))(
    'plain_aggregate %s (not a group signature)',
    (_name, c) => {
      const signature = blsAggregate(
        c.input.share_indices.map((index: number) =>
          hex(partial(index).signature_hex),
        ),
      );
      expect(signature).toBe(hex(c.signature_hex));
      expect(blsVerify(groupPubkey, message, signature)).toBe(false);
    },
  );
});
