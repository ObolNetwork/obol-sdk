import type { Address, Hex } from 'viem';

export type { Address, Hex };

/** A check result that does not stop the operation (spec/errors.md "Findings"). */
export interface Finding {
  code: string;
  severity: 'warning' | 'info';
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
}

/** A checked, encoded transaction. Send `request` with any wallet layer. */
export interface Prepared<P = undefined> {
  request: { to: Address; data: Hex; value: bigint; chainId: number };
  checks: Finding[];
  preview: P;
  /** The block the checks and preview read; absent when no chain state was read. */
  blockNumber?: bigint;
}

export type Source = 'api' | 'chain';

/** 0xSplits v2 split parameters, as the contracts take them. */
export interface SplitParams {
  recipients: Address[];
  allocations: bigint[];
  totalAllocation: bigint;
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

export type DepositKind = 'deposit' | 'topUp';
