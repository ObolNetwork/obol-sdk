/** Result types of `simulate` (spec/operations.md "simulate"). */
import type { Address, Hex } from 'viem';
import type { OvmRoleName } from '../ovm/routing.js';
import type { Finding, SplitParams } from '../types.js';

/** How the transaction was simulated, best first. */
export type SimulationBackend =
  | 'eth_simulateV1'
  | 'debug_traceCall'
  | 'eth_call';

export interface SimulateOptions {
  /** The sender: default the wallet account. A Safe simulates as the Safe (msg.sender). */
  from?: Address;
  /** The block to simulate on top of: default the latest block (pass `prepared.blockNumber` to pin it). */
  blockNumber?: bigint | 'latest';
  /** Force a backend; default `auto` (eth_simulateV1, then debug_traceCall, then eth_call). */
  backend?: SimulationBackend | 'auto';
}

export interface RevertReason {
  /** `Error(string)` text, or `Name(args)` of a decoded custom error. */
  message: string;
  name?: string;
  args?: readonly unknown[];
  data?: Hex;
  /** For a Multicall3 batch: the first inner call that failed. */
  inner?: { index: number; target: Address; reason: RevertReason };
}

export interface BalanceChange {
  address: Address;
  /** `ETH` in the account, or the account's native-token balance in the 0xSplits Warehouse. */
  asset: 'ETH' | 'WAREHOUSE_ETH';
  /** What the address is (`sender`, `OVM`, ...); `warehouse:<address>` for Warehouse balances. */
  label?: string;
  before: bigint;
  after: bigint;
  delta: bigint;
}

export interface SimulatedEvent {
  address: Address;
  /** The event name, or `Unknown` (args then hold `topics` and `data`). */
  name: string;
  args: Record<string, unknown>;
  known: boolean;
  /**
   * Emitted by a contract with a known role in this transaction (the chain's
   * factories, Warehouse, deposit contract, predeploys, Multicall3, the
   * request's target and batch targets, contracts the preview names, contracts
   * created by a factory here). Only trusted events become state changes and
   * summary lines.
   */
  trusted: boolean;
}

export type OvmValueName = 'amountOfPrincipalStake' | 'fundsPendingWithdrawal';

export type StateChange =
  | {
      kind: 'value';
      address: Address;
      name: OvmValueName;
      before: bigint;
      after: bigint;
      delta: bigint;
    }
  | {
      kind: 'roles';
      address: Address;
      user: Address;
      before?: bigint;
      after: bigint;
      granted: OvmRoleName[];
      revoked: OvmRoleName[];
    }
  | {
      kind: 'ownership';
      address: Address;
      previousOwner: Address;
      newOwner: Address;
    }
  | {
      kind: 'ownershipHandover';
      address: Address;
      pendingOwner: Address;
      action: 'requested' | 'canceled';
    }
  | {
      kind: 'recipient';
      address: Address;
      recipient: 'principal' | 'reward';
      newAddress: Address;
    }
  | {
      kind: 'created';
      contract: 'ovm' | 'split';
      address: Address;
      factory: Address;
      owner: Address;
      /** OVM: principalRecipient, rewardRecipient, principalThreshold (wei). Split: params. */
      principalRecipient?: Address;
      rewardRecipient?: Address;
      principalThreshold?: bigint;
      params?: SplitParams;
    }
  | { kind: 'splitUpdated'; address: Address; params: SplitParams }
  | { kind: 'paused'; address: Address; paused: boolean }
  | {
      kind: 'withdrawalRequest';
      /** `event` (the OVM's WithdrawalRequested) or `calldata` (a direct EIP-7002 request: the predeploy emits no event). */
      source: 'event' | 'calldata';
      via: Address;
      pubkey: Hex;
      /** wei; 0 = full exit */
      amount: bigint;
      fullExit: boolean;
      fee: bigint;
    }
  | {
      kind: 'consolidationRequest';
      source: 'event' | 'calldata';
      via: Address;
      sourcePubkey: Hex;
      targetPubkey: Hex;
      fee: bigint;
    }
  | {
      kind: 'deposit';
      pubkey: Hex;
      withdrawalCredentials: Hex;
      /** wei */
      amount: bigint;
      index: bigint;
    };

export interface PreviewComparison {
  /** No differences in what was compared. */
  ok: boolean;
  differences: string[];
  /** What was compared (empty when the preview has nothing comparable). */
  compared: string[];
}

interface SimulationBase {
  from: Address;
  /** The block simulated on top of. */
  blockNumber: bigint;
  backend: SimulationBackend;
  success: boolean;
  revertReason?: RevertReason;
  /** SIMULATION_* findings. */
  findings: Finding[];
  /** Plain-language lines built from the result (deterministic). */
  summary: string[];
}

/** eth_simulateV1 or debug_traceCall: the full picture. */
export interface FullSimulation extends SimulationBase {
  limited: false;
  backend: 'eth_simulateV1' | 'debug_traceCall';
  gasUsed: bigint;
  balanceChanges: BalanceChange[];
  events: SimulatedEvent[];
  stateChanges: StateChange[];
  matchesPreview: PreviewComparison;
}

/** eth_call only: success or revert, nothing else. */
export interface LimitedSimulation extends SimulationBase {
  limited: true;
  backend: 'eth_call';
}

export type Simulation = FullSimulation | LimitedSimulation;
