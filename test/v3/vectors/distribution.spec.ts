import { readFileSync } from 'node:fs';
import type { Address } from 'viem';
import { ovmRouting, thresholdGweiToWei } from '../../../src/v3/ovm/routing.js';
import { prepareDistribution } from '../../../src/v3/splits/distribution.js';
import { splitAmounts } from '../../../src/v3/splits/shares.js';
import type { SplitParams } from '../../../src/v3/types.js';
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

// v3 adds `skipReason` (and `blockNumber`) to the preview; the vectors pin the
// fields 2.16 had, so those two are left out of the comparison.
const withoutV3Fields = (preview: any): unknown => {
  const { blockNumber: _b, ...rest } = preview;
  const strip = ({ skipReason: _s, ...o }: any) => o;
  return {
    ...rest,
    ...(rest.ovm !== undefined ? { ovm: strip(rest.ovm) } : {}),
    splits: rest.splits.map(strip),
    recipients: rest.recipients.map(strip),
  };
};

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
          from: c.input.sender,
        };
        const run = prepareDistribution(chain.context(), input);
        if (!c.accepted) {
          expect((await caught(run)).code).toBe(c.reason);
          return;
        }
        const prepared = await run;
        expect(prepared.request.to).toBe(c.to);
        expect(
          norm(
            decodeDistributionCalls(
              prepared.request.data,
              p.ovmAddress ?? undefined,
            ),
          ),
        ).toEqual(norm(c.calls));
        expect(norm(withoutV3Fields(prepared.preview))).toEqual(
          norm(c.preview),
        );
      },
    );
  });
});
