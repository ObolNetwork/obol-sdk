/**
 * v1.9.0 cluster files are not supported (decision for 3.0: the Obol API
 * rejects them too). Every entry point must say "unsupported version", not
 * report a hash or signature failure. The lock is Charon's own v1.9.0 test
 * vector (charon cluster/testdata/cluster_lock_v1_9_0.json).
 */
import { readFileSync } from 'node:fs';
import {
  computeConfigHash,
  computeDefinitionHash,
  computeLockHash,
  isValidLock,
  prepareDefinition,
  verifyDefinition,
  verifyLock,
} from '../../src/cluster/index.js';
import { fromLock } from '../../src/deposits/fromLock.js';

const lock = (): any =>
  JSON.parse(
    readFileSync('test/fixtures/charon/cluster_lock_v1_9_0.json', 'utf8'),
  );

const thrown = (fn: () => unknown): any => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('expected a throw');
};

describe('v1.9.0 cluster files are unsupported, and say so', () => {
  it('is a real v1.9.0 lock', () => {
    expect(lock().cluster_definition.version).toBe('v1.9.0');
  });

  it.each([
    ['computeConfigHash', () => computeConfigHash(lock().cluster_definition)],
    [
      'computeDefinitionHash',
      () => computeDefinitionHash(lock().cluster_definition),
    ],
    ['computeLockHash', () => computeLockHash(lock())],
  ])('%s throws DEFINITION_INVALID / version_unsupported', (_n, run) => {
    const error = thrown(run);
    expect(error.code).toBe('DEFINITION_INVALID');
    expect(error.message).toBe(
      'Cluster definition version v1.9.0 is not supported',
    );
    expect(error.details.issues).toEqual([
      {
        code: 'version_unsupported',
        message: 'version v1.9.0 is not supported',
      },
    ]);
    expect(error.hint).toBe(
      'Supported versions: v1.6.0, v1.7.0, v1.8.0, v1.10.0, v1.11.0',
    );
  });

  it.each(['full', 'attested'] as const)(
    'verifyLock (%s) reports version_unsupported before any other step',
    async level => {
      expect(await verifyLock(lock(), { level })).toEqual({
        ok: false,
        level,
        step: 'hash_mismatch',
        issue: 'version_unsupported',
      });
    },
  );

  it('isValidLock is false', async () => {
    expect(await isValidLock(lock())).toBe(false);
  });

  it('verifyDefinition reports version_unsupported', async () => {
    const result = await verifyDefinition({
      definition: lock().cluster_definition,
      chainId: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.code)).toContain('version_unsupported');
  });

  it('deposits.fromLock refuses it (LOCK_INVALID, version_unsupported)', async () => {
    await expect(fromLock(lock())).rejects.toMatchObject({
      code: 'LOCK_INVALID',
      details: { step: 'hash_mismatch', issue: 'version_unsupported' },
    });
  });

  it('prepareDefinition does not create one (PAYLOAD_INVALID at version)', () => {
    const a = '0x1234567890123456789012345678901234567890';
    const error = thrown(() =>
      prepareDefinition({
        name: 'x',
        operators: [
          { address: a },
          { address: a },
          { address: a },
          { address: a },
        ],
        validators: [{ feeRecipientAddress: a, withdrawalAddress: a }],
        creator: a,
        chainId: 1,
        version: 'v1.9.0',
      }),
    );
    expect(error.code).toBe('PAYLOAD_INVALID');
    expect(error.details.issues[0].path).toBe('version');
  });
});
