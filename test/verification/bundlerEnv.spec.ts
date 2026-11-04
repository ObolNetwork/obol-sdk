// Browser bundlers (webpack / Next.js) define `__dirname` ("/") while `path`
// and `fs` resolve to empty modules. Worker discovery must then fall back to
// the sync path instead of throwing, and a batch BLS check that fails for a
// reason other than a bad signature must not refuse valid deposits.
import { jest } from '@jest/globals';
import { hoodiCompoundingDepositPayload } from '../fixtures';

const hoodi = hoodiCompoundingDepositPayload;

describe('verification in a bundler that defines __dirname', () => {
  const g = globalThis as { __dirname?: string };
  beforeEach(() => {
    jest.resetModules();
    g.__dirname = '/';
  });
  afterEach(() => {
    delete g.__dirname;
  });

  it('verifyBlsChecksParallel falls back to the sync check instead of throwing', async () => {
    // Load the package entry first: the verification modules import each other.
    await import('../../src/index');
    const { verifyBlsChecksParallel } =
      await import('../../src/verification/parallelPool');
    await expect(verifyBlsChecksParallel([])).resolves.toBe(true);
    const { verifyDepositPayloads } =
      await import('../../src/verification/depositPayload');
    await expect(
      verifyDepositPayloads([hoodi.deposit], {
        chainId: hoodi.chainId,
        expectedWithdrawalAddress: hoodi.withdrawalAddress,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('verifyDepositPayloads when the batch check throws', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  const withThrowingBatch = async () => {
    const actual = await import('../../src/verification/parallelPool');
    await jest.unstable_mockModule(
      '../../src/verification/parallelPool.js',
      () => ({
        ...actual,
        verifyBlsChecksParallel: jest.fn(async () => {
          throw new Error('no workers here');
        }),
      }),
    );
    await import('../../src/index');
    return await import('../../src/verification/depositPayload');
  };

  it('accepts deposits whose signatures each verify', async () => {
    const { verifyDepositPayloads } = await withThrowingBatch();
    await expect(
      verifyDepositPayloads([hoodi.deposit], {
        chainId: hoodi.chainId,
        expectedWithdrawalAddress: hoodi.withdrawalAddress,
      }),
    ).resolves.toBeUndefined();
  });

  it('still rejects a deposit with an invalid signature', async () => {
    const { verifyDepositPayloads } = await withThrowingBatch();
    const { fromHexString, toHexString } = await import('@chainsafe/ssz');
    const { depositDataContainer } =
      await import('../../src/verification/sszTypes');
    const { clusterLockV1X10 } = await import('../fixtures');
    // A well-formed G2 point that is another deposit's signature, with the
    // root recomputed so only the BLS check can reject it.
    const signature =
      clusterLockV1X10.distributed_validators[0].partial_deposit_data[0]
        .signature;
    const d = hoodi.deposit;
    const root = depositDataContainer.hashTreeRoot({
      pubkey: fromHexString(d.pubkey),
      withdrawal_credentials: fromHexString(d.withdrawal_credentials),
      amount: BigInt(d.amount) / BigInt(1e9),
      signature: fromHexString(signature),
    });
    const wrong = { ...d, signature, deposit_data_root: toHexString(root) };
    await expect(
      verifyDepositPayloads([wrong], {
        chainId: hoodi.chainId,
        expectedWithdrawalAddress: hoodi.withdrawalAddress,
      }),
    ).rejects.toThrow('invalid deposit signature for chain 560048');
  });
});
