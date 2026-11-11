/**
 * The browser build must not need a global `Buffer`. Only Next.js polyfills
 * it; in Vite, Rollup, esbuild, workers and edge runtimes the rc.11 build
 * reported a valid lock as `hash_mismatch` ("Buffer is not defined").
 * `no-restricted-globals` in .eslintrc.js guards `src/`; this guards what is
 * shipped, bundled dependencies included.
 */
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { charonCreateClusterLockV1X10, clusterLockV1X10 } from '../fixtures.js';
import { describeDist, runNode } from './builtPackage.js';

interface Output {
  bufferDefined: boolean;
  locks: Array<{
    version: string;
    configHash: string;
    definitionHash: string;
    lockHash: string;
    verification: { ok: boolean; step?: string; issue?: string };
    isValid: boolean;
    enr: string;
    deposits?: number;
    depositRoot?: string;
    storedDepositRoot?: string;
    depositsError?: string;
  }>;
}

describeDist('browser build without a global Buffer', () => {
  // Locks made by Charon (`charon create cluster`, and a DKG): their hashes
  // were computed by Charon, not by this SDK.
  const fixtures = [charonCreateClusterLockV1X10, clusterLockV1X10] as any[];
  let output: Output;

  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'obol-sdk-no-buffer-'));
    const paths = fixtures.map((lock, i) => {
      const path = join(dir, `lock-${i}.json`);
      writeFileSync(path, JSON.stringify(lock));
      return path;
    });
    output = runNode<Output>(
      'test/package/scripts/browser-no-buffer.mjs',
      paths,
    );
  }, 120_000);

  it('ran without Buffer', () => {
    expect(output.bufferDefined).toBe(false);
  });

  it.each([0, 1])(
    'computes the hashes Charon wrote into a real lock (%i)',
    i => {
      const lock = fixtures[i];
      const result = output.locks[i];
      expect(result.configHash).toBe(lock.cluster_definition.config_hash);
      expect(result.definitionHash).toBe(
        lock.cluster_definition.definition_hash,
      );
      expect(result.lockHash).toBe(lock.lock_hash);
    },
  );

  it.each([0, 1])('verifies the real lock in full (%i)', i => {
    expect(output.locks[i].verification).toEqual({ ok: true, level: 'full' });
    expect(output.locks[i].isValid).toBe(true);
  });

  it.each([0, 1])(
    'reads and verifies its deposits, and parses an ENR (%i)',
    i => {
      const result = output.locks[i];
      expect(result.depositsError).toBeUndefined();
      expect(result.deposits).toBe(fixtures[i].distributed_validators.length);
      expect(result.depositRoot).toBe(result.storedDepositRoot);
      expect(result.enr).toMatch(/^0x[0-9a-f]{66}$/);
    },
  );

  it('no source file of the SDK mentions Buffer as a value or a type', () => {
    // The lint rule's twin, so a regression fails `yarn test` as well.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, {
        withFileTypes: true,
      })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.ts$/.test(entry.name)) {
          readFileSync(path, 'utf8')
            .split('\n')
            .forEach((line, n) => {
              const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
              if (/(^|[^A-Za-z_])Buffer\b/.test(code)) {
                offenders.push(`${path}:${n + 1}`);
              }
            });
        }
      }
    };
    walk('src');
    expect(offenders).toEqual([]);
  });
});
