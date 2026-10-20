/**
 * EIP-7002 / EIP-7251 requests on a Hoodi fork: ovm.prepareWithdraw,
 * ovm.prepareConsolidate and withdrawals.prepareEoaWithdraw → send, checked
 * against the system contracts' request logs and queue counters, the fee
 * they charged and the excess refunded.
 */
import {
  concat,
  numberToHex,
  parseEther,
  toHex,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import {
  balanceOf,
  blsPubkey,
  describeFork,
  expectCode,
  gasCost,
  HOODI,
  makeDeposit,
  publicClient,
  randomAddress,
  randomBlsSecret,
  sendAndWait,
  signer,
  testClient,
  type Signer,
} from './helpers/fork.js';
import { deployOvm, type DeployedOvm } from './helpers/ovm.js';

/** The current fee of a request predeploy (empty calldata). */
const currentFee = async (predeploy: Address): Promise<bigint> => {
  const { data } = await publicClient.call({ to: predeploy, data: '0x' });
  return BigInt(data ?? '0x0');
};

/** Request count (slot 1) of a request predeploy; anvil does not dequeue. */
const queued = async (predeploy: Address): Promise<bigint> =>
  BigInt(
    (await publicClient.getStorageAt({ address: predeploy, slot: '0x1' })) ??
      '0x0',
  );

/** The predeploy's anonymous request logs in a receipt. */
const requestLogs = (receipt: TransactionReceipt, predeploy: Address): Hex[] =>
  receipt.logs
    .filter(log => log.address.toLowerCase() === predeploy.toLowerCase())
    .map(log => log.data);

const uint64be = (value: bigint): Hex => numberToHex(value, { size: 8 });

describeFork('EIP-7002 / EIP-7251 requests on a Hoodi fork', () => {
  let s: Signer;
  let d: DeployedOvm;
  let pubkey: Hex;

  beforeAll(async () => {
    s = await signer(6);
    d = await deployOvm(s);
    // A validator of this OVM: a real 32 ETH deposit with 0x02 credentials.
    const deposit = makeDeposit({ withdrawalAddress: d.ovm, prefix: '0x02' });
    pubkey = deposit.pubkey;
    const [tx] = await s.obol.deposits.prepareDeposit({
      deposits: [deposit],
      via: { ovm: d.ovm },
    });
    await sendAndWait(s.obol, tx);
  });

  test('partial withdrawal: the predeploy queues it, charges the current fee and the OVM refunds the rest', async () => {
    const fee = await currentFee(HOODI.withdrawalRequest);
    expect(fee).toBeGreaterThan(0n);
    const excessFeeRecipient = randomAddress();
    const prepared = await s.obol.ovm.prepareWithdraw({
      ovm: d.ovm,
      requests: [{ pubkey, amount: parseEther('1') }],
      excessFeeRecipient,
    });
    expect(prepared.request).toMatchObject({
      to: d.ovm,
      value: 2n * fee,
    });
    expect(prepared.checks).toEqual([]);
    expect(prepared.preview).toEqual({
      requests: [
        {
          pubkey,
          amount: parseEther('1'),
          // 1 ETH alone stays below the 16 ETH principal threshold.
          routedAs: 'reward',
          principalPart: 0n,
          rewardPart: parseEther('1'),
        },
      ],
      totalFee: 2n * fee,
      maxFeePerRequest: 2n * fee,
    });

    const countBefore = await queued(HOODI.withdrawalRequest);
    const predeployBefore = await balanceOf(HOODI.withdrawalRequest);
    const receipt = await sendAndWait(s.obol, prepared);
    expect(requestLogs(receipt, HOODI.withdrawalRequest)).toEqual([
      concat([d.ovm.toLowerCase() as Hex, pubkey, uint64be(1_000_000_000n)]),
    ]);
    expect(await queued(HOODI.withdrawalRequest)).toBe(countBefore + 1n);
    expect((await balanceOf(HOODI.withdrawalRequest)) - predeployBefore).toBe(
      fee,
    );
    expect(await balanceOf(excessFeeRecipient)).toBe(fee);
    expect(await balanceOf(d.ovm)).toBe(0n);
  });

  test('the refund goes to the sender by default', async () => {
    const fee = await currentFee(HOODI.withdrawalRequest);
    const prepared = await s.obol.ovm.prepareWithdraw({
      ovm: d.ovm,
      requests: [{ pubkey, amount: parseEther('2') }],
    });
    const before = await balanceOf(s.address);
    const receipt = await sendAndWait(s.obol, prepared);
    // Net cost: one fee plus gas; the second fee came back.
    expect(before - (await balanceOf(s.address))).toBe(fee + gasCost(receipt));
  });

  test('two requests in one call: two queue entries, the fee twice', async () => {
    const fee = await currentFee(HOODI.withdrawalRequest);
    const other = blsPubkey(randomBlsSecret());
    const excessFeeRecipient = randomAddress();
    const prepared = await s.obol.ovm.prepareWithdraw({
      ovm: d.ovm,
      requests: [
        { pubkey, amount: parseEther('1') },
        { pubkey: other, amount: parseEther('3') },
      ],
      excessFeeRecipient,
    });
    expect(prepared.preview.totalFee).toBe(4n * fee);
    expect(prepared.preview.maxFeePerRequest).toBe(2n * fee);
    const countBefore = await queued(HOODI.withdrawalRequest);
    const receipt = await sendAndWait(s.obol, prepared);
    expect(requestLogs(receipt, HOODI.withdrawalRequest)).toEqual([
      concat([d.ovm.toLowerCase() as Hex, pubkey, uint64be(1_000_000_000n)]),
      concat([d.ovm.toLowerCase() as Hex, other, uint64be(3_000_000_000n)]),
    ]);
    expect(await queued(HOODI.withdrawalRequest)).toBe(countBefore + 2n);
    expect(await balanceOf(excessFeeRecipient)).toBe(2n * fee);
  });

  test('a full exit needs acknowledgeFullExit, then queues amount 0', async () => {
    await expectCode(
      async () =>
        await s.obol.ovm.prepareWithdraw({
          ovm: d.ovm,
          requests: [{ pubkey, amount: 0n }],
        }),
      'FULL_EXIT_NOT_ACKNOWLEDGED',
    );
    const prepared = await s.obol.ovm.prepareWithdraw({
      ovm: d.ovm,
      requests: [{ pubkey, amount: 0n }],
      acknowledgeFullExit: true,
    });
    // Without a status source the exiting balance is unknown: no routing.
    expect(prepared.preview.requests).toEqual([{ pubkey, amount: 0n }]);
    const receipt = await sendAndWait(s.obol, prepared);
    expect(requestLogs(receipt, HOODI.withdrawalRequest)).toEqual([
      concat([d.ovm.toLowerCase() as Hex, pubkey, uint64be(0n)]),
    ]);
  });

  test('routedAs matches what a distribution does when that ETH arrives', async () => {
    const state = await s.obol.ovm.getState(d.ovm);
    expect(state.amountOfPrincipalStake).toBe(parseEther('32'));
    const amount = parseEther('40');
    const prepared = await s.obol.ovm.prepareWithdraw({
      ovm: d.ovm,
      requests: [{ pubkey, amount }],
    });
    const [request] = prepared.preview.requests;
    expect(request).toMatchObject({
      routedAs: 'mixed',
      principalPart: parseEther('32'),
      rewardPart: parseEther('8'),
    });
    const snapshot = await testClient.snapshot();
    try {
      await testClient.setBalance({ address: d.ovm, value: amount });
      const preview = await s.obol.ovm.previewDistribute({ ovm: d.ovm });
      expect(preview.principalPayout).toBe(request.principalPart);
      expect(preview.rewardPayout).toBe(request.rewardPart);
    } finally {
      await testClient.revert({ id: snapshot });
    }
  });

  test('a given fee below the current fee is FEE_OUT_OF_RANGE; exactly the fee leaves no refund', async () => {
    const fee = await currentFee(HOODI.withdrawalRequest);
    await expectCode(
      async () =>
        await s.obol.ovm.prepareWithdraw({
          ovm: d.ovm,
          requests: [{ pubkey, amount: parseEther('1') }],
          fee: fee - 1n,
        }),
      'FEE_OUT_OF_RANGE',
    );
    const excessFeeRecipient = randomAddress();
    const prepared = await s.obol.ovm.prepareWithdraw({
      ovm: d.ovm,
      requests: [{ pubkey, amount: parseEther('1') }],
      fee,
      excessFeeRecipient,
    });
    expect(prepared.request.value).toBe(fee);
    await sendAndWait(s.obol, prepared);
    expect(await balanceOf(excessFeeRecipient)).toBe(0n);
  });

  test('a prepared withdrawal sent after the fee rose above its maximum is not sent and pays nothing', async () => {
    const prepared = await s.obol.ovm.prepareWithdraw({
      ovm: d.ovm,
      requests: [{ pubkey, amount: parseEther('1') }],
    });
    const snapshot = await testClient.snapshot();
    try {
      // Raise the predeploy's excess counter (slot 0) so the fee exceeds
      // maxFeePerWithdrawal (2× the fee at prepare time).
      await testClient.setStorageAt({
        address: HOODI.withdrawalRequest,
        index: '0x0',
        value: toHex(100n, { size: 32 }),
      });
      const newFee = await currentFee(HOODI.withdrawalRequest);
      expect(newFee).toBeGreaterThan(prepared.preview.maxFeePerRequest);
      const countBefore = await queued(HOODI.withdrawalRequest);
      const balanceBefore = await balanceOf(s.address);
      // The OVM would revert (fee above maxFeePerWithdrawal): the wallet's
      // gas estimate fails, so nothing is broadcast.
      const error = await expectCode(
        async () => await sendAndWait(s.obol, prepared),
        'TX_REJECTED',
      );
      expect(error.message).toMatch(/revert/i);
      expect(await queued(HOODI.withdrawalRequest)).toBe(countBefore);
      expect(await balanceOf(s.address)).toBe(balanceBefore);
    } finally {
      await testClient.revert({ id: snapshot });
    }
  });

  test('a sender without WITHDRAWAL is OVM_ROLE_MISSING', async () => {
    const outsider = await signer(7);
    await expectCode(
      async () =>
        await outsider.obol.ovm.prepareWithdraw({
          ovm: d.ovm,
          requests: [{ pubkey, amount: parseEther('1') }],
        }),
      'OVM_ROLE_MISSING',
    );
  });

  test('consolidation: the EIP-7251 predeploy queues source → target and the OVM refunds the rest', async () => {
    await expectCode(
      async () =>
        await s.obol.ovm.prepareConsolidate({
          ovm: d.ovm,
          requests: [{ sources: [pubkey], target: pubkey }],
        } as never),
      'CONSOLIDATION_NOT_ACKNOWLEDGED',
    );
    const fee = await currentFee(HOODI.consolidationRequest);
    const target = blsPubkey(randomBlsSecret());
    const excessFeeRecipient = randomAddress();
    const prepared = await s.obol.ovm.prepareConsolidate({
      ovm: d.ovm,
      requests: [{ sources: [pubkey], target }],
      acknowledgeStakeMovesToTarget: true,
      excessFeeRecipient,
    });
    expect(prepared.request.value).toBe(2n * fee);
    expect(prepared.preview).toEqual({
      requests: [{ sources: [pubkey], target }],
      totalFee: 2n * fee,
      maxFeePerRequest: 2n * fee,
    });
    const countBefore = await queued(HOODI.consolidationRequest);
    const receipt = await sendAndWait(s.obol, prepared);
    expect(requestLogs(receipt, HOODI.consolidationRequest)).toEqual([
      concat([d.ovm.toLowerCase() as Hex, pubkey, target]),
    ]);
    expect(await queued(HOODI.consolidationRequest)).toBe(countBefore + 1n);
    expect(await balanceOf(excessFeeRecipient)).toBe(fee);
  });

  test('withdrawals.prepareEoaWithdraw sends straight to the predeploy with exactly the fee', async () => {
    const fee = await currentFee(HOODI.withdrawalRequest);
    const eoaPubkey = blsPubkey(randomBlsSecret());
    const prepared = await s.obol.withdrawals.prepareEoaWithdraw({
      pubkey: eoaPubkey,
      amount: parseEther('1'),
    });
    expect(prepared.request).toMatchObject({
      to: HOODI.withdrawalRequest,
      value: fee,
      data: concat([eoaPubkey, uint64be(1_000_000_000n)]),
    });
    const receipt = await sendAndWait(s.obol, prepared);
    expect(requestLogs(receipt, HOODI.withdrawalRequest)).toEqual([
      concat([
        s.address.toLowerCase() as Hex,
        eoaPubkey,
        uint64be(1_000_000_000n),
      ]),
    ]);
  });
});
