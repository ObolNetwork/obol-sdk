// verifyLock on synthetic locks with real keys: each edit must fail at its
// own step and validator, at both levels where the level checks it.
import { jest } from '@jest/globals';
import { fromHexString } from '@chainsafe/ssz';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { verifyLock } from '../../src/cluster/verifyLock.js';
import { offsetSignaturePair } from '../helpers/blsSignatures.js';
import {
  G1_IDENTITY,
  g1OutsideSubgroup,
  hex,
  syntheticLock,
} from '../helpers/syntheticLock.js';

jest.setTimeout(120_000);

const ls = bls12_381.longSignatures;
const G1 = bls12_381.G1.Point;
const G2 = bls12_381.G2.Point;

const VALIDATORS = 6;
const K = 4; // the validator most edits hit
const { lock: base, seal } = syntheticLock(VALIDATORS, 4, 3, [
  '1000000000',
  '31000000000',
]);
const copy = (): any => structuredClone(base);
/** A copy changed by `edit`, resealed so only the edited check fails. */
const edited = (edit: (lock: any) => void): any => {
  const lock = copy();
  edit(lock);
  return seal(lock);
};
const plusG2 = (signature: string): string =>
  hex(
    ls.Signature.toBytes(
      ls.Signature.fromBytes(fromHexString(signature)).add(G2.BASE),
    ),
  );
const quick = { yieldMs: 0 };

describe('cluster.verifyLock on synthetic locks', () => {
  it('passes at both levels', async () => {
    expect(await verifyLock(copy(), quick)).toEqual({
      ok: true,
      level: 'full',
    });
    expect(await verifyLock(copy(), { level: 'attested' })).toEqual({
      ok: true,
      level: 'attested',
    });
    expect(
      await verifyLock(copy(), { level: 'attested', signatures: 'all' }),
    ).toEqual({ ok: true, level: 'attested' });
  });

  it.each<[string, (lock: any) => void, object]>([
    [
      'swapped deposit signatures of two validators',
      l => {
        const d = l.distributed_validators;
        [
          d[K].partial_deposit_data[0].signature,
          d[K - 1].partial_deposit_data[0].signature,
        ] = [
          d[K - 1].partial_deposit_data[0].signature,
          d[K].partial_deposit_data[0].signature,
        ];
      },
      {
        step: 'deposit_data_invalid',
        issue: 'signature_invalid',
        validator: K - 1,
      },
    ],
    [
      'a deposit signature plus the G2 generator (second partial)',
      l => {
        const d = l.distributed_validators[K].partial_deposit_data[1];
        d.signature = plusG2(d.signature);
      },
      {
        step: 'deposit_data_invalid',
        issue: 'signature_invalid',
        validator: K,
      },
    ],
    [
      'two deposit signatures that cancel out',
      l => {
        const [a, b] = l.distributed_validators.map(
          (v: any) => v.partial_deposit_data[0],
        );
        [a.signature, b.signature] = offsetSignaturePair(
          a.signature,
          b.signature,
        );
      },
      {
        step: 'deposit_data_invalid',
        issue: 'signature_invalid',
        validator: 0,
      },
    ],
    [
      'a doubled builder signature',
      l => {
        const r = l.distributed_validators[K].builder_registration;
        r.signature = hex(
          ls.Signature.toBytes(
            ls.Signature.fromBytes(fromHexString(r.signature)).double(),
          ),
        );
      },
      {
        step: 'builder_registration_invalid',
        issue: 'signature_invalid',
        validator: K,
      },
    ],
  ])('signatures: %s', async (_name, edit, failure) => {
    const lock = edited(edit);
    const expected = { ok: false, ...failure };
    expect(await verifyLock(lock, quick)).toEqual({
      ...expected,
      level: 'full',
    });
    expect(
      await verifyLock(lock, { level: 'attested', signatures: 'all' }),
    ).toEqual({ ...expected, level: 'attested' });
  });

  it.each<[string, (lock: any) => void, object]>([
    [
      'the last (extra) share shifted by G',
      l => {
        const s = l.distributed_validators[K].public_shares;
        s[3] = hex(G1.fromBytes(fromHexString(s[3])).add(G1.BASE).toBytes());
      },
      { issue: 'share_reconstruction_failed', validator: K },
    ],
    [
      "the first share replaced by another validator's",
      l => {
        l.distributed_validators[K].public_shares[0] =
          l.distributed_validators[0].public_shares[0];
      },
      { issue: 'share_reconstruction_failed', validator: K },
    ],
    [
      'the extra share outside the subgroup',
      l => {
        l.distributed_validators[K].public_shares[3] = g1OutsideSubgroup();
      },
      { issue: 'share_reconstruction_failed', validator: K },
    ],
    [
      'the first share outside the subgroup',
      l => {
        l.distributed_validators[K].public_shares[0] = g1OutsideSubgroup();
      },
      { issue: 'malformed_share', validator: K },
    ],
    [
      'the extra share the identity',
      l => {
        l.distributed_validators[K].public_shares[3] = G1_IDENTITY;
      },
      { issue: 'malformed_share', validator: K },
    ],
    [
      'the group key outside the subgroup',
      l => {
        l.distributed_validators[K].distributed_public_key =
          g1OutsideSubgroup();
        for (const d of l.distributed_validators[K].partial_deposit_data) {
          d.pubkey = l.distributed_validators[K].distributed_public_key;
        }
        l.distributed_validators[K].builder_registration.message.pubkey =
          l.distributed_validators[K].distributed_public_key;
      },
      { issue: 'malformed_share', validator: K },
    ],
  ])('shares: %s', async (_name, edit, failure) => {
    const lock = edited(edit);
    expect(await verifyLock(lock, quick)).toEqual({
      ok: false,
      level: 'full',
      step: 'share_reconstruction_failed',
      ...failure,
    });
    // Attested does not decode shares: the node signatures vouch for them.
    expect(await verifyLock(lock, { level: 'attested' })).toEqual({
      ok: true,
      level: 'attested',
    });
  });

  it('a corrupted signature_aggregate fails full only', async () => {
    const lock = copy();
    lock.signature_aggregate = plusG2(lock.signature_aggregate);
    expect(await verifyLock(lock, quick)).toEqual({
      ok: false,
      level: 'full',
      step: 'lock_signature_invalid',
      issue: 'signature_aggregate_invalid',
    });
    expect(await verifyLock(lock, { level: 'attested' })).toMatchObject({
      ok: true,
    });
  });

  it('a changed lock_hash fails both levels', async () => {
    const lock = copy();
    lock.lock_hash = '0x' + '11'.repeat(32);
    for (const level of ['full', 'attested'] as const) {
      expect(await verifyLock(lock, { level })).toEqual({
        ok: false,
        level,
        step: 'hash_mismatch',
        issue: 'lock_hash',
      });
    }
  });

  it('node signatures over an edited lock fail attested', async () => {
    const lock = copy();
    lock.distributed_validators[K].partial_deposit_data[0].signature = plusG2(
      lock.distributed_validators[K].partial_deposit_data[0].signature,
    );
    lock.lock_hash = seal(structuredClone(lock)).lock_hash; // hash only
    expect(await verifyLock(lock, { level: 'attested' })).toEqual({
      ok: false,
      level: 'attested',
      step: 'lock_signature_invalid',
      issue: 'node_signature_invalid',
    });
  });

  it('attested checks the signatures of the chosen validators only', async () => {
    const lock = edited(l => {
      const d = l.distributed_validators[K].partial_deposit_data[0];
      d.signature = plusG2(d.signature);
    });
    expect(
      await verifyLock(lock, { level: 'attested', signatures: [K, 1, K] }),
    ).toEqual({
      ok: false,
      level: 'attested',
      step: 'deposit_data_invalid',
      issue: 'signature_invalid',
      validator: K,
    });
    expect(
      await verifyLock(lock, { level: 'attested', signatures: [0, 1] }),
    ).toEqual({ ok: true, level: 'attested' });
  });

  it('reports structural failures with the validator at both levels', async () => {
    const lock = edited(l => {
      l.distributed_validators[2].builder_registration.message.fee_recipient =
        '0x' + 'ab'.repeat(20);
    });
    for (const level of ['full', 'attested'] as const) {
      expect(await verifyLock(lock, { level })).toEqual({
        ok: false,
        level,
        step: 'builder_registration_invalid',
        issue: 'builder_registration_fields',
        validator: 2,
      });
    }
  });

  it('rejects bad options with PAYLOAD_INVALID', async () => {
    for (const options of [
      { signatures: [0] },
      { level: 'attested', signatures: [VALIDATORS] },
      { level: 'attested', signatures: [-1] },
      { level: 'quick' },
      { yieldMs: -1 },
      { bls: { verify: () => true } },
    ]) {
      await expect(verifyLock(copy(), options as any)).rejects.toMatchObject({
        code: 'PAYLOAD_INVALID',
      });
    }
  });

  it('yields to the event loop while it runs', async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    try {
      expect(await verifyLock(copy(), { yieldMs: 10 })).toMatchObject({
        ok: true,
      });
    } finally {
      clearInterval(timer);
    }
    expect(ticks).toBeGreaterThan(5);
  });
});
