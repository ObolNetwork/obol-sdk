import { ObolApiError } from '../../src/errors.js';
import { verifyOvm } from '../../src/ovm/verify.js';
import { fakeApi } from '../helpers/fakeChain.js';
import { OTHER, OVM, ovmChain } from './ovmFixture.js';

const HOODI_FACTORY = '0x5754C8665B7e7BF15E83fCdF6d9636684B782b12';
const RECORD = `/v1/ovm/hoodi/${OVM}`;
const INTERIM = `/v1/eth/contract-creation/hoodi/${OVM}`;
const TX = `0x${'ab'.repeat(32)}`;

const notFound = (endpoint: string) => () => {
  throw new ObolApiError('API_NOT_FOUND', 'Cannot GET', {
    status: 404,
    endpoint,
    method: 'GET',
  });
};

/** Chain provenance is `notObol` (no factory log), so a chain answer is visible. */
const verifyWith = async (routes: Parameters<typeof fakeApi>[0]) => {
  const api = fakeApi(routes);
  const result = await verifyOvm(
    ovmChain({ provenance: 'notObol' }).context(api),
    OVM,
  );
  return { result, endpoints: api.calls.map(c => c.endpoint) };
};

describe('ovm.verify with the API', () => {
  describe('the OVM record', () => {
    it('trusts obol for this address, with the creation transaction', async () => {
      const { result, endpoints } = await verifyWith({
        [RECORD]: () => ({
          address: OVM.toLowerCase(),
          network: 'hoodi',
          provenance: {
            status: 'obol',
            factoryAddress: HOODI_FACTORY,
            creationTxHash: TX,
            creationBlock: 1_800_000,
            reason: 'CreateObolValidatorManager event found',
          },
        }),
      });
      expect(result).toEqual({
        status: 'obol',
        source: 'api',
        factoryAddress: HOODI_FACTORY,
        reason: 'CreateObolValidatorManager event found',
        creationTxHash: TX,
      });
      expect(endpoints).toEqual([RECORD]);
    });

    const notObolRecord = () => ({
      address: OVM,
      provenance: {
        status: 'notObol',
        factoryAddress: HOODI_FACTORY,
        creationTxHash: null,
        creationBlock: null,
        reason: 'No contract code at the address',
      },
    });

    it('lets the chain decide a notObol record', async () => {
      const { result, endpoints } = await verifyWith({
        [RECORD]: notObolRecord,
      });
      expect(result).toMatchObject({ status: 'notObol', source: 'chain' });
      expect(result.creationTxHash).toBeUndefined();
      expect(endpoints).toEqual([RECORD]);
    });

    it('finds an OVM the API answered notObol for before it was deployed', async () => {
      const api = fakeApi({ [RECORD]: notObolRecord });
      const result = await verifyOvm(ovmChain().context(api), OVM);
      expect(result).toMatchObject({ status: 'obol', source: 'chain' });
    });

    it.each([
      [
        'unknown',
        { address: OVM, provenance: { status: 'unknown', reason: 'x' } },
      ],
      [
        'no address',
        { provenance: { status: 'obol', reason: 'x', creationTxHash: TX } },
      ],
      [
        'another factory',
        {
          address: OVM,
          provenance: { status: 'obol', factoryAddress: OTHER, reason: 'x' },
        },
      ],
      ['no provenance', { address: OVM }],
      [
        'a malformed status',
        { address: OVM, provenance: { status: 'yes', reason: 'x' } },
      ],
    ])('falls through to the chain for %s', async (_name, record) => {
      const { result, endpoints } = await verifyWith({
        [RECORD]: () => record,
      });
      expect(result).toMatchObject({ status: 'notObol', source: 'chain' });
      expect(endpoints).toEqual([RECORD]);
    });

    it('ignores a record for another address (and the interim record is asked)', async () => {
      const { result, endpoints } = await verifyWith({
        [RECORD]: () => ({
          address: OTHER,
          provenance: { status: 'obol', reason: 'x' },
        }),
        [INTERIM]: notFound(INTERIM),
      });
      expect(result.source).toBe('chain');
      expect(endpoints).toEqual([RECORD, INTERIM]);
    });
  });

  describe('the interim creation record (OVM endpoint 404)', () => {
    it('trusts a record naming this address and the factory', async () => {
      const { result, endpoints } = await verifyWith({
        [RECORD]: notFound(RECORD),
        [INTERIM]: () => ({
          contractAddress: OVM.toLowerCase(),
          contractFactory: HOODI_FACTORY.toLowerCase(),
        }),
      });
      expect(result).toMatchObject({ status: 'obol', source: 'api' });
      expect(endpoints).toEqual([RECORD, INTERIM]);
    });

    it('reports another factory as notObol', async () => {
      const { result } = await verifyWith({
        [RECORD]: notFound(RECORD),
        [INTERIM]: () => ({ contractAddress: OVM, contractFactory: OTHER }),
      });
      expect(result).toMatchObject({ status: 'notObol', source: 'api' });
    });

    it.each([
      ['missing', {}],
      ['empty', { contractAddress: '' }],
      ['another address', { contractAddress: OTHER }],
    ])(
      'falls through to the chain when contractAddress is %s',
      async (_name, patch) => {
        const { result } = await verifyWith({
          [RECORD]: notFound(RECORD),
          [INTERIM]: () => ({ contractFactory: HOODI_FACTORY, ...patch }),
        });
        expect(result).toMatchObject({ status: 'notObol', source: 'chain' });
      },
    );
  });

  it('finds the factory log on chain when the API has nothing', async () => {
    const api = fakeApi({
      [RECORD]: notFound(RECORD),
      [INTERIM]: notFound(INTERIM),
    });
    const result = await verifyOvm(ovmChain().context(api), OVM);
    expect(result).toMatchObject({ status: 'obol', source: 'chain' });
  });

  it('reads a contract that does not answer the OVM getters as notObol, without a log scan', async () => {
    const otherRecord = `/v1/ovm/hoodi/${OTHER}`;
    const otherInterim = `/v1/eth/contract-creation/hoodi/${OTHER}`;
    const api = fakeApi({
      [otherRecord]: () => ({
        address: OTHER,
        provenance: { status: 'unknown', reason: 'Could not search' },
      }),
      [otherInterim]: notFound(otherInterim),
    });
    const chain = ovmChain({ raw: { [OTHER]: () => '0x' } });
    const result = await verifyOvm(chain.context(api), OTHER);
    expect(result).toMatchObject({
      status: 'notObol',
      source: 'chain',
      reason: 'The contract does not answer the OVM getters',
    });
    expect(chain.requests.map(r => r.method)).not.toContain('eth_getLogs');
  });

  it('scans the factory logs when the getters cannot be read', async () => {
    const api = fakeApi({
      [RECORD]: notFound(RECORD),
      [INTERIM]: notFound(INTERIM),
    });
    const chain = ovmChain({
      onRequest: method => {
        if (method === 'eth_call') throw new Error('internal error');
        return undefined;
      },
    });
    const result = await verifyOvm(chain.context(api), OVM);
    expect(result).toMatchObject({ status: 'obol', source: 'chain' });
  });
});
