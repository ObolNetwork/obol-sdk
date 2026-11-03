import { jest } from '@jest/globals';
import * as blst from '@chainsafe/blst';
import { isValidLock, verifyLock } from '../../src/cluster/verifyLock.js';
import { blstBackendFrom, loadBlstBackend } from '../../src/blst/index.js';
import { syntheticLock } from '../helpers/syntheticLock.js';

jest.setTimeout(60_000);

describe('@obolnetwork/obol-sdk/blst', () => {
  const { lock, seal } = syntheticLock(3, 4, 3);

  it('loads @chainsafe/blst once and verifies a lock at full', async () => {
    const bls = await loadBlstBackend();
    expect(await loadBlstBackend()).toBe(bls);
    expect(await verifyLock(structuredClone(lock), { bls })).toEqual({
      ok: true,
      level: 'full',
    });
    expect(await isValidLock(structuredClone(lock), { bls })).toBe(true);
  });

  it('fails the aggregate signature like the default backend', async () => {
    const edited = structuredClone(lock);
    const sealed = seal(edited);
    sealed.signature_aggregate =
      sealed.distributed_validators[0].builder_registration.signature;
    const bls = blstBackendFrom(blst);
    expect(await verifyLock(structuredClone(sealed), { bls })).toMatchObject({
      ok: false,
      step: 'lock_signature_invalid',
      issue: 'signature_aggregate_invalid',
    });
    expect(await verifyLock(sealed, { yieldMs: 0 })).toMatchObject({
      ok: false,
      step: 'lock_signature_invalid',
      issue: 'signature_aggregate_invalid',
    });
  });

  it('is not imported by any other entry', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : [path];
      });
    const offenders = files('src').filter(
      path =>
        !path.startsWith(join('src', 'blst')) &&
        /^(import|export)[^;]*from '(\.\.\/)+blst\/|^(import|export)[^;]*'@chainsafe\/blst'|import\('@chainsafe\/blst'\)/m.test(
          // Code only: TSDoc examples may show the import.
          readFileSync(path, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, ''),
        ),
    );
    expect(offenders).toEqual([]);
  });
});
