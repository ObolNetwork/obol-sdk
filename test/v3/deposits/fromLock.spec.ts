import { parseEther } from 'viem';
import { computeLockHash } from '../../../src/v3/cluster/index.js';
import { fromLock } from '../../../src/v3/deposits/fromLock.js';
import { verifyDepositData } from '../../../src/v3/deposits/verifyDepositData.js';
import type { ObolError } from '../../../src/v3/errors.js';
import { depositDataFromLock } from '../../../src/deposits/lockDeposits.js';
import {
  charonCreateClusterLockV1X10,
  clusterLockV1X10,
} from '../../fixtures.js';

const copy = <T>(value: T): any => JSON.parse(JSON.stringify(value));
const rejection = async (promise: Promise<unknown>): Promise<ObolError> =>
  await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e as ObolError,
  );

describe('deposits.fromLock', () => {
  it('returns verified deposits in wei, as 2.x getDepositData', async () => {
    const lock = copy(clusterLockV1X10);
    const result = await fromLock(lock, { chainId: 560048 });
    const legacy = depositDataFromLock(copy(clusterLockV1X10));
    expect(result.lockHash).toBe(lock.lock_hash);
    expect(result.amounts).toEqual([parseEther('32')]);
    expect(result.deposits).toEqual(
      legacy.deposits?.map(d => ({
        pubkey: d.pubkey,
        withdrawalCredentials: d.withdrawal_credentials,
        signature: d.signature,
        depositDataRoot: d.deposit_data_root,
        amount: BigInt(d.amount),
      })),
    );
    // The output passes the deposit checks for the lock's withdrawal address.
    await verifyDepositData(result.deposits ?? [], {
      chainId: 560048,
      expectedWithdrawalAddress:
        lock.cluster_definition.validators[0].withdrawal_address,
    });
  });

  it('groups several amounts and needs `amount` to pick one', async () => {
    const lock = copy(charonCreateClusterLockV1X10);
    const all = await fromLock(lock);
    expect(all.amounts).toEqual([parseEther('1'), parseEther('32')]);
    expect(all.deposits).toBeUndefined();
    expect(all.depositsByAmount.get(parseEther('1'))).toHaveLength(
      lock.distributed_validators.length,
    );
    const one = await fromLock(lock, {
      amount: parseEther('1'),
      verify: false,
    });
    expect(one.deposits?.map(d => d.amount)).toEqual(
      lock.distributed_validators.map(() => parseEther('1')),
    );
  });

  it('throws DEPOSIT_AMOUNT_NOT_IN_LOCK with the available amounts', async () => {
    const error = await rejection(
      fromLock(copy(charonCreateClusterLockV1X10), {
        amount: parseEther('8'),
        verify: false,
      }),
    );
    expect(error.code).toBe('DEPOSIT_AMOUNT_NOT_IN_LOCK');
    expect(error.details).toEqual({
      amount: parseEther('8'),
      available: [parseEther('1'), parseEther('32')],
    });
  });

  it('throws LOCK_INVALID with the verifyLock step', async () => {
    const lock = copy(clusterLockV1X10);
    lock.signature_aggregate =
      lock.distributed_validators[0].builder_registration.signature;
    const error = await rejection(fromLock(lock));
    expect(error.code).toBe('LOCK_INVALID');
    expect(error.details).toMatchObject({ step: 'lock_signature_invalid' });
  });

  it('checks the fork version against the chain (LOCK_INVALID)', async () => {
    const error = await rejection(
      fromLock(copy(clusterLockV1X10), { chainId: 1 }),
    );
    expect(error.code).toBe('LOCK_INVALID');
    expect(error.details).toEqual({ issue: 'fork_version_mismatch' });
  });

  it('reports a validator without deposit data (deposit_data_missing)', async () => {
    const lock = copy(clusterLockV1X10);
    lock.distributed_validators[0].partial_deposit_data = [];
    const error = await rejection(fromLock(lock, { verify: false }));
    expect(error.code).toBe('LOCK_INVALID');
    expect(error.details).toEqual({ issue: 'deposit_data_missing', index: 0 });
  });

  it.each<[string, (d: any) => void]>([
    ['a malformed signature', d => (d.signature = '0x1234')],
    ['a pubkey of another validator', d => (d.pubkey = `0x${'aa'.repeat(48)}`)],
    ['a zero amount', d => (d.amount = '0')],
    [
      'a root that does not match',
      d => (d.deposit_data_root = `0x${'00'.repeat(32)}`),
    ],
  ])('reports %s (deposit_data_invalid)', async (_name, edit) => {
    const lock = copy(clusterLockV1X10);
    edit(lock.distributed_validators[0].partial_deposit_data[0]);
    const error = await rejection(fromLock(lock, { verify: false }));
    expect(error.code).toBe('LOCK_INVALID');
    expect(error.details).toEqual({ issue: 'deposit_data_invalid', index: 0 });
  });

  it('computes an absent root and keeps the first deposit of an amount', async () => {
    const lock = copy(clusterLockV1X10);
    const deposits = lock.distributed_validators[0].partial_deposit_data;
    const root = deposits[0].deposit_data_root;
    delete deposits[0].deposit_data_root;
    deposits.push({ ...deposits[0], signature: `0x${'00'.repeat(96)}` });
    lock.lock_hash = computeLockHash(lock);
    const result = await fromLock(lock, { verify: false });
    expect(result.deposits?.[0].depositDataRoot).toBe(
      `0x${root.replace(/^0x/, '')}`,
    );
    expect(result.deposits?.[0].signature).toBe(deposits[0].signature);
  });

  it('rejects a malformed lock or options (PAYLOAD_INVALID)', async () => {
    expect((await rejection(fromLock({}))).code).toBe('PAYLOAD_INVALID');
    expect(
      (await rejection(fromLock(copy(clusterLockV1X10), { amount: -1n }))).code,
    ).toBe('PAYLOAD_INVALID');
  });
});
