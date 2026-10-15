// @ts-nocheck
import { jest } from '@jest/globals';
import { fromHexString } from '@chainsafe/ssz';
import { clusterLockV1X10, mainnetDepositPayload } from '../fixtures.js';

jest.setTimeout(20000);

// Only the transaction senders are mocked; schema validation, deposit checks
// and the beacon node check run for real.
// @ts-expect-error - ESM mocking requires top-level await
await jest.unstable_mockModule('../../src/eoa/eoaHelpers.js', () => ({
  __esModule: true,
  submitEOAWithdrawalRequest: jest.fn(),
  submitEOABatchDeposit: jest.fn(async () => ({ txHashes: ['0xeoa'] })),
}));
// @ts-expect-error - ESM mocking requires top-level await
await jest.unstable_mockModule('../../src/splits/splitHelpers.js', () => ({
  __esModule: true,
  formatSplitRecipients: jest.fn(),
  predictSplitterAddress: jest.fn(),
  handleDeployOWRAndSplitter: jest.fn(),
  deploySplitterContract: jest.fn(),
  deploySplitterAndOWRContracts: jest.fn(),
  getOWRTranches: jest.fn(),
  multicall3: jest.fn(),
  formatRecipientsForSplitV2: jest.fn(),
  predictSplitV2Address: jest.fn(),
  isSplitV2Deployed: jest.fn(),
  deployOVMContract: jest.fn(),
  deployOVMAndSplitV2: jest.fn(),
  requestWithdrawalFromOVM: jest.fn(),
  depositOVM: jest.fn(async () => ({ txHashes: ['0xovm'] })),
  isContractWalletSigner: jest.fn(async () => false),
  submitViaContractWalletAndWait: jest.fn(),
}));

const { Client, DepositConflictError, ObolSdkError } =
  await import('../../src/index.js');
const { submitEOABatchDeposit } = await import('../../src/eoa/eoaHelpers.js');
const { depositOVM } = await import('../../src/splits/splitHelpers.js');
const { verifyDepositPayloads } =
  await import('../../src/verification/depositPayload.js');
const { depositDataContainer } =
  await import('../../src/verification/sszTypes.js');

const BEACON_URL = 'https://beacon.example.org';
const GWEI = BigInt(1_000_000_000);

const signer = {
  getAddress: jest.fn(async () => '0x1234567890123456789012345678901234567890'),
  sendTransaction: jest.fn(),
  provider: null,
};

/** Hoodi client whose API returns the v1.10 fixture lock. */
const makeClient = () => {
  const client = new Client({ chainId: 560048 }, signer);
  client['request'] = jest.fn().mockResolvedValue(clusterLockV1X10);
  return client;
};

const lockDeposits = async () => {
  const { deposits } = await makeClient().getDepositData(
    clusterLockV1X10.lock_hash,
  );
  return deposits;
};

const withdrawalAddressOf = deposit =>
  `0x${deposit.withdrawal_credentials.slice(-40)}`;

/** Same deposit with other fields and a matching deposit_data_root. */
const withFields = (deposit, fields) => {
  const updated = { ...deposit, ...fields };
  const root = depositDataContainer.hashTreeRoot({
    pubkey: fromHexString(updated.pubkey),
    withdrawal_credentials: fromHexString(updated.withdrawal_credentials),
    amount: Number(BigInt(updated.amount) / GWEI),
    signature: fromHexString(updated.signature),
  });
  return {
    ...updated,
    deposit_data_root: `0x${Buffer.from(root).toString('hex')}`,
  };
};

/** Same deposit signed over another message (valid point, wrong signature). */
const withWrongSignature = deposit =>
  withFields(deposit, { signature: mainnetDepositPayload.deposit.signature });

const ZERO_CREDS = `0x${'00'.repeat(32)}`;

/** Beacon node that knows `registry` validators and `pending` deposits. */
const mockBeacon = ({ registry = [], pending = [] } = {}) => {
  const fetchMock = jest.fn(async (url: string) => {
    const { pathname } = new URL(url);
    const data = pathname.endsWith('/pending_deposits')
      ? pending.map(([pubkey, wc]) => ({
          pubkey,
          withdrawal_credentials: wc,
          amount: '32000000000',
          signature: `0x${'00'.repeat(96)}`,
          slot: '1',
        }))
      : registry.map(([pubkey, wc], i) => ({
          index: String(100 + i),
          balance: '32000000000',
          status: 'active_ongoing',
          validator: { pubkey, withdrawal_credentials: wc },
        }));
    return { ok: true, status: 200, json: async () => ({ data }) };
  });
  global.fetch = fetchMock;
  return fetchMock;
};

const OTHER_CREDS = `0x01${'0'.repeat(22)}${'bb'.repeat(20)}`;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getDepositData output as deposit input', () => {
  it('is accepted by eoa.deposit as is', async () => {
    const deposits = await lockDeposits();
    const client = makeClient();

    await expect(
      client.eoa.deposit({
        deposits,
        expectedWithdrawalAddress: withdrawalAddressOf(deposits[0]),
      }),
    ).resolves.toEqual({ txHashes: ['0xeoa'] });
    expect(submitEOABatchDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ deposits }),
    );
  });

  it('is accepted by splits.deposit as is', async () => {
    const deposits = await lockDeposits();
    const client = makeClient();
    const ovmAddress = withdrawalAddressOf(deposits[0]);

    await expect(
      client.splits.deposit({ ovmAddress, deposits }),
    ).resolves.toEqual({ txHashes: ['0xovm'] });
    expect(depositOVM).toHaveBeenCalledWith(
      expect.objectContaining({ ovmAddress, deposits }),
    );
  });
});

describe('deposit with beaconUrl', () => {
  it('sends new deposits after checking the beacon node', async () => {
    const deposits = await lockDeposits();
    const fetchMock = mockBeacon();

    await makeClient().eoa.deposit({ deposits, beaconUrl: BEACON_URL });

    expect(fetchMock).toHaveBeenCalled();
    expect(submitEOABatchDeposit).toHaveBeenCalledTimes(1);
  });

  it('refuses deposits with a conflicting pending deposit', async () => {
    const deposits = await lockDeposits();
    mockBeacon({ pending: [[deposits[0].pubkey, OTHER_CREDS]] });
    const ovmAddress = withdrawalAddressOf(deposits[0]);

    for (const send of [
      async () =>
        await makeClient().eoa.deposit({ deposits, beaconUrl: BEACON_URL }),
      async () =>
        await makeClient().splits.deposit({
          ovmAddress,
          deposits,
          beaconUrl: BEACON_URL,
        }),
    ]) {
      const error = await send().catch(e => e);
      expect(error).toBeInstanceOf(DepositConflictError);
      expect(error).toBeInstanceOf(ObolSdkError);
      expect(error.code).toBe('DEPOSIT_CONFLICT');
      expect(error.message).toContain(deposits[0].pubkey);
      expect(error.conflicts.map(c => c.pubkey)).toEqual([deposits[0].pubkey]);
    }
    expect(submitEOABatchDeposit).not.toHaveBeenCalled();
    expect(depositOVM).not.toHaveBeenCalled();
  });

  it('skips the signature check only for top-ups', async () => {
    const [deposit] = await lockDeposits();
    const topUp = withWrongSignature(deposit);
    mockBeacon({
      registry: [[deposit.pubkey, deposit.withdrawal_credentials]],
    });

    await makeClient().splits.deposit({
      ovmAddress: withdrawalAddressOf(deposit),
      deposits: [topUp],
      beaconUrl: BEACON_URL,
    });
    expect(depositOVM).toHaveBeenCalledTimes(1);
  });

  it('still checks the withdrawal credentials of top-ups', async () => {
    const [deposit] = await lockDeposits();
    mockBeacon({
      registry: [[deposit.pubkey, deposit.withdrawal_credentials]],
    });

    await expect(
      makeClient().splits.deposit({
        ovmAddress: `0x${'cc'.repeat(20)}`,
        deposits: [deposit],
        beaconUrl: BEACON_URL,
      }),
    ).rejects.toThrow('withdrawal credentials do not point at');
    expect(depositOVM).not.toHaveBeenCalled();
  });

  it('accepts all-zero withdrawal credentials on a top-up', async () => {
    const [deposit] = await lockDeposits();
    const topUp = withWrongSignature(
      withFields(deposit, { withdrawal_credentials: ZERO_CREDS }),
    );
    mockBeacon({
      registry: [[deposit.pubkey, deposit.withdrawal_credentials]],
    });
    const ovmAddress = withdrawalAddressOf(deposit);

    await makeClient().splits.deposit({
      ovmAddress,
      deposits: [topUp],
      beaconUrl: BEACON_URL,
    });
    await makeClient().eoa.deposit({
      deposits: [topUp],
      expectedWithdrawalAddress: ovmAddress,
      beaconUrl: BEACON_URL,
    });
    expect(depositOVM).toHaveBeenCalledTimes(1);
    expect(submitEOABatchDeposit).toHaveBeenCalledTimes(1);
  });

  it('refuses other credentials on a top-up', async () => {
    const [deposit] = await lockDeposits();
    mockBeacon({
      registry: [[deposit.pubkey, deposit.withdrawal_credentials]],
    });

    for (const credentials of [OTHER_CREDS, `0x00${'11'.repeat(31)}`]) {
      await expect(
        makeClient().splits.deposit({
          ovmAddress: withdrawalAddressOf(deposit),
          deposits: [
            withFields(deposit, { withdrawal_credentials: credentials }),
          ],
          beaconUrl: BEACON_URL,
        }),
      ).rejects.toThrow('withdrawal credentials do not point at');
    }
    expect(depositOVM).not.toHaveBeenCalled();
  });

  it('refuses all-zero credentials on a new deposit', async () => {
    const [deposit] = await lockDeposits();
    const zero = withFields(deposit, { withdrawal_credentials: ZERO_CREDS });
    mockBeacon();

    await expect(
      makeClient().splits.deposit({
        ovmAddress: withdrawalAddressOf(deposit),
        deposits: [zero],
        beaconUrl: BEACON_URL,
      }),
    ).rejects.toThrow('withdrawal credentials do not point at');
    expect(depositOVM).not.toHaveBeenCalled();
  });

  it('refuses all-zero credentials without beaconUrl', async () => {
    const [deposit] = await lockDeposits();
    const zero = withFields(deposit, { withdrawal_credentials: ZERO_CREDS });

    await expect(
      makeClient().splits.deposit({
        ovmAddress: withdrawalAddressOf(deposit),
        deposits: [zero],
        skipSignatureVerification: true,
      }),
    ).rejects.toThrow('withdrawal credentials do not point at');
    expect(depositOVM).not.toHaveBeenCalled();
  });

  it('requires a valid signature for new deposits even if skipSignatureVerification is set', async () => {
    const [deposit] = await lockDeposits();
    mockBeacon();

    await expect(
      makeClient().eoa.deposit({
        deposits: [withWrongSignature(deposit)],
        skipSignatureVerification: true,
        beaconUrl: BEACON_URL,
      }),
    ).rejects.toThrow('Invalid deposit at index 0: invalid deposit signature');
    expect(submitEOABatchDeposit).not.toHaveBeenCalled();
  });

  it('fails closed when the beacon node is unavailable', async () => {
    const deposits = await lockDeposits();
    global.fetch = jest.fn(async () => ({ ok: false, status: 503 }));

    await expect(
      makeClient().eoa.deposit({ deposits, beaconUrl: BEACON_URL }),
    ).rejects.toThrow('HTTP 503');
    expect(submitEOABatchDeposit).not.toHaveBeenCalled();
  });

  it('keeps skipSignatureVerification without beaconUrl', async () => {
    const [deposit] = await lockDeposits();
    const fetchMock = mockBeacon();

    await makeClient().eoa.deposit({
      deposits: [withWrongSignature(deposit)],
      skipSignatureVerification: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(submitEOABatchDeposit).toHaveBeenCalledTimes(1);
  });
});

describe('verifyDepositPayloads topUps', () => {
  it('skips listed deposits and reports the index of the failing one', async () => {
    const [deposit] = await lockDeposits();
    const bad = withWrongSignature(deposit);

    await expect(
      verifyDepositPayloads([bad, deposit], {
        chainId: 560048,
        topUps: new Set([0]),
      }),
    ).resolves.toBeUndefined();
    await expect(
      verifyDepositPayloads([deposit, bad, bad], {
        chainId: 560048,
        topUps: new Set([1]),
      }),
    ).rejects.toThrow('Invalid deposit at index 2');
  });

  it('allows all-zero credentials only for listed top-ups', async () => {
    const [deposit] = await lockDeposits();
    const zero = withFields(deposit, { withdrawal_credentials: ZERO_CREDS });
    const options = {
      chainId: 560048,
      expectedWithdrawalAddress: withdrawalAddressOf(deposit),
    };

    await expect(
      verifyDepositPayloads([deposit, zero], {
        ...options,
        topUps: new Set([1]),
      }),
    ).resolves.toBeUndefined();
    await expect(
      verifyDepositPayloads([zero, zero], {
        ...options,
        topUps: new Set([0]),
      }),
    ).rejects.toThrow('Invalid deposit at index 1: withdrawal credentials');
  });
});
