/**
 * OVM and split distributions on a Hoodi fork: ovm.previewDistribute,
 * splits.previewDistribution / prepareDistribution → send, then every leg of
 * the preview (OVM payout, split distribution, Warehouse withdrawals, direct
 * payments) compared with the balances and logs after mining.
 */
import {
  encodeFunctionData,
  parseAbi,
  parseEther,
  type Address,
  type TransactionReceipt,
} from 'viem';
import { NATIVE_TOKEN } from '../src/abi.js';
import type { DistributionPreview } from '../src/splits/index.js';
import type { Prepared, SplitParams } from '../src/types.js';
import {
  balanceOf,
  codes,
  describeFork,
  expectCode,
  gasCost,
  NET,
  impersonate,
  makeDeposit,
  publicClient,
  randomAddress,
  sendAndWait,
  signer,
  testClient,
  type Signer,
} from './helpers/fork.js';
import { deployOvm, type DeployedOvm } from './helpers/ovm.js';

const warehouseAbi = parseAbi([
  'function balanceOf(address owner, uint256 id) view returns (uint256)',
  'function setWithdrawConfig((uint16 incentive, bool paused) config)',
]);
const splitAbi = parseAbi([
  'function setPaused(bool paused)',
  'function distribute((address[] recipients, uint256[] allocations, uint256 totalAllocation, uint16 distributionIncentive) split, address token, address distributor)',
]);
const NATIVE_ID = BigInt(NATIVE_TOKEN);

const warehouseBalance = async (owner: Address): Promise<bigint> =>
  await publicClient.readContract({
    address: NET.warehouse,
    abi: warehouseAbi,
    functionName: 'balanceOf',
    args: [owner, NATIVE_ID],
  });

const transfer = async (
  s: Signer,
  to: Address,
  value: bigint,
): Promise<void> => {
  const hash = await s.walletClient.sendTransaction({
    account: s.account,
    chain: s.walletClient.chain,
    to,
    value,
  });
  await publicClient.waitForTransactionReceipt({ hash });
};

const withoutDust = (amount: bigint): bigint =>
  amount > 0n ? amount - 1n : 0n;

type Row = DistributionPreview['recipients'][number];

/**
 * ETH the transaction should send to a recipient's wallet, from the preview
 * fields: the direct OVM payout, plus, when its withdrawal is included, each
 * leg at or above minWithdraw (the Warehouse: what was waiting there and the
 * split credits; SplitMain v1), less the 1 wei each leaves.
 */
const toWallet = (r: Row, minWithdraw: bigint): bigint => {
  if (!r.withdraw || r.skipReason !== undefined) return r.fromOvm;
  const warehouse = withoutDust(
    r.warehouseBalance +
      r.fromRewardSplit +
      r.fromPrincipalSplit +
      r.distributorReward,
  );
  const splitMain = withoutDust(r.splitMainBalance);
  return (
    r.fromOvm +
    (warehouse >= minWithdraw ? warehouse : 0n) +
    (splitMain >= minWithdraw ? splitMain : 0n)
  );
};

/**
 * Sends a prepared distribution and checks each recipient's wallet and
 * Warehouse balances, the OVM payout and the receipt parse against the
 * preview. Returns the receipt.
 */
const executeAndCompare = async (
  s: Signer,
  prepared: Prepared<'distribution'>,
  ovm?: Address,
): Promise<TransactionReceipt> => {
  const { preview } = prepared;
  const addresses = preview.recipients.map(r => r.address);
  const walletBefore = await Promise.all(addresses.map(a => balanceOf(a)));
  const warehouseBefore = await Promise.all(addresses.map(warehouseBalance));
  preview.recipients.forEach((r, i) => {
    // The preview read the same block we just read.
    expect(r.warehouseBalance).toBe(warehouseBefore[i]);
  });

  const receipt = await sendAndWait(s.obol, prepared);
  const parsed = s.obol.splits.distributionFromReceipt(receipt, {
    ...(ovm !== undefined ? { ovm } : {}),
  });

  for (const [i, r] of preview.recipients.entries()) {
    const sender = r.address === s.address;
    const walletAfter = await balanceOf(r.address);
    const spent = sender ? gasCost(receipt) : 0n;
    expect({
      address: r.address,
      received: walletAfter - walletBefore[i] + spent,
    }).toEqual({
      address: r.address,
      received: toWallet(r, preview.minWithdraw),
    });

    const credited =
      warehouseBefore[i] +
      r.fromRewardSplit +
      r.fromPrincipalSplit +
      (preview.splits.some(sp => sp.distributorReward > 0) && sender
        ? preview.splits.reduce((sum, sp) => sum + sp.distributorReward, 0n)
        : 0n);
    const withdrawn = r.withdraw && r.skipReason === undefined;
    const warehouseAfter = await warehouseBalance(r.address);
    expect({ address: r.address, warehouse: warehouseAfter }).toEqual({
      address: r.address,
      warehouse:
        withdrawn && withoutDust(credited) > 0n
          ? credited - withoutDust(credited)
          : credited,
    });
    const fromWithdrawals = toWallet(r, preview.minWithdraw) - r.fromOvm;
    if (withdrawn && fromWithdrawals > 0n) {
      expect(parsed.withdrawn[r.address]).toBe(fromWithdrawals);
    } else {
      expect(parsed.withdrawn[r.address]).toBeUndefined();
    }
  }
  if (preview.ovm !== undefined && preview.ovm.skipReason === undefined) {
    expect(parsed.ovmPayout).toEqual({
      principal: preview.ovm.principalPayout,
      reward: preview.ovm.rewardPayout,
    });
  } else {
    expect(parsed.ovmPayout).toBeUndefined();
  }
  return receipt;
};

describeFork('distributions', () => {
  let s: Signer;
  let principal: Address;
  let d: DeployedOvm;
  let r1: Address;
  let r2: Address;

  beforeAll(async () => {
    s = await signer(4);
    principal = randomAddress();
    d = await deployOvm(s, { principalRecipient: principal });
    [r1, r2] = d.recipients.map(r => r.address);
    // A real 32 ETH deposit through the OVM sets amountOfPrincipalStake.
    const [tx] = await s.obol.deposits.prepareDeposit({
      deposits: [makeDeposit({ withdrawalAddress: d.ovm })],
      via: { ovm: d.ovm },
    });
    await sendAndWait(s.obol, tx);
  });

  test('rewards below the principal threshold go through the reward split to its recipients', async () => {
    await transfer(s, d.ovm, parseEther('0.5'));
    const { preview: ovmPreview, checks: ovmChecks } =
      await s.obol.ovm.previewDistribute({ ovm: d.ovm });
    expect(ovmPreview).toMatchObject({
      mode: 'push',
      distributable: parseEther('0.5'),
      principalPayout: 0n,
      rewardPayout: parseEther('0.5'),
      principalRecipient: principal,
      rewardRecipient: d.rewardRecipient,
    });
    expect(ovmChecks).toEqual([]);

    const prepared = await s.obol.splits.prepareDistribution({ ovm: d.ovm });
    const { preview } = prepared;
    expect(prepared.request.to).toBe(NET.multicall3);
    expect(prepared.checks).toEqual([]);
    expect(preview.ovm).toEqual({
      address: d.ovm,
      distributable: parseEther('0.5'),
      principalPayout: 0n,
      rewardPayout: parseEther('0.5'),
      principalRecipient: principal,
      rewardRecipient: d.rewardRecipient,
    });
    expect(preview.splits).toEqual([
      {
        address: d.rewardRecipient,
        kind: 'reward',
        distributable: parseEther('0.5') - 1n,
        distributorReward: 0n,
      },
    ]);
    const byAddress = Object.fromEntries(
      preview.recipients.map(r => [r.address, r]),
    );
    // The RAF is withdrawn by default (rc.4).
    expect(byAddress[NET.rafRecipient].withdraw).toBe(true);
    expect(byAddress[principal]).toMatchObject({ fromOvm: 0n });
    expect(toWallet(byAddress[principal], preview.minWithdraw)).toBe(0n);
    expect(byAddress[r1].withdraw).toBe(true);
    expect(byAddress[r2].withdraw).toBe(true);

    await executeAndCompare(s, prepared, d.ovm);
    expect(await balanceOf(d.ovm)).toBe(0n);
    // The split keeps 1 wei.
    expect(await balanceOf(d.rewardRecipient)).toBe(1n);
  });

  test('an exit-sized arrival pays the principal stake first, then rewards', async () => {
    await transfer(s, d.ovm, parseEther('33'));
    const { preview: ovmPreview, checks: ovmChecks } =
      await s.obol.ovm.previewDistribute({ ovm: d.ovm });
    expect(ovmPreview).toMatchObject({
      distributable: parseEther('33'),
      principalPayout: parseEther('32'),
      rewardPayout: parseEther('1'),
    });
    expect(ovmChecks).toEqual([]);
    const prepared = await s.obol.splits.prepareDistribution({ ovm: d.ovm });
    const direct = prepared.preview.recipients.find(
      r => r.address === principal,
    );
    expect(direct).toMatchObject({ fromOvm: parseEther('32') });
    expect(toWallet(direct!, prepared.preview.minWithdraw)).toBe(
      parseEther('32'),
    );
    await executeAndCompare(s, prepared, d.ovm);
    const state = (await s.obol.ovm.getState(d.ovm))!;
    expect(state.amountOfPrincipalStake).toBe(0n);
    expect(state.balance).toBe(0n);
  });

  test('minWithdraw leaves out legs below it with a skipReason, and the chain leaves them in place', async () => {
    await transfer(s, d.ovm, parseEther('1'));
    const minWithdraw = parseEther('0.5');
    const { preview, checks } = await s.obol.splits.previewDistribution({
      ovm: d.ovm,
      minWithdraw,
    });
    expect(checks).toEqual([]);
    expect(preview.ovm?.skipReason).toBeUndefined();
    const r2Leg = preview.recipients.find(r => r.address === r2);
    // 39% of 1 ETH is below 0.5 ETH.
    expect(r2Leg).toMatchObject({ withdraw: true, skipReason: 'dust' });
    expect(toWallet(r2Leg!, preview.minWithdraw)).toBe(0n);
    const r1Leg = preview.recipients.find(r => r.address === r1);
    expect(r1Leg?.skipReason).toBeUndefined();
    expect(toWallet(r1Leg!, preview.minWithdraw)).toBeGreaterThanOrEqual(
      minWithdraw,
    );

    const prepared = await s.obol.splits.prepareDistribution({
      ovm: d.ovm,
      minWithdraw,
    });
    expect(prepared.preview).toEqual(preview);
    await executeAndCompare(s, prepared, d.ovm);
  });

  test('with nothing above minWithdraw the preview names each skipped leg and prepare throws NOTHING_TO_DISTRIBUTE', async () => {
    await transfer(s, d.ovm, parseEther('0.001'));
    const minWithdraw = parseEther('0.5');
    const { preview } = await s.obol.splits.previewDistribution({
      ovm: d.ovm,
      minWithdraw,
    });
    expect(preview.ovm?.skipReason).toBe('dust');
    for (const split of preview.splits) {
      expect(split.skipReason).toBe(
        split.distributable === 0n ? 'nothing' : 'dust',
      );
    }
    for (const r of preview.recipients.filter(r => r.withdraw)) {
      expect(r.skipReason).toBeDefined();
      expect(toWallet(r, preview.minWithdraw)).toBe(0n);
    }
    await expectCode(
      async () =>
        await s.obol.splits.prepareDistribution({ ovm: d.ovm, minWithdraw }),
      'NOTHING_TO_DISTRIBUTE',
    );
    // The default minWithdraw (1 wei) still distributes the dust.
    const prepared = await s.obol.splits.prepareDistribution({ ovm: d.ovm });
    expect(prepared.preview.ovm?.skipReason).toBeUndefined();
    await executeAndCompare(s, prepared, d.ovm);
  });

  test('a recipient that paused its Warehouse withdrawals is left out with RECIPIENT_WITHDRAW_PAUSED', async () => {
    const r2Wallet = await impersonate(r2);
    const hash = await r2Wallet.walletClient.sendTransaction({
      account: r2,
      chain: r2Wallet.walletClient.chain,
      to: NET.warehouse,
      data: encodeFunctionData({
        abi: warehouseAbi,
        functionName: 'setWithdrawConfig',
        args: [{ incentive: 0, paused: true }],
      }),
    });
    await publicClient.waitForTransactionReceipt({ hash });

    await transfer(s, d.ovm, parseEther('0.5'));
    const prepared = await s.obol.splits.prepareDistribution({ ovm: d.ovm });
    expect(codes(prepared.checks)).toEqual(['RECIPIENT_WITHDRAW_PAUSED']);
    expect(prepared.checks[0].details).toEqual({ address: r2 });
    expect(
      prepared.preview.recipients.find(r => r.address === r2),
    ).toMatchObject({ withdraw: true, skipReason: 'paused' });
    await executeAndCompare(s, prepared, d.ovm);

    // Sent by the paused recipient itself (an EOA, so tx.origin): included.
    await transfer(s, d.ovm, parseEther('0.5'));
    const own = await r2Wallet.obol.splits.prepareDistribution({ ovm: d.ovm });
    expect(codes(own.checks)).toEqual([]);
    const r2Leg = own.preview.recipients.find(r => r.address === r2);
    expect(r2Leg?.skipReason).toBeUndefined();
    expect(toWallet(r2Leg!, own.preview.minWithdraw)).toBeGreaterThan(0n);
    await executeAndCompare(r2Wallet, own, d.ovm);
    await testClient.stopImpersonatingAccount({ address: r2 });
  });

  test('pull mode: prepareDistribute(pull) credits pull balances, prepareWithdrawPullBalance pays them', async () => {
    await transfer(s, d.ovm, parseEther('2'));
    const pull = await s.obol.ovm.prepareDistribute({
      ovm: d.ovm,
      mode: 'pull',
    });
    expect(pull.preview).toMatchObject({
      mode: 'pull',
      distributable: parseEther('2'),
      rewardPayout: parseEther('2'),
      principalPayout: 0n,
    });
    await sendAndWait(s.obol, pull);
    const state = (await s.obol.ovm.getState(d.ovm))!;
    expect(state).toMatchObject({
      balance: parseEther('2'),
      fundsPendingWithdrawal: parseEther('2'),
      pullBalances: {
        principalRecipient: 0n,
        rewardRecipient: parseEther('2'),
      },
      distributable: 0n,
    });
    const { preview } = await s.obol.ovm.previewDistribute({ ovm: d.ovm });
    expect(preview.distributable).toBe(0n);
    await expectCode(
      async () => await s.obol.ovm.prepareDistribute({ ovm: d.ovm }),
      'NOTHING_TO_DISTRIBUTE',
    );

    const before = await balanceOf(d.rewardRecipient);
    const withdraw = await s.obol.ovm.prepareWithdrawPullBalance({
      ovm: d.ovm,
      account: d.rewardRecipient,
    });
    expect(withdraw.preview.amount).toBe(parseEther('2'));
    await sendAndWait(s.obol, withdraw);
    expect((await balanceOf(d.rewardRecipient)) - before).toBe(parseEther('2'));
    expect((await s.obol.ovm.getState(d.ovm))!.fundsPendingWithdrawal).toBe(0n);
    await expectCode(
      async () =>
        await s.obol.ovm.prepareWithdrawPullBalance({
          ovm: d.ovm,
          account: d.rewardRecipient,
        }),
      'NOTHING_TO_DISTRIBUTE',
    );

    // The split now holds the ETH itself; a split-only distribution moves it.
    const prepared = await s.obol.splits.prepareDistribution({
      rewardSplit: { ...d.rewardSplit, address: d.rewardRecipient },
    });
    expect(prepared.preview.ovm).toBeUndefined();
    // PullSplit.distribute moves (own balance - 1) + (Warehouse balance - 1).
    const own = await balanceOf(d.rewardRecipient, prepared.blockNumber);
    const held = await warehouseBalance(d.rewardRecipient);
    expect(prepared.preview.splits[0].distributable).toBe(
      withoutDust(own) + withoutDust(held),
    );
    await executeAndCompare(s, prepared);
  });

  test('a split distribution incentive goes to the distributor in the Warehouse', async () => {
    const other = await deployOvm(s, {
      principalRecipient: randomAddress(),
      distributionIncentive: 10_000, // 1%
    });
    await transfer(s, other.ovm, parseEther('1'));
    const prepared = await s.obol.splits.prepareDistribution({
      ovm: other.ovm,
    });
    const [split] = prepared.preview.splits;
    expect(split.distributorReward).toBe(split.distributable / 100n);
    const distributor = prepared.preview.recipients.find(
      r => r.address === s.address,
    );
    expect(distributor).toMatchObject({ withdraw: false });
    expect(toWallet(distributor!, prepared.preview.minWithdraw)).toBe(0n);
    await executeAndCompare(s, prepared, other.ovm);
  });

  describe('paused splits', () => {
    let params: SplitParams;
    let split: Address;

    beforeAll(async () => {
      const created = await s.obol.splits.prepareCreateSplit({
        recipients: [
          { address: randomAddress(), share: 500_000 },
          { address: randomAddress(), share: 500_000 },
        ],
        owner: s.address,
      });
      await sendAndWait(s.obol, created);
      ({ address: split, params } = created.preview);
      const hash = await s.walletClient.writeContract({
        account: s.account,
        chain: s.walletClient.chain,
        address: split,
        abi: splitAbi,
        functionName: 'setPaused',
        args: [true],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await transfer(s, split, parseEther('1'));
      expect((await s.obol.splits.getSplit({ address: split }))?.paused).toBe(
        true,
      );
    });

    test('a sender that does not own it gets SPLIT_PAUSED, and the chain would revert', async () => {
      const outsider = await signer(5);
      await expectCode(
        async () =>
          await outsider.obol.splits.prepareDistribution({
            rewardSplit: { ...params, address: split },
          }),
        'SPLIT_PAUSED',
      );
      await expect(
        publicClient.call({
          account: outsider.address,
          to: split,
          data: encodeFunctionData({
            abi: splitAbi,
            functionName: 'distribute',
            args: [params, NATIVE_TOKEN, outsider.address],
          }),
        }),
      ).rejects.toThrow();
    });

    test('the owner, an EOA, distributes it through Multicall3', async () => {
      const prepared = await s.obol.splits.prepareDistribution({
        rewardSplit: { ...params, address: split },
      });
      await executeAndCompare(s, prepared);
    });
  });
});
