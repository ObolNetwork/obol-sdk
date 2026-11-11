import { readFileSync } from 'node:fs';
import { getAddress } from 'viem';
import { ObolApiError } from '../../src/errors.js';
import { getOvmProvenance } from '../../src/ovm/provenance.js';
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
  const result = await getOvmProvenance(
    ovmChain({ provenance: 'notObol' }).context(api),
    OVM,
  );
  return { result, endpoints: api.calls.map(c => c.endpoint) };
};

describe('ovm.getProvenance with the API', () => {
  describe('the OVM record', () => {
    const obolRecord = () => ({
      address: OVM.toLowerCase(),
      network: 'hoodi',
      provenance: {
        status: 'obol',
        factoryAddress: HOODI_FACTORY,
        creationTxHash: TX,
        creationBlock: 1_800_000,
        reason: 'CreateObolValidatorManager event found',
      },
    });

    it('marks an obol answer it could not confirm on chain as source: api', async () => {
      // The chain has no receipt for TX (and no factory log).
      const { result, endpoints } = await verifyWith({ [RECORD]: obolRecord });
      expect(result).toEqual({
        status: 'obol',
        source: 'api',
        factoryAddress: HOODI_FACTORY,
        reason:
          "CreateObolValidatorManager event found (the Obol API's answer; not confirmed on chain)",
        creationTxHash: TX,
      });
      expect(endpoints).toEqual([RECORD]);
    });

    it('requireChain: the API saying obol is not enough; the chain decides', async () => {
      // No receipt and no factory log: the address was not created by the factory.
      const liar = fakeApi({ [RECORD]: obolRecord });
      expect(
        await getOvmProvenance(
          ovmChain({ provenance: 'notObol' }).context(liar),
          OVM,
          {
            requireChain: true,
          },
        ),
      ).toMatchObject({ status: 'notObol', source: 'chain' });
      // With the factory log on chain the same answer is confirmed there.
      expect(
        await getOvmProvenance(
          ovmChain().context(fakeApi({ [RECORD]: obolRecord })),
          OVM,
          {
            requireChain: true,
          },
        ),
      ).toMatchObject({ status: 'obol', source: 'chain' });
      // The scan failing is `unknown`, never the API's word.
      expect(
        await getOvmProvenance(
          ovmChain({ provenance: 'unknown' }).context(
            fakeApi({ [RECORD]: obolRecord }),
          ),
          OVM,
          { requireChain: true },
        ),
      ).toMatchObject({ status: 'unknown', source: 'chain' });
    });

    it('rejects an unknown option key', async () => {
      await expect(
        getOvmProvenance(ovmChain().context(), OVM, { requireChian: true } as any),
      ).rejects.toMatchObject({ code: 'PAYLOAD_INVALID' });
    });

    describe('confirmation against the creation receipt (a real mainnet receipt)', () => {
      // The first OVM the mainnet factory created, and its receipt.
      const REAL_OVM = getAddress('0xcb3053cf4f590be6af1aafb33799abffed496b6e');
      const REAL_TX =
        '0x111e39369ee06ea5c3a2a21ca361cffd06ce5163736355fa8966180aa40a9bcd';
      const MAINNET_FACTORY = '0x2c26B5A373294CaccBd3DE817D9B7C6aea7De584';
      const { receipt } = JSON.parse(
        readFileSync(
          'test/fixtures/chain/mainnet_ovm_creation_receipt.json',
          'utf8',
        ),
      );
      const record = (address: string, tx: string) => () => ({
        address,
        network: 'mainnet',
        provenance: {
          status: 'obol',
          factoryAddress: MAINNET_FACTORY,
          creationTxHash: tx,
          reason: 'Created by the OVM factory',
        },
      });
      const mainnet = (receipts: Record<string, unknown>, address = REAL_OVM) =>
        ovmChain({
          chainId: 1,
          provenance: 'notObol',
          code: { [address]: '0x6080604052' },
          receipts,
        });

      it('confirms obol from the receipt: source chain, one receipt read, no log scan', async () => {
        const chain = mainnet({ [REAL_TX]: receipt });
        const api = fakeApi({
          [`/v1/ovm/mainnet/${REAL_OVM}`]: record(REAL_OVM, REAL_TX),
        });
        expect(await getOvmProvenance(chain.context(api), REAL_OVM)).toEqual({
          status: 'obol',
          source: 'chain',
          factoryAddress: MAINNET_FACTORY,
          reason:
            'CreateObolValidatorManager event found in the creation transaction',
          creationTxHash: REAL_TX,
        });
        expect(chain.requests.map(r => r.method)).not.toContain('eth_getLogs');
      });

      it('an API that names a real creation transaction for another address is overruled by the chain', async () => {
        // The receipt is genuine, but it created REAL_OVM, not OTHER.
        const chain = mainnet({ [REAL_TX]: receipt }, OTHER);
        const api = fakeApi({
          [`/v1/ovm/mainnet/${OTHER}`]: record(OTHER, REAL_TX),
        });
        const result = await getOvmProvenance(chain.context(api), OTHER);
        expect(result.status).not.toBe('obol');
        expect(result.source).toBe('chain');
      });

      it.each([
        [
          'emitted by another contract',
          (r: any) => {
            r.logs[1].address = OTHER.toLowerCase();
          },
        ],
        [
          'in a reverted transaction',
          (r: any) => {
            r.status = '0x0';
          },
        ],
        [
          'with another event signature',
          (r: any) => {
            r.logs[1].topics[0] = r.logs[0].topics[0];
          },
        ],
      ])('does not accept a log %s', async (_name, edit) => {
        const forged = JSON.parse(JSON.stringify(receipt));
        edit(forged);
        const chain = mainnet({ [REAL_TX]: forged });
        const api = fakeApi({
          [`/v1/ovm/mainnet/${REAL_OVM}`]: record(REAL_OVM, REAL_TX),
        });
        const result = await getOvmProvenance(chain.context(api), REAL_OVM);
        expect(result.status).not.toBe('obol');
      });
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
      const result = await getOvmProvenance(ovmChain().context(api), OVM);
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
    const result = await getOvmProvenance(ovmChain().context(api), OVM);
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
    const result = await getOvmProvenance(chain.context(api), OTHER);
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
    const result = await getOvmProvenance(chain.context(api), OVM);
    expect(result).toMatchObject({ status: 'obol', source: 'chain' });
  });
});
