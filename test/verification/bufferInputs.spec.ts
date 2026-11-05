// noble v2 accepts only exact Uint8Array instances and throws on subclasses
// such as Buffer. Browser bundlers (Next.js polyfills Buffer) and Node callers
// can hand the SDK Buffers; a valid signature must still verify.
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
// Load the package entry first: the verification modules import each other.
import { validateClusterLock } from '../../src/index';
import {
  blsAggregatePublicKeys,
  blsVerify,
  blsVerifyAggregate,
  blsVerifyEach,
} from '../../src/blsUtils';
import { secp256k1VerifyDigest } from '../../src/secp256k1Utils';

void validateClusterLock;

const ls = bls12_381.longSignatures;
const ETH2_DST = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_';
const asBuffer = (bytes: Uint8Array): Buffer => Buffer.from(bytes);

const signer = () => {
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

  it('blsVerifyEach accepts valid signatures passed as Buffers', () => {
    const second = signer();
    const message2 = new Uint8Array(32).fill(9);
    expect(
      blsVerifyEach(
        [asBuffer(pubkey), asBuffer(second.pubkey)],
        [asBuffer(message), asBuffer(message2)],
        [asBuffer(signature), asBuffer(sign(second.secretKey, message2))],
      ),
    ).toBe(true);
  });

  it('blsVerifyAggregate and blsAggregatePublicKeys take Buffers', () => {
    const aggregated = blsAggregatePublicKeys([asBuffer(pubkey)]);
    expect(Buffer.from(aggregated).equals(Buffer.from(pubkey))).toBe(true);
    expect(
      blsVerifyAggregate(
        [asBuffer(pubkey)],
        asBuffer(message),
        asBuffer(signature),
      ),
    ).toBe(true);
  });
});

describe('secp256k1VerifyDigest with Buffer inputs', () => {
  it('accepts a valid signature over a Buffer digest and public key', () => {
    const secretKey = secp256k1.utils.randomSecretKey();
    const publicKey = secp256k1.getPublicKey(secretKey);
    const digest = new Uint8Array(32).fill(3);
    const sig = secp256k1.sign(digest, secretKey, { prehash: false });
    const sigHex = Buffer.from(
      sig instanceof Uint8Array
        ? sig
        : (sig as { toBytes: () => Uint8Array }).toBytes(),
    ).toString('hex');
    expect(secp256k1VerifyDigest(publicKey, digest, sigHex)).toBe(true);
    expect(
      secp256k1VerifyDigest(asBuffer(publicKey), asBuffer(digest), sigHex),
    ).toBe(true);
  });
});
