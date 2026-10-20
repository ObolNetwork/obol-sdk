/**
 * OVM role and ownership writes on a Hoodi fork: grant / revoke / renounce,
 * transfer and the two-step handover, setAmountOfPrincipalStake. Each
 * prepare's findings and preview are compared with rolesOf / owner / the
 * stake read after mining, and getRoleHolders with the RolesUpdated history.
 */
import { encodeFunctionData, parseAbi, parseEther, type Address } from 'viem';
import { OVM_ROLES } from '../src/ovm/index.js';
import {
  codes,
  describeFork,
  expectCode,
  makeDeposit,
  publicClient,
  randomAddress,
  sendAndWait,
  signer,
  type Signer,
} from './helpers/fork.js';
import { deployOvm, type DeployedOvm } from './helpers/ovm.js';

const ovmAbi = parseAbi([
  'function rolesOf(address user) view returns (uint256)',
  'function owner() view returns (address)',
  'function principalRecipient() view returns (address)',
  'function amountOfPrincipalStake() view returns (uint256)',
  'function grantRoles(address user, uint256 roles) payable',
]);

describeFork('OVM role and ownership writes on a Hoodi fork', () => {
  let owner: Signer;
  let holder: Signer;
  let consolidator: Address;
  let d: DeployedOvm;

  const rolesOf = async (user: Address): Promise<bigint> =>
    await publicClient.readContract({
      address: d.ovm,
      abi: ovmAbi,
      functionName: 'rolesOf',
      args: [user],
    });
  const stake = async (): Promise<bigint> =>
    await publicClient.readContract({
      address: d.ovm,
      abi: ovmAbi,
      functionName: 'amountOfPrincipalStake',
    });

  beforeAll(async () => {
    owner = await signer(8);
    holder = await signer(9);
    consolidator = randomAddress();
    d = await deployOvm(owner);
  });

  test('a new OVM has only its owner, without roles', async () => {
    const holders = await owner.obol.ovm.getRoleHolders(d.ovm);
    expect(holders).toMatchObject({
      owner: owner.address,
      holders: [
        { address: owner.address, roles: 0n, roleNames: [], isOwner: true },
      ],
      source: 'chain',
    });
    const transfer = await owner.obol.ovm.prepareTransfer({
      ovm: d.ovm,
      newBeneficiary: randomAddress(),
      newOwner: randomAddress(),
    });
    expect(codes(transfer.checks)).toEqual([]);
  });

  test('grantRoles: rolesOf and getRoleHolders show the granted roles', async () => {
    const roles = OVM_ROLES.WITHDRAWAL | OVM_ROLES.DEPOSIT;
    const prepared = await owner.obol.ovm.prepareGrantRoles({
      ovm: d.ovm,
      user: holder.address,
      roles,
    });
    expect(prepared.checks).toEqual([]);
    expect(prepared.preview).toEqual({
      function: 'grantRoles',
      args: [holder.address, roles],
    });
    await sendAndWait(owner.obol, prepared);
    expect(await rolesOf(holder.address)).toBe(roles);

    const consolidation = await owner.obol.ovm.prepareGrantRoles({
      ovm: d.ovm,
      user: consolidator,
      roles: OVM_ROLES.CONSOLIDATION,
    });
    expect(codes(consolidation.checks)).toEqual(['ROLE_GRANT_CONSOLIDATION']);
    await sendAndWait(owner.obol, consolidation);

    const { holders } = await owner.obol.ovm.getRoleHolders(d.ovm);
    expect(holders).toEqual([
      {
        address: owner.address,
        roles: 0n,
        roleNames: [],
        isOwner: true,
      },
      {
        address: holder.address,
        roles,
        roleNames: ['WITHDRAWAL', 'DEPOSIT'],
        isOwner: false,
      },
      {
        address: consolidator,
        roles: OVM_ROLES.CONSOLIDATION,
        roleNames: ['CONSOLIDATION'],
        isOwner: false,
      },
    ]);
  });

  test('granting DEPOSIT to the principal recipient warns ROLE_GRANT_DEPOSIT_TO_PRINCIPAL', async () => {
    const prepared = await owner.obol.ovm.prepareGrantRoles({
      ovm: d.ovm,
      user: d.principalRecipient,
      roles: OVM_ROLES.DEPOSIT,
    });
    expect(codes(prepared.checks)).toEqual(['ROLE_GRANT_DEPOSIT_TO_PRINCIPAL']);
  });

  test('the granted holder passes the SDK role checks and the OVM accepts its calls', async () => {
    const deposit = makeDeposit({ withdrawalAddress: d.ovm });
    const before = await stake();
    const [tx] = await holder.obol.deposits.prepareDeposit({
      deposits: [deposit],
      via: { ovm: d.ovm },
    });
    await sendAndWait(holder.obol, tx);
    expect(await stake()).toBe(before + parseEther('32'));
    const withdraw = await holder.obol.ovm.prepareWithdraw({
      ovm: d.ovm,
      requests: [{ pubkey: deposit.pubkey, amount: parseEther('1') }],
    });
    await sendAndWait(holder.obol, withdraw);
  });

  test('a non-owner grant is NOT_OVM_OWNER, and the OVM would revert', async () => {
    await expectCode(
      async () =>
        await holder.obol.ovm.prepareGrantRoles({
          ovm: d.ovm,
          user: holder.address,
          roles: OVM_ROLES.SET_REWARD,
        }),
      'NOT_OVM_OWNER',
    );
    await expect(
      publicClient.call({
        account: holder.address,
        to: d.ovm,
        data: encodeFunctionData({
          abi: ovmAbi,
          functionName: 'grantRoles',
          args: [holder.address, OVM_ROLES.SET_REWARD],
        }),
      }),
    ).rejects.toThrow();
  });

  test('setAmountOfPrincipalStake: the preview delta is the on-chain change', async () => {
    for (const next of [parseEther('64'), parseEther('10')]) {
      const current = await stake();
      const prepared = await owner.obol.ovm.prepareSetAmountOfPrincipalStake({
        ovm: d.ovm,
        amount: next,
      });
      expect(prepared.preview).toEqual({
        function: 'setAmountOfPrincipalStake',
        args: [next],
        current,
        next,
        delta: next - current,
      });
      await sendAndWait(owner.obol, prepared);
      expect((await stake()) - current).toBe(prepared.preview.delta);
    }
  });

  test('revoke and renounce: getRoleHolders follows rolesOf', async () => {
    const revoke = await owner.obol.ovm.prepareRevokeRoles({
      ovm: d.ovm,
      user: holder.address,
      roles: OVM_ROLES.WITHDRAWAL,
    });
    await sendAndWait(owner.obol, revoke);
    expect(await rolesOf(holder.address)).toBe(OVM_ROLES.DEPOSIT);

    await expectCode(
      async () =>
        await holder.obol.ovm.prepareRenounceRoles({
          ovm: d.ovm,
          roles: OVM_ROLES.WITHDRAWAL,
        }),
      'OVM_ROLE_MISSING',
    );
    const renounce = await holder.obol.ovm.prepareRenounceRoles({
      ovm: d.ovm,
      roles: OVM_ROLES.DEPOSIT,
    });
    await sendAndWait(holder.obol, renounce);
    expect(await rolesOf(holder.address)).toBe(0n);

    const { holders } = await owner.obol.ovm.getRoleHolders(d.ovm);
    expect(holders.map(h => h.address)).toEqual([owner.address, consolidator]);
  });

  test('transfer warns ROLES_SURVIVE_TRANSFER, and the roles indeed survive it', async () => {
    const newOwner = await signer(10);
    const newBeneficiary = randomAddress();
    const prepared = await owner.obol.ovm.prepareTransfer({
      ovm: d.ovm,
      newBeneficiary,
      newOwner: newOwner.address,
    });
    expect(codes(prepared.checks)).toEqual(['ROLES_SURVIVE_TRANSFER']);
    expect(prepared.checks[0].details).toEqual({
      holders: [
        {
          address: consolidator,
          roles: OVM_ROLES.CONSOLIDATION,
          roleNames: ['CONSOLIDATION'],
        },
      ],
    });
    await sendAndWait(owner.obol, prepared);
    const read = async (functionName: 'owner' | 'principalRecipient') =>
      await publicClient.readContract({
        address: d.ovm,
        abi: ovmAbi,
        functionName,
      });
    expect(await read('owner')).toBe(newOwner.address);
    expect(await read('principalRecipient')).toBe(newBeneficiary);
    expect(await rolesOf(consolidator)).toBe(OVM_ROLES.CONSOLIDATION);
    const { holders } = await newOwner.obol.ovm.getRoleHolders(d.ovm);
    expect(holders.map(h => [h.address, h.isOwner])).toEqual([
      [newOwner.address, true],
      [consolidator, false],
    ]);

    // The old owner is now an outsider.
    await expectCode(
      async () =>
        await owner.obol.ovm.prepareGrantRoles({
          ovm: d.ovm,
          user: owner.address,
          roles: OVM_ROLES.DEPOSIT,
        }),
      'NOT_OVM_OWNER',
    );
  });

  test('two-step handover: complete needs a pending request, then the owner changes', async () => {
    const current = await signer(10);
    const next = await signer(11);
    await expectCode(
      async () =>
        await current.obol.ovm.prepareCompleteOwnershipHandover({
          ovm: d.ovm,
          pendingOwner: next.address,
        }),
      'OWNERSHIP_HANDOVER_NOT_PENDING',
    );
    const request = await next.obol.ovm.prepareRequestOwnershipHandover({
      ovm: d.ovm,
    });
    await sendAndWait(next.obol, request);
    const complete = await current.obol.ovm.prepareCompleteOwnershipHandover({
      ovm: d.ovm,
      pendingOwner: next.address,
    });
    expect(codes(complete.checks)).toEqual(['ROLES_SURVIVE_TRANSFER']);
    await sendAndWait(current.obol, complete);
    expect(
      await publicClient.readContract({
        address: d.ovm,
        abi: ovmAbi,
        functionName: 'owner',
      }),
    ).toBe(next.address);
  });
});
