import { readFileSync } from 'node:fs';
import { decodeFunctionData, type Hex } from 'viem';
import { multicall3Abi } from '../../src/abi.js';
import {
  getOvmRoleHolders,
  getOvmState,
  getOvmValidators,
} from '../../src/ovm/state.js';
import { ovmRouting } from '../../src/ovm/routing.js';
import { fakeApi, MULTICALL3 } from '../helpers/fakeChain.js';
import {
  caught,
  credentials,
  ETH,
  HOLDER,
  OTHER,
  OVM,
  ovmChain,
  OWNER,
  PRINCIPAL,
  PUBKEY_A,
  REWARD,
  rolesLog,
} from './ovmFixture.js';

const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

const routing = JSON.parse(
  readFileSync('spec/vectors/distribution.json', 'utf8'),
).routing as any[];

describe('ovm.getState', () => {
  it('reads the getters, balances and routing in one aggregate3', async () => {
    const chain = ovmChain({
      ovmBalance: 40n * ETH,
      state: { pull: { [PRINCIPAL]: 3n, [REWARD]: 4n } },
    });
    const state = await getOvmState(chain.context(), OVM.toLowerCase() as Hex);
    expect(state).toMatchObject({
      address: OVM,
      owner: OWNER,
      principalRecipient: PRINCIPAL,
      rewardRecipient: REWARD,
      amountOfPrincipalStake: 32n * ETH,
      principalThreshold: 16n * ETH,
      version: '1.0.0',
      balance: 40n * ETH,
      pullBalances: { principalRecipient: 3n, rewardRecipient: 4n },
      distributable: 40n * ETH,
      principalPayout: 32n * ETH,
      rewardPayout: 8n * ETH,
      blockNumber: 2_000_000n,
      findings: [],
      source: 'chain',
    });
    expect(state.principalOnBeaconChain).toBeUndefined();
    const calls = chain.requests.filter(r => r.method === 'eth_call');
    expect(calls).toHaveLength(2);
    const first = decodeFunctionData({
      abi: multicall3Abi,
      data: calls[0].params[0].data,
    });
    expect(first.functionName).toBe('aggregate3');
    expect(calls[0].params[0].to.toLowerCase()).toBe(MULTICALL3.toLowerCase());
  });

  it('returns null for a missing version', async () => {
    const chain = ovmChain({ state: { version: null } });
    expect((await getOvmState(chain.context(), OVM)).version).toBeNull();
  });

  it('throws OVM_READ_FAILED when a getter fails', async () => {
    const chain = ovmChain({ state: { failing: ['principalThreshold'] } });
    expect(await caught(getOvmState(chain.context(), OVM))).toMatchObject({
      code: 'OVM_READ_FAILED',
    });
  });

  it('throws UNSUPPORTED_CHAIN off mainnet / Hoodi', async () => {
    const chain = ovmChain();
    const ctx = {
      ...chain.context(),
      chain: { ...chain.context().chain, id: 100 },
    };
    expect(await caught(getOvmState(ctx, OVM))).toMatchObject({
      code: 'UNSUPPORTED_CHAIN',
    });
  });

  it('rejects a malformed address', async () => {
    const chain = ovmChain();
    expect(
      await caught(getOvmState(chain.context(), '0x12' as Hex)),
    ).toMatchObject({
      code: 'PAYLOAD_INVALID',
    });
  });

  it('flags a public forwarder that holds a role or owns the OVM', async () => {
    const chain = ovmChain({
      state: { roles: { [MULTICALL3_ADDRESS]: 0x11n } },
    });
    const state = await getOvmState(chain.context(), OVM);
    expect(state.findings).toEqual([
      expect.objectContaining({
        code: 'PUBLIC_FORWARDER_HOLDS_ROLE',
        severity: 'warning',
        details: {
          holders: [
            {
              address: MULTICALL3_ADDRESS,
              name: 'Multicall3',
              roles: 0x11n,
              roleNames: ['WITHDRAWAL', 'SET_REWARD'],
              isOwner: false,
            },
          ],
        },
      }),
    ]);
    // Still two eth_calls: the forwarder's rolesOf rides with the pull balances.
    expect(chain.requests.filter(r => r.method === 'eth_call')).toHaveLength(2);

    const owned = await getOvmState(
      ovmChain({ state: { owner: MULTICALL3_ADDRESS } }).context(),
      OVM,
    );
    expect(owned.findings).toEqual([
      expect.objectContaining({
        code: 'PUBLIC_FORWARDER_HOLDS_ROLE',
        details: {
          holders: [expect.objectContaining({ isOwner: true, roles: 0n })],
        },
      }),
    ]);
  });

  describe('principalOnBeaconChain', () => {
    const withApi = (principalOnBeaconChain: string) => {
      const chain = ovmChain();
      const api = fakeApi({
        [`/v1/ovm/hoodi/${OVM}`]: () => ({
          address: OVM,
          principalOnBeaconChain,
        }),
      });
      return chain.context(api);
    };

    it('is reported without a finding within 1 ETH', async () => {
      const state = await getOvmState(withApi((33n * ETH).toString()), OVM);
      expect(state.principalOnBeaconChain).toBe(33n * ETH);
      expect(state.source).toBe('api');
      expect(state.findings).toEqual([]);
    });

    it('adds PRINCIPAL_STAKE_MISMATCH beyond 1 ETH', async () => {
      const state = await getOvmState(withApi((30n * ETH).toString()), OVM);
      expect(state.findings).toEqual([
        expect.objectContaining({
          code: 'PRINCIPAL_STAKE_MISMATCH',
          severity: 'warning',
          details: {
            amountOfPrincipalStake: 32n * ETH,
            principalOnBeaconChain: 30n * ETH,
          },
        }),
      ]);
    });

    it('is absent when the API fails', async () => {
      const chain = ovmChain();
      const api = fakeApi({});
      const state = await getOvmState(chain.context(api), OVM);
      expect(state.principalOnBeaconChain).toBeUndefined();
      expect(state.source).toBe('chain');
    });
  });

  describe('routing vectors (distribution.json routing)', () => {
    it.each(routing.map(c => [c.name, c]))('%s', async (_name, c: any) => {
      const chain = ovmChain({
        ovmBalance: BigInt(c.input.balance),
        state: {
          fundsPendingWithdrawal: BigInt(c.input.fundsPendingWithdrawal),
          amountOfPrincipalStake: BigInt(c.input.amountOfPrincipalStake),
          principalThresholdGwei: BigInt(c.input.principalThresholdGwei),
        },
      });
      const state = await getOvmState(chain.context(), OVM);
      expect(state.distributable.toString()).toBe(c.distributable);
      expect(state.principalPayout.toString()).toBe(c.principalPayout);
      expect(state.rewardPayout.toString()).toBe(c.rewardPayout);
      const pure = ovmRouting({
        balance: BigInt(c.input.balance),
        fundsPendingWithdrawal: BigInt(c.input.fundsPendingWithdrawal),
        amountOfPrincipalStake: BigInt(c.input.amountOfPrincipalStake),
        principalThreshold: BigInt(c.input.principalThresholdGwei) * 10n ** 9n,
      });
      expect(pure.rewardPayout.toString()).toBe(c.rewardPayout);
    });
  });
});

describe('ovm.getRoleHolders', () => {
  const logs = [
    rolesLog(OVM, HOLDER, 0x01n, 1_800_000n),
    rolesLog(OVM, OTHER, 0x20n, 1_900_000n),
    rolesLog(OVM, OWNER, 0x02n, 1_900_001n),
  ];

  it('scans the chain and reads roles with rolesOf', async () => {
    const chain = ovmChain({
      logs,
      state: { roles: { [HOLDER]: 0x21n, [OWNER]: 0x02n } }, // OTHER revoked: 0
    });
    const result = await getOvmRoleHolders(chain.context(), OVM);
    expect(result.source).toBe('chain');
    expect(result.owner).toBe(OWNER);
    expect(result.blockNumber).toBe(2_000_000n);
    expect(result.holders).toEqual([
      {
        address: OWNER,
        roles: 0x02n,
        roleNames: ['CONSOLIDATION'],
        isOwner: true,
      },
      {
        address: HOLDER,
        roles: 0x21n,
        roleNames: ['WITHDRAWAL', 'DEPOSIT'],
        isOwner: false,
      },
    ]);
  });

  it('lists the owner first with 0 roles when it has none', async () => {
    const chain = ovmChain();
    const result = await getOvmRoleHolders(chain.context(), OVM);
    expect(result.holders).toEqual([
      { address: OWNER, roles: 0n, roleNames: [], isOwner: true },
    ]);
  });

  it('uses the API log index plus a recent RPC scan', async () => {
    const chain = ovmChain({
      logs: [rolesLog(OVM, OTHER, 0x20n, 1_990_000n)],
      state: { roles: { [HOLDER]: 0x01n, [OTHER]: 0x20n } },
      // Only the recent range is served: a full scan would fail.
      getLogsError: filter =>
        BigInt(filter.fromBlock) < 1_950_000n &&
        filter.address.toLowerCase() === OVM.toLowerCase()
          ? new Error('range too wide')
          : undefined,
    });
    const api = fakeApi({
      [`/v1/eth/logs/hoodi?address=${OVM}&topic0=${logs[0].topics[0]}&fromBlock=1735335`]:
        () => ({ status: '1', logs: [logs[0]] }),
    });
    const result = await getOvmRoleHolders(chain.context(api), OVM);
    expect(result.source).toBe('api');
    expect(result.holders.map(h => h.address)).toEqual([OWNER, HOLDER, OTHER]);
  });

  it('falls back to the full scan for a truncated API answer', async () => {
    const chain = ovmChain({ logs, state: { roles: { [HOLDER]: 1n } } });
    const api = fakeApi({
      [`/v1/eth/logs/hoodi?address=${OVM}&topic0=${logs[0].topics[0]}&fromBlock=1735335`]:
        () => ({ status: '1', logs: [], truncated: true }),
    });
    const result = await getOvmRoleHolders(chain.context(api), OVM);
    expect(result.source).toBe('chain');
    expect(result.holders.map(h => h.address)).toEqual([OWNER, HOLDER]);
  });

  it('uses the API OVM record roles as candidates, re-read with rolesOf', async () => {
    const chain = ovmChain({
      state: { roles: { [HOLDER]: 0x04n, [OTHER]: 0n } },
      getLogsError: filter =>
        BigInt(filter.fromBlock) < 1_950_000n &&
        filter.address.toLowerCase() === OVM.toLowerCase()
          ? new Error('range too wide')
          : undefined,
    });
    const api = fakeApi({
      [`/v1/ovm/hoodi/${OVM}`]: () => ({
        address: OVM,
        network: 'hoodi',
        blockNumber: 1_999_990,
        roles: [
          { address: OWNER, roles: 0, roleNames: [], isOwner: true },
          // The API's roles are stale: OTHER was revoked since.
          {
            address: OTHER,
            roles: 1,
            roleNames: ['WITHDRAWAL'],
            isOwner: false,
          },
          {
            address: HOLDER.toLowerCase(),
            roles: 4,
            roleNames: ['SET_BENEFICIARY'],
            isOwner: false,
          },
        ],
      }),
    });
    const result = await getOvmRoleHolders(chain.context(api), OVM);
    expect(result.source).toBe('api');
    expect(result.holders).toEqual([
      { address: OWNER, roles: 0n, roleNames: [], isOwner: true },
      {
        address: HOLDER,
        roles: 0x04n,
        roleNames: ['SET_BENEFICIARY'],
        isOwner: false,
      },
    ]);
    expect(result.findings).toEqual([]);
    // The interim log index was not asked.
    expect(api.calls.map(c => c.endpoint)).toEqual([`/v1/ovm/hoodi/${OVM}`]);
  });

  it('falls back to the interim log index when the OVM record has no roles', async () => {
    const chain = ovmChain({ logs, state: { roles: { [HOLDER]: 1n } } });
    const api = fakeApi({
      [`/v1/ovm/hoodi/${OVM}`]: () => ({ address: OVM, roles: null }),
      [`/v1/eth/logs/hoodi?address=${OVM}&topic0=${logs[0].topics[0]}&fromBlock=1735335`]:
        () => ({ status: '1', logs: [logs[0]] }),
    });
    const result = await getOvmRoleHolders(chain.context(api), OVM);
    expect(result.source).toBe('api');
    expect(result.holders.map(h => h.address)).toEqual([OWNER, HOLDER]);
  });

  it('always checks the public forwarders and flags one with roles', async () => {
    // No RolesUpdated event names Multicall3, yet it holds DEPOSIT.
    const chain = ovmChain({
      state: { roles: { [MULTICALL3_ADDRESS]: 0x20n } },
    });
    const result = await getOvmRoleHolders(chain.context(), OVM);
    expect(result.holders.map(h => h.address)).toEqual([
      OWNER,
      MULTICALL3_ADDRESS,
    ]);
    expect(result.findings).toEqual([
      expect.objectContaining({
        code: 'PUBLIC_FORWARDER_HOLDS_ROLE',
        severity: 'warning',
        details: {
          holders: [
            {
              address: MULTICALL3_ADDRESS,
              name: 'Multicall3',
              roles: 0x20n,
              roleNames: ['DEPOSIT'],
              isOwner: false,
            },
          ],
        },
      }),
    ]);
  });

  it('throws OVM_ROLE_EVENTS_UNAVAILABLE when the scan fails', async () => {
    const chain = ovmChain({
      getLogsError: filter =>
        filter.address.toLowerCase() === OVM.toLowerCase()
          ? new Error('nope')
          : undefined,
    });
    expect(await caught(getOvmRoleHolders(chain.context(), OVM))).toMatchObject(
      {
        code: 'OVM_ROLE_EVENTS_UNAVAILABLE',
      },
    );
  });

  it('throws OVM_READ_FAILED when owner() fails', async () => {
    const chain = ovmChain({ state: { failing: ['owner'] } });
    expect(await caught(getOvmRoleHolders(chain.context(), OVM))).toMatchObject(
      {
        code: 'OVM_READ_FAILED',
      },
    );
  });
});

describe('ovm.getValidators', () => {
  const validator = {
    pubkey: PUBKEY_A.toUpperCase().replace('0X', '0x'),
    lockHash: `0x${'aa'.repeat(32)}`,
    beaconStatus: 'active_ongoing',
    balance: (32n * ETH).toString(),
    withdrawalCredentials: credentials('02', OVM),
  };

  it('needs the API', async () => {
    expect(
      await caught(getOvmValidators(ovmChain().context(), OVM)),
    ).toMatchObject({
      code: 'API_DISABLED',
    });
  });

  it('parses the OVM endpoint', async () => {
    const api = fakeApi({
      [`/v1/ovm/hoodi/${OVM}`]: () => ({
        address: OVM,
        blockNumber: 123,
        validators: [
          validator,
          {
            ...validator,
            beaconStatus: undefined,
            status: 'queued',
            lockHash: null,
            balance: null,
          },
        ],
      }),
    });
    const result = await getOvmValidators(ovmChain().context(api), OVM);
    expect(result.blockNumber).toBe(123n);
    expect(result.validators[0]).toEqual({
      pubkey: PUBKEY_A,
      lockHash: validator.lockHash,
      status: 'active',
      beaconStatus: 'active_ongoing',
      balance: 32n * ETH,
      withdrawalCredentials: validator.withdrawalCredentials,
    });
    expect(result.validators[1]).toEqual({
      pubkey: PUBKEY_A,
      status: 'queued',
      withdrawalCredentials: validator.withdrawalCredentials,
    });
  });

  it("parses a 'new' validator with beaconStatus null", async () => {
    const api = fakeApi({
      [`/v1/ovm/hoodi/${OVM}`]: () => ({
        address: OVM,
        network: 'hoodi',
        blockNumber: '123',
        validators: [
          {
            pubkey: PUBKEY_A,
            index: null,
            status: 'new',
            beaconStatus: null,
            balance: null,
            effectiveBalance: null,
            withdrawalCredentials: credentials('02', OVM),
            lockHash: `0x${'bb'.repeat(32)}`,
          },
        ],
      }),
    });
    const result = await getOvmValidators(ovmChain().context(api), OVM);
    expect(result).toEqual({
      blockNumber: 123n,
      validators: [
        {
          pubkey: PUBKEY_A,
          lockHash: `0x${'bb'.repeat(32)}`,
          status: 'new',
          withdrawalCredentials: credentials('02', OVM),
        },
      ],
    });
  });

  it('throws API_RESPONSE_MISMATCH for another network', async () => {
    const api = fakeApi({
      [`/v1/ovm/hoodi/${OVM}`]: () => ({
        address: OVM,
        network: 'mainnet',
        validators: [],
      }),
    });
    expect(
      await caught(getOvmValidators(ovmChain().context(api), OVM)),
    ).toMatchObject({ code: 'API_RESPONSE_MISMATCH' });
  });

  it('throws STATUS_UNAVAILABLE for a malformed validator', async () => {
    const api = fakeApi({
      [`/v1/ovm/hoodi/${OVM}`]: () => ({
        validators: [{ ...validator, beaconStatus: 'sleeping' }],
      }),
    });
    expect(
      await caught(getOvmValidators(ovmChain().context(api), OVM)),
    ).toMatchObject({
      code: 'STATUS_UNAVAILABLE',
    });
  });

  it('throws API_RESPONSE_MISMATCH for another address', async () => {
    const api = fakeApi({
      [`/v1/ovm/hoodi/${OVM}`]: () => ({ address: OTHER, validators: [] }),
    });
    expect(
      await caught(getOvmValidators(ovmChain().context(api), OVM)),
    ).toMatchObject({
      code: 'API_RESPONSE_MISMATCH',
    });
  });
});
