/**
 * send refuses a prepared transaction that carries warnings the caller did
 * not acknowledge by code (rc.12). One gate for every prepare* path.
 */
import { readFileSync } from 'node:fs';
import type { Address, Hex } from 'viem';
import { FINDING_CODES, type FindingCode } from '../../src/codes.js';
import { prepareDeposit } from '../../src/deposits/prepareDeposit.js';
import { isObolError } from '../../src/errors.js';
import { prepareGrantRoles } from '../../src/ovm/roles.js';
import { prepareConsolidate, prepareWithdraw } from '../../src/ovm/withdraw.js';
import { findingsToAcknowledge, send } from '../../src/send.js';
import {
  PREPARED_KINDS,
  type AnyPrepared,
  type Deposit,
  type Finding,
} from '../../src/types.js';
import {
  BEACON_URL,
  credentials,
  ETH,
  mockBeacon,
  OTHER,
  OVM,
  ovmChain,
  OWNER,
  PUBKEY_A,
  PUBKEY_B,
  PUBKEY_C,
  registryRow,
} from '../ovm/ovmFixture.js';
import { fakeChain } from '../helpers/fakeChain.js';
import { CHAINS } from '../../src/chains.js';

const ACCOUNT = '0x2222222222222222222222222222222222222222' as Address;

const warning = (code: FindingCode, message = `${code} happened`): Finding => ({
  code,
  severity: 'warning',
  message,
});
const info = (code: FindingCode): Finding => ({
  code,
  severity: 'info',
  message: 'fyi',
});

const preparedWith = (checks: Finding[], kind: string = 'role'): AnyPrepared =>
  ({
    kind,
    request: { to: ACCOUNT, data: '0x' as Hex, value: 1n, chainId: 560048 },
    checks,
    preview: { function: 'noop', args: [] },
  }) as unknown as AnyPrepared;

const rejected = async (promise: Promise<unknown>): Promise<any> =>
  await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e,
  );

describe('send: warnings must be acknowledged by code', () => {
  const wallet = () => fakeChain({ walletAccount: ACCOUNT });

  it('sends a transaction without warnings as before (no options needed)', async () => {
    const chain = wallet();
    await send(chain.context(), preparedWith([]));
    await send(
      chain.context(),
      preparedWith([info('SPLIT_REUSED'), info('DEPOSIT_ALREADY_QUEUED')]),
    );
    expect(chain.sent).toHaveLength(2);
  });

  it('refuses an unacknowledged warning before the wallet is asked for anything', async () => {
    const chain = wallet();
    const prepared = preparedWith([
      warning('PROVENANCE_UNKNOWN', 'could not check the factory'),
      info('SPLIT_REUSED'),
      warning('ROLE_GRANT_CONSOLIDATION'),
      warning('PROVENANCE_UNKNOWN', 'again'),
    ]);
    const error = await rejected(send(chain.context(), prepared));
    expect(isObolError(error, 'FINDINGS_NOT_ACKNOWLEDGED')).toBe(true);
    expect(error.details.codes).toEqual([
      'PROVENANCE_UNKNOWN',
      'ROLE_GRANT_CONSOLIDATION',
    ]);
    expect(error.details.findings).toHaveLength(3);
    // The message names each warning; the hint gives the exact call.
    expect(error.message).toContain('PROVENANCE_UNKNOWN');
    expect(error.message).toContain('could not check the factory');
    expect(error.hint).toContain(
      "send(prepared, { acknowledge: ['PROVENANCE_UNKNOWN', 'ROLE_GRANT_CONSOLIDATION'] })",
    );
    expect(chain.sent).toHaveLength(0);
    expect(chain.requests.map(r => r.method)).not.toContain(
      'eth_sendTransaction',
    );
  });

  it('a wallet is not even required to learn what must be acknowledged', async () => {
    const error = await rejected(
      send(
        fakeChain().context(),
        preparedWith([warning('PROVENANCE_UNKNOWN')]),
      ),
    );
    expect(error.code).toBe('FINDINGS_NOT_ACKNOWLEDGED');
  });

  it('acknowledging some codes is not acknowledging the others', async () => {
    const chain = wallet();
    const prepared = preparedWith([
      warning('PROVENANCE_UNKNOWN'),
      warning('ROLE_GRANT_CONSOLIDATION'),
    ]);
    const error = await rejected(
      send(chain.context(), prepared, { acknowledge: ['PROVENANCE_UNKNOWN'] }),
    );
    expect(error.details.codes).toEqual(['ROLE_GRANT_CONSOLIDATION']);
    // The hint lists the full set to pass, the ones already given included.
    expect(error.hint).toContain(
      "acknowledge: ['PROVENANCE_UNKNOWN', 'ROLE_GRANT_CONSOLIDATION']",
    );
    expect(chain.sent).toHaveLength(0);
  });

  it('sends once every warning code is acknowledged; unused codes are ignored', async () => {
    const chain = wallet();
    await send(
      chain.context(),
      preparedWith([
        warning('PROVENANCE_UNKNOWN'),
        warning('ROLE_GRANT_CONSOLIDATION'),
      ]),
      {
        acknowledge: [
          'ROLE_GRANT_CONSOLIDATION',
          'PROVENANCE_UNKNOWN',
          'SPLIT_REUSED',
        ],
      },
    );
    expect(chain.sent).toHaveLength(1);
  });

  it.each([
    ['true', true],
    ['"all"', 'all'],
    ['a single code string', 'PROVENANCE_UNKNOWN'],
    ['an object', { PROVENANCE_UNKNOWN: true }],
  ])(
    'has no blanket acknowledgement: %s is PAYLOAD_INVALID',
    async (_n, value) => {
      const chain = wallet();
      const error = await rejected(
        send(chain.context(), preparedWith([warning('PROVENANCE_UNKNOWN')]), {
          acknowledge: value as never,
        }),
      );
      expect(error.code).toBe('PAYLOAD_INVALID');
      expect(chain.sent).toHaveLength(0);
    },
  );

  it('a misspelt or unknown code is PAYLOAD_INVALID, not a silent no-op', async () => {
    const error = await rejected(
      send(wallet().context(), preparedWith([]), {
        acknowledge: ['PROVENANCE_UNKNOWN', 'PROVENANCE_UNKOWN' as never],
      }),
    );
    expect(error.code).toBe('PAYLOAD_INVALID');
    expect(error.details.issues[0]).toMatchObject({
      path: 'options.acknowledge[1]',
      issue: 'unknown_finding_code',
    });
    // Error codes are not finding codes.
    expect(
      (
        await rejected(
          send(wallet().context(), preparedWith([]), {
            acknowledge: ['DEPOSIT_CONFLICT' as never],
          }),
        )
      ).code,
    ).toBe('PAYLOAD_INVALID');
  });

  it.each([
    ['acknowledgeAll', { acknowledgeAll: true }],
    ['acknowledged', { acknowledged: ['PROVENANCE_UNKNOWN'] }],
    ['force', { force: true }],
  ])('an unknown option key (%s) is PAYLOAD_INVALID', async (_n, options) => {
    const error = await rejected(
      send(
        wallet().context(),
        preparedWith([warning('PROVENANCE_UNKNOWN')]),
        options as never,
      ),
    );
    expect(error.code).toBe('PAYLOAD_INVALID');
    expect(error.details.issues[0].issue).toBe('unknown_key');
    expect(error.details.issues[0].message).toContain(
      'allowed keys: acknowledge, simulation',
    );
  });

  it('a prepared value without its checks is PREPARED_INVALID (they cannot be stripped by omission)', async () => {
    const { checks: _checks, ...stripped } = preparedWith([
      warning('PROVENANCE_UNKNOWN'),
    ]);
    expect(
      (await rejected(send(wallet().context(), stripped as never))).code,
    ).toBe('PREPARED_INVALID');
  });

  it.each(PREPARED_KINDS.map(kind => [kind]))(
    'applies to every prepared kind: %s',
    async kind => {
      const chain = wallet();
      const prepared = preparedWith([warning('PROVENANCE_UNKNOWN')], kind);
      expect((await rejected(send(chain.context(), prepared))).code).toBe(
        'FINDINGS_NOT_ACKNOWLEDGED',
      );
      await send(chain.context(), prepared, {
        acknowledge: ['PROVENANCE_UNKNOWN'],
      });
      expect(chain.sent).toHaveLength(1);
    },
  );

  it('every finding code can be acknowledged', () => {
    for (const code of FINDING_CODES) {
      expect(
        findingsToAcknowledge(preparedWith([warning(code)]), {
          acknowledge: [code],
        }),
      ).toEqual([]);
    }
  });

  describe('with a simulation', () => {
    const prepared = preparedWith([]);
    const simulation = (findings: Finding[], request = prepared.request) => ({
      request,
      findings,
    });

    it('refuses the warnings of the simulation as well', async () => {
      const chain = wallet();
      for (const code of [
        'SIMULATION_REVERTED',
        'SIMULATION_PREVIEW_MISMATCH',
        'SIMULATION_READS_INCOMPLETE',
        'SIMULATION_UNAVAILABLE',
        'SIMULATION_UNTRUSTED_EVENT',
      ] as const) {
        const error = await rejected(
          send(chain.context(), prepared, {
            simulation: simulation([warning(code)]),
          }),
        );
        expect(error.code).toBe('FINDINGS_NOT_ACKNOWLEDGED');
        expect(error.details.codes).toEqual([code]);
      }
      expect(chain.sent).toHaveLength(0);
      await send(chain.context(), prepared, {
        simulation: simulation([warning('SIMULATION_UNAVAILABLE')]),
        acknowledge: ['SIMULATION_UNAVAILABLE'],
      });
      await send(chain.context(), prepared, {
        simulation: simulation([info('SIMULATION_CONTRACT_WALLET')]),
      });
      expect(chain.sent).toHaveLength(2);
    });

    it('refuses a simulation of another request', async () => {
      const chain = wallet();
      for (const other of [
        { ...prepared.request, data: '0x01' as Hex },
        { ...prepared.request, value: 2n },
        { ...prepared.request, to: OTHER },
        { ...prepared.request, chainId: 1 },
      ]) {
        const error = await rejected(
          send(chain.context(), prepared, {
            simulation: simulation([], other),
          }),
        );
        expect(error.code).toBe('PAYLOAD_INVALID');
        expect(error.details.issues[0].issue).toBe('simulation_mismatch');
      }
      expect(chain.sent).toHaveLength(0);
    });
  });

  describe('real prepared transactions', () => {
    let restore: () => void = () => {};
    afterEach(() => restore());

    const vectors = JSON.parse(
      readFileSync('spec/vectors/deposit_checks.json', 'utf8'),
    ).cases as any[];
    const vectorDeposit = (name: string): Deposit => {
      const d = vectors.find(c => c.name === name).input.deposits[0];
      return {
        pubkey: d.pubkey,
        withdrawalCredentials: d.withdrawal_credentials,
        signature: d.signature,
        depositDataRoot: d.deposit_data_root,
        amount: BigInt(d.amount),
      };
    };
    const DEPOSIT = vectorDeposit('lock_deposit_valid');
    const TOP_UP = vectorDeposit('launchpad_topup_1_eth');
    const BATCH = CHAINS[560048].contracts!.batchDeposit;
    const chain = () =>
      ovmChain({ walletAccount: OWNER, code: { [BATCH]: '0x6080604052' } });

    const expectGate = async (
      c: ReturnType<typeof chain>,
      prepared: AnyPrepared,
      codes: FindingCode[],
    ) => {
      const error = await rejected(send(c.context(), prepared));
      expect(error.code).toBe('FINDINGS_NOT_ACKNOWLEDGED');
      expect(error.details.codes).toEqual(codes);
      expect(c.sent).toHaveLength(0);
      await send(c.context(), prepared, { acknowledge: codes });
      expect(c.sent).toHaveLength(1);
    };

    it('deposit with no status source: DEPOSIT_EXISTENCE_UNCHECKED', async () => {
      const c = chain();
      const [prepared] = await prepareDeposit(c.context(), {
        deposits: [DEPOSIT],
        via: { ovm: OVM },
      });
      await expectGate(c, prepared, ['DEPOSIT_EXISTENCE_UNCHECKED']);
    });

    it('a checked deposit to a new validator sends without acknowledgement', async () => {
      restore = mockBeacon([], []);
      const c = chain();
      const [prepared] = await prepareDeposit(c.context(), {
        deposits: [DEPOSIT],
        via: { ovm: OVM },
        beaconUrl: BEACON_URL,
      });
      expect(prepared.checks).toEqual([]);
      await send(c.context(), prepared);
      expect(c.sent).toHaveLength(1);
    });

    it("top-up to someone else's validator: TOP_UP_CREDENTIALS_FOREIGN", async () => {
      restore = mockBeacon(
        [],
        [
          registryRow(
            DEPOSIT.pubkey.toLowerCase() as Hex,
            'active_ongoing',
            credentials('02', OTHER),
            32n * ETH,
          ),
        ],
      );
      const c = chain();
      const [prepared] = await prepareDeposit(c.context(), {
        deposits: [TOP_UP],
        kind: 'topUp',
        via: { ovm: OVM },
        beaconUrl: BEACON_URL,
      });
      await expectGate(c, prepared, ['TOP_UP_CREDENTIALS_FOREIGN']);
    });

    it('batch deposit to an OVM: OVM_STAKE_NOT_TRACKED', async () => {
      restore = mockBeacon([], []);
      const c = chain();
      const [prepared] = await prepareDeposit(c.context(), {
        deposits: [DEPOSIT],
        via: { batch: true },
        expectedWithdrawalAddress: OVM,
        beaconUrl: BEACON_URL,
      });
      await expectGate(c, prepared, ['OVM_STAKE_NOT_TRACKED']);
    });

    it('withdrawal with unchecked validator status: VALIDATOR_STATUS_UNCHECKED', async () => {
      const c = chain();
      const prepared = await prepareWithdraw(c.context(), {
        ovm: OVM,
        requests: [{ pubkey: PUBKEY_A, amount: ETH }],
      });
      await expectGate(c, prepared, ['VALIDATOR_STATUS_UNCHECKED']);
    });

    it('consolidation to another withdrawal address: CONSOLIDATION_CREDENTIALS_DIFFER', async () => {
      restore = mockBeacon(
        [],
        [
          [PUBKEY_A, credentials('01', OVM), '1'],
          [PUBKEY_B, credentials('01', OVM), '2'],
          [PUBKEY_C, credentials('02', OTHER), '3'],
        ].map(([pubkey, creds, index]) =>
          registryRow(
            pubkey as Hex,
            'active_ongoing',
            creds as Hex,
            32n * ETH,
            {
              index,
            },
          ),
        ),
      );
      const c = chain();
      const prepared = await prepareConsolidate(c.context(), {
        ovm: OVM,
        requests: [{ sources: [PUBKEY_A, PUBKEY_B], target: PUBKEY_C }],
        beaconUrl: BEACON_URL,
      });
      await expectGate(c, prepared, ['CONSOLIDATION_CREDENTIALS_DIFFER']);
    });

    it('granting CONSOLIDATION: ROLE_GRANT_CONSOLIDATION', async () => {
      const c = chain();
      const prepared = await prepareGrantRoles(c.context(), {
        ovm: OVM,
        user: OTHER,
        roles: 0x02n, // CONSOLIDATION
      });
      const open = findingsToAcknowledge(prepared).map(f => f.code);
      expect(open).toContain('ROLE_GRANT_CONSOLIDATION');
      await expectGate(c, prepared, [...new Set(open)]);
    });
  });
});
