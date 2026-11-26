// noble v2 accepts only exact Uint8Array instances and throws on subclasses
// such as Buffer. Node callers of a BlsBackend and browser bundlers (Next.js
// polyfills Buffer) can hand the SDK Buffers; a valid signature must still
// verify (from 2.15.3).
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { nobleBls } from '../../src/cluster/blsBackend.js';
import {
  blsThresholdAggregateSignatures,
  blsVerify,
  decodeG1,
  decodeG1Unchecked,
  decodeSignature,
} from '../../src/internal/bls.js';

const ls = bls12_381.longSignatures;
const ETH2_DST = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_';
const asBuffer = (bytes: Uint8Array): Buffer => Buffer.from(bytes);

const signer = (): { secretKey: Uint8Array; pubkey: Uint8Array } => {
  const secretKey = bls12_381.utils.randomSecretKey();
  return { secretKey, pubkey: ls.getPublicKey(secretKey).toBytes() };
};
const sign = (secretKey: Uint8Array, message: Uint8Array): Uint8Array =>
  ls.sign(ls.hash(message, ETH2_DST), secretKey).toBytes();

describe('BLS checks with Buffer inputs', () => {
  const message = new Uint8Array(32).fill(7);
  const { secretKey, pubkey } = signer();
  const signature = sign(secretKey, message);

  it('blsVerify accepts a valid signature passed as Buffers', () => {
    expect(blsVerify(pubkey, message, signature)).toBe(true);
    expect(
      blsVerify(asBuffer(pubkey), asBuffer(message), asBuffer(signature)),
    ).toBe(true);
  });

  it('blsVerify still rejects a wrong message passed as Buffers', () => {
    const other = asBuffer(new Uint8Array(32).fill(8));
    expect(blsVerify(asBuffer(pubkey), other, asBuffer(signature))).toBe(false);
  });

  it('decodes Buffer points', () => {
    expect(
      decodeG1(asBuffer(pubkey), true).equals(decodeG1(pubkey, true)),
    ).toBe(true);
    expect(
      decodeG1Unchecked(asBuffer(pubkey)).equals(decodeG1Unchecked(pubkey)),
    ).toBe(true);
    expect(
      decodeSignature(asBuffer(signature)).equals(decodeSignature(signature)),
    ).toBe(true);
  });

  it('nobleBls verifies and batches Buffer inputs', () => {
    const key = nobleBls.decodePublicKey(asBuffer(pubkey), true);
    expect(nobleBls.verify(key, asBuffer(message), asBuffer(signature))).toBe(
      true,
    );
    const second = signer();
    const message2 = new Uint8Array(32).fill(9);
    const batch = nobleBls.createBatch();
    batch.add(key, asBuffer(message), asBuffer(signature));
    batch.add(
      nobleBls.decodePublicKey(asBuffer(second.pubkey), true),
      asBuffer(message2),
      asBuffer(sign(second.secretKey, message2)),
    );
    expect(batch.verify()).toBe(true);
  });

  it('threshold-aggregates Buffer signatures', () => {
    expect(
      blsThresholdAggregateSignatures(new Map([[1, asBuffer(signature)]])),
    ).toEqual(blsThresholdAggregateSignatures(new Map([[1, signature]])));
  });
});
