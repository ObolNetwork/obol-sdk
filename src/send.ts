/**
 * Send helper for scripts and simple apps (spec/operations.md "send").
 * Returns as soon as the wallet gives a hash; `wait` follows it to a receipt,
 * or, for a contract wallet (a Safe), to the Safe's execution log.
 */
import {
  BaseError,
  ChainMismatchError,
  isAddress,
  isHex,
  slice,
  toEventSelector,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type ReplacementReturnType,
  type TransactionReceipt,
  WaitForTransactionReceiptTimeoutError,
  TransactionReceiptNotFoundError,
} from 'viem';
import { getCodeKind, latestBlockNumber } from './chainUtils.js';
import {
  accountAddress,
  requireWallet,
  viemChainOf,
  type Context,
} from './context.js';
import {
  FINDING_CODES,
  type FindingCode,
  type FindingCodeFor,
  type SimulationFindingCode,
  type WarningCode,
} from './findings.js';
import { ObolError } from './errors.js';
import { invalid, rejectUnknownKeys } from './schema.js';
import {
  PREPARED_KINDS,
  type AnyPrepared,
  type Finding,
  type Prepared,
  type PreparedKind,
  type PreparedRequest,
} from './types.js';

/**
 * What `send` needs of a `simulate` result: its findings and the request it
 * ran (so a simulation of another transaction cannot vouch for this one).
 * Every `Simulation` is one.
 */
export interface SimulationForSend {
  request: PreparedRequest;
  findings: Finding[];
}

/**
 * Options of `send`.
 *
 * @example The three ways to acknowledge.
 * ```ts
 * // 1. A UI: show warningsOf(tx, sim) in the confirmation dialog; when the
 * //    user confirms, acknowledge exactly what was shown.
 * await obol.send(tx, { simulation: sim, acknowledge: warningCodes(tx, sim) });
 *
 * // 2. A script with a fixed policy: name the codes it accepts. Anything
 * //    else still throws FINDINGS_NOT_ACKNOWLEDGED.
 * await obol.send(tx, { acknowledge: ['VALIDATOR_STATUS_UNCHECKED'] });
 * await obol.send(tx, { acknowledge: UNCHECKED_WARNING_CODES });
 *
 * // 3. Nothing to acknowledge: a transaction without warnings needs no options.
 * await obol.send(tx);
 * ```
 */
export interface SendOptions {
  /**
   * The warning codes the caller has seen and accepts for this transaction
   * (the meaning of each code is on the keys of `FINDINGS`). `send` refuses
   * (FINDINGS_NOT_ACKNOWLEDGED) while `prepared.checks`, or the findings of
   * `simulation`, hold a `warning` whose code is not listed.
   *
   * - `warningCodes(prepared, simulation)` gives exactly the codes this
   *   transaction carries: pass it once those warnings have been shown to
   *   whoever owns the funds.
   * - A fixed list states a policy; a listed code with no matching warning
   *   is ignored.
   * - It is always a list of codes. There is no `true` or `'all'`: a value
   *   that would also cover warnings nobody has seen is not accepted, and a
   *   string that is not a finding code is PAYLOAD_INVALID (a typo must not
   *   pass for an acknowledgement).
   * - `info` findings never need one.
   *
   * For autocompletion of the codes one kind of transaction can carry,
   * annotate with `FindingCodeFor<'withdraw'>[]`.
   */
  acknowledge?: readonly FindingCode[];
  /**
   * The `experimental.simulate` result for this `prepared`. Its warnings
   * (SIMULATION_REVERTED, SIMULATION_PREVIEW_MISMATCH,
   * SIMULATION_READS_INCOMPLETE, SIMULATION_UNAVAILABLE,
   * SIMULATION_UNTRUSTED_EVENT) then need acknowledging like the prepared
   * ones. A simulation of another request is PAYLOAD_INVALID.
   */
  simulation?: SimulationForSend;
}

export interface WaitOptions {
  /**
   * Called when the wallet replaces the transaction (viem `onReplaced`).
   * With `reason: 'repriced'` (a speed-up: the same call with more gas) the
   * wait goes on and resolves with the replacement's receipt, so an app that
   * remembers the hash should re-key it to `replacement.transaction.hash`.
   * `cancelled` and `replaced` (another call took the nonce) end the wait with
   * TX_REPLACED.
   */
  onReplaced?: (replacement: ReplacementReturnType) => void;
  /** Default 180 s for an account, 30 min for a contract wallet. */
  timeoutMs?: number;
  confirmations?: number;
}

export interface Sent {
  hash: Hash;
  contractWallet: boolean;
  wait: (options?: WaitOptions) => Promise<TransactionReceipt>;
}

// Safe 1.3.0 emits `ExecutionSuccess(bytes32 txHash, uint256 payment)` (txHash
// in the data); 1.4.0 and later index txHash (topic 1). The topic 0 is the
// same, so logs are matched by topic 0 and txHash read from either place.
const SAFE_EXECUTION_SUCCESS = toEventSelector(
  'ExecutionSuccess(bytes32,uint256)',
);
const SAFE_EXECUTION_FAILURE = toEventSelector(
  'ExecutionFailure(bytes32,uint256)',
);

/** The Safe txHash of an ExecutionSuccess / ExecutionFailure log, either version. */
const safeExecutionTxHash = (log: {
  topics: readonly Hex[];
  data: Hex;
}): string | undefined => {
  if (log.topics.length >= 2) return log.topics[1]?.toLowerCase();
  return log.data.length >= 66
    ? slice(log.data, 0, 32).toLowerCase()
    : undefined;
};

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_CONTRACT_WALLET_TIMEOUT_MS = 30 * 60_000;
const POLL_MS = 4_000;

const sleep = async (ms: number): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Waits for a Safe to execute `safeTxHash`: the account's ExecutionSuccess /
 * ExecutionFailure log with that hash, from `fromBlock`. Chain-only.
 */
export const waitForContractWalletExecution = async ({
  publicClient,
  account,
  safeTxHash,
  fromBlock,
  timeoutMs = DEFAULT_CONTRACT_WALLET_TIMEOUT_MS,
  pollMs = POLL_MS,
}: {
  publicClient: PublicClient;
  account: Address;
  safeTxHash: Hash;
  fromBlock: bigint;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<TransactionReceipt> => {
  const deadline = Date.now() + timeoutMs;
  const wanted = safeTxHash.toLowerCase();
  let from = fromBlock;
  for (;;) {
    const head = await latestBlockNumber(publicClient);
    if (head >= from) {
      const logs = await publicClient.getLogs({
        address: account,
        fromBlock: from,
        toBlock: head,
      });
      const match = logs.find(log => {
        const topic = log.topics[0]?.toLowerCase();
        return (
          (topic === SAFE_EXECUTION_SUCCESS ||
            topic === SAFE_EXECUTION_FAILURE) &&
          safeExecutionTxHash(log) === wanted
        );
      });
      if (match?.transactionHash != null) {
        const receipt = await publicClient.getTransactionReceipt({
          hash: match.transactionHash,
        });
        if (match.topics[0]?.toLowerCase() === SAFE_EXECUTION_FAILURE) {
          throw new ObolError(
            'TX_REVERTED',
            `The Safe executed ${safeTxHash} and the inner call failed (transaction ${match.transactionHash})`,
            {
              hint: 'Nothing moved; retrying is safe',
              details: {
                hash: safeTxHash,
                receipt,
                contractWallet: true,
              },
            },
          );
        }
        return receipt;
      }
      from = head + 1n;
    }
    if (Date.now() >= deadline) {
      throw new ObolError(
        'TX_UNCONFIRMED',
        `No Safe execution of ${safeTxHash} seen within ${timeoutMs} ms`,
        {
          hint: 'It may still be executed; check the Safe before proposing again',
          details: { hash: safeTxHash, contractWallet: true },
        },
      );
    }
    await sleep(pollMs);
  }
};

/** PREPARED_INVALID unless `prepared` looks like a prepareX result; CHAIN_MISMATCH for another chain. */
export const assertPrepared = (ctx: Context, prepared: AnyPrepared): void => {
  const candidate = prepared as Partial<AnyPrepared> | null | undefined;
  const request = candidate?.request;
  const ok =
    typeof candidate?.kind === 'string' &&
    (PREPARED_KINDS as readonly string[]).includes(candidate.kind) &&
    request !== undefined &&
    typeof request.to === 'string' &&
    isAddress(request.to, { strict: false }) &&
    typeof request.data === 'string' &&
    isHex(request.data) &&
    typeof request.value === 'bigint' &&
    request.value >= 0n &&
    typeof request.chainId === 'number' &&
    Array.isArray(candidate.checks);
  if (!ok) {
    throw new ObolError(
      'PREPARED_INVALID',
      'send expects the value a prepareX operation returned (with its kind and request)',
    );
  }
  if (request.chainId !== ctx.chain.id) {
    throw new ObolError(
      'CHAIN_MISMATCH',
      `The prepared transaction is for chain ${request.chainId}, the client is on ${ctx.chain.id}`,
      {
        details: {
          expectedChainId: ctx.chain.id,
          actualChainId: request.chainId,
        },
      },
    );
  }
};

const sameRequest = (a: PreparedRequest, b: PreparedRequest): boolean =>
  a.to.toLowerCase() === b.to.toLowerCase() &&
  a.data.toLowerCase() === b.data.toLowerCase() &&
  a.value === b.value &&
  a.chainId === b.chainId;

/** What the acknowledgement helpers read of a prepared transaction. */
type Checked<K extends PreparedKind = PreparedKind> = Pick<
  Prepared<K>,
  'checks' | 'request'
>;

/** The warning codes a `Prepared<K>` can carry. */
export type WarningCodeFor<K extends PreparedKind = PreparedKind> = Extract<
  FindingCodeFor<K>,
  WarningCode
>;

/** The warning codes a simulation can carry. */
export type SimulationWarningCode = Extract<SimulationFindingCode, WarningCode>;

const requireSimulationOf = (
  prepared: Checked,
  simulation: SimulationForSend | undefined,
  path: string,
): void => {
  if (simulation === undefined) return;
  if (
    simulation === null ||
    typeof simulation !== 'object' ||
    !Array.isArray(simulation.findings) ||
    simulation.request === undefined ||
    simulation.request === null ||
    !sameRequest(simulation.request, prepared.request)
  ) {
    throw invalid(
      path,
      'must be the simulate result of this prepared transaction (its request differs); simulate it again',
      'simulation_mismatch',
    );
  }
};

/**
 * Every warning this transaction carries: the `severity: 'warning'` findings
 * of `prepared.checks` and, when given, of its `simulation`. What a
 * confirmation dialog (or an agent's report to its operator) shows: each has
 * a `code`, a `message`, usually a `hint`, and the validator or address it is
 * about in `subject`.
 *
 * @throws PAYLOAD_INVALID when `simulation` is not of this `prepared`.
 */
export function warningsOf<K extends PreparedKind>(
  prepared: Checked<K>,
): Array<Finding<WarningCodeFor<K>>>;
export function warningsOf<K extends PreparedKind>(
  prepared: Checked<K>,
  simulation: SimulationForSend | undefined,
): Array<Finding<WarningCodeFor<K> | SimulationWarningCode>>;
export function warningsOf(
  prepared: Checked,
  simulation?: SimulationForSend,
): Finding[] {
  requireSimulationOf(prepared, simulation, 'simulation');
  return [...prepared.checks, ...(simulation?.findings ?? [])].filter(
    f => f.severity === 'warning',
  );
}

/**
 * The distinct codes of the warnings this transaction carries right now
 * (`warningsOf(prepared, simulation).map(f => f.code)`, without repeats), in
 * the shape `send` takes:
 *
 *   await obol.send(tx, { simulation: sim, acknowledge: warningCodes(tx, sim) });
 *
 * Use it when those warnings were shown to whoever owns the funds and they
 * confirmed: it acknowledges exactly what this transaction carries and
 * nothing a later or different transaction might. Compute it from the same
 * `prepared` (and `simulation`) that were shown. Calling it without showing
 * anything is choosing to ignore the warnings; a script should name the
 * codes its policy accepts instead.
 *
 * @throws PAYLOAD_INVALID when `simulation` is not of this `prepared`.
 */
export function warningCodes<K extends PreparedKind>(
  prepared: Checked<K>,
): Array<WarningCodeFor<K>>;
export function warningCodes<K extends PreparedKind>(
  prepared: Checked<K>,
  simulation: SimulationForSend | undefined,
): Array<WarningCodeFor<K> | SimulationWarningCode>;
export function warningCodes(
  prepared: Checked,
  simulation?: SimulationForSend,
): FindingCode[] {
  return [...new Set(warningsOf(prepared, simulation).map(f => f.code))];
}

/**
 * The warnings `send` would still refuse `prepared` for: those of
 * `warningsOf(prepared, options.simulation)` whose code is not in
 * `options.acknowledge`. Pure, so a caller that sends `prepared.request`
 * with its own wallet layer (wagmi, a Safe, a relayer) can apply the same
 * gate: send only when this is empty.
 *
 * @throws PAYLOAD_INVALID for an unknown option key, an `acknowledge` that
 *   is not a list of finding codes, or a `simulation` of another request.
 */
export const findingsToAcknowledge = (
  prepared: Checked,
  options: SendOptions = {},
): Array<Finding<WarningCode>> => {
  rejectUnknownKeys(options, ['acknowledge', 'simulation'], 'options');
  const { acknowledge = [], simulation } = options;
  if (!Array.isArray(acknowledge)) {
    throw invalid(
      'options.acknowledge',
      "must be an array of finding codes, e.g. warningCodes(prepared) or ['VALIDATOR_STATUS_UNCHECKED'] (a boolean, 'all' or a single string is not accepted)",
    );
  }
  acknowledge.forEach((code, i) => {
    if (!(FINDING_CODES as readonly unknown[]).includes(code)) {
      throw invalid(
        `options.acknowledge[${i}]`,
        `${JSON.stringify(code)} is not a finding code (see FINDINGS)`,
        'unknown_finding_code',
      );
    }
  });
  requireSimulationOf(prepared, simulation, 'options.simulation');
  const accepted = new Set<string>(acknowledge);
  return warningsOf(prepared, simulation).filter(
    f => !accepted.has(f.code),
  ) as Array<Finding<WarningCode>>;
};

/** FINDINGS_NOT_ACKNOWLEDGED unless every warning is acknowledged. */
const requireAcknowledged = (
  prepared: AnyPrepared,
  options: SendOptions,
): void => {
  const open = findingsToAcknowledge(prepared, options);
  if (open.length === 0) return;
  const codes = [...new Set(open.map(f => f.code))];
  const all = [...new Set([...(options.acknowledge ?? []), ...codes])];
  const quoted = all.map(c => `'${c}'`).join(', ');
  const lines = open
    .map((f, i) => {
      const hint = f.hint !== undefined ? ` (${f.hint})` : '';
      return `${i + 1}. ${f.code}: ${f.message}${hint}`;
    })
    .join('\n');
  const simulationArgument =
    options.simulation !== undefined ? ', simulation' : '';
  throw new ObolError(
    'FINDINGS_NOT_ACKNOWLEDGED',
    `Not sent: ${open.length} warning(s) on this ${prepared.kind} transaction were not acknowledged.\n${lines}`,
    {
      hint: [
        'Nothing was sent and the wallet was not asked.',
        'Each warning means the transaction may not do what is intended, or that a safety check could not run; error.details.findings has them with message, hint and subject, and FINDINGS[code] says what accepting each one means.',
        'Show them to whoever owns the funds (an agent: report them to your operator and wait; do not acknowledge on their behalf).',
        `Once they accept, send again with the codes: send(prepared, { acknowledge: [${quoted}] }), or acknowledge: warningCodes(prepared${simulationArgument}) for exactly the warnings this transaction carries.`,
        'If they do not accept, do not send: fix the cause (the hints say how) and prepare again.',
      ].join(' '),
      details: { codes, findings: open },
    },
  );
};

/**
 * Whether `prepared` was checked more than `maxAgeBlocks` blocks before
 * `head` (a `Prepared` without `blockNumber` read no chain state and is never
 * stale). `send` never refuses an old one; an app that shows a review for a
 * while re-prepares when this is true.
 */
export const isStale = (
  prepared: Pick<AnyPrepared, 'blockNumber'>,
  head: bigint,
  maxAgeBlocks: bigint | number,
): boolean =>
  prepared.blockNumber !== undefined &&
  head - prepared.blockNumber > BigInt(maxAgeBlocks);

/**
 * send (wallet): checks `prepared` and the wallet chain (PREPARED_INVALID,
 * CHAIN_MISMATCH, WALLET_REQUIRED), refuses a transaction with warnings the
 * caller did not acknowledge (FINDINGS_NOT_ACKNOWLEDGED, before the wallet is
 * asked for anything; see `SendOptions`), sends `prepared.request` and returns as
 * soon as the wallet gives a hash (TX_REJECTED if it does not). `wait`
 * follows it: TX_REVERTED, TX_REPLACED (`cancelled` / `replaced`, with
 * `reason` and the `replacement` hash), TX_UNCONFIRMED. A `repriced`
 * replacement (a wallet speed-up) is reported through `onReplaced` and the
 * wait resolves with its receipt: re-key a stored hash there.
 */
export const send = async (
  ctx: Context,
  prepared: AnyPrepared,
  options: SendOptions = {},
): Promise<Sent> => {
  assertPrepared(ctx, prepared);
  requireAcknowledged(prepared, options);
  const { walletClient, account } = await requireWallet(ctx, 'send');
  const from = accountAddress(account);
  const [kind, startBlock] = await Promise.all([
    getCodeKind(ctx.publicClient, from),
    latestBlockNumber(ctx.publicClient),
  ]);
  const contractWallet = kind === 'contract';
  let hash: Hash;
  try {
    hash = await walletClient.sendTransaction({
      account,
      // The client chain, so viem re-checks the wallet chain when it sends:
      // the wallet may have switched since requireWallet.
      chain: viemChainOf(ctx),
      to: prepared.request.to,
      data: prepared.request.data,
      value: prepared.request.value,
    });
  } catch (cause) {
    if (
      cause instanceof ChainMismatchError ||
      (cause instanceof BaseError &&
        cause.walk(e => e instanceof ChainMismatchError) !== null)
    ) {
      const actual = await walletClient.getChainId().catch(() => -1);
      throw new ObolError(
        'CHAIN_MISMATCH',
        `The wallet switched to chain ${actual} before sending; the client is on ${ctx.chain.id}`,
        {
          hint: "Nothing was sent; switch the wallet back to the client's chain and retry",
          details: { expectedChainId: ctx.chain.id, actualChainId: actual },
          cause,
        },
      );
    }
    throw new ObolError(
      'TX_REJECTED',
      `The wallet did not send the transaction: ${(cause as Error).message}`,
      { hint: 'Nothing was sent; retry if the user wants', cause },
    );
  }

  const wait = async (
    options: WaitOptions = {},
  ): Promise<TransactionReceipt> => {
    if (contractWallet) {
      return await waitForContractWalletExecution({
        publicClient: ctx.publicClient,
        account: from,
        safeTxHash: hash,
        fromBlock: startBlock,
        timeoutMs: options.timeoutMs,
      });
    }
    let receipt: TransactionReceipt;
    try {
      receipt = await ctx.publicClient.waitForTransactionReceipt({
        hash,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ...(options.confirmations !== undefined
          ? { confirmations: options.confirmations }
          : {}),
        onReplaced: replacement => {
          options.onReplaced?.(replacement);
          if (replacement.reason !== 'repriced') {
            throw new ObolError(
              'TX_REPLACED',
              `Transaction ${hash} was ${replacement.reason} by ${replacement.transaction.hash}`,
              {
                hint:
                  replacement.reason === 'cancelled'
                    ? 'The wallet cancelled it; the prepared call did not run, retrying is safe'
                    : 'Another call took its nonce; the prepared call did not run, retrying is safe',
                details: {
                  hash,
                  reason: replacement.reason,
                  replacement: replacement.transaction.hash,
                },
              },
            );
          }
        },
      });
    } catch (cause) {
      if (cause instanceof ObolError) throw cause;
      if (
        cause instanceof WaitForTransactionReceiptTimeoutError ||
        cause instanceof TransactionReceiptNotFoundError
      ) {
        throw new ObolError(
          'TX_UNCONFIRMED',
          `No receipt for ${hash} yet; it may still be mined`,
          {
            hint: 'Watch the hash before retrying, so nothing is sent twice',
            details: { hash, contractWallet: false },
            cause,
          },
        );
      }
      throw new ObolError(
        'TX_UNCONFIRMED',
        `Waiting for ${hash} failed: ${(cause as Error).message}`,
        {
          hint: 'Watch the hash before retrying, so nothing is sent twice',
          details: { hash, contractWallet: false },
          cause,
        },
      );
    }
    if (receipt.status !== 'success') {
      throw new ObolError('TX_REVERTED', `Transaction ${hash} reverted`, {
        hint: 'Nothing moved; retrying is safe',
        details: { hash, receipt },
      });
    }
    return receipt;
  };

  return { hash, contractWallet, wait };
};
