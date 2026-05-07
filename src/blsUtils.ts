import { bls12_381 } from '@noble/curves/bls12-381.js';

// ETH2 BLS uses G1 public keys (48 bytes) and G2 signatures (96 bytes) — longSignatures mode.
// The Ethereum consensus spec uses the POP (Proof of Possession) DST, not the noble/curves NUL default.
const { longSignatures: ls } = bls12_381;
const ETH2_DST = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_';

export function blsVerify(
  pubkey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  try {
    return ls.verify(signature, ls.hash(message, ETH2_DST), pubkey);
  } catch {
    return false;
  }
}

export function blsVerifyAggregate(
  pubkeys: Uint8Array[],
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  try {
    return ls.verify(
      signature,
      ls.hash(message, ETH2_DST),
      ls.aggregatePublicKeys(pubkeys),
    );
  } catch {
    return false;
  }
}

export function blsVerifyMultiple(
  pubkeys: Uint8Array[],
  messages: Uint8Array[],
  signature: Uint8Array,
): boolean {
  try {
    if (pubkeys.length !== messages.length) return false;
    const items = messages.map((msg, i) => ({
      message: ls.hash(msg, ETH2_DST),
      publicKey: pubkeys[i],
    }));
    return ls.verifyBatch(signature, items);
  } catch {
    return false;
  }
}

export function blsAggregateSignatures(signatures: Uint8Array[]): Uint8Array {
  return ls.Signature.toBytes(ls.aggregateSignatures(signatures)) as Uint8Array;
}

function mod(a: bigint, n: bigint): bigint {
  const r = a % n;
  return r >= BigInt(0) ? r : r + n;
}

function modInv(a: bigint, n: bigint): bigint {
  let t = BigInt(0);
  let newT = BigInt(1);
  let r = n;
  let newR = mod(a, n);

  while (newR !== BigInt(0)) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }

  if (r !== BigInt(1)) {
    throw new Error('modular inverse does not exist');
  }

  return mod(t, n);
}

function lagrangeCoeffAtZero(
  shareIndex: bigint,
  indices: bigint[],
  order: bigint,
): bigint {
  let num = BigInt(1);
  let den = BigInt(1);

  for (const j of indices) {
    if (j === shareIndex) continue;
    num = mod(num * mod(-j, order), order);
    den = mod(den * mod(shareIndex - j, order), order);
  }

  return mod(num * modInv(den, order), order);
}

// Recover validator distributed pubkey from threshold public shares using
// Lagrange interpolation in G1 at x=0.
export function blsRecoverDistributedPubkeyFromShares(
  pubshares: Uint8Array[],
  threshold: number,
): Uint8Array | null {
  try {
    if (threshold <= 0 || pubshares.length < threshold) return null;

    const selectedShares = pubshares.slice(0, threshold);
    const order = bls12_381.G1.Point.Fn.ORDER;
    const indices = selectedShares.map((_, i) => BigInt(i + 1));

    let recovered = bls12_381.G1.Point.ZERO;
    for (let i = 0; i < selectedShares.length; i++) {
      const point = bls12_381.G1.Point.fromBytes(selectedShares[i]);
      const coeff = lagrangeCoeffAtZero(indices[i], indices, order);
      recovered = recovered.add(point.multiply(coeff));
    }

    return recovered.toBytes() as Uint8Array;
  } catch {
    return null;
  }
}
