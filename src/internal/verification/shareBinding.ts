/**
 * Share binding for one distributed validator (lock verification step 5).
 */
import type { BlsBackend } from '../../cluster/blsBackend.js';

export type ShareBinding<PublicKey> =
  | { ok: true; groupKey: PublicKey; shares: PublicKey[] }
  | { ok: false; issue: 'malformed_share' | 'share_reconstruction_failed' };

/**
 * Checks that the group key Y0 and the public shares Y1..Yn (share j at
 * index j) lie on one polynomial of degree below `threshold`, which holds
 * exactly when every `threshold`-th forward difference is the identity.
 *
 * Y0 … Y(threshold-1) are decoded with the subgroup check. Once the
 * differences vanish, each later point is an integer combination of those,
 * so it is in the subgroup as well and needs no check of its own. No point
 * may be the identity (the backend's decode rejects it).
 */
export const bindShares = <PublicKey>(
  bls: BlsBackend<PublicKey>,
  groupKey: Uint8Array,
  shares: Uint8Array[],
  threshold: number,
): ShareBinding<PublicKey> => {
  let points: PublicKey[];
  try {
    points = [groupKey, ...shares].map((bytes, x) =>
      bls.decodePublicKey(bytes, x < threshold),
    );
  } catch {
    return { ok: false, issue: 'malformed_share' };
  }
  let bound = false;
  try {
    bound = bls.onPolynomial(points, threshold);
  } catch {
    bound = false;
  }
  if (!bound) return { ok: false, issue: 'share_reconstruction_failed' };
  return { ok: true, groupKey: points[0], shares: points.slice(1) };
};
