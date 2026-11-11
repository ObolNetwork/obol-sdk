// ovm.getRoleHolders and ovm.getProvenance when a source fails or answers
// with something unusable: which source is asked next, in which order, and
// what the answer is then.
import { getOvmProvenance } from '../../src/ovm/provenance.js';
import { getOvmRoleHolders } from '../../src/ovm/state.js';
import { fakeApi } from '../helpers/fakeChain.js';
import {
  caught,
  HOLDER,
  OTHER,
  OVM,
  ovmChain,
  OWNER,
  rolesLog,
} from './ovmFixture.js';

const HOODI_FACTORY = '0x5754C8665B7e7BF15E83fCdF6d9636684B782b12';
const RECORD = `/v1/ovm/hoodi/${OVM}`;
const INTERIM = `/v1/eth/contract-creation/hoodi/${OVM}`;

const logs = [
  rolesLog(OVM, HOLDER, 0x01n, 1_800_000n),
  rolesLog(OVM, OTHER, 0x20n, 1_900_000n),
];
const LOG_INDEX = `/v1/eth/logs/hoodi?address=${OVM}&topic0=${logs[0].topics[0]}&fromBlock=1735335`;
const roles = { [HOLDER]: 0x01n, [OTHER]: 0x20n };

const ovmLogScans = (chain: ReturnType<typeof ovmChain>): any[] =>
  chain.requests
    .filter(
      r =>
        r.method === 'eth_getLogs' &&
        r.params[0].address.toLowerCase() === OVM.toLowerCase(),
    )
    .map(r => r.params[0]);

describe('ovm.getRoleHolders: sources', () => {
  it('asks the OVM record, then the log index, then scans the chain when both fail', async () => {
    const chain = ovmChain({ logs, state: { roles } });
    const api = fakeApi({}); // every route throws
    const result = await getOvmRoleHolders(chain.context(api), OVM);
    expect(api.calls.map(c => c.endpoint)).toEqual([RECORD, LOG_INDEX]);
    expect(result.source).toBe('chain');
    expect(result.holders.map(h => h.address)).toEqual([OWNER, HOLDER, OTHER]);
    // The full scan starts at the factory's deploy block.
    expect(BigInt(ovmLogScans(chain)[0].fromBlock)).toBe(1_735_335n);
  });

  it('does not ask the log index when the OVM record lists the holders', async () => {
    const chain = ovmChain({ state: { roles } });
    const api = fakeApi({
      [RECORD]: () => ({
        address: OVM,
        network: 'hoodi',
        roles: [{ address: HOLDER, roles: '1' }],
      }),
    });
    const result = await getOvmRoleHolders(chain.context(api), OVM);
    expect(api.calls.map(c => c.endpoint)).toEqual([RECORD]);
    expect(result.source).toBe('api');
    expect(result.holders.map(h => h.address)).toEqual([OWNER, HOLDER]);
    // Only the recent blocks are scanned.
    expect(
      ovmLogScans(chain).every(f => BigInt(f.fromBlock) > 1_735_335n),
    ).toBe(true);
  });

  it.each<[string, () => unknown]>([
    ['status 0 (no records)', () => ({ status: '0', logs: [] })],
    ['logs that are not a list', () => ({ status: '1', logs: {} })],
    ['a truncated list', () => ({ status: '1', logs, truncated: true })],
    ['null', () => null],
  ])(
    'a log index answering %s is not an answer: the chain is scanned',
    async (_name, answer) => {
      const chain = ovmChain({ logs: [logs[0]], state: { roles } });
      const api = fakeApi({ [LOG_INDEX]: answer });
      const result = await getOvmRoleHolders(chain.context(api), OVM);
      expect(result.source).toBe('chain');
      expect(result.holders.map(h => h.address)).toEqual([OWNER, HOLDER]);
    },
  );

  it('keeps the API answer when the recent scan fails', async () => {
    const chain = ovmChain({
      state: { roles },
      getLogsError: () => new Error('nope'),
    });
    const api = fakeApi({ [LOG_INDEX]: () => ({ status: '1', logs }) });
    const result = await getOvmRoleHolders(chain.context(api), OVM);
    expect(result.source).toBe('api');
    expect(result.holders.map(h => h.address)).toEqual([OWNER, HOLDER, OTHER]);
  });

  it('ignores log index entries that are not RolesUpdated logs of this OVM', async () => {
    const chain = ovmChain({ state: { roles } });
    const api = fakeApi({
      [LOG_INDEX]: () => ({
        status: '1',
        logs: [
          null,
          {},
          { address: OVM, topics: 'x' },
          { ...logs[0], address: OTHER },
          { ...logs[0], topics: [`0x${'11'.repeat(32)}`, logs[0].topics[1]] },
          { ...logs[0], topics: [logs[0].topics[0], '0x1234'] },
          { ...logs[0], topics: [logs[0].topics[0]] },
          logs[1],
        ],
      }),
    });
    const result = await getOvmRoleHolders(chain.context(api), OVM);
    expect(result.source).toBe('api');
    expect(result.holders.map(h => h.address)).toEqual([OWNER, OTHER]);
  });

  it('the full scan failing is OVM_ROLE_EVENTS_UNAVAILABLE, also after the API failed', async () => {
    const chain = ovmChain({
      getLogsError: filter =>
        filter.address.toLowerCase() === OVM.toLowerCase()
          ? new Error('nope')
          : undefined,
    });
    const error = await caught(
      getOvmRoleHolders(chain.context(fakeApi({})), OVM),
    );
    expect(error.code).toBe('OVM_ROLE_EVENTS_UNAVAILABLE');
    expect(error.message).toBe(
      `Could not read the RolesUpdated events of ${OVM}`,
    );
    expect(error.details).toEqual({ address: OVM });
  });
});

describe('ovm.getProvenance: the chain steps', () => {
  const noApi = (): ReturnType<typeof fakeApi> => fakeApi({});

  it('unknown when the code cannot be read, without asking the API', async () => {
    const chain = ovmChain({
      onRequest: method => {
        if (method === 'eth_getCode') throw new Error('socket hang up');
        return undefined;
      },
    });
    const api = noApi();
    const result = await getOvmProvenance(chain.context(api), OVM);
    expect(result.status).toBe('unknown');
    expect(result.source).toBe('chain');
    expect(result.factoryAddress).toBe(HOODI_FACTORY);
    expect(result.reason).toMatch(/^Could not read the code at the address: /);
    expect(result).not.toHaveProperty('creationTxHash');
    expect(api.calls).toEqual([]);
  });

  it('notObol for an address without code, without asking the API', async () => {
    const chain = ovmChain({ code: { [OVM]: '0x' } });
    const api = noApi();
    expect(await getOvmProvenance(chain.context(api), OVM)).toEqual({
      status: 'notObol',
      source: 'chain',
      factoryAddress: HOODI_FACTORY,
      reason: 'No contract code at the address',
    });
    expect(api.calls).toEqual([]);
  });

  it('notObol for an EIP-7702 delegated account', async () => {
    const chain = ovmChain({
      code: { [OVM]: `0xef0100${'11'.repeat(20)}` },
    });
    const api = noApi();
    expect(await getOvmProvenance(chain.context(api), OVM)).toEqual({
      status: 'notObol',
      source: 'chain',
      factoryAddress: HOODI_FACTORY,
      reason: 'The address is an EIP-7702 delegated account, not a contract',
    });
    expect(api.calls).toEqual([]);
  });

  it('asks the OVM record, then the interim record, then the chain', async () => {
    const chain = ovmChain();
    const api = noApi();
    const result = await getOvmProvenance(chain.context(api), OVM);
    expect(api.calls.map(c => c.endpoint)).toEqual([RECORD, INTERIM]);
    expect(result).toMatchObject({
      status: 'obol',
      source: 'chain',
      factoryAddress: HOODI_FACTORY,
      reason: 'CreateObolValidatorManager event found',
    });
    const methods = chain.requests.map(r => r.method);
    expect(methods[0]).toBe('eth_getCode');
    expect(methods).toContain('eth_getLogs');
    expect(methods.indexOf('eth_call')).toBeLessThan(
      methods.indexOf('eth_getLogs'),
    );
  });

  it('notObol when the factory has no log for the address', async () => {
    const chain = ovmChain({ provenance: 'notObol' });
    expect(await getOvmProvenance(chain.context(noApi()), OVM)).toEqual({
      status: 'notObol',
      source: 'chain',
      factoryAddress: HOODI_FACTORY,
      reason: 'No CreateObolValidatorManager event for this address',
    });
  });

  it('unknown when the factory logs cannot be searched', async () => {
    const chain = ovmChain({ getLogsError: () => new Error('nope') });
    const result = await getOvmProvenance(chain.context(noApi()), OVM);
    expect(result.status).toBe('unknown');
    expect(result.source).toBe('chain');
    expect(result.reason).toMatch(/^Could not search the factory events: /);
  });

  it('an interim record from another factory is notObol from the API, with no chain read after the code', async () => {
    const chain = ovmChain();
    const api = fakeApi({
      [INTERIM]: () => ({ contractAddress: OVM, contractFactory: OTHER }),
    });
    expect(await getOvmProvenance(chain.context(api), OVM)).toEqual({
      status: 'notObol',
      source: 'api',
      factoryAddress: HOODI_FACTORY,
      reason: `Created by another factory (${OTHER})`,
    });
    expect(chain.requests.map(r => r.method)).toEqual(['eth_getCode']);
  });

  it('requireChain: an unconfirmed obol from the API goes on to the getters and the logs', async () => {
    const api = fakeApi({
      [INTERIM]: () => ({
        contractAddress: OVM,
        contractFactory: HOODI_FACTORY,
      }),
    });
    const trusting = ovmChain({ provenance: 'notObol' });
    expect(await getOvmProvenance(trusting.context(api), OVM)).toEqual({
      status: 'obol',
      source: 'api',
      factoryAddress: HOODI_FACTORY,
      reason:
        "Created by the OVM factory (the Obol API's answer; not confirmed on chain)",
    });
    expect(trusting.requests.map(r => r.method)).toEqual(['eth_getCode']);
    const strict = ovmChain({ provenance: 'notObol' });
    expect(
      await getOvmProvenance(strict.context(api), OVM, { requireChain: true }),
    ).toEqual({
      status: 'notObol',
      source: 'chain',
      factoryAddress: HOODI_FACTORY,
      reason: 'No CreateObolValidatorManager event for this address',
    });
  });
});
