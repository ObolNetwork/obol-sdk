// A slice of the differential lock fuzzer (test/fuzz/driver.ts): every
// mutation of the catalog once on a 2-validator 3-of-4 lock per version,
// checked with the noble and blst backends. It runs with FUZZ=1
// (`yarn test:fuzz`); the Charon-compatibility regressions the full fuzzer
// found run in every `yarn test`.
//
// With CHARON_ORACLE=<path to a built charon-oracle> (test/fuzz/build-oracle.sh)
// the verdicts are also compared with Charon's own lock loading.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jest } from '@jest/globals';
import { nobleBls } from '../../src/cluster/blsBackend.js';
import { verifyLock } from '../../src/cluster/verifyLock.js';
import { blstBackend } from '../helpers/blstBackend.js';
import { type Base, VERSIONS, clone, generate, reseal } from './generator.js';
import { MUTATIONS, applyMutation } from './mutations.js';

jest.setTimeout(600_000);

const ORACLE = process.env.CHARON_ORACLE;
const dir = mkdtempSync(join(tmpdir(), 'lock-fuzz-'));
const charon = (lock: any): { ok: boolean; err?: string } | undefined => {
  if (ORACLE === undefined) return undefined;
  const path = join(dir, `${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify({ lock }));
  const out = spawnSync(ORACLE, ['lock'], { input: path + '\n' });
  return JSON.parse(out.stdout.toString());
};

const bases = new Map<string, Base>();
const base = (version: (typeof VERSIONS)[number]): Base => {
  if (!bases.has(version)) {
    bases.set(
      version,
      generate({
        version,
        validators: 2,
        operators: 4,
        threshold: 3,
        ...(version === 'v1.6.0' || version === 'v1.7.0'
          ? {}
          : { amounts: ['16000000000', '16000000000'] }),
      }),
    );
  }
  return bases.get(version)!;
};

const both = async (lock: any): Promise<[boolean, boolean]> => {
  const verdict = async (bls: any): Promise<boolean> => {
    try {
      return (await verifyLock(lock, { bls, yieldMs: 0 })).ok;
    } catch {
      return false; // PAYLOAD_INVALID
    }
  };
  return [await verdict(nobleBls), await verdict(blstBackend)];
};

const fuzz = process.env.FUZZ === '1' ? describe : describe.skip;

fuzz.each(VERSIONS)('lock fuzz %s', version => {
  it('noble and blst agree on every mutation (and with Charon when available)', async () => {
    const disagreements: string[] = [];
    for (const mutation of MUTATIONS) {
      const out = applyMutation(base(version), mutation);
      if (out === null) continue;
      const [noble, blst] = await both(out.lock);
      if (noble !== blst && !KNOWN_BACKEND_GAPS.has(mutation.name))
        disagreements.push(`${mutation.name}: noble ${noble} blst ${blst}`);
      const c = charon(out.lock);
      if (
        c !== undefined &&
        c.ok !== noble &&
        !KNOWN_CHARON_GAPS.has(mutation.name)
      ) {
        disagreements.push(
          `${mutation.name}: sdk ${noble} charon ${c.ok} (${c.err ?? ''})`,
        );
      }
    }
    expect(disagreements).toEqual([]);
  });
});

/** Mutations where noble and blst may differ (none known since rc.4). */
const KNOWN_BACKEND_GAPS = new Set<string>([]);

/**
 * Mutations where the SDK and Charon's load-time check are known to differ
 * (see the regressions below): deposit data is not checked by Charon on load,
 * plus the open SDK compatibility bugs.
 */
const KNOWN_CHARON_GAPS = new Set([
  // Charon does not verify deposit data when it loads a lock (scope).
  'flip_deposit_sig_byte',
  'withdrawal_change',
  'withdrawal_change_creds_updated',
  'amount_change',
  'amount_change_resigned',
  'truncate_deposits',
  'deposit_creds_0x00',
  'deposit_pubkey_other_validator',
  'cancel_pair_deposit',
  'cancel_pair_deposit_same_validator',
  'definition_amounts_change_resigned',
  'extend_deposits_extra_amount_signed',
  'signature_identity',
  'signature_noncanonical_flags',
  'reorder_validators',
  'fork_version_change',
  'compounding_toggle_only',
  'combo',
  // Differences in scope (Charon checks these elsewhere, or not on load).
  'fork_version_change_resigned',
  'malformed_hex',
  'version_change',
]);

// Regressions found by the differential fuzzer (fixed in 3.0.0-rc.4).
describe('Charon compatibility regressions', () => {
  const v110 = (): Base => base('v1.10.0');

  /**
   * A v1.10 lock whose share / group key is re-encoded as x + p. Only about a
   * quarter of points have such an encoding (x + p < 2^381), so fresh base
   * locks are generated until one has it.
   */
  const xPlusPLock = (which: 'share0' | 'groupKey'): any | null => {
    const mutation = MUTATIONS.find(
      m => m.name === 'g1_noncanonical_x_plus_p',
    )!;
    for (let lockAttempt = 0; lockAttempt < 40; lockAttempt++) {
      const b =
        lockAttempt === 0
          ? v110()
          : generate({
              version: 'v1.10.0',
              validators: 2,
              operators: 4,
              threshold: 3,
              amounts: ['16000000000', '16000000000'],
            });
      for (let attempt = 0; attempt < 30; attempt++) {
        const out = applyMutation(b, mutation);
        if (out === null) continue;
        const point = String(out.detail.point);
        if (
          which === 'groupKey' ? point === 'group_key' : point === 'share 0'
        ) {
          return out.lock;
        }
      }
    }
    return null;
  };

  it('rejects a share encoded with x >= p (noble decodes it mod p; blst, herumi and KeyValidate reject)', async () => {
    const lock = xPlusPLock('share0');
    expect(lock).not.toBeNull();
    expect((await verifyLock(lock, { yieldMs: 0 })).ok).toBe(false);
  });

  it('rejects a group key encoded with x >= p (its deposits could never be processed)', async () => {
    const lock = xPlusPLock('groupKey');
    expect(lock).not.toBeNull();
    expect((await verifyLock(lock, { yieldMs: 0 })).ok).toBe(false);
  });

  it('rejects a deposit signature encoded with x.c0 + p', async () => {
    const out = applyMutation(v110(), {
      name: 'g2',
      family: 'encoding',
      apply: c => {
        const d = c.lock.distributed_validators[0].partial_deposit_data[0];
        const b = Buffer.from(d.signature.slice(2), 'hex');
        const P = BigInt(
          '0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab',
        );
        const c0 = BigInt('0x' + b.subarray(48).toString('hex')) + P;
        b.set(Buffer.from(c0.toString(16).padStart(96, '0'), 'hex'), 48);
        d.signature = '0x' + b.toString('hex');
        return reseal(c.lock, c.base.secrets);
      },
    })!;
    expect((await verifyLock(out.lock, { yieldMs: 0 })).ok).toBe(false);
  });

  it('rejects num_validators != validators.length', async () => {
    const lock = clone(v110().lock);
    lock.cluster_definition.num_validators = 3;
    reseal(lock, v110().secrets);
    expect((await verifyLock(lock, { yieldMs: 0 })).ok).toBe(false);
  });

  it('rejects a 64-byte node signature (Charon requires r || s || v)', async () => {
    const lock = clone(v110().lock);
    lock.node_signatures[0] = lock.node_signatures[0].slice(0, 130);
    expect((await verifyLock(lock, { yieldMs: 0 })).ok).toBe(false);
  });

  it('rejects a node signature with the wrong recovery id', async () => {
    const lock = clone(v110().lock);
    const s = lock.node_signatures[0];
    lock.node_signatures[0] =
      s.slice(0, 130) + (s.slice(130) === '00' ? '01' : '00');
    expect((await verifyLock(lock, { yieldMs: 0 })).ok).toBe(false);
  });

  it('ignores `compounding` on v1.8.0 (not a v1.8 field: Charon expects 0x01 credentials)', async () => {
    const out = applyMutation(
      base('v1.8.0'),
      MUTATIONS.find(m => m.name === 'compounding_on_v1_8')!,
    )!;
    expect((await verifyLock(out.lock, { yieldMs: 0 })).ok).toBe(false);
  });

  it('accepts a high-s node signature with the matching recovery id (Charon does)', async () => {
    const out = applyMutation(
      v110(),
      MUTATIONS.find(m => m.name === 'node_sig_high_s')!,
    )!;
    expect((await verifyLock(out.lock, { yieldMs: 0 })).ok).toBe(true);
  });
});

// The minimized locks on which the full differential run (10k locks, noble
// and blst against Charon) disagreed with Charon, before rc.4. Each must now
// get Charon's verdict: rejected, except the high-s node signature.
describe('Charon disagreements of the differential run (minimized)', () => {
  const regressions = readdirSync('test/fuzz/regressions')
    .filter(f => f.endsWith('.json'))
    .map(f => [
      f,
      JSON.parse(readFileSync(join('test/fuzz/regressions', f), 'utf8')),
    ]);
  it.each(regressions)('%s', async (_name, r: any) => {
    for (const bls of [nobleBls, blstBackend]) {
      let ok: boolean;
      try {
        ok = (await verifyLock(r.lock, { bls, yieldMs: 0 })).ok;
      } catch {
        ok = false;
      }
      expect(ok).toBe(r.expected);
    }
  });
});
