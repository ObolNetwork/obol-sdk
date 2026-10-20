/**
 * Opt-in integration test of `simulate` against an anvil fork of Hoodi:
 *
 *   anvil --fork-url https://ethereum-hoodi-rpc.publicnode.com --port 18645
 *   SIMULATE_E2E=1 SIMULATE_RPC_URL=http://127.0.0.1:18645 \
 *     NODE_OPTIONS=--experimental-vm-modules npx jest test/simulate/e2e.spec.ts
 *
 * It creates an OVM with a reward split, grants roles, deposits, funds the
 * OVM and simulates each operation with eth_simulateV1, debug_traceCall and
 * eth_call, checking the two full backends agree and match the previews.
 * With SIMULATE_RECORD=1 it also writes the exchanges the unit tests replay
 * (test/simulate/fixtures). Skipped unless SIMULATE_E2E=1.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { jest } from '@jest/globals';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { bytesToHex } from '@noble/curves/utils.js';
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseEther,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { hoodi } from 'viem/chains';
import { NATIVE_TOKEN, multicall3Abi, splitWalletAbi } from '../../src/abi.js';
import { CHAINS } from '../../src/chains.js';
import { createObolClient } from '../../src/client.js';
import { depositDataRoot } from '../../src/deposits/verifyDepositData.js';
import {
  depositDomainForFork,
  depositSigningRoot,
} from '../../src/internal/verification/common.js';
import { OVM_ROLES } from '../../src/ovm/routing.js';
import type { FullSimulation, Simulation } from '../../src/simulate/types.js';
import type { Deposit, Prepared } from '../../src/types.js';
import { blsSign, FORK_HOODI, randomScalar } from '../helpers/syntheticLock.js';
import { FIXTURES, rpcError, toJson, type Exchange } from './replay.js';

const RPC = process.env.SIMULATE_RPC_URL ?? 'http://127.0.0.1:18645';
const enabled = process.env.SIMULATE_E2E === '1';
const record = process.env.SIMULATE_RECORD === '1';
const run = enabled ? describe : describe.skip;

const HOODI = CHAINS[560048].contracts!;
const actor = (name: string): Address =>
  getAddress(keccak256(toHex(`obol-sdk simulate ${name}`)).slice(0, 42));
const OWNER = actor('owner');
const OPERATOR = actor('operator');
const STRANGER = actor('stranger');
const PRINCIPAL = actor('principal');
const R1 = actor('recipient 1');
const R2 = actor('recipient 2');

let id = 0;
const sleep = async (ms: number): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, ms));
};

/** One JSON-RPC request; retries the fork's upstream rate limits (HTTP 429). */
const upstream = async (method: string, params: unknown): Promise<any> => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await once(method, params);
    } catch (error: any) {
      if (attempt >= 8 || !String(error.message).includes('429')) throw error;
      await sleep(2_000 * (attempt + 1));
    }
  }
};

const once = async (method: string, params: unknown): Promise<any> => {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  const json = await response.json();
  if (json.error !== undefined) throw rpcError(json.error);
  return json.result;
};

let log: Exchange[] | null = null;
const transport = custom(
  {
    request: async ({ method, params }) => {
      try {
        const result = await upstream(method, params);
        log?.push({ method, params: params ?? [], result });
        return result;
      } catch (error: any) {
        log?.push({
          method,
          params: params ?? [],
          error: {
            code: error.code,
            message: error.message,
            ...(error.data !== undefined ? { data: error.data } : {}),
          },
        });
        throw error;
      }
    },
  },
  { retryCount: 0 },
);

const publicClient = createPublicClient({
  chain: hoodi,
  transport,
  // Every simulate call asks for the block itself, so the recordings have it.
  cacheTime: 0,
}) as PublicClient;
const obol = createObolClient({ chain: hoodi, publicClient, api: false });

const sendAs = async (from: Address, prepared: Prepared<unknown>) => {
  await upstream('anvil_impersonateAccount', [from]);
  const wallet = createWalletClient({ account: from, chain: hoodi, transport });
  const hash = await wallet.sendTransaction({
    account: from,
    chain: hoodi,
    to: prepared.request.to,
    data: prepared.request.data,
    value: prepared.request.value,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe('success');
  return receipt;
};

/** Drops what simulate does not read (block headers, call inputs), to keep fixtures small. */
const trim = (exchange: Exchange): void => {
  const r: any = exchange.result;
  if (exchange.method === 'eth_simulateV1' && Array.isArray(r)) {
    exchange.result = r.map((block: any) => ({
      calls: block.calls.map((c: any) => ({
        status: c.status,
        returnData: c.returnData,
        gasUsed: c.gasUsed,
        ...(c.error !== undefined ? { error: c.error } : {}),
        logs: (c.logs ?? []).map((l: any) => ({
          address: l.address,
          topics: l.topics,
          data: l.data,
        })),
      })),
    }));
  }
  if (exchange.method === 'debug_traceCall' && r?.pre !== undefined) {
    for (const account of Object.values(r.pre) as any[]) delete account.code;
  }
  if (exchange.method === 'debug_traceCall' && r?.type !== undefined) {
    const strip = (frame: any): void => {
      delete frame.input;
      delete frame.gas;
      if (frame.error === undefined) delete frame.output;
      (frame.calls ?? []).forEach(strip);
    };
    strip(r);
  }
};

const BACKENDS = ['eth_simulateV1', 'debug_traceCall', 'eth_call'] as const;

/** Simulates with every backend, checks they agree, records the exchanges. */
const simulateAll = async (
  name: string,
  prepared: Prepared<unknown>,
  from: Address,
  meta: Record<string, string>,
): Promise<FullSimulation> => {
  const results: Partial<Record<(typeof BACKENDS)[number], Simulation>> = {};
  const exchanges: Record<string, Exchange[]> = {};
  for (const backend of BACKENDS) {
    log = [];
    results[backend] = await obol.simulate(prepared, { from, backend });
    exchanges[backend] = log;
    log = null;
  }
  const v1 = results.eth_simulateV1 as FullSimulation;
  const trace = results.debug_traceCall as FullSimulation;
  const call = results.eth_call!;
  expect(v1.limited).toBe(false);
  expect(trace.limited).toBe(false);
  expect(call.limited).toBe(true);
  expect(call.success).toBe(v1.success);
  expect(trace.success).toBe(v1.success);
  expect(trace.summary).toEqual(v1.summary);
  expect(trace.balanceChanges).toEqual(v1.balanceChanges);
  expect(trace.stateChanges).toEqual(v1.stateChanges);
  expect(trace.events).toEqual(v1.events);
  expect(trace.matchesPreview).toEqual(v1.matchesPreview);
  if (record) {
    for (const list of Object.values(exchanges)) list.forEach(trim);
    mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(
      `${FIXTURES}/${name}.json`,
      toJson({ name, from, prepared, meta, backends: exchanges }) + '\n',
    );
  }
  // Printed for the record of what each operation simulates to.
  console.log(
    `${name}:\n  ${v1.summary.join('\n  ')}\n  matchesPreview: ${JSON.stringify(v1.matchesPreview.differences)}`,
  );
  return v1;
};

const depositFor = (ovm: Address): Deposit => {
  const secret = randomScalar();
  const pubkey =
    `0x${bytesToHex(bls12_381.G1.Point.BASE.multiply(secret).toBytes())}` as Hex;
  const withdrawalCredentials =
    `0x02${'0'.repeat(22)}${ovm.slice(2).toLowerCase()}` as Hex;
  const amountGwei = 32_000_000_000n;
  const signature = blsSign(
    depositSigningRoot(
      {
        pubkey,
        withdrawal_credentials: withdrawalCredentials,
        amount: amountGwei.toString(),
      } as any,
      depositDomainForFork(FORK_HOODI),
    ),
    secret,
  ) as Hex;
  return {
    pubkey,
    withdrawalCredentials,
    signature,
    depositDataRoot: depositDataRoot({
      pubkey,
      withdrawalCredentials,
      amountGwei,
      signature,
    }),
    amount: amountGwei * 1_000_000_000n,
  };
};

jest.setTimeout(600_000);

run('simulate on an anvil Hoodi fork', () => {
  const meta: Record<string, string> = {};
  let ovm: Address;
  let rewardSplit: Address;
  let pubkey: Hex;

  beforeAll(async () => {
    for (const a of [OWNER, OPERATOR, STRANGER]) {
      await upstream('anvil_setBalance', [a, toHex(parseEther('100'))]);
    }
    Object.assign(meta, { OWNER, OPERATOR, STRANGER, PRINCIPAL, R1, R2 });
  });

  it('setup.prepareOvmWithSplits', async () => {
    const input = obol.setup.rewardsSplit({
      owner: OWNER,
      principalRecipient: PRINCIPAL,
      recipients: [
        { address: R1, share: 495_000 },
        { address: R2, share: 495_000 },
      ],
      salt: keccak256(toHex(`simulate ${Date.now()}`)),
    });
    const prepared = await obol.setup.prepareOvmWithSplits(input);
    const sim = await simulateAll('setup', prepared, OWNER, meta);
    expect(sim.success).toBe(true);
    expect(sim.matchesPreview).toMatchObject({ ok: true });
    const receipt = await sendAs(OWNER, prepared);
    ovm = obol.setup.ovmFromReceipt(receipt).ovm;
    rewardSplit = prepared.preview.rewardRecipient.address;
    meta.OVM = ovm;
    meta.REWARD_SPLIT = rewardSplit;
    expect(sim.stateChanges).toContainEqual(
      expect.objectContaining({
        kind: 'created',
        contract: 'ovm',
        address: ovm,
      }),
    );
  });

  it('ovm.prepareGrantRoles, and a revert from a stranger', async () => {
    const prepared = await obol.ovm.prepareGrantRoles({
      ovm,
      user: OPERATOR,
      roles: OVM_ROLES.CONSOLIDATION | OVM_ROLES.WITHDRAWAL,
      from: OWNER,
    });
    const sim = await simulateAll('grantRoles', prepared, OWNER, meta);
    expect(sim.matchesPreview).toMatchObject({ ok: true });
    const reverted = await simulateAll(
      'revertUnauthorized',
      prepared,
      STRANGER,
      meta,
    );
    expect(reverted.success).toBe(false);
    expect(reverted.revertReason?.name).toBe('Unauthorized');
    await sendAs(OWNER, prepared);
  });

  it('deposits.prepareDeposit via the OVM', async () => {
    const deposit = depositFor(ovm);
    pubkey = deposit.pubkey;
    meta.PUBKEY = pubkey;
    const [prepared] = await obol.deposits.prepareDeposit({
      deposits: [deposit],
      via: { ovm },
      from: OWNER,
    });
    const sim = await simulateAll('depositViaOvm', prepared, OWNER, meta);
    expect(sim.matchesPreview).toMatchObject({ ok: true });
    await sendAs(OWNER, prepared);
  });

  it('ovm.prepareDistribute and splits.prepareDistribution', async () => {
    await upstream('anvil_setBalance', [ovm, toHex(parseEther('33.2'))]);
    const distribute = await obol.ovm.prepareDistribute({ ovm });
    const sim = await simulateAll('ovmDistribute', distribute, STRANGER, meta);
    expect(sim.matchesPreview).toMatchObject({ ok: true });

    const { rewardSplit: params } = obol.setup.ovmSplitParams({
      kind: 'rewards',
      rewardRecipients: [
        { address: R1, share: 495_000 },
        { address: R2, share: 495_000 },
      ],
    });
    const distribution = await obol.splits.prepareDistribution({
      ovm,
      rewardSplit: params,
      from: OPERATOR,
    });
    const split = await simulateAll(
      'splitDistribution',
      distribution,
      OPERATOR,
      meta,
    );
    expect(split.matchesPreview).toMatchObject({ ok: true });

    // A batch whose split call fails: the inner error is reported.
    const wrong = {
      ...params,
      allocations: [...params.allocations].reverse(),
    };
    const bad: Prepared<Record<string, never>> = {
      request: {
        to: HOODI.multicall3,
        data: encodeFunctionData({
          abi: multicall3Abi,
          functionName: 'aggregate3',
          args: [
            [
              {
                target: rewardSplit,
                allowFailure: false,
                callData: encodeFunctionData({
                  abi: splitWalletAbi,
                  functionName: 'distribute',
                  args: [wrong, NATIVE_TOKEN, OPERATOR],
                }),
              },
            ],
          ],
        }),
        value: 0n,
        chainId: 560048,
      },
      checks: [],
      preview: {},
      blockNumber: distribution.blockNumber,
    };
    const reverted = await simulateAll('revertMulticall', bad, OPERATOR, meta);
    expect(reverted.revertReason?.inner?.reason.name).toBe('InvalidSplit');
  });

  it('ovm.prepareWithdraw with a fee refund', async () => {
    const prepared = await obol.ovm.prepareWithdraw({
      ovm,
      requests: [{ pubkey, amount: 0n }],
      acknowledgeFullExit: true,
      excessFeeRecipient: STRANGER,
      from: OPERATOR,
    });
    const sim = await simulateAll('withdraw', prepared, OPERATOR, meta);
    expect(sim.matchesPreview).toMatchObject({ ok: true });
  });

  it('pull distribution, withdrawPullBalance, principal stake, consolidate, EOA withdraw, transfer', async () => {
    const pull = await obol.ovm.prepareDistribute({ ovm, mode: 'pull' });
    const sim = await simulateAll('ovmDistributePull', pull, STRANGER, meta);
    expect(sim.matchesPreview).toMatchObject({ ok: true });
    await sendAs(STRANGER, pull);

    const withdrawPull = await obol.ovm.prepareWithdrawPullBalance({
      ovm,
      account: PRINCIPAL,
    });
    expect(
      (await simulateAll('withdrawPullBalance', withdrawPull, STRANGER, meta))
        .matchesPreview,
    ).toMatchObject({ ok: true });

    const stake = await obol.ovm.prepareSetAmountOfPrincipalStake({
      ovm,
      amount: parseEther('64'),
      from: OWNER,
    });
    expect(
      (await simulateAll('setPrincipalStake', stake, OWNER, meta))
        .matchesPreview,
    ).toMatchObject({ ok: true });

    const target = depositFor(ovm).pubkey;
    const consolidate = await obol.ovm.prepareConsolidate({
      ovm,
      requests: [{ sources: [pubkey], target }],
      acknowledgeStakeMovesToTarget: true,
      from: OPERATOR,
    });
    expect(
      (await simulateAll('consolidate', consolidate, OPERATOR, meta))
        .matchesPreview,
    ).toMatchObject({ ok: true });

    const eoa = await obol.withdrawals.prepareEoaWithdraw({
      pubkey,
      amount: parseEther('1'),
      from: STRANGER,
    });
    expect(
      (await simulateAll('eoaWithdraw', eoa, STRANGER, meta)).matchesPreview,
    ).toMatchObject({ ok: true });

    const transfer = await obol.ovm.prepareTransfer({
      ovm,
      newBeneficiary: R1,
      newOwner: OPERATOR,
      from: OWNER,
    });
    expect(
      (await simulateAll('transfer', transfer, OWNER, meta)).matchesPreview,
    ).toMatchObject({ ok: true });
  });

  it('splits.prepareDistribution: total split with a distribution incentive', async () => {
    const recipients = [
      { address: R1, share: 495_000 },
      { address: R2, share: 495_000 },
    ];
    const input = obol.setup.totalSplit({
      owner: OWNER,
      recipients,
      distributionIncentive: 10_000,
      salt: keccak256(toHex(`simulate total ${Date.now()}`)),
    });
    const created = await sendAs(
      OWNER,
      await obol.setup.prepareOvmWithSplits(input),
    );
    const total = obol.setup.ovmFromReceipt(created).ovm;
    await sendAs(
      OWNER,
      await obol.ovm.prepareSetAmountOfPrincipalStake({
        ovm: total,
        amount: parseEther('32'),
        from: OWNER,
      }),
    );
    await upstream('anvil_setBalance', [total, toHex(parseEther('33.2'))]);
    const { rewardSplit: reward, principalSplit } = obol.setup.ovmSplitParams({
      kind: 'total',
      rewardRecipients: recipients,
      distributionIncentive: 10_000,
    });
    const prepared = await obol.splits.prepareDistribution({
      ovm: total,
      rewardSplit: reward,
      principalSplit,
      from: OPERATOR,
    });
    const sim = await simulateAll(
      'totalSplitDistribution',
      prepared,
      OPERATOR,
      { ...meta, OVM: total },
    );
    expect(sim.matchesPreview).toMatchObject({ ok: true });
  });
});
