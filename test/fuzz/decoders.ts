// Low-level decoder and hashing fuzz:
//
//  1. G1 point decoding: the SDK's decodeG1Unchecked / decodeG1(b, false) /
//     decodeG1(b, true), noble's G1.Point.fromBytes, @chainsafe/blst
//     PublicKey.fromBytes(b, true), Charon's herumi PublicKey.Deserialize (via
//     charon-oracle decode) and a straightforward reference implementation of
//     the ZCash compressed encoding (IETF BLS / Ethereum consensus KeyValidate).
//  2. G2 signature decoding: noble Signature.fromBytes (what the SDK uses) vs
//     blst Signature.fromBytes(b, true) vs a reference.
//  3. Sliced vs one-shot SSZ hashing vs Charon's hashes on structurally valid
//     random-byte locks, including validator counts around the 256-root slice.
//
//   node build/decoders.mjs --out DIR --oracle PATH [--n 20000]
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as blst from '@chainsafe/blst';
import { fromHexString } from '@chainsafe/ssz';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { bytesToHex, numberToBytesBE } from '@noble/curves/utils.js';
import { decodeG1, decodeG1Unchecked } from '../../src/internal/bls.js';
import { g1OutsideSubgroup } from '../helpers/syntheticLock.js';
import { encodeG1 } from './mutations.js';
import { sdkHashes } from './sdkRunner.js';

const args = process.argv.slice(2);
const arg = (name: string, fallback?: string): string => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) return args[i + 1];
  if (fallback === undefined) throw new Error(`--${name} is required`);
  return fallback;
};
const OUT = arg('out');
const ORACLE = arg('oracle');
const N = Number(arg('n', '20000'));
mkdirSync(OUT, { recursive: true });

const G1 = bls12_381.G1.Point;
const G2 = bls12_381.G2.Point;
const { Fp, Fp2 } = bls12_381.fields;
const P = Fp.ORDER;
const R = bls12_381.fields.Fr.ORDER;
const HALF = (P - 1n) / 2n;
const hex = (b: Uint8Array): string => '0x' + bytesToHex(b);
const rand = (n: number): Uint8Array =>
  crypto.getRandomValues(new Uint8Array(n));
const int = (n: number): number => Math.floor(Math.random() * n);
const big = (b: Uint8Array): bigint =>
  b.length === 0 ? 0n : BigInt('0x' + bytesToHex(b));

// --- reference G1 (ZCash compressed, KeyValidate) -------------------------
type Ref =
  | { ok: false; why: string }
  | { ok: true; infinity: boolean; x: bigint; y: bigint; subgroup: boolean };
const mulAny = (q: typeof G1.BASE, k: bigint): typeof G1.BASE => {
  let acc = G1.ZERO;
  for (const bit of k.toString(2)) {
    acc = acc.double();
    if (bit === '1') acc = acc.add(q);
  }
  return acc;
};
export const refG1 = (b: Uint8Array): Ref => {
  if (b.length !== 48) return { ok: false, why: 'length' };
  const c = (b[0] & 0x80) !== 0;
  const inf = (b[0] & 0x40) !== 0;
  const sign = (b[0] & 0x20) !== 0;
  if (!c) return { ok: false, why: 'not compressed' };
  const rest = b.slice();
  rest[0] &= 0x1f;
  const x = big(rest);
  if (inf) {
    if (sign || x !== 0n) return { ok: false, why: 'bad infinity' };
    return { ok: true, infinity: true, x: 0n, y: 0n, subgroup: true };
  }
  if (x >= P) return { ok: false, why: 'x >= p' };
  const rhs = Fp.add(Fp.mul(Fp.sqr(x), x), 4n);
  let y: bigint;
  try {
    y = Fp.sqrt(rhs);
  } catch {
    return { ok: false, why: 'not on curve' };
  }
  if (Fp.sqr(y) !== rhs) return { ok: false, why: 'not on curve' };
  if (y > HALF !== sign) y = Fp.neg(y);
  const pt = G1.fromAffine({ x, y });
  return { ok: true, infinity: false, x, y, subgroup: mulAny(pt, R).is0() };
};

const outcome = (fn: () => { x: bigint; y: bigint } | null): string => {
  try {
    const p = fn();
    return p === null ? 'ok:inf' : `ok:${p.x.toString(16)}:${p.y.toString(16)}`;
  } catch (e: any) {
    return 'err';
  }
};
const affine = (p: typeof G1.BASE): { x: bigint; y: bigint } | null =>
  p.is0() ? null : p.toAffine();

// --- inputs ------------------------------------------------------------------
const valid = (): Uint8Array => G1.BASE.multiply(1n + big(rand(31))).toBytes();
const OFF = fromHexString(g1OutsideSubgroup());
const offPoint = decodeG1Unchecked(OFF);
const TORSION = mulAny(offPoint, R);
const g1Inputs = (): Array<[string, Uint8Array]> => {
  const out: Array<[string, Uint8Array]> = [];
  const add = (k: string, b: Uint8Array): void => {
    out.push([k, b]);
  };
  // Edge cases.
  const inf = new Uint8Array(48);
  inf[0] = 0xc0;
  add('infinity', inf);
  add(
    'infinity_sign',
    Uint8Array.from(inf, (v, i) => (i === 0 ? 0xe0 : v)),
  );
  add(
    'infinity_no_c',
    Uint8Array.from(inf, (v, i) => (i === 0 ? 0x40 : v)),
  );
  add(
    'infinity_x1',
    Uint8Array.from(inf, (v, i) => (i === 47 ? 1 : v)),
  );
  add('zero', new Uint8Array(48));
  add(
    'c_only_x0',
    Uint8Array.from(inf, (v, i) => (i === 0 ? 0x80 : v)),
  );
  add(
    'c_sign_x0',
    Uint8Array.from(inf, (v, i) => (i === 0 ? 0xa0 : v)),
  );
  add('generator', G1.BASE.toBytes());
  add('neg_generator', G1.BASE.negate().toBytes());
  add('off_subgroup', OFF);
  add('torsion', fromHexString(encodeG1(TORSION)));
  add('uncompressed_96', G1.BASE.toBytes(false));
  add('empty', new Uint8Array(0));
  add('len47', valid().slice(0, 47));
  add('len49', Uint8Array.from([...valid(), 0]));
  // x = p, p-1, 2^381-1 ...
  for (const x of [P, P - 1n, P + 1n, (1n << 381n) - 1n, 0n, 1n, 2n, 3n, 4n]) {
    for (const flags of [0x80, 0xa0]) {
      if (x >= 1n << 381n) continue;
      const b = numberToBytesBE(x, 48);
      b[0] |= flags;
      add(
        `x=${x === P ? 'p' : x === P - 1n ? 'p-1' : x === P + 1n ? 'p+1' : x.toString(16).slice(0, 8)} f=${flags.toString(16)}`,
        b,
      );
    }
  }
  return out;
};
const randomG1 = (): [string, Uint8Array] => {
  switch (int(12)) {
    case 0:
      return ['random', rand(48)];
    case 1: {
      const b = rand(48);
      b[0] = (b[0] & 0x1f) | 0x80;
      return ['random_c', b];
    }
    case 2: {
      const b = valid();
      return ['valid', b];
    }
    case 3: {
      const b = valid();
      b[int(48)] ^= 1 << int(8);
      return ['valid_flip_bit', b];
    }
    case 4: {
      const b = valid();
      b[0] ^= 0x20;
      return ['valid_flip_sign', b];
    }
    case 5: {
      const b = valid();
      b[0] |= 0x40;
      return ['valid_set_inf', b];
    }
    case 6: {
      const b = valid();
      b[0] &= 0x7f;
      return ['valid_clear_c', b];
    }
    case 7: {
      // x + p when it fits.
      for (;;) {
        const b = valid();
        const flags = b[0] & 0xe0;
        b[0] &= 0x1f;
        const y = big(b) + P;
        if (y >= 1n << 381n) continue;
        const o = numberToBytesBE(y, 48);
        o[0] |= flags;
        return ['valid_x_plus_p', o];
      }
    }
    case 8: {
      const q = decodeG1Unchecked(OFF).add(
        G1.BASE.multiply(1n + big(rand(31))),
      );
      return ['off_subgroup_random', fromHexString(encodeG1(q))];
    }
    case 9: {
      const q = G1.BASE.multiply(1n + big(rand(31))).add(TORSION);
      return ['valid_plus_torsion', fromHexString(encodeG1(q))];
    }
    case 10: {
      const b = new Uint8Array(48);
      b[0] = 0xc0 | (int(2) ? 0x20 : 0);
      b[1 + int(47)] = int(2) ? 0 : 1 + int(255);
      return ['infinity_variant', b];
    }
    default: {
      // x in [p, 2^381)
      const x = P + (big(rand(47)) % ((1n << 381n) - P));
      const b = numberToBytesBE(x, 48);
      b[0] |= int(2) ? 0x80 : 0xa0;
      return ['x_ge_p', b];
    }
  }
};

// --- run G1 -------------------------------------------------------------------
interface G1Row {
  kind: string;
  input: string;
  ref: string;
  refSubgroup?: boolean;
  sdkUnchecked: string;
  sdkDecodeFalse: string;
  sdkDecodeTrue: string;
  noble: string;
  blst: string;
  herumi?: string;
}
const rows: G1Row[] = [];
const inputs: Array<[string, Uint8Array]> = [...g1Inputs()];
while (inputs.length < N) inputs.push(randomG1());
for (const [kind, b] of inputs) {
  const r = refG1(b);
  rows.push({
    kind,
    input: hex(b),
    ref: !r.ok
      ? `err`
      : r.infinity
        ? 'ok:inf'
        : `ok:${r.x.toString(16)}:${r.y.toString(16)}`,
    ...(r.ok ? { refSubgroup: r.subgroup } : {}),
    sdkUnchecked: outcome(() => affine(decodeG1Unchecked(b))),
    sdkDecodeFalse: outcome(() => affine(decodeG1(b, false))),
    sdkDecodeTrue: outcome(() => affine(decodeG1(b, true))),
    noble: outcome(() => affine(G1.fromBytes(b))),
    blst: (() => {
      try {
        const pk = blst.PublicKey.fromBytes(b, true);
        const q = G1.fromBytes(pk.toBytes(true));
        return outcome(() => affine(q));
      } catch {
        return 'err';
      }
    })(),
  });
}
// Herumi via charon-oracle decode.
const herumi = spawnSync(ORACLE, ['decode'], {
  input: rows.map(r => r.input || '0x').join('\n') + '\n',
  maxBuffer: 1 << 30,
});
const hlines = herumi.stdout
  .toString()
  .split('\n')
  .filter(l => l !== '')
  .map(l => JSON.parse(l));
const hmap = new Map<string, any>(hlines.map(h => [h.input, h]));
for (const row of rows) {
  const h = hmap.get(row.input || '0x');
  if (h === undefined) continue;
  if (!h.ok) row.herumi = 'err';
  else if (h.zero) row.herumi = 'ok:inf';
  else {
    row.herumi = outcome(() =>
      affine(G1.fromBytes(fromHexString(h.reserialized))),
    );
    if (!h.valid_order) row.herumi += ':bad_order';
  }
}

// Expected: KeyValidate(b) = ref ok, not infinity, in subgroup.
const keyValidate = (r: G1Row): string =>
  r.ref !== 'err' && r.ref !== 'ok:inf' && r.refSubgroup === true
    ? r.ref
    : 'err';
const onCurve = (r: G1Row): string =>
  r.ref !== 'err' && r.ref !== 'ok:inf' ? r.ref : 'err';
interface Diff {
  check: string;
  kind: string;
  input: string;
  expected: string;
  got: string;
}
const diffs: Diff[] = [];
const expect = (
  check: string,
  r: G1Row,
  expected: string,
  got: string | undefined,
): void => {
  if (got === undefined) return;
  // herumi accepts infinity at deserialisation; compare with that in mind separately.
  if (expected !== got)
    diffs.push({ check, kind: r.kind, input: r.input, expected, got });
};
for (const r of rows) {
  expect(
    'sdk decodeG1Unchecked == ref on-curve non-identity',
    r,
    onCurve(r),
    r.sdkUnchecked,
  );
  expect(
    'sdk decodeG1(b,false) == ref on-curve non-identity',
    r,
    onCurve(r),
    r.sdkDecodeFalse,
  );
  expect(
    'sdk decodeG1(b,true) == KeyValidate',
    r,
    keyValidate(r),
    r.sdkDecodeTrue,
  );
  expect('blst fromBytes(b,true) == KeyValidate', r, keyValidate(r), r.blst);
  const hr = r.herumi?.replace(':bad_order', '');
  expect(
    'herumi Deserialize == ref (identity allowed)',
    r,
    r.ref === 'ok:inf' ? 'ok:inf' : keyValidate(r),
    hr,
  );
  expect(
    'noble G1.fromBytes == ref (identity allowed, subgroup)',
    r,
    r.ref === 'ok:inf' ? 'ok:inf' : keyValidate(r),
    r.noble,
  );
}
const summarize = (ds: Diff[]): Record<string, Record<string, number>> => {
  const out: Record<string, Record<string, number>> = {};
  for (const d of ds) {
    const row = (out[d.check] ??= {});
    const cls = (v: string): string =>
      v === 'ok:inf' ? 'identity' : v.startsWith('ok') ? 'point' : 'reject';
    const same =
      d.expected.startsWith('ok:') && d.got.startsWith('ok:')
        ? ' (different point)'
        : '';
    const k = `${d.kind}: expected ${cls(d.expected)} got ${cls(d.got)}${same}`;
    row[k] = (row[k] ?? 0) + 1;
  }
  return out;
};

// --- G2 signatures -------------------------------------------------------------
const g2diffs: Diff[] = [];
const g2Valid = (): Uint8Array =>
  bls12_381.longSignatures.Signature.toBytes(
    G2.BASE.multiply(1n + big(rand(31))),
  );
const nobleSig = (b: Uint8Array): string => {
  try {
    const p = bls12_381.longSignatures.Signature.fromBytes(b);
    if (p.is0()) return 'ok:inf';
    return 'ok:' + bytesToHex(bls12_381.longSignatures.Signature.toBytes(p));
  } catch {
    return 'err';
  }
};
const blstSig = (b: Uint8Array): string => {
  try {
    const s = blst.Signature.fromBytes(b, true);
    const c = s.toBytes(true);
    return c.every((v, i) => (i === 0 ? v === 0xc0 : v === 0))
      ? 'ok:inf'
      : 'ok:' + bytesToHex(c);
  } catch {
    return 'err';
  }
};
const g2Kinds: Array<[string, () => Uint8Array]> = [
  ['valid', g2Valid],
  [
    'flip_bit',
    () => {
      const b = g2Valid();
      b[int(96)] ^= 1 << int(8);
      return b;
    },
  ],
  [
    'c0_plus_p',
    () => {
      const b = g2Valid();
      const c0 = big(b.slice(48)) + P;
      b.set(numberToBytesBE(c0, 48), 48);
      return b;
    },
  ],
  [
    'c1_plus_p',
    () => {
      for (;;) {
        const b = g2Valid();
        const flags = b[0] & 0xe0;
        const x = b.slice(0, 48);
        x[0] &= 0x1f;
        const y = big(x) + P;
        if (y >= 1n << 381n) continue;
        const o = numberToBytesBE(y, 48);
        o[0] |= flags;
        b.set(o, 0);
        return b;
      }
    },
  ],
  [
    'infinity',
    () => {
      const b = new Uint8Array(96);
      b[0] = 0xc0;
      return b;
    },
  ],
  [
    'infinity_dirty',
    () => {
      const b = new Uint8Array(96);
      b[0] = 0xc0;
      b[95] = 1;
      return b;
    },
  ],
  [
    'random_c',
    () => {
      const b = rand(96);
      b[0] = (b[0] & 0x1f) | 0x80;
      return b;
    },
  ],
];
const g2Counts: Record<string, Record<string, number>> = {};
for (let i = 0; i < Math.max(2000, N / 5); i++) {
  const [kind, gen] = g2Kinds[i % g2Kinds.length];
  const b = gen();
  const n = nobleSig(b);
  const s = blstSig(b);
  const key = `${kind}: noble ${n.slice(0, 3)} blst ${s.slice(0, 3)}`;
  (g2Counts[kind] ??= {})[key] = (g2Counts[kind][key] ?? 0) + 1;
  // blst decodes the identity fine; the SDK rejects it on its own, so only
  // compare non-identity outcomes.
  if (n !== s && !(s === 'ok:inf' || n === 'ok:inf')) {
    g2diffs.push({
      check: 'noble Signature.fromBytes == blst Signature.fromBytes(b,true)',
      kind,
      input: hex(b),
      expected: s,
      got: n,
    });
  }
}

// --- sliced vs one-shot vs Charon hashing ----------------------------------------
const randomHashLock = (
  version: string,
  validators: number,
  operators: number,
): any => {
  const a = (): string => hex(rand(20));
  const def: any = {
    name: 'hash-fuzz',
    uuid: randomUUID(),
    version,
    timestamp: '2026-10-19T00:00:00Z',
    num_validators: validators,
    threshold: Math.ceil((2 * operators) / 3),
    dkg_algorithm: 'default',
    fork_version: '0x10000910',
    creator: { address: '', config_signature: '' },
    operators: Array.from({ length: operators }, () => ({
      address: '',
      enr: 'enr:-HW4QNHE5aL5CrfBtTF9Hi2VrssawbiC4xuTUzuk0Mu3wRQSL2mA-XQtlmSQ7brloyZAZKKagpag6KJHOa124gXyklOAgmlkgnY0iXNlY3AyNTZrMaECdAJRmH_MYH0n6WfA_wtyIp3jHSHnNAivFMYGZJlY9Hk',
      config_signature: '',
      enr_signature: '',
    })),
    validators: Array.from({ length: validators }, () => ({
      fee_recipient_address: a(),
      withdrawal_address: a(),
    })),
  };
  const v18 = version !== 'v1.6.0' && version !== 'v1.7.0';
  if (v18) def.deposit_amounts = ['16000000000', '16000000000'];
  if (version === 'v1.10.0' || version === 'v1.11.0') {
    def.consensus_protocol = int(2) ? '' : 'qbft';
    def.target_gas_limit = 36000000;
    def.compounding = int(2) === 0;
  }
  def.config_hash = hex(rand(32));
  def.definition_hash = hex(rand(32));
  const dep = (): any => ({
    pubkey: hex(rand(48)),
    withdrawal_credentials: hex(rand(32)),
    amount: '16000000000',
    signature: hex(rand(96)),
  });
  const lock: any = {
    cluster_definition: def,
    distributed_validators: Array.from({ length: validators }, () => {
      const dv: any = {
        distributed_public_key: hex(rand(48)),
        public_shares: Array.from({ length: operators }, () => hex(rand(48))),
      };
      if (v18) dv.partial_deposit_data = [dep(), dep()];
      else dv.deposit_data = dep();
      if (version !== 'v1.6.0') {
        dv.builder_registration = {
          message: {
            fee_recipient: a(),
            gas_limit: 36000000,
            timestamp: 1700000000 + int(1000),
            pubkey: hex(rand(48)),
          },
          signature: hex(rand(96)),
        };
      }
      return dv;
    }),
    signature_aggregate: hex(rand(96)),
    lock_hash: hex(rand(32)),
    node_signatures:
      version === 'v1.6.0'
        ? undefined
        : Array.from({ length: operators }, () => hex(rand(65))),
  };
  return lock;
};
const hashDir = join(OUT, 'hash-cases');
mkdirSync(hashDir, { recursive: true });
const hashPaths: string[] = [];
const hashSdk = new Map<string, Record<string, string | null>>();
const versions = ['v1.6.0', 'v1.7.0', 'v1.8.0', 'v1.10.0', 'v1.11.0'];
const counts = [0, 1, 2, 7, 255, 256, 257, 511, 512, 513, 1000];
let hc = 0;
for (const version of versions) {
  for (const validators of counts) {
    for (const operators of [4, 7]) {
      const lock = randomHashLock(version, validators, operators);
      // Charon's SetDefinitionHashes recomputes config_hash before hashing
      // the definition; store the right one so both hash the same input.
      if (int(4) !== 0) {
        lock.cluster_definition.config_hash = (await sdkHashes(lock)).config;
      }
      const path = join(
        hashDir,
        `h${hc++}-${version}-${validators}x${operators}.json`,
      );
      writeFileSync(path, JSON.stringify({ lock }));
      hashPaths.push(path);
      hashSdk.set(path, await sdkHashes(lock));
    }
  }
}
const ho = spawnSync(ORACLE, ['lock'], {
  input: hashPaths.join('\n') + '\n',
  maxBuffer: 1 << 30,
});
const hashDiffs: string[] = [];
for (const line of ho.stdout
  .toString()
  .split('\n')
  .filter(l => l !== '')) {
  const o = JSON.parse(line);
  const s = hashSdk.get(o.id)!;
  for (const [k, ck] of [
    ['config', 'config_hash'],
    ['definition', 'definition_hash'],
    ['lock', 'lock_hash'],
  ] as const) {
    if (s[k] !== s[`${k}_sliced`])
      hashDiffs.push(
        `${o.id} ${k}: one-shot ${s[k]} sliced ${s[`${k}_sliced`]}`,
      );
    const lockFile = JSON.parse(readFileSync(o.id, 'utf8')).lock;
    const storedConfigOk =
      lockFile.cluster_definition.config_hash.toLowerCase() === s.config;
    // With a wrong stored config_hash Charon (re)computes it first, the SDK
    // hashes the stored one: only the config hash is comparable then.
    if (k !== 'config' && !storedConfigOk) continue;
    if (o[ck] === undefined)
      hashDiffs.push(
        `${o.id} ${k}: charon did not hash (${o.stage}: ${o.err})`,
      );
    else if (s[k] !== o[ck])
      hashDiffs.push(`${o.id} ${k}: sdk ${s[k]} charon ${o[ck]}`);
  }
}

const report = {
  g1: {
    inputs: rows.length,
    kinds: countBy(rows.map(r => r.kind)),
    diffs: summarize(diffs),
    examples: firstPerKey(diffs),
  },
  g2: {
    counts: g2Counts,
    diffs: summarize(g2diffs),
    examples: firstPerKey(g2diffs),
  },
  hashing: { cases: hashPaths.length, diffs: hashDiffs },
};
writeFileSync(
  join(OUT, 'decoders-report.json'),
  JSON.stringify(report, null, 2),
);
writeFileSync(join(OUT, 'g1-rows.json'), JSON.stringify(rows));
console.log(
  JSON.stringify(
    {
      g1: { inputs: rows.length, diffs: report.g1.diffs },
      g2: { counts: report.g2.counts, diffs: report.g2.diffs },
      hashing: report.hashing,
    },
    null,
    2,
  ),
);

function countBy(xs: string[]): Record<string, number> {
  const o: Record<string, number> = {};
  for (const x of xs) o[x] = (o[x] ?? 0) + 1;
  return o;
}
function firstPerKey(ds: Diff[]): Diff[] {
  const seen = new Set<string>();
  return ds.filter(d => {
    const k = d.check + '|' + d.kind;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
void Fp2;
