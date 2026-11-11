// The sliced hashes verifyLock uses equal the one-shot SSZ hashes, for every
// supported version.
import { fromHexString } from '@chainsafe/ssz';
import {
  clusterConfigOrDefinitionHash,
  clusterConfigOrDefinitionHashSliced,
  clusterLockHash,
  clusterLockHashSliced,
} from '../../src/internal/verification/common.js';
import {
  charonCreateClusterLockV1X10,
  clusterLockV1X10,
  clusterLockV1X11,
  nullDepositAmountsClusterLockV1X8,
} from '../fixtures.js';

const copy = (value: unknown): any => JSON.parse(JSON.stringify(value));

/** clusterLockV1X10 relabelled as an older layout (single deposit_data). */
const olderLayout = (version: 'v1.6.0' | 'v1.7.0'): any => {
  const lock = copy(clusterLockV1X10);
  lock.cluster_definition.version = version;
  for (const dv of lock.distributed_validators) {
    dv.deposit_data = dv.partial_deposit_data[0];
    delete dv.partial_deposit_data;
    if (version === 'v1.6.0') delete dv.builder_registration;
  }
  return lock;
};

const LOCKS: Array<[string, any]> = [
  ['v1.6.0', olderLayout('v1.6.0')],
  ['v1.7.0', olderLayout('v1.7.0')],
  ['v1.8.0', copy(nullDepositAmountsClusterLockV1X8)],
  ['v1.10.0', copy(clusterLockV1X10)],
  ['v1.10.0 charon', copy(charonCreateClusterLockV1X10)],
  ['v1.11.0', copy(clusterLockV1X11)],
];

describe('sliced cluster hashes', () => {
  let ticks = 0;
  const tick = async (): Promise<void> => {
    ticks++;
  };

  it.each(LOCKS)('%s', async (_name, lock) => {
    const definition = lock.cluster_definition;
    for (const configOnly of [true, false]) {
      expect(
        await clusterConfigOrDefinitionHashSliced(definition, configOnly, tick),
      ).toBe(clusterConfigOrDefinitionHash(definition, configOnly));
    }
    const definitionRoot = fromHexString(
      clusterConfigOrDefinitionHash(definition, false),
    );
    ticks = 0;
    expect(await clusterLockHashSliced(lock, definitionRoot, tick)).toBe(
      clusterLockHash(lock),
    );
    expect(ticks).toBe(lock.distributed_validators.length);
  });

  it('slices a long validators list', async () => {
    const definition = copy(clusterLockV1X11.cluster_definition);
    const address = (i: number): string =>
      '0x' + i.toString(16).padStart(40, '0');
    definition.validators = Array.from({ length: 600 }, (_, i) => ({
      fee_recipient_address: address(i),
      withdrawal_address: address(i + 1000),
    }));
    ticks = 0;
    expect(
      await clusterConfigOrDefinitionHashSliced(definition, true, tick),
    ).toBe(clusterConfigOrDefinitionHash(definition, true));
    expect(ticks).toBe(2);
  });

  it('keeps the v1.8.0 null deposit_amounts rule', async () => {
    const lock = copy(nullDepositAmountsClusterLockV1X8);
    lock.distributed_validators[0].partial_deposit_data[0].amount =
      '1000000000';
    const root = fromHexString(
      clusterConfigOrDefinitionHash(lock.cluster_definition, false),
    );
    expect(() => clusterLockHash(lock)).toThrow();
    await expect(clusterLockHashSliced(lock, root, tick)).rejects.toThrow();
  });
});
