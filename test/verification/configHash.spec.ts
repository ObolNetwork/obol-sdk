// Isolates the config_hash check in isValidClusterLock. Signature checks and the
// per-version lock data checks are stubbed to pass, so a lock whose
// definition_hash and lock_hash are consistent but whose config_hash does not
// match its config fields can only be rejected by the config_hash comparison.
import { jest, describe, it, expect } from '@jest/globals';
import type { ClusterLock } from '../../src/types.js';
import {
  charonCreateClusterLockV1X10,
  clusterLockSoloV1X10,
  clusterLockV1X10,
  clusterLockV1X11,
  TEST_ADDRESSES,
} from '../fixtures.js';

await jest.unstable_mockModule('../../src/verification/v1.8.0.js', () => ({
  clusterDefinitionContainerTypeV1X8: jest.fn(),
  hashClusterDefinitionV1X8: jest.fn(),
  hashClusterLockV1X8: jest.fn(),
  verifyDVV1X8: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
}));
await jest.unstable_mockModule(
  '../../src/verification/signature-validator.js',
  () => ({
    validateAddressSignature: jest
      .fn<() => Promise<boolean>>()
      .mockResolvedValue(true),
    validateEOASignature: jest.fn(),
    validateSmartContractSignature: jest.fn(),
  }),
);

const { isValidClusterLock, clusterConfigOrDefinitionHash, clusterLockHash } =
  await import('../../src/verification/common.js');

// Applies `mutate` to a copy of the lock's definition, then recomputes
// definition_hash and lock_hash so both stay consistent. config_hash is left
// as whatever `mutate` made it.
const withConsistentHashes = (
  lock: unknown,
  mutate: (def: ClusterLock['cluster_definition']) => void,
): ClusterLock => {
  const copy = structuredClone(lock) as ClusterLock;
  mutate(copy.cluster_definition);
  copy.cluster_definition.definition_hash = clusterConfigOrDefinitionHash(
    copy.cluster_definition,
    false,
  );
  copy.lock_hash = clusterLockHash(copy);
  return copy;
};

const flows = [
  { name: 'Group v1.10.0', lock: clusterLockV1X10 },
  { name: 'Group v1.11.0', lock: clusterLockV1X11 },
  { name: 'Solo v1.10.0', lock: clusterLockSoloV1X10 },
  { name: 'Charon v1.10.0', lock: charonCreateClusterLockV1X10 },
];

describe('isValidClusterLock config_hash check', () => {
  describe.each(flows)('$name', ({ lock }) => {
    it('accepts the unmodified lock', async () => {
      expect(await isValidClusterLock(lock as ClusterLock)).toBe(true);
    });

    it('rejects a changed withdrawal address with a stale config_hash', async () => {
      const tampered = withConsistentHashes(lock, def => {
        def.validators[0].withdrawal_address =
          TEST_ADDRESSES.PRINCIPAL_RECIPIENT;
      });
      expect(tampered.cluster_definition.config_hash).toEqual(
        (lock as ClusterLock).cluster_definition.config_hash,
      );
      expect(await isValidClusterLock(tampered)).toBe(false);
    });

    it('rejects a changed name with a stale config_hash', async () => {
      const tampered = withConsistentHashes(lock, def => {
        def.name = `${def.name ?? ''}-changed`;
      });
      expect(await isValidClusterLock(tampered)).toBe(false);
    });

    it('rejects a replaced config_hash', async () => {
      const tampered = withConsistentHashes(lock, def => {
        def.config_hash = '0x' + 'ab'.repeat(32);
      });
      expect(await isValidClusterLock(tampered)).toBe(false);
    });
  });

  it('returns false rather than throwing for an unsupported version', async () => {
    const copy = structuredClone(charonCreateClusterLockV1X10) as ClusterLock;
    copy.cluster_definition.version = 'v1.9.0';
    expect(await isValidClusterLock(copy)).toBe(false);
  });
});
