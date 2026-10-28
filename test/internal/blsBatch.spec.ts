// Batch BLS verification must accept a batch only when every signature in it
// is valid on its own.
import { fromHexString } from '@chainsafe/ssz';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import {
  nobleBls as noble,
  type BlsBackend,
} from '../../src/cluster/blsBackend.js';
import { blsVerify } from '../../src/internal/bls.js';
import {
  firstInvalidSignature,
  type SignatureItem,
} from '../../src/internal/verification/signatureBatch.js';
import {
  offsetSignaturePair,
  pointOutsideSubgroup,
  signatureOutsideSubgroup,
} from '../helpers/blsSignatures.js';

const ls = bls12_381.longSignatures;
const ETH2_DST = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_';
const hex = (bytes: Uint8Array): string =>
  '0x' + Buffer.from(bytes).toString('hex');
const INFINITY_G1 = new Uint8Array(48);
INFINITY_G1[0] = 0xc0;
const INFINITY_G2 = new Uint8Array(96);
INFINITY_G2[0] = 0xc0;

const buildCorpus = (
  n: number,
): {
  pubkeys: Uint8Array[];
  messages: Uint8Array[];
  signatures: Uint8Array[];
} => {
  const pubkeys: Uint8Array[] = [];
  const messages: Uint8Array[] = [];
  const signatures: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const seed = new Uint8Array(48);
    seed[0] = (i + 1) & 0xff;
    seed[1] = ((i + 1) >> 8) & 0xff;
    const sk = ls.keygen(seed).secretKey;
    pubkeys.push(ls.getPublicKey(sk).toBytes());
    const msg = new Uint8Array(32).fill(i & 0xff);
    messages.push(msg);
    signatures.push(ls.Signature.toBytes(ls.sign(ls.hash(msg, ETH2_DST), sk)));
  }
  return { pubkeys, messages, signatures };
};

/** Replace signatures i and j by an offset pair with an unchanged sum. */
const offsetPair = (signatures: Uint8Array[], i: number, j: number): void => {
  const [a, b] = offsetSignaturePair(hex(signatures[i]), hex(signatures[j]));
  signatures[i] = fromHexString(a);
  signatures[j] = fromHexString(b);
};

const nobleBls: BlsBackend = noble;

const decodeOrNull = (pubkey: Uint8Array): unknown => {
  try {
    return nobleBls.decodePublicKey(pubkey, true);
  } catch {
    return null;
  }
};

const itemsOf = ({
  pubkeys,
  messages,
  signatures,
}: ReturnType<typeof buildCorpus>): Array<SignatureItem<unknown>> =>
  pubkeys.map((pubkey, i) => ({
    publicKey: decodeOrNull(pubkey),
    message: messages[i],
    signature: signatures[i],
  }));

const batchOf = (corpus: ReturnType<typeof buildCorpus>): boolean => {
  const batch = nobleBls.createBatch();
  for (const item of itemsOf(corpus)) {
    batch.add(item.publicKey, item.message, item.signature);
  }
  return batch.verify();
};

const noTick = async (): Promise<void> => {};

describe('nobleBls batch', () => {
  it('accepts a batch of valid signatures, and an empty one', () => {
    expect(batchOf(buildCorpus(9))).toBe(true);
    expect(nobleBls.createBatch().verify()).toBe(true);
  });

  it('rejects two invalid signatures whose sum is valid', () => {
    const corpus = buildCorpus(9);
    offsetPair(corpus.signatures, 3, 7);
    const { pubkeys, messages, signatures } = corpus;
    expect(blsVerify(pubkeys[3], messages[3], signatures[3])).toBe(false);
    expect(blsVerify(pubkeys[7], messages[7], signatures[7])).toBe(false);
    expect(batchOf(corpus)).toBe(false);
  });

  it('refuses a signature outside the prime-order subgroup', () => {
    expect(pointOutsideSubgroup().isTorsionFree()).toBe(false);
    const corpus = buildCorpus(3);
    corpus.signatures[2] = fromHexString(
      signatureOutsideSubgroup(hex(corpus.signatures[2])),
    );
    expect(() => ls.Signature.fromBytes(corpus.signatures[2])).toThrow(
      'not in prime-order subgroup',
    );
    expect(() => batchOf(corpus)).toThrow();
  });

  it('refuses an identity public key or signature', () => {
    expect(() => nobleBls.decodePublicKey(INFINITY_G1, true)).toThrow();
    expect(() => nobleBls.decodePublicKey(INFINITY_G1, false)).toThrow();
    const corpus = buildCorpus(2);
    corpus.signatures[1] = INFINITY_G2;
    expect(() => batchOf(corpus)).toThrow();
    expect(blsVerify(INFINITY_G1, corpus.messages[1], INFINITY_G2)).toBe(false);
  });

  it('verify matches single verification', () => {
    const { pubkeys, messages, signatures } = buildCorpus(3);
    const key = nobleBls.decodePublicKey(pubkeys[0], true);
    expect(nobleBls.verify(key, messages[0], signatures[0])).toBe(true);
    expect(nobleBls.verify(key, messages[1], signatures[0])).toBe(false);
    expect(nobleBls.verify(key, messages[0], new Uint8Array(96))).toBe(false);
  });
});

describe('firstInvalidSignature', () => {
  it('returns -1 when every signature is valid', async () => {
    expect(
      await firstInvalidSignature(nobleBls, itemsOf(buildCorpus(5)), noTick),
    ).toBe(-1);
    expect(await firstInvalidSignature(nobleBls, [], noTick)).toBe(-1);
  });

  it('finds the first of a cancelling pair across chunks', async () => {
    const corpus = buildCorpus(12);
    offsetPair(corpus.signatures, 6, 11);
    // Chunks of 4: the pair spans the second and third chunk.
    expect(
      await firstInvalidSignature(nobleBls, itemsOf(corpus), noTick, 4),
    ).toBe(6);
  });

  it('reports a malformed signature or public key at its index', async () => {
    const corpus = buildCorpus(6);
    corpus.signatures[4] = fromHexString(
      signatureOutsideSubgroup(hex(corpus.signatures[4])),
    );
    expect(
      await firstInvalidSignature(nobleBls, itemsOf(corpus), noTick, 4),
    ).toBe(4);
    const items = itemsOf(buildCorpus(6));
    items[2].publicKey = null;
    expect(await firstInvalidSignature(nobleBls, items, noTick)).toBe(2);
  });

  it('fails closed when a backend batch disagrees with single checks', async () => {
    const lying = {
      ...nobleBls,
      createBatch: () => ({ add: () => {}, verify: () => false }),
    };
    expect(
      await firstInvalidSignature(lying, itemsOf(buildCorpus(3)), noTick),
    ).toBe(0);
  });
});
