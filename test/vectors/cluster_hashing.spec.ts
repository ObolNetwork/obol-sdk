// distributed-validator-specs cluster_hashing.json through the v3 cluster
// hash functions.
import { readFileSync } from 'node:fs';
import {
  computeConfigHash,
  computeDefinitionHash,
  computeLockHash,
  verifyLock,
} from '../../src/cluster/index.js';

const suite = JSON.parse(
  readFileSync('test/fixtures/spec/cluster_hashing.json', 'utf8'),
);
const prefixed = (bare: string): string => `0x${bare}`;

describe('vectors cluster_hashing', () => {
  it('has both groups', () => {
    expect(suite.definition.length).toBeGreaterThan(0);
    expect(suite.lock.length).toBeGreaterThan(0);
  });

  it.each<[string, any]>(suite.definition.map((c: any) => [c.name, c]))(
    'definition %s',
    (_name, c) => {
      expect(computeConfigHash(c.input)).toBe(prefixed(c.config_hash));
      expect(computeDefinitionHash(c.input)).toBe(prefixed(c.definition_hash));
    },
  );

  it.each<[string, any]>(suite.lock.map((c: any) => [c.name, c]))(
    'lock %s',
    (_name, c) => {
      expect(computeLockHash(c.input)).toBe(prefixed(c.lock_hash));
    },
  );

  it('real_keys_3_of_4 stops at its placeholder EIP-712 signatures', async () => {
    // Only the node signatures and signature_aggregate of this case are real;
    // its creator / operator signatures and deposit data are placeholders.
    const lock = suite.lock.find((c: any) => c.name === 'real_keys_3_of_4');
    expect(await verifyLock(lock.input)).toEqual({
      ok: false,
      level: 'full',
      step: 'definition_signature_invalid',
      issue: 'creator config_signature',
    });
  });
});
