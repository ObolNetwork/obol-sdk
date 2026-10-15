// @ts-nocheck
import { jest } from '@jest/globals';
import {
  clusterLockV1X10,
  clusterLockV1X11,
  clusterLockWithSafe,
  nullDepositAmountsClusterLockV1X8,
} from '../fixtures.js';

jest.setTimeout(20000);

const {
  Client,
  checkExistingDeposits,
  depositDataFromLock,
  BEACON_VALIDATORS_CHUNK_SIZE,
} = await import('../../src/index.js');

const BEACON_URL = 'https://beacon.example.org/';
const GWEI = BigInt(1_000_000_000);

const pubkeyAt = (i: number): string => `0x${i.toString(16).padStart(96, '0')}`;
const creds = (byte: string): string =>
  `0x01${'0'.repeat(22)}${byte.repeat(20)}`;
const CREDS_A = creds('aa');
const CREDS_B = creds('bb');

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const registryRow = (pubkey: string, index: number, wc: string) => ({
  index: String(index),
  balance: '32000000000',
  status: 'active_ongoing',
  validator: { pubkey, withdrawal_credentials: wc },
});

const pendingRow = (pubkey: string, wc: string) => ({
  pubkey,
  withdrawal_credentials: wc,
  amount: '32000000000',
  signature: `0x${'00'.repeat(96)}`,
  slot: '1',
});

/** Mock beacon node serving `registry` and `pending` from head state. */
const mockBeacon = ({
  registry = [],
  pending = [],
  failValidatorsCall,
  pendingStatus = 200,
}: {
  registry?: any[];
  pending?: any[];
  failValidatorsCall?: number;
  pendingStatus?: number;
}) => {
  let validatorsCalls = 0;
  const fetchMock = jest.fn(async (url: string) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/pending_deposits')) {
      return jsonResponse({ data: pending }, pendingStatus);
    }
    if (parsed.pathname.endsWith('/validators')) {
      validatorsCalls++;
      if (validatorsCalls === failValidatorsCall) {
        return jsonResponse({ message: 'error' }, 500);
      }
      const ids = (parsed.searchParams.get('id') ?? '').split(',');
      return jsonResponse({
        data: registry.filter(r => ids.includes(r.validator.pubkey)),
      });
    }
    return jsonResponse({}, 404);
  });
  global.fetch = fetchMock;
  return fetchMock;
};

describe('checkExistingDeposits', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns new for an unknown pubkey', async () => {
    mockBeacon({});
    const [result] = await checkExistingDeposits(
      [{ pubkey: pubkeyAt(1), withdrawal_credentials: CREDS_A }],
      { beaconUrl: BEACON_URL },
    );
    expect(result).toEqual({
      pubkey: pubkeyAt(1),
      status: 'new',
      message: expect.any(String),
    });
  });

  it('returns top_up for a registered validator, whatever the credentials', async () => {
    mockBeacon({ registry: [registryRow(pubkeyAt(1), 42, CREDS_A)] });
    const results = await checkExistingDeposits(
      [
        { pubkey: pubkeyAt(1), withdrawal_credentials: CREDS_A },
        { pubkey: pubkeyAt(1), withdrawal_credentials: CREDS_B },
        { pubkey: pubkeyAt(1), withdrawal_credentials: `0x${'00'.repeat(32)}` },
      ],
      { beaconUrl: BEACON_URL },
    );
    for (const result of results) {
      expect(result.status).toBe('top_up');
      expect(result.existing).toEqual({
        index: 42,
        withdrawal_credentials: CREDS_A,
        source: 'registry',
      });
    }
    expect(results[1].message).toContain('not used');
  });

  it('prefers the registry over pending deposits (pending top-up)', async () => {
    mockBeacon({
      registry: [registryRow(pubkeyAt(1), 7, CREDS_A)],
      pending: [pendingRow(pubkeyAt(1), CREDS_B)],
    });
    const [result] = await checkExistingDeposits(
      [{ pubkey: pubkeyAt(1), withdrawal_credentials: CREDS_B }],
      { beaconUrl: BEACON_URL },
    );
    expect(result.status).toBe('top_up');
  });

  it('returns conflict for a pending deposit with different credentials', async () => {
    mockBeacon({
      pending: [
        pendingRow(pubkeyAt(1), CREDS_A),
        pendingRow(pubkeyAt(1), CREDS_B),
      ],
    });
    const [result] = await checkExistingDeposits(
      [{ pubkey: pubkeyAt(1), withdrawal_credentials: CREDS_A }],
      { beaconUrl: BEACON_URL },
    );
    expect(result.status).toBe('conflict');
    expect(result.existing).toEqual({
      withdrawal_credentials: CREDS_B,
      source: 'pending',
    });
  });

  it('returns new with a note for pending deposits with the same credentials', async () => {
    mockBeacon({
      pending: [
        pendingRow(pubkeyAt(1).toUpperCase().replace('0X', '0x'), CREDS_A),
      ],
    });
    const [result] = await checkExistingDeposits(
      [
        {
          pubkey: pubkeyAt(1),
          withdrawal_credentials: CREDS_A.toUpperCase().replace('0X', '0x'),
        },
      ],
      { beaconUrl: BEACON_URL },
    );
    expect(result.status).toBe('new');
    expect(result.existing).toEqual({
      withdrawal_credentials: CREDS_A,
      source: 'pending',
    });
    expect(result.message).toContain('already queued');
  });

  it('ignores pending deposits and registry rows for other pubkeys', async () => {
    mockBeacon({
      pending: [pendingRow(pubkeyAt(2), CREDS_B)],
    });
    const [result] = await checkExistingDeposits(
      [{ pubkey: pubkeyAt(1), withdrawal_credentials: CREDS_A }],
      { beaconUrl: BEACON_URL },
    );
    expect(result.status).toBe('new');
    expect(result.existing).toBeUndefined();
  });

  it('chunks registry lookups and keeps input order', async () => {
    const count = BEACON_VALIDATORS_CHUNK_SIZE * 2 + 5;
    const deposits = Array.from({ length: count }, (_, i) => ({
      pubkey: pubkeyAt(i + 1),
      withdrawal_credentials: CREDS_A,
    }));
    const fetchMock = mockBeacon({
      registry: [registryRow(pubkeyAt(count), 99, CREDS_A)],
    });

    const results = await checkExistingDeposits(deposits, {
      beaconUrl: BEACON_URL,
    });

    const validatorCalls = fetchMock.mock.calls
      .map(([url]) => new URL(url))
      .filter(url => url.pathname.endsWith('/validators'));
    expect(validatorCalls).toHaveLength(3);
    expect(
      validatorCalls.map(url => url.searchParams.get('id').split(',').length),
    ).toEqual([BEACON_VALIDATORS_CHUNK_SIZE, BEACON_VALIDATORS_CHUNK_SIZE, 5]);
    expect(validatorCalls[0].origin + validatorCalls[0].pathname).toBe(
      'https://beacon.example.org/eth/v1/beacon/states/head/validators',
    );
    // pending_deposits is fetched once.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(results.map(r => r.pubkey)).toEqual(deposits.map(d => d.pubkey));
    expect(results[count - 1].status).toBe('top_up');
    expect(results.slice(0, -1).every(r => r.status === 'new')).toBe(true);
  });

  it('queries each pubkey once when deposits repeat it', async () => {
    const fetchMock = mockBeacon({});
    await checkExistingDeposits(
      [
        { pubkey: pubkeyAt(1), withdrawal_credentials: CREDS_A },
        { pubkey: pubkeyAt(1), withdrawal_credentials: CREDS_A },
      ],
      { beaconUrl: BEACON_URL },
    );
    const [validatorsUrl] = fetchMock.mock.calls
      .map(([url]) => new URL(url))
      .filter(url => url.pathname.endsWith('/validators'));
    expect(validatorsUrl.searchParams.get('id')).toBe(pubkeyAt(1));
  });

  it('rejects when any registry chunk fails', async () => {
    const deposits = Array.from(
      { length: BEACON_VALIDATORS_CHUNK_SIZE + 1 },
      (_, i) => ({ pubkey: pubkeyAt(i + 1), withdrawal_credentials: CREDS_A }),
    );
    mockBeacon({ failValidatorsCall: 2 });
    await expect(
      checkExistingDeposits(deposits, { beaconUrl: BEACON_URL }),
    ).rejects.toThrow('HTTP 500');
  });

  it('rejects when pending_deposits is unavailable', async () => {
    mockBeacon({ pendingStatus: 404 });
    await expect(
      checkExistingDeposits(
        [{ pubkey: pubkeyAt(1), withdrawal_credentials: CREDS_A }],
        { beaconUrl: BEACON_URL },
      ),
    ).rejects.toThrow('pending_deposits request failed with HTTP 404');
  });

  it('rejects on a network error or malformed body', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(
      checkExistingDeposits(
        [{ pubkey: pubkeyAt(1), withdrawal_credentials: CREDS_A }],
        { beaconUrl: BEACON_URL },
      ),
    ).rejects.toThrow('ECONNREFUSED');

    global.fetch = jest.fn(async () => jsonResponse({ data: 'nope' }));
    await expect(
      checkExistingDeposits(
        [{ pubkey: pubkeyAt(1), withdrawal_credentials: CREDS_A }],
        { beaconUrl: BEACON_URL },
      ),
    ).rejects.toThrow('Malformed beacon node');
  });

  it('rejects invalid input before any request', async () => {
    const fetchMock = mockBeacon({});
    await expect(
      checkExistingDeposits(
        [{ pubkey: '0x1234', withdrawal_credentials: CREDS_A }],
        { beaconUrl: BEACON_URL },
      ),
    ).rejects.toThrow('Invalid pubkey');
    await expect(
      checkExistingDeposits(
        [{ pubkey: pubkeyAt(1), withdrawal_credentials: '0x01' }],
        { beaconUrl: BEACON_URL },
      ),
    ).rejects.toThrow('Invalid withdrawal credentials');
    await expect(
      checkExistingDeposits(
        [{ pubkey: pubkeyAt(1), withdrawal_credentials: CREDS_A }],
        { beaconUrl: 'ftp://beacon' },
      ),
    ).rejects.toThrow('beaconUrl');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns an empty array for no deposits', async () => {
    const fetchMock = mockBeacon({});
    await expect(
      checkExistingDeposits([], { beaconUrl: BEACON_URL }),
    ).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is exposed on the client', async () => {
    mockBeacon({ registry: [registryRow(pubkeyAt(1), 1, CREDS_A)] });
    const client = new Client({ chainId: 560048 });
    const [result] = await client.checkExistingDeposits(
      [{ pubkey: pubkeyAt(1), withdrawal_credentials: CREDS_A }],
      { beaconUrl: BEACON_URL },
    );
    expect(result.status).toBe('top_up');
  });
});

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
