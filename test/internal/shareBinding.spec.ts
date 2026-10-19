// Share binding by finite differences (with the partial subgroup check) must
// accept exactly what Lagrange recovery with full point validation accepts,
// except that no point may be the identity.
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { numberToBytesBE } from '@noble/curves/utils.js';
import { fromHexString } from '@chainsafe/ssz';
import { nobleBls } from '../../src/cluster/blsBackend.js';
import { decodeG1Unchecked } from '../../src/internal/bls.js';
import { bindShares } from '../../src/internal/verification/shareBinding.js';
import {
  G1_IDENTITY,
  g1OutsideSubgroup,
  randomScalar,
} from '../helpers/syntheticLock.js';

const G1 = bls12_381.G1.Point;
const { Fr, Fp } = bls12_381.fields;
type Point = typeof G1.BASE;

const encode = (p: Point): Uint8Array => p.toBytes();
const evaluate = (coefficients: bigint[], x: bigint): bigint =>
  coefficients.reduceRight((acc, c) => Fr.add(Fr.mul(acc, x), c), 0n);

/** Σ λ_i·P_i at x = 0 over the given indexes (the 2.x recovery). */
const recover = (points: Point[], indexes: bigint[]): Point => {
  let sum = G1.ZERO;
  points.forEach((point, i) => {
    let num = 1n;
    let den = 1n;
    for (const j of indexes) {
      if (j === indexes[i]) continue;
      num = Fr.mul(num, Fr.neg(j));
      den = Fr.mul(den, Fr.sub(indexes[i], j));
    }
    const coefficient = Fr.mul(num, Fr.inv(den));
    if (coefficient !== 0n) sum = sum.add(point.multiply(coefficient));
  });
  return sum;
};

/**
 * Reference: decode every point with noble's full validation (which accepts
 * the identity), recover the key from shares 1..t, then from shares
 * 1..t-1 plus each further share.
 */
const lagrange = (bytes: Uint8Array[], t: number): boolean => {
  let points: Point[];
  try {
    points = bytes.map(b => G1.fromBytes(b));
  } catch {
    return false;
  }
  const [key, ...shares] = points;
  if (t < 1 || shares.length < t) return false;
  const index = (i: number): bigint => BigInt(i + 1);
  const base = shares.slice(0, t - 1);
  const baseIndexes = base.map((_, i) => index(i));
  if (
    !recover(
      shares.slice(0, t),
      shares.slice(0, t).map((_, i) => index(i)),
    ).equals(key)
  ) {
    return false;
  }
  for (let j = t; j < shares.length; j++) {
    if (
      !recover([...base, shares[j]], [...baseIndexes, index(j)]).equals(key)
    ) {
      return false;
    }
  }
  return true;
};

const isIdentity = (b: Uint8Array): boolean => (b[0] & 0x40) !== 0;
const fd = (bytes: Uint8Array[], t: number): boolean =>
  bindShares(nobleBls, bytes[0], bytes.slice(1), t).ok;

const randomInt = (min: number, max: number): number =>
  min + Math.floor(Math.random() * (max - min + 1));

/** Y0..Yn for a random polynomial of degree < t. */
const polynomialPoints = (t: number, n: number): Uint8Array[] => {
  const coefficients = Array.from({ length: t }, randomScalar);
  return Array.from({ length: n + 1 }, (_, x) =>
    encode(G1.BASE.multiply(evaluate(coefficients, BigInt(x)) || 1n)),
  );
};

const OUTSIDE = fromHexString(g1OutsideSubgroup());
const IDENTITY = fromHexString(G1_IDENTITY);

type Mutation = (points: Uint8Array[], t: number) => void;
const at = (points: Uint8Array[]): number => randomInt(0, points.length - 1);
const MUTATIONS: Array<[string, Mutation]> = [
  ['none', () => {}],
  [
    'point + G',
    p => {
      const i = at(p);
      p[i] = encode(G1.fromBytes(p[i]).add(G1.BASE));
    },
  ],
  [
    'outside the subgroup',
    p => {
      p[at(p)] = OUTSIDE;
    },
  ],
  [
    'outside the subgroup at an unchecked index',
    (p, t) => {
      if (p.length > t) p[randomInt(t, p.length - 1)] = OUTSIDE;
    },
  ],
  [
    'identity',
    p => {
      p[at(p)] = IDENTITY;
    },
  ],
  [
    'two shares swapped',
    p => {
      if (p.length < 3) return;
      const i = randomInt(1, p.length - 1);
      const j = randomInt(1, p.length - 1);
      [p[i], p[j]] = [p[j], p[i]];
    },
  ],
  [
    'another polynomial',
    (p, t) => {
      const other = polynomialPoints(t, p.length - 1);
      p[at(p)] = other[randomInt(0, other.length - 1)];
    },
  ],
];

describe('share binding: finite differences against Lagrange recovery', () => {
  const cases: Array<[number, number, string, Mutation]> = [];
  for (let k = 0; k < 70; k++) {
    const n = randomInt(1, 16);
    const t = randomInt(1, Math.min(n + 1, 16));
    const [name, mutate] = MUTATIONS[k % MUTATIONS.length];
    cases.push([t, n, name, mutate]);
  }

  it.each(cases)('t=%i n=%i: %s', (t, n, _name, mutate) => {
    const points = polynomialPoints(t, n);
    mutate(points, t);
    const expected = lagrange(points, t) && !points.some(isIdentity);
    expect(fd(points, t)).toBe(expected);
  });

  it('a valid polynomial passes for every t and n up to 16', () => {
    for (let n = 1; n <= 16; n++) {
      const t = randomInt(1, n);
      expect(fd(polynomialPoints(t, n), t)).toBe(true);
    }
  });

  it('rejects an identity share even when it lies on the polynomial', () => {
    // f(x) = (x - 2)·g(x): share 2 is the identity.
    const t = 3;
    const g = [randomScalar(), randomScalar()];
    const f = (x: bigint): bigint => Fr.mul(Fr.sub(x, 2n), evaluate(g, x));
    const points = Array.from({ length: 5 }, (_, x) => {
      const scalar = f(BigInt(x));
      return scalar === 0n ? IDENTITY : encode(G1.BASE.multiply(scalar));
    });
    expect(lagrange(points, t)).toBe(true);
    expect(fd(points, t)).toBe(false);
  });

  it('rejects too few shares and a threshold below 1', () => {
    const points = polynomialPoints(3, 2);
    expect(fd(points, 3)).toBe(false);
    expect(fd(points, 0)).toBe(false);
  });
});

describe('decodeG1Unchecked', () => {
  it('matches noble for subgroup points', () => {
    for (let i = 0; i < 20; i++) {
      const point = G1.BASE.multiply(randomScalar());
      expect(decodeG1Unchecked(point.toBytes()).equals(point)).toBe(true);
    }
  });

  it('decodes a point outside the subgroup that noble refuses', () => {
    expect(() => G1.fromBytes(OUTSIDE)).toThrow();
    expect(decodeG1Unchecked(OUTSIDE).isTorsionFree()).toBe(false);
  });

  it('rejects bad encodings', () => {
    const valid = G1.BASE.toBytes();
    const uncompressed = valid.slice();
    uncompressed[0] &= 0x7f;
    const bigX = new Uint8Array(48).fill(0xff);
    bigX[0] = 0x9f;
    // x = 0: 0³ + 4 = 4 is a square, so search for an x with no point.
    let noPoint = 1n;
    for (; ; noPoint++) {
      try {
        Fp.sqrt(Fp.add(Fp.mul(Fp.sqr(noPoint), noPoint), 4n));
      } catch {
        break;
      }
    }
    const offCurve = numberToBytesBE(noPoint, 48);
    offCurve[0] |= 0x80;
    for (const bytes of [
      valid.slice(1),
      uncompressed,
      IDENTITY,
      bigX,
      offCurve,
    ]) {
      expect(() => decodeG1Unchecked(bytes)).toThrow();
    }
  });
});
