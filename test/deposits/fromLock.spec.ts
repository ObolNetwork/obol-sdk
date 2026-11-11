import { parseEther } from 'viem';
import { computeLockHash } from '../../src/cluster/index.js';
import { fromLock } from '../../src/deposits/fromLock.js';
import { assertDepositData } from '../../src/deposits/assertDepositData.js';
import type { ObolError } from '../../src/errors.js';
import {
  charonCreateClusterLockV1X10,
  charonCreateDkgLockV1X10,
  clusterLockV1X10,
} from '../fixtures.js';
import { verifyLock } from '../../src/cluster/verifyLock.js';
import { clone, generate } from '../fuzz/generator.js';

/** Genesis fork version → chain id (mainnet, Hoodi). */
const CHAINS_BY_FORK: Record<string, number> = {
  '0x00000000': 1,
  '0x10000910': 560048,
};
import { fromHexString } from '@chainsafe/ssz';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { hex, syntheticLock } from '../helpers/syntheticLock.js';

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
    const hex = (value: string): string =>
      `0x${value.replace(/^0x/i, '')}`.toLowerCase();
    expect(result.lockHash).toBe(lock.lock_hash);
    expect(result.amounts).toEqual([parseEther('32')]);
    // 2.x: the lock's deposit fields as lowercase 0x hex, gwei amounts in wei.
    expect(result.deposits).toEqual(
      lock.distributed_validators.map((v: any) => {
        const d = v.partial_deposit_data[0];
        return {
          pubkey: hex(d.pubkey),
          withdrawalCredentials: hex(d.withdrawal_credentials),
          signature: hex(d.signature),
          depositDataRoot: hex(d.deposit_data_root),
          amount: BigInt(d.amount) * 1_000_000_000n,
        };
      }),
    );
    // The output passes the deposit checks for the lock's withdrawal address.
    await assertDepositData(result.deposits, {
      chainId: 560048,
      expectedWithdrawalAddress:
        lock.cluster_definition.validators[0].withdrawal_address,
    });
  });

  // Locks made by Charon itself with its default deposit amounts (1 ETH and
  // 32 ETH per validator): `charon create cluster`, `charon create dkg` +
  // `charon dkg`.
  describe.each([
    ['charon create cluster (v1.10.0)', charonCreateClusterLockV1X10],
    ['charon dkg (v1.10.0)', charonCreateDkgLockV1X10],
  ])(
    'a default Charon lock with 1 ETH and 32 ETH deposits: %s',
    (_n, fixture) => {
      const count = fixture.distributed_validators.length;

      it('throws DEPOSIT_AMOUNT_REQUIRED without `amount`, never picking one', async () => {
        const error = await rejection(fromLock(copy(fixture)));
        expect(error.code).toBe('DEPOSIT_AMOUNT_REQUIRED');
        expect(error.details).toEqual({
          available: [parseEther('1'), parseEther('32')],
        });
        // Also when verification is off.
        expect(
          (await rejection(fromLock(copy(fixture), { verify: false }))).code,
        ).toBe('DEPOSIT_AMOUNT_REQUIRED');
      });

      it.each([parseEther('32'), parseEther('1')])(
        'returns exactly the %s wei deposits with `amount`, verified',
        async amount => {
          const lock = copy(fixture);
          const result = await fromLock(lock, { amount });
          expect(result.amounts).toEqual([parseEther('1'), parseEther('32')]);
          expect(result.deposits).toHaveLength(count);
          expect(result.deposits.map(d => d.amount)).toEqual(
            Array.from({ length: count }, () => amount),
          );
          // The lock's own entries of that amount, in lock order.
          expect(result.deposits.map(d => d.signature)).toEqual(
            lock.distributed_validators.map((v: any) =>
              `0x${v.partial_deposit_data
                .find((d: any) => BigInt(d.amount) * 10n ** 9n === amount)
                .signature.replace(/^0x/, '')}`.toLowerCase(),
            ),
          );
          expect(result.depositsByAmount.get(amount)).toEqual(result.deposits);
          // What deposits.prepareDeposit runs first.
          await assertDepositData(result.deposits, {
            chainId: CHAINS_BY_FORK[lock.cluster_definition.fork_version],
            expectedWithdrawalAddress:
              lock.cluster_definition.validators[0].withdrawal_address,
          });
        },
      );
    },
  );

  it('`deposits` is always present: the only amount when there is one', async () => {
    const result = await fromLock(copy(clusterLockV1X10), { verify: false });
    expect(result.amounts).toEqual([parseEther('32')]);
    expect(result.deposits.length).toBeGreaterThan(0);
  });

  it('rejects an unknown option key instead of ignoring it', async () => {
    const error = await rejection(
      fromLock(copy(clusterLockV1X10), {
        verify: false,
        ammount: parseEther('32'),
      } as any),
    );
    expect(error.code).toBe('PAYLOAD_INVALID');
    expect(error.details.issues).toEqual([
      expect.objectContaining({
        path: 'options.ammount',
        issue: 'unknown_key',
        message: expect.stringContaining('allowed keys: amount, bls, chainId'),
      }),
    ]);
  });

  // v1.6.0 / v1.7.0 locks hash and sign only `deposit_data`. Charon drops
  // `partial_deposit_data` when it reads one; the SDK refuses the lock.
  describe.each(['v1.6.0', 'v1.7.0'] as const)(
    'a legacy %s lock (deposit_data only)',
    version => {
      const base = generate({
        version,
        validators: 2,
        operators: 4,
        threshold: 3,
      });
      const injected = (): any => {
        const lock = clone(base.lock);
        // An attacker-chosen entry: other credentials, another amount.
        lock.distributed_validators[1].partial_deposit_data = [
          {
            ...lock.distributed_validators[1].deposit_data,
            withdrawal_credentials: `0x01${'00'.repeat(11)}${'ee'.repeat(20)}`,
            amount: '1000000000',
          },
        ];
        return lock;
      };

      it('reads deposit_data from the untouched lock', async () => {
        const lock = clone(base.lock);
        expect((await verifyLock(lock)).ok).toBe(true);
        const result = await fromLock(lock);
        expect(result.deposits.map(d => d.signature)).toEqual(
          lock.distributed_validators.map((v: any) =>
            `0x${v.deposit_data.signature.replace(/^0x/, '')}`.toLowerCase(),
          ),
        );
      });

      it('an injected partial_deposit_data entry does not change the lock hash', () => {
        expect(computeLockHash(injected())).toBe(computeLockHash(base.lock));
      });

      it('cluster.verifyLock rejects it (partial_deposit_data_unexpected)', async () => {
        for (const level of ['full', 'attested'] as const) {
          expect(await verifyLock(injected(), { level })).toEqual({
            ok: false,
            level,
            step: 'deposit_data_invalid',
            issue: 'partial_deposit_data_unexpected',
            validator: 1,
          });
        }
      });

      it.each([true, 'full', false] as const)(
        'fromLock never returns the injected entry (verify: %s)',
        async verify => {
          const error = await rejection(fromLock(injected(), { verify }));
          expect(error.code).toBe('LOCK_INVALID');
          expect(error.details).toMatchObject({
            issue: 'partial_deposit_data_unexpected',
            index: 1,
          });
        },
      );

      it('an empty or null partial_deposit_data is not an injection', async () => {
        for (const empty of [[], null]) {
          const lock = clone(base.lock);
          lock.distributed_validators[0].partial_deposit_data = empty;
          expect((await verifyLock(lock)).ok).toBe(true);
          expect((await fromLock(lock)).deposits).toHaveLength(2);
        }
      });
    },
  );

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
    // signature_aggregate is a full-level check.
    expect((await fromLock(copy(lock))).deposits).toHaveLength(
      lock.distributed_validators.length,
    );
    const error = await rejection(fromLock(lock, { verify: 'full' }));
    expect(error.code).toBe('LOCK_INVALID');
    expect(error.details).toMatchObject({
      step: 'lock_signature_invalid',
      issue: 'signature_aggregate_invalid',
    });
  });

  describe('verification of the returned validators', () => {
    const G2 = bls12_381.G2.Point;
    const ls = bls12_381.longSignatures;
    const { lock: base, seal } = syntheticLock(4, 4, 3);
    /** The lock with a bad deposit signature for validator 2, resealed. */
    const badDeposit = (): any => {
      const lock = structuredClone(base);
      const d = lock.distributed_validators[2].partial_deposit_data[0];
      d.signature = hex(
        ls.Signature.toBytes(
          ls.Signature.fromBytes(fromHexString(d.signature)).add(G2.BASE),
        ),
      );
      return seal(lock);
    };

    it('checks the deposit signatures of the validators it returns', async () => {
      const error = await rejection(fromLock(badDeposit()));
      expect(error.code).toBe('LOCK_INVALID');
      expect(error.details).toEqual({
        step: 'deposit_data_invalid',
        issue: 'signature_invalid',
        index: 2,
      });
      const pubkey = base.distributed_validators[2].distributed_public_key;
      expect(
        (await rejection(fromLock(badDeposit(), { validators: [pubkey] })))
          .details,
      ).toMatchObject({ step: 'deposit_data_invalid', index: 2 });
    });

    it('returns only the requested validators, in lock order', async () => {
      const lock = badDeposit();
      const keys = lock.distributed_validators.map(
        (v: any) => v.distributed_public_key,
      );
      const result = await fromLock(lock, {
        validators: [3, keys[0].toUpperCase().replace('0X', '0x'), 3],
      });
      expect(result.validators).toEqual([0, 3]);
      expect(result.deposits?.map(d => d.pubkey)).toEqual([keys[0], keys[3]]);
    });

    it("verify: 'full' runs every check", async () => {
      const lock = structuredClone(base);
      const shares = lock.distributed_validators[1].public_shares;
      [shares[0], shares[1]] = [shares[1], shares[0]];
      seal(lock);
      expect((await fromLock(structuredClone(lock))).validators).toEqual([
        0, 1, 2, 3,
      ]);
      const error = await rejection(fromLock(lock, { verify: 'full' }));
      expect(error.details).toMatchObject({
        step: 'share_reconstruction_failed',
        index: 1,
      });
    });

    it('rejects a validator that is not in the lock', async () => {
      for (const validators of [[4], [`0x${'ab'.repeat(48)}`]]) {
        const error = await rejection(
          fromLock(structuredClone(base), { validators: validators as any }),
        );
        expect(error.code).toBe('PAYLOAD_INVALID');
        expect(error.details.issues).toEqual([
          expect.objectContaining({ issue: 'not_in_lock' }),
        ]);
      }
    });
  });

  it('checks the fork version against the chain (LOCK_INVALID)', async () => {
    const error = await rejection(
      fromLock(copy(clusterLockV1X10), { chainId: 1 }),
    );
    expect(error.code).toBe('LOCK_INVALID');
    expect(error.details).toEqual({ issue: 'fork_version_mismatch' });
  });

  it('does not read deposit_data from a v1.8.0+ lock (deposit_data_missing)', async () => {
    const lock = copy(clusterLockV1X10);
    const validator: any = lock.distributed_validators[0];
    validator.deposit_data = validator.partial_deposit_data[0];
    validator.partial_deposit_data = [];
    const error = await rejection(fromLock(lock, { verify: false }));
    expect(error.code).toBe('LOCK_INVALID');
    expect(error.details).toEqual({ issue: 'deposit_data_missing', index: 0 });
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
    expect(result.deposits[0].depositDataRoot).toBe(
      `0x${root.replace(/^0x/, '')}`,
    );
    expect(result.deposits[0].signature).toBe(deposits[0].signature);
  });

  it('rejects a malformed lock or options (PAYLOAD_INVALID)', async () => {
    expect((await rejection(fromLock({}))).code).toBe('PAYLOAD_INVALID');
    expect(
      (await rejection(fromLock(copy(clusterLockV1X10), { amount: -1n }))).code,
    ).toBe('PAYLOAD_INVALID');
  });
});
