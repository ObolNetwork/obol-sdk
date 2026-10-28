/**
 * The beacon chain's rules for execution-layer requests, checked before a
 * request is sent: a request that breaks one is ignored by the chain and the
 * fee is kept, so each is a blocking error. Electra
 * `process_withdrawal_request` (EIP-7002) and `process_consolidation_request`
 * (EIP-7251). Checks that need data the status source did not give are
 * reported as VALIDATOR_STATUS_UNCHECKED (info) instead of being skipped
 * silently.
 */
import type { Address, Hex } from 'viem';
import { currentEpoch, type ObolChain } from '../chains.js';
import { finding } from '../chainUtils.js';
import { ObolError } from '../errors.js';
import type { Finding } from '../types.js';
import { ETH, GWEI } from '../units.js';
import {
  PENDING_PARTIAL_WITHDRAWALS_LIMIT,
  queuesOf,
  type DepositStatus,
} from '../deposits/status.js';
import {
  credentialsAddress,
  credentialsPointAt,
  credentialsPrefix,
} from './credentials.js';

/** Electra MIN_ACTIVATION_BALANCE. */
export const MIN_ACTIVATION_BALANCE = 32n * ETH;
/** SHARD_COMMITTEE_PERIOD: epochs after activation before a validator may exit or withdraw. */
export const SHARD_COMMITTEE_PERIOD = 256n;

const EXITING_STATUS = /^(active_exiting|active_slashed|exited_|withdrawal_)/;

/** What the rules need besides each validator's status. */
export interface RuleContext {
  chain: ObolChain;
  /** Clock override for tests (ms since the epoch). */
  nowMs?: number;
}

/** Collects the checks a validator's data did not allow. */
class Unchecked {
  private readonly byPubkey = new Map<string, Set<string>>();

  add(pubkey: Hex, check: string): void {
    const set = this.byPubkey.get(pubkey) ?? new Set<string>();
    set.add(check);
    this.byPubkey.set(pubkey, set);
  }

  findings(): Finding[] {
    return [...this.byPubkey].map(([pubkey, checks]) =>
      finding(
        'VALIDATOR_STATUS_UNCHECKED',
        'info',
        `The status source did not give what these checks need for ${pubkey}: ${[
          ...checks,
        ].join(', ')}`,
        {
          hint: 'Pass beaconUrl (or use an Obol API with the full deposit-status answer) to have them checked',
          subject: { pubkey: pubkey as Hex },
          details: { checks: [...checks] },
        },
      ),
    );
  }
}

/** VALIDATOR_STATUS_UNCHECKED for requests prepared with no status source at all. */
export const noStatusFinding = (operation: string): Finding =>
  finding(
    'VALIDATOR_STATUS_UNCHECKED',
    'info',
    `${operation}: no validator status source, so the beacon chain rules (active, not exiting, credentials, balances, pending withdrawals) were not checked; a request that breaks one is ignored and its fee kept`,
    {
      hint: 'Enable the Obol API or pass beaconUrl to have them checked',
      details: { checks: ['all'] },
    },
  );

const isExiting = (status: DepositStatus): boolean | undefined => {
  if (status.exitEpoch !== undefined) return status.exitEpoch !== null;
  if (status.beaconStatus !== undefined) {
    return EXITING_STATUS.test(status.beaconStatus);
  }
  return undefined;
};

const requireRegistry = (status: DepositStatus): void => {
  if (status.validatorIndex === undefined || status.status !== 'active') {
    // A validator that is exiting is reported as such below; here only the
    // ones that are not in the registry or not active yet.
    if (status.validatorIndex !== undefined && isExiting(status) === true) {
      return;
    }
    throw new ObolError(
      'VALIDATOR_NOT_ACTIVE',
      `${status.pubkey} is not an active validator (${status.beaconStatus ?? status.status})`,
      {
        hint: 'Wait for activation, or drop the request',
        details: {
          pubkey: status.pubkey,
          status: status.beaconStatus ?? status.status,
        },
      },
    );
  }
};

const requireSourceCredentials = (
  status: DepositStatus,
  source: Address | null,
  what: string,
  unchecked: Unchecked,
): Hex | undefined => {
  const credentials = status.withdrawalCredentials;
  if (credentials === undefined || source === null) {
    unchecked.add(status.pubkey, 'credentials');
    return credentials;
  }
  if (!credentialsPointAt(credentials, source)) {
    throw new ObolError(
      'CREDENTIALS_NOT_SOURCE',
      `The withdrawal credentials of ${status.pubkey} do not point at ${what} ${source}: the request would be ignored and the fee kept`,
      {
        hint: 'Send the request from the address the validator credentials point at',
        details: {
          pubkey: status.pubkey,
          withdrawalCredentials: credentials,
          source,
        },
      },
    );
  }
  return credentials;
};

const requireNotExiting = (
  status: DepositStatus,
  unchecked: Unchecked,
): void => {
  const exiting = isExiting(status);
  if (exiting === undefined) {
    unchecked.add(status.pubkey, 'exit epoch');
    return;
  }
  if (exiting) {
    throw new ObolError(
      'VALIDATOR_EXITING',
      `${status.pubkey} is already exiting (${status.beaconStatus ?? 'exit epoch set'}): the request would be ignored and the fee kept`,
      {
        hint: 'Drop the request; an exiting validator takes no further requests',
        details: {
          pubkey: status.pubkey,
          exitEpoch:
            typeof status.exitEpoch === 'bigint' ? status.exitEpoch : 0n,
        },
      },
    );
  }
};

const requirePastCommitteePeriod = (
  status: DepositStatus,
  epoch: bigint | undefined,
  unchecked: Unchecked,
): void => {
  if (
    status.activationEpoch === undefined ||
    status.activationEpoch === null ||
    epoch === undefined
  ) {
    unchecked.add(status.pubkey, 'activation epoch');
    return;
  }
  const eligibleEpoch = status.activationEpoch + SHARD_COMMITTEE_PERIOD;
  if (epoch < eligibleEpoch) {
    throw new ObolError(
      'VALIDATOR_TOO_NEW',
      `${status.pubkey} was activated at epoch ${status.activationEpoch}: requests are ignored until epoch ${eligibleEpoch} (now ${epoch})`,
      {
        hint: `Wait until epoch ${eligibleEpoch} (about ${((eligibleEpoch - epoch) * 384n) / 3600n} h)`,
        details: {
          pubkey: status.pubkey,
          activationEpoch: status.activationEpoch,
          eligibleEpoch,
          currentEpoch: epoch,
        },
      },
    );
  }
};

/** One withdrawal request as it will be sent. */
export interface CheckedWithdrawal {
  pubkey: Hex;
  /** wei sent in the request (capped to the excess balance for a partial). */
  amount: bigint;
  /** The amount asked for, when it was capped. */
  requestedAmount?: bigint;
}

/**
 * Applies `process_withdrawal_request` to each request, in order (a partial
 * earlier in the batch counts as pending for the later ones). Throws the
 * first rule a request breaks; caps partial amounts to the excess balance
 * (WITHDRAW_AMOUNT_CAPPED, info). Without a status for a pubkey nothing is
 * checked for it (the caller adds the no-source finding).
 */
export const checkWithdrawalRequests = (
  rules: RuleContext,
  requests: ReadonlyArray<{ pubkey: Hex; amount: bigint }>,
  statuses: Map<string, DepositStatus>,
  source: { address: Address | null; what: string },
): { requests: CheckedWithdrawal[]; checks: Finding[] } => {
  const epoch = currentEpoch(rules.chain, rules.nowMs);
  const unchecked = new Unchecked();
  const checks: Finding[] = [];
  const pendingAdded = new Map<string, bigint>();
  const queues = queuesOf(statuses);
  let queueWarned = false;
  const out = requests.map((request): CheckedWithdrawal => {
    const status = statuses.get(request.pubkey);
    if (status === undefined) return { ...request };
    requireRegistry(status);
    const credentials = requireSourceCredentials(
      status,
      source.address,
      source.what,
      unchecked,
    );
    requireNotExiting(status, unchecked);
    requirePastCommitteePeriod(status, epoch, unchecked);
    const pending =
      status.pendingPartialWithdrawals === undefined
        ? undefined
        : status.pendingPartialWithdrawals +
          (pendingAdded.get(request.pubkey) ?? 0n);

    if (request.amount === 0n) {
      if (pending === undefined) {
        unchecked.add(status.pubkey, 'pending partial withdrawals');
      } else if (pending > 0n) {
        throw new ObolError(
          'EXIT_BLOCKED_BY_PENDING_WITHDRAWAL',
          `${status.pubkey} has ${pending} wei of partial withdrawals pending: the beacon chain ignores a full exit until they are processed, and keeps the fee`,
          {
            hint: 'Wait for the pending partial withdrawals to be processed, then request the exit',
            details: {
              pubkey: status.pubkey,
              pendingPartialWithdrawals: pending,
            },
          },
        );
      }
      return { ...request };
    }

    // Partial withdrawal.
    if (
      credentials !== undefined &&
      credentialsPrefix(credentials) !== '0x02'
    ) {
      throw new ObolError(
        'PARTIAL_REQUIRES_COMPOUNDING',
        `${status.pubkey} does not have 0x02 credentials: the beacon chain ignores a partial withdrawal and keeps the fee`,
        {
          hint: 'Consolidate to 0x02 first (prepareConsolidate with the validator as source and target), or exit',
          details: {
            pubkey: status.pubkey,
            withdrawalCredentials: credentials,
          },
        },
      );
    }
    if (status.effectiveBalance === undefined) {
      unchecked.add(status.pubkey, 'effective balance');
    } else if (status.effectiveBalance < MIN_ACTIVATION_BALANCE) {
      throw new ObolError(
        'EFFECTIVE_BALANCE_TOO_LOW',
        `${status.pubkey} has an effective balance of ${status.effectiveBalance} wei, below 32 ETH: the beacon chain ignores a partial withdrawal and keeps the fee`,
        {
          hint: 'Effective balance steps up only at 32 + 1.25 ETH; top up or wait',
          details: {
            pubkey: status.pubkey,
            effectiveBalance: status.effectiveBalance,
          },
        },
      );
    }
    if (status.balance === undefined || pending === undefined) {
      unchecked.add(
        status.pubkey,
        status.balance === undefined
          ? 'balance'
          : 'pending partial withdrawals',
      );
      return { ...request };
    }
    const floor = MIN_ACTIVATION_BALANCE + pending;
    if (status.balance <= floor) {
      throw new ObolError(
        'NO_EXCESS_BALANCE',
        `${status.pubkey} has no balance above 32 ETH plus its pending partial withdrawals (${status.balance} wei, ${pending} wei pending): nothing would be withdrawn`,
        {
          hint: 'Drop the request; only the balance above 32 ETH can be withdrawn partially',
          details: {
            pubkey: status.pubkey,
            balance: status.balance,
            pendingPartialWithdrawals: pending,
          },
        },
      );
    }
    const excess = ((status.balance - floor) / GWEI) * GWEI;
    const amount = request.amount > excess ? excess : request.amount;
    if (amount === 0n) {
      // An excess under 1 gwei rounds down to 0, and a request amount of 0
      // is a full exit (EIP-7002): never send it for a partial withdrawal.
      throw new ObolError(
        'NO_EXCESS_BALANCE',
        `${status.pubkey} has less than 1 gwei above 32 ETH plus its pending partial withdrawals (${status.balance} wei, ${pending} wei pending): nothing would be withdrawn`,
        {
          hint: 'Drop the request; only the balance above 32 ETH can be withdrawn partially',
          details: {
            pubkey: status.pubkey,
            balance: status.balance,
            pendingPartialWithdrawals: pending,
          },
        },
      );
    }
    pendingAdded.set(
      request.pubkey,
      (pendingAdded.get(request.pubkey) ?? 0n) + amount,
    );
    if (
      !queueWarned &&
      queues !== undefined &&
      queues.pendingPartialWithdrawals >= PENDING_PARTIAL_WITHDRAWALS_LIMIT
    ) {
      queueWarned = true;
      checks.push(
        finding(
          'PARTIAL_WITHDRAWAL_QUEUE_FULL',
          'warning',
          'The beacon chain pending partial withdrawal queue is full: partial requests are ignored until it drains, and the fee is kept',
          {
            hint: 'Wait for the queue to drain',
            details: { length: queues.pendingPartialWithdrawals },
          },
        ),
      );
    }
    if (amount === request.amount) return { pubkey: request.pubkey, amount };
    checks.push(
      finding(
        'WITHDRAW_AMOUNT_CAPPED',
        'info',
        `${status.pubkey} can withdraw at most ${amount} wei now (balance above 32 ETH less pending withdrawals); the request asks for that instead of ${request.amount} wei`,
        {
          hint: 'The beacon chain would cap it the same way; the request is sent with the capped amount',
          subject: { pubkey: status.pubkey },
          details: { requestedAmount: request.amount, amount },
        },
      ),
    );
    return { pubkey: request.pubkey, amount, requestedAmount: request.amount };
  });
  return { requests: out, checks: [...checks, ...unchecked.findings()] };
};

/**
 * Applies `process_consolidation_request` to each source → target pair.
 * Throws the first rule a pair breaks. Source == target is a switch to
 * compounding (`0x01` → `0x02`). Different withdrawal addresses are allowed
 * by the chain (the stake leaves this OVM): CONSOLIDATION_CREDENTIALS_DIFFER,
 * warning.
 */
export const checkConsolidationRequests = (
  rules: RuleContext,
  requests: ReadonlyArray<{ sources: Hex[]; target: Hex }>,
  statuses: Map<string, DepositStatus>,
  source: Address,
): Finding[] => {
  const epoch = currentEpoch(rules.chain, rules.nowMs);
  const unchecked = new Unchecked();
  const checks: Finding[] = [];
  for (const request of requests) {
    const target = statuses.get(request.target);
    for (const pubkey of request.sources) {
      const status = statuses.get(pubkey);
      if (status === undefined || target === undefined) continue;
      requireRegistry(status);
      const credentials = requireSourceCredentials(
        status,
        source,
        'the OVM',
        unchecked,
      );
      if (pubkey === request.target) {
        // Switch to compounding: 0x01 credentials, active, not exiting.
        if (
          credentials !== undefined &&
          credentialsPrefix(credentials) === '0x02'
        ) {
          throw new ObolError(
            'CONSOLIDATION_ALREADY_COMPOUNDING',
            `${pubkey} already has 0x02 credentials: a request with it as source and target is ignored and the fee kept`,
            {
              hint: 'Drop the request; to consolidate, use another validator as the target',
              details: { pubkey },
            },
          );
        }
        requireNotExiting(status, unchecked);
        continue;
      }
      const targetCredentials = target.withdrawalCredentials;
      if (targetCredentials === undefined) {
        unchecked.add(target.pubkey, 'credentials');
      } else if (credentialsPrefix(targetCredentials) !== '0x02') {
        throw new ObolError(
          'CONSOLIDATION_TARGET_NOT_COMPOUNDING',
          `Target ${target.pubkey} does not have 0x02 credentials: the consolidation would be ignored and the fee kept`,
          {
            hint: 'Switch the target to 0x02 first (a request with it as source and target)',
            details: {
              pubkey: target.pubkey,
              withdrawalCredentials: targetCredentials,
            },
          },
        );
      }
      requireRegistry(target);
      requireNotExiting(status, unchecked);
      requireNotExiting(target, unchecked);
      requirePastCommitteePeriod(status, epoch, unchecked);
      if (status.pendingPartialWithdrawals === undefined) {
        unchecked.add(pubkey, 'pending partial withdrawals');
      } else if (status.pendingPartialWithdrawals > 0n) {
        throw new ObolError(
          'CONSOLIDATION_BLOCKED_BY_PENDING_WITHDRAWAL',
          `Source ${pubkey} has ${status.pendingPartialWithdrawals} wei of partial withdrawals pending: the consolidation would be ignored and the fee kept`,
          {
            hint: 'Wait for the pending partial withdrawals to be processed',
            details: {
              pubkey,
              pendingPartialWithdrawals: status.pendingPartialWithdrawals,
            },
          },
        );
      }
      if (
        credentials !== undefined &&
        targetCredentials !== undefined &&
        credentialsAddress(credentials) !==
          credentialsAddress(targetCredentials)
      ) {
        checks.push(
          finding(
            'CONSOLIDATION_CREDENTIALS_DIFFER',
            'warning',
            `Source ${pubkey} and target ${request.target} have different withdrawal addresses: the stake moves out of this OVM`,
            {
              hint: 'Check that the target is yours',
              subject: { pubkey },
              details: { source: pubkey, target: request.target },
            },
          ),
        );
      }
    }
  }
  return [...checks, ...unchecked.findings()];
};
