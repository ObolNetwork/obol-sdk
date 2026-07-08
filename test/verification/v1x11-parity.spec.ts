// Golden-vector parity check for v1.11.0 hashing against a REAL cluster:
// a 2-of-N Safe multisig creator signature (two 65-byte chunks) and empty
// operator addresses/signatures. Asserts the SDK reproduces the config_hash,
// definition_hash and lock_hash that charon + the dev API produced.
import {
  clusterConfigOrDefinitionHash,
  clusterLockHash,
} from '../../src/verification/common.js';
import { clusterLockV1X11 } from '../fixtures.js';

describe('v1.11.0 real-data hash parity', () => {
  const def = clusterLockV1X11.cluster_definition;

  it('reproduces config_hash', () => {
    expect(clusterConfigOrDefinitionHash(def as any, true)).toEqual(
      def.config_hash,
    );
  });

  it('reproduces definition_hash', () => {
    expect(clusterConfigOrDefinitionHash(def as any, false)).toEqual(
      def.definition_hash,
    );
  });

  it('reproduces lock_hash', () => {
    expect(clusterLockHash(clusterLockV1X11 as any)).toEqual(
      clusterLockV1X11.lock_hash,
    );
  });
});
