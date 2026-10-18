import { decodeFunctionData, type Address, type Hex } from 'viem';
import { ovmAbi } from '../../../src/v3/abi.js';
import {
  createOvmModule,
  expectedWithdrawalCredentials,
  OVM_ROLES,
} from '../../../src/v3/ovm/index.js';
import {
  BEACON_URL,
  caught,
  ETH,
  HOLDER,
  OTHER,
  OVM,
  ovmChain,
  OWNER,
  PRINCIPAL,
  REWARD,
  rolesLog,
  type OvmChainOptions,
} from './ovmFixture.js';

const ZERO: Address = '0x0000000000000000000000000000000000000000';
const codes = (checks: Array<{ code: string }>): string[] =>
  checks.map(c => c.code);
const ovmFor = (options: OvmChainOptions = {}) =>
  createOvmModule(ovmChain(options).context());
const call = (data: Hex) => decodeFunctionData({ abi: ovmAbi, data });

describe('ovm.expectedWithdrawalCredentials', () => {
  it('builds lowercase 0x01 / 0x02 credentials', () => {
    expect(expectedWithdrawalCredentials(OVM, '0x02')).toBe(
      `0x02${'00'.repeat(11)}${OVM.slice(2).toLowerCase()}`,
    );
    expect(expectedWithdrawalCredentials(OVM, '0x01').slice(0, 4)).toBe('0x01');
  });

  it('rejects a bad prefix or address', () => {
    expect(() => expectedWithdrawalCredentials(OVM, '0x00' as any)).toThrow(
      expect.objectContaining({ code: 'PAYLOAD_INVALID' }),
    );
    expect(() =>
      expectedWithdrawalCredentials('0x12' as Address, '0x01'),
    ).toThrow(expect.objectContaining({ code: 'PAYLOAD_INVALID' }));
  });
});

describe('ovm.prepareDistribute / previewDistribute', () => {
  it('encodes distributeFunds with the routing preview', async () => {
    const result = await ovmFor({ ovmBalance: 40n * ETH }).prepareDistribute({
      ovm: OVM,
    });
    expect(call(result.request.data).functionName).toBe('distributeFunds');
    expect(result.preview).toEqual({
      mode: 'push',
      distributable: 40n * ETH,
      principalPayout: 32n * ETH,
      rewardPayout: 8n * ETH,
      principalRecipient: PRINCIPAL,
      rewardRecipient: REWARD,
    });
    expect(result.blockNumber).toBe(2_000_000n);
  });

  it('uses distributeFundsPull in pull mode', async () => {
    const result = await ovmFor({ ovmBalance: ETH }).prepareDistribute({
      ovm: OVM,
      mode: 'pull',
    });
    expect(call(result.request.data).functionName).toBe('distributeFundsPull');
  });

  it('throws NOTHING_TO_DISTRIBUTE; the preview returns zeros', async () => {
    const ovm = ovmFor({
      ovmBalance: 2n * ETH,
      state: { fundsPendingWithdrawal: 2n * ETH },
    });
    expect((await caught(ovm.prepareDistribute({ ovm: OVM }))).code).toBe(
      'NOTHING_TO_DISTRIBUTE',
    );
    const preview = await ovm.previewDistribute({ ovm: OVM });
    expect(preview).toMatchObject({
      distributable: 0n,
      principalPayout: 0n,
      rewardPayout: 0n,
      blockNumber: 2_000_000n,
      checks: [],
    });
  });

  it('checks provenance', async () => {
    expect(
      (
        await caught(
          ovmFor({ provenance: 'notObol' }).prepareDistribute({ ovm: OVM }),
        )
      ).code,
    ).toBe('OVM_NOT_OBOL');
    const result = await ovmFor({
      provenance: 'unknown',
      ovmBalance: ETH,
    }).prepareDistribute({
      ovm: OVM,
    });
    expect(codes(result.checks)).toEqual(['PROVENANCE_UNKNOWN']);
  });

  it('rejects an unknown mode', async () => {
    expect(
      (
        await caught(
          ovmFor().prepareDistribute({ ovm: OVM, mode: 'all' as any }),
        )
      ).code,
    ).toBe('PAYLOAD_INVALID');
  });
});

describe('ovm role writes', () => {
  it('grantRoles: owner only, encodes the call', async () => {
    const ovm = ovmFor();
    const result = await ovm.prepareGrantRoles({
      ovm: OVM,
      user: HOLDER,
      roles: OVM_ROLES.WITHDRAWAL,
      from: OWNER,
    });
    expect(result.preview).toEqual({
      function: 'grantRoles',
      args: [HOLDER, 1n],
    });
    expect(call(result.request.data).args).toEqual([HOLDER, 1n]);
    expect(result.checks).toEqual([]);
    expect(
      await caught(
        ovm.prepareGrantRoles({
          ovm: OVM,
          user: HOLDER,
          roles: 1,
          from: OTHER,
        }),
      ),
    ).toMatchObject({
      code: 'NOT_OVM_OWNER',
      details: { from: OTHER, owner: OWNER },
    });
  });

  it('grantRoles: warns for CONSOLIDATION and DEPOSIT to the principal recipient', async () => {
    const result = await ovmFor().prepareGrantRoles({
      ovm: OVM,
      user: PRINCIPAL,
      roles: OVM_ROLES.CONSOLIDATION | OVM_ROLES.DEPOSIT,
      from: OWNER,
    });
    expect(codes(result.checks)).toEqual([
      'ROLE_GRANT_CONSOLIDATION',
      'ROLE_GRANT_DEPOSIT_TO_PRINCIPAL',
    ]);
    const other = await ovmFor().prepareGrantRoles({
      ovm: OVM,
      user: HOLDER,
      roles: OVM_ROLES.DEPOSIT,
      from: OWNER,
    });
    expect(other.checks).toEqual([]);
  });

  it.each([
    ['zero roles', { roles: 0n }],
    ['unknown bits', { roles: 0x40n }],
    ['the zero user', { user: ZERO }],
    ['a negative number', { roles: -1 }],
  ])('grantRoles rejects %s', async (_name, patch) => {
    const error = await caught(
      ovmFor().prepareGrantRoles({
        ovm: OVM,
        user: HOLDER,
        roles: 1n,
        from: OWNER,
        ...patch,
      } as any),
    );
    expect(error.code).toBe('PAYLOAD_INVALID');
  });

  it('revokeRoles: owner only', async () => {
    const ovm = ovmFor();
    const result = await ovm.prepareRevokeRoles({
      ovm: OVM,
      user: HOLDER,
      roles: 3n,
      from: OWNER,
    });
    expect(call(result.request.data).functionName).toBe('revokeRoles');
    expect(
      (
        await caught(
          ovm.prepareRevokeRoles({
            ovm: OVM,
            user: HOLDER,
            roles: 3n,
            from: HOLDER,
          }),
        )
      ).code,
    ).toBe('NOT_OVM_OWNER');
  });

  it('renounceRoles: the sender must hold them', async () => {
    const ovm = ovmFor({ state: { roles: { [HOLDER]: 0x03n } } });
    const result = await ovm.prepareRenounceRoles({
      ovm: OVM,
      roles: 0x02n,
      from: HOLDER,
    });
    expect(call(result.request.data).args).toEqual([2n]);
    expect(
      await caught(
        ovm.prepareRenounceRoles({ ovm: OVM, roles: 0x06n, from: HOLDER }),
      ),
    ).toMatchObject({
      code: 'OVM_ROLE_MISSING',
      details: { role: 'SET_BENEFICIARY' },
    });
  });

  it.each([
    [
      'prepareSetBeneficiary',
      { newBeneficiary: OTHER },
      'SET_BENEFICIARY',
      0x04n,
    ],
    [
      'prepareSetRewardRecipient',
      { newRewardRecipient: OTHER },
      'SET_REWARD',
      0x10n,
    ],
    [
      'prepareRecoverFunds',
      { token: OTHER, recipient: HOLDER },
      'RECOVER_FUNDS',
      0x08n,
    ],
    [
      'prepareSetAmountOfPrincipalStake',
      { amount: ETH },
      'SET_BENEFICIARY',
      0x04n,
    ],
  ] as const)(
    '%s: owner or the role holder',
    async (method, extra, role, bit) => {
      const fn = (o: ReturnType<typeof ovmFor>) =>
        o[method] as (i: any) => Promise<any>;
      const plain = ovmFor();
      await expect(
        fn(plain)({ ovm: OVM, ...extra, from: OWNER }),
      ).resolves.toBeDefined();
      expect(
        await caught(fn(plain)({ ovm: OVM, ...extra, from: HOLDER })),
      ).toMatchObject({ code: 'OVM_ROLE_MISSING', details: { role } });
      const holder = ovmFor({ state: { roles: { [HOLDER]: bit } } });
      await expect(
        fn(holder)({ ovm: OVM, ...extra, from: HOLDER }),
      ).resolves.toBeDefined();
    },
  );

  it.each([
    ['prepareSetBeneficiary', { newBeneficiary: ZERO }],
    ['prepareSetRewardRecipient', { newRewardRecipient: ZERO }],
    ['prepareRecoverFunds', { token: OTHER, recipient: ZERO }],
    ['prepareTransfer', { newBeneficiary: OTHER, newOwner: ZERO }],
    ['prepareCompleteOwnershipHandover', { pendingOwner: ZERO }],
    ['prepareWithdrawPullBalance', { account: ZERO }],
  ] as const)('%s rejects the zero address', async (method, extra) => {
    const ovm = ovmFor();
    const error = await caught(
      (ovm[method] as (i: any) => Promise<unknown>)({
        ovm: OVM,
        ...extra,
        from: OWNER,
      }),
    );
    expect(error.code).toBe('PAYLOAD_INVALID');
  });

  it('setAmountOfPrincipalStake previews current, next and delta', async () => {
    const result = await ovmFor().prepareSetAmountOfPrincipalStake({
      ovm: OVM,
      amount: 0n,
      from: OWNER,
    });
    expect(result.preview).toEqual({
      function: 'setAmountOfPrincipalStake',
      args: [0n],
      current: 32n * ETH,
      next: 0n,
      delta: -32n * ETH,
    });
  });

  it('writes check provenance and need a sender', async () => {
    expect(
      (
        await caught(
          ovmFor({ provenance: 'notObol' }).prepareSetBeneficiary({
            ovm: OVM,
            newBeneficiary: OTHER,
            from: OWNER,
          }),
        )
      ).code,
    ).toBe('OVM_NOT_OBOL');
    expect(
      (
        await caught(
          ovmFor().prepareSetBeneficiary({ ovm: OVM, newBeneficiary: OTHER }),
        )
      ).code,
    ).toBe('PAYLOAD_INVALID');
  });

  it('throws OVM_READ_FAILED when the OVM does not answer', async () => {
    expect(
      (
        await caught(
          ovmFor({ state: { failing: ['owner'] } }).prepareSetBeneficiary({
            ovm: OVM,
            newBeneficiary: OTHER,
            from: OWNER,
          }),
        )
      ).code,
    ).toBe('OVM_READ_FAILED');
  });
});

describe('ovm ownership writes', () => {
  it('request and cancel the handover: anyone, no reads beyond provenance', async () => {
    const ovm = ovmFor();
    const request = await ovm.prepareRequestOwnershipHandover({ ovm: OVM });
    expect(call(request.request.data).functionName).toBe(
      'requestOwnershipHandover',
    );
    expect(request.blockNumber).toBeUndefined();
    const cancel = await ovm.prepareCancelOwnershipHandover({ ovm: OVM });
    expect(call(cancel.request.data).functionName).toBe(
      'cancelOwnershipHandover',
    );
  });

  it('transfer: owner only; warns ROLES_SURVIVE_TRANSFER with the holders', async () => {
    const options = {
      logs: [rolesLog(OVM, HOLDER, 0x01n, 1_900_000n)],
      state: { roles: { [HOLDER]: 0x01n } },
    };
    const result = await ovmFor(options).prepareTransfer({
      ovm: OVM,
      newBeneficiary: PRINCIPAL,
      newOwner: OTHER,
      from: OWNER,
    });
    expect(call(result.request.data).args).toEqual([PRINCIPAL, OTHER]);
    expect(result.checks).toEqual([
      expect.objectContaining({
        code: 'ROLES_SURVIVE_TRANSFER',
        details: {
          holders: [{ address: HOLDER, roles: 1n, roleNames: ['WITHDRAWAL'] }],
        },
      }),
    ]);
    expect(
      (
        await caught(
          ovmFor(options).prepareTransfer({
            ovm: OVM,
            newBeneficiary: PRINCIPAL,
            newOwner: OTHER,
            from: HOLDER,
          }),
        )
      ).code,
    ).toBe('NOT_OVM_OWNER');
  });

  it('transfer: no finding without other holders; ROLE_HOLDERS_UNCHECKED when unreadable', async () => {
    const clean = await ovmFor().prepareTransfer({
      ovm: OVM,
      newBeneficiary: PRINCIPAL,
      newOwner: OTHER,
      from: OWNER,
    });
    expect(clean.checks).toEqual([]);
    const unreadable = await ovmFor({
      getLogsError: filter =>
        filter.address.toLowerCase() === OVM.toLowerCase()
          ? new Error('no logs')
          : undefined,
    }).prepareTransfer({
      ovm: OVM,
      newBeneficiary: PRINCIPAL,
      newOwner: OTHER,
      from: OWNER,
    });
    expect(unreadable.checks).toEqual([
      expect.objectContaining({
        code: 'ROLE_HOLDERS_UNCHECKED',
        severity: 'info',
      }),
    ]);
  });

  it('completeOwnershipHandover: needs an unexpired request', async () => {
    const now = 1_700_000_000n;
    const pending = ovmFor({
      blockTimestamp: now,
      state: { handoverExpiresAt: { [OTHER]: now + 3600n } },
    });
    const result = await pending.prepareCompleteOwnershipHandover({
      ovm: OVM,
      pendingOwner: OTHER,
      from: OWNER,
    });
    expect(call(result.request.data).args).toEqual([OTHER]);
    expect(result.checks).toEqual([]);

    const expired = ovmFor({
      blockTimestamp: now,
      state: { handoverExpiresAt: { [OTHER]: now } },
    });
    expect(
      (
        await caught(
          expired.prepareCompleteOwnershipHandover({
            ovm: OVM,
            pendingOwner: OTHER,
            from: OWNER,
          }),
        )
      ).code,
    ).toBe('OWNERSHIP_HANDOVER_NOT_PENDING');
    expect(
      (
        await caught(
          pending.prepareCompleteOwnershipHandover({
            ovm: OVM,
            pendingOwner: OTHER,
            from: OTHER,
          }),
        )
      ).code,
    ).toBe('NOT_OVM_OWNER');
  });

  it('completeOwnershipHandover: warns ROLES_SURVIVE_TRANSFER', async () => {
    const now = 1_700_000_000n;
    const result = await ovmFor({
      blockTimestamp: now,
      logs: [rolesLog(OVM, HOLDER, 0x20n, 1_900_000n)],
      state: {
        roles: { [HOLDER]: 0x20n },
        handoverExpiresAt: { [OTHER]: now + 1n },
      },
    }).prepareCompleteOwnershipHandover({
      ovm: OVM,
      pendingOwner: OTHER,
      from: OWNER,
    });
    expect(codes(result.checks)).toEqual(['ROLES_SURVIVE_TRANSFER']);
  });
});

describe('ovm sweep and pull balances', () => {
  const pull = { [PRINCIPAL]: 5n * ETH, [REWARD]: ETH };

  it('sweep: anyone to the principal recipient, up to its pull balance', async () => {
    const ovm = ovmFor({ state: { pull } });
    const all = await ovm.prepareSweep({ ovm: OVM });
    expect(call(all.request.data).args).toEqual([ZERO, 0n]);
    const some = await ovm.prepareSweep({ ovm: OVM, amount: 5n * ETH });
    expect(call(some.request.data).args).toEqual([ZERO, 5n * ETH]);
    const error = await caught(
      ovm.prepareSweep({ ovm: OVM, amount: 5n * ETH + 1n }),
    );
    expect(error.code).toBe('PAYLOAD_INVALID');
    expect(error.details.issues[0].issue).toBe('above_pull_balance');
  });

  it('sweep: a beneficiary needs the owner', async () => {
    const ovm = ovmFor({ state: { pull } });
    const ok = await ovm.prepareSweep({
      ovm: OVM,
      beneficiary: OTHER,
      from: OWNER,
    });
    expect(call(ok.request.data).args).toEqual([OTHER, 0n]);
    expect(
      (
        await caught(
          ovm.prepareSweep({ ovm: OVM, beneficiary: OTHER, from: HOLDER }),
        )
      ).code,
    ).toBe('NOT_OVM_OWNER');
  });

  it('withdrawPullBalance: previews the amount; NOTHING_TO_DISTRIBUTE at 0', async () => {
    const ovm = ovmFor({ state: { pull } });
    const result = await ovm.prepareWithdrawPullBalance({
      ovm: OVM,
      account: REWARD,
    });
    expect(result.preview).toEqual({
      function: 'withdrawPullBalance',
      args: [REWARD],
      amount: ETH,
    });
    expect(
      (
        await caught(
          ovm.prepareWithdrawPullBalance({ ovm: OVM, account: OTHER }),
        )
      ).code,
    ).toBe('NOTHING_TO_DISTRIBUTE');
  });
});

describe('createOvmModule', () => {
  it('binds the reads and exposes the pure helpers', async () => {
    const ovm = ovmFor({ ovmBalance: ETH });
    expect((await ovm.verify(OVM)).status).toBe('obol');
    expect((await ovm.getState(OVM)).balance).toBe(ETH);
    expect((await ovm.getRoleHolders(OVM)).owner).toBe(OWNER);
    expect(ovm.OVM_ROLES.DEPOSIT).toBe(0x20n);
    expect(ovm.roleNames(0x21n)).toEqual(['WITHDRAWAL', 'DEPOSIT']);
    expect((await caught(ovm.getValidators(OVM))).code).toBe('API_DISABLED');
    expect(BEACON_URL).toMatch(/^http/);
  });
});
