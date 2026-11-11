import { ovmAbi } from '../../src/abi.js';
import { isObolError } from '../../src/errors.js';
import { readMany } from '../../src/multicall.js';
import { OVM, ovmChain } from '../ovm/ovmFixture.js';

const ARCHIVE_REFUSAL = 'Archive requests require a personal token';
const OWNER_CALL = { address: OVM, abi: ovmAbi, functionName: 'owner' };

/**
 * eth_call at an explicit block is refused (as a non-archive node does);
 * `latest` is served. `blocks` is the order of blocks tried (viem's own
 * transport retries of one request are collapsed).
 */
const refusingPinned = (refuseLatest = false) => {
  const tried: string[] = [];
  const blocks = (): string[] =>
    tried.filter((tag, i) => i === 0 || tried[i - 1] !== tag);
  const chain = ovmChain({
    onRequest: (method, params) => {
      if (method !== 'eth_call') return undefined;
      const tag = String(params[1] ?? 'latest');
      tried.push(tag);
      if (tag !== 'latest' || refuseLatest) throw new Error(ARCHIVE_REFUSAL);
      return undefined;
    },
  });
  return { chain, blocks };
};

describe('readMany', () => {
  it('retries a read the RPC refuses at a pinned block once at latest', async () => {
    const { chain, blocks } = refusingPinned();
    const [owner] = await readMany(
      chain.context(),
      [OWNER_CALL],
      'test.read',
      1_999_000n,
    );
    expect(owner.ok).toBe(true);
    expect(blocks()).toEqual([`0x${(1_999_000).toString(16)}`, 'latest']);
  });

  it('throws CHAIN_READ_FAILED with the first error when latest fails too', async () => {
    const { chain, blocks } = refusingPinned(true);
    const error = await readMany(
      chain.context(),
      [OWNER_CALL],
      'test.read',
      1_999_000n,
    ).catch((e: unknown) => e);
    expect(isObolError(error, 'CHAIN_READ_FAILED')).toBe(true);
    expect(String((error as { cause?: unknown }).cause)).toContain(
      ARCHIVE_REFUSAL,
    );
    expect(blocks()).toEqual([`0x${(1_999_000).toString(16)}`, 'latest']);
  });

  it('does not retry a read at latest', async () => {
    const { chain, blocks } = refusingPinned(true);
    await expect(
      readMany(chain.context(), [OWNER_CALL], 'test.read'),
    ).rejects.toMatchObject({ code: 'CHAIN_READ_FAILED' });
    expect(blocks()).toEqual(['latest']);
  });
});
