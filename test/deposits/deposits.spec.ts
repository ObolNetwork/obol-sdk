// @ts-nocheck
import { jest } from '@jest/globals';
import {
  clusterLockV1X10,
  clusterLockV1X11,
  clusterLockWithSafe,
  nullDepositAmountsClusterLockV1X8,
} from '../fixtures.js';

jest.setTimeout(20000);

const { Client, depositDataFromLock } = await import('../../src/index.js');

const GWEI = BigInt(1_000_000_000);

const pubkeyAt = (i: number): string => `0x${i.toString(16).padStart(96, '0')}`;

describe('getDepositData', () => {
  const clientFor = (chainId: number, lock: unknown) => {
    const client = new Client({ chainId });
    client['request'] = jest.fn().mockResolvedValue(lock);
    return client;
  };

  it('validates the lock and returns wei payloads (partial_deposit_data)', async () => {
    const client = clientFor(560048, clusterLockV1X10);
    const result = await client.getDepositData(clusterLockV1X10.lock_hash);

    expect(client['request']).toHaveBeenCalledWith(
      `/v1/lock/${clusterLockV1X10.lock_hash}`,
      { method: 'GET' },
    );
    const source =
      clusterLockV1X10.distributed_validators[0].partial_deposit_data[0];
    const expected = {
      pubkey: source.pubkey.toLowerCase(),
      withdrawal_credentials: source.withdrawal_credentials.toLowerCase(),
      signature: source.signature.toLowerCase(),
      deposit_data_root: `0x${source.deposit_data_root.replace(/^0x/, '')}`,
      amount: (BigInt(source.amount) * GWEI).toString(),
    };
    expect(result.lockHash).toBe(clusterLockV1X10.lock_hash);
    expect(result.amounts).toEqual(['32000000000000000000']);
    expect(result.deposits).toEqual([expected]);
    expect(result.depositsByAmount).toEqual({
      '32000000000000000000': [expected],
    });
  });

  it('rejects a lock that fails validation', async () => {
    const tampered = structuredClone(clusterLockV1X10);
    tampered.distributed_validators[0].partial_deposit_data[0].amount =
      '31000000000';
    const client = clientFor(560048, tampered);
    await expect(client.getDepositData(tampered.lock_hash)).rejects.toThrow(
      'failed validation',
    );
  });

  it('rejects a lock for another chain', async () => {
    const client = clientFor(1, clusterLockV1X10);
    await expect(
      client.getDepositData(clusterLockV1X10.lock_hash, { verify: false }),
    ).rejects.toThrow('does not match chain 1');
  });

  it('requires choosing among several amounts', async () => {
    const client = clientFor(1, clusterLockWithSafe);
    const result = await client.getDepositData(clusterLockWithSafe.lock_hash, {
      verify: false,
    });
    expect(result.amounts).toEqual(
      ['1', '8', '32', '256'].map(eth =>
        (BigInt(eth) * GWEI * GWEI).toString(),
      ),
    );
    expect(result.deposits).toBeUndefined();
    for (const amount of result.amounts) {
      expect(result.depositsByAmount[amount]).toHaveLength(2);
    }

    const chosen = await client.getDepositData(clusterLockWithSafe.lock_hash, {
      verify: false,
      amount: '8000000000000000000',
    });
    expect(chosen.deposits.map(d => d.pubkey)).toEqual(
      clusterLockWithSafe.distributed_validators.map(v =>
        v.distributed_public_key.toLowerCase(),
      ),
    );
    expect(chosen.deposits.every(d => d.amount === '8000000000000000000')).toBe(
      true,
    );

    await expect(
      client.getDepositData(clusterLockWithSafe.lock_hash, {
        verify: false,
        amount: '2000000000000000000',
      }),
    ).rejects.toThrow('available amounts');
  });

  it('reads a multi-amount v1.11 lock', async () => {
    // The v1.11 creator signature is a Safe multisig; validating it needs an
    // RPC, so validation is skipped here.
    const client = clientFor(560048, clusterLockV1X11);
    const result = await client.getDepositData(clusterLockV1X11.lock_hash, {
      verify: false,
      amount: '32000000000000000000',
    });
    expect(result.amounts).toEqual([
      '1000000000000000000',
      '32000000000000000000',
    ]);
    expect(result.deposits).toHaveLength(1);
  });

  it('reads the older deposit_data field', async () => {
    const legacy = structuredClone(nullDepositAmountsClusterLockV1X8);
    for (const validator of legacy.distributed_validators) {
      validator.deposit_data = validator.partial_deposit_data[0];
      delete validator.partial_deposit_data;
    }
    const client = clientFor(1, legacy);
    const result = await client.getDepositData(legacy.lock_hash, {
      verify: false,
    });
    expect(result.amounts).toEqual(['32000000000000000000']);
    expect(result.deposits.map(d => d.pubkey)).toEqual(
      legacy.distributed_validators.map(v =>
        v.distributed_public_key.toLowerCase(),
      ),
    );
    expect(
      result.deposits.every(d => /^0x[0-9a-f]{64}$/.test(d.deposit_data_root)),
    ).toBe(true);
  });
});

describe('depositDataFromLock', () => {
  it('rejects missing or mismatched deposit data', () => {
    const noDeposit = structuredClone(clusterLockV1X10);
    delete noDeposit.distributed_validators[0].partial_deposit_data;
    expect(() => depositDataFromLock(noDeposit)).toThrow('no deposit data');

    const wrongKey = structuredClone(clusterLockV1X10);
    wrongKey.distributed_validators[0].partial_deposit_data[0].pubkey =
      pubkeyAt(1);
    expect(() => depositDataFromLock(wrongKey)).toThrow(
      'does not match the distributed public key',
    );

    const badSignature = structuredClone(clusterLockV1X10);
    badSignature.distributed_validators[0].partial_deposit_data[0].signature =
      '0x1234';
    expect(() => depositDataFromLock(badSignature)).toThrow(
      'malformed signature',
    );

    const badRoot = structuredClone(clusterLockV1X10);
    badRoot.distributed_validators[0].partial_deposit_data[0].deposit_data_root = `0x${'11'.repeat(32)}`;
    expect(() => depositDataFromLock(badRoot)).toThrow(
      'deposit_data_root does not match',
    );

    const badAmount = structuredClone(clusterLockV1X10);
    badAmount.distributed_validators[0].partial_deposit_data[0].amount = '';
    expect(() => depositDataFromLock(badAmount)).toThrow('amount');
  });

  it('produces payloads that pass the eoa.deposit schema', async () => {
    const { validatePayload } = await import('../../src/ajv.js');
    const { eoaDepositPayloadSchema } = await import('../../src/schema.js');
    const { deposits } = depositDataFromLock(clusterLockV1X10);
    expect(() =>
      validatePayload({ deposits }, eoaDepositPayloadSchema),
    ).not.toThrow();
  });
});
