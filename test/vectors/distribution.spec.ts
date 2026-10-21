import { readFileSync, writeFileSync } from 'node:fs';
import type { Address } from 'viem';
import { ovmRouting, thresholdGweiToWei } from '../../src/ovm/routing.js';
import { prepareDistribution } from '../../src/splits/distribution.js';
import { splitAmounts } from '../../src/splits/shares.js';
import type { SplitParams } from '../../src/types.js';
import { fakeChain, type FakeContract } from '../helpers/fakeChain.js';
import {
  caught,
  decodeDistributionCalls,
  HOODI,
  norm,
  ovmContract,
  ovmCreatedLog,
  splitContract,
  splitMainContract,
  warehouseContract,
} from '../splits/helpers.js';

const suite = JSON.parse(
  readFileSync('spec/vectors/distribution.json', 'utf8'),
);

const big = (m: Record<string, string>): Record<string, bigint> =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, BigInt(v)]));

const params = (s: any): SplitParams & { address?: Address } => ({
  ...(s.address !== undefined ? { address: s.address } : {}),
  recipients: s.recipients,
  allocations: s.allocations.map(BigInt),
  totalAllocation: BigInt(s.totalAllocation),
  distributionIncentive: s.distributionIncentive,
});

// VECTORS_REBASELINE=1 rewrites the `calls` and `preview` of the accepted
// `prepare` cases from this implementation (for a deliberate rule change;
// review the diff and record why in each case's `notes`).
const REBASELINE = process.env.VECTORS_REBASELINE === '1';
afterAll(() => {
  if (REBASELINE) {
    writeFileSync(
      'spec/vectors/distribution.json',
      `${JSON.stringify(suite, null, 2)}\n`,
    );
  }
});

/** The chain state of a `prepare` case, served by fakeChain. */
const chainFor = (c: any) => {
  const state = c.input.chainState;
  const contracts: Record<string, FakeContract> = {
    [HOODI.warehouse]: warehouseContract(
      big(state.warehouseBalances),
      state.warehouseWithdrawPaused,
    ),
    [HOODI.splitMain]: splitMainContract(big(state.splitMainBalances)),
  };
  for (const s of state.splits) {
    contracts[s.address] = splitContract({
      params: {
        recipients: [],
        allocations: [],
        totalAllocation: 0n,
        distributionIncentive: 0,
      },
      splitHash: s.splitHash,
      paused: s.paused,
      owner: s.owner,
      balance: BigInt(s.balance),
      warehouseBalance: BigInt(s.warehouseBalance),
    });
  }
  const ovmAddress: Address | null = c.input.payload.ovmAddress;
  const code: Record<string, `0x${string}`> = {};
  const balances: Record<string, bigint> = {};
  if (state.ovm !== null) {
    contracts[state.ovm.address] = ovmContract({
      balance: BigInt(state.ovm.balance),
      fundsPendingWithdrawal: BigInt(state.ovm.fundsPendingWithdrawal),
      amountOfPrincipalStake: BigInt(state.ovm.amountOfPrincipalStake),
      principalThresholdGwei: BigInt(state.ovm.principalThresholdGwei),
      principalRecipient: state.ovm.principalRecipient,
      rewardRecipient: state.ovm.rewardRecipient,
    });
    balances[state.ovm.address] = BigInt(state.ovm.balance);
  } else if (ovmAddress !== null) {
    // Created by the factory, but answers no OVM getter.
    code[ovmAddress] = '0x6080604052';
  }
  return fakeChain({
    contracts,
    code,
    balances,
    logs: ovmAddress !== null ? [ovmCreatedLog(ovmAddress)] : [],
  });
};

describe('vectors: distribution', () => {
  describe('routing', () => {
    it.each<[string, any]>(suite.routing.map((c: any) => [c.name, c]))(
      '%s',
      (_n, c) => {
        const r = ovmRouting({
          balance: BigInt(c.input.balance),
          fundsPendingWithdrawal: BigInt(c.input.fundsPendingWithdrawal),
          amountOfPrincipalStake: BigInt(c.input.amountOfPrincipalStake),
          principalThreshold: thresholdGweiToWei(
            BigInt(c.input.principalThresholdGwei),
          ),
        });
        expect(norm(r)).toEqual({
          distributable: c.distributable,
          principalPayout: c.principalPayout,
          rewardPayout: c.rewardPayout,
        });
      },
    );
  });

  describe('split_distribution', () => {
    it.each<[string, any]>(
      suite.split_distribution.map((c: any) => [c.name, c]),
    )('%s', (_n, c) => {
      const r = splitAmounts(params(c.input.split), BigInt(c.input.amount));
      expect(norm(r)).toEqual({
        amounts: c.amounts,
        distributorReward: c.distributorReward,
      });
    });
  });

  describe('prepare', () => {
    it.each<[string, any]>(suite.prepare.map((c: any) => [c.name, c]))(
      '%s',
      async (_n, c) => {
        const chain = chainFor(c);
        const p = c.input.payload;
        const input = {
          ...(p.ovmAddress !== null ? { ovm: p.ovmAddress } : {}),
          ...(p.rewardSplit !== null
            ? { rewardSplit: params(p.rewardSplit) }
            : {}),
          ...(p.principalSplit !== null
            ? { principalSplit: params(p.principalSplit) }
            : {}),
          ...(p.recipients !== null ? { recipients: p.recipients } : {}),
          ...(p.includeRaf !== undefined ? { includeRaf: p.includeRaf } : {}),
          ...(p.minWithdraw !== undefined
            ? { minWithdraw: BigInt(p.minWithdraw) }
            : {}),
          from: c.input.sender,
        };
        const run = prepareDistribution(chain.context(), input);
        if (!c.accepted) {
          expect((await caught(run)).code).toBe(c.reason);
          return;
        }
        const prepared = await run;
        const calls = norm(
          decodeDistributionCalls(
            prepared.request.data,
            p.ovmAddress ?? undefined,
          ),
        );
        if (REBASELINE) {
          c.calls = calls;
          c.preview = norm(prepared.preview);
          c.checks = prepared.checks.map(f => f.code);
        }
        expect(prepared.request.to).toBe(c.to);
        expect(calls).toEqual(norm(c.calls));
        // Every preview field is compared.
        expect(norm(prepared.preview)).toEqual(norm(c.preview));
        expect(prepared.checks.map(f => f.code)).toEqual(c.checks);
      },
    );
  });
});
