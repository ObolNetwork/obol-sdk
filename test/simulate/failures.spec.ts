// simulate when the node fails: which request failing gives which
// SIMULATION_FAILED (never a result that reads as "no change"), a forced
// backend against the automatic choice, and a failed inner-call lookup.
import type { Address } from 'viem';
import { simulate } from '../../src/simulate/index.js';
import type {
  FullSimulation,
  SimulateOptions,
} from '../../src/simulate/types.js';
import {
  contextFor,
  loadRecording,
  replayClient,
  rpcError,
  type Recording,
} from './replay.js';

type Full = 'eth_simulateV1' | 'debug_traceCall';

const HINT = 'Retry, simulate at the latest block, or use another RPC';

const hangUp = (): never => {
  throw new Error('socket hang up');
};
const headerNotFound = (): never => {
  throw rpcError({ code: -32000, message: 'header not found' });
};

/** The recording with the picked exchanges answered by an RPC error. */
const failingAt = (
  rec: Recording,
  backend: Full,
  pick: (method: string, result: any) => boolean,
): Recording => ({
  ...rec,
  backends: {
    ...rec.backends,
    [backend]: (rec.backends[backend] ?? []).map(e =>
      pick(e.method, e.result)
        ? {
            method: e.method,
            params: e.params,
            error: { code: -32000, message: 'missing trie node' },
          }
        : { ...e },
    ),
  },
});

const attempt = async (
  rec: Recording,
  backend: Full,
  overrides: Record<string, () => unknown> = {},
  options: SimulateOptions = {},
): Promise<{ result?: any; error?: any; calls: string[] }> => {
  const { client, calls } = replayClient(
    rec.backends[backend] ?? [],
    overrides,
  );
  try {
    const result = await simulate(contextFor(client), rec.prepared, {
      from: rec.from as Address,
      ...options,
    });
    return { result, calls };
  } catch (error) {
    return { error, calls };
  }
};

const failure = (error: any): object => ({
  code: error.code,
  message: error.message,
  hint: error.hint,
  details: error.details,
});

describe('simulate: node failures', () => {
  const rec = loadRecording('grantRoles');

  it('a failed block number read is SIMULATION_FAILED, before anything else is asked', async () => {
    const { error, calls } = await attempt(rec, 'eth_simulateV1', {
      eth_blockNumber: hangUp,
    });
    expect(failure(error)).toEqual({
      code: 'SIMULATION_FAILED',
      message: 'eth_call failed: socket hang up',
      hint: HINT,
      details: { backend: 'eth_call' },
    });
    expect(calls).toEqual(['eth_blockNumber']);
  });

  it('a failed read of the sender code is SIMULATION_FAILED, before the simulation', async () => {
    const { error, calls } = await attempt(rec, 'eth_simulateV1', {
      eth_getCode: hangUp,
    });
    expect(failure(error)).toEqual({
      code: 'SIMULATION_FAILED',
      message: 'eth_call failed: socket hang up',
      hint: HINT,
      details: { backend: 'eth_call' },
    });
    expect(calls).toEqual(['eth_blockNumber', 'eth_getCode']);
  });

  it('a given blockNumber is used without asking for the latest', async () => {
    const latest = await attempt(rec, 'eth_simulateV1');
    expect(latest.error).toBeUndefined();
    expect(latest.calls[0]).toBe('eth_blockNumber');
    const given = await attempt(
      rec,
      'eth_simulateV1',
      {},
      { blockNumber: latest.result.blockNumber },
    );
    expect(given.calls).toEqual(latest.calls.slice(1));
    expect(given.result).toEqual(latest.result);
    const named = await attempt(
      rec,
      'eth_simulateV1',
      {},
      { blockNumber: 'latest' },
    );
    expect(named.calls).toEqual(latest.calls);
    expect(named.result).toEqual(latest.result);
  });

  it.each<[Full, string, () => never, string]>([
    ['eth_simulateV1', 'a transport failure', hangUp, 'socket hang up'],
    ['debug_traceCall', 'a transport failure', hangUp, 'socket hang up'],
    ['debug_traceCall', 'an RPC error', headerNotFound, 'header not found'],
  ])(
    'a forced %s failing with %s is SIMULATION_FAILED and no other backend is tried',
    async (backend, _what, fail, message) => {
      const { error, calls } = await attempt(
        rec,
        backend,
        { [backend]: fail },
        { backend },
      );
      expect(failure(error)).toEqual({
        code: 'SIMULATION_FAILED',
        message: `${backend} failed: ${message}`,
        hint: HINT,
        details: { backend },
      });
      expect(calls).toEqual(['eth_blockNumber', 'eth_getCode', backend]);
    },
  );

  it('a forced backend the node lacks says so, and names the way out', async () => {
    const { error, calls } = await attempt(
      rec,
      'eth_simulateV1',
      {
        debug_traceCall: () => {
          throw rpcError({
            code: -32601,
            message: 'the method debug_traceCall does not exist',
          });
        },
      },
      { backend: 'debug_traceCall' },
    );
    expect(failure(error)).toEqual({
      code: 'SIMULATION_FAILED',
      message: 'The node does not support debug_traceCall',
      hint: "Use backend: 'auto'",
      details: { backend: 'debug_traceCall' },
    });
    expect(calls).toEqual([
      'eth_blockNumber',
      'eth_getCode',
      'debug_traceCall',
    ]);
  });

  it('auto: an RPC error skips to the next backend, whose transport failure is thrown', async () => {
    const { error, calls } = await attempt(rec, 'debug_traceCall', {
      eth_simulateV1: headerNotFound,
      debug_traceCall: hangUp,
    });
    expect(failure(error)).toEqual({
      code: 'SIMULATION_FAILED',
      message: 'debug_traceCall failed: socket hang up',
      hint: HINT,
      details: { backend: 'debug_traceCall' },
    });
    expect(calls).toEqual([
      'eth_blockNumber',
      'eth_getCode',
      'eth_simulateV1',
      'debug_traceCall',
    ]);
  });

  it('auto: both full backends answering with RPC errors gives the limited result naming both', async () => {
    const eth = loadRecording('grantRoles');
    const { client } = replayClient(eth.backends.eth_call ?? [], {
      eth_simulateV1: headerNotFound,
      debug_traceCall: () => {
        throw rpcError({ code: -32000, message: 'tracing is disabled' });
      },
    });
    const result = await simulate(contextFor(client), eth.prepared, {
      from: eth.from as Address,
    });
    expect(result.limited).toBe(true);
    expect(result.backend).toBe('eth_call');
    expect(result.success).toBe(true);
    expect(result.summary).toEqual([
      'Succeeds (eth_call only: balance changes and events were not simulated)',
    ]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      code: 'SIMULATION_UNAVAILABLE',
      message:
        'Neither eth_simulateV1 nor debug_traceCall could simulate the request on this node (eth_simulateV1: header not found; debug_traceCall: tracing is disabled), so only success or revert was checked (eth_call)',
      details: {
        tried: ['eth_simulateV1', 'debug_traceCall'],
        skipped: [
          { backend: 'eth_simulateV1', reason: 'header not found' },
          { backend: 'debug_traceCall', reason: 'tracing is disabled' },
        ],
      },
    });
  });

  it('a before / after read the node refuses outright is SIMULATION_FAILED', async () => {
    const { error, calls } = await attempt(
      failingAt(
        rec,
        'eth_simulateV1',
        (method, result) =>
          method === 'eth_simulateV1' && result?.[0].calls.length === 3,
      ),
      'eth_simulateV1',
    );
    expect(failure(error)).toEqual({
      code: 'SIMULATION_FAILED',
      message: 'eth_simulateV1 failed: missing trie node',
      hint: HINT,
      details: { backend: 'eth_simulateV1' },
    });
    expect(calls).toEqual([
      'eth_blockNumber',
      'eth_getCode',
      'eth_simulateV1',
      'eth_simulateV1',
    ]);
  });

  it('a failed inner-call lookup still reports the outer revert', async () => {
    const batch = loadRecording('revertMulticall');
    let seen = 0;
    const { result, error } = await attempt(
      failingAt(batch, 'eth_simulateV1', method => {
        if (method !== 'eth_simulateV1') return false;
        seen += 1;
        return seen === 2;
      }),
      'eth_simulateV1',
    );
    expect(error).toBeUndefined();
    const sim = result as FullSimulation;
    expect(sim.success).toBe(false);
    expect(sim.limited).toBe(false);
    expect(sim.backend).toBe('eth_simulateV1');
    expect(sim.revertReason).toMatchObject({
      name: 'Error',
      message: 'Multicall3: call failed',
    });
    expect(sim.revertReason).not.toHaveProperty('inner');
    expect(sim.summary).toEqual(['Reverts: Multicall3: call failed']);
    expect(sim.findings.map(f => f.code)).toEqual(['SIMULATION_REVERTED']);
    expect(sim.findings[0].message).toBe(
      'The transaction reverts when simulated: Multicall3: call failed',
    );
    expect(sim.balanceChanges).toEqual([]);
    expect(sim.events).toEqual([]);
    expect(sim.stateChanges).toEqual([]);
    expect(sim.matchesPreview).toEqual({
      status: 'mismatch',
      ok: false,
      differences: ['The transaction reverts'],
      compared: ['success'],
      notCompared: [],
    });
  });
});
