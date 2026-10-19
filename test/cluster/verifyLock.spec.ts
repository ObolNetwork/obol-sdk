import { jest } from '@jest/globals';
import { hashTypedData, parseAbi, type Hex } from 'viem';
import {
  computeLockHash,
  creatorConfigHashTypedData,
  verifyLock,
} from '../../src/cluster/index.js';
import {
  charonCreateClusterLockV1X10,
  charonCreateDkgLockV1X10,
  clusterLockSoloV1X10,
  clusterLockV1X10,
  clusterLockV1X11,
  clusterLockWithCompoundingWithdrawalss,
  nullDepositAmountsClusterLockV1X8,
} from '../fixtures.js';
import { fakeChain } from '../helpers/fakeChain.js';
import { offsetSignaturePair } from '../helpers/blsSignatures.js';

jest.setTimeout(60_000);

const copy = <T>(value: T): any => JSON.parse(JSON.stringify(value));

/** A copy of the group lock changed by `edit`, with lock_hash recomputed. */
const tampered = (edit: (lock: any) => void): any => {
  const lock = copy(clusterLockV1X10);
  edit(lock);
  lock.lock_hash = computeLockHash(lock);
  return lock;
};

describe('cluster.verifyLock', () => {
  it.each<[string, unknown]>([
    ['v1.10.0 group', clusterLockV1X10],
    ['v1.10.0 solo', clusterLockSoloV1X10],
    ['v1.8.0 null deposit_amounts', nullDepositAmountsClusterLockV1X8],
    ['v1.10.0 compounding', clusterLockWithCompoundingWithdrawalss],
    ['v1.10.0 charon create cluster', charonCreateClusterLockV1X10],
    ['v1.10.0 charon create dkg', charonCreateDkgLockV1X10],
  ])('passes every step: %s', async (_name, lock) => {
    expect(await verifyLock(copy(lock))).toEqual({ ok: true, level: 'full' });
  });

  it('step 1: definition_flow_unknown', async () => {
    const lock = copy(clusterLockV1X10);
    lock.cluster_definition.operators[1].enr_signature = '';
    expect(await verifyLock(lock)).toMatchObject({
      ok: false,
      step: 'definition_flow_unknown',
    });
  });

  it('step 2: definition_signature_invalid', async () => {
    const lock = copy(clusterLockV1X10);
    const operator = lock.cluster_definition.operators[1];
    operator.config_signature =
      lock.cluster_definition.operators[0].config_signature;
    expect(await verifyLock(lock)).toEqual({
      ok: false,
      level: 'full',
      step: 'definition_signature_invalid',
      issue: 'operators[1] config_signature',
    });
  });

  describe('step 2 with a contract-wallet creator (EIP-1271)', () => {
    const definition = clusterLockV1X11.cluster_definition;
    const abi = parseAbi([
      'function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)',
    ]);
    const expected = hashTypedData(
      creatorConfigHashTypedData(definition.config_hash, 560048),
    );
    const chain = fakeChain({
      contracts: {
        [definition.creator.address]: {
          abi,
          read: {
            isValidSignature: ([hash, signature]) =>
              hash === expected &&
              signature === definition.creator.config_signature
                ? '0x1626ba7e'
                : '0xffffffff',
          },
        },
      },
    });

    it('fails without a publicClient', async () => {
      expect(await verifyLock(copy(clusterLockV1X11))).toMatchObject({
        step: 'definition_signature_invalid',
      });
    });

    it('passes with the contract confirming the signature', async () => {
      expect(
        await verifyLock(copy(clusterLockV1X11), {
          publicClient: chain.publicClient,
        }),
      ).toEqual({ ok: true, level: 'full' });
    });

    it('fails when the contract refuses it', async () => {
      const lock = copy(clusterLockV1X11);
      lock.cluster_definition.creator.config_signature = '0x1234';
      expect(
        await verifyLock(lock, { publicClient: chain.publicClient }),
      ).toMatchObject({ step: 'definition_signature_invalid' });
    });

    it('ignores a publicClient on another chain', async () => {
      const mainnet = fakeChain({ chainId: 1 });
      expect(
        await verifyLock(copy(clusterLockV1X11), {
          publicClient: mainnet.publicClient,
        }),
      ).toMatchObject({ step: 'definition_signature_invalid' });
    });
  });

  it.each([
    ['config_hash', (l: any) => (l.cluster_definition.name = 'renamed')],
    [
      'definition_hash',
      (l: any) =>
        (l.cluster_definition.definition_hash = `0x${'00'.repeat(32)}`),
    ],
    ['lock_hash', (l: any) => (l.lock_hash = `0x${'00'.repeat(32)}`)],
  ])('step 3: hash_mismatch (%s)', async (issue, edit) => {
    const lock = copy(clusterLockV1X10);
    edit(lock);
    expect(await verifyLock(lock)).toEqual({
      ok: false,
      level: 'full',
      step: 'hash_mismatch',
      issue,
    });
  });

  it('step 3: an unsupported version is a hash_mismatch', async () => {
    const lock = copy(clusterLockV1X10);
    lock.cluster_definition.version = 'v1.9.0';
    expect(await verifyLock(lock)).toEqual({
      ok: false,
      level: 'full',
      step: 'hash_mismatch',
      issue: 'version_unsupported',
    });
  });

  it('step 4: share_layout_invalid (repeated share)', async () => {
    const lock = tampered(l => {
      const shares = l.distributed_validators[0].public_shares;
      shares[1] = shares[0].toUpperCase().replace('0X', '0x');
    });
    expect(await verifyLock(lock)).toEqual({
      ok: false,
      level: 'full',
      step: 'share_layout_invalid',
      issue: 'duplicate_share',
      validator: 0,
    });
  });

  it('step 4: share_layout_invalid (share count)', async () => {
    const lock = tampered(l => {
      l.distributed_validators[0].public_shares.pop();
    });
    expect(await verifyLock(lock)).toMatchObject({
      step: 'share_layout_invalid',
      issue: 'share_count',
    });
  });

  it('step 5: share_reconstruction_failed (shares out of order)', async () => {
    const lock = tampered(l => {
      l.distributed_validators[0].public_shares.reverse();
    });
    expect(await verifyLock(lock)).toMatchObject({
      step: 'share_reconstruction_failed',
    });
  });

  it('step 6: deposit_data_invalid (signature of another deposit)', async () => {
    const lock = tampered(l => {
      const deposits = l.distributed_validators[0].partial_deposit_data;
      const other = l.distributed_validators[0].builder_registration.signature;
      deposits[0].signature = other;
    });
    expect(await verifyLock(lock)).toEqual({
      ok: false,
      level: 'full',
      step: 'deposit_data_invalid',
      issue: 'signature_invalid',
      validator: 0,
    });
  });

  it('step 6: deposit_data_invalid (credentials)', async () => {
    const lock = tampered(l => {
      const deposit = l.distributed_validators[0].partial_deposit_data[0];
      deposit.withdrawal_credentials = `0x01${'00'.repeat(11)}${'ab'.repeat(20)}`;
    });
    expect(await verifyLock(lock)).toEqual({
      ok: false,
      level: 'full',
      step: 'deposit_data_invalid',
      issue: 'deposit_fields',
      validator: 0,
    });
  });

  it('step 7: builder_registration_invalid', async () => {
    const lock = tampered(l => {
      l.distributed_validators[0].builder_registration.message.gas_limit += 1;
    });
    expect(await verifyLock(lock)).toEqual({
      ok: false,
      level: 'full',
      step: 'builder_registration_invalid',
      issue: 'signature_invalid',
      validator: 0,
    });
  });

  // Each signature is invalid; their sum equals the sum of the valid ones.
  it.each<[string, (validator: any) => { signature: string }, string]>([
    ['deposit', v => v.partial_deposit_data[0], 'deposit_data_invalid'],
    ['builder', v => v.builder_registration, 'builder_registration_invalid'],
  ])(
    'steps 6-7: each %s signature must be valid on its own',
    async (_name, signed, step) => {
      const lock = copy(nullDepositAmountsClusterLockV1X8);
      const [first, second] = lock.distributed_validators.map(signed);
      [first.signature, second.signature] = offsetSignaturePair(
        first.signature,
        second.signature,
      );
      lock.lock_hash = computeLockHash(lock);
      expect(await verifyLock(lock)).toEqual({
        ok: false,
        level: 'full',
        step,
        issue: 'signature_invalid',
        validator: 0,
      });
    },
  );

  it('step 8: lock_signature_invalid (node signature)', async () => {
    const lock = copy(clusterLockV1X10);
    lock.node_signatures = [...lock.node_signatures].reverse();
    expect(await verifyLock(lock)).toEqual({
      ok: false,
      level: 'full',
      step: 'lock_signature_invalid',
      issue: 'node_signature_invalid',
    });
  });

  it('step 8: lock_signature_invalid (signature_aggregate)', async () => {
    const lock = copy(clusterLockV1X10);
    lock.signature_aggregate =
      lock.distributed_validators[0].builder_registration.signature;
    expect(await verifyLock(lock)).toEqual({
      ok: false,
      level: 'full',
      step: 'lock_signature_invalid',
      issue: 'signature_aggregate_invalid',
    });
  });

  it('rejects a malformed lock with PAYLOAD_INVALID', async () => {
    await expect(verifyLock({ lock_hash: 1 })).rejects.toMatchObject({
      code: 'PAYLOAD_INVALID',
    });
  });

  it('keeps hashes lowercase hex', () => {
    const hash: Hex = computeLockHash(copy(clusterLockV1X10));
    expect(hash).toBe(clusterLockV1X10.lock_hash.toLowerCase());
  });
});
