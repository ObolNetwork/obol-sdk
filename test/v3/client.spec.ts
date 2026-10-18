import { createPublicClient, custom, toHex } from 'viem';
import { gnosis, hoodi, mainnet, optimism } from 'viem/chains';
import { createObolClient } from '../../src/v3/index.js';
import { fakeChain } from './helpers/fakeChain.js';

const publicClientOn = (chain: typeof mainnet) =>
  createPublicClient({
    chain,
    transport: custom({
      request: async ({ method }) => {
        if (method === 'eth_chainId') return toHex(chain.id);
        throw new Error(`unexpected ${method}`);
      },
    }),
  });

describe('createObolClient', () => {
  it('builds every module', () => {
    const { publicClient } = fakeChain();
    const obol = createObolClient({ chain: hoodi, publicClient });
    expect(Object.keys(obol).sort()).toEqual(
      [
        'chain',
        'cluster',
        'deposits',
        'exits',
        'incentives',
        'legacy',
        'ovm',
        'send',
        'setup',
        'splits',
        'terms',
        'withdrawals',
      ].sort(),
    );
    expect(obol.chain.id).toBe(560048);
  });

  it('rejects an unsupported chain', () => {
    expect(() =>
      createObolClient({
        chain: optimism,
        publicClient: publicClientOn(optimism as any) as any,
      }),
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_CHAIN' }));
  });

  it('rejects a publicClient on another chain', () => {
    expect(() =>
      createObolClient({
        chain: hoodi,
        publicClient: publicClientOn(mainnet) as any,
      }),
    ).toThrow(expect.objectContaining({ code: 'CHAIN_MISMATCH' }));
  });

  it('only allows Obol API hosts', () => {
    const { publicClient } = fakeChain();
    expect(() =>
      createObolClient({
        chain: hoodi,
        publicClient,
        api: { baseUrl: 'https://example.com' },
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_BASE_URL' }));
    expect(() =>
      createObolClient({
        chain: hoodi,
        publicClient,
        api: { baseUrl: 'https://api.obol.tech/' },
      }),
    ).not.toThrow();
  });

  it('api: false disables api operations', async () => {
    const { publicClient } = fakeChain();
    const obol = createObolClient({ chain: hoodi, publicClient, api: false });
    await expect(
      obol.cluster.get(`0x${'11'.repeat(32)}`),
    ).rejects.toMatchObject({ code: 'API_DISABLED' });
  });

  it('allows Gnosis for cluster files only', async () => {
    const obol = createObolClient({
      chain: gnosis,
      publicClient: publicClientOn(gnosis as any) as any,
    });
    await expect(
      obol.ovm.getState('0x1111111111111111111111111111111111111111'),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CHAIN' });
  });
});
