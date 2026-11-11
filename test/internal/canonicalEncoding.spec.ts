// Canonical BLS point encodings (2.x acc8e99, also found by the Charon
// differential fuzz: test/fuzz/regressions m015 / m026). A field element at
// or above p is a second encoding of the same point; the decoders refuse it,
// as Ethereum's KeyValidate and signature checks do.
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { bytesToNumberBE, numberToBytesBE } from '@noble/curves/utils.js';
import { decodeG1, decodeSignature } from '../../src/internal/bls.js';

const G1 = bls12_381.G1.Point;
const G2 = bls12_381.G2.Point;
const { Fp } = bls12_381.fields;
const ls = bls12_381.longSignatures;
const LIMIT = 1n << 381n; // field elements are 381 bits; the top 3 bits are flags

/** The point's compressed bytes with the field element at `offset` raised by p. */
const plusP = (bytes: Uint8Array, offset: number): Uint8Array => {
  const out = bytes.slice();
  const flags = out[0] & 0xe0;
  const element = out.slice(offset, offset + 48);
  if (offset === 0) element[0] &= 0x1f;
  out.set(numberToBytesBE(bytesToNumberBE(element) + Fp.ORDER, 48), offset);
  out[0] |= flags;
  return out;
};

/** A multiple of `base` whose field element at `pick` leaves room for + p. */
const roomy = <P extends { multiply: (k: bigint) => P }>(
  base: P,
  pick: (p: P) => bigint,
): P => {
  for (let k = 2n; ; k++) {
    const point = base.multiply(k);
    if (pick(point) + Fp.ORDER < LIMIT) return point;
  }
};

describe('canonical BLS encodings', () => {
  const key = roomy(G1.BASE, p => p.toAffine().x);
  const keyBytes = key.toBytes(true);
  const sig = roomy(G2.BASE, p => p.toAffine().x.c0);
  const sigBytes = ls.Signature.toBytes(sig);

  it('accepts the canonical encodings', () => {
    expect(decodeG1(keyBytes, true).equals(key)).toBe(true);
    expect(decodeG1(keyBytes, false).equals(key)).toBe(true);
    expect(decodeSignature(sigBytes).equals(sig)).toBe(true);
  });

  it('rejects a public key re-encoded with x + p, with or without the subgroup check', () => {
    const reencoded = plusP(keyBytes, 0);
    expect(() => decodeG1(reencoded, true)).toThrow(/field/);
    expect(() => decodeG1(reencoded, false)).toThrow(/field/);
  });

  it('rejects a signature re-encoded with x.c0 + p', () => {
    expect(() => decodeSignature(plusP(sigBytes, 48))).toThrow(/field/);
  });

  it('rejects encodings without the compression flag, and wrong lengths', () => {
    const uncompressedFlag = keyBytes.slice();
    uncompressedFlag[0] &= 0x7f;
    expect(() => decodeG1(uncompressedFlag, true)).toThrow(/compressed/);
    expect(() => decodeG1(keyBytes.slice(0, 47), true)).toThrow(/48 bytes/);
    expect(() => decodeSignature(sigBytes.slice(0, 95))).toThrow(/96 bytes/);
  });

  it('rejects the point at infinity, and infinity with the sign flag or a non-zero body', () => {
    const infinity = new Uint8Array(48);
    infinity[0] = 0xc0;
    expect(() => decodeG1(infinity, true)).toThrow(/infinity/);
    const signed = infinity.slice();
    signed[0] = 0xe0;
    expect(() => decodeG1(signed, true)).toThrow(/infinity/);
    const body = infinity.slice();
    body[47] = 1;
    expect(() => decodeG1(body, true)).toThrow(/infinity/);
  });
});
