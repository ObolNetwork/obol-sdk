/**
 * simulate (spec/operations.md "simulate"): runs a `Prepared` request from a
 * sender on a node, without sending it, and reports what it would do:
 * success or the decoded revert, gas, ETH and Warehouse balance changes,
 * decoded events, state changes, plain-language summary lines and a
 * comparison with the operation's own preview.
 *
 *   const prepared = await obol.ovm.prepareDistribute({ ovm });
 *   const sim = await obol.simulate(prepared, { from });
 *   if (sim.success && (sim.limited || sim.matchesPreview.ok)) await obol.send(prepared);
 */
import { Type } from '@sinclair/typebox';
import type { Address } from 'viem';
import { getCodeKind, finding } from '../chainUtils.js';
import { requireContracts, senderOf, type Context } from '../context.js';
import { ObolError } from '../errors.js';
import { checksum, decode, invalid, sameAddress, T } from '../schema.js';
import { assertPrepared } from '../send.js';
import type { Finding, Prepared } from '../types.js';
import type { ChainContracts } from '../chains.js';
import { DEPOSIT_CONTRACT, ovmAbi } from '../abi.js';
import {
  balanceChanges,
  createdContracts,
  Labels,
  ovmCandidates,
  planReads,
  readValues,
  shortAddress,
  stateChanges,
  summarize,
  type Facts,
} from './analyze.js';
import {
  callOnly,
  isRpcAnswer,
  isUnsupported,
  rpcErrorInfo,
  knownSupport,
  simulateV1Backend,
  simulationFailed,
  traceBackend,
  type Execution,
  type FullBackend,
  type SimTx,
} from './backends.js';
import { comparePreview } from './compare.js';
import {
  decodeAggregate3,
  decodeCall,
  decodeLog,
  decodeRevert,
} from './decode.js';
import type {
  FullSimulation,
  LimitedSimulation,
  RevertReason,
  SimulatedEvent,
  SimulateOptions,
  Simulation,
  SimulationBackend,
} from './types.js';

export * from './types.js';
export { formatEth } from './analyze.js';

const SimulateOptionsSchema = Type.Object(
  {
    from: Type.Optional(T.Address),
    blockNumber: Type.Optional(
      Type.Union([Type.BigInt({ minimum: 0n }), Type.Literal('latest')]),
    ),
    backend: Type.Optional(
      Type.Union([
        Type.Literal('auto'),
        Type.Literal('eth_simulateV1'),
        Type.Literal('debug_traceCall'),
        Type.Literal('eth_call'),
      ]),
    ),
  },
  { additionalProperties: false },
);

const revertOf = (execution: {
  failure?: Execution['failure'];
  inner?: Execution['inner'];
}): RevertReason => {
  const reason = decodeRevert(
    execution.failure?.data,
    execution.failure?.message,
  );
  if (execution.inner !== undefined) {
    reason.inner = {
      index: execution.inner.index,
      target: execution.inner.target,
      reason: decodeRevert(
        execution.inner.failure.data,
        execution.inner.failure.message,
      ),
    };
  }
  return reason;
};

const revertLine = (reason: RevertReason): string =>
  reason.inner !== undefined
    ? `Reverts: ${reason.message}; call ${reason.inner.index} to ${shortAddress(reason.inner.target)} failed with ${reason.inner.reason.message}`
    : `Reverts: ${reason.message}`;

const labelsFor = (prepared: Prepared<unknown>, facts: Facts): Labels => {
  const labels = new Labels();
  const c = facts.contracts;
  labels.set(facts.tx.from, 'sender');
  labels.set(c.warehouse, 'Warehouse');
  labels.set(c.multicall3, 'Multicall3');
  labels.set(DEPOSIT_CONTRACT, 'deposit contract');
  labels.set(c.withdrawalRequest, 'EIP-7002 predeploy');
  labels.set(c.consolidationRequest, 'EIP-7251 predeploy');
  labels.set(c.rafRecipient, 'Obol RAF');
  labels.set(c.splitMain, 'SplitMain');
  labels.set(c.ovmFactory.address, 'OVM factory');
  labels.set(c.pullSplitFactory, 'PullSplit factory');
  for (const created of createdContracts(facts.events, c)) {
    labels.set(
      created.address,
      created.contract === 'ovm' ? 'new OVM' : 'new split',
    );
  }
  for (const ovm of ovmCandidates(facts)) labels.set(ovm, 'OVM');
  // Previews are read by shape: the distribution ones name the recipients.
  type Named = Partial<Record<string, string>>;
  const p = prepared.preview as
    | (Named & { ovm?: Named; splits?: Named[]; recipients?: Named[] })
    | null
    | undefined;
  if (p !== null && typeof p === 'object') {
    for (const s of Array.isArray(p.splits) ? p.splits : []) {
      labels.set(s.address, `${s.kind} split`);
    }
    const ovm = typeof p.principalRecipient === 'string' ? p : p.ovm;
    if (ovm !== undefined && typeof ovm === 'object') {
      labels.set(ovm.principalRecipient, 'principal recipient');
      labels.set(ovm.rewardRecipient, 'reward recipient');
    }
    for (const r of Array.isArray(p.recipients) ? p.recipients : []) {
      labels.set(r.address, 'split recipient');
    }
  }
  const call = decodeCall(ovmAbi, facts.tx.data);
  if (
    call?.functionName === 'withdraw' ||
    call?.functionName === 'consolidate'
  ) {
    labels.set(
      call.args[call.functionName === 'withdraw' ? 3 : 2] as string,
      'excess fee recipient',
    );
  }
  return labels;
};

/**
 * Addresses whose events are interpreted: the chain's contracts, the request's
 * target and batch targets, contracts the preview names, and contracts a
 * trusted factory created in this transaction.
 */
const trustedAddresses = (
  prepared: Prepared<unknown>,
  tx: SimTx,
  contracts: ChainContracts,
  events: SimulatedEvent[],
): Set<string> => {
  const set = new Set<string>();
  const add = (a: unknown): void => {
    if (typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a)) {
      set.add(a.toLowerCase());
    }
  };
  [
    contracts.ovmFactory.address,
    contracts.pullSplitFactory,
    contracts.warehouse,
    contracts.multicall3,
    contracts.splitMain,
    contracts.batchDeposit,
    contracts.withdrawalRequest,
    contracts.consolidationRequest,
    contracts.obolToken,
    DEPOSIT_CONTRACT,
    tx.to,
  ].forEach(add);
  if (sameAddress(tx.to, contracts.multicall3)) {
    for (const call of decodeAggregate3(tx.data) ?? []) add(call.target);
  }
  type Named = Partial<Record<string, unknown>>;
  const p = prepared.preview as
    | (Named & { ovm?: Named; splits?: Named[] })
    | null
    | undefined;
  if (p !== null && typeof p === 'object') {
    // OVMs, their recipients (splits), splits, created or claimed contracts.
    for (const k of [
      'principalRecipient',
      'rewardRecipient',
      'address',
      'factory',
      'contractAddress',
    ]) {
      const v = p[k];
      add(typeof v === 'object' && v !== null ? (v as Named).address : v);
    }
    if (p.ovm !== undefined && typeof p.ovm === 'object') {
      add(p.ovm.address);
      add(p.ovm.principalRecipient);
      add(p.ovm.rewardRecipient);
    }
    for (const s of Array.isArray(p.splits) ? p.splits : []) add(s.address);
  }
  const mark = (e: SimulatedEvent): SimulatedEvent => ({
    ...e,
    trusted: set.has(e.address.toLowerCase()),
  });
  for (const created of createdContracts(events.map(mark), contracts)) {
    add(created.address);
  }
  return set;
};

const formatValue = (v: unknown): string =>
  typeof v === 'bigint'
    ? v.toString()
    : Array.isArray(v)
      ? `[${v.map(formatValue).join(', ')}]`
      : typeof v === 'object' && v !== null
        ? JSON.stringify(v, (_, x) =>
            typeof x === 'bigint' ? x.toString() : x,
          )
        : String(v);

const unavailable = (
  skipped: Array<{ backend: string; reason: string }>,
): Finding =>
  finding(
    'SIMULATION_UNAVAILABLE',
    'info',
    `Neither eth_simulateV1 nor debug_traceCall could simulate the request on this node (${skipped
      .map(s => `${s.backend}: ${s.reason}`)
      .join('; ')}), so only success or revert was checked (eth_call)`,
    {
      hint: 'Use an RPC with eth_simulateV1 (geth, Nethermind, Erigon, Reth, anvil) to see balance changes and events',
      details: { tried: skipped.map(s => s.backend), skipped },
    },
  );

/**
 * Picks the backend: forced, or the best one the node supports (detected once
 * per client). In `auto`, a backend the node lacks or whose request it
 * rejects (an RPC error answer) is skipped for the next one; a node without
 * the method, or rejecting the parameters, is not asked again. A transport
 * failure, and any failure of a forced backend, is SIMULATION_FAILED.
 */
const runFull = async (
  ctx: Context,
  tx: SimTx,
  block: bigint,
  multicall3: Address,
  forced: SimulateOptions['backend'],
  skipped: Array<{ backend: string; reason: string }>,
): Promise<{ backend: FullBackend; execution: Execution } | null> => {
  const support = knownSupport(ctx.publicClient);
  const auto = forced === undefined || forced === 'auto';
  const order: Array<'eth_simulateV1' | 'debug_traceCall'> =
    forced === 'eth_simulateV1' || forced === 'debug_traceCall'
      ? [forced]
      : forced === 'eth_call'
        ? []
        : ['eth_simulateV1', 'debug_traceCall'];
  for (const name of order) {
    if (auto && support[name] === false) {
      skipped.push({ backend: name, reason: 'not supported by the node' });
      continue;
    }
    const backend =
      name === 'eth_simulateV1'
        ? simulateV1Backend(ctx.publicClient, tx, block, multicall3)
        : traceBackend(ctx.publicClient, tx, block, multicall3);
    try {
      const execution = await backend.execute();
      support[name] = true;
      return { backend, execution };
    } catch (cause) {
      if (cause instanceof ObolError && !auto) throw cause;
      const unsupported = isUnsupported(cause);
      if (unsupported) support[name] = false;
      if (!auto) {
        throw unsupported
          ? new ObolError(
              'SIMULATION_FAILED',
              `The node does not support ${name}`,
              {
                hint: "Use backend: 'auto'",
                details: { backend: name },
                cause,
              },
            )
          : simulationFailed(name, cause);
      }
      // auto: a transport failure is not the node refusing the method.
      if (!(cause instanceof ObolError) && !isRpcAnswer(cause)) {
        throw simulationFailed(name, cause);
      }
      skipped.push({ backend: name, reason: rpcErrorInfo(cause).message });
    }
  }
  return null;
};

/**
 * simulate (`chain`): what `prepared.request` does when `from` sends it, on
 * top of `blockNumber` (default the latest block). Checks:
 * `prepared` is a prepareX result for the client chain (PREPARED_INVALID,
 * CHAIN_MISMATCH); a sender (`from` or the wallet account, PAYLOAD_INVALID);
 * a chain with Obol contracts (UNSUPPORTED_CHAIN). A node without
 * eth_simulateV1 and debug_traceCall gives a `limited` result with a
 * SIMULATION_UNAVAILABLE finding; an RPC failure is SIMULATION_FAILED.
 * A contract-wallet sender (a Safe) is simulated as msg.sender: its own
 * signature, owner and nonce checks are not (SIMULATION_CONTRACT_WALLET).
 * Never sends anything and never throws for a revert: `success: false`.
 */
export const simulate = async (
  ctx: Context,
  prepared: Prepared<unknown>,
  options: SimulateOptions = {},
): Promise<Simulation> => {
  assertPrepared(ctx, prepared);
  const opts = decode(SimulateOptionsSchema, options, 'options');
  const contracts = requireContracts(ctx.chain.id, 'simulate');
  const sender = senderOf(
    ctx,
    opts.from !== undefined ? checksum(opts.from) : undefined,
  );
  if (sender === null) {
    throw invalid(
      'options.from',
      'simulate needs a sender: pass from, or a walletClient with an account',
    );
  }
  const from = checksum(sender);
  let blockNumber: bigint;
  try {
    blockNumber =
      opts.blockNumber === undefined || opts.blockNumber === 'latest'
        ? await ctx.publicClient.getBlockNumber()
        : opts.blockNumber;
  } catch (cause) {
    throw simulationFailed('eth_call', cause);
  }
  const tx: SimTx = {
    from,
    to: checksum(prepared.request.to),
    data: prepared.request.data,
    value: prepared.request.value,
  };

  const findings: Finding[] = [];
  let kind;
  try {
    kind = await getCodeKind(ctx.publicClient, from, blockNumber);
  } catch (cause) {
    throw simulationFailed('eth_call', cause);
  }
  if (kind === 'contract') {
    findings.push(
      finding(
        'SIMULATION_CONTRACT_WALLET',
        'info',
        `${from} is a contract wallet: the call was simulated with it as msg.sender; its own signature, owner, threshold and nonce checks were not`,
        {
          hint: 'Check the Safe transaction in the Safe app as well',
          details: { from },
        },
      ),
    );
  }

  const skipped: Array<{ backend: string; reason: string }> = [];
  const full = await runFull(
    ctx,
    tx,
    blockNumber,
    contracts.multicall3,
    opts.backend,
    skipped,
  );
  const base = { from, blockNumber };

  if (full === null) {
    const result = await callOnly(ctx.publicClient, tx, blockNumber);
    if (opts.backend !== 'eth_call') {
      findings.push(unavailable(skipped));
    }
    const revertReason = result.success ? undefined : revertOf(result);
    const limited: LimitedSimulation = {
      ...base,
      limited: true,
      backend: 'eth_call',
      success: result.success,
      ...(revertReason !== undefined ? { revertReason } : {}),
      findings,
      summary: [
        revertReason !== undefined
          ? revertLine(revertReason)
          : 'Succeeds (eth_call only: balance changes and events were not simulated)',
      ],
    };
    return limited;
  }

  const { backend, execution } = full;
  const name = backend.name as Exclude<SimulationBackend, 'eth_call'>;

  if (!execution.success) {
    if (execution.inner === undefined && backend.innerFailure !== undefined) {
      const calls = decodeAggregate3(tx.data);
      if (calls !== null && sameAddress(tx.to, contracts.multicall3)) {
        try {
          const inner = await backend.innerFailure(calls, contracts.multicall3);
          if (inner !== undefined) execution.inner = inner;
        } catch {
          // The outer revert is still reported.
        }
      }
    }
    const revertReason = revertOf(execution);
    findings.push(
      finding(
        'SIMULATION_REVERTED',
        'warning',
        `The transaction reverts when simulated: ${revertReason.message}`,
        {
          hint: 'Do not send it; prepare again, or check the sender and state',
          details: { revertReason },
        },
      ),
    );
    const reverted: FullSimulation = {
      ...base,
      limited: false,
      backend: name,
      success: false,
      revertReason,
      gasUsed: execution.gasUsed,
      balanceChanges: [],
      events: [],
      stateChanges: [],
      findings,
      summary: [revertLine(revertReason)],
      matchesPreview: {
        ok: false,
        differences: ['The transaction reverts'],
        compared: ['success'],
      },
    };
    return reverted;
  }

  const decoded = execution.logs.map(decodeLog);
  const trusted = trustedAddresses(prepared, tx, contracts, decoded);
  const events = decoded.map(e => ({
    ...e,
    trusted: trusted.has(e.address.toLowerCase()),
  }));
  // Only trusted events are interpreted; the others are listed as they are.
  const untrusted = events.filter(e => !e.trusted && e.known);
  const facts: Facts = {
    tx,
    contracts,
    events: events.filter(e => e.trusted),
    ethAddresses: execution.ethAddresses,
  };
  const plan = planReads(facts);
  let reads;
  try {
    reads = await backend.read(plan.calls);
  } catch (cause) {
    if (cause instanceof ObolError) throw cause;
    throw simulationFailed(name, cause);
  }
  const values = readValues(plan, reads);
  const labels = labelsFor(prepared, facts);
  const balances = balanceChanges(values, labels, from);
  const changes = stateChanges(facts, values);
  const matchesPreview = comparePreview(prepared, {
    tx,
    contracts,
    events: facts.events,
    changes,
    values,
  });
  if (!matchesPreview.ok) {
    const moved =
      prepared.blockNumber !== undefined &&
      prepared.blockNumber !== blockNumber;
    findings.push(
      finding(
        'SIMULATION_PREVIEW_MISMATCH',
        'warning',
        `The simulation differs from the preview: ${matchesPreview.differences.join('; ')}${
          moved
            ? ` (the state moved since prepare: prepared at block ${prepared.blockNumber}, simulated on ${blockNumber}; prepare again)`
            : ''
        }`,
        {
          hint: moved
            ? 'Prepare again and simulate the new transaction'
            : 'Prepare again at the latest block; if it persists, report it',
          details: {
            differences: matchesPreview.differences,
            stateMoved: moved,
            ...(prepared.blockNumber !== undefined
              ? { preparedBlockNumber: prepared.blockNumber }
              : {}),
            blockNumber,
          },
        },
      ),
    );
  }
  const untrustedLines = untrusted.map(
    e =>
      `Unrecognised contract ${shortAddress(e.address)} emitted ${e.name}(${Object.values(
        e.args,
      )
        .map(formatValue)
        .join(', ')})`,
  );
  if (untrusted.length > 0) {
    findings.push(
      finding(
        'SIMULATION_UNTRUSTED_EVENT',
        'warning',
        `${untrusted.length} event(s) came from contracts with no known role in this transaction and were not interpreted: ${untrusted
          .map(e => `${e.name} from ${e.address}`)
          .join('; ')}`,
        {
          hint: 'Do not rely on these events; balance changes come from the trace',
          details: {
            events: untrusted.map(e => ({ address: e.address, name: e.name })),
          },
        },
      ),
    );
  }
  const result: FullSimulation = {
    ...base,
    limited: false,
    backend: name,
    success: true,
    gasUsed: execution.gasUsed,
    balanceChanges: balances,
    events,
    stateChanges: changes,
    findings,
    summary: [
      ...summarize(facts, balances, changes, labels),
      ...untrustedLines,
    ],
    matchesPreview,
  };
  return result;
};
