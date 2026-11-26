// Deterministic decoder fuzz (part of `yarn test`): G1 public keys and G2
// signatures, valid and mutated encodings, decoded by the SDK and by
// @chainsafe/blst (KeyValidate / signature validation). Both must accept and
// reject the same inputs. Seeded, so a failure is reproducible; the full
// run (test/fuzz/run.sh) adds random inputs and Charon's decoders.
import * as blst from '@chainsafe/blst';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { decodeG1, decodeSignature } from '../../src/internal/bls.js';
import { g1OutsideSubgroup } from '../helpers/syntheticLock.js';

const P = bls12_381.fields.Fp.ORDER;
const G1 = bls12_381.G1.Point;
const G2 = bls12_381.G2.Point;

/** mulberry32 */
const rng =
  (seed: number): (() => number) =>
  () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
const random = rng(0x0b01);
const int = (n: number): number => Math.floor(random() * n);
const bytes = (n: number): Uint8Array =>
  Uint8Array.from({ length: n }, () => int(256));
const big = (b: Uint8Array): bigint =>
  BigInt(`0x${Buffer.from(b).toString('hex') || '0'}`);
const toBytes = (x: bigint, n: number): Uint8Array =>
  Uint8Array.from(Buffer.from(x.toString(16).padStart(n * 2, '0'), 'hex'));
const scalar = (): bigint =>
  1n + (big(bytes(31)) % (bls12_381.fields.Fr.ORDER - 1n));

/** Re-encodes field element `part` (offset in bytes) of a compressed point as x + p. */
const plusP = (b: Uint8Array, offset: number): Uint8Array | null => {
  const out = b.slice();
  const flags = offset === 0 ? out[0] & 0xe0 : 0;
  const chunk = out.slice(offset, offset + 48);
  if (offset === 0) chunk[0] &= 0x1f;
  const y = big(chunk) + P;
  if (y >= 1n << 381n) return null;
  const enc = toBytes(y, 48);
  if (offset === 0) enc[0] |= flags;
  out.set(enc, offset);
  return out;
};

const mutations = (valid: Uint8Array, length: 48 | 96): Uint8Array[] => {
  const out: Uint8Array[] = [valid];
  const flip = valid.slice();
  flip[int(length)] ^= 1 << int(8);
  out.push(flip);
  for (const flags of [0x00, 0x20, 0x40, 0x60, 0xa0, 0xc0, 0xe0]) {
    const f = valid.slice();
    f[0] = (f[0] & 0x1f) | flags;
    out.push(f);
  }
  const inf = new Uint8Array(length);
  inf[0] = 0xc0;
  out.push(inf);
  const infSign = inf.slice();
  infSign[0] = 0xe0;
  out.push(infSign);
  const infDirty = inf.slice();
  infDirty[length - 1] = 1;
  out.push(infDirty);
  for (const offset of length === 48 ? [0] : [0, 48]) {
    const p = plusP(valid, offset);
    if (p !== null) out.push(p);
  }
  const rand = bytes(length);
  rand[0] |= 0x80;
  out.push(rand);
  out.push(valid.slice(0, length - 1));
  return out;
};

const agree = (
  inputs: Uint8Array[],
  sdk: (b: Uint8Array) => unknown,
  reference: (b: Uint8Array) => unknown,
): string[] => {
  const ok = (fn: (b: Uint8Array) => unknown, b: Uint8Array): boolean => {
    try {
      fn(b);
      return true;
    } catch {
      return false;
    }
  };
  return inputs
    .filter(b => ok(sdk, b) !== ok(reference, b))
    .map(b => `0x${Buffer.from(b).toString('hex')} sdk ${ok(sdk, b)}`);
};

describe('decoder fuzz (seeded)', () => {
  it('G1: decodeG1(b, true) accepts exactly what blst KeyValidate accepts', () => {
    const inputs: Uint8Array[] = [];
    const off = Uint8Array.from(
      Buffer.from(g1OutsideSubgroup().slice(2), 'hex'),
    );
    inputs.push(off);
    for (let i = 0; i < 300; i++) {
      inputs.push(...mutations(G1.BASE.multiply(scalar()).toBytes(true), 48));
    }
    for (const x of [P - 1n, P, P + 1n, (1n << 381n) - 1n, 0n, 4n]) {
      const b = toBytes(x, 48);
      b[0] |= 0x80;
      inputs.push(b);
    }
    expect(
      agree(
        inputs,
        b => decodeG1(b, true),
        b => blst.PublicKey.fromBytes(b, true),
      ),
    ).toEqual([]);
  });

  it('G2: decodeSignature accepts exactly what blst signature validation accepts', () => {
    const inputs: Uint8Array[] = [];
    for (let i = 0; i < 150; i++) {
      inputs.push(...mutations(G2.BASE.multiply(scalar()).toBytes(true), 96));
    }
    expect(
      agree(inputs, decodeSignature, b => {
        const signature = blst.Signature.fromBytes(b, true);
        // The SDK never accepts the identity as a signature.
        if (b[0] & 0x40) throw new Error('infinity');
        return signature;
      }),
    ).toEqual([]);
  });
});
