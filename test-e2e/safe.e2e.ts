/**
 * `send` with a contract wallet on a Hoodi fork: a 1-of-1 Safe v1.4.1 from
 * the canonical proxy factory, behind a wallet that returns the safeTxHash
 * (as a Safe over WalletConnect does). Checks `contractWallet`, that `wait`
 * follows the Safe's execution logs, and the distribution rules that depend
 * on the sender being an EOA (tx.origin) or not.
 */
import { encodeFunctionData, parseAbi, parseEther, type Address } from 'viem';
import { multicall3Abi, NATIVE_TOKEN } from '../src/abi.js';
import { OVM_ROLES } from '../src/ovm/index.js';
import type { AnyPrepared, SplitParams } from '../src/types.js';
import {
  balanceOf,
  CHAIN,
  codes,
  describeFork,
  expectCode,
  NET,
  obolFor,
  publicClient,
  randomAddress,
  sendAndWait,
  signer,
  type Signer,
} from './helpers/fork.js';
import { deployOvm } from './helpers/ovm.js';
import { deploySafe, safeAbi, safeWallet } from './helpers/safe.js';

const ovmAbi = parseAbi(['function rolesOf(address) view returns (uint256)']);
const splitAbi = parseAbi([
  'function setPaused(bool paused)',
  'function distribute((address[] recipients, uint256[] allocations, uint256 totalAllocation, uint16 distributionIncentive) split, address token, address distributor)',
]);
const warehouseAbi = parseAbi([
  'function balanceOf(address owner, uint256 id) view returns (uint256)',
  'function setWithdrawConfig((uint16 incentive, bool paused) config)',
]);

describeFork('send through a Safe', () => {
  let owner: Signer;
  let safe: Address;

  beforeAll(async () => {
    owner = await signer(12);
    safe = await deploySafe(owner);
  });

  test('the Safe is a v1.4.1 proxy', async () => {
    expect(
      await publicClient.readContract({
        address: safe,
        abi: safeAbi,
        functionName: 'VERSION',
      }),
    ).toBe('1.4.1');
  });

  test('send reports contractWallet and wait resolves with the receipt of the Safe execution', async () => {
    const d = await deployOvm(owner);
    // Hand the OVM to the Safe.
    await sendAndWait(
      owner.obol,
      await owner.obol.ovm.prepareTransfer({
        ovm: d.ovm,
        newPrincipalRecipient: d.principalRecipient,
        newOwner: safe,
      }),
    );
    const wallet = safeWallet(safe, owner);
    const obol = obolFor(wallet.walletClient);
    const user = randomAddress();
    const prepared = await obol.ovm.prepareGrantRoles({
      ovm: d.ovm,
      user,
      roles: OVM_ROLES.DEPOSIT,
    });
    const sent = await obol.send(prepared);
    expect(sent.contractWallet).toBe(true);
    const execution = wallet.executions.get(sent.hash);
    expect(execution).toBeDefined();
    const receipt = await sent.wait({ timeoutMs: 30_000 });
    expect(receipt.transactionHash).toBe(await execution);
    expect(receipt.status).toBe('success');
    expect(
      await publicClient.readContract({
        address: d.ovm,
        abi: ovmAbi,
        functionName: 'rolesOf',
        args: [user],
      }),
    ).toBe(OVM_ROLES.DEPOSIT);
  });

  test('an inner call that fails in the Safe (ExecutionFailure) is TX_REVERTED', async () => {
    const wallet = safeWallet(safe, owner, { safeTxGas: 500_000n });
    const obol = obolFor(wallet.walletClient);
    // grantRoles on an OVM the Safe does not own reverts inside the Safe.
    const d = await deployOvm(owner);
    const prepared: AnyPrepared = {
      kind: 'role',
      request: {
        to: d.ovm,
        data: encodeFunctionData({
          abi: parseAbi(['function grantRoles(address user, uint256 roles)']),
          functionName: 'grantRoles',
          args: [randomAddress(), OVM_ROLES.DEPOSIT],
        }),
        value: 0n,
        chainId: CHAIN.id,
      },
      checks: [],
      preview: { function: 'grantRoles', args: [] },
    };
    const sent = await obol.send(prepared);
    expect(sent.contractWallet).toBe(true);
    const error = await expectCode(
      async () => await sent.wait({ timeoutMs: 30_000 }),
      'TX_REVERTED',
    );
    expect(error.details).toMatchObject({
      hash: sent.hash,
      contractWallet: true,
    });
  });

  describe('a paused split owned by the Safe', () => {
    let split: Address;
    let params: SplitParams;

    beforeAll(async () => {
      const created = await owner.obol.splits.prepareCreateSplit({
        recipients: [
          { address: randomAddress(), share: 500_000 },
          { address: randomAddress(), share: 500_000 },
        ],
        owner: safe,
      });
      await sendAndWait(owner.obol, created);
      ({ address: split, params } = created.preview);
      const wallet = safeWallet(safe, owner);
      const sent = await obolFor(wallet.walletClient).send({
        kind: 'role',
        request: {
          to: split,
          data: encodeFunctionData({
            abi: splitAbi,
            functionName: 'setPaused',
            args: [true],
          }),
          value: 0n,
          chainId: CHAIN.id,
        },
        checks: [],
        preview: { function: 'raw', args: [] },
      });
      await sent.wait({ timeoutMs: 30_000 });
      await owner.walletClient
        .sendTransaction({
          account: owner.account,
          chain: owner.walletClient.chain,
          to: split,
          value: parseEther('1'),
        })
        .then(
          async hash => await publicClient.waitForTransactionReceipt({ hash }),
        );
    });

    test('the Multicall3 distribution reverts on chain when the Safe sends it', async () => {
      // Multicall3 is msg.sender and the Safe's signer is tx.origin, so the
      // split's owner exemption does not apply.
      const wallet = safeWallet(safe, owner, { safeTxGas: 500_000n });
      const sent = await obolFor(wallet.walletClient).send({
        kind: 'role',
        request: {
          to: NET.multicall3,
          data: encodeFunctionData({
            abi: multicall3Abi,
            functionName: 'aggregate3',
            args: [
              [
                {
                  target: split,
                  allowFailure: false,
                  callData: encodeFunctionData({
                    abi: splitAbi,
                    functionName: 'distribute',
                    args: [params, NATIVE_TOKEN, safe],
                  }),
                },
              ],
            ],
          }),
          value: 0n,
          chainId: CHAIN.id,
        },
        checks: [],
        preview: { function: 'raw', args: [] },
      });
      await expectCode(
        async () => await sent.wait({ timeoutMs: 30_000 }),
        'TX_REVERTED',
      );
    });

    test('so prepareDistribution from the Safe is SPLIT_PAUSED', async () => {
      const obol = obolFor(safeWallet(safe, owner).walletClient);
      await expectCode(
        async () =>
          await obol.splits.prepareDistribution({
            rewardSplit: { ...params, address: split },
          }),
        'SPLIT_PAUSED',
      );
    });
  });

  test('a Safe recipient with paused Warehouse withdrawals cannot bypass the pause as sender', async () => {
    const other = randomAddress();
    const d = await deployOvm(owner, {
      recipients: [
        { address: safe, share: 600_000n },
        { address: other, share: 390_000n },
      ],
    });
    const wallet = safeWallet(safe, owner);
    const obol = obolFor(wallet.walletClient);
    const pause = await obol.send({
      kind: 'role',
      request: {
        to: NET.warehouse,
        data: encodeFunctionData({
          abi: warehouseAbi,
          functionName: 'setWithdrawConfig',
          args: [{ incentive: 0, paused: true }],
        }),
        value: 0n,
        chainId: CHAIN.id,
      },
      checks: [],
      preview: { function: 'raw', args: [] },
    });
    await pause.wait({ timeoutMs: 30_000 });

    await owner.walletClient
      .sendTransaction({
        account: owner.account,
        chain: owner.walletClient.chain,
        to: d.ovm,
        value: parseEther('1'),
      })
      .then(
        async hash => await publicClient.waitForTransactionReceipt({ hash }),
      );
    const prepared = await obol.splits.prepareDistribution({ ovm: d.ovm });
    expect(codes(prepared.checks)).toEqual(['RECIPIENT_WITHDRAW_PAUSED']);
    const safeLeg = prepared.preview.recipients.find(r => r.address === safe);
    expect(safeLeg).toMatchObject({ skipReason: 'paused', fromOvm: 0n });
    const otherLeg = prepared.preview.recipients.find(r => r.address === other);

    const safeBefore = await balanceOf(safe);
    const sent = await obol.send(prepared);
    expect(sent.contractWallet).toBe(true);
    await sent.wait({ timeoutMs: 30_000 });
    expect(await balanceOf(safe)).toBe(safeBefore);
    expect(await balanceOf(other)).toBe(
      otherLeg !== undefined
        ? otherLeg.fromThisDistribution + otherLeg.alreadyWaiting - 1n
        : undefined,
    );
    expect(
      await publicClient.readContract({
        address: NET.warehouse,
        abi: warehouseAbi,
        functionName: 'balanceOf',
        args: [safe, BigInt(NATIVE_TOKEN)],
      }),
    ).toBe(safeLeg?.fromRewardSplit);
  });
});
