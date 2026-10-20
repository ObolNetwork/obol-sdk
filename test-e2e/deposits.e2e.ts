/**
 * deposits.prepareDeposit on a Hoodi fork with real BLS deposits for fresh
 * keys: via the OVM (one transaction per deposit, raises
 * amountOfPrincipalStake) and via the batch deposit contract (does not), each
 * checked against the deposit contract's DepositEvent logs and counter.
 */
import {
  decodeEventLog,
  encodeFunctionData,
  parseAbi,
  parseEther,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import { depositDataRoot } from '../src/deposits/verifyDepositData.js';
import type { Deposit } from '../src/types.js';
import {
  codes,
  depositContractAbi,
  depositCount,
  describeFork,
  expectCode,
  HOODI,
  littleEndian,
  makeDeposit,
  publicClient,
  randomAddress,
  sendAndWait,
  signer,
  type Signer,
} from './helpers/fork.js';
import { deployOvm, type DeployedOvm } from './helpers/ovm.js';

const ovmDepositAbi = parseAbi([
  'function deposit(bytes pubkey, bytes withdrawal_credentials, bytes signature, bytes32 deposit_data_root) payable',
  'function amountOfPrincipalStake() view returns (uint256)',
]);

const stakeOf = async (ovm: Hex): Promise<bigint> =>
  await publicClient.readContract({
    address: ovm,
    abi: ovmDepositAbi,
    functionName: 'amountOfPrincipalStake',
  });

/** The deposit contract's DepositEvent logs in a receipt. */
const depositEvents = (
  receipt: TransactionReceipt,
): Array<{
  pubkey: Hex;
  withdrawalCredentials: Hex;
  amountGwei: bigint;
  signature: Hex;
}> =>
  receipt.logs
    .filter(
      log => log.address.toLowerCase() === HOODI.depositContract.toLowerCase(),
    )
    .map(log => {
      const { args } = decodeEventLog({
        abi: depositContractAbi,
        data: log.data,
        topics: log.topics,
      });
      return {
        pubkey: args.pubkey,
        withdrawalCredentials: args.withdrawal_credentials,
        amountGwei: littleEndian(args.amount),
        signature: args.signature,
      };
    });

const expectEventFor = (
  event: ReturnType<typeof depositEvents>[number],
  deposit: Deposit,
): void => {
  expect(event).toEqual({
    pubkey: deposit.pubkey,
    withdrawalCredentials: deposit.withdrawalCredentials,
    amountGwei: deposit.amount / 1_000_000_000n,
    signature: deposit.signature,
  });
};

describeFork('deposits.prepareDeposit on a Hoodi fork', () => {
  let s: Signer;
  let deployed: DeployedOvm;

  beforeAll(async () => {
    s = await signer(2);
    deployed = await deployOvm(s);
  });

  test.each([
    ['0x01', parseEther('32')],
    ['0x02', parseEther('33')],
  ] as const)(
    'via the OVM with %s credentials: one DepositEvent and the principal stake rises by the amount',
    async (prefix, amount) => {
      const deposit = makeDeposit({
        withdrawalAddress: deployed.ovm,
        prefix,
        amount,
      });
      const prepared = await s.obol.deposits.prepareDeposit({
        deposits: [deposit],
        via: { ovm: deployed.ovm },
      });
      expect(prepared).toHaveLength(1);
      const [tx] = prepared;
      expect(tx.request).toMatchObject({ to: deployed.ovm, value: amount });
      expect(tx.preview).toEqual({
        pubkeys: [deposit.pubkey],
        total: amount,
        kind: 'deposit',
      });
      // Chain-only client without beaconUrl: existence is not checked.
      expect(codes(tx.checks)).toEqual(['DEPOSIT_EXISTENCE_UNCHECKED']);

      const stakeBefore = await stakeOf(deployed.ovm);
      const countBefore = await depositCount();
      const receipt = await sendAndWait(s.obol, tx);

      const events = depositEvents(receipt);
      expect(events).toHaveLength(1);
      expectEventFor(events[0], deposit);
      expect(await depositCount()).toBe(countBefore + 1n);
      expect(await stakeOf(deployed.ovm)).toBe(stakeBefore + amount);
      const state = await s.obol.ovm.getState(deployed.ovm);
      expect(state.amountOfPrincipalStake).toBe(stakeBefore + amount);
      // The ETH went to the deposit contract, not the OVM.
      expect(state.balance).toBe(0n);
    },
  );

  test('via the batch contract to an OVM: OVM_STAKE_NOT_TRACKED, and the stake indeed stays the same', async () => {
    const deposits = [
      makeDeposit({ withdrawalAddress: deployed.ovm }),
      makeDeposit({
        withdrawalAddress: deployed.ovm,
        prefix: '0x02',
        amount: parseEther('40'),
      }),
    ];
    const prepared = await s.obol.deposits.prepareDeposit({
      deposits,
      via: { batch: true },
      expectedWithdrawalAddress: deployed.ovm,
    });
    expect(prepared).toHaveLength(1);
    const [tx] = prepared;
    expect(tx.request).toMatchObject({
      to: HOODI.batchDeposit,
      value: parseEther('72'),
    });
    expect(tx.preview).toEqual({
      pubkeys: deposits.map(d => d.pubkey),
      total: parseEther('72'),
      kind: 'deposit',
    });
    expect(codes(tx.checks).sort()).toEqual([
      'DEPOSIT_EXISTENCE_UNCHECKED',
      'OVM_STAKE_NOT_TRACKED',
    ]);

    const stakeBefore = await stakeOf(deployed.ovm);
    const countBefore = await depositCount();
    const receipt = await sendAndWait(s.obol, tx);
    const events = depositEvents(receipt);
    expect(events).toHaveLength(2);
    events.forEach((event, i) => {
      expectEventFor(event, deposits[i]);
    });
    expect(await depositCount()).toBe(countBefore + 2n);
    expect(await stakeOf(deployed.ovm)).toBe(stakeBefore);
  });

  test('via the batch contract to an EOA: no OVM finding', async () => {
    const eoa = randomAddress();
    const deposit = makeDeposit({ withdrawalAddress: eoa });
    const [tx] = await s.obol.deposits.prepareDeposit({
      deposits: [deposit],
      via: { batch: true },
      expectedWithdrawalAddress: eoa,
    });
    expect(codes(tx.checks)).toEqual(['DEPOSIT_EXISTENCE_UNCHECKED']);
    const receipt = await sendAndWait(s.obol, tx);
    expectEventFor(depositEvents(receipt)[0], deposit);
  });

  test('credentials for another address are DEPOSIT_INVALID before anything is sent', async () => {
    const deposit = makeDeposit({ withdrawalAddress: randomAddress() });
    const error = await expectCode(
      async () =>
        await s.obol.deposits.prepareDeposit({
          deposits: [deposit],
          via: { ovm: deployed.ovm },
        }),
      'DEPOSIT_INVALID',
    );
    expect(error.details).toMatchObject({
      index: 0,
      issue: 'credentials_mismatch',
    });
  });

  test('a signature over another amount is DEPOSIT_INVALID, though the deposit contract would accept it', async () => {
    const signed = makeDeposit({ withdrawalAddress: deployed.ovm });
    // Same key and credentials, signed for 31 ETH but sent with 32 ETH.
    const other = makeDeposit({
      withdrawalAddress: deployed.ovm,
      amount: parseEther('31'),
      secret: signed.secret,
    });
    const forged = {
      ...makeDeposit({
        withdrawalAddress: deployed.ovm,
        secret: signed.secret,
      }),
      signature: other.signature,
    };
    forged.depositDataRoot = depositDataRoot({
      pubkey: forged.pubkey,
      withdrawalCredentials: forged.withdrawalCredentials,
      amountGwei: forged.amount / 1_000_000_000n,
      signature: forged.signature,
    });
    const error = await expectCode(
      async () =>
        await s.obol.deposits.prepareDeposit({
          deposits: [forged],
          via: { ovm: deployed.ovm },
        }),
      'DEPOSIT_INVALID',
    );
    expect(error.details).toMatchObject({ issue: 'signature_invalid' });
    // The deposit contract does not check BLS signatures: the SDK is the
    // only guard against this deposit.
    await expect(
      publicClient.call({
        account: s.address,
        to: deployed.ovm,
        value: forged.amount,
        data: encodeFunctionData({
          abi: ovmDepositAbi,
          functionName: 'deposit',
          args: [
            forged.pubkey,
            forged.withdrawalCredentials,
            forged.signature,
            forged.depositDataRoot,
          ],
        }),
      }),
    ).resolves.toBeDefined();
  });

  test('a wrong deposit data root is DEPOSIT_INVALID, and the deposit contract would revert', async () => {
    const deposit = makeDeposit({ withdrawalAddress: deployed.ovm });
    const tampered = {
      ...deposit,
      depositDataRoot: `0x${'11'.repeat(32)}` as Hex,
    };
    const error = await expectCode(
      async () =>
        await s.obol.deposits.prepareDeposit({
          deposits: [tampered],
          via: { ovm: deployed.ovm },
        }),
      'DEPOSIT_INVALID',
    );
    expect(error.details).toMatchObject({ issue: 'root_mismatch' });
    await expect(
      publicClient.call({
        account: s.address,
        to: deployed.ovm,
        value: tampered.amount,
        data: encodeFunctionData({
          abi: ovmDepositAbi,
          functionName: 'deposit',
          args: [
            tampered.pubkey,
            tampered.withdrawalCredentials,
            tampered.signature,
            tampered.depositDataRoot,
          ],
        }),
      }),
    ).rejects.toThrow();
  });

  test('a sender without DEPOSIT is OVM_ROLE_MISSING, and the OVM would revert', async () => {
    const outsider = await signer(3);
    const deposit = makeDeposit({ withdrawalAddress: deployed.ovm });
    await expectCode(
      async () =>
        await outsider.obol.deposits.prepareDeposit({
          deposits: [deposit],
          via: { ovm: deployed.ovm },
        }),
      'OVM_ROLE_MISSING',
    );
    await expect(
      publicClient.call({
        account: outsider.address,
        to: deployed.ovm,
        value: deposit.amount,
        data: encodeFunctionData({
          abi: ovmDepositAbi,
          functionName: 'deposit',
          args: [
            deposit.pubkey,
            deposit.withdrawalCredentials,
            deposit.signature,
            deposit.depositDataRoot,
          ],
        }),
      }),
    ).rejects.toThrow();
  });

  test('via a contract the OVM factory did not create: OVM_NOT_OBOL', async () => {
    const deposit = makeDeposit({ withdrawalAddress: HOODI.warehouse });
    await expectCode(
      async () =>
        await s.obol.deposits.prepareDeposit({
          deposits: [deposit],
          via: { ovm: HOODI.warehouse },
        }),
      'OVM_NOT_OBOL',
    );
  });
});
