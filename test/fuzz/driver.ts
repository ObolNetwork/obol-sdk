// Differential lock fuzzer driver: SDK verifyLock (noble and blst backends)
// against Charon's lock verification (charon-oracle).
//
//   node build/driver.mjs --out DIR --oracle PATH [--n 2000] [--shards 3]
//                         [--minutes 45] [--seed 1]
//
// 1. a pool of valid base locks (versions x t/n x validator counts), cached
//    in DIR/bases.json;
// 2. N cases: a base + a mutation (round robin over the catalog), each saved
//    as DIR/cases/<id>.json;
// 3. charon-oracle, then the SDK runner (noble in --shards processes, blst in
//    one) over every case;
// 4. classification, minimisation of each disagreement class, DIR/report.json.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Base, type Version, VERSIONS, generate } from './generator.js';
import { ALL_MUTATIONS, type Mutation, applyMutation } from './mutations.js';
import { BACKENDS, runSdk, type SdkResult } from './sdkRunner.js';

const args = process.argv.slice(2);
const arg = (name: string, fallback?: string): string => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) return args[i + 1];
  if (fallback === undefined) throw new Error(`--${name} is required`);
  return fallback;
};
const OUT = arg('out');
const ORACLE = arg('oracle');
const N = Number(arg('n', '2000'));
const SHARDS = Number(arg('shards', '3'));
const MINUTES = Number(arg('minutes', '45'));
const BUILD = dirname(fileURLToPath(import.meta.url));
const started = Date.now();
const elapsed = (): string => `${((Date.now() - started) / 1000).toFixed(0)}s`;

// Seeded PRNG for case selection (the crypto randomness is not seeded; every
// case is saved, so a run is reproducible from its case files).
let seed = Number(arg('seed', String(Date.now() % 2 ** 31)));
const rng = (): number => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31;
  return seed / 2 ** 31;
};

const TN: Array<[number, number]> = [
  [3, 4],
  [4, 6],
  [5, 7],
  [7, 10],
];
const SIZES = [1, 2, 3, 5, 8, 13, 20];

interface Oracle {
  id: string;
  ok: boolean;
  stage?: string;
  err?: string;
  config_hash?: string;
  definition_hash?: string;
  lock_hash?: string;
  deposit_ok?: boolean;
  deposit_err?: string;
}

const run = async (
  cmd: string,
  argv: string[],
  input: string,
): Promise<string> =>
  await new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ['pipe', 'pipe', 'inherit'] });
    const chunks: Buffer[] = [];
    p.stdout.on('data', (d: Buffer) => chunks.push(d));
    p.on('error', reject);
    p.on('close', code =>
      code === 0
        ? resolve(Buffer.concat(chunks).toString('utf8'))
        : reject(new Error(`${cmd} exited ${code}`)),
    );
    p.stdin.end(input);
  });
const jsonl = <T>(text: string): T[] =>
  text
    .split('\n')
    .filter(l => l.trim() !== '')
    .map(l => JSON.parse(l) as T);

const runOracle = async (paths: string[]): Promise<Map<string, Oracle>> =>
  new Map(
    jsonl<Oracle>(await run(ORACLE, ['lock'], paths.join('\n') + '\n')).map(
      o => [o.id, o],
    ),
  );
const runSdkShards = async (
  backend: string,
  paths: string[],
  shards: number,
  extra: string[] = [],
): Promise<Map<string, SdkResult>> => {
  const parts: string[][] = Array.from({ length: shards }, () => []);
  paths.forEach((p, i) => parts[i % shards].push(p));
  const outs = await Promise.all(
    parts.map(
      async part =>
        await run(
          process.execPath,
          [join(BUILD, 'sdkRunner.mjs'), backend, ...extra],
          part.join('\n') + '\n',
        ),
    ),
  );
  return new Map(outs.flatMap(o => jsonl<SdkResult>(o)).map(r => [r.id, r]));
};

// --- 1. base pool ---------------------------------------------------------
const basesPath = join(OUT, 'bases.json');
mkdirSync(join(OUT, 'cases'), { recursive: true });
mkdirSync(join(OUT, 'minimized'), { recursive: true });
let bases: Base[];
if (existsSync(basesPath)) {
  bases = JSON.parse(readFileSync(basesPath, 'utf8'));
} else {
  bases = [];
  for (const version of VERSIONS) {
    // The small ones the minimiser uses.
    bases.push(
      generate({ version, validators: 1, operators: 4, threshold: 3 }),
    );
    bases.push(
      generate({ version, validators: 2, operators: 4, threshold: 3 }),
    );
    for (const [t, n] of TN) {
      for (const validators of [pickSize(), pickSize(), pickSize()]) {
        const v18 = version !== 'v1.6.0' && version !== 'v1.7.0';
        const amounts = v18
          ? (pickFrom([
              ['32000000000'],
              ['16000000000', '16000000000'],
              ['1000000000', '31000000000'],
            ]) as string[])
          : undefined;
        const compounding =
          (version === 'v1.10.0' || version === 'v1.11.0') && rng() < 0.3;
        bases.push(
          generate({
            version,
            validators,
            operators: n,
            threshold: t,
            ...(amounts ? { amounts } : {}),
            compounding,
          }),
        );
      }
    }
    console.log(`[${elapsed()}] bases ${version}: ${bases.length}`);
  }
  writeFileSync(basesPath, JSON.stringify(bases));
}
function pickSize(): number {
  // Skewed small: most cases are cheap, some reach 20 validators.
  return rng() < 0.6
    ? SIZES[Math.floor(rng() * 3)]
    : SIZES[Math.floor(rng() * SIZES.length)];
}
function pickFrom<T>(xs: T[]): T {
  return xs[Math.floor(rng() * xs.length)];
}

// --- 2. cases ---------------------------------------------------------------
interface CaseMeta {
  id: string;
  path: string;
  base: number;
  version: Version;
  tn: string;
  validators: number;
  mutation: string;
  family: string;
  detail: Record<string, unknown>;
}
const cases: CaseMeta[] = [];
const order = [...ALL_MUTATIONS];
// Mutations take turns; one that does not apply to the drawn base (null) is
// retried with the next. The cap only stops a run that can never reach N.
const maxAttempts = N * ALL_MUTATIONS.length * 100;
let attempts = 0;
while (cases.length < N) {
  if (attempts >= maxAttempts) {
    throw new Error(
      `Only ${cases.length} of ${N} cases after ${attempts} mutation attempts`,
    );
  }
  const mutation = order[attempts % order.length];
  attempts++;
  const b = Math.floor(rng() * bases.length);
  const base = bases[b];
  const out = applyMutation(base, mutation, rng);
  if (out === null) continue;
  const id = `c${String(cases.length).padStart(5, '0')}`;
  const path = join(OUT, 'cases', `${id}.json`);
  const meta: CaseMeta = {
    id,
    path,
    base: b,
    version: base.options.version,
    tn: `${base.options.threshold}/${base.options.operators}`,
    validators: base.options.validators,
    mutation: mutation.name,
    family: mutation.family,
    detail: out.detail,
  };
  writeFileSync(path, JSON.stringify({ ...meta, lock: out.lock }));
  cases.push(meta);
}
console.log(`[${elapsed()}] ${cases.length} cases written`);

// --- 3. verdicts --------------------------------------------------------------
const paths = cases.map(c => c.path);
const oracle = await runOracle(paths);
console.log(`[${elapsed()}] charon-oracle done`);
const [noble, blst] = await Promise.all([
  runSdkShards('noble', paths, SHARDS, ['--hashes']),
  runSdkShards('blst', paths, 1),
]);
console.log(`[${elapsed()}] SDK runs done`);
if ((Date.now() - started) / 60000 > MINUTES) {
  console.log('time budget exceeded before classification');
}

// --- 4. classification -----------------------------------------------------------
type Cls =
  | 'a_sdk_accepts_charon_rejects'
  | 'a_dep_sdk_accepts_charon_dkg_deposit_rejects'
  | 'b_sdk_rejects_charon_accepts'
  | 'c_noble_vs_blst'
  | 'd_scope_deposits'
  | 'sdk_throw'
  | 'hash_mismatch_charon'
  | 'hash_mismatch_sliced';

interface Finding {
  cls: Cls;
  id: string;
  path: string;
  mutation: string;
  version: string;
  sdk: string;
  blst: string;
  charon: string;
  charonDeposit: string;
  note?: string;
}
const fmtSdk = (r?: SdkResult): string =>
  r === undefined
    ? 'missing'
    : r.ok
      ? 'accept'
      : `reject ${r.step}/${r.issue ?? ''}${r.validator !== undefined ? `#${r.validator}` : ''}`;
const fmtCharon = (o?: Oracle): string =>
  o === undefined ? 'missing' : o.ok ? 'accept' : `reject ${o.stage}: ${o.err}`;
const fmtDep = (o?: Oracle): string =>
  o?.deposit_ok === undefined
    ? 'n/a'
    : o.deposit_ok
      ? 'ok'
      : `fail: ${o.deposit_err}`;

const classify = (
  meta: { id: string; path: string; mutation: string; version: string },
  o: Oracle | undefined,
  n: SdkResult | undefined,
  b: SdkResult | undefined,
): Finding[] => {
  const found: Finding[] = [];
  const f = (cls: Cls, note?: string): void => {
    found.push({
      cls,
      id: meta.id,
      path: meta.path,
      mutation: meta.mutation,
      version: meta.version,
      sdk: fmtSdk(n),
      blst: fmtSdk(b),
      charon: fmtCharon(o),
      charonDeposit: fmtDep(o),
      ...(note ? { note } : {}),
    });
  };
  if (o === undefined || n === undefined || b === undefined) return found;
  if (n.step === 'THROW' || b.step === 'THROW')
    f('sdk_throw', n.thrown ?? b.thrown);
  if (n.ok !== b.ok) f('c_noble_vs_blst');
  if (n.ok && !o.ok) f('a_sdk_accepts_charon_rejects');
  else if (n.ok && o.ok && o.deposit_ok === false) {
    f('a_dep_sdk_accepts_charon_dkg_deposit_rejects');
  } else if (!n.ok && o.ok) {
    if (n.step === 'deposit_data_invalid' && o.deposit_ok === false) {
      f('d_scope_deposits');
    } else f('b_sdk_rejects_charon_accepts');
  }
  const h = n.hashes;
  if (h) {
    for (const [k, ck] of [
      ['config', 'config_hash'],
      ['definition', 'definition_hash'],
      ['lock', 'lock_hash'],
    ] as const) {
      const s = h[k];
      const sl = h[`${k}_sliced`];
      if (s !== null && sl !== null && s !== sl) {
        f('hash_mismatch_sliced', `${k}: one-shot ${s} sliced ${sl}`);
      }
      if (s !== null && o[ck] && s !== o[ck]!.toLowerCase()) {
        f('hash_mismatch_charon', `${k}: sdk ${s} charon ${o[ck]}`);
      }
    }
  }
  return found;
};

const findings: Finding[] = [];
for (const c of cases) {
  findings.push(
    ...classify(c, oracle.get(c.path), noble.get(c.path), blst.get(c.path)),
  );
}

// Per-mutation counts and verdict tallies.
const perMutation: Record<
  string,
  {
    family: string;
    cases: number;
    agree: number;
    verdicts: Record<string, number>;
  }
> = {};
for (const c of cases) {
  const o = oracle.get(c.path);
  const n = noble.get(c.path);
  const b = blst.get(c.path);
  const row = (perMutation[c.mutation] ??= {
    family: c.family,
    cases: 0,
    agree: 0,
    verdicts: {},
  });
  row.cases++;
  if (o && n && b && o.ok === n.ok && n.ok === b.ok) row.agree++;
  const key = `charon:${o?.ok ? 'A' : 'R'}${o?.deposit_ok === false ? '(dep✗)' : ''} sdk:${n?.ok ? 'A' : `R(${n?.step})`} blst:${b?.ok ? 'A' : 'R'}`;
  row.verdicts[key] = (row.verdicts[key] ?? 0) + 1;
}

// --- 5. minimisation ------------------------------------------------------------
// One representative per (class, mutation, SDK step, Charon stage): re-apply
// the mutation to the smallest bases of the same version until the same class
// reproduces.
const minimized: Array<
  Finding & { minimizedPath: string; reproduced: boolean }
> = [];
const groups = new Map<string, Finding>();
for (const f of findings) {
  const key = `${f.cls}|${f.mutation}|${f.sdk.split(' ')[1] ?? f.sdk}|${f.charon.split(':')[0]}`;
  if (!groups.has(key)) groups.set(key, f);
}
const mutationByName = new Map<string, Mutation>(
  ALL_MUTATIONS.map(m => [m.name, m]),
);
let k = 0;
for (const [key, f] of groups) {
  const mutation = mutationByName.get(f.mutation)!;
  const small = bases
    .map((b, i) => [b, i] as const)
    .filter(([b]) => b.options.version === f.version)
    .sort(
      (x, y) =>
        x[0].options.validators * x[0].options.operators -
        y[0].options.validators * y[0].options.operators,
    )
    .slice(0, 6);
  let saved: string | null = null;
  for (let attempt = 0; attempt < 18 && saved === null; attempt++) {
    const [base, bi] = small[attempt % small.length];
    const out = applyMutation(base, mutation, rng);
    if (out === null) continue;
    const path = join(
      OUT,
      'minimized',
      `m${String(k).padStart(3, '0')}-${f.cls}-${f.mutation}.json`,
    );
    const meta = {
      id: `m${k}`,
      path,
      base: bi,
      version: base.options.version,
      mutation: f.mutation,
      detail: out.detail,
    };
    writeFileSync(path, JSON.stringify({ ...meta, lock: out.lock }));
    const o = (await runOracle([path])).get(path);
    const n = await runSdk(path, out.lock, BACKENDS.noble);
    const b = await runSdk(path, out.lock, BACKENDS.blst);
    const again = classify(meta, o, { ...n, hashes: undefined } as any, b);
    if (again.some(g => g.cls === f.cls)) saved = path;
  }
  minimized.push({
    ...f,
    minimizedPath: saved ?? f.path,
    reproduced: saved !== null,
  });
  k++;
  void key;
}
console.log(`[${elapsed()}] minimisation done (${minimized.length} groups)`);

// --- 6. report ---------------------------------------------------------------------
const byClass: Record<string, number> = {};
for (const f of findings) byClass[f.cls] = (byClass[f.cls] ?? 0) + 1;
const timing = {
  noble_ms_total: [...noble.values()].reduce((s, r) => s + r.ms, 0),
  blst_ms_total: [...blst.values()].reduce((s, r) => s + r.ms, 0),
  wall_s: Math.round((Date.now() - started) / 1000),
};
const report = {
  cases: cases.length,
  versions: Object.fromEntries(
    VERSIONS.map(v => [v, cases.filter(c => c.version === v).length]),
  ),
  byClass,
  timing,
  perMutation,
  groups: minimized,
};
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
writeFileSync(join(OUT, 'findings.json'), JSON.stringify(findings, null, 2));
console.log(JSON.stringify({ cases: cases.length, byClass, timing }, null, 2));
for (const g of minimized) {
  console.log(
    `\n[${g.cls}] ${g.mutation} (${g.version}) repro=${g.reproduced}\n  sdk:    ${g.sdk}\n  blst:   ${g.blst}\n  charon: ${g.charon}\n  charon deposit check: ${g.charonDeposit}\n  ${g.minimizedPath}${g.note ? `\n  note: ${g.note.slice(0, 300)}` : ''}`,
  );
}
