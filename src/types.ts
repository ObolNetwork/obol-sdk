import type { Address, Hex } from 'viem';
import type { FindingCode } from './codes.js';
import type { DepositPreview } from './deposits/prepareDeposit.js';
import type { ClaimPreview } from './incentives/incentives.js';
import type { DistributePreview } from './ovm/distribute.js';
import type {
  OvmWritePreview,
  SetPrincipalStakePreview,
  WithdrawPullBalancePreview,
} from './ovm/roles.js';
import type { ConsolidatePreview, WithdrawPreview } from './ovm/withdraw.js';
import type { CreateOvmPreview } from './setup/ovm.js';
import type { OvmWithSplitsPreview } from './setup/withSplits.js';
import type { CreateSplitPreview } from './splits/create.js';
import type { DistributionPreview } from './splits/distribution.js';
import type { EoaWithdrawPreview } from './withdrawals/withdrawals.js';

export type { Address, Hex };

/**
 * What a finding is about, when it is about one item: a validator, a
 * contract or account, or an input entry (its index in the input list).
 * Stable, so an app can attach the finding to a row.
 */
export type FindingSubject =
  | { pubkey: Hex }
  | { address: Address }
  | { index: number };

/** A check result that does not stop the operation (spec/errors.md "Findings"). */
export interface Finding {
  code: FindingCode;
  severity: 'warning' | 'info';
  message: string;
  hint?: string;
  /** Set when the finding is about one validator, address or input entry. */
  subject?: FindingSubject;
  details?: Record<string, unknown>;
}

/**
 * The preview of each kind of prepared transaction. `Prepared<K>['preview']`
 * is `PreviewByKind[K]`, so code holding any `Prepared` narrows the preview
 * by switching on `kind`.
 */
export interface PreviewByKind {
  /** deposits.prepareDeposit */
  deposit: DepositPreview;
  /** ovm.prepareWithdraw */
  withdraw: WithdrawPreview;
  /** ovm.prepareConsolidate */
  consolidate: ConsolidatePreview;
  /** ovm.prepareDistribute */
  distribute: DistributePreview;
  /** splits.prepareDistribution */
  distribution: DistributionPreview;
  /** setup.prepareCreateOvm */
  createOvm: CreateOvmPreview;
  /** setup.prepareOvmWithSplits */
  ovmWithSplits: OvmWithSplitsPreview;
  /** splits.prepareCreateSplit (also setup.prepareCreateSplit) */
  createSplit: CreateSplitPreview;
  /** incentives.prepareClaim */
  claim: ClaimPreview;
  /** withdrawals.prepareEoaWithdraw */
  eoaWithdraw: EoaWithdrawPreview;
  /** ovm.prepareGrantRoles / prepareRevokeRoles / prepareRenounceRoles */
  role: OvmWritePreview;
  /** ovm.prepareTransfer and the three ownership handover writes */
  ownership: OvmWritePreview;
  /** ovm.prepareSetPrincipalRecipient / prepareSetRewardRecipient */
  recipient: OvmWritePreview;
  /** ovm.prepareSetAmountOfPrincipalStake */
  principalStake: SetPrincipalStakePreview;
  /** ovm.prepareSweep */
  sweep: OvmWritePreview;
  /** ovm.prepareWithdrawPullBalance */
  withdrawPullBalance: WithdrawPullBalancePreview;
  /** ovm.prepareRecoverFunds */
  recoverFunds: OvmWritePreview;
}

export type PreparedKind = keyof PreviewByKind;

/** Every kind, for runtime checks (`send`, `simulate`). */
export const PREPARED_KINDS: readonly PreparedKind[] = [
  'deposit',
  'withdraw',
  'consolidate',
  'distribute',
  'distribution',
  'createOvm',
  'ovmWithSplits',
  'createSplit',
  'claim',
  'eoaWithdraw',
  'role',
  'ownership',
  'recipient',
  'principalStake',
  'sweep',
  'withdrawPullBalance',
  'recoverFunds',
];

/** The transaction itself, viem-compatible. */
export interface PreparedRequest {
  to: Address;
  data: Hex;
  value: bigint;
  chainId: number;
}

/** A checked, encoded transaction of one kind. Send `request` with any wallet layer. */
export interface Prepared<K extends PreparedKind = PreparedKind> {
  /** Which operation prepared it; narrows `preview`. */
  kind: K;
  request: PreparedRequest;
  checks: Finding[];
  preview: PreviewByKind[K];
  /** The block the checks and preview read; absent when no chain state was read. */
  blockNumber?: bigint;
}

/** Any prepared transaction, as a union discriminated by `kind`. */
export type AnyPrepared = { [K in PreparedKind]: Prepared<K> }[PreparedKind];

/**
 * What every `preview*` operation returns: the preview the matching
 * `prepare*` would carry, its findings, and the block both read. It has no
 * `request`, so it cannot be sent by mistake.
 */
export interface PreviewResult<P> {
  preview: P;
  checks: Finding[];
  blockNumber: bigint;
}

export type Source = 'api' | 'chain';

/**
 * Where the writes that check validator state read it from (the same
 * options as `deposits.status`). Without either, the Obol API's
 * `POST /v1/validators/:network/deposit-status` is used when the client has
 * the API.
 */
export interface StatusSource {
  /** Beacon node REST URL, for the chain fallback. */
  beaconUrl?: string;
  /**
   * The cluster lock of the pubkeys: only needed while the Obol API does not
   * serve the deposit-status route (the interim `GET /v1/state/:lockHash`
   * answers by lock).
   */
  lockHash?: string;
  /**
   * Re-reads of an Obol API deposit-status batch while an entry has
   * `signaturesPending` (the API checks queued deposit signatures in the
   * background, usually within a slot). Default `{ tries: 3, delayMs: 8000 }`:
   * up to 3 requests, waiting 8 s then 16 s (about two slots).
   */
  pendingRetry?: PendingRetry;
}

/** See `StatusSource.pendingRetry`. */
export interface PendingRetry {
  /** Requests in all, 1–10 (1: no retry). Default 3. */
  tries?: number;
  /** Wait before the first retry, ms (0–60000), doubled for each later one. Default 8000. */
  delayMs?: number;
}

/** 0xSplits v2 split parameters, as the contracts take them. */
export interface SplitParams {
  recipients: Address[];
  allocations: bigint[];
  totalAllocation: bigint;
  /** Parts per million (uint16 on chain, so at most 65535). */
  distributionIncentive: number;
}

/** A split's params as an input: addresses and hex as plain strings. */
export interface SplitParamsInput {
  recipients: string[];
  allocations: Array<bigint | number>;
  totalAllocation: bigint | number;
  distributionIncentive: number;
}

/** One deposit (amount in wei). */
export interface Deposit {
  pubkey: Hex;
  withdrawalCredentials: Hex;
  signature: Hex;
  depositDataRoot: Hex;
  amount: bigint;
}

/** A deposit as an input: hex fields as plain strings (checked at runtime). */
export interface DepositInput {
  pubkey: string;
  withdrawalCredentials: string;
  signature: string;
  depositDataRoot: string;
  amount: bigint;
}

export type DepositKind = 'deposit' | 'topUp';
