import type { Address } from 'viem';
import { splitCreatedEvents, splitUpdatedEvent } from '../../src/abi.js';
import { getSplit } from '../../src/splits/getSplit.js';
import { hashSplitParams } from '../../src/splits/shares.js';
import { ZERO_ADDRESS } from '../../src/schema.js';
import type { SplitParams } from '../../src/types.js';
import { fakeApi, fakeChain, type FakeLog } from '../helpers/fakeChain.js';
import {
  addr,
  caught,
  eventLog,
  HOODI,
  splitContract,
  warehouseContract,
} from './helpers.js';

const SPLIT = addr(0x5b11);
const OVM = addr(0x0f0f);
const OWNER = addr(0x0e);
const original: SplitParams = {
  recipients: [addr(1), addr(2)],
  allocations: [600_000n, 400_000n],
  totalAllocation: 1_000_000n,
  distributionIncentive: 0,
};
const updated: SplitParams = { ...original, allocations: [500_000n, 500_000n] };
const block = HOODI.ovmFactory.deployBlock + 100n;

const createdLog = (params: SplitParams): FakeLog =>
  eventLog(
    HOODI.pullSplitFactory,
    splitCreatedEvents[0],
    {
      split: SPLIT,
      splitParams: params,
      owner: OWNER,
      creator: ZERO_ADDRESS,
      salt: `0x${'00'.repeat(32)}`,
    },
    block,
  );
const updatedLog = (params: SplitParams, at: bigint): FakeLog =>
  eventLog(SPLIT, splitUpdatedEvent, { _split: params }, at);

const chainWith = (
  current: SplitParams,
  opts: {
    logs?: FakeLog[];
    splitHash?: `0x${string}`;
    code?: `0x${string}`;
    getLogsFails?: boolean;
  } = {},
) =>
  fakeChain({
    contracts: {
      [SPLIT]: splitContract({
        params: current,
        owner: OWNER,
        paused: true,
        ...(opts.splitHash !== undefined ? { splitHash: opts.splitHash } : {}),
      }),
      [HOODI.warehouse]: warehouseContract({ [SPLIT]: 7n }),
    },
    balances: { [SPLIT]: 11n },
    ...(opts.code !== undefined ? { code: { [SPLIT]: opts.code } } : {}),
    logs: opts.logs ?? [],
    ...(opts.getLogsFails === true
      ? { getLogsError: () => new Error('range too wide') }
      : {}),
  });

describe('splits.getSplit', () => {
  it('reads the state and checks given params', async () => {
    const chain = chainWith(original);
    const info = await getSplit(chain.context(), {
      address: SPLIT,
      params: original,
    });
    expect(info).toEqual({
      address: SPLIT,
      splitHash: hashSplitParams(original),
      owner: OWNER,
      paused: true,
      balance: 11n,
      warehouseBalance: 7n,
      params: original,
      paramsSource: 'input',
      blockNumber: 2_000_000n,
    });
  });

  it('throws SPLIT_PARAMS_MISMATCH for given params of another split', async () => {
    const chain = chainWith(original);
    const error = await caught(
      getSplit(chain.context(), { address: SPLIT, params: updated }),
    );
    expect(error.code).toBe('SPLIT_PARAMS_MISMATCH');
    expect(error.details.address).toBe(SPLIT);
  });

  it('checks the code first: no code is SPLIT_NOT_FOUND even if calls answer', async () => {
    const chain = chainWith(original, { code: '0x' });
    expect(
      (await caught(getSplit(chain.context(), { address: SPLIT }))).code,
    ).toBe('SPLIT_NOT_FOUND');
  });

  it('treats an EIP-7702 delegation as SPLIT_NOT_FOUND', async () => {
    const chain = chainWith(original, { code: `0xef0100${'11'.repeat(20)}` });
    expect(
      (await caught(getSplit(chain.context(), { address: SPLIT }))).code,
    ).toBe('SPLIT_NOT_FOUND');
  });

  it('treats a zero splitHash or failing getters as SPLIT_NOT_FOUND', async () => {
    const zero = chainWith(original, { splitHash: `0x${'00'.repeat(32)}` });
    expect(
      (await caught(getSplit(zero.context(), { address: SPLIT }))).code,
    ).toBe('SPLIT_NOT_FOUND');
    const notSplit = fakeChain({ code: { [SPLIT]: '0x6080604052' } });
    expect(
      (await caught(getSplit(notSplit.context(), { address: SPLIT }))).code,
    ).toBe('SPLIT_NOT_FOUND');
  });

  it('finds params in the SplitCreated log', async () => {
    const chain = chainWith(original, { logs: [createdLog(original)] });
    const info = await getSplit(chain.context(), { address: SPLIT });
    expect(info.params).toEqual(original);
    expect(info.paramsSource).toBe('chain');
  });

  it('prefers the latest SplitUpdated log that matches', async () => {
    const chain = chainWith(updated, {
      logs: [
        createdLog(original),
        updatedLog({ ...original, allocations: [1n, 999_999n] }, block + 1n),
        updatedLog(updated, block + 60_000n),
      ],
    });
    const info = await getSplit(chain.context(), { address: SPLIT });
    expect(info.params).toEqual(updated);
    expect(info.paramsSource).toBe('chain');
  });

  it('returns null params when nothing matches or the scan fails', async () => {
    const none = chainWith(updated, { logs: [createdLog(original)] });
    const info = await getSplit(none.context(), { address: SPLIT });
    expect(info.params).toBeNull();
    expect(info.paramsSource).toBeNull();
    const failing = chainWith(original, { getLogsFails: true });
    expect(
      (await getSplit(failing.context(), { address: SPLIT })).params,
    ).toBeNull();
  });

  it('uses matching API params for the OVM and discards others', async () => {
    const entry = (p: SplitParams, address: Address = SPLIT) => ({
      address,
      recipients: p.recipients,
      allocations: p.allocations.map(String),
      totalAllocation: String(p.totalAllocation),
      distributionIncentive: p.distributionIncentive,
    });
    const api = fakeApi({
      [`/v1/ovm/hoodi/${OVM}`]: () => ({
        splits: [
          entry(original, addr(9)),
          entry(updated),
          { address: SPLIT, recipients: 'bad' },
          entry(original),
        ],
      }),
    });
    const chain = chainWith(original);
    const info = await getSplit(chain.context(api), {
      address: SPLIT,
      ovm: OVM,
    });
    expect(info.params).toEqual(original);
    expect(info.paramsSource).toBe('api');
  });

  it('falls back to the logs when the API has no answer', async () => {
    const api = fakeApi({});
    const chain = chainWith(original, { logs: [createdLog(original)] });
    const info = await getSplit(chain.context(api), {
      address: SPLIT,
      ovm: OVM,
    });
    expect(info.paramsSource).toBe('chain');
  });

  it('decodes the input', async () => {
    const chain = chainWith(original);
    expect(
      (await caught(getSplit(chain.context(), { address: '0x12' as Address })))
        .code,
    ).toBe('PAYLOAD_INVALID');
  });
});
