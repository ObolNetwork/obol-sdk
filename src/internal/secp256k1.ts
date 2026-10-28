import { secp256k1 } from '@noble/curves/secp256k1.js';
import { hexToBytes } from '@noble/curves/utils.js';

const HEX_RE = /^[0-9a-fA-F]*$/;

/**
 * Parses a hex-encoded secp256k1 signature as produced by charon: either a
 * 64-byte compact `r || s` or a 65-byte `r || s || v` with a trailing
 * recovery id. The recovery id is not needed for verification and is dropped.
 *
 * @param signature - Hex string, with or without a `0x` prefix.
 * @returns The 64-byte compact `r || s`, or `null` if the input is not a
 *   64/65-byte hex string.
 */
export function parseSecp256k1Signature(signature: string): Uint8Array | null {
  if (typeof signature !== 'string') return null;
  const hex =
    signature.startsWith('0x') || signature.startsWith('0X')
      ? signature.slice(2)
      : signature;
  if ((hex.length !== 128 && hex.length !== 130) || !HEX_RE.test(hex)) {
    return null;
  }
  return hexToBytes(hex.slice(0, 128));
}

/**
 * Verifies a secp256k1 ECDSA signature over a 32-byte digest (the digest is
 * used as-is, not hashed again). By default only low-s signatures are
 * accepted, matching the go-ethereum/decred signer used by charon; `lowS:
 * false` also accepts the high-s form of the same signature, for a check
 * that must accept what another verifier (the Obol API) accepts.
 *
 * @param publicKey - Compressed (33-byte) or uncompressed (65-byte) public key.
 * @param digest - 32-byte message digest.
 * @param signature - Hex-encoded signature, see {@link parseSecp256k1Signature}.
 * @param options - `lowS` (default true): require the low-s form.
 * @returns `true` if the signature is valid; `false` for an invalid or
 *   malformed signature, public key or digest.
 */
export function secp256k1VerifyDigest(
  publicKey: Uint8Array,
  digest: Uint8Array,
  signature: string,
  options: { lowS?: boolean } = {},
): boolean {
  const compactSig = parseSecp256k1Signature(signature);
  if (!compactSig || digest.length !== 32) return false;
  try {
    return secp256k1.verify(compactSig, digest, publicKey, {
      prehash: false,
      lowS: options.lowS ?? true,
    });
  } catch {
    return false;
  }
}

/**
 * Verifies a 65-byte `r ‖ s ‖ v` secp256k1 signature over a 32-byte digest
 * the way Charon does (`k1util.Verify65`): exactly 65 bytes, `v` in
 * {0, 1, 27, 28}, and the key recovered with that recovery id equals
 * `publicKey`. The high-s form is accepted, with its own recovery id.
 *
 * @param publicKey - Compressed (33-byte) or uncompressed (65-byte) public key.
 */
export function secp256k1VerifyRecovered(
  publicKey: Uint8Array,
  digest: Uint8Array,
  signature: string,
): boolean {
  if (typeof signature !== 'string' || digest.length !== 32) return false;
  const hex =
    signature.startsWith('0x') || signature.startsWith('0X')
      ? signature.slice(2)
      : signature;
  if (hex.length !== 130 || !HEX_RE.test(hex)) return false;
  const bytes = hexToBytes(hex);
  const v = bytes[64];
  const recovery = v >= 27 ? v - 27 : v;
  if (recovery !== 0 && recovery !== 1) return false;
  try {
    const recovered = secp256k1.Signature.fromBytes(
      bytes.subarray(0, 64),
      'compact',
    )
      .addRecoveryBit(recovery)
      .recoverPublicKey(digest)
      .toBytes(true);
    const expected = secp256k1.Point.fromBytes(publicKey).toBytes(true);
    return (
      recovered.length === expected.length &&
      recovered.every((b, i) => b === expected[i])
    );
  } catch {
    return false;
  }
}
