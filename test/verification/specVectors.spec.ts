// Runs the cluster hashing test vectors from ObolNetwork/distributed-validator-specs
// (test/fixtures/spec/cluster_hashing.json, see test/fixtures/spec/README.md)
// against the SDK's config, definition and lock hashing.
import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  ByteVectorType,
  ContainerType,
  UintNumberType,
  fromHexString,
} from '@chainsafe/ssz';
import type {
  ClusterDefinition,
  ClusterLock,
  DepositData,
} from '../../src/types.js';
import {
  clusterConfigOrDefinitionHash,
  clusterLockHash,
  computeDepositMsgRoot,
  verifyNodeSignatures,
} from '../../src/verification/common.js';
import {
  depositDataContainer,
  toUint64,
} from '../../src/verification/sszTypes.js';
import { blsVerifyAggregate } from '../../src/blsUtils.js';
import {
  charonCreateClusterLockV1X10,
  charonCreateDkgLockV1X10,
  clusterLockSoloV1X10,
  clusterLockV1X10,
  clusterLockV1X11,
  clusterLockWithCompoundingWithdrawalss,
  clusterLockWithSafe,
  nullDepositAmountsClusterLockV1X8,
} from '../fixtures.js';

type DefinitionCase = {
  name: string;
  input: ClusterDefinition;
  config_hash: string;
  definition_hash: string;
};

type LockCase = {
  name: string;
  input: ClusterLock;
  lock_hash: string;
};

const vectors = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../fixtures/spec/cluster_hashing.json',
    ),
    'utf8',
  ),
) as { definition: DefinitionCase[]; lock: LockCase[] };

// The vectors use bare lowercase hex; the SDK returns 0x-prefixed hex.
const bare = (hash: string): string => hash.replace(/^0x/, '').toLowerCase();

// Each case hashes a deep copy so no case can observe another's mutations.
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('distributed-validator-specs cluster_hashing vectors', () => {
  describe('definition', () => {
    it.each(vectors.definition.map(c => [c.name, c] as const))(
      '%s config_hash and definition_hash',
      (_name, c) => {
        expect(bare(clusterConfigOrDefinitionHash(copy(c.input), true))).toBe(
          c.config_hash,
        );
        expect(bare(clusterConfigOrDefinitionHash(copy(c.input), false))).toBe(
          c.definition_hash,
        );
      },
    );
  });

  describe('lock', () => {
    it.each(vectors.lock.map(c => [c.name, c] as const))(
      '%s lock_hash',
      (_name, c) => {
        expect(bare(clusterLockHash(copy(c.input)))).toBe(c.lock_hash);
      },
    );
  });
});

describe('real_keys_3_of_4 signatures', () => {
  // Only the BLS signature_aggregate and the ENR node signatures in this case
  // are real. Its operator / creator EIP-712 signatures and its deposit and
  // builder registration data are placeholders (0x55... signatures,
  // withdrawal credentials and fee recipient that do not match the
  // definition), so full validateClusterLock rejects it by design.
  const lock = vectors.lock.find(c => c.name === 'real_keys_3_of_4')
    ?.input as ClusterLock;

  it('verifies node signatures from the ENRs', () => {
    expect(verifyNodeSignatures(copy(lock))).toBe(true);
  });

  it('verifies signature_aggregate over lock_hash', () => {
    expect(
      blsVerifyAggregate(
        lock.distributed_validators[0].public_shares.map(s => fromHexString(s)),
        fromHexString(lock.lock_hash),
        fromHexString(lock.signature_aggregate),
      ),
    ).toBe(true);
  });
});

describe('uint64 deposit amounts', () => {
  const fixtureLocks = {
    charonCreateClusterLockV1X10,
    charonCreateDkgLockV1X10,
    clusterLockSoloV1X10,
    clusterLockV1X10,
    clusterLockV1X11,
    clusterLockWithCompoundingWithdrawalss,
    clusterLockWithSafe,
    nullDepositAmountsClusterLockV1X8,
  } as unknown as Record<string, ClusterLock>;

  it.each(Object.entries(fixtureLocks))(
    '%s hashes are unchanged',
    (_name, lock) => {
      const definition = lock.cluster_definition;
      expect(clusterConfigOrDefinitionHash(copy(definition), true)).toBe(
        definition.config_hash,
      );
      expect(clusterConfigOrDefinitionHash(copy(definition), false)).toBe(
        definition.definition_hash,
      );
      expect(clusterLockHash(copy(lock))).toBe(lock.lock_hash);
    },
  );

  // The pre-bigint encoding, kept here as an independent reference.
  const numberDepositData = new ContainerType({
    pubkey: new ByteVectorType(48),
    withdrawal_credentials: new ByteVectorType(32),
    amount: new UintNumberType(8),
    signature: new ByteVectorType(96),
  });
  const numberDepositMessage = new ContainerType({
    pubkey: new ByteVectorType(48),
    withdrawal_credentials: new ByteVectorType(32),
    amount: new UintNumberType(8),
  });
  const hex = (root: Uint8Array): string =>
    '0x' + Buffer.from(root).toString('hex');

  const fixtureDeposits = Object.values(fixtureLocks).flatMap(lock =>
    lock.distributed_validators.flatMap(
      v => (v.partial_deposit_data ?? []) as DepositData[],
    ),
  );

  it('fixture deposit data roots and deposit message roots are unchanged', () => {
    const withRoot = fixtureDeposits.filter(d => !!d.deposit_data_root);
    expect(withRoot.length).toBeGreaterThan(0);
    for (const d of fixtureDeposits) {
      const fields = {
        pubkey: fromHexString(d.pubkey),
        withdrawal_credentials: fromHexString(d.withdrawal_credentials),
        signature: fromHexString(d.signature),
      };
      const root = hex(
        depositDataContainer.hashTreeRoot({
          ...fields,
          amount: toUint64(d.amount),
        }),
      );
      expect(root).toBe(
        hex(
          numberDepositData.hashTreeRoot({
            ...fields,
            amount: parseInt(d.amount),
          }),
        ),
      );
      if (d.deposit_data_root) {
        // Charon stores deposit_data_root without the 0x prefix.
        expect(bare(root)).toBe(bare(d.deposit_data_root));
      }
      expect(hex(computeDepositMsgRoot(d))).toBe(
        hex(
          numberDepositMessage.hashTreeRoot({
            pubkey: fields.pubkey,
            withdrawal_credentials: fields.withdrawal_credentials,
            amount: parseInt(d.amount),
          }),
        ),
      );
    }
  });

  it('keeps amounts above 2^53 distinct', () => {
    // parseInt maps both of these to 9007199254740992.
    const d = fixtureDeposits[0];
    const root = (amount: string): string =>
      hex(computeDepositMsgRoot({ ...d, amount }));
    expect(root('9007199254740993')).not.toBe(root('9007199254740992'));
  });

  it('toUint64 accepts the uint64 range and rejects anything else', () => {
    expect(toUint64('18446744073709551615')).toBe(
      BigInt('18446744073709551615'),
    );
    expect(toUint64(32000000000)).toBe(BigInt(32000000000));
    for (const bad of ['', '1.5', '-1', '0x10', '18446744073709551616', 1.5]) {
      expect(() => toUint64(bad)).toThrow();
    }
  });
});
