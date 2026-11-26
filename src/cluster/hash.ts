/**
 * Cluster file hashes (distributed-validator-specs "Definition Hash
 * Computation" / "Lock Hash Computation"), computed by the SSZ code in
 * `internal/verification` (carried over from 2.x) for
 * each supported version.
 */
import type { Hex } from 'viem';
import {
  clusterConfigOrDefinitionHash,
  clusterLockHash,
} from '../internal/verification/common.js';
import type {
  ClusterDefinition as LegacyDefinition,
  ClusterLock as LegacyLock,
} from '../internal/types.js';
import { ObolError } from '../errors.js';
import { decode } from '../schema.js';
import {
  DefinitionSchema,
  LockSchema,
  SUPPORTED_DEFINITION_VERSIONS,
  type ClusterDefinition,
  type ClusterLock,
} from './schema.js';

export const isSupportedVersion = (version: string): boolean =>
  (SUPPORTED_DEFINITION_VERSIONS as readonly string[]).includes(version);

export const versionUnsupported = (version: string): ObolError =>
  new ObolError(
    'DEFINITION_INVALID',
    `Cluster definition version ${version} is not supported`,
    {
      hint: `Supported versions: ${SUPPORTED_DEFINITION_VERSIONS.join(', ')}`,
      details: {
        issues: [
          {
            code: 'version_unsupported',
            message: `version ${version} is not supported`,
          },
        ],
      },
    },
  );

const hashFailed = (what: string, cause: unknown): ObolError =>
  new ObolError(
    'PAYLOAD_INVALID',
    `Cannot compute the ${what}: ${(cause as Error)?.message ?? String(cause)}`,
    {
      cause,
      details: {
        issues: [{ path: what, message: (cause as Error)?.message ?? '' }],
      },
    },
  );

const lower = (hash: string): Hex => hash.toLowerCase() as Hex;

/** Hashes a definition that already passed the schema (no decode). */
export const definitionHash = (
  definition: ClusterDefinition,
  configOnly: boolean,
): Hex => {
  if (!isSupportedVersion(definition.version)) {
    throw versionUnsupported(definition.version);
  }
  try {
    return lower(
      clusterConfigOrDefinitionHash(
        // The internal hashing reads the same wire fields.
        definition as unknown as LegacyDefinition,
        configOnly,
      ),
    );
  } catch (error) {
    throw hashFailed(configOnly ? 'config_hash' : 'definition_hash', error);
  }
};

/** Hashes a lock that already passed the schema (no decode). */
export const lockHash = (lock: ClusterLock): Hex => {
  const version = lock.cluster_definition.version;
  if (!isSupportedVersion(version)) throw versionUnsupported(version);
  try {
    return lower(clusterLockHash(lock as unknown as LegacyLock));
  } catch (error) {
    throw hashFailed('lock_hash', error);
  }
};

/**
 * Config hash of a definition: the SSZ root of its config fields (no
 * operator ENRs or signatures), for the definition's `version`. This is what
 * the creator and operators sign.
 *
 * @throws DEFINITION_INVALID (issue `version_unsupported`), PAYLOAD_INVALID
 *   for a malformed definition.
 */
export const computeConfigHash = (definition: unknown): Hex =>
  definitionHash(decode(DefinitionSchema, definition, 'definition'), true);

/**
 * Definition hash: as {@link computeConfigHash} with the operator ENRs,
 * signatures and `config_hash` included.
 */
export const computeDefinitionHash = (definition: unknown): Hex =>
  definitionHash(decode(DefinitionSchema, definition, 'definition'), false);

/**
 * Lock hash: the SSZ root of the definition and the distributed validators
 * (shares, deposit data, builder registrations), for the definition's
 * `version`.
 *
 * @throws DEFINITION_INVALID (issue `version_unsupported`), PAYLOAD_INVALID
 *   for a malformed lock (including a v1.8.0 lock whose `deposit_amounts` is
 *   null but whose deposits are not a single 32 ETH one).
 */
export const computeLockHash = (lock: unknown): Hex =>
  lockHash(decode(LockSchema, lock, 'lock'));
