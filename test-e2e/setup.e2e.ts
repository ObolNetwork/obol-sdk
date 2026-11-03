/**
 * setup.prepareOvmWithSplits → send → ovmFromReceipt on a Hoodi fork, then
 * the reads (ovm.verify, ovm.getState, splits.getSplit) against what the
 * real factories created.
 */
import { parseAbi, parseEther, type Address } from 'viem';
import { hashSplitParams } from '../src/splits/index.js';
import {
  codes,
  describeFork,
  NET,
  publicClient,
  randomAddress,
  sendAndWait,
  signer,
  type Signer,
} from './helpers/fork.js';
import { deployOvm, type DeployedOvm } from './helpers/ovm.js';

const ovmReadAbi = parseAbi([
  'function owner() view returns (address)',
  'function principalRecipient() view returns (address)',
  'function rewardRecipient() view returns (address)',
  'function amountOfPrincipalStake() view returns (uint256)',
  'function principalThreshold() view returns (uint64)',
]);
const splitAbi = parseAbi(['function splitHash() view returns (bytes32)']);

describeFork('setup.prepareOvmWithSplits', () => {
  let s: Signer;
  let principal: Address;
  let deployed: DeployedOvm;

  beforeAll(async () => {
    s = await signer(1);
    principal = randomAddress();
  });

  test('prepares a split create plus the OVM create through Multicall3', async () => {
    deployed = await deployOvm(s, { principalRecipient: principal });
    const { prepared } = deployed;
    expect(prepared.request.to).toBe(NET.multicall3);
    expect(prepared.preview.rewardRecipient.created).toBe(true);
    expect(prepared.preview.principalRecipient).toEqual({
      address: principal,
      created: false,
    });
    expect(codes(prepared.checks)).toEqual(['RECIPIENT_NOT_CONTRACT']);
    // The predicted split address had no code at the prepared block.
    expect(
      await publicClient.getCode({
        address: prepared.preview.rewardRecipient.address,
        blockNumber: prepared.blockNumber,
      }),
    ).toBeUndefined();
  });

  test('ovmFromReceipt matches the mined event and the contract state', async () => {
    const { ovm, prepared } = deployed;
    expect(deployed).toMatchObject({
      owner: s.address,
      principalRecipient: principal,
      rewardRecipient: prepared.preview.rewardRecipient.address,
      principalThreshold: parseEther('16'),
    });
    const read = async (functionName: (typeof ovmReadAbi)[number]['name']) =>
      await publicClient.readContract({
        address: ovm,
        abi: ovmReadAbi,
        functionName,
      });
    expect(await read('owner')).toBe(s.address);
    expect(await read('principalRecipient')).toBe(principal);
    expect(await read('rewardRecipient')).toBe(
      prepared.preview.rewardRecipient.address,
    );
    expect(await read('principalThreshold')).toBe(16_000_000_000n);
    // The split now exists at the predicted address.
    expect(
      await publicClient.getCode({
        address: prepared.preview.rewardRecipient.address,
      }),
    ).toMatch(/^0x[0-9a-f]{2,}/);
  });

  test('ovm.verify finds the creation event by scanning from the factory deploy block', async () => {
    const verification = await s.obol.ovm.verify(deployed.ovm);
    expect(verification).toEqual({
      status: 'obol',
      source: 'chain',
      factoryAddress: NET.ovmFactory,
      reason: expect.any(String),
      creationTxHash: deployed.receipt.transactionHash,
    });
  });

  test('ovm.verify reports notObol for a contract and an EOA the factory did not create', async () => {
    const warehouse = await s.obol.ovm.verify(NET.warehouse);
    expect(warehouse).toMatchObject({ status: 'notObol', source: 'chain' });
    const eoa = await s.obol.ovm.verify(randomAddress());
    expect(eoa).toMatchObject({ status: 'notObol', source: 'chain' });
  });

  test('ovm.getState matches the setup inputs', async () => {
    const state = (await s.obol.ovm.getState(deployed.ovm))!;
    expect(state).toMatchObject({
      address: deployed.ovm,
      owner: s.address,
      principalRecipient: principal,
      rewardRecipient: deployed.prepared.preview.rewardRecipient.address,
      amountOfPrincipalStake: 0n,
      fundsPendingWithdrawal: 0n,
      principalThreshold: parseEther('16'),
      balance: 0n,
      pullBalances: { principalRecipient: 0n, rewardRecipient: 0n },
      distributable: 0n,
      principalPayout: 0n,
      rewardPayout: 0n,
      findings: [],
      source: 'chain',
    });
    expect(state.blockNumber).toBeGreaterThanOrEqual(
      deployed.receipt.blockNumber,
    );
    expect(state.principalOnBeaconChain).toBeUndefined();
  });

  test('splits.getSplit with params checks them against the on-chain splitHash', async () => {
    const address = deployed.rewardRecipient;
    const split = await s.obol.splits.getSplit({
      address,
      params: deployed.rewardSplit,
    });
    const onChain = await publicClient.readContract({
      address,
      abi: splitAbi,
      functionName: 'splitHash',
    });
    expect(split).toMatchObject({
      address,
      splitHash: onChain,
      owner: '0x0000000000000000000000000000000000000000',
      paused: false,
      balance: 0n,
      warehouseBalance: 0n,
      params: deployed.rewardSplit,
      paramsSource: 'input',
    });
    expect(hashSplitParams(deployed.rewardSplit)).toBe(onChain);
    // The RAF recipient is in the split with 1%.
    const raf = deployed.rewardSplit.recipients.indexOf(NET.rafRecipient);
    expect(deployed.rewardSplit.allocations[raf]).toBe(10_000n);
  });

  test('splits.getSplit without params reads them from the SplitCreated log', async () => {
    const split = (await s.obol.splits.getSplit({
      address: deployed.rewardRecipient,
    }))!;
    expect(split.paramsSource).toBe('chain');
    expect(split.params).toEqual(deployed.rewardSplit);
    expect(hashSplitParams(split.params!)).toBe(split.splitHash);
  });

  test('re-preparing the same setup reuses the split and creates a second OVM', async () => {
    const again = await s.obol.setup.prepareOvmWithSplits(deployed.input);
    expect(again.preview.rewardRecipient).toEqual({
      address: deployed.rewardRecipient,
      created: false,
    });
    expect(again.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'SPLIT_REUSED',
          details: { address: deployed.rewardRecipient },
        }),
      ]),
    );
    // Nothing to create: the direct factory call.
    expect(again.request.to).toBe(NET.ovmFactory);
    const receipt = await sendAndWait(s.obol, again);
    const second = s.obol.setup.ovmFromReceipt(receipt);
    expect(second.ovm).not.toBe(deployed.ovm);
    expect(second.rewardRecipient).toBe(deployed.rewardRecipient);
    expect((await s.obol.ovm.verify(second.ovm)).status).toBe('obol');
  });
});
