/**
 * simulate, replayed from JSON-RPC exchanges recorded on an anvil Hoodi fork
 * (test/simulate/e2e.spec.ts with SIMULATE_RECORD=1).
 */
import { parseEther, toEventSelector, type Address } from 'viem';
import { CHAINS } from '../../src/chains.js';
import { shortAddress } from '../../src/simulate/analyze.js';
import { formatEth, simulate } from '../../src/simulate/index.js';
import type {
  FullSimulation,
  SimulationBackend,
  StateChange,
} from '../../src/simulate/types.js';
import {
  contextFor,
  loadRecording,
  methodNotFound,
  replayClient,
  rpcError,
  type Recording,
} from './replay.js';

const HOODI = CHAINS[560048].contracts!;
const DEPOSIT_CONTRACT = '0x00000000219ab540356cBB839Cbe05303d7705Fa';
const SCENARIOS = [
  'setup',
  'grantRoles',
  'depositViaOvm',
  'ovmDistribute',
  'splitDistribution',
  'totalSplitDistribution',
  'withdraw',
  'ovmDistributePull',
  'withdrawPullBalance',
  'setPrincipalStake',
  'consolidate',
  'eoaWithdraw',
  'transfer',
];

const run = async (
  recording: Recording,
  backend: Exclude<SimulationBackend, 'eth_call'> = 'eth_simulateV1',
  overrides: Record<string, () => unknown> = {},
  prepared = recording.prepared,
) => {
  const { client, calls } = replayClient(
    recording.backends[backend] ?? [],
    overrides,
  );
  const result = await simulate(contextFor(client), prepared, {
    from: recording.from as Address,
  });
  return { result, calls };
};

const full = async (
  name: string,
  backend: Exclude<SimulationBackend, 'eth_call'> = 'eth_simulateV1',
): Promise<{ sim: FullSimulation; rec: Recording }> => {
  const rec = loadRecording(name);
  const overrides: Record<string, () => unknown> =
    backend === 'debug_traceCall'
      ? { eth_simulateV1: methodNotFound('eth_simulateV1') }
      : {};
  const { result } = await run(rec, backend, overrides);
  expect(result.limited).toBe(false);
  return { sim: result as FullSimulation, rec };
};

const ofKind = <K extends StateChange['kind']>(
  sim: FullSimulation,
  kind: K,
): Array<Extract<StateChange, { kind: K }>> =>
  sim.stateChanges.filter(
    (c): c is Extract<StateChange, { kind: K }> => c.kind === kind,
  );

const eth = (sim: FullSimulation, address: string): bigint | undefined =>
  sim.balanceChanges.find(
    b => b.asset === 'ETH' && b.address.toLowerCase() === address.toLowerCase(),
  )?.delta;

describe('simulate: recorded operations', () => {
  it.each(SCENARIOS)(
    '%s: both full backends agree and match the preview',
    async name => {
      const v1 = (await full(name, 'eth_simulateV1')).sim;
      const trace = (await full(name, 'debug_traceCall')).sim;
      expect(v1.backend).toBe('eth_simulateV1');
      expect(trace.backend).toBe('debug_traceCall');
      expect(v1.success).toBe(true);
      expect(v1.matchesPreview.ok).toBe(true);
      expect(v1.matchesPreview.compared.length).toBeGreaterThan(0);
      expect(v1.findings.map(f => f.code)).toEqual([]);
      for (const key of [
        'summary',
        'balanceChanges',
        'stateChanges',
        'events',
        'matchesPreview',
      ] as const) {
        expect(trace[key]).toEqual(v1[key]);
      }
      expect(v1.gas.used).toBeGreaterThan(21_000n);
    },
  );

  it('ovm.prepareDistribute: principal and reward payouts', async () => {
    const { sim, rec } = await full('ovmDistribute');
    const { OVM: ovm, PRINCIPAL } = rec.meta;
    const reward = (rec.prepared.preview as any).rewardRecipient;
    expect(eth(sim, PRINCIPAL)).toBe(parseEther('32'));
    expect(eth(sim, reward)).toBe(parseEther('1.2'));
    expect(eth(sim, ovm)).toBe(-parseEther('33.2'));
    expect(ofKind(sim, 'value')).toEqual([
      {
        kind: 'value',
        address: ovm,
        name: 'amountOfPrincipalStake',
        before: parseEther('32'),
        after: 0n,
        delta: -parseEther('32'),
      },
    ]);
    expect(sim.events.map(e => e.name)).toEqual([
      'PrincipalStakeAmountUpdated',
      'ReceiveETH',
      'DistributeFunds',
    ]);
    expect(sim.summary).toEqual([
      `OVM ${shortAddress(ovm)} amountOfPrincipalStake: 32.000000 ETH → 0.000000 ETH`,
      `${shortAddress(PRINCIPAL)} (principal recipient) receives 32.000000 ETH`,
      `${shortAddress(reward)} (reward recipient) receives 1.200000 ETH`,
      `${shortAddress(ovm)} (OVM) pays 33.200000 ETH`,
    ]);
    expect(sim.matchesPreview.compared).toEqual(
      expect.arrayContaining(['OVM principal payout', 'OVM reward payout']),
    );
  });

  it('splits.prepareDistribution: split amounts, Warehouse credits and withdrawals', async () => {
    const { sim, rec } = await full('splitDistribution');
    const preview = rec.prepared.preview as any;
    const { R1, R2 } = rec.meta;
    for (const r of [R1, R2]) {
      const row = preview.recipients.find((x: any) => x.address === r);
      // The Warehouse withdrawal: this distribution's credit plus what was
      // already waiting, less the 1 wei the Warehouse keeps.
      expect(eth(sim, r)).toBe(
        row.fromThisDistribution + row.alreadyWaiting - 1n,
      );
      expect(eth(sim, r)).toBeGreaterThan(parseEther('0.59'));
    }
    const warehouse = sim.balanceChanges.filter(
      b => b.asset === 'WAREHOUSE_ETH',
    );
    expect(warehouse.map(b => b.label)).toEqual(
      warehouse.map(b => `warehouse:${b.address}`),
    );
    const raf = warehouse.find(b => b.address === HOODI.rafRecipient);
    expect(raf?.delta).toBe(
      preview.recipients.find((x: any) => x.address === HOODI.rafRecipient)
        .fromRewardSplit,
    );
    expect(sim.events.filter(e => e.name === 'Withdraw')).toHaveLength(2);
    expect(sim.summary).toContain(
      `${shortAddress(R1)} (split recipient) receives 0.594000 ETH`,
    );
    expect(sim.summary).toContain(
      `${shortAddress(HOODI.rafRecipient)} (Obol RAF) is credited ${formatEth(raf!.delta)} in the Warehouse (balance ${formatEth(raf!.after)})`,
    );
  });

  it('ovm.prepareWithdraw: full exit, fee paid and excess refunded', async () => {
    const { sim, rec } = await full('withdraw');
    const { PUBKEY, STRANGER } = rec.meta;
    const preview = rec.prepared.preview as any;
    const [request] = ofKind(sim, 'withdrawalRequest');
    expect(request).toMatchObject({
      source: 'event',
      pubkey: PUBKEY,
      amount: 0n,
      fullExit: true,
    });
    expect(eth(sim, HOODI.withdrawalRequest)).toBe(request.fee);
    expect(eth(sim, STRANGER)).toBe(preview.totalFee - request.fee);
    expect(sim.summary[0]).toBe(
      `Validator ${PUBKEY.slice(0, 10)}…${PUBKEY.slice(-4)} full exit requested (irreversible), fee ${formatEth(request.fee)}`,
    );
    expect(sim.summary[1]).toBe(
      `Excess fee ${formatEth(preview.totalFee - request.fee)} refunded to ${shortAddress(STRANGER)} (excess fee recipient)`,
    );
    expect(sim.matchesPreview.compared).toEqual(
      expect.arrayContaining([
        'fees paid to the predeploy',
        `excess fee refund to ${STRANGER}`,
      ]),
    );
  });

  it('ovm.prepareGrantRoles: the role change', async () => {
    const { sim, rec } = await full('grantRoles');
    const { OVM: ovm, OPERATOR } = rec.meta;
    expect(ofKind(sim, 'roles')).toEqual([
      {
        kind: 'roles',
        address: ovm,
        user: OPERATOR,
        before: 0n,
        after: 3n,
        granted: ['WITHDRAWAL', 'CONSOLIDATION'],
        revoked: [],
      },
    ]);
    expect(sim.balanceChanges).toEqual([]);
    expect(sim.summary).toEqual([
      `Roles WITHDRAWAL, CONSOLIDATION granted to ${shortAddress(OPERATOR)} on OVM ${shortAddress(ovm)}`,
    ]);
  });

  it('deposits.prepareDeposit via the OVM: principal stake rises by the deposit', async () => {
    const { sim, rec } = await full('depositViaOvm');
    const { OVM: ovm, OWNER, PUBKEY } = rec.meta;
    const [deposit] = ofKind(sim, 'deposit');
    expect(deposit).toMatchObject({ pubkey: PUBKEY, amount: parseEther('32') });
    expect(deposit.withdrawalCredentials.toLowerCase()).toBe(
      `0x02${'0'.repeat(22)}${ovm.slice(2).toLowerCase()}`,
    );
    expect(ofKind(sim, 'value')).toEqual([
      expect.objectContaining({
        name: 'amountOfPrincipalStake',
        delta: parseEther('32'),
      }),
    ]);
    expect(eth(sim, OWNER)).toBe(-parseEther('32'));
    expect(eth(sim, DEPOSIT_CONTRACT)).toBe(parseEther('32'));
  });

  it('setup.prepareOvmWithSplits: the created OVM and split', async () => {
    const { sim, rec } = await full('setup');
    const preview = rec.prepared.preview as any;
    const created = ofKind(sim, 'created');
    expect(created.map(c => c.contract)).toEqual(['split', 'ovm']);
    expect(created[0].address).toBe(preview.rewardRecipient.address);
    expect(created[1]).toMatchObject({
      owner: rec.meta.OWNER,
      principalRecipient: rec.meta.PRINCIPAL,
      rewardRecipient: preview.rewardRecipient.address,
      principalThreshold: parseEther('16'),
    });
    // Ownership set in the constructors is not reported as a change.
    expect(ofKind(sim, 'ownership')).toEqual([]);
  });

  it('withdrawals.prepareEoaWithdraw: the request is read from calldata', async () => {
    const { sim, rec } = await full('eoaWithdraw');
    expect(ofKind(sim, 'withdrawalRequest')).toEqual([
      {
        kind: 'withdrawalRequest',
        source: 'calldata',
        via: HOODI.withdrawalRequest,
        pubkey: rec.meta.PUBKEY,
        amount: parseEther('1'),
        fullExit: false,
        fee: rec.prepared.request.value,
      },
    ]);
    // The predeploy's anonymous log, decoded.
    expect(sim.events).toEqual([
      {
        address: HOODI.withdrawalRequest,
        name: 'WithdrawalRequest',
        args: {
          sourceAddress: rec.from,
          validatorPubkey: rec.meta.PUBKEY,
          amountGwei: 1_000_000_000n,
        },
        known: true,
        trusted: true,
      },
    ]);
  });

  it('ovm.prepareConsolidate and prepareTransfer', async () => {
    const consolidate = (await full('consolidate')).sim;
    expect(ofKind(consolidate, 'consolidationRequest')).toHaveLength(1);
    expect(consolidate.summary[0]).toMatch(
      /consolidation into .* requested \(irreversible: its stake moves to the target\)/,
    );
    const { sim, rec } = await full('transfer');
    expect(ofKind(sim, 'ownership')).toEqual([
      {
        kind: 'ownership',
        address: rec.meta.OVM,
        previousOwner: rec.meta.OWNER,
        newOwner: rec.meta.OPERATOR,
      },
    ]);
    expect(ofKind(sim, 'recipient')).toEqual([
      {
        kind: 'recipient',
        address: rec.meta.OVM,
        recipient: 'principal',
        newAddress: rec.meta.R1,
      },
    ]);
  });
});

describe('simulate: reverts', () => {
  it.each(['eth_simulateV1', 'debug_traceCall'] as const)(
    'decodes a custom error (%s)',
    async backend => {
      const { sim } = await full('revertUnauthorized', backend);
      expect(sim.success).toBe(false);
      expect(sim.revertReason).toMatchObject({
        name: 'Unauthorized',
        message: 'Unauthorized()',
        data: '0x82b42900',
      });
      expect(sim.balanceChanges).toEqual([]);
      expect(sim.summary).toEqual(['Reverts: Unauthorized()']);
      expect(sim.matchesPreview.ok).toBe(false);
      expect(sim.findings.map(f => f.code)).toEqual(['SIMULATION_REVERTED']);
    },
  );

  it.each(['eth_simulateV1', 'debug_traceCall'] as const)(
    'reports the inner call of a failing Multicall3 batch (%s)',
    async backend => {
      const { sim, rec } = await full('revertMulticall', backend);
      expect(sim.revertReason).toMatchObject({
        message: 'Multicall3: call failed',
        inner: {
          index: 0,
          target: rec.meta.REWARD_SPLIT,
          reason: { name: 'InvalidSplit' },
        },
      });
      expect(sim.summary).toEqual([
        `Reverts: Multicall3: call failed; call 0 to ${shortAddress(rec.meta.REWARD_SPLIT)} failed with InvalidSplit()`,
      ]);
    },
  );
});

describe('simulate: backends', () => {
  const refuseBoth = {
    eth_simulateV1: methodNotFound('eth_simulateV1'),
    debug_traceCall: methodNotFound('debug_traceCall'),
  };

  it('falls back to eth_call with a SIMULATION_UNAVAILABLE finding', async () => {
    const rec = loadRecording('grantRoles');
    const { client } = replayClient(rec.backends.eth_call!, refuseBoth);
    const sim = await simulate(contextFor(client), rec.prepared, {
      from: rec.from as Address,
    });
    expect(sim).toMatchObject({
      limited: true,
      backend: 'eth_call',
      success: true,
    });
    expect(sim.findings.map(f => f.code)).toEqual(['SIMULATION_UNAVAILABLE']);
    expect('balanceChanges' in sim).toBe(false);
  });

  it('limited: a revert is still decoded', async () => {
    const rec = loadRecording('revertUnauthorized');
    const { client } = replayClient(rec.backends.eth_call!, refuseBoth);
    const sim = await simulate(contextFor(client), rec.prepared, {
      from: rec.from as Address,
    });
    expect(sim).toMatchObject({
      limited: true,
      success: false,
      revertReason: { name: 'Unauthorized' },
      summary: ['Reverts: Unauthorized()'],
    });
  });

  it('detects support once per client', async () => {
    const rec = loadRecording('grantRoles');
    const { client, calls } = replayClient(rec.backends.debug_traceCall!, {
      eth_simulateV1: methodNotFound('eth_simulateV1'),
    });
    const ctx = contextFor(client);
    const options = { from: rec.from as Address };
    await simulate(ctx, rec.prepared, options);
    await simulate(ctx, rec.prepared, options);
    expect(calls.filter(m => m === 'eth_simulateV1')).toHaveLength(1);
    expect(calls.filter(m => m === 'debug_traceCall')).toHaveLength(4);
  });

  it('a forced backend the node lacks is SIMULATION_FAILED', async () => {
    const rec = loadRecording('grantRoles');
    const { client } = replayClient(rec.backends.eth_simulateV1!, {
      debug_traceCall: methodNotFound('debug_traceCall'),
    });
    await expect(
      simulate(contextFor(client), rec.prepared, {
        from: rec.from as Address,
        backend: 'debug_traceCall',
      }),
    ).rejects.toMatchObject({ code: 'SIMULATION_FAILED' });
  });

  it('a transport failure is SIMULATION_FAILED', async () => {
    const rec = loadRecording('grantRoles');
    const { client } = replayClient(rec.backends.eth_simulateV1!, {
      eth_simulateV1: () => {
        throw new Error('socket hang up');
      },
    });
    await expect(
      simulate(contextFor(client), rec.prepared, { from: rec.from as Address }),
    ).rejects.toMatchObject({ code: 'SIMULATION_FAILED' });
  });

  it('eth_call: a transport failure is SIMULATION_FAILED, not a revert', async () => {
    const rec = loadRecording('grantRoles');
    const { client } = replayClient(rec.backends.eth_call!, {
      eth_call: () => {
        throw new Error('socket hang up');
      },
    });
    await expect(
      simulate(contextFor(client), rec.prepared, {
        from: rec.from as Address,
        backend: 'eth_call',
      }),
    ).rejects.toMatchObject({ code: 'SIMULATION_FAILED' });
  });

  it('eth_call: a node error that is not a revert is SIMULATION_FAILED', async () => {
    const rec = loadRecording('grantRoles');
    const { client } = replayClient(rec.backends.eth_call!, {
      eth_call: () => {
        throw rpcError({ code: -32000, message: 'header not found' });
      },
    });
    await expect(
      simulate(contextFor(client), rec.prepared, {
        from: rec.from as Address,
        backend: 'eth_call',
      }),
    ).rejects.toMatchObject({ code: 'SIMULATION_FAILED' });
  });

  it('a contract-wallet sender gets SIMULATION_CONTRACT_WALLET', async () => {
    const rec = loadRecording('grantRoles');
    const { result } = await run(rec, 'eth_simulateV1', {
      eth_getCode: () => '0x6080604052',
    });
    expect(result.findings.map(f => f.code)).toEqual([
      'SIMULATION_CONTRACT_WALLET',
    ]);
  });
});

describe('simulate: preview comparison', () => {
  it('reports a preview that disagrees with the simulation', async () => {
    const rec = loadRecording('ovmDistribute');
    const preview = rec.prepared.preview as any;
    const tampered = {
      ...rec.prepared,
      preview: { ...preview, principalPayout: preview.principalPayout + 1n },
    };
    const { result } = await run(rec, 'eth_simulateV1', {}, tampered);
    const sim = result as FullSimulation;
    expect(sim.matchesPreview.ok).toBe(false);
    expect(sim.matchesPreview.differences).toEqual([
      `OVM principal payout: preview ${preview.principalPayout + 1n}, simulation ${preview.principalPayout}`,
      `amountOfPrincipalStake change: preview ${-(preview.principalPayout + 1n)}, simulation ${-preview.principalPayout}`,
      `ETH to ${preview.principalRecipient.toLowerCase()}: preview ${preview.principalPayout + 1n}, simulation ${preview.principalPayout}`,
    ]);
    expect(sim.findings.map(f => f.code)).toEqual([
      'SIMULATION_PREVIEW_MISMATCH',
    ]);
  });

  it('a preview with nothing comparable compares nothing', async () => {
    const rec = loadRecording('grantRoles');
    const { result } = await run(
      rec,
      'eth_simulateV1',
      {},
      {
        ...rec.prepared,
        preview: undefined as never,
      },
    );
    expect((result as FullSimulation).matchesPreview).toEqual({
      ok: true,
      differences: [],
      compared: [],
    });
  });
});

describe('simulate: input checks', () => {
  const rec = loadRecording('grantRoles');
  const ctx = (): ReturnType<typeof contextFor> =>
    contextFor(replayClient(rec.backends.eth_simulateV1!).client);

  it('PREPARED_INVALID for something that is not a prepared transaction', async () => {
    await expect(
      simulate(ctx(), { request: {} } as any, { from: rec.from as Address }),
    ).rejects.toMatchObject({ code: 'PREPARED_INVALID' });
  });

  it('CHAIN_MISMATCH for another chain', async () => {
    await expect(
      simulate(
        ctx(),
        { ...rec.prepared, request: { ...rec.prepared.request, chainId: 1 } },
        { from: rec.from as Address },
      ),
    ).rejects.toMatchObject({ code: 'CHAIN_MISMATCH' });
  });

  it('PAYLOAD_INVALID without a sender', async () => {
    await expect(simulate(ctx(), rec.prepared)).rejects.toMatchObject({
      code: 'PAYLOAD_INVALID',
    });
    await expect(
      simulate(ctx(), rec.prepared, { from: '0x1234' as Address }),
    ).rejects.toMatchObject({ code: 'PAYLOAD_INVALID' });
  });
});

describe('formatEth', () => {
  it.each([
    [0n, '0.000000 ETH'],
    [1n, '1 wei'],
    [-999_999_999_999n, '-999999999999 wei'],
    [1_000_000_000_000n, '0.000001 ETH'],
    [parseEther('3.2'), '3.200000 ETH'],
    [parseEther('0.5939999999'), '0.594000 ETH'],
    [parseEther('0.0000014999'), '0.000001 ETH'],
    [-parseEther('32'), '-32.000000 ETH'],
  ])('%s → %s', (wei, text) => {
    expect(formatEth(wei)).toBe(text);
  });
});

describe('simulate: auto fallback', () => {
  it('eth_simulateV1 rejecting the parameters falls back to debug_traceCall', async () => {
    const rec = loadRecording('grantRoles');
    const { client, calls } = replayClient(rec.backends.debug_traceCall!, {
      eth_simulateV1: () => {
        throw rpcError({ code: -32602, message: 'invalid argument 0' });
      },
    });
    const ctx = contextFor(client);
    const sim = await simulate(ctx, rec.prepared, {
      from: rec.from as Address,
    });
    expect(sim).toMatchObject({ limited: false, backend: 'debug_traceCall' });
    await simulate(ctx, rec.prepared, { from: rec.from as Address });
    // Invalid params: not asked again.
    expect(calls.filter(m => m === 'eth_simulateV1')).toHaveLength(1);
  });

  it('another error answer falls back too, and is asked again next time', async () => {
    const rec = loadRecording('grantRoles');
    const { client, calls } = replayClient(rec.backends.debug_traceCall!, {
      eth_simulateV1: () => {
        throw rpcError({
          code: -32000,
          message: 'traceTransfers not supported',
        });
      },
    });
    const ctx = contextFor(client);
    await simulate(ctx, rec.prepared, { from: rec.from as Address });
    const sim = await simulate(ctx, rec.prepared, {
      from: rec.from as Address,
    });
    expect(sim.backend).toBe('debug_traceCall');
    expect(calls.filter(m => m === 'eth_simulateV1')).toHaveLength(2);
  });

  it('both full backends rejecting gives a limited result naming why', async () => {
    const rec = loadRecording('grantRoles');
    const { client } = replayClient(rec.backends.eth_call!, {
      eth_simulateV1: () => {
        throw rpcError({ code: -32602, message: 'invalid argument 0' });
      },
      debug_traceCall: methodNotFound('debug_traceCall'),
    });
    const sim = await simulate(contextFor(client), rec.prepared, {
      from: rec.from as Address,
    });
    expect(sim.limited).toBe(true);
    const [unavailable] = sim.findings;
    expect(unavailable.code).toBe('SIMULATION_UNAVAILABLE');
    expect(unavailable.details).toMatchObject({
      tried: ['eth_simulateV1', 'debug_traceCall'],
    });
    expect(unavailable.message).toContain('invalid argument 0');
  });

  it('a forced backend rejecting the parameters is SIMULATION_FAILED', async () => {
    const rec = loadRecording('grantRoles');
    const { client } = replayClient(rec.backends.debug_traceCall!, {
      eth_simulateV1: () => {
        throw rpcError({ code: -32602, message: 'invalid argument 0' });
      },
    });
    await expect(
      simulate(contextFor(client), rec.prepared, {
        from: rec.from as Address,
        backend: 'eth_simulateV1',
      }),
    ).rejects.toMatchObject({ code: 'SIMULATION_FAILED' });
  });
});

describe('simulate: untrusted events', () => {
  it('a Warehouse-shaped Withdraw from an unknown contract is not a payout', async () => {
    const rec = loadRecording('splitDistribution');
    const exchanges = structuredClone(rec.backends.eth_simulateV1!);
    // The first simulation (one call) carries the logs simulate interprets.
    const first = exchanges.find(
      e =>
        e.method === 'eth_simulateV1' &&
        (e.params[0] as any).blockStateCalls[0].calls.length === 1,
    )!;
    const logs = (first.result as any)[0].calls[0].logs as any[];
    const topic = toEventSelector(
      'Withdraw(address,address,address,uint256,uint256)',
    );
    const withdraw = logs.find(
      l =>
        l.address.toLowerCase() === HOODI.warehouse.toLowerCase() &&
        l.topics[0] === topic,
    );
    const FAKE = '0x00000000000000000000000000000000deadbeef';
    logs.push({ ...withdraw, address: FAKE });
    const { client } = replayClient(exchanges);
    const sim = (await simulate(contextFor(client), rec.prepared, {
      from: rec.from as Address,
    })) as FullSimulation;
    const plain = (await full('splitDistribution')).sim;
    const fake = sim.events.find(e => e.address.toLowerCase() === FAKE);
    expect(fake).toMatchObject({
      name: 'Withdraw',
      known: true,
      trusted: false,
    });
    expect(
      sim.events.filter(e => e.name === 'Withdraw' && e.trusted),
    ).toHaveLength(2);
    expect(sim.balanceChanges).toEqual(plain.balanceChanges);
    expect(sim.stateChanges).toEqual(plain.stateChanges);
    expect(sim.matchesPreview).toEqual(plain.matchesPreview);
    expect(sim.summary.slice(0, -1)).toEqual(plain.summary);
    expect(sim.summary[sim.summary.length - 1]).toMatch(
      /^Unrecognised contract 0x0000…Beef emitted Withdraw\(/,
    );
    expect(sim.findings.map(f => f.code)).toEqual([
      'SIMULATION_UNTRUSTED_EVENT',
    ]);
    expect(plain.events.every(e => e.trusted)).toBe(true);
  });
});

describe('simulate: block and distributor reward', () => {
  it('a mismatch after the state moved says so', async () => {
    const rec = loadRecording('ovmDistribute');
    const preview = rec.prepared.preview as any;
    const tampered = {
      ...rec.prepared,
      blockNumber: (rec.prepared.blockNumber as bigint) - 5n,
      preview: { ...preview, rewardPayout: preview.rewardPayout - 1n },
    };
    const { result } = await run(rec, 'eth_simulateV1', {}, tampered);
    // Simulated on the latest block, not the prepared one.
    expect(result.blockNumber).toBe(rec.prepared.blockNumber);
    const [mismatch] = result.findings;
    expect(mismatch.code).toBe('SIMULATION_PREVIEW_MISMATCH');
    expect(mismatch.message).toContain('the state moved since prepare');
    expect(mismatch.details).toMatchObject({ stateMoved: true });
  });

  it('the distributor row of a distribution preview carries its incentive', async () => {
    const { sim, rec } = await full('totalSplitDistribution');
    const preview = rec.prepared.preview as any;
    const row = preview.recipients.find((r: any) => r.address === rec.from);
    expect(row.distributorReward).toBe(
      preview.splits.reduce((a: bigint, s: any) => a + s.distributorReward, 0n),
    );
    expect(row.distributorReward).toBeGreaterThan(0n);
    expect(sim.matchesPreview.compared).toContain(
      `${rec.from} distributor reward`,
    );
    const credit = sim.balanceChanges.find(
      b => b.asset === 'WAREHOUSE_ETH' && b.address === rec.from,
    );
    expect(credit?.delta).toBe(row.distributorReward);
  });
});
