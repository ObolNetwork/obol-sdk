// @ts-nocheck
import { jest } from '@jest/globals';
import { fromHexString } from '@chainsafe/ssz';
import { clusterLockV1X10, mainnetDepositPayload } from '../fixtures.js';

jest.setTimeout(20000);

// Only the transaction senders are mocked; schema validation, deposit checks
// run for real.
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

const { Client, ObolSdkError, PayloadValidationError } =
  await import('../../src/index.js');
const { submitEOABatchDeposit } = await import('../../src/eoa/eoaHelpers.js');
const { depositOVM } = await import('../../src/splits/splitHelpers.js');
const { verifyDepositPayloads } =
  await import('../../src/verification/depositPayload.js');
const { depositDataContainer } =
  await import('../../src/verification/sszTypes.js');

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

describe('deposit kind', () => {
  it('refuses all-zero credentials on a new deposit', async () => {
    const [deposit] = await lockDeposits();
    const zero = withFields(deposit, { withdrawal_credentials: ZERO_CREDS });

    for (const kind of [undefined, 'deposit']) {
      await expect(
        makeClient().splits.deposit({
          ovmAddress: withdrawalAddressOf(deposit),
          deposits: [zero],
          kind,
        }),
      ).rejects.toThrow('withdrawal credentials do not point at');
    }
    expect(depositOVM).not.toHaveBeenCalled();
  });

  it("skips the signature check for kind: 'topUp'", async () => {
    const [deposit] = await lockDeposits();

    await makeClient().eoa.deposit({
      deposits: [withWrongSignature(deposit)],
      kind: 'topUp',
    });
    expect(submitEOABatchDeposit).toHaveBeenCalledTimes(1);

    await expect(
      makeClient().eoa.deposit({
        deposits: [withWrongSignature(deposit)],
        kind: 'deposit',
      }),
    ).rejects.toThrow('Invalid deposit at index 0: invalid deposit signature');
  });

  it("still checks the withdrawal credentials of kind: 'topUp'", async () => {
    const [deposit] = await lockDeposits();

    for (const credentials of [OTHER_CREDS, `0x00${'11'.repeat(31)}`]) {
      await expect(
        makeClient().splits.deposit({
          ovmAddress: withdrawalAddressOf(deposit),
          deposits: [
            withFields(deposit, { withdrawal_credentials: credentials }),
          ],
          kind: 'topUp',
        }),
      ).rejects.toThrow('withdrawal credentials do not point at');
    }
    expect(depositOVM).not.toHaveBeenCalled();
  });

  it('rejects an unknown kind', async () => {
    const [deposit] = await lockDeposits();
    await expect(
      makeClient().eoa.deposit({ deposits: [deposit], kind: 'topup' }),
    ).rejects.toBeInstanceOf(PayloadValidationError);
    expect(submitEOABatchDeposit).not.toHaveBeenCalled();
  });
});

describe('top-ups (Launchpad payload)', () => {
  const ETH = GWEI * GWEI;
  const ZERO_SIGNATURE = `0x${'00'.repeat(96)}`;

  /** Same shape as dv-launchpad utils/deposit.ts prepareTopUpData. */
  const launchpadTopUp = (pubkey, eth) =>
    withFields(
      {
        pubkey,
        withdrawal_credentials: ZERO_CREDS,
        signature: ZERO_SIGNATURE,
        amount: (ETH * BigInt(eth)).toString(),
      },
      {},
    );

  it("accepts them with kind: 'topUp' (eoa and splits, up to 2048 ETH)", async () => {
    const [deposit] = await lockDeposits();
    const ovmAddress = withdrawalAddressOf(deposit);
    for (const eth of [1, 64, 2048]) {
      const topUp = launchpadTopUp(deposit.pubkey, eth);
      await makeClient().splits.deposit({
        ovmAddress,
        deposits: [topUp],
        kind: 'topUp',
      });
      await makeClient().eoa.deposit({
        deposits: [topUp],
        expectedWithdrawalAddress: ovmAddress,
        kind: 'topUp',
      });
    }
    expect(depositOVM).toHaveBeenCalledTimes(3);
    expect(submitEOABatchDeposit).toHaveBeenCalledTimes(3);

    await expect(
      makeClient().eoa.deposit({
        deposits: [launchpadTopUp(deposit.pubkey, 2049)],
        kind: 'topUp',
      }),
    ).rejects.toThrow('amount exceeds 2048 ETH, the maximum for a top-up');
  });

  it("still checks credentials other than all-zero with kind: 'topUp'", async () => {
    const [deposit] = await lockDeposits();
    await expect(
      makeClient().splits.deposit({
        ovmAddress: withdrawalAddressOf(deposit),
        deposits: [
          withFields(launchpadTopUp(deposit.pubkey, 1), {
            withdrawal_credentials: OTHER_CREDS,
          }),
        ],
        kind: 'topUp',
      }),
    ).rejects.toThrow('withdrawal credentials do not point at');
  });

  it("refuses them without kind: 'topUp', with a clear error", async () => {
    const [deposit] = await lockDeposits();
    const topUp = launchpadTopUp(deposit.pubkey, 1);

    for (const send of [
      async () => await makeClient().eoa.deposit({ deposits: [topUp] }),
      async () =>
        await makeClient().splits.deposit({
          ovmAddress: withdrawalAddressOf(deposit),
          deposits: [topUp],
        }),
    ]) {
      const error = await send().catch(e => e);
      expect(error).toBeInstanceOf(ObolSdkError);
      expect(error.code).toBe('DEPOSIT_LOOKS_LIKE_TOP_UP');
      expect(error.message).toContain('Invalid deposit at index 0');
      expect(error.hint).toContain("kind: 'topUp'");
    }
    expect(submitEOABatchDeposit).not.toHaveBeenCalled();
    expect(depositOVM).not.toHaveBeenCalled();
  });

  it('reports a signature that is not a curve point as an invalid signature', async () => {
    const [deposit] = await lockDeposits();
    const notAPoint = withFields(deposit, {
      signature: `0x${'ff'.repeat(96)}`,
    });

    await expect(
      verifyDepositPayloads([deposit, notAPoint], { chainId: 560048 }),
    ).rejects.toThrow('Invalid deposit at index 1: invalid deposit signature');
  });
});
