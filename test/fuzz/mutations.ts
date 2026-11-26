// Mutation catalog for the differential lock fuzzer. Each mutation edits a
// clone of a valid generated lock and returns it (or null when it does not
// apply to that lock, e.g. it needs two validators). Most mutations then
// `reseal` (recompute hashes, re-sign node signatures and the aggregate) so
// the verifiers get past the hash and signature checks to the edited one;
// `variant: 'raw'` skips that.
import { fromHexString } from '@chainsafe/ssz';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { numberToBytesBE } from '@noble/curves/utils.js';
import { decodeG1Unchecked } from '../../src/internal/bls.js';
import { offsetSignaturePair } from '../helpers/blsSignatures.js';
import {
  G1_IDENTITY,
  blsSign,
  g1OutsideSubgroup,
  hex,
  randomScalar,
} from '../helpers/syntheticLock.js';
import {
  type Base,
  clone,
  credentials,
  depositsOf,
  layoutOf,
  reseal,
  secretOf,
  signBuilder,
  signDeposit,
} from './generator.js';

const G1 = bls12_381.G1.Point;
type G1P = typeof G1.BASE;
const { Fp } = bls12_381.fields;
const P = Fp.ORDER;
const HALF_P = (P - 1n) / 2n;
const R = bls12_381.fields.Fr.ORDER;
const N_K1 = secp256k1.Point.CURVE().n;

export type Rng = () => number;
export const pick = <T>(rng: Rng, xs: readonly T[]): T =>
  xs[Math.floor(rng() * xs.length)];
const int = (rng: Rng, n: number): number => Math.floor(rng() * n);

/** ZCash-compressed G1 encoding without noble's validity checks. */
export const encodeG1 = (point: G1P): string => {
  if (point.is0()) return G1_IDENTITY;
  const { x, y } = point.toAffine();
  const bytes = numberToBytesBE(x, 48);
  bytes[0] |= 0x80 | (y > HALF_P ? 0x20 : 0);
  return hex(bytes);
};
const decodeAny = (h: string): G1P => decodeG1Unchecked(fromHexString(h));
/** [k]Q by double-and-add (works for points outside the subgroup and any k). */
const mulAny = (q: G1P, k: bigint): G1P => {
  let acc = G1.ZERO;
  for (const bit of k.toString(2)) {
    acc = acc.double();
    if (bit === '1') acc = acc.add(q);
  }
  return acc;
};
const OFF = decodeAny(g1OutsideSubgroup());
/** A non-identity point of the cofactor torsion ([r]Q for Q outside G1). */
const TORSION = mulAny(OFF, R);

const flipByte = (h: string, rng: Rng): string => {
  const b = fromHexString(h);
  if (b.length === 0) return '0x00';
  const i = int(rng, b.length);
  b[i] ^= 1 << int(rng, 8) || 1;
  return hex(b);
};

export interface Ctx {
  base: Base;
  lock: any;
  rng: Rng;
  /** Detail of what was done (recorded in the case file). */
  detail: Record<string, unknown>;
}
export interface Mutation {
  name: string;
  /** Mutation family, for the per-class counts. */
  family: string;
  apply: (ctx: Ctx) => any | null;
}

const dvs = (c: Ctx): any[] => c.lock.distributed_validators;
const nOps = (c: Ctx): number => c.lock.cluster_definition.operators.length;
const pickV = (c: Ctx): number => {
  const i = int(c.rng, dvs(c).length);
  c.detail.validator = i;
  return i;
};
const pickShare = (c: Ctx, i: number): number => {
  const j = int(c.rng, dvs(c)[i].public_shares.length);
  c.detail.share = j;
  return j;
};
const seal = (c: Ctx, options = {}): any =>
  reseal(c.lock, c.base.secrets, options);
const v18 = (c: Ctx): boolean =>
  layoutOf(c.lock.cluster_definition.version) === 'v1.8+';
const hasBuilder = (c: Ctx): boolean =>
  layoutOf(c.lock.cluster_definition.version) !== 'v1.6';
/** Remember the discrete log of a new public point (for later re-signing). */
const learn = (c: Ctx, point: string, secret: bigint): void => {
  c.base.secrets.dlog[point.toLowerCase()] = '0x' + secret.toString(16);
};
const knownPoint = (c: Ctx): string => {
  const s = randomScalar();
  const p = hex(G1.BASE.multiply(s).toBytes());
  learn(c, p, s);
  return p;
};
/** Points of the lock whose encoding is canonical and qualifies for x + p. */
const xPlusP = (h: string): string | null => {
  const b = fromHexString(h);
  const flags = b[0] & 0xe0;
  b[0] &= 0x1f;
  const x = BigInt(hex(b));
  const y = x + P;
  if (y >= 1n << 381n) return null;
  const out = numberToBytesBE(y, 48);
  out[0] |= flags;
  return hex(out);
};

const shareEdit =
  (edit: (c: Ctx, share: string, i: number, j: number) => string | null) =>
  (c: Ctx): any => {
    const i = pickV(c);
    const j = pickShare(c, i);
    const out = edit(c, dvs(c)[i].public_shares[j], i, j);
    if (out === null) return null;
    dvs(c)[i].public_shares[j] = out;
    return seal(c);
  };
const groupKeyEdit =
  (edit: (c: Ctx, key: string, i: number) => string | null) =>
  (c: Ctx): any => {
    const i = pickV(c);
    const out = edit(c, dvs(c)[i].distributed_public_key, i);
    if (out === null) return null;
    // Only the group key field: deposits / builder keep the old pubkey, so
    // the SDK's field check and Charon's builder check also see the edit.
    dvs(c)[i].distributed_public_key = out;
    return seal(c);
  };
/** Edit the group key everywhere it appears (deposits, builder) consistently. */
const groupKeyEverywhere =
  (edit: (c: Ctx, key: string, i: number) => string | null) =>
  (c: Ctx): any => {
    const i = pickV(c);
    const v = dvs(c)[i];
    const out = edit(c, v.distributed_public_key, i);
    if (out === null) return null;
    v.distributed_public_key = out;
    for (const d of depositsOf(c.lock, i)) d.pubkey = out;
    if (v.builder_registration) v.builder_registration.message.pubkey = out;
    return seal(c);
  };

const nodeSigEdit =
  (edit: (c: Ctx, sig: Uint8Array) => Uint8Array | null) =>
  (c: Ctx): any => {
    if (!hasBuilder(c)) return null;
    const k = int(c.rng, c.lock.node_signatures.length);
    c.detail.node = k;
    const out = edit(c, fromHexString(c.lock.node_signatures[k]));
    if (out === null) return null;
    c.lock.node_signatures[k] = hex(out);
    return c.lock;
  };

const MALFORMED_HEX: Array<[string, (h: string) => string]> = [
  ['odd_length', h => h + '0'],
  ['non_hex_char', h => h.slice(0, -1) + 'g'],
  ['no_0x', h => h.slice(2)],
  ['upper_case', h => '0x' + h.slice(2).toUpperCase()],
  ['upper_0X', h => '0X' + h.slice(2)],
  ['short_by_one', h => h.slice(0, -2)],
  ['long_by_one', h => h + '00'],
  ['empty', () => ''],
  ['just_0x', () => '0x'],
  ['whitespace', h => ' ' + h],
];

/** Paths to every hex field of a lock that a malformed-hex mutation may hit. */
const hexFields = (lock: any): Array<[any, string | number, string]> => {
  const out: Array<[any, string | number, string]> = [];
  const def = lock.cluster_definition;
  out.push([lock, 'lock_hash', 'lock_hash']);
  out.push([lock, 'signature_aggregate', 'signature_aggregate']);
  out.push([def, 'config_hash', 'config_hash']);
  out.push([def, 'definition_hash', 'definition_hash']);
  out.push([def, 'fork_version', 'fork_version']);
  def.validators.forEach((v: any, i: number) => {
    out.push([v, 'fee_recipient_address', `validators[${i}].fee_recipient`]);
    out.push([v, 'withdrawal_address', `validators[${i}].withdrawal`]);
  });
  (lock.node_signatures ?? []).forEach((_: string, k: number) =>
    out.push([lock.node_signatures, k, `node_signatures[${k}]`]),
  );
  lock.distributed_validators.forEach((v: any, i: number) => {
    out.push([v, 'distributed_public_key', `dv[${i}].key`]);
    v.public_shares.forEach((_: string, j: number) =>
      out.push([v.public_shares, j, `dv[${i}].share[${j}]`]),
    );
    depositsOf(lock, i).forEach((d: any, k: number) => {
      out.push([d, 'pubkey', `dv[${i}].deposit[${k}].pubkey`]);
      out.push([d, 'withdrawal_credentials', `dv[${i}].deposit[${k}].creds`]);
      out.push([d, 'signature', `dv[${i}].deposit[${k}].signature`]);
    });
    if (v.builder_registration) {
      const r = v.builder_registration;
      out.push([r.message, 'fee_recipient', `dv[${i}].builder.fee_recipient`]);
      out.push([r.message, 'pubkey', `dv[${i}].builder.pubkey`]);
      out.push([r, 'signature', `dv[${i}].builder.signature`]);
    }
  });
  return out;
};

export const MUTATIONS: Mutation[] = [
  { name: 'none', family: 'baseline', apply: c => c.lock },
  {
    name: 'reseal_only',
    family: 'baseline',
    apply: c => seal(c),
  },

  // --- byte flips -------------------------------------------------------
  {
    name: 'flip_share_byte',
    family: 'byte_flip',
    apply: shareEdit((c, s) => flipByte(s, c.rng)),
  },
  {
    name: 'flip_share_byte_raw',
    family: 'byte_flip',
    apply: c => {
      const i = pickV(c);
      const j = pickShare(c, i);
      dvs(c)[i].public_shares[j] = flipByte(dvs(c)[i].public_shares[j], c.rng);
      return c.lock;
    },
  },
  {
    name: 'flip_group_key_byte',
    family: 'byte_flip',
    apply: groupKeyEdit((c, k) => flipByte(k, c.rng)),
  },
  {
    name: 'flip_group_key_byte_everywhere',
    family: 'byte_flip',
    apply: groupKeyEverywhere((c, k) => flipByte(k, c.rng)),
  },
  {
    name: 'flip_deposit_sig_byte',
    family: 'byte_flip',
    apply: c => {
      const i = pickV(c);
      const ds = depositsOf(c.lock, i);
      const d = pick(c.rng, ds);
      d.signature = flipByte(d.signature, c.rng);
      return seal(c);
    },
  },
  {
    name: 'flip_builder_sig_byte',
    family: 'byte_flip',
    apply: c => {
      if (!hasBuilder(c)) return null;
      const r = dvs(c)[pickV(c)].builder_registration;
      r.signature = flipByte(r.signature, c.rng);
      return seal(c);
    },
  },
  {
    name: 'flip_aggregate_byte',
    family: 'byte_flip',
    apply: c => {
      c.lock.signature_aggregate = flipByte(c.lock.signature_aggregate, c.rng);
      return c.lock;
    },
  },
  {
    name: 'flip_node_sig_byte',
    family: 'byte_flip',
    apply: c => {
      if (!hasBuilder(c)) return null;
      const k = int(c.rng, c.lock.node_signatures.length);
      c.detail.node = k;
      // r || s only (the v byte has its own mutations).
      const b = fromHexString(c.lock.node_signatures[k]);
      const at = int(c.rng, 64);
      b[at] ^= 1 << int(c.rng, 8) || 1;
      c.detail.byte = at;
      c.lock.node_signatures[k] = hex(b);
      return c.lock;
    },
  },
  {
    name: 'flip_lock_hash_byte',
    family: 'byte_flip',
    apply: c => {
      c.lock.lock_hash = flipByte(c.lock.lock_hash, c.rng);
      return c.lock;
    },
  },
  {
    name: 'flip_lock_hash_byte_resigned',
    family: 'byte_flip',
    apply: c => {
      // Wrong lock_hash, but node signatures and aggregate sign that value.
      c.lock.lock_hash = flipByte(c.lock.lock_hash, c.rng);
      const save = c.lock.lock_hash;
      seal(c);
      const real = c.lock.lock_hash;
      c.lock.lock_hash = save;
      // Re-sign over the wrong hash by sealing a copy whose hash we override.
      const digest = fromHexString(save);
      let sum = 0n;
      for (const v of dvs(c))
        for (const s of v.public_shares)
          sum += secretOf(c.base.secrets, s) ?? 0n;
      c.lock.signature_aggregate = blsSign(digest, sum % R);
      if (hasBuilder(c)) {
        c.lock.node_signatures = c.base.secrets.nodeKeys.map(k =>
          nodeSignHex(digest, k),
        );
      }
      c.detail.real_lock_hash = real;
      return c.lock;
    },
  },

  // --- shares and group keys -------------------------------------------
  {
    name: 'share_plus_G',
    family: 'share',
    apply: shareEdit((c, s) => {
      const out = encodeG1(decodeAny(s).add(G1.BASE));
      const k = secretOf(c.base.secrets, s);
      if (k !== null) learn(c, out, (k + 1n) % R);
      return out;
    }),
  },
  {
    name: 'share_random_known',
    family: 'share',
    apply: shareEdit(c => knownPoint(c)),
  },
  {
    name: 'share_negated',
    family: 'share',
    // Sign bit flipped: -P, a valid point not on the polynomial.
    apply: shareEdit(c => {
      const i = c.detail.validator as number;
      const j = c.detail.share as number;
      const b = fromHexString(dvs(c)[i].public_shares[j]);
      b[0] ^= 0x20;
      return hex(b);
    }),
  },
  {
    name: 'share_off_subgroup',
    family: 'share',
    apply: shareEdit(() => g1OutsideSubgroup()),
  },
  {
    name: 'share_plus_torsion',
    family: 'share',
    // On the curve, outside G1, differs from the real share by a torsion point.
    apply: shareEdit((_c, s) => encodeG1(decodeAny(s).add(TORSION))),
  },
  {
    name: 'share_late_plus_torsion',
    family: 'share',
    // A share at x >= t (not subgroup-checked by the SDK's shortcut).
    apply: c => {
      const i = pickV(c);
      const t = c.lock.cluster_definition.threshold;
      const n = dvs(c)[i].public_shares.length;
      if (n <= t) return null;
      const j = t + int(c.rng, n - t); // share index j, x = j + 1 > t
      c.detail.share = j;
      const s = dvs(c)[i].public_shares[j];
      dvs(c)[i].public_shares[j] = encodeG1(decodeAny(s).add(TORSION));
      return seal(c);
    },
  },
  {
    name: 'torsion_polynomial',
    family: 'share',
    // Add c·x·T to share x for every x, c = 1: Y(x) + x·T is a degree-1
    // polynomial with a torsion coefficient; group key unchanged.
    apply: c => {
      const i = pickV(c);
      const v = dvs(c)[i];
      v.public_shares = v.public_shares.map((s: string, j: number) =>
        encodeG1(decodeAny(s).add(mulAny(TORSION, BigInt(j + 1)))),
      );
      return seal(c);
    },
  },
  {
    name: 'share_identity',
    family: 'share',
    apply: shareEdit(() => G1_IDENTITY),
  },
  {
    name: 'group_key_identity',
    family: 'share',
    apply: groupKeyEverywhere(() => G1_IDENTITY),
  },
  {
    name: 'group_key_off_subgroup',
    family: 'share',
    apply: groupKeyEverywhere(() => g1OutsideSubgroup()),
  },
  {
    name: 'group_key_plus_torsion',
    family: 'share',
    apply: groupKeyEverywhere((_c, k) => encodeG1(decodeAny(k).add(TORSION))),
  },
  {
    name: 'all_points_plus_torsion',
    family: 'share',
    // Group key and every share + T: a polynomial (constant torsion term).
    apply: c => {
      const i = pickV(c);
      const v = dvs(c)[i];
      const k = encodeG1(decodeAny(v.distributed_public_key).add(TORSION));
      v.distributed_public_key = k;
      for (const d of depositsOf(c.lock, i)) d.pubkey = k;
      if (v.builder_registration) v.builder_registration.message.pubkey = k;
      v.public_shares = v.public_shares.map((s: string) =>
        encodeG1(decodeAny(s).add(TORSION)),
      );
      return seal(c);
    },
  },
  {
    name: 'swap_shares_within',
    family: 'share',
    apply: c => {
      const i = pickV(c);
      const s = dvs(c)[i].public_shares;
      if (s.length < 2) return null;
      const a = int(c.rng, s.length);
      let b = int(c.rng, s.length - 1);
      if (b >= a) b++;
      [s[a], s[b]] = [s[b], s[a]];
      c.detail.swap = [a, b];
      return seal(c);
    },
  },
  {
    name: 'swap_shares_across',
    family: 'share',
    apply: c => {
      if (dvs(c).length < 2) return null;
      const a = int(c.rng, dvs(c).length);
      let b = int(c.rng, dvs(c).length - 1);
      if (b >= a) b++;
      const j = int(c.rng, nOps(c));
      const sa = dvs(c)[a].public_shares;
      const sb = dvs(c)[b].public_shares;
      [sa[j], sb[j]] = [sb[j], sa[j]];
      c.detail.swap = { validators: [a, b], share: j };
      return seal(c);
    },
  },
  {
    name: 'cancel_pair_shares',
    family: 'share',
    // share_a + D, share_b - D in two validators: Σ shares (aggregate key) unchanged.
    apply: c => {
      if (dvs(c).length < 2) return null;
      const a = int(c.rng, dvs(c).length);
      let b = int(c.rng, dvs(c).length - 1);
      if (b >= a) b++;
      const j = int(c.rng, nOps(c));
      const d = G1.BASE.multiply(randomScalar());
      const sa = dvs(c)[a].public_shares;
      const sb = dvs(c)[b].public_shares;
      sa[j] = encodeG1(decodeAny(sa[j]).add(d));
      sb[j] = encodeG1(decodeAny(sb[j]).subtract(d));
      c.detail.pair = { validators: [a, b], share: j };
      // Keep the old aggregate: Σ shares is the same, so it stays valid.
      return seal(c, { aggregate: false });
    },
  },
  {
    name: 'cancel_pair_shares_within',
    family: 'share',
    // share_j + D, share_k - D in one validator.
    apply: c => {
      const i = pickV(c);
      const s = dvs(c)[i].public_shares;
      if (s.length < 2) return null;
      const d = G1.BASE.multiply(randomScalar());
      s[0] = encodeG1(decodeAny(s[0]).add(d));
      s[1] = encodeG1(decodeAny(s[1]).subtract(d));
      return seal(c, { aggregate: false });
    },
  },

  // --- validators -------------------------------------------------------
  {
    name: 'duplicate_validator',
    family: 'validators',
    apply: c => {
      if (dvs(c).length < 2) return null;
      const a = int(c.rng, dvs(c).length);
      let b = int(c.rng, dvs(c).length - 1);
      if (b >= a) b++;
      dvs(c)[b] = clone(dvs(c)[a]);
      c.lock.cluster_definition.validators[b] = clone(
        c.lock.cluster_definition.validators[a],
      );
      c.detail.copy = [a, b];
      return seal(c);
    },
  },
  {
    name: 'reorder_validators',
    family: 'validators',
    // Lock validators permuted, definition validators not.
    apply: c => {
      if (dvs(c).length < 2) return null;
      c.lock.distributed_validators = shuffleDerange(c.rng, dvs(c));
      return seal(c);
    },
  },
  {
    name: 'reorder_validators_consistent',
    family: 'validators',
    // Lock and definition validators permuted together: still valid.
    apply: c => {
      if (dvs(c).length < 2) return null;
      const order = shuffleDerange(
        c.rng,
        dvs(c).map((_: any, i: number) => i),
      );
      const def = c.lock.cluster_definition;
      c.lock.distributed_validators = order.map((i: number) => dvs(c)[i]);
      def.validators = order.map((i: number) => def.validators[i]);
      c.detail.order = order;
      return seal(c);
    },
  },
  {
    name: 'truncate_validators',
    family: 'lists',
    apply: c => {
      if (dvs(c).length < 2) return null;
      dvs(c).pop();
      return seal(c);
    },
  },
  {
    name: 'truncate_validators_consistent',
    family: 'lists',
    // Drop the last validator from the lock and the definition (num_validators too).
    apply: c => {
      if (dvs(c).length < 2) return null;
      dvs(c).pop();
      c.lock.cluster_definition.validators.pop();
      c.lock.cluster_definition.num_validators--;
      return seal(c);
    },
  },
  {
    name: 'truncate_validators_keep_num',
    family: 'lists',
    // Lock + definition validators dropped, num_validators kept.
    apply: c => {
      if (dvs(c).length < 2) return null;
      dvs(c).pop();
      c.lock.cluster_definition.validators.pop();
      return seal(c);
    },
  },
  {
    name: 'num_validators_change',
    family: 'lists',
    apply: c => {
      const d = c.lock.cluster_definition;
      d.num_validators = pick(c.rng, [
        0,
        d.num_validators + 1,
        Math.max(0, d.num_validators - 1),
      ]);
      c.detail.num_validators = d.num_validators;
      return seal(c);
    },
  },
  {
    name: 'no_validators',
    family: 'lists',
    apply: c => {
      c.lock.distributed_validators = [];
      c.lock.cluster_definition.validators = [];
      c.lock.cluster_definition.num_validators = 0;
      return seal(c);
    },
  },
  {
    name: 'truncate_shares',
    family: 'lists',
    apply: c => {
      dvs(c)[pickV(c)].public_shares.pop();
      return seal(c);
    },
  },
  {
    name: 'truncate_shares_all',
    family: 'lists',
    // Every validator one share short (n-1 shares, still >= t?).
    apply: c => {
      for (const v of dvs(c)) v.public_shares.pop();
      return seal(c);
    },
  },
  {
    name: 'extend_shares',
    family: 'lists',
    apply: c => {
      dvs(c)[pickV(c)].public_shares.push(knownPoint(c));
      return seal(c);
    },
  },
  {
    name: 'extend_shares_on_polynomial',
    family: 'lists',
    // An extra share at x = n + 1 that IS on the polynomial: count mismatch only.
    apply: c => {
      const i = pickV(c);
      const s = dvs(c)[i].public_shares;
      const t = c.lock.cluster_definition.threshold;
      // Y(n+1) by Newton forward differences: Σ_{k<=t} ... use extrapolation
      // through t consecutive points: Y(n+1) = Σ_{l=0..t-1} (-1)^(t-1-l) C(t,l) Y(n+1-t+l).
      const n = s.length;
      if (n < t) return null;
      let acc = G1.ZERO;
      for (let l = 0; l < t; l++) {
        const coeff = binomial(t, l);
        const pt = mulAny(decodeAny(s[n - t + l]), BigInt(coeff));
        acc = (t - 1 - l) % 2 === 0 ? acc.add(pt) : acc.subtract(pt);
      }
      const out = encodeG1(acc);
      s.push(out);
      return seal(c);
    },
  },
  {
    name: 'truncate_node_sigs',
    family: 'lists',
    apply: c => {
      if (!hasBuilder(c)) return null;
      c.lock.node_signatures.pop();
      return c.lock;
    },
  },
  {
    name: 'extend_node_sigs',
    family: 'lists',
    apply: c => {
      if (!hasBuilder(c)) return null;
      c.lock.node_signatures.push(c.lock.node_signatures[0]);
      return c.lock;
    },
  },
  {
    name: 'node_sigs_on_v1_6',
    family: 'lists',
    apply: c => {
      if (hasBuilder(c)) return null;
      c.lock.node_signatures = c.base.secrets.nodeKeys.map(k =>
        nodeSignHex(fromHexString(c.lock.lock_hash), k),
      );
      return c.lock;
    },
  },
  {
    name: 'no_node_sigs',
    family: 'lists',
    apply: c => {
      if (!hasBuilder(c)) return null;
      c.lock.node_signatures = pick(c.rng, [[], null]);
      c.detail.value = c.lock.node_signatures;
      return c.lock;
    },
  },
  {
    name: 'truncate_deposits',
    family: 'lists',
    apply: c => {
      if (!v18(c)) return null;
      const i = pickV(c);
      dvs(c)[i].partial_deposit_data.pop();
      return seal(c);
    },
  },
  {
    name: 'extend_deposits_duplicate',
    family: 'lists',
    apply: c => {
      if (!v18(c)) return null;
      const ds = dvs(c)[pickV(c)].partial_deposit_data;
      ds.push(clone(ds[0]));
      return seal(c);
    },
  },
  {
    name: 'extend_deposits_extra_amount_signed',
    family: 'lists',
    // A correctly signed deposit for an amount not in the definition.
    apply: c => {
      if (!v18(c)) return null;
      const i = pickV(c);
      const ds = dvs(c)[i].partial_deposit_data;
      const d = clone(ds[0]);
      d.amount = pick(c.rng, ['1000000000', '7000000000', '32000000001']);
      signDeposit(c.lock, c.base.secrets, d);
      ds.push(d);
      c.detail.amount = d.amount;
      return seal(c);
    },
  },

  // --- threshold --------------------------------------------------------
  {
    name: 'threshold_change',
    family: 'threshold',
    apply: c => {
      const d = c.lock.cluster_definition;
      const n = nOps(c);
      const t = d.threshold;
      d.threshold = pick(c.rng, [0, 1, t - 1, t + 1, n, n + 1]);
      if (d.threshold === t) return null;
      c.detail.threshold = [t, d.threshold];
      return seal(c);
    },
  },

  // --- addresses and amounts --------------------------------------------
  {
    name: 'withdrawal_change',
    family: 'fields',
    apply: c => {
      const i = pickV(c);
      c.lock.cluster_definition.validators[i].withdrawal_address = randomAddr();
      return seal(c);
    },
  },
  {
    name: 'withdrawal_change_creds_updated',
    family: 'fields',
    // Definition + deposit credentials updated, deposit signature not.
    apply: c => {
      const i = pickV(c);
      const w = randomAddr();
      c.lock.cluster_definition.validators[i].withdrawal_address = w;
      const comp = c.lock.cluster_definition.compounding === true;
      for (const d of depositsOf(c.lock, i))
        d.withdrawal_credentials = credentials(w, comp);
      return seal(c);
    },
  },
  {
    name: 'withdrawal_change_resigned',
    family: 'fields',
    // Definition + credentials updated and deposits re-signed: valid.
    apply: c => {
      const i = pickV(c);
      const w = randomAddr();
      c.lock.cluster_definition.validators[i].withdrawal_address = w;
      const comp = c.lock.cluster_definition.compounding === true;
      for (const d of depositsOf(c.lock, i)) {
        d.withdrawal_credentials = credentials(w, comp);
        signDeposit(c.lock, c.base.secrets, d);
      }
      return seal(c);
    },
  },
  {
    name: 'withdrawal_checksum_case',
    family: 'fields',
    // Mixed-case withdrawal address in the definition (hash bytes unchanged).
    apply: c => {
      const i = pickV(c);
      const v = c.lock.cluster_definition.validators[i];
      v.withdrawal_address = mixedCase(v.withdrawal_address, c.rng);
      return seal(c);
    },
  },
  {
    name: 'fee_recipient_change',
    family: 'fields',
    apply: c => {
      const i = pickV(c);
      c.lock.cluster_definition.validators[i].fee_recipient_address =
        randomAddr();
      return seal(c);
    },
  },
  {
    name: 'fee_recipient_change_message_updated',
    family: 'fields',
    apply: c => {
      if (!hasBuilder(c)) return null;
      const i = pickV(c);
      const f = randomAddr();
      c.lock.cluster_definition.validators[i].fee_recipient_address = f;
      dvs(c)[i].builder_registration.message.fee_recipient = f;
      return seal(c);
    },
  },
  {
    name: 'fee_recipient_change_resigned',
    family: 'fields',
    apply: c => {
      if (!hasBuilder(c)) return null;
      const i = pickV(c);
      const f = randomAddr();
      c.lock.cluster_definition.validators[i].fee_recipient_address = f;
      dvs(c)[i].builder_registration.message.fee_recipient = f;
      signBuilder(c.lock, c.base.secrets, i);
      return seal(c);
    },
  },
  {
    name: 'builder_message_fee_recipient_only',
    family: 'fields',
    // Registration message fee recipient changed (and re-signed), definition not.
    apply: c => {
      if (!hasBuilder(c)) return null;
      const i = pickV(c);
      dvs(c)[i].builder_registration.message.fee_recipient = randomAddr();
      signBuilder(c.lock, c.base.secrets, i);
      return seal(c);
    },
  },
  {
    name: 'builder_gas_timestamp_resigned',
    family: 'fields',
    apply: c => {
      if (!hasBuilder(c)) return null;
      const i = pickV(c);
      const m = dvs(c)[i].builder_registration.message;
      m.gas_limit = pick(c.rng, [30000000, 36000000, 0, 1]);
      m.timestamp = pick(c.rng, [0, 1606824023, 1800000000]);
      c.detail.message = { gas_limit: m.gas_limit, timestamp: m.timestamp };
      signBuilder(c.lock, c.base.secrets, i);
      return seal(c);
    },
  },
  {
    name: 'builder_pubkey_other_validator',
    family: 'fields',
    // Message pubkey = another validator's key, signed by that key.
    apply: c => {
      if (!hasBuilder(c) || dvs(c).length < 2) return null;
      const i = pickV(c);
      const o = (i + 1) % dvs(c).length;
      const r = dvs(c)[i].builder_registration;
      r.message.pubkey = dvs(c)[o].distributed_public_key;
      signBuilder(c.lock, c.base.secrets, i);
      return seal(c);
    },
  },
  {
    name: 'builder_missing',
    family: 'fields',
    apply: c => {
      if (!hasBuilder(c)) return null;
      delete dvs(c)[pickV(c)].builder_registration;
      return seal(c);
    },
  },
  {
    name: 'builder_on_v1_6',
    family: 'fields',
    apply: c => {
      if (hasBuilder(c)) return null;
      const i = pickV(c);
      const v = dvs(c)[i];
      v.builder_registration = {
        message: {
          fee_recipient:
            c.lock.cluster_definition.validators[i].fee_recipient_address,
          gas_limit: 30000000,
          timestamp: 1700000000,
          pubkey: v.distributed_public_key,
        },
        signature: '0x' + '00'.repeat(96),
      };
      return seal(c);
    },
  },
  {
    name: 'amount_change',
    family: 'fields',
    // Deposit amount changed in the lock, not re-signed.
    apply: c => {
      const i = pickV(c);
      const d = pick(c.rng, depositsOf(c.lock, i));
      d.amount = String(BigInt(d.amount) + 1000000000n);
      return seal(c);
    },
  },
  {
    name: 'amount_change_resigned',
    family: 'fields',
    // One deposit's amount changed and re-signed: the definition amount is missing.
    apply: c => {
      const i = pickV(c);
      const d = pick(c.rng, depositsOf(c.lock, i));
      d.amount = String(BigInt(d.amount) + 1000000000n);
      signDeposit(c.lock, c.base.secrets, d);
      return seal(c);
    },
  },
  {
    name: 'definition_amounts_change_resigned',
    family: 'fields',
    // deposit_amounts and every deposit changed consistently and re-signed.
    apply: c => {
      if (!v18(c)) return null;
      const comp = c.lock.cluster_definition.compounding === true;
      const amounts = pick(c.rng, [
        ['500000000', '31500000000'], // 0.5 ETH: below Charon's 1 ETH minimum
        ['16000000000'], // sum below 32 ETH
        ['64000000000'], // above 32 ETH (ok only with compounding)
        ['2048000000000'], // max compounding
        ['2049000000000'], // above max compounding
        ['1000000000', '31000000000'],
        ['32000000000', '32000000000'], // duplicate amount
        [], // empty: Charon DKG would use its defaults
        ['0'],
      ]);
      c.lock.cluster_definition.deposit_amounts = amounts;
      const dedup = [...new Set(amounts)];
      dvs(c).forEach((v: any, i: number) => {
        const w = c.lock.cluster_definition.validators[i].withdrawal_address;
        v.partial_deposit_data = (dedup.length ? dedup : ['32000000000']).map(
          a => {
            const d: any = {
              pubkey: v.distributed_public_key,
              withdrawal_credentials: credentials(w, comp),
              amount: a,
            };
            signDeposit(c.lock, c.base.secrets, d);
            return d;
          },
        );
      });
      c.detail.amounts = amounts;
      return seal(c);
    },
  },
  {
    name: 'compounding_toggle_resigned',
    family: 'fields',
    apply: c => {
      const def = c.lock.cluster_definition;
      if (def.compounding === undefined) return null;
      def.compounding = !def.compounding;
      dvs(c).forEach((_v: any, i: number) => {
        for (const d of depositsOf(c.lock, i)) {
          d.withdrawal_credentials = credentials(
            def.validators[i].withdrawal_address,
            def.compounding,
          );
          signDeposit(c.lock, c.base.secrets, d);
        }
      });
      return seal(c);
    },
  },
  {
    name: 'compounding_toggle_only',
    family: 'fields',
    apply: c => {
      const def = c.lock.cluster_definition;
      if (def.compounding === undefined) return null;
      def.compounding = !def.compounding;
      return seal(c);
    },
  },
  {
    name: 'compounding_on_v1_8',
    family: 'fields',
    // compounding: true on a v1.8 definition (not a v1.8 field) with 0x02 creds.
    apply: c => {
      const def = c.lock.cluster_definition;
      if (def.version !== 'v1.8.0') return null;
      def.compounding = true;
      dvs(c).forEach((_v: any, i: number) => {
        for (const d of depositsOf(c.lock, i)) {
          d.withdrawal_credentials = credentials(
            def.validators[i].withdrawal_address,
            true,
          );
          signDeposit(c.lock, c.base.secrets, d);
        }
      });
      return seal(c);
    },
  },
  {
    name: 'deposit_pubkey_other_validator',
    family: 'fields',
    apply: c => {
      if (dvs(c).length < 2) return null;
      const i = pickV(c);
      const o = (i + 1) % dvs(c).length;
      const d = pick(c.rng, depositsOf(c.lock, i));
      d.pubkey = dvs(c)[o].distributed_public_key;
      signDeposit(c.lock, c.base.secrets, d);
      return seal(c);
    },
  },
  {
    name: 'deposit_creds_0x00',
    family: 'fields',
    apply: c => {
      const i = pickV(c);
      for (const d of depositsOf(c.lock, i)) {
        d.withdrawal_credentials = '0x00' + d.withdrawal_credentials.slice(4);
        signDeposit(c.lock, c.base.secrets, d);
      }
      return seal(c);
    },
  },
  {
    name: 'fork_version_change',
    family: 'fields',
    apply: c => {
      c.lock.cluster_definition.fork_version = pick(c.rng, [
        '0x00000000',
        '0x90000069',
        '0x00000064',
        '0x01017000',
      ]);
      c.detail.fork = c.lock.cluster_definition.fork_version;
      return seal(c);
    },
  },
  {
    name: 'fork_version_change_resigned',
    family: 'fields',
    // Everything re-signed for the new fork (mainnet / gnosis / sepolia / unknown).
    apply: c => {
      c.lock.cluster_definition.fork_version = pick(c.rng, [
        '0x00000000',
        '0x00000064',
        '0x90000069',
        '0x12345678',
      ]);
      c.detail.fork = c.lock.cluster_definition.fork_version;
      dvs(c).forEach((_v: any, i: number) => {
        for (const d of depositsOf(c.lock, i))
          signDeposit(c.lock, c.base.secrets, d);
        signBuilder(c.lock, c.base.secrets, i);
      });
      return seal(c);
    },
  },
  {
    name: 'version_change',
    family: 'fields',
    apply: c => {
      c.lock.cluster_definition.version = pick(c.rng, [
        'v1.9.0',
        'v1.5.0',
        'v1.12.0',
        'v1.10.0',
        'v1.8.0',
        'v1.11.0',
        'V1.10.0',
        '',
      ]);
      c.detail.version = c.lock.cluster_definition.version;
      return seal(c);
    },
  },

  // --- cancelling signature pairs (S + D, S - D) -------------------------
  {
    name: 'cancel_pair_deposit',
    family: 'cancel_pair',
    apply: c => {
      if (dvs(c).length < 2) return null;
      const [a, b] = twoDistinct(c);
      const da = depositsOf(c.lock, a)[0];
      const db = depositsOf(c.lock, b)[0];
      [da.signature, db.signature] = offsetSignaturePair(
        da.signature,
        db.signature,
      );
      return seal(c);
    },
  },
  {
    name: 'cancel_pair_deposit_same_validator',
    family: 'cancel_pair',
    apply: c => {
      if (!v18(c)) return null;
      const i = pickV(c);
      const ds = depositsOf(c.lock, i);
      if (ds.length < 2) return null;
      [ds[0].signature, ds[1].signature] = offsetSignaturePair(
        ds[0].signature,
        ds[1].signature,
      );
      return seal(c);
    },
  },
  {
    name: 'cancel_pair_builder',
    family: 'cancel_pair',
    apply: c => {
      if (!hasBuilder(c) || dvs(c).length < 2) return null;
      const [a, b] = twoDistinct(c);
      const ra = dvs(c)[a].builder_registration;
      const rb = dvs(c)[b].builder_registration;
      [ra.signature, rb.signature] = offsetSignaturePair(
        ra.signature,
        rb.signature,
      );
      return seal(c);
    },
  },
  {
    name: 'cancel_pair_deposit_builder',
    family: 'cancel_pair',
    // Deposit of one validator + builder of another.
    apply: c => {
      if (!hasBuilder(c) || dvs(c).length < 2) return null;
      const [a, b] = twoDistinct(c);
      const da = depositsOf(c.lock, a)[0];
      const rb = dvs(c)[b].builder_registration;
      [da.signature, rb.signature] = offsetSignaturePair(
        da.signature,
        rb.signature,
      );
      return seal(c);
    },
  },

  // --- signature encodings ----------------------------------------------
  {
    name: 'signature_identity',
    family: 'encoding',
    apply: c => {
      const inf = '0xc0' + '00'.repeat(95);
      const where = pick(c.rng, ['deposit', 'builder', 'aggregate']);
      c.detail.where = where;
      if (where === 'aggregate') {
        c.lock.signature_aggregate = inf;
        return c.lock;
      }
      if (where === 'builder') {
        if (!hasBuilder(c)) return null;
        dvs(c)[pickV(c)].builder_registration.signature = inf;
      } else {
        pick(c.rng, depositsOf(c.lock, pickV(c))).signature = inf;
      }
      return seal(c);
    },
  },
  {
    name: 'signature_noncanonical_flags',
    family: 'encoding',
    // Compression flag cleared / infinity flag set / sign flag flipped on a G2 signature.
    apply: c => {
      const where = pick(c.rng, ['deposit', 'builder', 'aggregate']);
      const how = pick(c.rng, ['clear_c', 'set_inf', 'flip_sign', 'set_all']);
      c.detail.where = where;
      c.detail.how = how;
      const edit = (h: string): string => {
        const b = fromHexString(h);
        if (how === 'clear_c') b[0] &= 0x7f;
        if (how === 'set_inf') b[0] |= 0x40;
        if (how === 'flip_sign') b[0] ^= 0x20;
        if (how === 'set_all') b[0] |= 0xe0;
        return hex(b);
      };
      if (where === 'aggregate') {
        c.lock.signature_aggregate = edit(c.lock.signature_aggregate);
        return c.lock;
      }
      if (where === 'builder') {
        if (!hasBuilder(c)) return null;
        const r = dvs(c)[pickV(c)].builder_registration;
        r.signature = edit(r.signature);
      } else {
        const d = pick(c.rng, depositsOf(c.lock, pickV(c)));
        d.signature = edit(d.signature);
      }
      return seal(c);
    },
  },
  {
    name: 'g1_noncanonical_x_plus_p',
    family: 'encoding',
    // x + p (< 2^381) encoding of a share or group key.
    apply: c => {
      for (let tries = 0; tries < 50; tries++) {
        const i = int(c.rng, dvs(c).length);
        const v = dvs(c)[i];
        const j = int(c.rng, v.public_shares.length + 1);
        const cur = j === 0 ? v.distributed_public_key : v.public_shares[j - 1];
        const out = xPlusP(cur);
        if (out === null) continue;
        c.detail.validator = i;
        c.detail.point = j === 0 ? 'group_key' : `share ${j - 1}`;
        // Same point, so the same discrete log: the aggregate (and, for the
        // group key, deposits and builder registration) are re-signed and
        // only the encoding is wrong.
        const k = secretOf(c.base.secrets, cur);
        if (k !== null) learn(c, out, k);
        if (j === 0) {
          v.distributed_public_key = out;
          for (const d of depositsOf(c.lock, i)) {
            d.pubkey = out;
            signDeposit(c.lock, c.base.secrets, d);
          }
          if (v.builder_registration) {
            v.builder_registration.message.pubkey = out;
            signBuilder(c.lock, c.base.secrets, i);
          }
        } else v.public_shares[j - 1] = out;
        return seal(c);
      }
      return null;
    },
  },
  {
    name: 'g1_noncanonical_x_plus_p_share_late',
    family: 'encoding',
    // x + p encoding of a share at x >= t (the SDK decodes those unchecked).
    apply: c => {
      const t = c.lock.cluster_definition.threshold;
      for (let tries = 0; tries < 50; tries++) {
        const i = int(c.rng, dvs(c).length);
        const v = dvs(c)[i];
        if (v.public_shares.length <= t) return null;
        const j = t + int(c.rng, v.public_shares.length - t);
        const cur = v.public_shares[j];
        const out = xPlusP(cur);
        if (out === null) continue;
        const k = secretOf(c.base.secrets, cur);
        if (k !== null) learn(c, out, k);
        c.detail.validator = i;
        c.detail.point = `share ${j}`;
        v.public_shares[j] = out;
        return seal(c);
      }
      return null;
    },
  },
  {
    name: 'g2_noncanonical_x_plus_p',
    family: 'encoding',
    // A valid signature re-encoded with x.c0 + p (or x.c1 + p when it fits).
    apply: c => {
      const where = pick(c.rng, ['deposit', 'builder', 'aggregate']);
      const part = pick(c.rng, ['c0', 'c1']);
      c.detail.where = where;
      c.detail.part = part;
      const edit = (h: string): string | null => {
        const b = fromHexString(h);
        const off = part === 'c1' ? 0 : 48;
        const flags = part === 'c1' ? b[0] & 0xe0 : 0;
        const xs = b.slice(off, off + 48);
        if (part === 'c1') xs[0] &= 0x1f;
        const y = BigInt(hex(xs)) + P;
        if (y >= 1n << (part === 'c1' ? 381n : 384n)) return null;
        const out = numberToBytesBE(y, 48);
        out[0] |= flags;
        b.set(out, off);
        return hex(b);
      };
      if (where === 'aggregate') {
        const out = edit(c.lock.signature_aggregate);
        if (out === null) return null;
        // Not resealed: lock_hash does not cover signature_aggregate.
        c.lock.signature_aggregate = out;
        return c.lock;
      }
      const i = pickV(c);
      if (where === 'builder') {
        if (!hasBuilder(c)) return null;
        const r = dvs(c)[i].builder_registration;
        const out = edit(r.signature);
        if (out === null) return null;
        r.signature = out;
      } else {
        const d = pick(c.rng, depositsOf(c.lock, i));
        const out = edit(d.signature);
        if (out === null) return null;
        d.signature = out;
      }
      return seal(c);
    },
  },
  {
    name: 'g1_bad_flags',
    family: 'encoding',
    apply: c => {
      const how = pick(c.rng, [
        'clear_compression',
        'set_infinity',
        'infinity_without_compression',
        'set_all_flags',
        'infinity_nonzero_x',
      ]);
      c.detail.how = how;
      const groupKey = c.rng() < 0.3;
      const edit = (h: string): string => {
        const b = fromHexString(h);
        if (how === 'clear_compression') b[0] &= 0x7f;
        if (how === 'set_infinity') b[0] |= 0x40;
        if (how === 'infinity_without_compression') b[0] = (b[0] & 0x1f) | 0x40;
        if (how === 'set_all_flags') b[0] |= 0xe0;
        if (how === 'infinity_nonzero_x') {
          b.fill(0);
          b[0] = 0xc0;
          b[47] = 1;
        }
        return hex(b);
      };
      if (groupKey) {
        c.detail.point = 'group_key';
        return groupKeyEverywhere((_c, k) => edit(k))(c);
      }
      return shareEdit((_c, s) => edit(s))(c);
    },
  },
  {
    name: 'g1_x_not_on_curve',
    family: 'encoding',
    apply: shareEdit(c => {
      for (;;) {
        const b = crypto.getRandomValues(new Uint8Array(48));
        b[0] = (b[0] & 0x1f) | 0x80;
        const x = BigInt(hex(b.map((v, k) => (k === 0 ? v & 0x1f : v))));
        if (x >= P) continue;
        try {
          Fp.sqrt(Fp.add(Fp.mul(Fp.sqr(x), x), 4n));
        } catch {
          c.detail.kind = 'x without a curve point';
          return hex(b);
        }
      }
    }),
  },
  {
    name: 'g1_x_ge_p',
    family: 'encoding',
    // x in [p, 2^381): not a field element.
    apply: shareEdit(() => {
      const b = numberToBytesBE(
        P + BigInt(Math.floor(Math.random() * 1e9)),
        48,
      );
      b[0] |= 0x80;
      return hex(b);
    }),
  },
  {
    name: 'malformed_hex',
    family: 'encoding',
    apply: c => {
      const fields = hexFields(c.lock);
      const [obj, key, path] = pick(c.rng, fields);
      const [how, f] = pick(c.rng, MALFORMED_HEX);
      c.detail.path = path;
      c.detail.how = how;
      if (typeof obj[key] !== 'string') return null;
      obj[key] = f(obj[key]);
      // Reseal when the SDK hashing can still encode it (it often cannot).
      if (c.rng() < 0.5 && !String(path).includes('hash')) {
        c.detail.resealed = true;
        return seal(c);
      }
      return c.lock;
    },
  },

  // --- node signatures (secp256k1) ----------------------------------------
  {
    name: 'node_sig_64_bytes',
    family: 'node_sig',
    apply: nodeSigEdit((_c, s) => s.slice(0, 64)),
  },
  {
    name: 'node_sig_all_64_bytes',
    family: 'node_sig',
    apply: c => {
      if (!hasBuilder(c)) return null;
      c.lock.node_signatures = c.lock.node_signatures.map((s: string) =>
        s.slice(0, 130),
      );
      return c.lock;
    },
  },
  {
    name: 'node_sig_wrong_v',
    family: 'node_sig',
    apply: nodeSigEdit((_c, s) => {
      s[64] ^= 1;
      return s;
    }),
  },
  {
    name: 'node_sig_v_plus_27',
    family: 'node_sig',
    apply: nodeSigEdit((_c, s) => {
      s[64] += 27;
      return s;
    }),
  },
  {
    name: 'node_sig_bad_v',
    family: 'node_sig',
    apply: nodeSigEdit((c, s) => {
      s[64] = pick(c.rng, [2, 3, 4, 26, 29, 31, 35, 255]);
      c.detail.v = s[64];
      return s;
    }),
  },
  {
    name: 'node_sig_high_s',
    family: 'node_sig',
    // (r, n - s) with the recovery bit flipped: the same key recovers.
    apply: nodeSigEdit((_c, s) => {
      const sv = BigInt(hex(s.slice(32, 64)));
      s.set(numberToBytesBE(N_K1 - sv, 32), 32);
      s[64] ^= 1;
      return s;
    }),
  },
  {
    name: 'node_sig_high_s_same_v',
    family: 'node_sig',
    apply: nodeSigEdit((_c, s) => {
      const sv = BigInt(hex(s.slice(32, 64)));
      s.set(numberToBytesBE(N_K1 - sv, 32), 32);
      return s;
    }),
  },
  {
    name: 'node_sig_swapped',
    family: 'node_sig',
    apply: c => {
      if (!hasBuilder(c) || c.lock.node_signatures.length < 2) return null;
      const s = c.lock.node_signatures;
      [s[0], s[1]] = [s[1], s[0]];
      return c.lock;
    },
  },
  {
    name: 'node_sig_extra_bytes',
    family: 'node_sig',
    apply: nodeSigEdit((_c, s) => {
      const out = new Uint8Array(66);
      out.set(s);
      return out;
    }),
  },
  {
    name: 'operators_swapped',
    family: 'node_sig',
    // Two operators' ENRs swapped (node signatures re-signed in key order).
    apply: c => {
      const ops = c.lock.cluster_definition.operators;
      [ops[0], ops[1]] = [ops[1], ops[0]];
      return seal(c);
    },
  },
];

/** Applies 2–3 random mutations (other than combos) in sequence. */
export const COMBO: Mutation = {
  name: 'combo',
  family: 'combo',
  apply: c => {
    const k = 2 + int(c.rng, 2);
    const names: string[] = [];
    for (let m = 0; m < k; m++) {
      const mut = pick(
        c.rng,
        MUTATIONS.filter(x => x.family !== 'baseline'),
      );
      const before = clone(c.lock);
      let out: any = null;
      try {
        out = mut.apply(c);
      } catch {
        out = null; // e.g. an earlier step removed the validators it needs
      }
      if (out === null) c.lock = before;
      else {
        c.lock = out;
        names.push(mut.name);
      }
    }
    c.detail.combo = names;
    return names.length > 0 ? c.lock : null;
  },
};

export const ALL_MUTATIONS: Mutation[] = [...MUTATIONS, COMBO];

export const applyMutation = (
  base: Base,
  mutation: Mutation,
  rng: Rng = Math.random,
): { lock: any; detail: Record<string, unknown> } | null => {
  const ctx: Ctx = {
    // Secrets are extended by mutations (new known points): copy them.
    base: { ...base, secrets: clone(base.secrets) },
    lock: clone(base.lock),
    rng,
    detail: {},
  };
  let lock: any;
  try {
    lock = mutation.apply(ctx);
  } catch {
    return null;
  }
  return lock === null || lock === undefined
    ? null
    : { lock, detail: ctx.detail };
};

// --- helpers --------------------------------------------------------------

function binomial(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}
function randomAddr(): string {
  return hex(crypto.getRandomValues(new Uint8Array(20)));
}
function mixedCase(addr: string, rng: Rng): string {
  return (
    '0x' +
    [...addr.slice(2)].map(ch => (rng() < 0.5 ? ch.toUpperCase() : ch)).join('')
  );
}
function shuffleDerange<T>(rng: Rng, xs: T[]): T[] {
  for (;;) {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    if (out.some((x, i) => x !== xs[i])) return out;
  }
}
function twoDistinct(c: Ctx): [number, number] {
  const n = c.lock.distributed_validators.length;
  const a = Math.floor(c.rng() * n);
  let b = Math.floor(c.rng() * (n - 1));
  if (b >= a) b++;
  c.detail.validators = [a, b];
  return [a, b];
}
function nodeSignHex(digest: Uint8Array, key: string): string {
  const sig = secp256k1.sign(digest, fromHexString(key), {
    prehash: false,
    lowS: true,
    format: 'recovered',
  } as any) as Uint8Array;
  const out = new Uint8Array(65);
  out.set(sig.subarray(1), 0);
  out[64] = sig[0];
  return hex(out);
}
