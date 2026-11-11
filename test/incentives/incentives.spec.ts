import {
  concat,
  decodeFunctionData,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { createIncentivesModule } from '../../src/incentives/index.js';
import {
  getIncentives,
  isClaimed,
  preflight,
  prepareClaim,
} from '../../src/incentives/incentives.js';
import {
  merkleDistributorAbi,
  merkleLeaf,
  MERKLE_DISTRIBUTOR_RUNTIME,
} from '../../src/incentives/merkle.js';
import { ObolApiError } from '../../src/errors.js';
import { merkleDistributorRuntimeCode } from '../fixtures.js';
import { fakeApi, fakeChain } from '../helpers/fakeChain.js';
import { addr, caught, HOODI } from '../splits/helpers.js';

const OPERATOR = addr(0x0b);
const DIST = addr(0xd157);
const AMOUNT = 1_000n * 10n ** 18n;
const END = 2_000_000_000n;

const sortedPair = (a: Hex, b: Hex): Hex =>
  keccak256(BigInt(a) < BigInt(b) ? concat([a, b]) : concat([b, a]));
// A four-leaf tree; the operator is leaf 2.
const leaves = [
  merkleLeaf(0n, addr(1), 5n),
  merkleLeaf(1n, addr(2), 6n),
  merkleLeaf(2n, OPERATOR, AMOUNT),
  merkleLeaf(3n, addr(3), 7n),
];
const ROOT = sortedPair(
  sortedPair(leaves[0], leaves[1]),
  sortedPair(leaves[2], leaves[3]),
);
const PROOF = [leaves[3], sortedPair(leaves[0], leaves[1])];

const record = (change: Record<string, unknown> = {}) => ({
  operator_address: OPERATOR.toLowerCase(),
  contract_address: DIST,
  index: 2,
  amount: AMOUNT.toString(),
  merkle_proof: PROOF,
  ...change,
});

const path = `/v1/address/incentives/hoodi/${OPERATOR}`;

const setup = (
  opts: {
    api?: () => unknown;
    code?: Hex;
    token?: Address;
    root?: Hex;
    claimed?: boolean;
    timestamp?: bigint;
    revert?: boolean;
    blockFails?: boolean;
  } = {},
) => {
  const api = fakeApi({ [path]: opts.api ?? (() => record()) });
  const chain = fakeChain({
    contracts: {
      [DIST]: {
        abi: merkleDistributorAbi,
        code: opts.code ?? (merkleDistributorRuntimeCode as Hex),
        read: {
          token: () => {
            if (opts.revert === true) throw new Error('revert');
            return opts.token ?? HOODI.obolToken;
          },
          merkleRoot: () => opts.root ?? ROOT,
          endTime: () => END,
          isClaimed: () => opts.claimed ?? false,
        },
      },
    },
    onRequest: (method, params) => {
      if (method !== 'eth_getBlockByNumber') return undefined;
      if (opts.blockFails === true) throw new Error('no block');
      return {
        number: params[0],
        hash: `0x${'12'.repeat(32)}`,
        parentHash: `0x${'34'.repeat(32)}`,
        timestamp: toHex(opts.timestamp ?? END - 1n),
        gasLimit: '0x1',
        gasUsed: '0x0',
        baseFeePerGas: '0x1',
        transactions: [],
        uncles: [],
        logsBloom: `0x${'00'.repeat(256)}`,
        miner: addr(0),
        difficulty: '0x0',
        totalDifficulty: '0x0',
        extraData: '0x',
        nonce: '0x0000000000000000',
        sha3Uncles: `0x${'00'.repeat(32)}`,
        size: '0x1',
        stateRoot: `0x${'00'.repeat(32)}`,
        receiptsRoot: `0x${'00'.repeat(32)}`,
        transactionsRoot: `0x${'00'.repeat(32)}`,
        mixHash: `0x${'00'.repeat(32)}`,
      };
    },
  });
  return { api, chain, ctx: chain.context(api) };
};

const codes = (r: { issues: Array<{ code: string }> }): string[] =>
  r.issues.map(i => i.code);

describe('incentives.get', () => {
  it('maps the API record', async () => {
    const { ctx, api } = setup();
    await expect(getIncentives(ctx, OPERATOR)).resolves.toEqual({
      operatorAddress: OPERATOR,
      contractAddress: DIST,
      index: 2,
      amount: AMOUNT,
      merkleProof: PROOF,
    });
    expect(api.calls[0].endpoint).toBe(path);
  });

  it('returns null for an empty record', async () => {
    const { ctx } = setup({
      api: () => record({ contract_address: '', index: -1 }),
    });
    await expect(getIncentives(ctx, OPERATOR)).resolves.toBeNull();
  });

  it('rejects a record for another address or a malformed one', async () => {
    const other = setup({ api: () => record({ operator_address: addr(9) }) });
    const mismatch = await caught(getIncentives(other.ctx, OPERATOR));
    expect(mismatch.code).toBe('API_RESPONSE_MISMATCH');
    expect(mismatch).toBeInstanceOf(ObolApiError);
    const bad = setup({ api: () => record({ amount: '1.5' }) });
    expect((await caught(getIncentives(bad.ctx, OPERATOR))).code).toBe(
      'API_ERROR',
    );
  });

  it('needs the API', async () => {
    const { chain } = setup();
    expect(
      (await caught(getIncentives(chain.context(null), OPERATOR))).code,
    ).toBe('API_DISABLED');
  });
});

describe('incentives.isClaimed', () => {
  it('reads isClaimed and reports read failures', async () => {
    const { ctx } = setup({ claimed: true });
    await expect(
      isClaimed(ctx, { contractAddress: DIST, index: 2 }),
    ).resolves.toBe(true);
    expect(
      (await caught(isClaimed(ctx, { contractAddress: addr(0x99), index: 2 })))
        .code,
    ).toBe('CHAIN_READ_FAILED');
    expect(
      (await caught(isClaimed(ctx, { contractAddress: DIST, index: -1 }))).code,
    ).toBe('PAYLOAD_INVALID');
  });
});

describe('incentives.preflight / prepareClaim', () => {
  it('passes a valid claim and builds claim()', async () => {
    const { ctx } = setup();
    await expect(preflight(ctx, OPERATOR)).resolves.toEqual({
      ok: true,
      issues: [],
    });
    const prepared = await createIncentivesModule(ctx).prepareClaim(OPERATOR);
    expect(prepared.request.to).toBe(DIST);
    expect(prepared.preview).toEqual({ amount: AMOUNT, contractAddress: DIST });
    expect(prepared.blockNumber).toBe(2_000_000n);
    expect(
      decodeFunctionData({
        abi: merkleDistributorAbi,
        data: prepared.request.data,
      }).args,
    ).toEqual([2n, OPERATOR, AMOUNT, PROOF]);
  });

  it('accepts a distributor with other immutables and metadata', async () => {
    const bytes = Buffer.from(
      (merkleDistributorRuntimeCode as string).slice(2),
      'hex',
    );
    for (const offset of MERKLE_DISTRIBUTOR_RUNTIME.immutableOffsets)
      bytes.fill(0xaa, offset, offset + 32);
    bytes.fill(0xbb, bytes.length - 40, bytes.length - 10);
    const { ctx } = setup({ code: `0x${bytes.toString('hex')}` });
    await expect(preflight(ctx, OPERATOR)).resolves.toEqual({
      ok: true,
      issues: [],
    });
  });

  it.each<[string, Parameters<typeof setup>[0], string[]]>([
    [
      'INCENTIVES_NOT_FOUND',
      {
        api: () => {
          throw new ObolApiError('API_NOT_FOUND', 'nf', {
            status: 404,
            endpoint: path,
            method: 'GET',
          });
        },
      },
      ['INCENTIVES_NOT_FOUND'],
    ],
    [
      'INCENTIVES_FETCH_FAILED',
      {
        api: () => {
          throw new ObolApiError('API_ERROR', 'down', {
            status: 500,
            endpoint: path,
            method: 'GET',
          });
        },
      },
      ['INCENTIVES_FETCH_FAILED'],
    ],
    [
      'NO_INCENTIVES',
      { api: () => record({ contract_address: '' }) },
      ['NO_INCENTIVES'],
    ],
    [
      'OPERATOR_ADDRESS_MISMATCH and INCENTIVES_DATA_INVALID',
      {
        api: () =>
          record({
            operator_address: addr(9),
            index: 1.5,
            merkle_proof: ['0x12'],
          }),
      },
      [
        'OPERATOR_ADDRESS_MISMATCH',
        'INCENTIVES_DATA_INVALID',
        'INCENTIVES_DATA_INVALID',
      ],
    ],
    ['CONTRACT_NOT_DEPLOYED', { code: '0x' }, ['CONTRACT_NOT_DEPLOYED']],
    ['DISTRIBUTOR_UNKNOWN', { code: '0x6080604052' }, ['DISTRIBUTOR_UNKNOWN']],
    ['TOKEN_MISMATCH', { token: addr(0x70) }, ['TOKEN_MISMATCH']],
    ['PROOF_INVALID', { root: `0x${'99'.repeat(32)}` }, ['PROOF_INVALID']],
    ['CLAIM_WINDOW_CLOSED', { timestamp: END + 1n }, ['CLAIM_WINDOW_CLOSED']],
    ['CHAIN_READ_FAILED (calls)', { revert: true }, ['CHAIN_READ_FAILED']],
    ['CHAIN_READ_FAILED (block)', { blockFails: true }, ['CHAIN_READ_FAILED']],
  ])('%s', async (_name, opts, expected) => {
    const { ctx } = setup(opts);
    const result = await preflight(ctx, OPERATOR);
    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(expected);
    expect(
      result.issues.every(
        i => i.severity === 'warning' && typeof i.hint === 'string',
      ),
    ).toBe(true);
    const error = await caught(prepareClaim(ctx, OPERATOR));
    expect(error.code).toBe('INCENTIVES_PREFLIGHT_FAILED');
    expect(codes(error.details as { issues: Array<{ code: string }> })).toEqual(
      expected,
    );
  });

  it('throws ALREADY_CLAIMED when that is the only issue, even with the window closed', async () => {
    const claimed = setup({ claimed: true, timestamp: END + 1n });
    expect(codes(await preflight(claimed.ctx, OPERATOR))).toEqual([
      'ALREADY_CLAIMED',
      'CLAIM_WINDOW_CLOSED',
    ]);
    expect((await caught(prepareClaim(claimed.ctx, OPERATOR))).code).toBe(
      'ALREADY_CLAIMED',
    );
    const withProofIssue = setup({
      claimed: true,
      root: `0x${'99'.repeat(32)}`,
    });
    expect(
      (await caught(prepareClaim(withProofIssue.ctx, OPERATOR))).code,
    ).toBe('INCENTIVES_PREFLIGHT_FAILED');
  });

  it('needs the API and a chain with contracts', async () => {
    const { chain } = setup();
    expect((await caught(preflight(chain.context(null), OPERATOR))).code).toBe(
      'API_DISABLED',
    );
    const gnosis = fakeChain({ chainId: 100 });
    expect(
      (await caught(prepareClaim(gnosis.context(fakeApi({})), OPERATOR))).code,
    ).toBe('UNSUPPORTED_CHAIN');
  });
});
