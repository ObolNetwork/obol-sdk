// The pure-JS backend against @chainsafe/blst (test-only devDependency,
// through the adapter documented on BlsBackend): same verdicts on random
// synthetic locks and edits of them.
import { jest } from '@jest/globals';
import { fromHexString } from '@chainsafe/ssz';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { nobleBls, type BlsBackend } from '../../src/cluster/blsBackend.js';
import { verifyLock } from '../../src/cluster/verifyLock.js';
import { blstBackend } from '../helpers/blstBackend.js';
import { offsetSignaturePair } from '../helpers/blsSignatures.js';
import {
  G1_IDENTITY,
  hex,
  randomScalar,
  syntheticLock,
} from '../helpers/syntheticLock.js';

jest.setTimeout(300_000);

const ls = bls12_381.longSignatures;
const G1 = bls12_381.G1.Point;
const G2 = bls12_381.G2.Point;
const pick = (n: number): number => Math.floor(Math.random() * n);

const plusG2 = (signature: string): string =>
  hex(
    ls.Signature.toBytes(
      ls.Signature.fromBytes(fromHexString(signature)).add(G2.BASE),
    ),
  );

type Edit = (lock: any) => void;
const EDITS: Array<[string, Edit]> = [
  ['none', () => {}],
  [
    'share + G',
    l => {
      const v = l.distributed_validators[pick(l.distributed_validators.length)];
      const j = pick(v.public_shares.length);
      v.public_shares[j] = hex(
        G1.fromBytes(fromHexString(v.public_shares[j])).add(G1.BASE).toBytes(),
      );
    },
  ],
  [
    'identity share',
    l => {
      const v = l.distributed_validators[pick(l.distributed_validators.length)];
      v.public_shares[pick(v.public_shares.length)] = G1_IDENTITY;
    },
  ],
  [
    'deposit signature + G2',
    l => {
      const v = l.distributed_validators[pick(l.distributed_validators.length)];
      const d = v.partial_deposit_data[pick(v.partial_deposit_data.length)];
      d.signature = plusG2(d.signature);
    },
  ],
  [
    'cancelling deposit pair',
    l => {
      const [a, b] = [0, 1].map(
        i => l.distributed_validators[i].partial_deposit_data[0],
      );
      [a.signature, b.signature] = offsetSignaturePair(
        a.signature,
        b.signature,
      );
    },
  ],
  [
    'builder signature + G2',
    l => {
      const r =
        l.distributed_validators[pick(l.distributed_validators.length)]
          .builder_registration;
      r.signature = plusG2(r.signature);
    },
  ],
  [
    'signature_aggregate + G2',
    l => {
      l.signature_aggregate = plusG2(l.signature_aggregate);
    },
  ],
];

const verdict = async (
  lock: any,
  bls: BlsBackend,
  level: 'full' | 'attested',
) =>
  await verifyLock(structuredClone(lock), {
    bls,
    level,
    ...(level === 'attested' ? { signatures: 'all' as const } : {}),
    yieldMs: 0,
  });

describe('nobleBls against @chainsafe/blst', () => {
  const shapes: Array<[number, number, number, string[]]> = [
    [4, 4, 3, ['32000000000']],
    [3, 7, 5, ['1000000000', '31000000000']],
    [2, 10, 7, ['32000000000']],
  ];

  it.each(shapes)(
    '%i validators, %i operators, threshold %i',
    async (validators, operators, threshold, amounts) => {
      const { lock, seal } = syntheticLock(
        validators,
        operators,
        threshold,
        amounts,
      );
      for (const [name, edit] of EDITS) {
        const edited = structuredClone(lock);
        edit(edited);
        if (name !== 'signature_aggregate + G2') seal(edited);
        for (const level of ['full', 'attested'] as const) {
          const noble = await verdict(edited, nobleBls, level);
          const native = await verdict(edited, blstBackend, level);
          expect({ name, run: level, ...noble }).toEqual({
            name,
            run: level,
            ...native,
          });
          if (name === 'none') expect(noble.ok).toBe(true);
          if (name !== 'none' && level === 'full') expect(noble.ok).toBe(false);
        }
      }
    },
  );

  it('onPolynomial agrees on random point sequences', () => {
    const { Fr } = bls12_381.fields;
    for (let k = 0; k < 40; k++) {
      const n = 1 + pick(12);
      const t = 1 + pick(n);
      const coefficients = Array.from({ length: t }, randomScalar);
      const bytes = Array.from({ length: n + 1 }, (_, x) =>
        G1.BASE.multiply(
          coefficients.reduceRight(
            (acc, c) => Fr.add(Fr.mul(acc, BigInt(x)), c),
            0n,
          ) || 1n,
        ).toBytes(),
      );
      if (k % 2 === 1) {
        const i = pick(bytes.length);
        bytes[i] = G1.fromBytes(bytes[i]).add(G1.BASE).toBytes();
      }
      const noble = nobleBls.onPolynomial(
        bytes.map(b => nobleBls.decodePublicKey(b, true)),
        t,
      );
      const native = blstBackend.onPolynomial(
        bytes.map(b => blstBackend.decodePublicKey(b, true)),
        t,
      );
      expect(noble).toBe(native);
      if (k % 2 === 0) expect(noble).toBe(true);
    }
  });
});
