/**
 * Every error and finding code (spec/errors.md), with the details each
 * error carries. `test/spec/conformance.spec.ts` checks these lists against
 * errors.md and against the codes used in `src/`, so they cannot drift.
 */
import type { Address, Hash, Hex, TransactionReceipt } from 'viem';

/** One failing input path of PAYLOAD_INVALID. */
export interface Issue {
  path: string;
  message: string;
  issue?: string;
}

interface PubkeyDetails {
  pubkey: Hex;
}

/** Details of each error code (`ObolError<C>['details']`). */
export interface ObolErrorDetails {
  // Input, client and chain
  PAYLOAD_INVALID: { issues: Issue[] };
  UNSUPPORTED_CHAIN: { chainId: number | null; operation?: string };
  CHAIN_MISMATCH: { expectedChainId: number; actualChainId: number };
  WALLET_REQUIRED: Record<string, never>;
  BASE_URL_INVALID: { baseUrl: string };
  API_DISABLED: { operation?: string };
  CONTRACT_NOT_AVAILABLE: { address: Address };
  CHAIN_READ_FAILED: { what?: string };
  // Obol API (ObolApiError)
  API_VALIDATION: ApiErrorDetails;
  API_UNAUTHORIZED: ApiErrorDetails;
  API_NOT_FOUND: ApiErrorDetails;
  API_CONFLICT: ApiErrorDetails;
  API_RATE_LIMIT: ApiErrorDetails;
  API_TIMEOUT: ApiErrorDetails;
  API_ERROR: ApiErrorDetails;
  API_RESPONSE_MISMATCH: Partial<ApiErrorDetails>;
  // Cluster
  DEFINITION_INVALID: {
    issues: Array<{ code: string; message: string }>;
  };
  ACCOUNT_NOT_OPERATOR: { address: Address; configHash: string };
  LOCK_INVALID: {
    step?: string;
    issue?: string;
    index?: number;
  };
  // Deposits
  DEPOSIT_INVALID: { index: number; issue: string };
  DEPOSIT_LOOKS_LIKE_TOP_UP: { index: number; issue?: string };
  DEPOSIT_CONFLICT: {
    index: number;
    pubkey: Hex;
    existingCredentials?: Hex;
  };
  DEPOSIT_TOP_UP_TARGET_MISSING: { index: number; pubkey: Hex };
  DEPOSIT_AMOUNT_NOT_IN_LOCK: { amount: bigint; available: bigint[] };
  STATUS_UNAVAILABLE: { reason?: 'endpoint_unavailable' };
  // OVM
  OVM_NOT_OBOL: { address: Address; source: 'api' | 'chain' };
  PROVENANCE_UNKNOWN: { address: Address };
  OVM_READ_FAILED: { address: Address };
  OVM_ROLE_EVENTS_UNAVAILABLE: { address: Address };
  OVM_ROLE_MISSING: { from: Address; role: string };
  OVM_OWNER_REQUIRED: { from: Address; owner: Address };
  PUBLIC_FORWARDER_AS_ROLE_HOLDER: {
    user: Address;
    roles: bigint;
    reason: string;
  };
  PUBLIC_FORWARDER_AS_OWNER: {
    newOwner: Address;
    path?: string;
    reason: string;
  };
  PUBLIC_FORWARDER_AS_RECIPIENT: {
    recipient: Address;
    path: string;
    reason: string;
  };
  OWNERSHIP_HANDOVER_NOT_PENDING: {
    pendingOwner: Address;
    expiresAt: bigint;
  };
  FULL_EXIT_NOT_ACKNOWLEDGED: Record<string, never>;
  CONSOLIDATION_NOT_ACKNOWLEDGED: Record<string, never>;
  FEE_OUT_OF_RANGE: { fee: bigint; minimum: bigint; maximum: bigint };
  FEE_READ_FAILED: { predeploy: Address };
  // Withdrawal and consolidation requests (EIP-7002 / EIP-7251)
  VALIDATOR_NOT_ACTIVE: PubkeyDetails & { status: string };
  VALIDATOR_EXITING: PubkeyDetails & { exitEpoch: bigint };
  VALIDATOR_TOO_NEW: PubkeyDetails & {
    activationEpoch: bigint;
    eligibleEpoch: bigint;
    currentEpoch: bigint;
  };
  CREDENTIALS_NOT_SOURCE: PubkeyDetails & {
    withdrawalCredentials: Hex;
    source: Address;
  };
  EXIT_BLOCKED_BY_PENDING_WITHDRAWAL: PubkeyDetails & {
    pendingPartialWithdrawals: bigint;
  };
  PARTIAL_REQUIRES_COMPOUNDING: PubkeyDetails & {
    withdrawalCredentials: Hex;
  };
  EFFECTIVE_BALANCE_TOO_LOW: PubkeyDetails & { effectiveBalance: bigint };
  NO_EXCESS_BALANCE: PubkeyDetails & {
    balance: bigint;
    pendingPartialWithdrawals: bigint;
  };
  CONSOLIDATION_TARGET_NOT_COMPOUNDING: PubkeyDetails & {
    withdrawalCredentials: Hex;
  };
  CONSOLIDATION_BLOCKED_BY_PENDING_WITHDRAWAL: PubkeyDetails & {
    pendingPartialWithdrawals: bigint;
  };
  CONSOLIDATION_ALREADY_COMPOUNDING: PubkeyDetails;
  // Splits and setup
  SPLIT_ALREADY_EXISTS: { address: Address };
  SPLIT_PARAMS_MISMATCH: { address: Address };
  SPLIT_PARAMS_REQUIRED: { address: Address; kind: 'reward' | 'principal' };
  SPLIT_NOT_OVM_RECIPIENT: {
    address: Address;
    kind: 'reward' | 'principal';
    ovmRecipient: Address;
  };
  SPLIT_PAUSED: { address: Address; owner?: Address };
  NOTHING_TO_DISTRIBUTE: Record<string, never>;
  OVM_CREATE_EVENT_MISSING: Record<string, never>;
  OVM_CREATE_EVENT_AMBIGUOUS: { ovms: Address[] };
  // Incentives
  INCENTIVES_PREFLIGHT_FAILED: {
    issues: Array<{
      code: FindingCode;
      severity: 'warning' | 'info';
      message: string;
      hint?: string;
    }>;
  };
  ALREADY_CLAIMED: { index?: number };
  // Exits
  EXIT_SHARE_INDEX_INVALID: { shareIdx: number; pubkey?: Hex };
  EXIT_PAYLOAD_SIGNATURE_INVALID: { shareIdx: number };
  EXIT_VALIDATOR_NOT_IN_CLUSTER: { pubkey: Hex };
  EXIT_VALIDATOR_INDEX_MISMATCH: {
    pubkey: Hex;
    validatorIndex: string;
    storedValidatorIndex: string;
  };
  EXIT_EPOCH_MISMATCH: { pubkey: Hex; epoch: string; storedEpoch: string };
  EXIT_SIGNATURE_CONFLICT: { pubkey: Hex; shareIdx: number };
  EXIT_PARTIAL_SIGNATURE_INVALID: { pubkey: Hex; shareIdx?: number };
  EXIT_NOT_ENOUGH_SHARES: {
    pubkey: Hex;
    threshold: number;
    valid: number[];
    invalid: number[];
  };
  // Sending and simulation
  PREPARED_INVALID: Record<string, never>;
  TX_REJECTED: Record<string, never>;
  TX_REVERTED: {
    hash: Hash;
    receipt: TransactionReceipt;
    contractWallet?: boolean;
  };
  TX_REPLACED: {
    hash: Hash;
    reason: 'cancelled' | 'replaced';
    replacement: Hash;
  };
  TX_UNCONFIRMED: { hash: Hash; contractWallet: boolean };
  SIMULATION_FAILED: { backend: string };
}

/** HTTP fields every API error carries in `details` (and as properties). */
export interface ApiErrorDetails {
  status: number;
  endpoint: string;
}

export type ObolErrorCode = keyof ObolErrorDetails;

export type ApiErrorCode =
  | 'API_VALIDATION'
  | 'API_UNAUTHORIZED'
  | 'API_NOT_FOUND'
  | 'API_CONFLICT'
  | 'API_RATE_LIMIT'
  | 'API_TIMEOUT'
  | 'API_ERROR'
  | 'API_RESPONSE_MISMATCH';

/** Every error code, for runtime checks. */
export const OBOL_ERROR_CODES = [
  'PAYLOAD_INVALID',
  'UNSUPPORTED_CHAIN',
  'CHAIN_MISMATCH',
  'WALLET_REQUIRED',
  'BASE_URL_INVALID',
  'API_DISABLED',
  'CONTRACT_NOT_AVAILABLE',
  'CHAIN_READ_FAILED',
  'API_VALIDATION',
  'API_UNAUTHORIZED',
  'API_NOT_FOUND',
  'API_CONFLICT',
  'API_RATE_LIMIT',
  'API_TIMEOUT',
  'API_ERROR',
  'API_RESPONSE_MISMATCH',
  'DEFINITION_INVALID',
  'ACCOUNT_NOT_OPERATOR',
  'LOCK_INVALID',
  'DEPOSIT_INVALID',
  'DEPOSIT_LOOKS_LIKE_TOP_UP',
  'DEPOSIT_CONFLICT',
  'DEPOSIT_TOP_UP_TARGET_MISSING',
  'DEPOSIT_AMOUNT_NOT_IN_LOCK',
  'STATUS_UNAVAILABLE',
  'OVM_NOT_OBOL',
  'PROVENANCE_UNKNOWN',
  'OVM_READ_FAILED',
  'OVM_ROLE_EVENTS_UNAVAILABLE',
  'OVM_ROLE_MISSING',
  'OVM_OWNER_REQUIRED',
  'PUBLIC_FORWARDER_AS_ROLE_HOLDER',
  'PUBLIC_FORWARDER_AS_OWNER',
  'PUBLIC_FORWARDER_AS_RECIPIENT',
  'OWNERSHIP_HANDOVER_NOT_PENDING',
  'FULL_EXIT_NOT_ACKNOWLEDGED',
  'CONSOLIDATION_NOT_ACKNOWLEDGED',
  'FEE_OUT_OF_RANGE',
  'FEE_READ_FAILED',
  'VALIDATOR_NOT_ACTIVE',
  'VALIDATOR_EXITING',
  'VALIDATOR_TOO_NEW',
  'CREDENTIALS_NOT_SOURCE',
  'EXIT_BLOCKED_BY_PENDING_WITHDRAWAL',
  'PARTIAL_REQUIRES_COMPOUNDING',
  'EFFECTIVE_BALANCE_TOO_LOW',
  'NO_EXCESS_BALANCE',
  'CONSOLIDATION_TARGET_NOT_COMPOUNDING',
  'CONSOLIDATION_BLOCKED_BY_PENDING_WITHDRAWAL',
  'CONSOLIDATION_ALREADY_COMPOUNDING',
  'SPLIT_ALREADY_EXISTS',
  'SPLIT_PARAMS_MISMATCH',
  'SPLIT_PARAMS_REQUIRED',
  'SPLIT_NOT_OVM_RECIPIENT',
  'SPLIT_PAUSED',
  'NOTHING_TO_DISTRIBUTE',
  'OVM_CREATE_EVENT_MISSING',
  'OVM_CREATE_EVENT_AMBIGUOUS',
  'INCENTIVES_PREFLIGHT_FAILED',
  'ALREADY_CLAIMED',
  'EXIT_SHARE_INDEX_INVALID',
  'EXIT_PAYLOAD_SIGNATURE_INVALID',
  'EXIT_VALIDATOR_NOT_IN_CLUSTER',
  'EXIT_VALIDATOR_INDEX_MISMATCH',
  'EXIT_EPOCH_MISMATCH',
  'EXIT_SIGNATURE_CONFLICT',
  'EXIT_PARTIAL_SIGNATURE_INVALID',
  'EXIT_NOT_ENOUGH_SHARES',
  'PREPARED_INVALID',
  'TX_REJECTED',
  'TX_REVERTED',
  'TX_REPLACED',
  'TX_UNCONFIRMED',
  'SIMULATION_FAILED',
] as const satisfies readonly ObolErrorCode[];

/** Every finding code (`Finding.code`), including the incentive claim issues. */
export const FINDING_CODES = [
  'DEPOSIT_EXISTENCE_UNCHECKED',
  'DEPOSIT_IS_TOP_UP',
  'DEPOSIT_ALREADY_QUEUED',
  'TOP_UP_ABOVE_EFFECTIVE_CAP',
  'TOP_UP_EXITED_VALIDATOR',
  'OVM_STAKE_NOT_TRACKED',
  'PROVENANCE_UNKNOWN',
  'VALIDATOR_STATUS_UNCHECKED',
  'WITHDRAW_AMOUNT_CAPPED',
  'PARTIAL_WITHDRAWAL_QUEUE_FULL',
  'CONSOLIDATION_CREDENTIALS_DIFFER',
  'PRINCIPAL_STAKE_MISMATCH',
  'PUBLIC_FORWARDER_HOLDS_ROLE',
  'ROLES_SURVIVE_TRANSFER',
  'ROLE_HOLDERS_UNCHECKED',
  'ROLE_GRANT_CONSOLIDATION',
  'ROLE_GRANT_DEPOSIT_TO_PRINCIPAL',
  'RECIPIENT_WITHDRAW_PAUSED',
  'RAF_LEFT_IN_WAREHOUSE',
  'SPLIT_REUSED',
  'RECIPIENT_NOT_CONTRACT',
  'SIMULATION_UNAVAILABLE',
  'SIMULATION_REVERTED',
  'SIMULATION_PREVIEW_MISMATCH',
  'SIMULATION_UNTRUSTED_EVENT',
  'SIMULATION_CONTRACT_WALLET',
  // Incentive claim issues (incentives.preflight, INCENTIVES_PREFLIGHT_FAILED)
  'NO_INCENTIVES',
  'INCENTIVES_NOT_FOUND',
  'INCENTIVES_FETCH_FAILED',
  'OPERATOR_ADDRESS_MISMATCH',
  'INCENTIVES_DATA_INVALID',
  'CONTRACT_NOT_DEPLOYED',
  'DISTRIBUTOR_UNKNOWN',
  'UNSUPPORTED_CHAIN',
  'TOKEN_MISMATCH',
  'PROOF_INVALID',
  'ALREADY_CLAIMED',
  'CLAIM_WINDOW_CLOSED',
  'CHAIN_READ_FAILED',
] as const;

export type FindingCode = (typeof FINDING_CODES)[number];
